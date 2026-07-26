/**
 * Мок-дерево для unit-тестов (канон тестирования генераторов, `kb:BASER-3`:
 * `createTreeWithEmptyWorkspace` + предварительный засев существующих файлов —
 * иначе тест проверяет не тот сценарий).
 *
 * Декларация здесь СТРОИТСЯ, а не читается из дерева: движку её подаёт дверь
 * готовой структурой (`tasker:BASER2-23`). Манифеста в фикстуре нет намеренно —
 * тест, кладущий `package.json` ради движка, врал бы про то, что движку нужно.
 *
 * Файл исключён из сборки пакета.
 */

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Declaration, LayoutEntry } from './declaration.js';

export interface WorkspaceFixtureOptions {
  readonly layout: readonly LayoutEntry[];
  readonly contentRoot?: string;
  /** Идентичность обвеса; по умолчанию — типовая. */
  readonly sourceId?: string;
  /** Файлы шаблонов: путь относительно `contentRoot` → содержимое. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Файлы, уже лежащие в репозитории потребителя. */
  readonly existing?: Readonly<Record<string, string>>;
}

export interface WorkspaceFixture {
  readonly tree: Tree;
  readonly declaration: Declaration;
}

export const CONTENT_ROOT = 'node_modules/@omnifield/canon-kit/content';
export const SOURCE_ID = 'omnifield/canon-kit';

export function createWorkspace(
  options: WorkspaceFixtureOptions,
): WorkspaceFixture {
  const tree = createTreeWithEmptyWorkspace();
  const contentRoot = options.contentRoot ?? CONTENT_ROOT;

  for (const [path, content] of Object.entries(options.sources ?? {})) {
    tree.write(`${contentRoot}/${path}`, content);
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) {
    tree.write(path, content);
  }

  return {
    tree,
    declaration: {
      source: { id: options.sourceId ?? SOURCE_ID, contentRoot },
      layout: options.layout,
    },
  };
}

/**
 * Новая декларация с другой раскладкой — переход объявления.
 *
 * Переходы объявления обязательная часть приёмки («контракт проверяется
 * ПЕРЕХОДАМИ, а не устойчивыми состояниями»), поэтому смена декларации — такой
 * же первоклассный инструмент фикстуры, как само дерево. Раньше она правила
 * манифест в дереве; теперь просто отдаёт новую структуру — ровно то, что
 * сделает дверь.
 */
export function redeclare(
  declaration: Declaration,
  layout: readonly LayoutEntry[],
): Declaration {
  return { ...declaration, layout };
}

/** Обёртка дерева, роняющая N-ю запись, — для проверки атомарности. */
export function treeFailingOnWrite(tree: Tree, failAtCall: number): Tree {
  let calls = 0;
  return new Proxy(tree, {
    get(target, property, receiver) {
      if (property === 'write') {
        return (path: string, content: string): void => {
          calls += 1;
          if (calls === failAtCall) {
            throw new Error(`искусственный сбой записи на "${path}"`);
          }
          target.write(path, content);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Снимок всех файлов дерева вне служебных каталогов — для сверки «до/после». */
export function snapshotTree(tree: Tree, root = ''): Record<string, string> {
  const files: Record<string, string> = {};
  const queue = [root];

  while (queue.length > 0) {
    const dir = queue.pop() as string;
    for (const child of tree.children(dir)) {
      const path = dir === '' ? child : `${dir}/${child}`;
      if (tree.isFile(path)) {
        files[path] = tree.read(path, 'utf-8') ?? '';
      } else {
        queue.push(path);
      }
    }
  }

  return files;
}
