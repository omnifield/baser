/**
 * МАГАЗИН ПРОБ ЖИВЁТ В СВОЁМ МЕСТЕ — ВСЕГДА, А НЕ КОГДА ПРОБА ВСПОМНИЛА.
 *
 * Дефолтное место магазина — `~/.local/share/baser-registry`, то есть настоящий
 * домашний каталог человека, который гоняет пробы. Проба, забывшая назвать своё
 * место, поднимает раздачу ТАМ и оставляет после себя чужой склад с пробными
 * пакетами.
 *
 * Это не гипотеза: ровно так и вышло при переезде магазина на уровень локации
 * (`tasker:BASER2-254`) — два процесса остались висеть на дефолтном месте, а в
 * домашнем каталоге лёг склад с `publish-plain` и `registry-acceptance` внутри.
 * Поймано глазами при уборке, а не пробой.
 *
 * Поэтому изоляция стоит здесь, СНАРУЖИ всех проб: место магазина переводится
 * на временный каталог один раз на прогон. Проба, которая называет своё место
 * явно, работает как работала; проба, которая забыла, — попадает во временное,
 * а не в дом человека. Конструкция вместо дисциплины: шаг, который нельзя
 * забыть позвать, дешевле правила, которое можно не прочитать.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME_VARIABLE } from './location.js';

let home: string | null = null;
let previous: string | undefined;

export function setup(): void {
  home = mkdtempSync(join(tmpdir(), 'baser-registry-suite-home-'));
  previous = process.env[HOME_VARIABLE];
  process.env[HOME_VARIABLE] = home;
}

export function teardown(): void {
  if (previous === undefined) delete process.env[HOME_VARIABLE];
  else process.env[HOME_VARIABLE] = previous;

  if (home !== null) rmSync(home, { recursive: true, force: true });
  home = null;
}
