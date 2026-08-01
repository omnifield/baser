#!/usr/bin/env node
/**
 * ГЕЙТ ВЫПУСКА: ломающее изменение не уедет в реестр патчем.
 *
 * Почему он вообще есть. `nx release` настроен считать версии по conventional
 * commits, и на пакетах старше `1.0.0` он это делает верно. На НУЛЕВЫХ МАЖОРАХ —
 * а мы все на них — он поднимает патч и фиче, и ломающему: проверено прогоном
 * 2026-08-01, включая явное соответствие типов в `nx.json`, которое ничего не
 * меняет (`tasker:BASER2-95`). То есть номер, посчитанный машиной, сегодня не
 * несёт информации, и потребитель узнаёт о снятом имени, только сломавшись.
 *
 * Решение (user, 2026-08-01): номер назначает человек и называет причину, а
 * НЕВРАНЬЕ держит машина — этот гейт. Уйдём с нулевых мажоров — считалка станет
 * честной сама, и гейт останется страховкой, а не костылём.
 *
 * ЧТО ИМЕННО ОН УТВЕРЖДАЕТ. Ровно одно: если с прошлого выпуска пакет получил
 * ломающий коммит, его номер обязан двинуться не меньше, чем требует конвенция
 * нулевых мажоров, — минор при `0.x`, мажор при `1.0.0` и старше.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ. Не назначает версий и не судит фичи с починками: недобранный
 * минор у фичи — потеря сигнала, недобранный минор у ЛОМАЮЩЕГО — сломанный
 * потребитель, и лечится это разным. Здесь только второе.
 *
 * КОГДА МОЛЧИТ. Версия пакета совпадает с последним тегом — выпуска нет,
 * проверять нечего: гейт стоит на PR, а на обычном PR версии не двигаются.
 * Тегов у пакета нет вовсе — он не выпускался ни разу, базы для сравнения нет.
 *
 * Запуск: `node tools/release-guard.mjs` из корня репозитория.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

/** Версия как тройка чисел; всё, что не тройка, — не наш случай. */
function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Последний выпуск пакета — старший тег вида `<имя>@<версия>`. */
function lastReleased(name) {
  const tags = git('tag', '--list', `${name}@*`).split('\n').filter(Boolean);
  const versions = tags
    .map((tag) => tag.slice(name.length + 1))
    .map((version) => ({ version, parsed: parse(version) }))
    .filter((entry) => entry.parsed !== null)
    .sort((a, b) => compare(a.parsed, b.parsed));
  return versions.at(-1) ?? null;
}

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
 */
function scopeOf(subject) {
  return /^[a-z]+\(([^)]*)\)!?:/.exec(subject)?.[1] ?? null;
}

/**
 * Ломающие коммиты, задевшие каталог пакета, с прошлого выпуска.
 *
 * ГРАНИЦА, НАЗВАННАЯ ВСЛУХ: коммит с чужой зоной в заголовке для этого пакета
 * не считается ломающим, даже если задел его файлы. Дыра здесь есть и она
 * известна — заход, который ломает поверхность СОСЕДА, называя в заголовке свою
 * зону, гейт пропустит. Закрывать её пришлось бы разбором самих поверхностей,
 * а это не работа гейта версий; зато scope, не совпавший ни с одним пакетом
 * (`repo`, `harness`), считается общим и учитывается везде.
 */
function breakingSince(tag, dir, zone, zones) {
  const log = git('log', `${tag}..HEAD`, '--format=%H%x1f%s%x1f%b%x1e', '--', dir);
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
      return scope === null || !zones.has(scope) || scope === zone;
    });
}

const dirs = readdirSync(PACKAGES).filter((dir) =>
  existsSync(join(PACKAGES, dir, 'package.json')),
);

/** Зоны продукта — по именам каталогов `packages/baser-<зона>`. */
const zones = new Set(dirs.map((dir) => dir.replace(/^baser-/, '')));

const problems = [];
const said = [];

for (const dir of dirs) {
  const manifestPath = join(PACKAGES, dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const { name, version } = manifest;
  if (!name || !version || manifest.private) continue;

  const released = lastReleased(name);
  if (released === null) {
    said.push(`${name}: тегов выпуска нет — пакет не выпускался, сравнивать не с чем`);
    continue;
  }
  if (released.version === version) continue;

  const now = parse(version);
  const was = released.parsed;
  if (now === null) {
    problems.push(`${name}: версия "${version}" не разбирается как <мажор>.<минор>.<патч>`);
    continue;
  }
  if (compare(now, was) <= 0) {
    problems.push(
      `${name}: версия ${version} не старше выпущенной ${released.version} — выпуск назад не идёт`,
    );
    continue;
  }

  const breaking = breakingSince(
    `${name}@${released.version}`,
    join(PACKAGES, dir),
    dir.replace(/^baser-/, ''),
    zones,
  );
  if (breaking.length === 0) {
    said.push(`${name}: ${released.version} → ${version}, ломающего с прошлого выпуска нет`);
    continue;
  }

  // Конвенция нулевых мажоров: пока мажор нулевой, ломающее поднимает МИНОР —
  // мажор занят под «форма встала». После 1.0.0 ломающее поднимает мажор.
  const enough = was[0] === 0 ? now[1] > was[1] || now[0] > was[0] : now[0] > was[0];
  const required = was[0] === 0 ? 'минор' : 'мажор';

  if (enough) {
    said.push(
      `${name}: ${released.version} → ${version}, ломающих коммитов ${breaking.length} — ${required} набран`,
    );
    continue;
  }

  problems.push(
    [
      `${name}: ${released.version} → ${version} — ЭТОГО МАЛО.`,
      `  С прошлого выпуска пакет получил ломающее (${breaking.length}), а номер требует поднять ${required}:`,
      ...breaking.map(({ hash, subject }) => `    ${hash} ${subject}`),
      `  Потребитель узнает о снятом имени, только сломавшись, — номер обязан сказать это раньше.`,
    ].join('\n'),
  );
}

for (const line of said) console.log(`  · ${line}`);

if (problems.length > 0) {
  console.error('\nГЕЙТ ВЫПУСКА: номер не называет цену изменения\n');
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}

console.log('\nГейт выпуска: номера называют цену изменения.');
