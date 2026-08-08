import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateBuilding } from './locate.js';

describe('корень ПОСТРОЙКИ ищется вверх, а не берётся из каталога вызова', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'baser-registry-locate-'));
    mkdirSync(join(root, 'глубоко', 'внутри'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('постройка — это клон, и её граница проходит по .git', () => {
    // Команда ставится глобально и зовётся откуда угодно. Считать постройкой
    // текущий каталог значило бы называть в ответе не то место.
    mkdirSync(join(root, '.git'));

    expect(locateBuilding(join(root, 'глубоко', 'внутри'))).toEqual({
      root,
      origin: 'git',
    });
  });

  it('вложенный клон — своя постройка: границу задаёт ближайший .git', () => {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'глубоко', '.git'), { recursive: true });

    expect(locateBuilding(join(root, 'глубоко', 'внутри')).root).toBe(
      join(root, 'глубоко'),
    );
  });

  it('без git — законное состояние: публиковать можно и из простой папки', () => {
    const where = join(root, 'глубоко', 'внутри');

    const located = locateBuilding(where);

    expect(located.origin === 'cwd' || located.origin === 'git').toBe(true);
    expect(where.startsWith(located.root)).toBe(true);
  });
});
