/**
 * ДВИЖОК НЕ ЗНАЕТ НИ ОДНОГО КОНКРЕТНОГО ОБВЕСА — и это держит проба, а не дисциплина.
 *
 * Причина названа в `kb:BASER3-34`: у baser ДВЕ ШЛЯПЫ. Он и механизм (движок,
 * консоль, форма объявления), и автор некоторых обвесов — девбокс наш пакет.
 * Автору удобно «чуть-чуть» научить движок про свой же случай: один частный
 * случай, одно исключение, одно имя в коде. После этого механизм перестаёт быть
 * общим, а замечает это только ЧУЖОЙ продукт и сильно позже.
 *
 * Сегодня движок чист — замер `kb:BASER3-34` от 2026-08-06 и повторный замер
 * этой задачи дают ноль. Поэтому проба ставится СЕЙЧАС, пока чинить нечего:
 * она стоит дёшево ровно до первого исключения и дорого — после.
 *
 * ## Судится КОД, а не упоминание
 *
 * Запрет на упоминание запретил бы зоне объяснять саму себя: разбор классов
 * артефакта ссылается на узел знаний соседнего продукта (`kb:WEBER-4`), и это
 * объяснение — то, что удерживает решение. Ровно та же граница уже проведена у
 * соседней пробы поставки (`tree-port.spec.ts`): там судится форма импорта, а не
 * имя в комментарии.
 *
 * Поэтому проба снимает блочные комментарии и комментарии-строки, а ищет в том,
 * что осталось. Комментарий в конце строки с кодом НЕ снимается — ошибаться эта
 * проба обязана в сторону красного, а не зелёного.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LIB = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Слова, которых в коде движка быть не должно.
 *
 * Это имена конкретных обвесов и их посадочных мест — то, про что знает только
 * сам обвес. Движку известны лишь форма объявления и посадочное место
 * (`kb:BASER3-34`).
 */
const FORBIDDEN = [
  'devbox',
  'harness',
  'brainer',
  '.devcontainer',
  '.claude',
];

/**
 * Пакет, который зоне знать ПОЛОЖЕНО, — форма объявления.
 *
 * Единственное исключение, и оно названо: contracts это не обвес, а хвостовик,
 * против которого программируют все зоны. Всякое другое имя пакета `@omnifield/`
 * в коде движка означало бы знание про конкретную поставку.
 */
const ALLOWED_PACKAGE = '@omnifield/baser-contracts';

/** Файлы поставки: пробы и фикстуры в неё не уезжают и под правило не подпадают. */
function shippedSources(): readonly string[] {
  return readdirSync(LIB)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'));
}

/**
 * Код без объяснений.
 *
 * Снимаются блочные комментарии и строки, начинающиеся с `//`. Строку кода с
 * хвостовым комментарием проба оставляет целиком: разобрать её честно можно
 * только разбором языка, а ошибка в эту сторону красит пробу, а не зеленит.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

describe('движок не знает про конкретные обвесы', () => {
  const files = shippedSources();

  it('поставка зоны состоит не из одних проб', () => {
    // Иначе перечень мог бы опустеть от переименования, и проба зеленела бы,
    // ничего не проверив.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s не называет ни одного обвеса', (name) => {
    const code = codeOf(readFileSync(join(LIB, name), 'utf-8')).toLowerCase();

    for (const word of FORBIDDEN) {
      expect(code).not.toContain(word);
    }
  });

  it('поставка зоны не зависит ни от одного обвеса', () => {
    // Знание про обвес приезжает не только строкой в коде: зависимость на его
    // пакет — то же знание, только в манифесте. Соседняя проба судит код, эта —
    // состав поставки, и без неё обвес заехал бы в движок мимо неё.
    const manifest = JSON.parse(
      readFileSync(resolve(LIB, '../../package.json'), 'utf-8'),
    ) as Record<string, Readonly<Record<string, string>> | undefined>;

    const shipped = [
      ...Object.keys(manifest['dependencies'] ?? {}),
      ...Object.keys(manifest['peerDependencies'] ?? {}),
      ...Object.keys(manifest['optionalDependencies'] ?? {}),
    ];

    expect(shipped.filter((name) => name.startsWith('@omnifield/'))).toEqual([
      ALLOWED_PACKAGE,
    ]);
  });

  it.each(files)('%s не называет чужих пакетов', (name) => {
    const code = codeOf(readFileSync(join(LIB, name), 'utf-8'));
    const named = code.match(/@omnifield\/[a-z0-9-]+/g) ?? [];

    expect([...new Set(named)].filter((item) => item !== ALLOWED_PACKAGE)).toEqual(
      [],
    );
  });
});
