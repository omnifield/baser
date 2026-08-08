import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHOP_DIRECTORY } from './layout.js';
import { locateRoot } from './locate.js';

describe('корень локации ищется вверх, а не берётся из каталога вызова', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'baser-registry-locate-'));
    mkdirSync(join(root, 'глубоко', 'внутри'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('заведённый магазин — сильнейший признак, и он находится из подкаталога', () => {
    // Тот самый случай, ради которого файл существует: без поиска вверх `up`
    // из подкаталога завёл бы ВТОРОЙ магазин со своим складом.
    mkdirSync(join(root, SHOP_DIRECTORY));

    expect(locateRoot(join(root, 'глубоко', 'внутри'))).toEqual({
      root,
      origin: 'shop',
    });
  });

  it('магазина нет — корнем становится граница локации', () => {
    mkdirSync(join(root, '.git'));

    expect(locateRoot(join(root, 'глубоко'))).toEqual({ root, origin: 'git' });
  });

  it('магазин выше подрепозитория не проигрывает его .git', () => {
    // Порядок признаков соблюдается, а не «что ближе»: склад локации один, и
    // вложенный репозиторий не заводит себе второй.
    mkdirSync(join(root, SHOP_DIRECTORY));
    mkdirSync(join(root, 'глубоко', '.git'), { recursive: true });

    expect(locateRoot(join(root, 'глубоко', 'внутри'))).toEqual({
      root,
      origin: 'shop',
    });
  });

  it('ни магазина, ни git — законное состояние, корень остаётся каталогом вызова', () => {
    const where = join(root, 'глубоко', 'внутри');

    // В корень временного каталога никто не клал ни .git, ни магазина, но выше
    // по дереву они теоретически возможны — поэтому проверяется origin, а не
    // сам путь: утверждение здесь про то, что находка не выдумывается.
    const located = locateRoot(where);

    expect(located.origin === 'cwd' || located.origin === 'git').toBe(true);
    expect(where.startsWith(located.root)).toBe(true);
  });
});
