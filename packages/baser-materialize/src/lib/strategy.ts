/**
 * ШОВ С ЗОНОЙ РЕЖИМОВ (`@omnifield/baser-modes`).
 *
 * Здесь объявлена форма стратегии материализации; РЕАЛИЗАЦИИ режимов
 * (`exact` · `merge` · `seed`) живут в соседней зоне и в этом пакете
 * отсутствуют намеренно.
 *
 * Разделение ответственности — не вкусовое, оно защищает инварианты контракта
 * (`kb:BASER-5`):
 *   - ДВИЖОК держит инварианты: две фазы, отказ вместо тихой перезаписи,
 *     снятие сирот, идемпотентность, атомарность;
 *   - СТРАТЕГИЯ отвечает на один вопрос: «каким должно быть содержимое `dest`
 *     при таком источнике и таком текущем состоянии».
 * Стратегия не пишет в дерево и не может обойти проверку владения: она
 * возвращает РЕШЕНИЕ, а применяет его движок.
 *
 * Форма опубликована — менять её после публикации можно только через
 * architect (это контракт между двумя зонами, `kb:BASER-4`).
 */

import type {
  Declaration,
  FrameEntry,
  MaterializeMode,
} from './declaration.js';
import type { OwnershipClass, OwnershipRecord } from './ownership.js';
import { StrategyRegistryError } from './errors.js';

/** Вход стратегии: всё, что нужно для решения, и ничего сверх того. */
export interface StrategyInput {
  /** Запись декларации, которую материализуем. */
  readonly entry: FrameEntry;
  /** Декларация целиком — контекст (`contentRoot`, `kind`, …), только чтение. */
  readonly declaration: Declaration;
  /** Содержимое источника канона. */
  readonly source: string;
  /**
   * Текущее содержимое `dest` без маркера владения (`null` — файла нет).
   * Маркер снят движком, чтобы стратегия сравнивала тела, а не служебные строки.
   */
  readonly current: string | null;
  /** База трёхстороннего мерджа (`null` — базы нет, см. `CanonBaseline`). */
  readonly baseline: string | null;
  /** Артефакт уже помечен как материализованный этим движком. */
  readonly owned: boolean;
  /** Запись о владении из артефакта (`null` — маркера нет). */
  readonly record: OwnershipRecord | null;
}

/** Решение стратегии. Побочек нет — только данные. */
export type StrategyDecision =
  /** Материализовать это содержимое (маркер владения поставит движок). */
  | { readonly kind: 'write'; readonly content: string }
  /** Ничего не делать: состояние уже целевое (напр. `seed` на существующем). */
  | { readonly kind: 'keep'; readonly reason?: string }
  /** Отказ на уровне режима — попадёт в план как конфликт, а не как шаг. */
  | { readonly kind: 'conflict'; readonly reason: string };

/**
 * Стратегия одного режима.
 *
 * `ownership` объявляет, кто владеет `dest` при этом режиме, и именно по нему
 * движок решает, можно ли трогать существующий файл:
 *   - `engine`  — движок владеет файлом единолично (прототип: `exact`);
 *   - `shared`  — вклад вносят и канон, и продукт (прототип: `merge`);
 *   - `product` — после материализации владеет продукт (прототип: `seed`).
 */
export interface MaterializationStrategy {
  readonly mode: MaterializeMode;
  readonly ownership: OwnershipClass;
  decide(input: StrategyInput): StrategyDecision;
}

/** Реестр стратегий: режим декларации → стратегия. */
export interface StrategyRegistry {
  get(mode: MaterializeMode): MaterializationStrategy | undefined;
  readonly modes: readonly MaterializeMode[];
}

/** Собирает реестр; дубль режима — ошибка сборки, а не «последний победил». */
export function createStrategyRegistry(
  strategies: Iterable<MaterializationStrategy>,
): StrategyRegistry {
  const byMode = new Map<MaterializeMode, MaterializationStrategy>();

  for (const strategy of strategies) {
    if (byMode.has(strategy.mode)) {
      throw new StrategyRegistryError(
        `режим "${strategy.mode}" зарегистрирован дважды — у режима может быть только одна стратегия`,
      );
    }
    byMode.set(strategy.mode, strategy);
  }

  return {
    get: (mode) => byMode.get(mode),
    get modes() {
      return [...byMode.keys()];
    },
  };
}

export function toStrategyRegistry(
  strategies: StrategyRegistry | Iterable<MaterializationStrategy>,
): StrategyRegistry {
  return isRegistry(strategies)
    ? strategies
    : createStrategyRegistry(strategies);
}

function isRegistry(
  value: StrategyRegistry | Iterable<MaterializationStrategy>,
): value is StrategyRegistry {
  return typeof (value as StrategyRegistry).get === 'function';
}
