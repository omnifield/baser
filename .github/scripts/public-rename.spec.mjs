/**
 * Пробы переименования перед публикацией.
 *
 * Здесь судится ровно то, что уезжает наружу и не отзывается: имя пакета, ссылки
 * на соседей и спецификаторы в поставляемом коде. Ошибка в этом месте видна не на
 * прогоне, а у потребителя — установкой, поэтому мутации проверены на каждой
 * границе: подпуть, роль имени, отказ вместо тихого «оставим как есть».
 *
 * КАРТА ИМЁН ЗДЕСЬ — ФИКСТУРА, а не объявление. Правило «внутреннее → публичное»
 * объявляет зона `release` одной картой на репозиторий (`tasker:BASER2-261`);
 * пробе она приходит аргументом, как и конвейеру.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  RenameRefusal,
  describe as describeReport,
  mentions,
  rename,
  renameManifest,
  renameSource,
  renameSpecifier,
  resolveWorkspace,
  shippedFiles,
  splitSpecifier,
} from './public-rename.mjs';

const NAMES = new Map([
  ['@baser/cli', '@omnifield/baser-cli'],
  ['@baser/contracts', '@omnifield/baser-contracts'],
  ['@baser/pack', '@omnifield/baser-pack'],
]);

/** @type {string[]} */
const temporary = [];

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/** @param {Record<string, string>} files */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'public-rename-'));
  temporary.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('спецификатор разбирается на имя и подпуть', () => {
  it('скоуп — это два сегмента, а не один', () => {
    expect(splitSpecifier('@baser/contracts')).toEqual({
      name: '@baser/contracts',
      subpath: '',
    });
  });

  it('подпуть отделяется и не теряется', () => {
    expect(splitSpecifier('@baser/contracts/locate')).toEqual({
      name: '@baser/contracts',
      subpath: 'locate',
    });
  });

  it('имя без скоупа — один сегмент', () => {
    expect(splitSpecifier('yaml/dist/parse')).toEqual({
      name: 'yaml',
      subpath: 'dist/parse',
    });
  });
});

describe('переименование спецификатора', () => {
  it('имя из карты меняется', () => {
    expect(renameSpecifier('@baser/contracts', NAMES)).toBe(
      '@omnifield/baser-contracts',
    );
  });

  it('ПОДПУТЬ СОХРАНЯЕТСЯ — иначе резолв уедет в другую поверхность', () => {
    expect(renameSpecifier('@baser/contracts/locate', NAMES)).toBe(
      '@omnifield/baser-contracts/locate',
    );
  });

  it('чужой пакет не трогается', () => {
    expect(renameSpecifier('yaml', NAMES)).toBe('yaml');
    expect(renameSpecifier('@types/node', NAMES)).toBe('@types/node');
  });
});

describe('переименование поставляемого кода', () => {
  it('обычный импорт', () => {
    expect(renameSource("import { a } from '@baser/contracts';", NAMES)).toBe(
      "import { a } from '@omnifield/baser-contracts';",
    );
  });

  it('импорт ради побочного действия', () => {
    expect(renameSource("import '@baser/pack';", NAMES)).toBe(
      "import '@omnifield/baser-pack';",
    );
  });

  it('реэкспорт', () => {
    expect(renameSource("export * from '@baser/pack';", NAMES)).toBe(
      "export * from '@omnifield/baser-pack';",
    );
  });

  it('динамический импорт', () => {
    expect(renameSource("await import('@baser/cli/door');", NAMES)).toBe(
      "await import('@omnifield/baser-cli/door');",
    );
  });

  it('require — на случай, если поставляемое не ESM', () => {
    expect(renameSource('require("@baser/pack")', NAMES)).toBe(
      'require("@omnifield/baser-pack")',
    );
  });

  it('ТИП ИЗ ОБЪЯВЛЕНИЯ: import(…) в позиции типа — тот же import', () => {
    expect(
      renameSource(
        'export declare function plan(): import("@baser/contracts").Declaration;',
        NAMES,
      ),
    ).toBe(
      'export declare function plan(): import("@omnifield/baser-contracts").Declaration;',
    );
  });

  it('кавычки остаются теми же, какими были', () => {
    expect(renameSource('from "@baser/pack"', NAMES)).toBe(
      'from "@omnifield/baser-pack"',
    );
  });

  it('ПРОЗА НЕ ТРОГАЕТСЯ — комментарий про пакет остаётся комментарием', () => {
    const text = '// `@baser/cli` — дверь. Зовёт `@baser/pack`.\n';
    expect(renameSource(text, NAMES)).toBe(text);
  });

  it('ИМЯ УСЛОВИЯ РЕЗОЛВА не спецификатор: JSON остаётся нетронутым', () => {
    // Имя взято ИЗ КАРТЫ намеренно: с именем, которого в карте нет, эта проба
    // зеленела бы и на замене по всему файлу — то есть не судила бы ничего.
    // Правило здесь одно: трогается позиция спецификатора, а не строка.
    const text = '{"exports": {".": {"@baser/cli": "./src/index.ts"}}}';
    expect(renameSource(text, NAMES)).toBe(text);
  });

  it('несколько ссылок в одном файле — все', () => {
    const after = renameSource(
      "import { a } from '@baser/contracts';\nimport { b } from '@baser/pack';\n",
      NAMES,
    );
    expect(after).toContain("'@omnifield/baser-contracts'");
    expect(after).toContain("'@omnifield/baser-pack'");
    expect(after).not.toContain('@baser/');
  });
});

