/**
 * ЗАПУСКАЕМЫЙ БАНДЛ — ручная выдача, первый способ доставки.
 *
 * `pack` собирает нагрузку и НЕ знает про способ доставки: собрать — всегда одно
 * и то же, вынести можно папкой в руках, в реестр, в локальный том
 * (`tasker:BASER2-31`). Здесь берётся ровно один способ — папка в руках, — и к
 * нагрузке добавляется то, без чего она не запускается у человека: сама дверь.
 *
 * **Дверь вкладывает себя, и только она.** Не из вежливости к слоям: вложить
 * себя может лишь тот, кто знает, из чего состоит. Сделай это `pack` — он стал
 * бы зависеть от двери, а дверь зависит от него, и круг замкнулся бы
 * (`contracts ← check ← pack ← дверь`).
 *
 * ## Почему без бандлера и без тарбола
 *
 * Node резолвит зависимости от места файла ВВЕРХ, поэтому `node_modules` внутри
 * бандла — уже рабочий механизм, и городить поверх него сборщик незачем.
 * Собранная дверь тянет ровно `ejs` (252 КБ, без собственных зависимостей) и
 * два соседних пакета, которые снаружи не тянут ничего, кроме `node:crypto`.
 * `nx` и `@nx/devkit` в рантайме не нужны вовсе — дерево дверь держит сама
 * (`tree.ts`), и это одно решение сняло 21 МБ и платформенные бинари.
 *
 * ## Обещание проверяется, а не заявляется
 *
 * Список зависимостей вычисляется по объявленным `dependencies`, но верится не
 * ему: последний шаг СКАНИРУЕТ всё, что легло, и требует, чтобы каждый импорт
 * по имени пакета резолвился внутри бандла. «Я думаю, это все зависимости»
 * превращается в проверенный факт — и остаётся им, когда кто-то добавит новую.
 */

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packPackage,
  PAYLOAD_DIR,
  PAYLOAD_MANIFEST_FILE,
  type PackReport,
} from '@omnifield/baser-pack';
import { DoorProblemLog, type DoorProblem } from './problems.js';

/** Версия формы бандла: что в нём лежит и как оно называется. */
export const BUNDLE_SCHEMA_VERSION = 1;

/** Пакет, вложенный в бандл. */
export interface BundledPackage {
  readonly name: string;
  readonly version: string | null;
  /** Путь внутри бандла. */
  readonly path: string;
  readonly bytes: number;
  readonly files: number;
}

export type BundleStageName =
  /** Нагрузка: обвес проверен и собран (`baser-pack`). */
  | 'pack'
  /** Дверь и её зависимости легли в `node_modules` бандла. */
  | 'runtime'
  /** Установщик и запускалка. */
  | 'launcher'
  /** `INSTALL.md`. */
  | 'docs'
  /** Каждый импорт по имени резолвится ВНУТРИ бандла. */
  | 'verify';

export type BundleStageStatus = 'ok' | 'failed' | 'skipped';

/**
 * Шаг сборки и его ОБЪЁМ.
 *
 * Счётчик здесь по той же причине, что у `check` и `pack`: зелёная проба,
 * которая ничего не сверила, невозможна не по договорённости, а по конструкции —
 * пустой счётчик виден.
 */
export interface BundleStage {
  readonly name: BundleStageName;
  readonly status: BundleStageStatus;
  readonly counted: number;
  readonly reason?: string;
}

export interface BundleSpan {
  readonly name: string;
  readonly ms: number;
}

export interface BundleReport {
  readonly bundleSchemaVersion: number;
  readonly ok: boolean;
  readonly source: string;
  readonly target: string;
  /**
   * Ответ упаковки целиком.
   *
   * Отказ негодного обвеса приходит отсюда и наверх едет КАК ЕСТЬ: своего
   * «обвес непригоден» бандл поверх не пишет — две правды об одном событии это
   * два события для читателя.
   */
  readonly pack: PackReport;
  /** Что вложено в `node_modules` бандла. */
  readonly runtime: readonly BundledPackage[];
  readonly stages: readonly BundleStage[];
  readonly problems: readonly DoorProblem[];
  readonly trace: readonly BundleSpan[];
}

