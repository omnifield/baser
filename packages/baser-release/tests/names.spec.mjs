import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { nameCard, readPackages, readPublicNames } from '../lib/repo.mjs';

/**
 * КАРТА ИМЁН ПРОТИВ ЖИВОЙ РАСКЛАДКИ — и печать, какой её видит конвейер.
 *
 * Единичные пробы (`lib/repo.spec.mjs`) проверяют чтение объявления на
 * репозиториях-времянках: там форма отказа. Здесь другое — согласованность
 * объявления с ЭТИМ репозиторием, тем самым, который завтра выпускают наружу.
 * Времянка о новом пакете, заведённом соседней зоной, не узнает никогда.
 *
 * ЗАЧЕМ ЭТО ПРОБОЙ, ЕСЛИ КАРТА И ТАК ОТКАЗЫВАЕТСЯ НЕПОЛНОЙ. Отказ бинаря
 * увидит тот, кто его позвал, — то есть конвейер выпуска, в момент выпуска.
 * Проба показывает то же самое автору нового пакета, на его же PR: заводя
 * пакет, объявляешь имя, под которым он поедет наружу. Между этими двумя
 * моментами — недели.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, '..');
const ROOT = join(PACKAGE, '..', '..');
const BIN = join(PACKAGE, 'bin', 'release-names.mjs');

/** @type {string[]} */
const времянки = [];

afterEach(() => {
  while (времянки.length > 0) {
    rmSync(/** @type {string} */ (времянки.pop()), {
      recursive: true,
      force: true,
    });
  }
});

function run(/** @type {string[]} */ args = []) {
  const { status, stdout, stderr } = spawnSync('node', [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  return { code: status, stdout, stderr };
}

describe('карта имён этого репозитория', () => {
  it('объявлен КАЖДЫЙ пакет монорепы — новый не проедет молча', () => {
    const пакеты = readPackages(ROOT)
      .map((pkg) => pkg.name)
      .sort();
    const объявлены = [...readPublicNames(ROOT).keys()].sort();

    // Сравнение множеств, а не подсчёт: так в красном видно, чего именно не
    // хватает и что объявлено лишним, — без похода в оба файла глазами.
    expect(
      объявлены,
      'public-names.json разошёлся с раскладкой репозитория: завели пакет и не объявили публичное имя (или объявили имя снятого).',
    ).toEqual(пакеты);
  });

  it('карта собирается целиком — обе стороны согласованы', () => {
    const { packages } = nameCard(ROOT);

    expect(packages).toHaveLength(readPackages(ROOT).length);
    for (const pkg of packages) {
      expect(pkg.publicName, `${pkg.name}: публичное имя пусто`).toBeTruthy();
      expect(pkg.dir).toContain('packages');
    }
  });

  /**
   * Публичное имя — не прежнее. Совпадение сегодня историческое: до переезда на
   * `kb:MECH-15` обе роли играло одно имя, и путать их нельзя — прежнее имя
   * мёртвое (по нему ищут теги), публичное живое (под ним публикуют).
   */
  it('публичное имя пакета живёт своей жизнью от прежних', () => {
    const cli = nameCard(ROOT).packages.find(
      (pkg) => pkg.name === '@baser/cli',
    );

    expect(cli?.publicName).toBe('@omnifield/baser-cli');
    expect(cli?.formerNames).toEqual(['@omnifield/baser-cli']);
  });
});

describe('печать для конвейера', () => {
  it('stdout — чистый джейсон, и он равен тому, что отдаёт библиотека', () => {
    const { code, stdout } = run();

    expect(code).toBe(0);
    // Разбор без единой поблажки: лишняя строка приветствия здесь сломала бы
    // `jq` в шаге конвейера, а у нас прогон остался бы зелёным.
    expect(JSON.parse(stdout)).toEqual(nameCard(ROOT));
  });

  it('карту зовут не из нашего каталога — судится названный корень', () => {
    const { code, stdout } = run(['--root', ROOT]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).packages.length).toBeGreaterThan(0);
  });

  it('пакет не объявлен — отказ в stderr, а stdout ПУСТ', () => {
    // Половина карты хуже её отсутствия: конвейер, получивший json без пакета,
    // опубликует остальные и промолчит о пропавшем.
    const root = mkdtempSync(join(tmpdir(), 'baser-names-'));
    времянки.push(root);
    mkdirSync(join(root, 'packages', 'baser-release'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'baser-release', 'package.json'),
      JSON.stringify({ name: '@чужое/release', version: '0.0.1' }),
    );

    const { code, stdout, stderr } = run(['--root', root]);

    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('объявления публичных имён нет');
  });

  it('без каталога у --root не печатает наугад', () => {
    const { code, stdout, stderr } = run(['--root']);

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('не назван каталог');
  });
});