describe('ссылка на соседа превращается в номер', () => {
  it('звёздочка — точный номер', () => {
    expect(resolveWorkspace('workspace:*', '1.2.3')).toBe('1.2.3');
  });

  it('голый спецификатор — тоже точный', () => {
    expect(resolveWorkspace('workspace:', '1.2.3')).toBe('1.2.3');
  });

  it('крышка и тильда — диапазон от номера', () => {
    expect(resolveWorkspace('workspace:^', '1.2.3')).toBe('^1.2.3');
    expect(resolveWorkspace('workspace:~', '1.2.3')).toBe('~1.2.3');
  });

  it('названный человеком диапазон остаётся его диапазоном', () => {
    expect(resolveWorkspace('workspace:^2.0.0', '1.2.3')).toBe('^2.0.0');
  });
});

describe('манифест в публичной форме', () => {
  const versions = new Map([
    ['@baser/cli', '0.9.0'],
    ['@baser/contracts', '0.4.0'],
    ['@baser/pack', '0.2.0'],
  ]);

  const manifest = {
    name: '@baser/cli',
    version: '0.9.0',
    exports: { '.': { '@baser/source': './src/index.ts', default: './dist/index.js' } },
    dependencies: { '@baser/contracts': 'workspace:*', yaml: '^2.9.0' },
    devDependencies: { '@baser/pack': 'workspace:^' },
  };

  it('имя пакета — публичное', () => {
    expect(renameManifest(manifest, NAMES, versions).name).toBe(
      '@omnifield/baser-cli',
    );
  });

  it('ссылка на соседа — публичное имя и точный номер', () => {
    expect(renameManifest(manifest, NAMES, versions).dependencies).toEqual({
      '@omnifield/baser-contracts': '0.4.0',
      yaml: '^2.9.0',
    });
  });

  it('блоки помимо dependencies тоже переписаны', () => {
    expect(renameManifest(manifest, NAMES, versions).devDependencies).toEqual({
      '@omnifield/baser-pack': '^0.2.0',
    });
  });

  it('УСЛОВИЕ РЕЗОЛВА В EXPORTS ОСТАЁТСЯ: это имя условия, а не пакета', () => {
    expect(renameManifest(manifest, NAMES, versions).exports).toEqual(
      manifest.exports,
    );
  });

  it('манифест в дереве не тронут — переименование отдаёт копию', () => {
    renameManifest(manifest, NAMES, versions);
    expect(manifest.name).toBe('@baser/cli');
    expect(manifest.dependencies['@baser/contracts']).toBe('workspace:*');
  });

  it('workspace: в манифесте не остаётся ни одного', () => {
    const renamed = renameManifest(manifest, NAMES, versions);
    expect(JSON.stringify(renamed)).not.toContain('workspace:');
  });

  it('ОТКАЗ: у пакета нет объявленного публичного имени', () => {
    expect(() =>
      renameManifest({ name: '@baser/новый', version: '0.1.0' }, NAMES, versions),
    ).toThrow(RenameRefusal);
  });

  it('ОТКАЗ: у соседа, на которого ссылаются, имени нет', () => {
    expect(() =>
      renameManifest(
        {
          name: '@baser/cli',
          version: '0.9.0',
          dependencies: { '@baser/devbox': 'workspace:*' },
        },
        NAMES,
        versions,
      ),
    ).toThrow(/@baser\/devbox/);
  });

  it('ОТКАЗ: сосед объявлен, но его нет в рабочем дереве — нечем заменить', () => {
    expect(() =>
      renameManifest(
        {
          name: '@baser/cli',
          version: '0.9.0',
          dependencies: { '@baser/pack': 'workspace:*' },
        },
        NAMES,
        new Map([['@baser/cli', '0.9.0']]),
      ),
    ).toThrow(RenameRefusal);
  });
});