export interface BundleOptions {
  /** Каталог бандла. Должен быть пустым или отсутствовать — это правило `pack`. */
  readonly into: string;
  /** Источник времени для трейсов; подменяется в тестах ради детерминизма. */
  readonly now?: () => number;
}

/** Пакеты, с которых начинается замыкание зависимостей двери. */
const DOOR_PACKAGE = '@omnifield/baser-cli';

/** Импорт по имени пакета: не относительный и не встроенный в Node. */
const BARE_IMPORT = /\bfrom\s+'([^'.][^']*)'|\brequire\('([^'.][^']*)'\)/g;

/**
 * Собирает запускаемый бандл из каталога обвеса.
 *
 * Первым делом зовётся `pack`: негодный обвес не пакуется, а значит и бандла из
 * него не бывает. Дальше добавляется только то, чего у нагрузки нет и быть не
 * может, — дверь.
 */
export function bundle(source: string, options: BundleOptions): BundleReport {
  const now = options.now ?? (() => performance.now());
  const log = new DoorProblemLog();
  const stages: BundleStage[] = [];
  const trace: BundleSpan[] = [];

  const target = resolve(options.into);
  const runtime: BundledPackage[] = [];

  const stage = <T>(
    name: BundleStageName,
    run: () => T,
    counted: (value: T) => number,
  ): T => {
    const before = log.list().length;
    const started = now();
    const value = run();
    trace.push({ name, ms: now() - started });
    const failed = log.list().length > before;
    stages.push({
      name,
      status: failed ? 'failed' : 'ok',
      counted: failed ? 0 : counted(value),
    });
    return value;
  };

  const skip = (name: BundleStageName, reason: string): void => {
    stages.push({ name, status: 'skipped', counted: 0, reason });
  };

  // ── 1. Нагрузка. Она же проверяет обвес и отказывается паковать негодное.
  const packed = stage(
    'pack',
    () =>
      packPackage(source, { into: target, ...(options.now ? { now } : {}) }),
    (report) => report.manifest?.files.length ?? 0,
  );

  if (!packed.ok) {
    for (const name of ['runtime', 'launcher', 'docs', 'verify'] as const) {
      skip(name, 'нагрузка не собрана: бандла из негодного обвеса не бывает');
    }
    return {
      bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
      ok: false,
      source: resolve(source),
      target,
      pack: packed,
      runtime,
      stages,
      // Отказ упаковки НЕ переупаковывается: он уже назван кодом и адресом, а
      // второй текст поверх сделал бы из одного события два.
      problems: log.list(),
      trace,
    };
  }

  // ── 2. Дверь и её зависимости.
  stage(
    'runtime',
    () => {
      try {
        runtime.push(...copyRuntime(target));
      } catch (cause) {
        log.add('bundle-runtime-failed', target, describe(cause));
      }
      return runtime;
    },
    (packages) => packages.length,
  );

  // ── 3. Установщик и запускалка.
  stage(
    'launcher',
    () => {
      const own = doorRoot();
      const scripts: [from: string, to: string][] = [
        ['dist/bundle/install.js', 'install.mjs'],
        ['dist/bundle/baser.js', 'baser.mjs'],
      ];
      let copied = 0;
      for (const [from, to] of scripts) {
        const file = join(own, from);
        if (!existsSync(file)) {
          log.add(
            'bundle-runtime-failed',
            file,
            'запускаемый файл бандла не собран — нечего вкладывать. ' +
              'Собери пакет двери (tsc) до сборки бандла',
          );
          continue;
        }
        const landed = join(target, to);
        cpSync(file, landed);
        // Шебанг в этих файлах есть с самого начала — значит запуск НАПРЯМУЮ
        // обещан, и обещание держится битом, а не намерением. Без него первое
        // движение человека упирается в `Permission denied` — сообщение
        // операционной системы про права, хотя дело не в правах
        // (`tasker:BASER2-33`). Тот же класс, что копирование обвеса без записи
        // в `dependencies`: половина имитации хуже её отсутствия.
        chmodSync(landed, 0o755);
        copied += 1;
      }
      return copied;
    },
    (copied) => copied,
  );

  // ── 4. Инструкция.
  stage(
    'docs',
    () => {
      writeFileSync(
        join(target, 'INSTALL.md'),
        installDoc(packed, target),
        'utf-8',
      );
      return 1;
    },
    () => 1,
  );

  // ── 5. Проверка замыкания: каждый импорт по имени резолвится ВНУТРИ бандла.
  stage(
    'verify',
    () => {
      const missing = unresolvedImports(target, runtime);
      for (const [file, name] of missing) {
        log.add(
          'bundle-not-self-contained',
          file,
          `импорт "${name}" не резолвится внутри бандла: унесённый бандл упал бы ` +
            'на первом же прогоне у человека. Добавь пакет в замыкание зависимостей двери',
        );
      }
      return ourJavascript(target).length + runtime.length;
    },
    (checked) => checked,
  );

  return {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    ok: log.empty,
    source: resolve(source),
    target,
    pack: packed,
    runtime,
    stages,
    problems: log.list(),
    trace,
  };
}

/**
 * Корень пакета двери — от места ЭТОГО файла вверх.
 *
 * Не резолвом по имени: у двери может не быть ссылки на саму себя в
 * `node_modules`, а искать себя по имени — это как раз тот случай, когда
 * механизм зависит от раскладки, которую он же и собирается воспроизводить.
 */
function doorRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as {
        name?: unknown;
      };
      if (parsed.name === DOOR_PACKAGE) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`не нашёл корень пакета "${DOOR_PACKAGE}" от ${current}`);
    }
    current = parent;
  }
}

