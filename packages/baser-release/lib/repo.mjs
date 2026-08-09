/**
 * ФАКТЫ РЕПОЗИТОРИЯ: какие пакеты есть и как они зовутся, какие номера уже
 * выпущены тегами, какие коммиты с прошлого выпуска ломающие.
 *
 * Часть фактов судит гейт, часть — отдаётся наружу как есть (карта имён,
 * `nameCard`): факт репозитория не перестаёт им быть оттого, что спрашивает его
 * не гейт, а конвейер выпуска.
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

/**
 * Объявление прежних имён пакетов — данные СУДИМОГО репозитория, путь от его
 * корня. Что там лежит и почему именно там — в самом файле и в README.
 */
const FORMER_NAMES = join(PACKAGES, 'baser-release', 'former-names.json');

/**
 * Объявление публичных имён — тоже данные СУДИМОГО репозитория, рядом с
 * прежними. Почему объявление, а не правило вида «приклей скоуп бренда» — в
 * самом файле и в README.
 */
const PUBLIC_NAMES = join(PACKAGES, 'baser-release', 'public-names.json');

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
 * @typedef {import('./guard.mjs').Release} Release
 * @typedef {import('./trace.mjs').Trace} Trace
 */

/**
 * Пакет в карте имён: оба регистра имени и где он лежит.
 *
 * Номера здесь нет намеренно — карта отвечает на вопрос «как этот пакет
 * зовётся», а не «что уезжает»: номер судит гейт, и смешивать два ответа в
 * одном факте значило бы завести третье место, где написана версия.
 *
 * @typedef {object} NamedPackage
 * @property {string} name внутреннее имя — рабочее, им пакет зовётся в контуре
 * @property {string} publicName полное имя, под которым пакет уезжает в комьюнити
 * @property {readonly string[]} formerNames имена, под которыми он выпускался раньше
 * @property {string} dir каталог пакета от корня репозитория
 * @property {boolean} private наружу не едет вовсе
 */

/**
 * ПРЕЖНИЕ ИМЕНА ПАКЕТОВ — читаются из объявления, а не выводятся из строки.
 *
 * Тег выпуска несёт имя, каким пакет звался в момент выпуска, и после
 * переименования история под нынешним именем пуста. Догадка «отрежь прежний
 * скоуп» здесь запрещена сознательно: она верна до следующего переименования и
 * молчит, когда врёт, — а ослепший гейт пропускает номер, который уже уехал.
 *
 * Файла нет — карта пуста, и гейт судит ровно так же, как судил до этой работы:
 * репозиторий без переименований ничего объявлять не обязан.
 *
 * Файл есть, но не разбирается — ОШИБКА, а не пустая карта. Пустая карта здесь
 * означала бы «переименований не было», то есть тихую слепоту с тем же исходом,
 * ради которого всё это и написано.
 *
 * @param {string} root корень судимого репозитория
 * @returns {Map<string, string[]>} нынешнее имя → прежние имена
 */
export function readFormerNames(root) {
  const file = join(root, FORMER_NAMES);
  if (!existsSync(file)) return new Map();

  let declared;
  try {
    declared = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (cause) {
    throw new Error(
      `${FORMER_NAMES}: объявление прежних имён не разбирается как JSON`,
      { cause },
    );
  }

  const map = declared?.formerNames;
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(
      `${FORMER_NAMES}: ожидался объект "formerNames" вида {"<нынешнее имя>": ["<прежнее имя>", …]}`,
    );
  }

  return new Map(
    Object.entries(map).map(([name, former]) => {
      if (
        !Array.isArray(former) ||
        former.some((entry) => typeof entry !== 'string' || entry === '')
      ) {
        throw new Error(
          `${FORMER_NAMES}: прежние имена "${name}" — ожидался список непустых строк`,
        );
      }
      return [name, former];
    }),
  );
}

