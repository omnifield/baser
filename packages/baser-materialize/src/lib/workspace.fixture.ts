/**
 * Мок-дерево для unit-тестов (канон тестирования генераторов, `kb:BASER-3`:
 * `createTreeWithEmptyWorkspace` + предварительный засев существующих файлов —
 * иначе тест проверяет не тот сценарий).
 *
 * Файл исключён из сборки пакета.
 */

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Declaration, FrameEntry } from './declaration.js';
import { readDeclaration } from './declaration.js';

export interface WorkspaceFixtureOptions {
  readonly frame: readonly FrameEntry[];
  readonly contentRoot?: string;
  /** Файлы канона: путь относительно `contentRoot` → содержимое. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Файлы, уже лежащие в репозитории потребителя. */
  readonly existing?: Readonly<Record<string, string>>;
}

export interface WorkspaceFixture {
  readonly tree: Tree;
  readonly declaration: Declaration;
}

export const CONTENT_ROOT = 'node_modules/@omnifield/canon-kit/content';

export function createWorkspace(
  options: WorkspaceFixtureOptions,
): WorkspaceFixture {
  const tree = createTreeWithEmptyWorkspace();
  const contentRoot = options.contentRoot ?? CONTENT_ROOT;

  tree.write(
    'package.json',
    `${JSON.stringify(
      {
        name: '@omnifield/consumer',
        version: '0.0.0',
        omnifield: {
          kind: 'plugin',
          target: 'repo',
          stack: 'node',
          contentRoot,
          frame: options.frame,
        },
      },
      null,
      2,
    )}\n`,
  );

  for (const [path, content] of Object.entries(options.sources ?? {})) {
    tree.write(`${contentRoot}/${path}`, content);
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) {
    tree.write(path, content);
  }

  return { tree, declaration: readDeclaration(tree) };
}

/**
 * Меняет объявленный `frame` продукта и перечитывает декларацию.
 *
 * Переходы объявления — обязательная часть приёмки (`kb:BASER-5`, «Контракт
 * проверяется ПЕРЕХОДАМИ, а не устойчивыми состояниями»), поэтому смена
 * декларации — такой же первоклассный инструмент фикстуры, как само дерево.
 */
export function redeclare(
  tree: Tree,
  frame: readonly FrameEntry[],
): Declaration {
  const manifest = JSON.parse(tree.read('package.json', 'utf-8') as string);
  manifest.omnifield.frame = frame;
  tree.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return readDeclaration(tree);
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
