/**
 * Мок-дерево для unit-тестов (готовый канон тестирования генераторов Nx:
 * `createTreeWithEmptyWorkspace` + предварительный засев существующих файлов —
 * иначе тест проверяет не тот сценарий).
 *
 * Декларация здесь СТРОИТСЯ, а не читается из дерева: движку её подаёт дверь
 * готовой структурой (`tasker:BASER2-23`). Манифеста фикстура сама не кладёт —
 * его пишет движок; засеять его можно `manifest`, когда тесту нужен переход из
 * УЖЕ материализованного состояния.
 *
 * Файл исключён из сборки пакета.
 */

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { SourceWarning } from '@omnifield/baser-contracts';
import type { Declaration, LayoutEntry } from './declaration.js';
import type { ManifestRecord } from './manifest.js';
import { MANIFEST_PATH, readManifest, serializeManifest } from './manifest.js';
import type { CanonSource } from './source.js';

export interface WorkspaceFixtureOptions {
  readonly layout: readonly LayoutEntry[];
  readonly contentRoot?: string;
  /** Идентичность обвеса; по умолчанию — типовая. */
  readonly sourceId?: string;
  /**
   * Версия обвеса; по умолчанию — типовая.
   *
   * Умолчание НЕ `undefined`: тест без явной версии проверял бы заодно и ветку
   * «источник версии не назвал», и `record.version: null` уезжал бы в снапшоты и
   * ожидания каждого соседнего теста как побочный факт. Отсутствие версии —
   * отдельный сценарий (`source-version.spec.ts`), и подаётся оно явным `null`.
   */
  readonly sourceVersion?: string | null;
  /** Файлы шаблонов: путь относительно `contentRoot` → содержимое. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Файлы, уже лежащие в репозитории потребителя. */
  readonly existing?: Readonly<Record<string, string>>;
  /** Служебная запись, уже лежащая в дереве (переход из материализованного). */
  readonly manifest?: readonly ManifestRecord[];
}

export interface WorkspaceFixture {
  readonly tree: Tree;
  readonly declaration: Declaration;
}

export const CONTENT_ROOT = 'node_modules/@omnifield/canon-kit/content';
export const SOURCE_ID = 'omnifield/canon-kit';
/** Версия обвеса по умолчанию — та, что ляжет в `record.version`. */
export const SOURCE_VERSION = '1.0.0';

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
  if (options.manifest !== undefined) {
    tree.write(
      MANIFEST_PATH,
      serializeManifest(
        new Map(options.manifest.map((record) => [record.dest, record])),
      ),
    );
  }

  return {
    tree,
    declaration: {
      source: {
        id: options.sourceId ?? SOURCE_ID,
        contentRoot,
        version:
          options.sourceVersion === undefined
            ? SOURCE_VERSION
            : options.sourceVersion,
      },
      layout: options.layout,
    },
  };
}

/**
 * Адрес поставки, забранной в кэш СНАРУЖИ локации (`tasker:BASER2-146`).
 *
 * Абсолютный, а не «просто другой каталог»: репо-относительным путём он
 * невыразим, и ровно это движок проверяет, принимая источник вне дерева.
 */
export const OUTSIDE_ROOT = '/var/cache/omnifield/canon-kit/1.0.0/content';

export interface OutsideWorkspaceFixture extends WorkspaceFixture {
  /** Порт содержимого — им дверь подаёт достанутую поставку. */
  readonly source: CanonSource;
}

/**
 * Дерево, чей источник лежит ЗАВЕДОМО СНАРУЖИ (`tasker:BASER2-150`).
 *
 * Шаблоны в дерево не засеваются вовсе — в этом весь сценарий: содержимое живёт
 * там, куда его положила доставка, и приезжает движку портом. Засеять их «на
 * всякий случай» значило бы проверять не тот случай: план сошёлся бы и через
 * дерево, и проба перестала бы отличать принятый внешний источник от источника,
 * незаметно прочитанного изнутри.
 */