/**
 * Копирует дверь и замыкание её объявленных зависимостей в бандл.
 *
 * Замыкание считается по `dependencies` — тому, что пакеты объявили сами. Это
 * ОЖИДАНИЕ, а не гарантия; гарантию даёт шаг `verify`, который смотрит на
 * реальные импорты уже сложенного бандла.
 */
function copyRuntime(target: string): BundledPackage[] {
  const root = doorRoot();
  const modules = join(target, 'node_modules');
  const done = new Map<string, BundledPackage>();
  const queue: [name: string, from: string][] = [[DOOR_PACKAGE, root]];

  while (queue.length > 0) {
    const [name, from] = queue.pop() as [string, string];
    if (done.has(name)) {
      continue;
    }

    const manifest = JSON.parse(
      readFileSync(join(from, 'package.json'), 'utf-8'),
    ) as {
      version?: unknown;
      dependencies?: Record<string, string>;
      files?: unknown;
    };

    const into = join(modules, ...name.split('/'));
    mkdirSync(dirname(into), { recursive: true });

    // Кладётся то же, что уехало бы публикацией: `files` пакета плюс манифест.
    // Пакеты без `files` (`ejs`) копируются целиком минус их собственные
    // зависимости — они уже приедут своими записями замыкания.
    const shipped = Array.isArray(manifest.files)
      ? (manifest.files as string[]).filter((entry) => !entry.startsWith('!'))
      : readdirSync(from).filter((entry) => entry !== 'node_modules');

    mkdirSync(into, { recursive: true });
    cpSync(join(from, 'package.json'), join(into, 'package.json'));
    for (const entry of shipped) {
      const file = join(from, entry);
      if (entry !== 'package.json' && existsSync(file)) {
        cpSync(file, join(into, entry), { recursive: true });
      }
    }

    const measured = measure(into);
    done.set(name, {
      name,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      path: relative(target, into).split(sep).join('/'),
      bytes: measured.bytes,
      files: measured.files,
    });

    const require = createRequire(join(from, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!done.has(dependency)) {
        queue.push([dependency, packageRoot(require, dependency)]);
      }
    }
  }

  return [...done.values()].sort((left, right) =>
    left.name < right.name ? -1 : 1,
  );
}

