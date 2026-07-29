/**
 * ЧИСТОЕ ДЕРЕВО С ПОСТАВЛЕННЫМИ ОБВЕСАМИ.
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
 * **Второй обвес ставится тем же способом** (`installSource`, `tasker:BASER2-55`):
 * пакет в `node_modules` плюс строка в `devDependencies` — ровно то, что делает
 * npm, и ровно то, по чему дверь обвесы находит. Объявление у него собирается
 * здесь, а не берётся из примера: живой пример зоны контрактов ровно один, а
 * второй инструмент нужен именно как ВТОРОЙ — со своей идентичностью, своими
 * путями и своими настройками (живой случай `tasker:BASER2-44` — девбокс плюс
 * плагин агентов).
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
import { stringify } from 'yaml';
import {
  sourceConfigPath,
  SOURCE_CONFIG_KEY,
} from '@omnifield/baser-contracts';
import {
  MANIFEST_PATH,
  readManifest,
  type ManifestRecord,
} from '@omnifield/baser-materialize';
import type { DoorResult, SourceRun } from './result.js';

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
  /**
   * Пишет файл настроек обвеса — ключ `baser` целиком.
   *
   * Настройки живут НЕ в `baser.json` (`tasker:BASER2-10` §3), и проба обязана
   * ставить их туда же, куда их ставит человек: путь считается из личности
   * обвеса, а не задаётся тестом, иначе проба зеленела бы на файле, которого
   * дверь не читает.
   */
  tune(sourceId: string, block: unknown): void;
  /** Читает файл настроек обвеса как текст — то, что увидит человек. */
  readTuning(sourceId: string): string | null;
  /**
   * Ставит ЕЩЁ ОДИН обвес: пакет в `node_modules` и строка в `devDependencies`.
   *
   * Возвращает то же, чем правят девбокс, — правка объявления второго обвеса
   * нужна ровно так же (переход «обвес обновился» бывает у любого из них).
   */
  installSource(spec: SourceSpec): InstalledSource;
  /** Снимает поставленный обвес целиком — и пакет, и запись о зависимости. */
  removeSource(packageName: string): void;
  cleanup(): void;
}

/** Второй обвес: что он объявляет и что везёт. */
export interface SourceSpec {
  /** Имя пакета — то, что попадёт в `use` конфига потребителя. */
  readonly packageName: string;
  /** Идентичность обвеса: то, чем подписаны его записи в паспорте укладки. */
  readonly id: string;
  readonly title?: string;
  readonly layout: readonly {
    readonly src: string;
    readonly dest: string;
    readonly render?: boolean;
  }[];
  /** Файлы каталога шаблонов: имя → содержимое. */
  readonly templates: Readonly<Record<string, string>>;
  /** Настройки обвеса; по умолчанию их нет. */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly presets?: Readonly<Record<string, unknown>>;
}

/** Ручка к поставленному обвесу: правки его объявления и его шаблонов. */
export interface InstalledSource {
  readonly packageName: string;
  readonly root: string;
  updateSource(
    patch: (block: DeclarationBlock) => void,
    version?: string,
  ): void;
  writeTemplate(name: string, content: string): void;
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
  /**
   * Файлы настроек обвесов: личность обвеса → содержимое ключа `baser`.
   *
   * Не передан — файлов нет, и дверь родит их сама с закомментированными
   * дефолтами. Это рабочее состояние, а не пробел: ноль вопросов пользователю.
   */
  readonly tuning?: Readonly<Record<string, unknown>>;
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
    tune(sourceId, block) {
      consumer.write(
        sourceConfigPath(sourceId),
        stringify({ [SOURCE_CONFIG_KEY]: block }),
      );
    },
    readTuning(sourceId) {
      return consumer.read(sourceConfigPath(sourceId));
    },
    installSource(spec) {
      return installExtraSource(
        options.hoisted === true ? box : root,
        root,
        spec,
      );
    },
    removeSource(packageName) {
      rmSync(
        join(
          options.hoisted === true ? box : root,
          'node_modules',
          packageName,
        ),
        {
          force: true,
          recursive: true,
        },
      );
      dropDependency(root, packageName);
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
  for (const [sourceId, block] of Object.entries(options.tuning ?? {})) {
    consumer.tune(sourceId, block);
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) {
    consumer.write(path, content);
  }

  return consumer;
}

/**
 * Ставит обвес так же, как его поставил бы npm: пакет плюс зависимость.
 *
 * Половина установки уже стоила нам дефекта (`README.md`, «ручная доставка»):
 * дверь ищет обвесы по ОБЪЯВЛЕННЫМ зависимостям, и каталог без строки в
 * `devDependencies` для неё не поставлен вовсе. Фикстура, копирующая только
 * файлы, проверяла бы дверь на состоянии, которого у пакетного менеджера не
 * бывает.
 */
function installExtraSource(
  modulesRoot: string,
  repoRoot: string,
  spec: SourceSpec,
): InstalledSource {
  const root = join(modulesRoot, 'node_modules', spec.packageName);
  mkdirSync(join(root, 'template'), { recursive: true });

  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: spec.packageName,
        version: '0.1.0',
        baser: {
          formVersion: 2,
          source: {
            id: spec.id,
            title: spec.title ?? spec.id,
            contentRoot: 'template',
          },
          settings: spec.settings ?? {},
          presets: spec.presets ?? {},
          layout: spec.layout.map((entry) => ({
            src: entry.src,
            dest: entry.dest,
            ...(entry.render === false ? { render: false } : {}),
          })),
        },
      },
      null,
      2,
    )}\n`,
  );

  for (const [name, content] of Object.entries(spec.templates)) {
    writeFileSync(join(root, 'template', name), content);
  }

  addDependency(repoRoot, spec.packageName);

  return {
    packageName: spec.packageName,
    root,
    updateSource(patch, version) {
      const manifestPath = join(root, 'package.json');
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
    writeTemplate(name, content) {
      writeFileSync(join(root, 'template', name), content);
    },
  };
}

function addDependency(repoRoot: string, packageName: string): void {
  patchManifest(repoRoot, (manifest) => {
    const deps = (manifest['devDependencies'] ?? {}) as Record<string, string>;
    deps[packageName] = '0.1.0';
    manifest['devDependencies'] = deps;
  });
}

function dropDependency(repoRoot: string, packageName: string): void {
  patchManifest(repoRoot, (manifest) => {
    const deps = manifest['devDependencies'] as
      | Record<string, string>
      | undefined;
    if (deps) {
      delete deps[packageName];
    }
  });
}

function patchManifest(
  repoRoot: string,
  patch: (manifest: Record<string, unknown>) => void,
): void {
  const path = join(repoRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as Record<
    string,
    unknown
  >;
  patch(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
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

/**
 * Прогон ЕДИНСТВЕННОГО обвеса из ответа двери.
 *
 * Обвесов в ответе столько же, сколько поставлено (`tasker:BASER2-55`), и пробы
 * про один обвес спрашивают именно его. Хелпер бросает, если обвес не один:
 * молчаливое `runs[0]` в такой пробе однажды начало бы проверять первый из двух
 * и зеленеть на половине ответа.
 */
export function soleRun(result: DoorResult): SourceRun {
  if (result.runs.length !== 1) {
    throw new Error(
      `ожидался ровно один прогон, а их ${result.runs.length}: ` +
        result.runs.map((run) => run.source.id).join(' · '),
    );
  }
  return result.runs[0];
}

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
