/**
 * НАСТОЯЩИЙ обвес как образец для сборки.
 *
 * Проба берёт `packages/baser-devbox` — тот самый обвес, который мы выпускаем, —
 * и собирает нагрузку из него, а не из выдуманного пакета в три строки.
 * Выдуманный не знает ни про белый список `files`, ни про три настройки с
 * резолвером в одном модуле, ни про нерендеримого соседа рядом с шаблоном.
 *
 * Ломается всегда КОПИЯ: зона упаковки пишет только туда, куда её попросили, и
 * уж точно не в чужую.
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень живого обвеса девбокса в этой монорепе. */
export const DEVBOX_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../baser-devbox',
);

const boxes: string[] = [];

/** Временный каталог-песочница. Живёт ровно один тест. */
export function sandbox(): string {
  const box = mkdtempSync(join(tmpdir(), 'baser-pack-'));
  boxes.push(box);
  return box;
}

/** Копия живого обвеса — её и ломают. */
export function copyDevbox(): string {
  const root = join(sandbox(), 'devbox');
  cpSync(DEVBOX_ROOT, root, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });
  return root;
}

/** Путь под выдачу, которого ЕЩЁ НЕТ: упаковка создаёт его сама. */
export function target(): string {
  return join(sandbox(), 'out');
}

/** Убирает за пробой. */
export function cleanupBoxes(): void {
  while (boxes.length > 0) {
    const box = boxes.pop();
    if (box) {
      rmSync(box, { recursive: true, force: true });
    }
  }
}

/**
 * Манифест обвеса — прочитанный ОТТУДА ЖЕ, откуда его читает упаковка.
 *
 * Проба, которой нужно значение из чужого объявления (имя пакета, версия),
 * спрашивает его у объявления, а не переписывает к себе литералом: переписанное
 * расходится с источником молча и краснеет не тогда, когда что-то сломалось, а
 * тогда, когда сосед выпустился.
 */
export function readManifest(root: string): Manifest {
  return JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf-8'),
  ) as Manifest;
}

/** Правит манифест копии — точечная поломка одного пункта. */
export function editManifest(
  root: string,
  edit: (manifest: Manifest) => void,
): void {
  const manifest = readManifest(root);
  edit(manifest);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/** Все файлы дерева, путями от его корня, в байтовом порядке. */
export function treeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else {
        out.push(path);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

export interface Manifest {
  name?: unknown;
  version?: unknown;
  files?: unknown;
  baser: {
    formVersion: number;
    source: { id: string; title: string; contentRoot: string };
    settings: Record<string, Record<string, unknown>>;
    presets: Record<string, unknown>;
    layout: { src: string; dest: string; render?: boolean }[];
  };
}