/**
 * Корень установленного пакета по имени.
 *
 * Через точку входа и подъём вверх, а не через `<name>/package.json`: пакет
 * вправе не отдавать свой манифест наружу (`ejs` именно так и делает), и
 * упереться в это на сборке бандла значило бы упереться в чужое законное
 * решение.
 */
function packageRoot(require: NodeJS.Require, name: string): string {
  let current = dirname(require.resolve(name));
  for (;;) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as {
        name?: unknown;
      };
      if (parsed.name === name) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`не нашёл корень пакета "${name}"`);
    }
    current = parent;
  }
}

/**
 * Замыкание проверяется ДВУМЯ утверждениями, и ни одно не судит чужую упаковку.
 *
 * **1. Наш код не смотрит наружу.** Сканируются файлы, которые написали мы, —
 * запускалки бандла и собранные пакеты `@omnifield/*`. Каждый импорт по имени
 * обязан резолвиться внутри бандла. Дрейфует именно наш код: зависимость
 * добавляют у нас, а падает оно у человека.
 *
 * **2. У каждого вложенного пакета есть все его объявленные зависимости.**
 * Чужие пакеты кладутся целиком по их собственному манифесту, и перебирать их
 * внутренние файлы значило бы судить чужую упаковку — ровно ту вторую правду, от
 * которой отказались `check` (разбор `files`) и `pack` (семантика `.npmignore`).
 * `ejs` везёт с собой браузерную сборку, свой CLI и jakefile; они никогда не
 * грузятся, и объявлять бандл сломанным из-за них — ложная тревога.
 *
 * Настоящее доказательство даёт не этот шаг, а приёмка: бандл уносится и
 * запускается. Здесь — гейт, чтобы заведомо сломанное не уехало.
 */
function unresolvedImports(
  target: string,
  packages: readonly BundledPackage[],
): [file: string, name: string][] {
  const missing: [string, string][] = [];
  const modules = join(target, 'node_modules');
  const present = new Set(packages.map((item) => item.name));

  for (const file of ourJavascript(target)) {
    const require = createRequire(file);
    const source = readFileSync(file, 'utf-8');
    for (const match of source.matchAll(BARE_IMPORT)) {
      const name = match[1] ?? match[2];
      if (name === undefined || isBuiltin(name)) {
        continue;
      }
      let resolved: string;
      try {
        resolved = require.resolve(name);
      } catch {
        // Пакет не нашёлся вовсе — тем более не внутри бандла.
        missing.push([relative(target, file).split(sep).join('/'), name]);
        continue;
      }
      // Резолв удался — но откуда? Внешний путь означает, что бандл опирается
      // на окружение сборки и у человека упадёт.
      if (!resolved.startsWith(`${modules}${sep}`)) {
        missing.push([relative(target, file).split(sep).join('/'), name]);
      }
    }
  }

  for (const item of packages) {
    const manifest = JSON.parse(
      readFileSync(join(target, item.path, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!present.has(dependency)) {
        missing.push([`${item.path}/package.json`, dependency]);
      }
    }
  }

  return missing;
}

/** Встроенный модуль Node — и с префиксом `node:`, и без него (`path`, `fs`). */
function isBuiltin(name: string): boolean {
  return name.startsWith('node:') || builtinModules.includes(name);
}

/** Файлы, которые написали мы: запускалки бандла и собранные пакеты `@omnifield`. */
function ourJavascript(target: string): string[] {
  const roots = [
    join(target, 'install.mjs'),
    join(target, 'baser.mjs'),
    join(target, 'node_modules', '@omnifield'),
  ];

  const files: string[] = [];
  const walk = (path: string): void => {
    if (!existsSync(path)) {
      return;
    }
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) {
        walk(join(path, entry));
      }
      return;
    }
    if (/\.(js|mjs|cjs)$/.test(path)) {
      files.push(path);
    }
  };
  roots.forEach(walk);
  return files;
}

