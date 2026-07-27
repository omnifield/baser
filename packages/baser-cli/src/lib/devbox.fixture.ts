/**
 * ЧИСТОЕ ДЕРЕВО С ПОСТАВЛЕННЫМ ОБВЕСОМ.
 *
 * Приёмка двери — не мок. Дверь берёт обвес с реальной ФС, грузит его резолверы
 * как настоящие модули и кладёт файлы на настоящий диск; фикстура, подменившая
 * хоть одно из трёх, проверяла бы не дверь.
 *
 * Поэтому здесь именно УСТАНОВКА: обвес девбокса раскладывается в
 * `node_modules/@omnifield/baser-devbox` временного репозитория ровно так, как
 * его положил бы npm, — манифест, резолверы, каталог шаблонов. Берётся он из
 * принятого примера зоны контрактов (`examples/devbox`), а не переписывается
 * заново: две копии одного обвеса разъехались бы, и приёмка двери начала бы
 * зеленеть на обвесе, которого нет ни у кого.
 *
 * Отсюда же и главный инструмент фикстуры — `updateSource`. Контракт проверяется
 * ПЕРЕХОДАМИ, а не устойчивыми состояниями (`packages/baser-materialize`,
 * `transitions.spec.ts`), а центральный переход у двери один: обвес обновился.
 *
 * Файл исключён из сборки пакета.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tree } from '@nx/devkit';
import {
  MANIFEST_PATH,
  readManifest,
  type ManifestRecord,
} from '@omnifield/baser-materialize';

const here = dirname(fileURLToPath(import.meta.url));

/** Корень ЭТОГО репозитория — из него берётся живой `.devcontainer`. */
export const REPO_ROOT = resolve(here, '../../../..');

/** Принятый обвес девбокса — общий с пробой формы зоны контрактов. */
const DEVBOX_EXAMPLE = join(
  REPO_ROOT,
  'packages/baser-contracts/examples/devbox',
);

export const DEVBOX_PACKAGE = '@omnifield/baser-devbox';

/** Репозиторий потребителя с поставленным обвесом. */
export interface Consumer {
  /** Корень репозитория — он же корень дерева движка. */
  readonly root: string;
  /** Корень распакованного пакета обвеса. */
  readonly sourceRoot: string;
  read(path: string): string | null;
  exists(path: string): boolean;
  write(path: string, content: string): void;
  remove(path: string): void;
  /** Правит объявление обвеса — переход «обвес обновился». */
  updateSource(
    patch: (block: DeclarationBlock) => void,
    version?: string,
  ): void;
  /** Подменяет резолверы обвеса — движение ВЫЧИСЛЯЕМОГО дефолта. */
  updateResolvers(source: string): void;
  /** Кладёт файл в каталог шаблонов обвеса. */
  writeTemplate(name: string, content: string): void;
  cleanup(): void;
}

/** Блок `baser` манифеста обвеса — как есть, без типизации формы. */
export type DeclarationBlock = Record<string, unknown>;

export interface InstallOptions {
  /**
   * Имя каталога репозитория. Из него растут имена, которые считает резолвер
   * обвеса (`<репозиторий>-devbox`), поэтому оно значимо, а не косметика.
   */
  readonly repoName?: string;
  /** Конфиг потребителя. Не передан — файла нет, и дверь его родит сама. */
  readonly config?: unknown;
  /** Файлы, уже лежащие в репозитории до прогона. */
  readonly existing?: Readonly<Record<string, string>>;
  /** Объявлять ли обвес зависимостью в `package.json` потребителя. */
  readonly declareDependency?: boolean;
  /**
   * Поставить обвес НАД корнем потребителя — раскладка hoisted-workspace.
   *
   * Резолв его находит (Node идёт вверх по `node_modules`), а репо-относительного
   * пути к его шаблонам не существует: это тот самый шов `contentRoot`.
   */
  readonly hoisted?: boolean;
}