/**
 * ПУБЛИЧНЫЕ ИМЕНА ПАКЕТОВ — читаются из объявления, а не выводятся из строки.
 *
 * У имени два регистра (`kb:MECH-15`): внутри контура пакет зовётся
 * `@<продукт>/<инструмент>`, в комьюнити уезжает как
 * `@<бренд>/<продукт>-<инструмент>`. Догадка «приклей скоуп бренда» здесь
 * запрещена по той же причине, что и «отрежь прежний скоуп» у прежних имён:
 * она верна до первого исключения и молчит, когда врёт, — а наружу имя уезжает
 * навсегда.
 *
 * ОТКАЗ, А НЕ ПУСТАЯ КАРТА — и в этом отличие от `readFormerNames`. Там
 * отсутствие файла само по себе факт: репозиторий без переименований объявлять
 * нечего. Здесь отсутствие — не факт, а неотвеченный вопрос: у пакета, который
 * едет наружу, публичное имя ЕСТЬ, вопрос только в том, знаем мы его или нет.
 * Ответь мы «имён не объявлено», конвейер опубликовал бы внутреннее.
 *
 * @param {string} root корень судимого репозитория
 * @returns {Map<string, string>} внутреннее имя → публичное
 */
export function readPublicNames(root) {
  const file = join(root, PUBLIC_NAMES);
  if (!existsSync(file)) {
    throw new Error(
      `${PUBLIC_NAMES}: объявления публичных имён нет — под какими именами пакеты уезжают в комьюнити, неизвестно`,
    );
  }

  let declared;
  try {
    declared = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (cause) {
    throw new Error(
      `${PUBLIC_NAMES}: объявление публичных имён не разбирается как JSON`,
      { cause },
    );
  }

  const map = declared?.publicNames;
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(
      `${PUBLIC_NAMES}: ожидался объект "publicNames" вида {"<внутреннее имя>": "<публичное имя>"}`,
    );
  }

  /** @type {Map<string, string>} */
  const taken = new Map();
  for (const [name, published] of Object.entries(map)) {
    if (typeof published !== 'string' || published === '') {
      throw new Error(
        `${PUBLIC_NAMES}: публичное имя "${name}" — ожидалась непустая строка`,
      );
    }
    // Два внутренних имени под одним публичным — не опечатка в данных, а
    // столкновение в реестре: второй выпуск затрёт первый, и узнать об этом
    // снаружи уже не у кого.
    const already = taken.get(published);
    if (already !== undefined) {
      throw new Error(
        `${PUBLIC_NAMES}: публичное имя "${published}" объявлено дважды — у "${already}" и у "${name}"`,
      );
    }
    taken.set(published, name);
  }

  return new Map(Object.entries(map));
}

/**
 * КАРТА ИМЁН РЕПОЗИТОРИЯ — оба регистра каждого пакета в одном ответе.
 *
 * Это то, что зона release отдаёт наружу: конвейеру выпуска нужен факт «под
 * каким именем этот пакет уезжает» — и по всем пакетам сразу, потому что вместе
 * с именем самого пакета переписываются имена межпакетных зависимостей.
 *
 * СОГЛАСОВАННОСТЬ КАРТ ПРОВЕРЯЕТСЯ ЗДЕСЬ, а не только пробой: карта, в которой
 * пакета нет, — это карта, по которой нельзя выпускать, и молчаливо отдать её
 * половиной значило бы дать конвейеру доехать до `npm publish` с внутренним
 * именем. Лишняя запись отвергается по той же причине с другого конца: она
 * говорит о пакете, которого нет, — либо его удалили и забыли карту, либо в
 * имени опечатка, и тогда настоящий пакет не объявлен вовсе.
 *
 * @param {string} root корень судимого репозитория
 * @returns {{packages: NamedPackage[]}}
 */