function measure(root: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        bytes += statSync(path).size;
        files += 1;
      }
    }
  };
  walk(root);
  return { bytes, files };
}

/**
 * `INSTALL.md` — инструкция под КОНКРЕТНЫЙ обвес, а не шаблон с плейсхолдерами.
 *
 * Имя пакета, версия и список артефактов берутся из описи: человек, открывший
 * бандл, читает про то, что у него в руках, а не про абстрактный обвес. Имя
 * каталога бандла — тоже настоящее: команду из доки копируют целиком, и
 * плейсхолдер в ней означал бы ошибку с первого движения.
 *
 * ## Почему первой командой идёт контейнер
 *
 * Инструмент, который затаскивает проект в контейнер, требовал Node НА ХОСТЕ —
 * а по канону (`kb:FUND-4`, containers-only) хост держит только докер и файлы
 * (`tasker:BASER2-34`). Мы этого не видели, потому что все прогоны шли внутри
 * девбоксов, где Node есть по умолчанию: предусловие выполнялось само собой и
 * поэтому не было названо нигде.
 *
 * Лечится это ДОКОЙ, а не запускалкой в бандле: шелл-скрипт добавил бы в
 * поставку предположение про докер ради экономии одной команды.
 */
function installDoc(packed: PackReport, target: string): string {
  const manifest = packed.manifest;
  const name = manifest?.source.package.name ?? 'обвес';
  const version = manifest?.source.package.version;
  const artifacts = manifest?.artifacts ?? [];
  /** Как папка называется у человека в руках — так она и зовётся в командах. */
  const here = basename(target);

  /** Оболочка контейнера: Node появляется на время прогона и исчезает с ним. */
  const inContainer = (...args: string[]): string =>
    `docker run --rm --user "$(id -u):$(id -g)" \\
  -v "$PWD":"/$(basename "$PWD")" -w "/$(basename "$PWD")" node:22 \\
  node ${here}/install.mjs${args.length > 0 ? ` ${args.join(' ')}` : ''}`;

  return `# Установка: ${name}${version === null || version === undefined ? '' : `@${version}`}

${manifest?.source.title ?? ''}

Эта папка самодостаточна: в ней лежит обвес, дверь и всё, что двери нужно.
Доставать из сети ничего не придётся.

**На хосте Node не нужен** — и не должен быть нужен: на машине живут докер и
файлы, а исполняется всё в контейнерах. Поэтому первая команда ниже — не
\`node\`, а одноразовый контейнер: Node появляется в нём на время прогона и
исчезает вместе с ним. Установленного на хост не остаётся ничего.

## Сухой прогон — посмотреть, что будет

Положи эту папку (\`${here}/\`) в корень своего репозитория — иначе из
контейнера её не видно, — и оттуда же запускай:

\`\`\`bash
${inContainer('--plan')}
\`\`\`

\`--user\` — чтобы файлы остались твоими: без него из контейнера прилетают
root-овы, и разгребать их придётся руками.

Репозиторий монтируется под СВОИМ именем (\`basename "$PWD"\`), а не в \`/repo\`,
и это не косметика: имя девбокса пока считается от имени каталога, поэтому
монтирование в \`/repo\` дало бы \`repo-devbox\`. Оговорка временная — уедет
вместе с \`tasker:BASER2-32\`.

Если Node на хосте уже есть, то же самое без контейнера:

\`\`\`bash
node install.mjs --plan --cwd /путь/к/репозиторию
\`\`\`

Бит исполнения на \`install.mjs\` стоит, поэтому работает и \`./install.mjs\`.
Права переживают \`tar\` и обычное копирование, но не всякую дорогу: если бандл
ехал через архиватор или выгрузку, которые прав не несут, зови через \`node\` —
этот путь от прав не зависит вовсе.

## Что прогон трогает, и что после него остаётся

Прогон — и сухой, и настоящий — трогает две вещи, и обе за пределами того, что
ты коммитишь:

- \`node_modules/\` цели — туда кладётся обвес, ровно как его положил бы
  \`npm i\`. Там он и остаётся: git его не отслеживает;
- \`package.json\` — обвес объявляется зависимостью на ВРЕМЯ прогона и
  снимается сразу после него.

Запись нужна потому, что дверь ищет обвесы по объявленным зависимостям, и
другого признака у неё нет. Но пакет нигде не опубликован: у коллеги и в CI
такая строка не резолвится, и первым падает CI. Поэтому ручная доставка её за
собой убирает и говорит об этом вслух. **После прогона в \`git status\` не
остаётся ничего, что нельзя закоммитить.**

Если \`package.json\` у тебя нет вовсе (Go, Python, что угодно) — он создаётся
на время прогона и удаляется целиком. Чужеродного файла в репозитории не
останется.

\`pnpm-lock.yaml\` не трогается никогда: чужой лок-формат — чужие внутренности.

## Установка

\`\`\`bash
${inContainer()}
\`\`\`

Разложит артефакты и запишет служебную запись. Что именно ляжет:

${artifacts.map((item) => `- \`${item.dest}\``).join('\n')}

