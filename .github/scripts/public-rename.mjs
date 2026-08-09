#!/usr/bin/env node
/**
 * ПЕРЕИМЕНОВАНИЕ ПЕРЕД ПУБЛИКАЦИЕЙ: собранное под внутренним именем уезжает в
 * комьюнити под полным.
 *
 * У имени пакета два регистра (`kb:MECH-15`): внутри контура `@baser/<инструмент>`,
 * наружу `@omnifield/baser-<инструмент>`. Публикуется то, что лежит в манифестах, —
 * значит без этого шага в публичный npm уехало бы внутреннее рабочее имя, причём
 * наружу и навсегда (`tasker:BASER2-261`).
 *
 * ── ПЕРЕИМЕНОВАНИЕ СТРУКТУРНОЕ, А НЕ ЗАМЕНА СТРОКИ ──────────────────────────
 *
 * Внутреннее имя встречается в поставляемом в четырёх разных ролях, и замена по
 * файлу склеила бы их в одну:
 *
 * | роль                                        | пример                              | трогаем |
 * | ------------------------------------------- | ----------------------------------- | ------- |
 * | имя пакета и ссылки на соседей в манифесте  | `"@baser/contracts": "workspace:*"` | да      |
 * | спецификатор импорта в поставляемом коде    | `from '@baser/contracts/locate'`    | да      |
 * | ИМЯ УСЛОВИЯ резолва в `exports`             | `"@baser/source": "./src/index.ts"` | НЕТ     |
 * | проза — README, комментарии, шаблоны        | «файл кладёт обвес `@baser/git`»    | НЕТ     |
 *
 * Третья строка — ловушка, ради которой всё здесь разобрано по полям: условие
 * `@baser/source` названо по корневому пакету монорепы и к пакету-соседу
 * отношения не имеет. Переименуй его — и сборка из исходников перестанет
 * резолвиться, молча.
 *
 * Четвёртая строка — не наша работа, но и не молчание: проза в поставляемом
 * называется в отчёте отдельным списком. Резолв она не ломает, а человеку врёт,
 * и чинит её владелец зоны в своём тексте, а не конвейер заменой по файлу.
 *
 * ── ССЫЛКА НА СОСЕДА ПРЕВРАЩАЕТСЯ В НОМЕР ЗДЕСЬ ────────────────────────────
 *
 * `workspace:*` — спецификатор, которого вне монорепы не существует, и пакет с
 * ним не ставится вовсе (`tasker:BASER2-77`). Обычно его подменяет `pnpm publish`,
 * но после переименования подменять ему нечего: пакета `@omnifield/baser-contracts`
 * в рабочем дереве нет. Значит номер соседа проставляем мы — по тем же правилам,
 * что у менеджера: `*` → точный номер, `^`/`~` → диапазон от него.
 *
 * ── ЧЕГО ЗДЕСЬ НЕТ ──────────────────────────────────────────────────────────
 *
 * Карты имён. Правило «внутреннее → публичное» объявляет зона `release` рядом с
 * прежними именами — одна карта на репозиторий (`tasker:BASER2-261`, пункт 4).
 * Здесь она аргумент: свой разбор чужого объявления был бы вторым источником
 * правды, а он расходится с первым молча.
 *
 * Суждения о номерах. Старшинство и «номер занят» судит гейт `@baser/release`.
 *
 * ```
 * node .github/scripts/public-rename.mjs --names <файл> [--root <каталог>]
 * ```
 *
 * Файл карты — объект `{"<внутреннее>": "<публичное>"}`. stdout — отчёт в JSON
 * (его читают шаги публикации и приёмки), stderr — то же для человека.
 * Выход `0` — переименовано, `1` — отказ до реестра, `2` — позван неверно.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Каталог с пакетами монорепы — раскладка «один пакет = одна зона». */
const PACKAGES = 'packages';

