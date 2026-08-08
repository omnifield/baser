import { describe, expect, it } from 'vitest';
import { renderText } from './render.js';
import { exitCodeOf } from './result.js';
import { sampleResult } from './result.fixture.js';

describe('текст рисуется поверх данных и ничего не добавляет от себя', () => {
  it('называет состояние, адрес, товар и апстрим', () => {
    const text = renderText(sampleResult());

    expect(text).toContain('раздача локации работает');
    expect(text).toContain('http://127.0.0.1:4873');
    expect(text).toContain('3 пакета');
    expect(text).toContain('https://registry.npmjs.org/');
  });

  it('рецепт конфига печатается и на закрытом магазине', () => {
    // Условие здесь однажды соврало: текст про конфликт скоупа ссылался на
    // строки «выше», которых при закрытом магазине не печаталось. Строки
    // зависят от адреса, а не от того, отвечает ли раздача сейчас.
    const text = renderText(
      sampleResult({ state: 'closed', outcome: 'already-closed' }),
    );

    expect(text).toContain('registry=http://127.0.0.1:4873');
    expect(text).toContain('_authToken=');
  });

  it('строки рецепта берутся из ответа, а не сочиняются рендером', () => {
    const text = renderText(
      sampleResult({ access: { npmrc: ['выдуманная=строка'] } }),
    );

    expect(text).toContain('выдуманная=строка');
    expect(text).not.toContain('_authToken=');
  });

  it('протухшая заявка названа вместе с тем, что делать', () => {
    // Ровно состояние после перезапуска контейнера: раздачи нет, товар есть.
    const text = renderText(
      sampleResult({
        state: 'closed',
        outcome: 'reported',
        shop: { ...sampleResult().shop, claimed: true, pid: null },
      }),
    );

    expect(text).toContain('не пережил');
    expect(text).toContain('baser-registry up');
  });

  it('постройка видит, что раздачу подняла НЕ она', () => {
    // Пункт, ради которого чинились уровни: «магазин работает» — правда для
    // всей локации, но постройка, которая его не поднимала, обязана видеть
    // разницу, иначе принимает общую раздачу за свою.
    const text = renderText(
      sampleResult({
        building: { ...sampleResult().building, startedShop: false },
      }),
    );

    expect(text).toContain('не эта постройка');
    expect(text).toContain('Это не конфликт');
  });

  it('чужой скоуп назван вместе с адресом, куда он уводит', () => {
    const text = renderText(
      sampleResult({
        scopeConflicts: [
          { scope: '@чужой', registry: 'https://npm.pkg.github.com' },
        ],
      }),
    );

    expect(text).toContain('@чужой');
    expect(text).toContain('https://npm.pkg.github.com');
  });

  it('отказы печатаются кодом и адресом, а не одной прозой', () => {
    const text = renderText(
      sampleResult({
        outcome: 'refused',
        problems: [
          { code: 'address-busy', at: 'http://127.0.0.1:4873', message: 'занят' },
        ],
      }),
    );

    expect(text).toContain('[address-busy]');
    expect(text).toContain('http://127.0.0.1:4873');
  });

  it('число товара склоняется по-русски', () => {
    const at = (packages: number) =>
      renderText(sampleResult({ stock: { ...sampleResult().stock, packages } }));

    expect(at(1)).toContain('1 пакет ');
    expect(at(2)).toContain('2 пакета');
    expect(at(5)).toContain('5 пакетов');
    expect(at(11)).toContain('11 пакетов');
    expect(at(21)).toContain('21 пакет ');
  });
});

describe('код возврата — производная исхода, а не отдельный признак', () => {
  it('сделанное и «делать нечего» одинаково нулевые', () => {
    for (const outcome of [
      'started',
      'already-running',
      'stopped',
      'already-closed',
      'reported',
    ] as const) {
      expect(exitCodeOf(sampleResult({ outcome }))).toBe(0);
    }
  });

  it('не вышло изменить состояние — 1, непригодный вход — 2', () => {
    expect(exitCodeOf(sampleResult({ outcome: 'failed' }))).toBe(1);
    expect(exitCodeOf(sampleResult({ outcome: 'refused' }))).toBe(2);
  });
});
