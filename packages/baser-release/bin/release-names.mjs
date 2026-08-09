#!/usr/bin/env node
/**
 * Карта имён репозитория — печать.
 *
 * ```
 * node packages/baser-release/bin/release-names.mjs [--root <каталог>]
 * ```
 *
 * Печатает в stdout ДЖЕЙСОН: по каждому пакету монорепы — внутреннее имя,
 * публичное (`kb:MECH-15`), прежние, каталог и признак «наружу не едет».
 *
 * ПОЧЕМУ ПЕЧАТЬ, А НЕ ИМПОРТ. Конвейеру выпуска нужен ФАКТ, а не наш модуль:
 * связать шаг публикации с внутренним API зоны значило бы, что переименование
 * функции здесь ломает выпуск наружу. Джейсон в stdout читается чем угодно
 * (`jq`), переживает смену языка шага и не тянет установку пакетов —
 * зависимостей у инструмента нет и здесь тоже (`tests/run.spec.mjs`).
 *
 * Выход `0` — карта полна и напечатана; `1` — карта неполна или противоречива,
 * причина названа в stderr, а stdout ПУСТ: половина карты хуже её отсутствия,
 * потому что по ней доедут до `npm publish`. `2` — неверно позван.
 */

import { nameCard } from '../lib/repo.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : args[rootFlag + 1];

if (rootFlag !== -1 && !root) {
  console.error('release-names: у --root не назван каталог');
  process.exit(2);
}

let card;
try {
  card = nameCard(root);
} catch (error) {
  console.error(
    'КАРТА ИМЁН НЕ ОТДАНА: имя, под которым пакет уезжает наружу, неизвестно\n',
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(JSON.stringify(card, null, 2));