/** Блоки манифеста, где имя соседа — ссылка, а не текст. */
const DEPENDENCY_BLOCKS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * Спецификатор модуля в поставляемом коде: `from '…'`, `import '…'`,
 * `import('…')`, `require('…')`.
 *
 * Разбором `.d.ts` тут не пахнет намеренно: `import("@baser/contracts").Тип`
 * в объявлениях типов — тот же `import(`, и ловится тем же правилом. Всё, что
 * не спецификатор, эта форма не трогает — включая имя условия в `exports`,
 * которое лежит в JSON и никаким `from` не предваряется.
 */
const SPECIFIER = /\b(from|import|require)\s*(\(\s*)?(['"])([^'"\n]+)\3/g;

/** Ссылка на соседа по монорепе: `workspace:*`, `workspace:^`, `workspace:~`. */
const WORKSPACE = /^workspace:(.*)$/;

/**
 * Имя пакета в спецификаторе и подпуть за ним.
 *
 * Подпуть обязателен к сохранению: в поставляемом живёт `@baser/contracts/locate`,
 * и пакет, потерявший хвост, резолвится в другую поверхность или ни во что.
 *
 * @param {string} specifier
 * @returns {{name: string, subpath: string}}
 */
export function splitSpecifier(specifier) {
  const parts = specifier.split('/');
  const take = specifier.startsWith('@') ? 2 : 1;
  return {
    name: parts.slice(0, take).join('/'),
    subpath: parts.slice(take).join('/'),
  };
}

/**
 * Спецификатор под публичным именем. Незнакомое имя возвращается как есть —
 * судить о чужих пакетах эта работа не должна.
 *
 * @param {string} specifier
 * @param {ReadonlyMap<string, string>} names внутреннее имя → публичное
 * @returns {string}
 */
export function renameSpecifier(specifier, names) {
  const { name, subpath } = splitSpecifier(specifier);
  const renamed = names.get(name);
  if (renamed === undefined) return specifier;
  return subpath === '' ? renamed : `${renamed}/${subpath}`;
}

/**
 * Поставляемый текст с переименованными спецификаторами.
 *
 * Трогаются ТОЛЬКО спецификаторы. Проза остаётся как была — см. разбор ролей в
 * шапке файла.
 *
 * @param {string} text
 * @param {ReadonlyMap<string, string>} names
 * @returns {string}
 */
export function renameSource(text, names) {
  return text.replace(
    SPECIFIER,
    (whole, keyword, open, quote, specifier) => {
      const renamed = renameSpecifier(specifier, names);
      if (renamed === specifier) return whole;
      return `${keyword}${open ?? ' '}${quote}${renamed}${quote}`;
    },
  );
}

/**
 * Внутренние имена, оставшиеся в тексте ПОСЛЕ переименования.
 *
 * Здесь ищется любое вхождение, а не спецификатор: это отчёт о прозе, а не
 * вторая попытка переименовать. Пустой список у кода означает, что резолв чист;
 * непустой у README означает, что человеку в публичном пакете рассказывают про
 * имя, которого в публичном реестре нет.
 *
 * @param {string} text
 * @param {Iterable<string>} names внутренние имена
 * @returns {string[]}
 */
export function mentions(text, names) {
  return [...names].filter((name) => text.includes(name));
}

/**
 * Номер, который встанет вместо ссылки на соседа.
 *
 * Правила те же, что у менеджера при публикации: `*` (и голый `workspace:`) —
 * точный номер, `^`/`~` — диапазон от него, всё остальное в спецификаторе —
 * диапазон, названный человеком.
 *
 * @param {string} range значение ссылки, например `workspace:^`
 * @param {string} version номер соседа в рабочем дереве
 * @returns {string}
 */
export function resolveWorkspace(range, version) {
  const tail = WORKSPACE.exec(range)?.[1] ?? '';
  if (tail === '' || tail === '*') return version;
  if (tail === '^' || tail === '~') return `${tail}${version}`;
  return tail;
}

/**
 * Отказ, который называет причину до реестра, а не после.
 */
export class RenameRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RenameRefusal';
  }
}

/**
 * Манифест в публичной форме: имя пакета и ссылки на соседей.
 *
 * ОТСУТСТВИЕ ОБЪЯВЛЕННОГО ИМЕНИ — ОТКАЗ, а не «оставим как есть». Пакет без
 * публичного имени уехал бы под внутренним, то есть случился бы ровно тот
 * дефект, ради которого этот шаг существует, — и случился бы молча.
 *
 * @param {Record<string, any>} manifest манифест как он лежит в дереве
 * @param {ReadonlyMap<string, string>} names внутреннее имя → публичное
 * @param {ReadonlyMap<string, string>} versions внутреннее имя → номер в дереве
 * @returns {Record<string, any>}
 */
export function renameManifest(manifest, names, versions) {
  const publicName = names.get(manifest.name);
  if (publicName === undefined) {
    throw new RenameRefusal(
      `${manifest.name}: публичное имя не объявлено. Карта имён — одна на репозиторий, объявляет её зона release; пакет без записи в ней публиковать нельзя, иначе он уедет наружу под внутренним именем.`,
    );
  }

  const renamed = structuredClone(manifest);
  renamed.name = publicName;

  for (const block of DEPENDENCY_BLOCKS) {
    const deps = manifest[block];
    if (deps === undefined) continue;

    /** @type {Record<string, string>} */
    const next = {};
    for (const [dep, range] of Object.entries(deps)) {
      const workspace = WORKSPACE.test(range);
      const dependencyName = names.get(dep);

      if (workspace && dependencyName === undefined) {
        throw new RenameRefusal(
          `${manifest.name}: ссылка на соседа "${dep}" (${range}), у которого публичное имя не объявлено. Опубликованный пакет тянул бы несуществующее.`,
        );
      }

      if (!workspace) {
        // Чужой пакет — не наше дело; свой, но с обычным диапазоном, тоже
        // остаётся как есть: переименование не место для суждений о номерах.
        next[dependencyName ?? dep] = range;
        continue;
      }

      const version = versions.get(dep);
      if (version === undefined) {
        throw new RenameRefusal(
          `${manifest.name}: ссылка "${dep}": "${range}" не разрешается — такого пакета нет в рабочем дереве, а значит нечем заменить workspace-спецификатор.`,
        );
      }

      next[/** @type {string} */ (dependencyName)] = resolveWorkspace(
        range,
        version,
      );
    }
    renamed[block] = next;
  }

  return renamed;
}

/**
 * Пакеты монорепы как они объявлены в манифестах.
 *
 * @param {string} root корень репозитория
 * @returns {{name: string, version: string, dir: string, private: boolean, manifest: Record<string, any>}[]}
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
        dir: `${PACKAGES}/${entry}`,
        private: Boolean(manifest.private),
        manifest,
      };
    });
}

/**
 * Файлы, которые уедут в тарболе, — спрошены у самого npm.
 *
 * Список полей `files` разбирать нельзя: там отрицания, а README, LICENSE и сам
 * манифест npm кладёт независимо от него. Переименовать надо ровно то, что
 * уедет, — значит спрашиваем того, кто увезёт (тот же приём, что у приёмки зоны
 * `pack`: «нагрузка байт в байт равна тому, что npm увёз бы в тарболе»).
 *
 * @param {string} dir каталог пакета
 * @returns {string[]} пути от каталога пакета
 */
export function shippedFiles(dir) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files.map((/** @type {any} */ file) => file.path);
}

