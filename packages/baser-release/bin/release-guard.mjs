#!/usr/bin/env node
/**
 * Гейт выпуска — запуск.
 *
 * ```
 * node packages/baser-release/bin/release-guard.mjs [--root <каталог>] [--trace]
 * ```
 *
 * Судит репозиторий, в котором запущен (`--root` — если запускают не из его
 * корня). Выход `1` — выпуск не поедет, и причина названа.
 *
 * ЗАВИСИМОСТЕЙ НЕТ И ЭТО СВОЙСТВО, А НЕ СОВПАДЕНИЕ. Гейт держит выпуск и стоит
 * на каждом PR: его джоб — `checkout` + `setup-node` + запуск, без установки
 * пакетов. Значит он не стоит в очереди за реестром и токенами и не падает от
 * чужой недоступности. Любая зависимость здесь эту сборку ломает — поэтому
 * инструмент написан на голом ESM и не собирается: файл, который лежит, тот и
 * запускается.
 */

import { judge } from '../lib/guard.mjs';
import { factsOf } from '../lib/repo.mjs';
import { createTrace } from '../lib/trace.mjs';

const args = process.argv.slice(2);
const wantsTrace = args.includes('--trace');
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : args[rootFlag + 1];

if (rootFlag !== -1 && !root) {
  console.error('release-guard: у --root не назван каталог');
  process.exit(2);
}

const trace = wantsTrace
  ? createTrace({
      sink: (span) => console.error(`[trace] ${JSON.stringify(span)}`),
    })
  : undefined;

const { said, problems } = judge(factsOf(root, trace));

for (const line of said) console.log(`  · ${line}`);

if (problems.length > 0) {
  console.error('\nГЕЙТ ВЫПУСКА: номер не называет цену изменения\n');
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}

console.log('\nГейт выпуска: номера называют цену изменения.');
