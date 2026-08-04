/**
 * ФАКТЫ РЕПОЗИТОРИЯ, по которым судит гейт: какие пакеты есть, какие номера уже
 * выпущены тегами, какие коммиты с прошлого выпуска ломающие.
 *
 * Всё, что читает диск и git, живёт здесь и только здесь. Суждение
 * (`guard.mjs`) фактов не добывает — иначе его нельзя было бы прогнать на
 * наборе номеров, которого в рабочем дереве нет.
 *
 * ГЕЙТ СУДИТ РЕПОЗИТОРИЙ, В КОТОРОМ ЗАПУЩЕН, а не пакет, в котором лежит:
 * корень передаётся параметром (по умолчанию — текущий каталог), и потребителю
 * инструмента это позволяет звать его у себя, а не только у нас.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Каталог с пакетами монорепы — раскладка «один пакет = одна зона». */
const PACKAGES = 'packages';

/** Ломающее в заголовке — `feat(cli)!: …`; форма из conventional commits. */
const BANG = /^[a-z]+(\([^)]*\))?!:/;

/**
 * Ломающее в теле. Футер конвенции — `BREAKING CHANGE:` с начала строки, но у
 * нас тело коммита в `main` — это описание PR, где то же самое живёт заголовком
 * раздела. Признаём обе формы: пропустить настоящее ломающее из-за решётки
 * дороже, чем лишний раз потребовать минор.
 */
const FOOTER = /^#*\s*BREAKING[ -]CHANGE/m;

/**
 * Зона, названная в заголовке коммита: `feat(cli)!: …` → `cli`.
 *
 * Нужна потому, что заход БЫВАЕТ МНОГОЗОННЫМ: ломающее в двери и правка пробы у
 * соседа, который за снятое имя держался, приезжают ОДНИМ сквошем, и по файлам
 * такой коммит задевает обе зоны. Считать его ломающим для соседа значило бы
 * требовать минор у пакета, поверхность которого не двигалась вовсе.
 *
 * Заголовок при этом врать не может: его форму держит отдельный гейт CI, а
 * scope в нём — это и есть зона-владелец изменения.
 *
 * @param {string} subject
 * @returns {string|null}
 */
export function scopeOf(subject) {
  return /^[a-z]+\(([^)]*)\)!?:/.exec(subject)?.[1] ?? null;
}

/**
 * @param {string} root
 * @param {...string} args
 */
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();
}

/**
 * @typedef {import('./guard.mjs').Manifest} Manifest
 * @typedef {import('./trace.mjs').Trace} Trace
 */

/**
 * Пакеты монорепы с их номерами. Зона — leaf-имя каталога (`baser-cli` → `cli`).
 *
 * @param {string} root корень репозитория
 * @returns {Manifest[]}
 */
export function readPackages(root) {
  const dir = join(root, PACKAGES);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((entry) => existsSync(join(dir, entry, 'package.json')))
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(join(dir, entry, 'package.json'), 'utf-8'),
      );
      return {
        name: manifest.name,
        version: manifest.version,
        dir: join(PACKAGES, entry),
        zone: entry.replace(/^baser-/, ''),
        private: Boolean(manifest.private),
      };
    });
}

/**
 * Номера, выпущенные тегами пакета. Тег выпуска — `<имя>@<номер>`, форма задана
 * `nx.json` (`releaseTag.pattern`), поэтому имя отрезается по длине, а не по
 * первому `@`: у имён со скоупом их два.
 *
 * @param {string} root
 * @param {string} name
 */
export function releasedVersions(root, name) {
  return git(root, 'tag', '--list', `${name}@*`)
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(name.length + 1));
}

/**
 * Ломающие коммиты, задевшие каталог пакета, в окне истории `tag..until`.
 *
 * ГРАНИЦА, НАЗВАННАЯ ВСЛУХ: коммит с чужой зоной в заголовке для этого пакета
 * не считается ломающим, даже если задел его файлы. Дыра здесь есть и она
 * известна — заход, который ломает поверхность СОСЕДА, называя в заголовке свою
 * зону, гейт пропустит. Закрывать её пришлось бы разбором самих поверхностей,
 * а это не работа гейта версий; зато scope, не совпавший ни с одним пакетом
 * (`repo`, `harness`), считается общим и учитывается везде.
 *
 * ВЕРХ ОКНА по умолчанию — `HEAD`: гейт судит то, что уезжает сейчас, и другого
 * верха у него не бывает. Названный явно, он даёт ЗАКРЫТОЕ окно между двумя
 * выпущенными тегами — набор коммитов в нём уже не изменится, и следующий
 * выпуск не перепишет вердикт задним числом. Ради этого свойства верх и
 * появился параметром: на нём стоят пробы на живой истории (`BASER2-176`).
 *
 * @param {string} root
 * @param {string} tag
 * @param {{dir: string, zone: string}} pkg
 * @param {ReadonlySet<string>} zones
 * @param {string} [until] верх окна — тег или ревизия; по умолчанию `HEAD`
 */
export function breakingSince(root, tag, pkg, zones, until = 'HEAD') {
  const log = git(
    root,
    'log',
    `${tag}..${until}`,
    '--format=%H%x1f%s%x1f%b%x1e',
    '--',
    pkg.dir,
  );
  return log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body = ''] = entry.split('\x1f');
      return { hash: hash.slice(0, 7), subject, body };
    })
    .filter(({ subject, body }) => BANG.test(subject) || FOOTER.test(body))
    .filter(({ subject }) => {
      const scope = scopeOf(subject);
      return scope === null || !zones.has(scope) || scope === pkg.zone;
    });
}

/**
 * Факты репозитория в форме, которую ждёт `judge()`.
 *
 * @param {string} root
 * @param {Trace} [trace]
 */
export function factsOf(root, trace) {
  const packages = readPackages(root);
  const zones = new Set(packages.map((pkg) => pkg.zone));

  return {
    packages,
    /** @param {string} name */
    releasedVersions: (name) => releasedVersions(root, name),
    /**
     * @param {string} tag
     * @param {Manifest} pkg
     */
    breakingSince: (tag, pkg) => breakingSince(root, tag, pkg, zones),
    ...(trace ? { trace } : {}),
  };
}
