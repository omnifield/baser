/**
 * ПАКЕТ, СОБРАННЫЙ ТАК, КАК ЕГО ПОЛУЧИТ ПОТРЕБИТЕЛЬ.
 *
 * До этой зоны обвес девбокса жил примером ВНУТРИ пакета контрактов и гонялся
 * его пробой. Проба брала файлы по путям монорепы — и потому не могла проверить
 * ровно то, что теперь появилось: обвес **ставится как зависимость**. Между
 * «файл лежит в репозитории» и «файл приехал потребителю» стоит `files` из
 * `package.json`, и разойтись они могут молча: объявление ссылается на
 * `./defaults.mjs`, а в тарболе его нет — и обвес ломается у первого же
 * пользователя, зеленея у нас.
 *
 * Поэтому здесь именно `npm pack`, а не копирование каталога и не собственный
 * разбор `files`: свой разбор был бы ВТОРОЙ правдой о составе пакета и
 * разъехался бы с npm ровно там, где мы не подумали. Правда одна, и она у того,
 * кто пакет собирает.
 *
 * Дальше распакованный тарбол кладётся в `node_modules/@omnifield/baser-devbox`
 * временного репозитория — ровно туда и ровно так, как его положил бы менеджер
 * пакетов. Все проверки этой зоны идут ПО НЕМУ, а не по исходному каталогу.
 */

import {
  FORM_VERSION,
  SOURCE_CONFIG_KEY,
  sourceConfigPath,
} from '../../baser-contracts/src/index.ts';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Исходный каталог пакета — из него собирается тарбол и больше ничего. */
export const PACKAGE_DIR = resolve(here, '..');

/** Корень ЭТОГО репозитория: живой `.devcontainer` — эталон приёмки. */
export const REPO_ROOT = resolve(here, '../../..');

export const DEVBOX_PACKAGE = '@omnifield/baser-devbox';

/** `dest` обоих артефактов обвеса — они же адреса в живом репозитории. */
export const LIVE = '.devcontainer/devcontainer.json';
export const LOCK = '.devcontainer/devcontainer-lock.json';

let packed = null;
let tarballPath = null;

/**
 * Сам ТАРБОЛ — файл, который уехал бы в реестр.
 *
 * Нужен там, где проверяется не содержимое пакета, а обращение с ним как с
 * зависимостью: менеджер пакетов ставит `.tgz`, а не каталог.
 */
export function packedTarball() {
  packedRoot();
  return tarballPath;
}

/**
 * Каталог с содержимым тарбола: то и только то, что уедет в реестр.
 *
 * Собирается один раз на процесс — не ради скорости, а ради того, чтобы все
 * проверки файла говорили про ОДИН И ТОТ ЖЕ состав пакета.
 */
export function packedRoot() {
  if (packed !== null) {
    return packed;
  }

  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-pack-'));
  // `--ignore-scripts` — сборка обвеса не должна ничего исполнять: он контент,
  // а не код. Если однажды понадобится шаг сборки, этот флаг сломается первым и
  // скажет об этом вслух.
  execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', box, PACKAGE_DIR],
    { cwd: PACKAGE_DIR, stdio: 'pipe' },
  );

  const tarball = readdirSync(box).find((name) => name.endsWith('.tgz'));
  if (tarball === undefined) {
    throw new Error(`npm pack не оставил тарбол в ${box}`);
  }
  execFileSync('tar', ['-xzf', join(box, tarball), '-C', box], {
    stdio: 'pipe',
  });

  tarballPath = join(box, tarball);
  packed = join(box, 'package');
  return packed;
}

/** Разобранный `package.json` ОПУБЛИКОВАННОГО пакета. */
export function packedManifest() {
  return JSON.parse(readFileSync(join(packedRoot(), 'package.json'), 'utf-8'));
}

/** Пути всех файлов тарбола, репо-относительно корня пакета, в байтовом порядке. */
export function packedFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else {
        out.push(path);
      }
    }
  };
  walk(packedRoot(), '');
  return out.sort();
}

