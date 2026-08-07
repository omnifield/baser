#!/usr/bin/env node
/**
 * КОМАНДА ГОТОВНОСТИ — та же одна на всех, но честная на прогретом дереве.
 *
 * `pnpm verify` = `nx run-many -t test typecheck build --skip-nx-cache`, и до
 * `tasker:BASER2-219` это была вся команда целиком. Флаг снимает кэш **nx** — и
 * не снимает инкрементальное состояние **TypeScript**: `tsc --build` читает
 * `.tsbuildinfo` и пропускает работу. Цель «проходит», не проверив.
 *
 * ОТСЮДА ЗЕЛЁНОЕ У СЕБЯ ПРИ КРАСНОМ CI. В CI состояния нет — там всегда холодно,
 * поэтому CI и видел то, чего не видел вахтёр. `tasker:BASER2-191` свёл гейт и
 * приёмку к ОДНОЙ команде именно ради равенства «зелёное здесь = зелёное там»;
 * команда была одна, а состояние разное, и равенство ломалось молча. Счёт на
 * 2026-08-07 — четыре ложных зелёных на четырёх сессиях, включая architect.
 *
 * ЖИВОЙ СЛУЧАЙ, на котором это проверено (`tasker:BASER2-213`, коммит
 * `b12b05b`): `@omnifield/baser-pack:typecheck`, `TS2741` — раскладке добавили
 * обязательное поле, пробы пакета его не назвали. На прогретом дереве старая
 * команда отвечала `exit 0` девятью зелёными проектами; на том же дереве без
 * состояния — красная цель с той самой ошибкой.
 *
 * ЧТО ДЕЛАЕТ ЭТОТ ФАЙЛ. Ровно две вещи и ничего сверх: снимает инкрементальное
 * состояние tsc и зовёт ту же самую команду nx. Суждений о готовности он не
 * добавляет — набор целей остаётся один и живёт здесь же, строкой `READINESS`.
 *
 * ПОЧЕМУ СНОС, А НЕ `tsc --build --force`. Флаг пришлось бы дописать в цели
 * `typecheck` и `build`, а рождает их плагин `@nx/js/typescript` из корневого
 * `nx.json` — общая настройка монорепы, не наша зона. Снос состояния лечит ту же
 * причину снаружи целей, ничего не зная про их устройство, и работает для любой
 * новой зоны без правки. Ровно им мы лечили это руками три дня.
 *
 * ЦЕНА — ЗАМЕР, а не обещание (2026-08-07, девять проектов, по два прогона
 * каждой команды подряд, с пробами этого файла в наборе):
 *
 * | прогон                             | nx duration   |
 * | ---------------------------------- | ------------- |
 * | на прогретом состоянии (было)      | 37.9 · 38.1 с |
 * | без состояния (стало)              | 42.1 · 43.2 с |
 *
 * Плюс ~4.7 с, 12%. Сам снос стоит 4–6 мс — платит не он, а честный `tsc`.
 * Критический путь прогона — пробы двери (~35 с), и проверка типов в него не
 * попадает: цели идут параллельно и стоят секунды. Гейт, ставший вдвое дольше,
 * начинают обходить — этот не стал.
 *
 * ГРАНИЦЫ СНОСА названы списком `SKIPPED`, и каждый пункт — не осторожность:
 * `node_modules` — чужое состояние, не наше; `.nx` — кэш движка, который эта
 * команда и так не читает (`--skip-nx-cache`), а снос замедлил бы обычные
 * прогоны; `.git` — не наше вовсе. Симлинки не разворачиваются: pnpm держит
 * пакеты монорепы связанными внутрь `node_modules`, и обход по ссылкам пришёл бы
 * в те же файлы вторым путём.
 *
 * ЧЕГО ЭТА КОМАНДА НЕ ДЕЛАЕТ. Она снимает память tsc, а не всё, чем прогретое
 * дерево отличается от свежего клона: устаревший файл в `dist`, оставшийся от
 * удалённого исходника, здесь не ловится. Это другой класс и другая задача —
 * названа, а не покрыта молчанием.
 *
 * ```
 * node .github/scripts/verify.mjs [--root <каталог>] [аргументы nx...]
 * ```
 *
 * Зависимостей нет: команда готовности бежит до установки чего бы то ни было и
 * обязана работать в локации, где сломано ровно то, что она пришла проверить.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Набор целей готовности — ОДИН на вахтёра, приёмку и оба канала выпуска
 * (`tasker:BASER2-191`). Меняется здесь и только здесь: второе место для этого
 * набора и есть та щель, из которой «готово» начинает значить разное.
 */
