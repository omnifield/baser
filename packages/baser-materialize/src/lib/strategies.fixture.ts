/**
 * ТЕСТОВЫЕ ДВОЙНИКИ стратегий — не реализации режимов.
 *
 * Настоящие `exact` · `merge` · `seed` живут в зоне `@omnifield/baser-modes`
 * (`tasker:BASER-20`, границы). Здесь — минимальные двойники по одному на класс
 * владения: они нужны, чтобы проверить ИНВАРИАНТЫ ДВИЖКА (план, идемпотентность,
 * атомарность, сироты, конфликт), не завися от чужой зоны.
 *
 * Файл исключён из сборки пакета (`tsconfig.lib.json`) и не экспортируется.
 */

import type { MaterializationStrategy } from './strategy.js';

/** Класс `engine`: движок владеет файлом единолично, тело = канон. */
export const engineDouble: MaterializationStrategy = {
  mode: 'exact',
  ownership: 'engine',
  decide: ({ source }) => ({ kind: 'write', content: source }),
};

/**
 * Класс `shared`: канон и продукт вносят вклад оба.
 * Двойник детерминирован и идемпотентен: строки продукта сохраняются, строки
 * канона дописываются, если их нет. Настоящий трёхсторонний мердж — не здесь.
 */
export const sharedDouble: MaterializationStrategy = {
  mode: 'merge',
  ownership: 'shared',
  decide: ({ source, current }) => {
    if (current === null) {
      return { kind: 'write', content: source };
    }
    const lines = current.split('\n');
    const missing = source.split('\n').filter((line) => !lines.includes(line));
    return {
      kind: 'write',
      content:
        missing.length === 0 ? current : [...lines, ...missing].join('\n'),
    };
  },
};

/** Класс `product`: одноразовый скаффолд, существующий файл не трогаем. */
export const productDouble: MaterializationStrategy = {
  mode: 'seed',
  ownership: 'product',
  decide: ({ source, current }) =>
    current === null
      ? { kind: 'write', content: source }
      : { kind: 'keep', reason: 'seeded' },
};

/**
 * НЕБРЕЖНЫЙ двойник класса `product`: возвращает запись всегда, в том числе на
 * существующий файл продукта.
 *
 * Нужен, чтобы проверять инвариант ДВИЖКА, а не добросовестность режима
 * (`kb:BASER-5`, «Что движок обязан защищать сам»): стратегии приходят из чужой
 * зоны и пишутся разными сессиями, поэтому проверять корректным двойником —
 * значит не проверять вовсе. Это тест на злоупотребление швом.
 */
export const carelessProductDouble: MaterializationStrategy = {
  mode: 'seed',
  ownership: 'product',
  decide: ({ source }) => ({ kind: 'write', content: `${source}затёрто\n` }),
};

/** Небрежный `product` вместо корректного — остальные двойники прежние. */
export const CARELESS_DOUBLES = [
  engineDouble,
  sharedDouble,
  carelessProductDouble,
];

/** Двойник, который всегда отказывает — проверка отказа на уровне режима. */
export const refusingDouble: MaterializationStrategy = {
  mode: 'exact',
  ownership: 'engine',
  decide: () => ({ kind: 'conflict', reason: 'двойник отказывает намеренно' }),
};

export const ALL_DOUBLES = [engineDouble, sharedDouble, productDouble];