/**
 * Репозиторий потребителя с ПОСТАВЛЕННЫМ обвесом.
 *
 * Три вещи задаются отдельно, потому что в жизни они расходятся, и ровно на их
 * расхождении сидела `tasker:BASER2-32`:
 *
 * - `repoName` — имя КАТАЛОГА, то есть как человек назвал клон (или куда
 *   смонтировал репозиторий в докере);
 * - `manifest` — `package.json` потребителя (`null` — его нет вовсе: Go,
 *   Python, что угодно);
 * - `gitOrigin` — адрес `origin`, то есть идентичность самого репозитория
 *   (`null` — репозиторий без remote или вовсе распакованный из архива).
 *
 * Настройки лежат ОТДЕЛЬНО от перечня поставленного (`tasker:BASER2-10` §3), и
 * задаются они здесь тоже двумя разными ключами:
 *
 * - `config` — `baser.json`, что поставлено (не задан — файла нет, дверь родит);
 * - `tuning` — ключ `baser` файла настроек обвеса, как настроено (не задан —
 *   файла нет; это не пробел, а «ничего не выбрано»: работают дефолты).
 */
export function installConsumer(options = {}) {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-'));
  // Имя каталога значимо, а не косметика: до 0.3.0 из него резолверы обвеса
  // считали имя девбокса и алиас в сети, сейчас оно запасной вариант.
  const root = join(box, options.repoName ?? 'baser');
  mkdirSync(root, { recursive: true });

  const manifest =
    options.manifest === undefined
      ? {
          name: options.repoName ?? 'baser',
          version: '0.0.0',
          private: true,
          devDependencies: { [DEVBOX_PACKAGE]: '0.1.0' },
        }
      : options.manifest;
  if (manifest !== null) {
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  if (options.gitOrigin !== undefined && options.gitOrigin !== null) {
    writeGit(root, options.gitOrigin, options.gitLayout ?? 'dir');
  }

  const sourceRoot = join(root, 'node_modules', DEVBOX_PACKAGE);
  mkdirSync(dirname(sourceRoot), { recursive: true });
  cpSync(packedRoot(), sourceRoot, { recursive: true });

  const consumer = {
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
    cleanup() {
      rmSync(box, { force: true, recursive: true });
    },
    /** Перезаписывает файл настроек — то же, что сделал бы человек руками. */
    tune(block) {
      consumer.write(tuningPath(), tuningText(block));
    },
    /** Файл настроек как текст: ровно то, что увидит человек. */
    readTuning() {
      return consumer.read(tuningPath());
    },
  };

  if (options.config !== undefined) {
    consumer.write(
      'baser.json',
      `${JSON.stringify(options.config, null, 2)}\n`,
    );
  }
  if (options.tuning !== undefined) {
    consumer.tune(options.tuning);
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) {
    consumer.write(path, content);
  }

  return consumer;
}

/**
 * Настоящая раскладка git, а не заглушка «файл с нужной строкой».
 *
 * `dir` — обычный клон: `.git` каталогом, настройки внутри. `file` — рабочее
 * дерево (`git worktree`): `.git` ФАЙЛОМ с адресом служебного каталога, а
 * настройки общие и лежат по `commondir`. Вторая раскладка существует не ради
 * полноты: разработчик, у которого репозиторий разложен рабочими деревьями,
 * получил бы имя каталога вместо имени репозитория — то есть ровно тот дефект,
 * который чинится.
 */
export function writeGit(root, url, layout = 'dir') {
  const config = `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`;

  if (layout === 'dir') {
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'config'), config);
    return;
  }

  const common = join(root, '..', '.bare');
  const worktree = join(common, 'worktrees', 'wt');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(common, 'config'), config);
  writeFileSync(join(worktree, 'commondir'), '../..\n');
  writeFileSync(join(root, '.git'), `gitdir: ${worktree}\n`);
}

