/**
 * НАСТОЯЩИЙ обвес как испытуемый образец для проверки.
 *
 * Проба берёт `packages/baser-devbox` — тот самый обвес, который мы выпускаем, —
 * и ломает его КОПИЮ по одному пункту за раз. Синтетический обвес из трёх строк
 * подтвердил бы только то, что код проходит сам по себе: он не знает ни про три
 * настройки с одним резолвером, ни про белый список `files`, ни про шаблон, у
 * которого рядом лежит нерендеримый сосед.
 *
 * Копия обязательна: зона проверки ничего не пишет, и уж точно не в чужую.
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
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

const copies: string[] = [];

/** Копия живого обвеса во временном каталоге — её и ломают. */
export function copyDevbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'baser-check-'));
  cpSync(DEVBOX_ROOT, root, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });
  copies.push(root);
  return root;
}

/** Пустой каталог — «это вообще не пакет». */
export function emptyDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'baser-check-empty-'));
  copies.push(root);
  return root;
}

/** Убирает за пробой. Копии живут ровно один тест. */
export function cleanupCopies(): void {
  while (copies.length > 0) {
    const root = copies.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/** Правит манифест копии — точечная поломка одного пункта. */
export function editManifest(
  root: string,
  edit: (manifest: Manifest) => void,
): void {
  const path = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
  edit(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Правит блок `baser` — самая частая точка поломки. */
export function editDeclaration(
  root: string,
  edit: (declaration: Declaration) => void,
): void {
  editManifest(root, (manifest) => {
    edit(manifest.baser);
  });
}

export interface Declaration {
  formVersion: number;
  source: { id: string; title: string; contentRoot: string };
  settings: Record<string, Record<string, unknown>>;
  presets: Record<string, unknown>;
  layout: { src: string; dest: string; render?: boolean }[];
}

export interface Manifest {
  name?: unknown;
  version?: unknown;
  files?: unknown;
  baser: Declaration;
}
