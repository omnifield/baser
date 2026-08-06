/**
 * ЧИСТОЕ ДЕРЕВО С ПОСТАВЛЕННЫМИ ОБВЕСАМИ.
 *
 * Приёмка двери — не мок. Дверь берёт обвес с реальной ФС, грузит его резолверы
 * как настоящие модули и кладёт файлы на настоящий диск; фикстура, подменившая
 * хоть одно из трёх, проверяла бы не дверь.
 *
 * Поэтому здесь именно УСТАНОВКА: обвес девбокса раскладывается в
 * `node_modules/@omnifield/baser-devbox` временного репозитория — манифест,
 * резолверы, каталог шаблонов, всё настоящее и на настоящем диске.
 *
 * ── ПОЧЕМУ КАТАЛОГ НАЗЫВАЕТСЯ ДВЕРИ, А НЕ НАХОДИТСЯ ЕЮ ──────────────────────
 *
 * Дверь больше не ищет обвес среди поставленного пакетным менеджером
 * потребителя: поставку она достаёт сама, со склада в кэш снаружи локации
 * (`tasker:BASER2-146`, `kb:BASER2-22`). Значит проба, положившая пакет в
 * `node_modules`, этим ничего двери не сказала — и говорит ей отдельно, входом
 * дев-петли: `door` / `doorArgs` отдают `--source <имя пакета>=<каталог>`.
 *
 * Каталог при этом остался прежним намеренно. Он лежит ВНУТРИ дерева
 * потребителя, как и наши собственные обвесы в монорепе, — то есть шов
 * `contentRoot` проверяется на той же раскладке, что и раньше, а `hoisted`
 * по-прежнему даёт «источника в этом дереве нет».
 *
 * Само доставание со склада изображать здесь нечем и не нужно: оно проверяется
 * целиком и без сети на поднятом в пробе складе (`supply.spec.ts`).
 *
 * ── ОТКУДА БЕРЁТСЯ ОБВЕС (`tasker:BASER2-26`) ───────────────────────────────
 *
 * Из ТАРБОЛА настоящего пакета `@omnifield/baser-devbox` (`npm pack`), а не из
 * копии-примера зоны контрактов, на которой приёмка стояла раньше. Копия
 * разъехалась ровно так, как и должна была: пример остался на своём рантайме и
 * своих комментариях, пакет уехал вперёд, обе стороны зеленели — до дня, когда
 * этот репозиторий сам сел на станок, и сверка с живым `.devcontainer` уперлась
 * в то, что сверялась не с тем обвесом.
 *
 * Тарбол, а не каталог монорепы, — потому что между «файл лежит в репозитории»
 * и «файл приехал потребителю» стоит `files` из `package.json`, и разойтись они
 * могут молча. Свой разбор `files` был бы второй правдой о составе пакета;
 * правда одна, и она у того, кто пакет собирает.
 *
 * Отсюда же и главный инструмент фикстуры — `updateSource`. Контракт проверяется
 * ПЕРЕХОДАМИ, а не устойчивыми состояниями (`packages/baser-materialize`,
 * `transitions.spec.ts`), а центральный переход у двери один: обвес обновился.
 *
 * **Второй обвес ставится тем же способом** (`installSource`, `tasker:BASER2-55`):
 * пакет в `node_modules` плюс строка в `devDependencies` — ровно то, что делает
 * npm, и ровно то, по чему дверь обвесы находит. Объявление у него собирается
 * здесь, а не берётся с диска: настоящий обвес в этом репозитории ровно один, а
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
import { parse, stringify } from 'yaml';
import {
  sourceConfigPath,
  FORM_VERSION,
  SOURCE_CONFIG_KEY,
} from '@omnifield/baser-contracts';
import {
  MANIFEST_PATH,
  readManifest,
  type ManifestRecord,
} from '@omnifield/baser-materialize';
import { inject } from 'vitest';
import type { SupplyOverride } from './supply.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Корень ЭТОГО репозитория — из него берётся живой `.devcontainer`. */
export const REPO_ROOT = resolve(here, '../../../..');

export const DEVBOX_PACKAGE = '@omnifield/baser-devbox';

/**
 * Каталог с содержимым тарбола: то и только то, что уедет потребителю.
 *
 * **Собирается ОДИН РАЗ НА ПРОГОН и снаружи проб** (`packed.setup.ts`), а
 * сюда приезжает готовым. Раньше сборка была ленивой и памятилась на модуль —
 * то есть повторялась в каждом файле проб, и платила за неё ПЕРВАЯ проба файла.
 * Замерено: 264 мс против 1 мс у второй, до 739 мс под нагрузкой; конвейер
 * ловил на этом красное по таймауту (`tasker:BASER2-189`).
 *
 * Состав пакета от этого стал общим не только на файл, но и на весь прогон:
 * все пробы зоны говорят про ОДИН И ТОТ ЖЕ тарбол — то самое свойство, ради
 * которого сборка памятилась, только теперь без лотереи «кто первый».
 */