export function createOutsideWorkspace(
  options: WorkspaceFixtureOptions & { readonly at?: string },
): OutsideWorkspaceFixture {
  const tree = createTreeWithEmptyWorkspace();
  const at = options.at ?? OUTSIDE_ROOT;
  const files = options.sources ?? {};

  for (const [path, content] of Object.entries(options.existing ?? {})) {
    tree.write(path, content);
  }
  if (options.manifest !== undefined) {
    tree.write(
      MANIFEST_PATH,
      serializeManifest(
        new Map(options.manifest.map((record) => [record.dest, record])),
      ),
    );
  }

  return {
    tree,
    source: createMapSource(files, at),
    declaration: {
      source: {
        id: options.sourceId ?? SOURCE_ID,
        contentRoot: { outside: at },
        version:
          options.sourceVersion === undefined
            ? SOURCE_VERSION
            : options.sourceVersion,
      },
      layout: options.layout,
    },
  };
}

/** Порт содержимого поверх карты «путь шаблона → текст». */
export function createMapSource(
  files: Readonly<Record<string, string>>,
  at: string,
): CanonSource {
  return {
    read: (src) => files[src] ?? null,
    describe: (src) => `${at}/${src}`,
  };
}

export interface SourceFixtureOptions {
  /** Идентичность обвеса — та же, что ляжет в `record.source`. */
  readonly id: string;
  /** Корень шаблонов этого обвеса; у каждого он свой. */
  readonly contentRoot: string;
  /** Версия обвеса — та же, что ляжет в `record.version`. */
  readonly version?: string | null;
  readonly layout: readonly LayoutEntry[];
  /** Файлы шаблонов: путь относительно `contentRoot` → содержимое. */
  readonly sources?: Readonly<Record<string, string>>;
}

/**
 * ЕЩЁ ОДИН обвес в ТОМ ЖЕ дереве.
 *
 * Несколько инструментов в одном репозитории — норма по построению
 * (`kb:BASER2-4`), а прогон идёт по одной декларации на обвес. Значит фикстуре
 * нужна операция «досадить инструмент в уже оснащённое дерево», а не второе
 * дерево: манифест у репозитория один, и вся суть проверки в том, как две
 * декларации делят его между собой.
 */
export function addSource(
  tree: Tree,
  options: SourceFixtureOptions,
): Declaration {
  for (const [path, content] of Object.entries(options.sources ?? {})) {
    tree.write(`${options.contentRoot}/${path}`, content);
  }

  return {
    source: {
      id: options.id,
      contentRoot: options.contentRoot,
      version: options.version === undefined ? SOURCE_VERSION : options.version,
    },
    layout: options.layout,
  };
}

/**
 * Тот же обвес, но версией выше — переход «подняли версию обвеса».
 *
 * Отдельной операцией, а не правкой объекта в тесте: подъём версии это ПЕРЕХОД,
 * и он такой же первоклассный инструмент фикстуры, как смена раскладки.
 */
export function reversion(
  declaration: Declaration,
  version: string | null,
): Declaration {
  return { ...declaration, source: { ...declaration.source, version } };
}

/**
 * Тот же обвес, которому есть что сказать про эту локацию, — и то же обратно.
 *
 * Отдельной операцией, как `reversion`: предупреждение это состояние ПРОГОНА, и
 * «обвес сказал» ↔ «обвесу нечего сказать» — переход, а не правка объекта в
 * тесте. Значение подаётся тем же, чем его отдаёт форма (`SourceWarning`):
 * второго написания у него нет.
 */
export function withWarning(
  declaration: Declaration,
  warning: SourceWarning | undefined,
): Declaration {
  const { source } = declaration;
  if (warning === undefined) {
    // Поля нет вовсе — ровно то, что подаёт дверь обвеса, который про
    // предупреждения не знает. Это не то же самое, что `undefined` в ключе:
    // сериализация в машинный ответ различает их молча.
    const { warning: _dropped, ...rest } = source;
    return { ...declaration, source: rest };
  }
  return { ...declaration, source: { ...source, warning } };
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

/** Разобранный манифест из дерева — то, что движок утверждает о владении. */
export function manifestOf(tree: Tree): readonly ManifestRecord[] {
  return [...readManifest(tree).values()];
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