describe('переименование рабочего дерева', () => {
  /** @param {string[]} files */
  const shipped = (files) => () => files;

  it('манифест и код переписаны, отчёт называет обоих', () => {
    const root = tree({
      'packages/baser-cli/package.json': JSON.stringify({
        name: '@baser/cli',
        version: '0.9.0',
        dependencies: { '@baser/contracts': 'workspace:*' },
      }),
      'packages/baser-cli/dist/index.js':
        "import { locate } from '@baser/contracts/locate';\n",
      'packages/baser-contracts/package.json': JSON.stringify({
        name: '@baser/contracts',
        version: '0.4.0',
      }),
      'packages/baser-contracts/dist/index.js': 'export const a = 1;\n',
    });

    const report = rename(root, NAMES, {
      read: (path) => readFileSync(path, 'utf-8'),
      write: (path, text) => writeFileSync(path, text),
      shipped: shipped(['package.json', 'dist/index.js']),
    });

    expect(
      JSON.parse(readFileSync(join(root, 'packages/baser-cli/package.json'), 'utf-8')),
    ).toEqual({
      name: '@omnifield/baser-cli',
      version: '0.9.0',
      dependencies: { '@omnifield/baser-contracts': '0.4.0' },
    });

    expect(readFileSync(join(root, 'packages/baser-cli/dist/index.js'), 'utf-8')).toBe(
      "import { locate } from '@omnifield/baser-contracts/locate';\n",
    );

    expect(report.renamed).toEqual([
      {
        internal: '@baser/cli',
        public: '@omnifield/baser-cli',
        version: '0.9.0',
        dir: 'packages/baser-cli',
        sources: 1,
      },
      {
        internal: '@baser/contracts',
        public: '@omnifield/baser-contracts',
        version: '0.4.0',
        dir: 'packages/baser-contracts',
        sources: 0,
      },
    ]);
  });

  it('НЕВЫПУСКАЕМЫЙ пакет не трогается и имени не требует', () => {
    const root = tree({
      'packages/baser-cli/package.json': JSON.stringify({
        name: '@baser/cli',
        version: '0.9.0',
      }),
      'packages/своё/package.json': JSON.stringify({
        name: '@baser/своё',
        version: '0.0.0',
        private: true,
      }),
    });

    const report = rename(root, NAMES, {
      read: (path) => readFileSync(path, 'utf-8'),
      write: (path, text) => writeFileSync(path, text),
      shipped: shipped(['package.json']),
    });

    expect(report.renamed.map((entry) => entry.internal)).toEqual(['@baser/cli']);
    expect(
      JSON.parse(readFileSync(join(root, 'packages/своё/package.json'), 'utf-8')).name,
    ).toBe('@baser/своё');
  });

  it('ПРОЗА НАЗЫВАЕТСЯ ВСЛУХ — и в отчёте, и словами для человека', () => {
    const root = tree({
      'packages/baser-cli/package.json': JSON.stringify({
        name: '@baser/cli',
        version: '0.9.0',
      }),
      'packages/baser-cli/README.md': '# `@baser/cli` — консоль\n',
    });

    const report = rename(root, NAMES, {
      read: (path) => readFileSync(path, 'utf-8'),
      write: (path, text) => writeFileSync(path, text),
      shipped: shipped(['package.json', 'README.md']),
    });

    expect(report.prose).toEqual([
      { file: 'packages/baser-cli/README.md', names: ['@baser/cli'] },
    ]);
    expect(readFileSync(join(root, 'packages/baser-cli/README.md'), 'utf-8')).toBe(
      '# `@baser/cli` — консоль\n',
    );
    expect(describeReport(report).join('\n')).toContain('README.md');
  });

  it('отказ одного пакета останавливает шаг — до реестра, а не после', () => {
    const root = tree({
      'packages/baser-новый/package.json': JSON.stringify({
        name: '@baser/новый',
        version: '0.1.0',
      }),
    });

    expect(() =>
      rename(root, NAMES, {
        read: (path) => readFileSync(path, 'utf-8'),
        write: () => {
          throw new Error('писать было нечего');
        },
        shipped: shipped(['package.json']),
      }),
    ).toThrow(RenameRefusal);
  });
});