function packedDevbox(): string {
  return inject('packedDevbox');
}

/** Разобранный `package.json` ОПУБЛИКОВАННОГО обвеса — вместе с блоком `baser`. */
export function devboxManifest(): {
  version: string;
  baser: { settings: Record<string, unknown> };
} {
  return JSON.parse(
    readFileSync(join(packedDevbox(), 'package.json'), 'utf-8'),
  ) as { version: string; baser: { settings: Record<string, unknown> } };
}

/**
 * Настройки, ОБЪЯВЛЕННЫЕ обвесом, — перечнем из его же манифеста.
 *
 * Пробы про «ноль вопросов пользователю» сверяют с этим списком, а не с числом:
 * число молча устаревает при каждом выпуске обвеса и потому проверяет не то,
 * что написано в его имени.
 */
export function declaredSettings(): readonly string[] {
  return Object.keys(devboxManifest().baser.settings);
}

/**
 * Тег образа, ПРИШПИЛЕННЫЙ выпуском обвеса, и следующий за ним.
 *
 * Числа — мажор Node: семейство `devcontainers/typescript-node` тегируется
 * именно им, и считает его резолвер `latestStableNode`. Но настройка зовётся
 * `imageTag` и версией рантайма быть не обещает (`tasker:BASER2-83`): своему
 * образу — свой тег, и число там не значит ничего.
 *
 * Числа держатся здесь одной парой, а не россыпью по пробам: их правда — в
 * `defaults.mjs` обвеса, и при его выпуске краснеть должна ОДНА проба с ясной
 * причиной (`acceptance.spec.ts`, «дефолт выпуска»), а не восемь ожиданий,
 * каждое из которых выглядит как самостоятельное утверждение.
 */
export const PINNED_NODE = '24';
export const MOVED_NODE = '26';

/**
 * Резолверы обвеса, поднявшие дефолтный тег образа: обвес выпустился заново.
 *
 * Переход «обвес обновился» — центральный у двери, и подменять ради него
 * настоящий модуль приходится всем пробам сразу. Текст один на всех: три копии
 * расходились бы по одной, и разошлись бы молча.
 */
export const BUMPED_RESOLVERS = `
export function repoName(ctx) { return ctx.repo.name; }
export function devboxName(ctx) { return \`\${ctx.repo.name}-devbox\`; }
export function latestStableNode() { return '${MOVED_NODE}'; }
`;

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
  /**
   * ВХОД ПРОГОНА для этого репозитория: корень плюс каталоги поставок.
   *
   * Поставку достаёт дверь (`kb:BASER2-22`), и по имени она полезла бы на склад —
   * то есть в сеть, из пробы, за пакетом, который ещё не выпущен. Поэтому проба
   * называет каталог поставки тем же входом, каким его называет человек с
   * обвесом в исходниках рядом: `--source <имя>=<каталог>`. Это не мок и не
   * обход — это ровно дев-петля, и она обязана быть живой (`tasker:BASER2-146`).
   *
   * Доставание со склада проверяется отдельно и целиком — на поднятом в пробе
   * складе, без сети (`supply.spec.ts`). Изображать его здесь значило бы
   * проверять доставание в каждой пробе и ни в одной по-настоящему.
   */
  readonly door: DoorEntry;
  /** То же самое для вызова через argv — `cli(['plan', ...box.doorArgs()])`. */
  doorArgs(): readonly string[];
  cleanup(): void;
}

/** Корень локации и ручки дев-петли — то, чем зовут `run` в пробах. */
export interface DoorEntry {
  readonly cwd: string;
  readonly sources: readonly SupplyOverride[];
}