/**
 * `baser.json` — ЧТО ПОСТАВЛЕНО, и больше ничего (форма 2, `tasker:BASER2-10` §3).
 *
 * Значения и выбор пресетов уехали отсюда в файл на инструмент: `baser.json`
 * отвечает на вопрос «что стоит», файл настроек — «как настроено». Ссылки на
 * второй в первом нет намеренно, поэтому и здесь её нет: путь считается из
 * личности обвеса правилом, а не записью, которая могла бы разъехаться.
 */
export function consumerConfig() {
  return {
    formVersion: FORM_VERSION,
    sources: [{ use: DEVBOX_PACKAGE }],
  };
}

/** Содержимое ключа `baser` в файле настроек: выбор пресетов и заполненное. */
export function tuning({ presets, settings } = {}) {
  return {
    ...(presets === undefined ? {} : { presets }),
    ...(settings === undefined ? {} : { settings }),
  };
}

/**
 * Путь файла настроек девбокса у потребителя.
 *
 * Считается ИЗ ЛИЧНОСТИ ОБВЕСА тем же правилом, что у двери, и берёт её из
 * опубликованного объявления — не из константы теста. Задай проба путь руками,
 * она зеленела бы на файле, которого дверь не читает, ровно в тот день, когда
 * личность обвеса сменится.
 */
export function tuningPath() {
  return sourceConfigPath(packedManifest().baser.source.id);
}

/**
 * Файл настроек как текст.
 *
 * ── ПОЧЕМУ ЗДЕСЬ СВОЙ ВЫВОД, А НЕ РАЗБОРЩИК YAML ────────────────────────────
 *
 * У пакета обвеса нет зависимостей вовсе — он контент, а не код, — и заводить
 * их ради фикстуры значило бы платить за пробу свойством самого пакета.
 * Разъехаться с разборщиком двери этот вывод не может по построению: **JSON —
 * подмножество YAML**, поэтому каждый скаляр печатается `JSON.stringify` и
 * читается однозначно. Кавычки здесь не украшение: `"22"` без них стало бы
 * числом, а `@omnifield` — синтаксической ошибкой.
 *
 * И отдельно: соврать молча этот вывод тоже не может. Значения из файла
 * приезжают в артефакт через дверь, и каждая проба зоны читает именно артефакт,
 * а не то, что фикстура думала записать.
 */
export function tuningText(block) {
  return `${[`${SOURCE_CONFIG_KEY}:`, ...entries(block, '  ')].join('\n')}\n`;
}

function entries(value, indent) {
  return Object.entries(value).flatMap(([key, item]) =>
    line(key, item, indent),
  );
}

function line(rawKey, value, indent) {
  // Ключ печатается В КАВЫЧКАХ, и это не украшение: ключами карты бывают ссылки
  // на фичи (`ghcr.io/devcontainers/features/github-cli:1`), а двоеточие внутри
  // голого ключа YAML читает как разделитель. JSON — подмножество YAML, поэтому
  // закавыченный ключ читается однозначно каким угодно разборщиком.
  const key = JSON.stringify(rawKey);
  if (Array.isArray(value)) {
    return value.length === 0
      ? [`${indent}${key}: []`]
      : [
          `${indent}${key}:`,
          ...value.map((item) => `${indent}  - ${JSON.stringify(item)}`),
        ];
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).length === 0
      ? [`${indent}${key}: {}`]
      : [`${indent}${key}:`, ...entries(value, `${indent}  `)];
  }
  return [`${indent}${key}: ${JSON.stringify(value)}`];
}

/** Живой артефакт ЭТОГО репозитория — эталон приёмки. */
export function liveArtifact(dest) {
  return readFileSync(join(REPO_ROOT, dest), 'utf-8');
}

/** JSONC → JSON: комментарии разрешены спецификацией Dev Containers. */
export function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

/**
 * Строки, которыми два текста отличаются, — по номеру строки.
 *
 * Приёмка обязана назвать расхождения ПОИМЁННО, а не «отличается»: список
 * номеров превращает «до настроек» из обещания в проверяемое утверждение.
 */
export function differingLines(left, right) {
  const a = left.split('\n');
  const b = right.split('\n');
  const out = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      out.push({ line: index + 1, ours: a[index], live: b[index] });
    }
  }
  return out;
}
