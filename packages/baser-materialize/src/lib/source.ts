/**
 * Источник канона — откуда движок берёт содержимое `frame[].src`.
 *
 * Носитель канона — опубликованный версионированный пакет, который продукт
 * опт-инит (`kb:BASER-3`), поэтому по умолчанию источник читается из того же
 * виртуального дерева (в реальном прогоне это распакованный пакет внутри
 * рабочего дерева). Порт оставлен открытым: подмена источника — дело раннера,
 * а не движка.
 */

import type { Tree } from '@nx/devkit';
import { joinRepoPath } from './paths.js';

export interface CanonSource {
  /** Содержимое `src` относительно `contentRoot`; `null` — источника нет. */
  read(src: string): string | null;
  /** Адрес источника для сообщений (план обязан быть читаемым). */
  describe(src: string): string;
}

/** Источник поверх виртуального дерева — дефолт движка. */
export function createTreeSource(tree: Tree, contentRoot: string): CanonSource {
  return {
    read(src) {
      return tree.read(joinRepoPath(contentRoot, src), 'utf-8');
    },
    describe(src) {
      return joinRepoPath(contentRoot, src);
    },
  };
}

/**
 * База трёхстороннего мерджа — «прошлая версия канона» из контракта
 * (`kb:BASER-5`, режим `merge`).
 *
 * Движок базу НЕ хранит и не выдумывает, где она лежит: у рынка это состояние
 * инстанса (`.cruft.json` с ревизией шаблона), у нас место хранения ещё не
 * решено на уровне контракта. Порт объявлен, дефолт — «базы нет»; стратегия
 * merge обязана уметь этот случай (и решить его в своей зоне или эскалировать).
 */
export interface CanonBaseline {
  read(src: string): string | null;
}

/** Базы нет — дефолт движка. */
export const EMPTY_BASELINE: CanonBaseline = {
  read: () => null,
};
