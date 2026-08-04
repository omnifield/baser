#!/usr/bin/env node
/**
 * ПЛАН ДЕВ-ВЫПУСКА: что именно уедет в дев-канал этим прогоном и что для этого
 * обязано уже лежать в реестре.
 *
 * Набор считается ПО РЕПОЗИТОРИЮ, а не по вводу человека при запуске. Номера
 * проставлены в манифестах и уже прошли гейт выпуска на PR — если бы набор
 * задавался вводом, про уезжающее было бы две правды, и разошлись бы они на
 * первом же расхождении, молча.
 *
 * Дев-канал берёт ТОЛЬКО предвыпускные номера нашей схемы — `<X.Y.Z>-dev.<N>`
 * (`kb:BASER3-20`). Отсюда «канал не врёт про себя» держится построением, а не
 * дисциплиной: стабильная тройка под меткой `dev` сюда просто не попадает.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Не судит номера: старшинство, «назад не идёт» и «номер занят»
 * — работа гейта `@omnifield/baser-release`, он стоит на каждом PR, и
 * дублировать его суждение конвейеру нечего (`tasker:BASER2-158`).
 *
 * ЗАВИСИМОСТЕЙ НЕТ, и по той же причине, что у гейта: план считается ДО
 * `pnpm install`, чтобы прогон падал на «нечего выпускать» за секунды, а не
 * после установки зависимостей.
 *
 * ```
 * node .github/scripts/dev-release-plan.mjs [--root <каталог>]
 * ```
 *
 * stdout — план в JSON (его читает воркфлоу), stderr — то же для человека.
 * Выход `0` — план есть, `1` — выпускать нечего, `2` — позван неверно.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Каталог с пакетами монорепы — раскладка «один пакет = одна зона». */
const PACKAGES = 'packages';

/**
 * Номер дев-сборки: тройка плюс суффикс `-dev.<N>` (`kb:BASER3-20`). Форма
 * сомкнута с обоих концов намеренно — `0.3.0-dev.1+meta` или `0.3.0-beta.1`
 * это не наш дев-канал, и молча принимать их за него нельзя.
 */
const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+$/;

/** Ссылка на соседа по монорепе: `workspace:*`, `workspace:^`, `workspace:~`. */
const WORKSPACE = /^workspace:/;

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : args[rootFlag + 1];

if (rootFlag !== -1 && !root) {
  console.error('dev-release-plan: у --root не назван каталог');
  process.exit(2);
}

/**
 * @typedef {object} Manifest
 * @property {string} name
 * @property {string} version
 * @property {string} dir      путь каталога пакета от корня репозитория
 * @property {boolean} private
 * @property {Record<string, string>} dependencies
 */

/**
 * Пакеты монорепы как они объявлены в манифестах.
 *
 * @param {string} where корень репозитория
 * @returns {Manifest[]}
 */
function readPackages(where) {
  const dir = join(where, PACKAGES);
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
        dependencies: manifest.dependencies ?? {},
      };
    });
}

const packages = readPackages(root);

/** Что уезжает: непубличное отсекается там же, где и не-дев-номера. */
const publish = packages
  .filter((pkg) => !pkg.private && DEV_VERSION.test(pkg.version ?? ''))
  .map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    dir: pkg.dir,
    tag: `${pkg.name}@${pkg.version}`,
  }));

if (publish.length === 0) {
  console.error('ДЕВ-ВЫПУСК: выпускать нечего — ни один пакет не несёт дев-номера.\n');
  console.error('Дев-канал берёт номера вида <мажор>.<минор>.<патч>-dev.<N> и только их.');
  console.error('Номер проставляет человек в package.json пакета, а не конвейер при запуске:');
  console.error('на нулевых мажорах считалка версий информации не несёт (tasker:BASER2-95).\n');
  console.error('Сейчас в дереве:');
  for (const pkg of packages) {
    console.error(`  · ${pkg.name}: ${pkg.version}${pkg.private ? ' (невыпускаемый)' : ''}`);
  }
  process.exit(1);
}

const shipping = new Set(publish.map((entry) => entry.name));

/**
 * Соседи, которых этот прогон НЕ выпускает, но на которых выпускаемое ссылается.
 *
 * Ссылка `workspace:*` превращается при публикации в ТОЧНЫЙ номер соседа из
 * рабочего дерева. Значит выпуск одной двери молча обещает потребителю, что
 * названные номера соседей в реестре уже есть, — а если их там нет, узнает он
 * об этом установкой, а не выпуском. Поэтому они выписаны отдельным списком:
 * реестр спрашивается про них ДО публикации.
 *
 * @type {{name: string, version: string, neededBy: string}[]}
 */
const requires = [];
const seen = new Set();

for (const pkg of packages) {
  if (!shipping.has(pkg.name)) continue;
  for (const [dep, range] of Object.entries(pkg.dependencies)) {
    if (!WORKSPACE.test(range) || shipping.has(dep)) continue;
    const neighbour = packages.find((entry) => entry.name === dep);
    if (neighbour === undefined) continue;
    const key = `${dep}@${neighbour.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requires.push({ name: dep, version: neighbour.version, neededBy: pkg.name });
  }
}

console.error('ДЕВ-ВЫПУСК: уезжает');
for (const entry of publish) console.error(`  · ${entry.name}@${entry.version}`);
if (requires.length > 0) {
  console.error('\nОбязано уже лежать в реестре (ссылки выпускаемого на соседей):');
  for (const entry of requires) {
    console.error(`  · ${entry.name}@${entry.version} — нужен ${entry.neededBy}`);
  }
}

console.log(JSON.stringify({ publish, requires }, null, 2));
