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

/** Репозиторий потребителя с ПОСТАВЛЕННЫМ обвесом. */
export function installConsumer(options = {}) {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-'));
  // Имя каталога значимо, а не косметика: из него резолверы обвеса считают имя
  // девбокса и алиас в сети.
  const root = join(box, options.repoName ?? 'baser');
  mkdirSync(root, { recursive: true });

  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: options.repoName ?? 'baser',
        version: '0.0.0',
        private: true,
        devDependencies: { [DEVBOX_PACKAGE]: '0.1.0' },
      },
      null,
      2,
    )}\n`,
  );

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

/** Конфиг потребителя: обвес + перечисленные пресеты + заполненное. */
export function consumerConfig({ presets = [], settings } = {}) {
  return {
    formVersion: 1,
    sources: [
      {
        use: DEVBOX_PACKAGE,
        ...(presets.length > 0 ? { presets } : {}),
        ...(settings !== undefined ? { settings } : {}),
      },
    ],
  };
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