describe('состав тарбола спрашивается у npm, а не выводится из files', () => {
  it('живой пакет этого репозитория: npm называет и то, чего нет в files', () => {
    const files = shippedFiles('packages/baser-git');

    // `files` объявляет `template` и `warning.mjs`; манифест и README npm кладёт
    // сам. Разбор поля дал бы неполный список — и переименование прошло бы мимо
    // того, что реально уезжает.
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
    expect(files.some((file) => file.startsWith('template/'))).toBe(true);
  });
});

describe('живое дерево: то, что уедет, переименовывается без остатка', () => {
  it('НИ ОДНОГО спецификатора с внутренним именем не остаётся в поставляемом', () => {
    // Карта строится по канону `kb:MECH-15` от имён самого дерева — здесь это
    // фикстура пробы, а не объявление: объявляет зона `release`.
    const packages = JSON.parse(
      execFileSync('node', [
        '-e',
        "const {readdirSync,readFileSync,existsSync}=require('node:fs');" +
          "const out=readdirSync('packages').filter(d=>existsSync(`packages/${d}/package.json`))" +
          '.map(d=>JSON.parse(readFileSync(`packages/${d}/package.json`,"utf-8")))' +
          '.filter(m=>!m.private).map(m=>m.name);' +
          'console.log(JSON.stringify(out));',
      ], { encoding: 'utf-8' }),
    );
    const names = new Map(
      packages.map((/** @type {string} */ name) => [
        name,
        `@omnifield/baser-${name.slice('@baser/'.length)}`,
      ]),
    );

    /** @type {Map<string, string>} */
    const written = new Map();
    const report = rename(process.cwd(), names, {
      read: (path) => written.get(path) ?? readFileSync(path, 'utf-8'),
      write: (path, text) => void written.set(path, text),
      shipped: shippedFiles,
    });

    // На диск не ушло ничего: дерево репозитория остаётся внутренним.
    expect(report.renamed).toHaveLength(packages.length);
    // И проба не пустая: в живом дереве спецификаторы ЕСТЬ, и они переписаны.
    expect(
      report.renamed.reduce((sum, entry) => sum + entry.sources, 0),
    ).toBeGreaterThan(30);

    // ПОДПУТЬ ПЕРЕЖИЛ ЖИВОЕ ДЕРЕВО, а не только фикстуру: дверь ходит в соседа
    // подпутём, и потеря хвоста здесь молча увела бы резолв в другую поверхность.
    expect(
      written.get(join(process.cwd(), 'packages/baser-cli/dist/lib/supply.js')),
    ).toContain("'@omnifield/baser-contracts/locate'");

    for (const [path, text] of written) {
      if (!path.endsWith('package.json')) {
        expect(text, `${path}: остался спецификатор с внутренним именем`).not.toMatch(
          /\b(from|import|require)\s*\(?\s*['"]@baser\//,
        );
        continue;
      }
      const manifest = JSON.parse(text);
      expect(manifest.name).toMatch(/^@omnifield\/baser-/);
      expect(JSON.stringify(manifest.dependencies ?? {})).not.toContain('workspace:');
      expect(
        Object.keys(manifest.dependencies ?? {}).filter((dep) =>
          dep.startsWith('@baser/'),
        ),
        `${path}: ссылка на соседа осталась под внутренним именем`,
      ).toEqual([]);
    }
  }, 60_000);

  it('мера прозы названа числом, а не словом «немного»', () => {
    const text = readFileSync('packages/baser-git/README.md', 'utf-8');
    expect(mentions(text, ['@baser/git', '@baser/нетакого'])).toEqual(['@baser/git']);
  });
});
