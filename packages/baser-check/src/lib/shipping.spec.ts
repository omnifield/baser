/**
 * СОСТАВ ПОСТАВКИ разбирается ровно настолько, насколько обещано.
 *
 * Здесь проверяется и то, что разбор понимает (имя, путь, каталог с
 * поддеревом, подстановки), и то, что он ЧЕСТНО не берётся судить: отрицание в
 * `files` обязано давать `undecidable`, а не тихое «годен».
 */

import { describe, expect, it } from 'vitest';

import { readShippingList, shipsPath, type ShippingList } from './shipping.js';

const declared = (files: unknown): ShippingList =>
  readShippingList({ name: 'x', files });

const ships = (files: string[], path: string): boolean => {
  const list = declared(files);
  if (list.kind !== 'declared') {
    throw new Error(`ожидался разобранный список, получен ${list.kind}`);
  }
  return shipsPath(list, path);
};

describe('что разбор понимает', () => {
  it('каталог увозит своё поддерево целиком', () => {
    expect(ships(['template'], 'template/devcontainer.json.ejs')).toBe(true);
    expect(ships(['template'], 'template/nested/deep.json')).toBe(true);
  });

  it('файл увозит сам себя', () => {
    expect(ships(['defaults.mjs'], 'defaults.mjs')).toBe(true);
    expect(ships(['defaults.mjs'], 'other.mjs')).toBe(false);
  });

  it('образец без "/" совпадает на любой глубине — как в .gitignore', () => {
    expect(ships(['dist'], 'dist/lib/index.js')).toBe(true);
    expect(ships(['defaults.mjs'], 'lib/defaults.mjs')).toBe(true);
  });

  it('образец с "/" привязан к корню пакета', () => {
    expect(
      ships(
        ['template/devcontainer.json.ejs'],
        'template/devcontainer.json.ejs',
      ),
    ).toBe(true);
    expect(ships(['template/a.json'], 'nested/template/a.json')).toBe(false);
  });

  it('"*" не переходит через "/", "**" переходит', () => {
    expect(ships(['template/*.json'], 'template/lock.json')).toBe(true);
    expect(ships(['template/*.json'], 'template/deep/lock.json')).toBe(false);
    expect(ships(['template/**/*.json'], 'template/deep/lock.json')).toBe(true);
  });

  it('"./a/" и "a" — один и тот же образец', () => {
    expect(ships(['./template/'], 'template/x.json')).toBe(true);
  });

  it('точка в образце не считается любым символом', () => {
    expect(ships(['defaults.mjs'], 'defaultsXmjs')).toBe(false);
  });

  it('пустой files не увозит ничего — и это не повод молчать', () => {
    expect(ships([], 'template/x.json')).toBe(false);
  });

  it('точка входа уезжает независимо от files — так делает npm', () => {
    const list = readShippingList({
      name: 'x',
      files: ['dist'],
      main: './lib/index.js',
    });
    if (list.kind !== 'declared') {
      throw new Error('ожидался разобранный список');
    }
    expect(shipsPath(list, 'lib/index.js')).toBe(true);
  });
});

describe('чего разбор не судит — и говорит об этом', () => {
  it('files не объявлен', () => {
    expect(readShippingList({ name: 'x' })).toEqual({ kind: 'not-declared' });
  });

  it('отрицание вычитает состав — решает npm, а не мы', () => {
    const list = declared(['dist', '!dist/*.map']);

    expect(list.kind).toBe('undecidable');
    expect(list.kind === 'undecidable' && list.reason).toContain('отрицание');
  });

  it('класс и группа в образце', () => {
    expect(declared(['dist/[abc].js']).kind).toBe('undecidable');
    expect(declared(['dist/{a,b}.js']).kind).toBe('undecidable');
  });

  it('files не массив или не строки внутри', () => {
    expect(declared('dist').kind).toBe('undecidable');
    expect(declared([42]).kind).toBe('undecidable');
  });
});