export function nameCard(root) {
  const packages = readPackages(root);
  const publicNames = readPublicNames(root);
  const formerNames = readFormerNames(root);
  const known = new Set(packages.map((pkg) => pkg.name));

  const безымянные = packages
    .filter((pkg) => !publicNames.has(pkg.name))
    .map((pkg) => pkg.name);
  if (безымянные.length > 0) {
    throw new Error(
      `${PUBLIC_NAMES}: публичное имя не объявлено: ${безымянные.join(', ')}. Новый пакет объявляется здесь — иначе он уедет наружу под внутренним именем`,
    );
  }

  const ничьи = [
    ...[...publicNames.keys()].map((name) => ({ file: PUBLIC_NAMES, name })),
    ...[...formerNames.keys()].map((name) => ({ file: FORMER_NAMES, name })),
  ].filter(({ name }) => !known.has(name));
  if (ничьи.length > 0) {
    throw new Error(
      `объявлены имена пакетов, которых в репозитории нет: ${ничьи
        .map(({ file, name }) => `${name} (${file})`)
        .join(', ')}`,
    );
  }

  return {
    packages: packages
      .map((pkg) => ({
        name: pkg.name,
        publicName: /** @type {string} */ (publicNames.get(pkg.name)),
        formerNames: pkg.formerNames ?? [],
        dir: pkg.dir,
        private: Boolean(pkg.private),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

/**
 * Пакеты монорепы с их номерами. Зона — leaf-имя каталога (`baser-cli` → `cli`).
 *
 * @param {string} root корень репозитория
 * @returns {Manifest[]}
 */
export function readPackages(root) {
  const dir = join(root, PACKAGES);
  if (!existsSync(dir)) return [];

  const former = readFormerNames(root);

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
        formerNames: former.get(manifest.name) ?? [],
      };
    });
}

/** Все теги репозитория — для проб, которые судят сам реестр тегов. */
export function allTags(/** @type {string} */ root) {
  return git(root, 'tag', '--list').split('\n').filter(Boolean);
}

/**
 * Выпуски пакета — под нынешним именем И под прежними.
 *
 * Тег выпуска — `<имя>@<номер>`, форма задана `nx.json` (`releaseTag.pattern`),
 * поэтому имя отрезается по длине, а не по первому `@`: у имён со скоупом их два.
 *
 * ТЕГ ВОЗВРАЩАЕТСЯ ВМЕСТЕ С НОМЕРОМ, а не собирается потом из нынешнего имени.
 * После переименования собранный тег указывал бы на несуществующую ревизию: и
 * человеку («номер занят тегом X» — а такого тега нет), и `git log` в окне
 * ломающих коммитов, который на нём просто упал бы.
 *
 * @param {string} root
 * @param {string} name нынешнее имя пакета
 * @param {readonly string[]} [formerNames] имена, под которыми он выпускался раньше
 * @returns {Release[]}
 */
export function releases(root, name, formerNames = []) {
  return [name, ...formerNames].flatMap((tagged) =>
    git(root, 'tag', '--list', `${tagged}@*`)
      .split('\n')
      .filter(Boolean)
      .map((tag) => ({
        tag,
        name: tagged,
        version: tag.slice(tagged.length + 1),
      })),
  );
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
    /** @param {Manifest} pkg */
    releases: (pkg) => {
      const found = releases(root, pkg.name, pkg.formerNames);
      // Замер называет ИМЕНА, под которыми искали: зелёный гейт на пакете без
      // истории выглядит одинаково и когда пакет не выпускался, и когда его
      // историю не нашли под нынешним именем.
      trace?.event('release.history', {
        package: pkg.name,
        names: [pkg.name, ...(pkg.formerNames ?? [])],
        found: found.length,
      });
      return found;
    },
    /**
     * @param {string} tag
     * @param {Manifest} pkg
     */
    breakingSince: (tag, pkg) => breakingSince(root, tag, pkg, zones),
    ...(trace ? { trace } : {}),
  };
}