## Если такой файл у тебя уже есть

**Ничего не будет затёрто.** Дверь откажется трогать файл, которого она не
клала, и скажет об этом: это первая установка в непустой репозиторий, а не
поломка. Дальше решаешь ты:

\`\`\`bash
${inContainer('--confirm', '.devcontainer/devcontainer.json')}
\`\`\`

Подтверждение поимённое: согласие на один файл не становится согласием на
соседний. Подтверждённый файл заменяется целиком и дальше ведётся обвесом —
правки руками в нём не переживут следующего обновления. Хочешь оставить своё —
просто не подтверждай.

## Что коммитить, а что нет

| Путь | Куда |
|---|---|
| разложенные артефакты (см. список выше) | **в git** — это файлы твоего репозитория |
| \`baser.json\` | **в git** — твои настройки обвеса |
| \`baser.lock.json\` | **в git, обязательно** |
| \`node_modules/\` | в \`.gitignore\`, как обычно |
| \`package.json\` | коммитить нечего: прогон вернул его как был |
| \`${here}/\` (эта папка) | **не коммить** — удали или унеси после установки |

Сама папка бандла в репозитории не нужна: она понадобилась на прогон и после
него остаётся лишним каталогом в \`git status\`. Разложенное живёт своей жизнью
и от неё не зависит.

\`baser.lock.json\` — служебная запись: по ней дверь знает, какие файлы положила
она, а какие твои. **Без неё следующий прогон объявит все артефакты чужими** и
упрётся в отказы по всему дереву. Это не каприз: без записи владение
недоказуемо.

Если \`.gitignore\` у тебя игнорирует что-то из списка артефактов — проверь
заранее, иначе положенное не доедет до остальных. И если \`node_modules/\` в
\`.gitignore\` ещё не попал (репозиторий не на Node) — добавь: склад коммитить
незачем.

## Дальше

Повторный прогон — тем же установщиком, хоть \`--plan\`, хоть без него: он
снова объявит обвес на время работы и снова уберёт запись.

Рядом лежит \`baser.mjs\` — та же дверь, вызываемая напрямую:

\`\`\`bash
node baser.mjs plan  --cwd /путь/к/репозиторию
node baser.mjs apply --cwd /путь/к/репозиторию
\`\`\`

После установки она работает и без записи в манифесте: обвес назван в
\`baser.json\`, а существующий конфиг авторитетен целиком. До первой установки
звать надо \`install.mjs\` — обвеса на складе ещё нет.

Когда обвес выйдет в реестр, поставку заменит на месте пакетный менеджер
(\`npm i ${name}\`): он сам положит файлы, сам напишет строку в
\`dependencies\`, сам обновит лок — и снимать за собой уже не придётся ничего,
потому что такая запись резолвится у всех.
`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export { PAYLOAD_DIR, PAYLOAD_MANIFEST_FILE };
