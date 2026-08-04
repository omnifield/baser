import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ЗАПУСК ИНСТРУМЕНТА — тем же способом, каким его зовёт CI: голым `node` по
 * файлу, без установки зависимостей и без сборки.
 *
 * Проба здесь не дублирует суждение (оно проверено отдельно), а держит то, что
 * ломается молча: путь запуска, код выхода и то, что запускать нечего ставить.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, '..');
const ROOT = join(PACKAGE, '..', '..');
const BIN = join(PACKAGE, 'bin', 'release-guard.mjs');

function run(args = []) {
  const { status, stdout, stderr } = spawnSync('node', [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  return { code: status, stdout, stderr };
}

describe('гейт как запускают', () => {
  it.runIf(existsSync(join(ROOT, '.git')))(
    'на текущем дереве зелёный и печатает своё «сказано»',
    () => {
      const { code, stdout } = run();
      expect(code).toBe(0);
      expect(stdout).toContain('Гейт выпуска: номера называют цену изменения.');
    },
  );

  it.runIf(existsSync(join(ROOT, '.git')))(
    'по просьбе отдаёт трейсы — и отдельно от «сказано»',
    () => {
      const { code, stdout, stderr } = run(['--trace']);
      expect(code).toBe(0);
      expect(stderr).toContain('[trace]');
      expect(stderr).toContain('release.verdict');
      expect(stdout).not.toContain('[trace]');
    },
  );

  it('без каталога у --root отказывается запускаться, а не судит наугад', () => {
    const { code, stderr } = run(['--root']);
    expect(code).toBe(2);
    expect(stderr).toContain('не назван каталог');
  });
});

describe('свойство инструмента', () => {
  /**
   * Джоб гейта в CI — `checkout` + `setup-node` + запуск, без `pnpm install`:
   * гейт, который держит выпуск, не стоит в очереди за реестром и токенами.
   * Появится зависимость — джоб придётся менять, и узнать об этом надо здесь,
   * а не на красном конвейере.
   */
  it('зависимостей нет — иначе его нельзя запускать из голого checkout', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, 'package.json'), 'utf-8'),
    );
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  it('пакет публикуемый и называет свой запуск', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, 'package.json'), 'utf-8'),
    );
    expect(manifest.private).toBeUndefined();
    expect(manifest.publishConfig?.access).toBe('public');
    expect(manifest.bin['baser-release-guard']).toBe('./bin/release-guard.mjs');
  });
});