export function installDevbox(options: InstallOptions = {}): Consumer {
  const box = mkdtempSync(join(tmpdir(), 'baser-cli-'));
  const root = join(box, options.repoName ?? 'baser');
  mkdirSync(root, { recursive: true });

  const declareDependency = options.declareDependency ?? true;
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: options.repoName ?? 'baser',
        version: '0.0.0',
        private: true,
        ...(declareDependency
          ? { devDependencies: { [DEVBOX_PACKAGE]: '0.1.0' } }
          : {}),
      },
      null,
      2,
    )}\n`,
  );

  const sourceRoot = join(
    options.hoisted === true ? box : root,
    'node_modules',
    DEVBOX_PACKAGE,
  );
  mkdirSync(sourceRoot, { recursive: true });

  // Манифест обвеса — это и есть его объявление: `declaration.json` примера
  // лежит в форме `package.json` (имя, версия, блок `baser`), поэтому кладётся
  // под своим настоящим именем, а не пересобирается.
  cpSync(
    join(DEVBOX_EXAMPLE, 'declaration.json'),
    join(sourceRoot, 'package.json'),
  );
  cpSync(
    join(DEVBOX_EXAMPLE, 'defaults.mjs'),
    join(sourceRoot, 'defaults.mjs'),
  );
  cpSync(join(DEVBOX_EXAMPLE, 'template'), join(sourceRoot, 'template'), {
    recursive: true,
  });

  const consumer: Consumer = {
    root,
    sourceRoot,
    read(path) {
      const file = join(root, path);
      return existsSync(file) ? readFileSync(file, 'utf-8') : null;
    },
    exists(path) {
      return existsSync(join(root, path));
    },
    write(path, content) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    remove(path) {
      rmSync(join(root, path), { force: true, recursive: true });
    },
    updateSource(patch, version) {
      const manifestPath = join(sourceRoot, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        version: string;
        baser: DeclarationBlock;
      };
      patch(manifest.baser);
      if (version !== undefined) {
        manifest.version = version;
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    updateResolvers(source) {
      // Новый файл, а не перезапись: ESM-модуль кэшируется загрузчиком по URL
      // на всё время процесса, и подмена содержимого по тому же пути не
      // доехала бы до второго прогона. Обвес при этом правится честно — через
      // своё же объявление.
      const name = `defaults.${counter()}.mjs`;
      writeFileSync(join(sourceRoot, name), source);
      consumer.updateSource((block) => {
        const settings = block['settings'] as Record<
          string,
          { defaultFrom?: string }
        >;
        for (const spec of Object.values(settings)) {
          if (typeof spec.defaultFrom === 'string') {
            spec.defaultFrom = spec.defaultFrom.replace(
              /^\.\/defaults[^#]*/,
              `./${name}`,
            );
          }
        }
      });
    },
    writeTemplate(name, content) {
      writeFileSync(join(sourceRoot, 'template', name), content);
    },
    cleanup() {
      rmSync(box, { force: true, recursive: true });
    },
  };

  if (options.config !== undefined) {
    consumer.write(
      'baser.json',
      `${JSON.stringify(options.config, null, 2)}\n`,
    );
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) {
    consumer.write(path, content);
  }

  return consumer;
}

/**
 * УДАЛЕНО: `makeArtifactOwnable` и `withoutMarker`.
 *
 * Оба были обходом одного блокера — служебной записи ВНУТРИ артефакта. Первый
 * подменял `dest` на `.jsonc`, чтобы движок вообще смог пометить живой
 * devcontainer; второй снимал наклейку перед сверкой с эталоном.
 *
 * Запись уехала в `baser.lock.json` (`tasker:BASER2-4`), движок содержимого не
 * трогает — и оба помощника стали не нужны: шаблон ложится прямо в
 * `devcontainer.json`, а тело артефакта равно телу шаблона. Приёмка двери с
 * этого места идёт по НАСТОЯЩЕЙ раскладке обвеса, без обходов.
 */

/** Живой `.devcontainer` этого репозитория — эталон приёмки. */
export function liveArtifact(dest: string): string {
  return readFileSync(join(REPO_ROOT, dest), 'utf-8');
}

/**
 * Служебная запись, лежащая на диске потребителя.
 *
 * Владение читается ОТСЮДА, а не из содержимого артефакта: это и есть переезд
 * `tasker:BASER2-4`. Разбирается тем же кодом, которым движок её пишет, — свой
 * разбор в тесте разошёлся бы с формой при первой же правке.
 */
export function manifestOf(consumer: Consumer): readonly ManifestRecord[] {
  const raw = consumer.read(MANIFEST_PATH);
  if (raw === null) {
    return [];
  }
  return [...readManifest(treeOverDisk(consumer)).values()];
}

/**
 * Дерево из одного файла — ровно то, что нужно `readManifest`.
 *
 * Движок читает манифест из `Tree`, а у теста на руках реальный диск. Полное
 * дерево тут заводить не за чем: `readManifest` спрашивает существование и
 * содержимое одного пути, и подменять его собственным разбором JSON значило бы
 * держать вторую правду о форме записи.
 */
function treeOverDisk(consumer: Consumer): Tree {
  return {
    exists: (path: string) => consumer.exists(path),
    read: (path: string) => consumer.read(path),
  } as unknown as Tree;
}

let sequence = 0;
function counter(): number {
  sequence += 1;
  return sequence;
}