/** Поставляемое, где спецификатор вообще может встретиться. */
const CODE = /\.(m|c)?[jt]sx?$|\.d\.(m|c)?ts$/;

/**
 * @typedef {object} Renamed
 * @property {string} internal
 * @property {string} public
 * @property {string} version
 * @property {string} dir
 * @property {number} sources сколько поставляемых файлов переписано
 */

/**
 * @typedef {object} Report
 * @property {Renamed[]} renamed
 * @property {{file: string, names: string[]}[]} prose внутренние имена, оставшиеся в тексте
 */

/**
 * Переименование в рабочем дереве. Дерево после этого шага публикуемое, но НЕ
 * коммитимое: в репозитории имена остаются внутренними, и тег выпуска тоже —
 * иначе гейт номеров и объявление прежних имён потеряли бы историю.
 *
 * @param {string} root
 * @param {ReadonlyMap<string, string>} names
 * @param {{read: (path: string) => string, write: (path: string, text: string) => void, shipped: (dir: string) => string[]}} [io]
 * @returns {Report}
 */
export function rename(root, names, io) {
  const read = io?.read ?? ((path) => readFileSync(path, 'utf-8'));
  const write = io?.write ?? ((path, text) => writeFileSync(path, text));
  const shipped = io?.shipped ?? shippedFiles;

  const packages = readPackages(root).filter((pkg) => !pkg.private);
  const versions = new Map(packages.map((pkg) => [pkg.name, pkg.version]));

  /** @type {Renamed[]} */
  const renamed = [];
  /** @type {{file: string, names: string[]}[]} */
  const prose = [];

  for (const pkg of packages) {
    const manifest = renameManifest(pkg.manifest, names, versions);
    let sources = 0;

    for (const file of shipped(join(root, pkg.dir))) {
      if (file === 'package.json') continue;
      const path = join(root, pkg.dir, file);
      const before = read(path);

      if (CODE.test(file)) {
        const after = renameSource(before, names);
        if (after !== before) {
          write(path, after);
          sources += 1;
        }
        const left = mentions(after, names.keys());
        if (left.length > 0) prose.push({ file: `${pkg.dir}/${file}`, names: left });
        continue;
      }

      const left = mentions(before, names.keys());
      if (left.length > 0) prose.push({ file: `${pkg.dir}/${file}`, names: left });
    }

    write(
      join(root, pkg.dir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    renamed.push({
      internal: pkg.name,
      public: manifest.name,
      version: pkg.version,
      dir: pkg.dir,
      sources,
    });
  }

  return { renamed, prose };
}

/**
 * Отчёт словами — тот же факт, что и в JSON, но для человека в логе прогона.
 *
 * @param {Report} report
 * @returns {string[]}
 */
export function describe(report) {
  const lines = ['ПЕРЕИМЕНОВАНИЕ ПЕРЕД ПУБЛИКАЦИЕЙ:'];
  for (const entry of report.renamed) {
    lines.push(
      `  · ${entry.internal}@${entry.version} → ${entry.public} (переписано файлов: ${entry.sources})`,
    );
  }

  if (report.prose.length > 0) {
    lines.push(
      '',
      'Внутреннее имя осталось в ТЕКСТЕ поставляемого — резолв это не ломает,',
      'но человеку в публичном пакете рассказывают про имя, которого в публичном',
      'реестре нет. Чинит владелец зоны в своём тексте, не конвейер:',
    );
    for (const entry of report.prose) {
      lines.push(`  · ${entry.file} — ${entry.names.join(', ')}`);
    }
  }

  return lines;
}

/**
 * Запуск в конвейере.
 *
 * @param {string[]} argv аргументы после имени скрипта
 * @returns {number} код выхода
 */
function main(argv) {
  const namesFlag = argv.indexOf('--names');
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? process.cwd() : argv[rootFlag + 1];

  if (namesFlag === -1 || !argv[namesFlag + 1]) {
    console.error(
      'public-rename: не назван файл карты имён (--names <файл>). Карту объявляет зона release — одна на репозиторий.',
    );
    return 2;
  }
  if (rootFlag !== -1 && !root) {
    console.error('public-rename: у --root не назван каталог');
    return 2;
  }

  /** @type {Map<string, string>} */
  let names;
  try {
    names = new Map(Object.entries(JSON.parse(readFileSync(argv[namesFlag + 1], 'utf-8'))));
  } catch (cause) {
    console.error(
      `public-rename: карта имён «${argv[namesFlag + 1]}» не прочитана или не разбирается как JSON вида {"<внутреннее>": "<публичное>"}: ${cause instanceof Error ? cause.message : cause}`,
    );
    return 2;
  }

  /** @type {Report} */
  let report;
  try {
    report = rename(root, names);
  } catch (cause) {
    if (cause instanceof RenameRefusal) {
      console.error(`public-rename: ОТКАЗ ДО РЕЕСТРА — ${cause.message}`);
      return 1;
    }
    throw cause;
  }

  for (const line of describe(report)) console.error(line);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