export const READINESS = [
  'run-many',
  '-t',
  'test',
  'typecheck',
  'build',
  '--skip-nx-cache',
];

/** Чем tsc помнит сделанное. */
export const STATE_SUFFIX = '.tsbuildinfo';

/** Каталоги, в которые обход не заходит. Почему именно эти — в шапке файла. */
export const SKIPPED = new Set(['node_modules', '.nx', '.git']);

/** Корень репозитория — от места этого файла, а не от `cwd`. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Снимает инкрементальное состояние TypeScript под `root`.
 *
 * @param {string} root каталог, с которого начинается обход
 * @returns {string[]} снятые файлы путями от `root`, по алфавиту
 */
export function sweep(root) {
  /** @type {string[]} */
  const removed = [];

  /** @param {string} dir */
  const walk = (dir) => {
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Каталог исчез или закрыт правами — это не повод не проверить
      // остальное: команда готовности не должна падать на обходе.
      return;
    }

    for (const entry of entries) {
      // Симлинк не разворачиваем ни в каком виде: см. шапку.
      if (entry.isSymbolicLink()) continue;

      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(path);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(STATE_SUFFIX)) {
        rmSync(path, { force: true });
        removed.push(relative(root, path));
      }
    }
  };

  walk(root);
  return removed.sort();
}

/**
 * Запуск команды готовности.
 *
 * @param {string[]} argv аргументы после имени скрипта
 * @returns {Promise<number>} код выхода
 */
export async function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? ROOT : argv[rootFlag + 1];

  if (rootFlag !== -1 && !root) {
    console.error('verify: у --root не назван каталог');
    return 2;
  }

  const rest =
    rootFlag === -1
      ? argv
      : [...argv.slice(0, rootFlag), ...argv.slice(rootFlag + 2)];

  const startedAt = Date.now();
  const removed = sweep(root);
  console.error(
    `verify: снято инкрементальное состояние tsc — ${removed.length} файл(ов) за ${Date.now() - startedAt} мс`,
  );
  for (const file of removed) console.error(`verify:   ${file}`);

  const nx = join(root, 'node_modules', '.bin', 'nx');
  if (!existsSync(nx)) {
    // Зависимости не поставлены — это отказ, а не «нечего проверять»: молчаливое
    // зелёное здесь стоило бы ровно того же, что и то, которое мы чиним.
    console.error(
      `verify: nx не найден по пути ${nx} — зависимости не поставлены`,
    );
    return 2;
  }

  const args = [...READINESS, ...rest];
  console.error(`verify: nx ${args.join(' ')}`);

  const code = await new Promise((resolve) => {
    const child = spawn(nx, args, { cwd: root, stdio: 'inherit' });
    // Смерть от сигнала кодом не приходит (`status === null`), и считать её
    // нулём нельзя: снятый посреди работы прогон готовности не подтверждает.
    child.on('close', (status) => resolve(status ?? 1));
    child.on('error', (error) => {
      console.error(`verify: nx не запустился — ${error.message}`);
      resolve(2);
    });
  });

  console.error(
    `verify: ${((Date.now() - startedAt) / 1000).toFixed(1)} с, код выхода ${code}`,
  );
  return code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(await main(process.argv.slice(2)));
}