/** Второй обвес: что он объявляет и что везёт. */
export interface SourceSpec {
  /** Имя пакета — то, что попадёт в `use` конфига потребителя. */
  readonly packageName: string;
  /** Идентичность обвеса: то, чем подписаны его записи в паспорте укладки. */
  readonly id: string;
  readonly title?: string;
  /**
   * Версия ПАКЕТА обвеса — та, что дверь читает из манифеста и подаёт движку.
   *
   * `null` — версии в манифесте нет вовсе (ключ не написан). Случай не
   * выдуманный: так выглядит приватный пакет, которому версию не проставляли, и
   * ровно на нём проверяется, что дверь не сочиняет её за обвес
   * (`tasker:BASER2-52`).
   */
  readonly version?: string | null;
  readonly layout: readonly {
    readonly src: string;
    readonly dest: string;
    readonly render?: boolean;
    /**
     * Чем станок держит этот артефакт (`tasker:BASER2-51`). Не назван — форма
     * проставит `regenerated` сама, как и у настоящего обвеса.
     */
    readonly class?: 'regenerated' | 'placed-once';
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

  // Тарбол кладётся ЦЕЛИКОМ и как есть: манифест обвеса (он же его объявление —
  // блок `baser` в `package.json`), резолверы, каталог шаблонов. Выбирать здесь
  // файлы поимённо значило бы ставить не тот пакет, который получит человек.
  cpSync(packedDevbox(), sourceRoot, { recursive: true });

  /**
   * Каталоги поставок этого репозитория — вход дев-петли.
   *
   * Список живой: второй обвес добавляет к нему свою запись, снятый — убирает.
   * Держать его снимком значило бы, что проба «конфиг сузили до одного обвеса»
   * продолжает называть дверь каталог того, кого уже сняли.
   */
  const supplies: SupplyOverride[] = [
    { packageName: DEVBOX_PACKAGE, path: sourceRoot },
  ];

  const consumer: Consumer = {
    root,
    sourceRoot,
    get door(): DoorEntry {
      return { cwd: root, sources: [...supplies] };
    },
    doorArgs() {
      return supplies.flatMap((supply) => [
        '--source',
        `${supply.packageName}=${supply.path}`,
      ]);
    },
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
      const installed = installExtraSource(
        options.hoisted === true ? box : root,
        root,
        spec,
      );
      supplies.push({
        packageName: installed.packageName,
        path: installed.root,
      });
      return installed;
    },
    removeSource(packageName) {
      const index = supplies.findIndex(
        (supply) => supply.packageName === packageName,
      );
      if (index !== -1) {
        supplies.splice(index, 1);
      }
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
 * Ставит второй обвес: пакет на диск плюс запись в `devDependencies`.
 *
 * Запись осталась не ради двери — поставку она достаёт сама и в чужой манифест
 * больше не смотрит (`tasker:BASER2-146`). Осталась она ради ЗАСЕВА: перечень
 * рождается по объявленным зависимостям потребителя, и без записи проба «конфиг
 * рождается сам» проверяла бы засев на пустом месте.
 *
 * Дверь узнаёт про этот каталог тем же входом, что и про первый, — `--source`
 * из `door` / `doorArgs` фикстуры.
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
        // `null` — ключа нет вовсе: обвес версию не назвал. Пустой строки здесь
        // не бывает, потому что её не бывает и в жизни: либо версия есть, либо
        // поля нет.
        ...(spec.version === null ? {} : { version: spec.version ?? '0.1.0' }),
        baser: {
          // Форма НЫНЕШНЯЯ, а не число: второй обвес изображает живой
          // инструмент, а не выпущенный вчера. Числом здесь стояла `2`, и с
          // подъёмом формы (`tasker:BASER2-116`) оно молча стало означать
          // «обвес прошлой формы» — то есть проверяло бы совместимость там, где
          // проба про неё не говорит ни слова.
          formVersion: FORM_VERSION,
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
            ...(entry.class === undefined ? {} : { class: entry.class }),
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
 * УЕХАЛ В `result.ts` и отдан через публичный вход пакета.
 *
 * Приёмка девбокса держалась за него глубоким путём в наш `src/lib`
 * (`tasker:BASER2-59`): единственный способ взять хелпер, которого нет в
 * индексе. Цена — приёмка чужой зоны прибита к нашим внутренностям, и сигнала
 * об этой зависимости у нас нет: перекладываем свои тестовые файлы — краснеет
 * сосед. Значит либо отдавать наружу, либо не быть точкой опоры; выбрано первое,
 * потому что «обвес один — дай его прогон» это утверждение о ФОРМЕ ОТВЕТА, а не
 * о тесте.
 *
 * Реэкспорт оставлен, чтобы правка импортов у соседа была его заходом, а не
 * поломкой, приехавшей из нашего.
 */
export { soleRun } from './result.js';

/** Живой `.devcontainer` этого репозитория — эталон приёмки. */
export function liveArtifact(dest: string): string {
  return readFileSync(join(REPO_ROOT, dest), 'utf-8');
}

/**
 * НАСТРОЙКИ, на которых живёт ЭТОТ репозиторий, — из его же файла настроек.
 *
 * Эталон приёмки — живой `.devcontainer`, а он есть функция двух вещей: обвеса и
 * вот этих значений. Взять первое настоящим, а второе переписать в пробу
 * руками значило бы вернуть ровно ту копию, из-за которой заход и случился:
 * человек правит `.omnifield/omnifield-devbox.yaml`, приёмка сверяется со
 * снимком, обе стороны зелены и обе про разное.
 */
export function liveTuning(sourceId: string): unknown {
  const raw = readFileSync(
    join(REPO_ROOT, sourceConfigPath(sourceId)),
    'utf-8',
  );
  return (parse(raw) as Record<string, unknown>)[SOURCE_CONFIG_KEY];
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
