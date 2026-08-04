import { describe, expect, it } from 'vitest';

import { baseOf, compare, isPrerelease, parse } from './version.mjs';

/** Знак сравнения в читаемом виде — чтобы падение пробы называло пару, а не число. */
function sign(a, b) {
  const result = compare(parse(a), parse(b));
  return result < 0 ? '<' : result > 0 ? '>' : '==';
}

describe('форма номера', () => {
  it.each([
    '0.0.4',
    '0.1.0',
    '1.0.0',
    '0.3.0-dev.1',
    '1.0.0-alpha.beta',
    '1.0.0-rc.1+build.5',
  ])('разбирает %s', (version) => {
    expect(parse(version)).not.toBeNull();
  });

  // Номер, который не признаёт менеджер, не должен признавать и гейт: иначе
  // «зелёный гейт» окажется обещанием выпуска, который не опубликуется.
  it.each([
    ['', 'пусто'],
    ['1.2', 'тройки нет'],
    ['1.2.3.4', 'четвёрка — не номер'],
    ['01.2.3', 'ведущий ноль запрещён спецификацией (§2)'],
    ['1.2.3-', 'пустая предвыпускная часть'],
    ['1.2.3-dev.01', 'ведущий ноль в числовом идентификаторе (§9)'],
    ['v1.2.3', 'префикс v — форма тега чужих экосистем, у нас её нет'],
    ['dev', 'не номер вовсе'],
  ])('отвергает %s (%s)', (version) => {
    expect(parse(version)).toBeNull();
  });

  it('видит предвыпускной номер и называет его базу', () => {
    const version = parse('0.3.0-dev.1');
    expect(isPrerelease(version)).toBe(true);
    expect(baseOf(version)).toBe('0.3.0');
    expect(isPrerelease(parse('0.3.0'))).toBe(false);
  });
});

describe('старшинство — совпадает с менеджером пакетов', () => {
  // Цепочка приведена в спецификации дословно (semver.org §11) — если наше
  // сравнение разойдётся с ней, разойдётся и с node-semver.
  const CHAIN = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];

  it('воспроизводит цепочку из спецификации целиком', () => {
    const shuffled = [...CHAIN].reverse();
    const sorted = shuffled
      .map(parse)
      .sort(compare)
      .map((version) => version.raw);
    expect(sorted).toEqual(CHAIN);
  });

  // Таблица снята с живого node-semver@7.8.5 прогоном 2026-08-04. Она стоит
  // здесь не для красоты: разойдись мы с менеджером — прогон обязан упасть у
  // нас, а не выпуск у потребителя.
  it.each([
    ['0.3.0-dev.1', '>', '0.2.0'],
    ['0.3.0-dev.1', '<', '0.3.0'],
    ['0.3.0-dev.1', '<', '0.3.0-dev.2'],
    ['0.3.0-dev.10', '>', '0.3.0-dev.9'],
    ['0.3.0-dev.1', '==', '0.3.0-dev.1'],
    ['1.0.0+build', '==', '1.0.0'],
    ['0.2.0', '<', '0.10.0'],
    ['1.0.0', '>', '0.99.99'],
  ])('%s %s %s', (a, expected, b) => {
    expect(sign(a, b)).toBe(expected);
    expect(sign(b, a)).toBe(
      expected === '==' ? '==' : expected === '<' ? '>' : '<',
    );
  });

  it('метаданные сборки в старшинстве не участвуют (§10)', () => {
    expect(sign('1.0.0+a', '1.0.0+b')).toBe('==');
    expect(sign('1.0.0-dev.1+a', '1.0.0-dev.1+b')).toBe('==');
  });
});
