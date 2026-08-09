import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readFormerNames, readPackages } from './repo.mjs';

/**
 * ОБЪЯВЛЕНИЕ ПРЕЖНИХ ИМЁН — здесь проверяется чтение факта, а не суждение о нём.
 *
 * Читается оно с диска судимого репозитория, поэтому пробы строят репозиторий
 * целиком — из каталога и файлов, а не из подменённого модуля: подмена доказала
 * бы, что мок работает.
 *
 * Разница между «файла нет» и «файл не разбирается» — не педантизм, а суть
 * работы: молчаливая пустая карта на битом файле означала бы ровно ту слепоту,
 * из-за которой всё это написано (`tasker:BASER2-260`).
 */
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

/**
 * Репозиторий-времянка: объявление зоны release и, по надобности, пакеты.
 *
 * @param {{declaration?: string, packages?: Record<string, object>}} shape
 */
function репозиторий({ declaration, packages = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baser-release-'));
  времянки.push(root);

  mkdirSync(join(root, 'packages', 'baser-release'), { recursive: true });
  if (declaration !== undefined) {
    writeFileSync(
      join(root, 'packages', 'baser-release', 'former-names.json'),
      declaration,
    );
  }

  for (const [dir, manifest] of Object.entries(packages)) {
    mkdirSync(join(root, 'packages', dir), { recursive: true });
    writeFileSync(
      join(root, 'packages', dir, 'package.json'),
      JSON.stringify(manifest),
    );
  }

  return root;
}

describe('объявление прежних имён', () => {
  it('файла нет — карта пуста: репозиторий без переименований ничего не должен', () => {
    expect(readFormerNames(репозиторий())).toEqual(new Map());
  });

  it('объявленные имена читаются как есть', () => {
    const root = репозиторий({
      declaration: JSON.stringify({
        formerNames: { '@новое/p': ['@старое/p', '@совсем-старое/p'] },
      }),
    });

    expect(readFormerNames(root).get('@новое/p')).toEqual([
      '@старое/p',
      '@совсем-старое/p',
    ]);
  });

  it('битый JSON — ошибка с названным файлом, а не пустая карта', () => {
    const root = репозиторий({ declaration: '{ formerNames: }' });

    expect(() => readFormerNames(root)).toThrowError(
      /former-names\.json: объявление прежних имён не разбирается как JSON/,
    );
  });

  it('не тот вид — ошибка называет ожидаемую форму', () => {
    const root = репозиторий({
      declaration: JSON.stringify({ formerNames: ['@старое/p'] }),
    });

    expect(() => readFormerNames(root)).toThrowError(/ожидался объект/);
  });

  it('прежние имена не списком строк — ошибка называет пакет', () => {
    const root = репозиторий({
      declaration: JSON.stringify({ formerNames: { '@новое/p': '@старое/p' } }),
    });

    expect(() => readFormerNames(root)).toThrowError(
      /прежние имена "@новое\/p" — ожидался список непустых строк/,
    );
  });
});

describe('пакеты монорепы', () => {
  it('несут свои прежние имена — их берёт факт выпусков', () => {
    const root = репозиторий({
      declaration: JSON.stringify({
        formerNames: { '@новое/cli': ['@старое/cli'] },
      }),
      packages: {
        'baser-cli': { name: '@новое/cli', version: '0.2.0' },
        'baser-pack': { name: '@новое/pack', version: '0.1.0' },
      },
    });

    const packages = readPackages(root);

    expect(packages.find((pkg) => pkg.zone === 'cli')?.formerNames).toEqual([
      '@старое/cli',
    ]);
    // Не переименованный пакет объявлять нечего — и это не «нет данных», а
    // пустой список: гейт ищет историю ровно под одним именем.
    expect(packages.find((pkg) => pkg.zone === 'pack')?.formerNames).toEqual([]);
  });
});
