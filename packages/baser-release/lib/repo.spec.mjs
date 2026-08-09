import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  publicNames,
  readFormerNames,
  readPackages,
  readPublicNames,
} from './repo.mjs';

/**
 * ОБЪЯВЛЕНИЯ ИМЁН — здесь проверяется чтение факта, а не суждение о нём.
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
 * Репозиторий-времянка: объявления зоны release и, по надобности, пакеты.
 *
 * @param {{declaration?: string, publicDeclaration?: string, packages?: Record<string, object>}} shape
 */
function репозиторий({ declaration, publicDeclaration, packages = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baser-release-'));
  времянки.push(root);

  mkdirSync(join(root, 'packages', 'baser-release'), { recursive: true });
  if (declaration !== undefined) {
    writeFileSync(
      join(root, 'packages', 'baser-release', 'former-names.json'),
      declaration,
    );
  }
  if (publicDeclaration !== undefined) {
    writeFileSync(
      join(root, 'packages', 'baser-release', 'public-names.json'),
      publicDeclaration,
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

/**
 * ОБЪЯВЛЕНИЕ ПУБЛИЧНЫХ ИМЁН.
 *
 * Разница с прежними именами — в том, чем считается ОТСУТСТВИЕ. Там пустая
 * карта это факт: репозиторий без переименований объявлять нечего. Здесь
 * отсутствие — неотвеченный вопрос: у пакета, который едет наружу, публичное
 * имя есть, вопрос лишь в том, знаем мы его или гадаем. Поэтому тут отказ там,
 * где рядом молчание, и эту асимметрию держат пробы ниже.
 */
describe('объявление публичных имён', () => {
  it('файла нет — ОТКАЗ, а не пустая карта: гадать имя наружу нельзя', () => {
    expect(() => readPublicNames(репозиторий())).toThrowError(
      /public-names\.json: объявления публичных имён нет/,
    );
  });

  it('объявленное имя читается как есть', () => {
    const root = репозиторий({
      publicDeclaration: JSON.stringify({
        publicNames: { '@продукт/инструмент': '@бренд/продукт-инструмент' },
      }),
    });

    expect(readPublicNames(root).get('@продукт/инструмент')).toBe(
      '@бренд/продукт-инструмент',
    );
  });

  it('битый JSON — ошибка с названным файлом, а не пустая карта', () => {
    const root = репозиторий({ publicDeclaration: '{ publicNames: }' });

    expect(() => readPublicNames(root)).toThrowError(
      /public-names\.json: объявление публичных имён не разбирается как JSON/,
    );
  });

  it('не тот вид — ошибка называет ожидаемую форму', () => {
    const root = репозиторий({
      publicDeclaration: JSON.stringify({ publicNames: ['@бренд/п-и'] }),
    });

    expect(() => readPublicNames(root)).toThrowError(/ожидался объект/);
  });

  it('публичное имя не строкой — ошибка называет пакет', () => {
    const root = репозиторий({
      publicDeclaration: JSON.stringify({ publicNames: { '@п/и': '' } }),
    });

    expect(() => readPublicNames(root)).toThrowError(
      /публичное имя "@п\/и" — ожидалась непустая строка/,
    );
  });

  it('одно публичное имя на два пакета — отказ: в реестре второй затрёт первого', () => {
    const root = репозиторий({
      publicDeclaration: JSON.stringify({
        publicNames: { '@п/первый': '@бренд/п-и', '@п/второй': '@бренд/п-и' },
      }),
    });

    expect(() => readPublicNames(root)).toThrowError(
      /публичное имя "@бренд\/п-и" объявлено дважды/,
    );
  });
});

/**
 * КАРТА ИМЁН, СВЕРЕННАЯ С РАСКЛАДКОЙ, — то, что уходит конвейеру. Проверяется
 * не только содержимое, но и то, что неполную карту отдать нельзя: по половине
 * карты конвейер доезжает до публикации и выпускает внутреннее имя наружу, а
 * это уже не откатывается.
 */
describe('карта имён', () => {
  /** Репозиторий из двух пакетов, у одного — прежнее имя. */
  function двухпакетный(
    /** @type {{publicNames: Record<string, string>}} */ объявление,
  ) {
    return репозиторий({
      declaration: JSON.stringify({
        formerNames: { '@новое/cli': ['@старое/cli'] },
      }),
      publicDeclaration: JSON.stringify(объявление),
      packages: {
        'baser-cli': { name: '@новое/cli', version: '0.2.0' },
        'baser-pack': { name: '@новое/pack', version: '0.1.0', private: true },
      },
    });
  }

  const ОБА = {
    publicNames: {
      '@новое/cli': '@бренд/продукт-cli',
      '@новое/pack': '@бренд/продукт-pack',
    },
  };

  it('отдаётся плоской картой по всем пакетам и в порядке имён', () => {
    const карта = publicNames(двухпакетный(ОБА));

    // Порядок задан именем, а не обходом каталога: печать этой карты — вход
    // конвейера, и её различие между прогонами читалось бы как изменение карты.
    expect([...карта]).toEqual([
      ['@новое/cli', '@бренд/продукт-cli'],
      ['@новое/pack', '@бренд/продукт-pack'],
    ]);
  });

  it('непубликуемый пакет из карты не выпадает — имя есть и у него', () => {
    // `private` — свойство выпуска, а не признак того, что имени нет: ссылки на
    // такой пакет у соседей переписываются так же, как на любой другой.
    const карта = publicNames(двухпакетный(ОБА));

    expect(карта.get('@новое/pack')).toBe('@бренд/продукт-pack');
  });

  it('пакет без публичного имени — назван, а не пропущен молча', () => {
    const root = двухпакетный({
      publicNames: { '@новое/cli': '@бренд/продукт-cli' },
    });

    expect(() => publicNames(root)).toThrowError(
      /публичное имя не объявлено: @новое\/pack/,
    );
  });

  it('публичное имя пакета, которого нет, — отказ с названным объявлением', () => {
    const root = двухпакетный({
      publicNames: {
        ...ОБА.publicNames,
        '@новое/снятый': '@бренд/продукт-снятый',
      },
    });

    expect(() => publicNames(root)).toThrowError(
      /имена пакетов, которых в репозитории нет: @новое\/снятый \(.*public-names\.json\)/,
    );
  });

  it('прежнее имя пакета, которого нет, — такой же отказ', () => {
    const root = репозиторий({
      declaration: JSON.stringify({
        formerNames: { '@новое/снятый': ['@старое/снятый'] },
      }),
      publicDeclaration: JSON.stringify({
        publicNames: { '@новое/cli': '@бренд/продукт-cli' },
      }),
      packages: { 'baser-cli': { name: '@новое/cli', version: '0.2.0' } },
    });

    expect(() => publicNames(root)).toThrowError(
      /@новое\/снятый \(.*former-names\.json\)/,
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
