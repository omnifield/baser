/**
 * Пробы приёмки публичного выпуска.
 *
 * ЗДЕСЬ НЕТ СЕТИ И НЕТ РЕЕСТРА — и это не упрощение, а граница зоны: реестр и
 * npm исполняет чужая сторона, её судит живой прогон. Пробами покрыто то, что
 * решаем МЫ: чем именно спрашивается реестр, чем остаётся чистым чистое место,
 * что считается принятым и что — отказом.
 *
 * Цена ошибки здесь несимметрична в обе стороны. Приёмка, которая молча
 * пропустила сломанный выпуск, стоит сожжённого номера; приёмка, которая
 * краснеет на распространении пакета, стоит доверия к красному — а его потом
 * перестают читать. Поэтому проверяются обе границы.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  AcceptanceRefusal,
  REGISTRY,
  accept,
  bins,
  doors,
  installArgs,
  internalLeftovers,
  isolation,
  launched,
  plan,
  render,
  renderRefusal,
  spotOf,
  viewArgs,
} from './public-acceptance.mjs';

const SCRIPT = fileURLToPath(
  new URL('./public-acceptance.mjs', import.meta.url),
);

/** Отчёт переименования — ровно та форма, которую печатает соседний шаг. */
const REPORT = {
  renamed: [
    {
      internal: '@baser/contracts',
      public: '@omnifield/baser-contracts',
      version: '0.5.0',
      dir: 'packages/baser-contracts',
      sources: 0,
    },
    {
      internal: '@baser/cli',
      public: '@omnifield/baser-cli',
      version: '0.9.0',
      dir: 'packages/baser-cli',
      sources: 29,
    },
  ],
  prose: [],
};

/** Манифесты, как они лягут в чистый каталог после установки. */
const INSTALLED = {
  '@omnifield/baser-contracts': {
    name: '@omnifield/baser-contracts',
    version: '0.5.0',
    exports: {
      './package.json': './package.json',
      '.': { import: './dist/index.js' },
      './locate': { import: './dist/locate.js' },
    },
  },
  '@omnifield/baser-cli': {
    name: '@omnifield/baser-cli',
    version: '0.9.0',
    dependencies: { '@omnifield/baser-contracts': '0.5.0' },
    exports: { './package.json': './package.json', '.': './dist/index.js' },
    bin: { baser: './dist/bin/baser.js' },
  },
};

/** @type {string[]} */
const temporary = [];

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/**
 * Мир, которого нет: npm отвечает по сценарию, каталог существует только в памяти.
 *
 * @param {{answer?: (command: string, args: string[]) => {status: number, stdout?: string, stderr?: string}, installed?: Record<string, any>}} [script]
 */
function world(script = {}) {
  const installed = script.installed ?? INSTALLED;
  /** @type {{command: string, args: string[], cwd: string}[]} */
  const calls = [];
  /** @type {Record<string, string>} */
  const written = {};
  /** @type {number[]} */
  const pauses = [];

  const io = {
    place: () => '/чистое-место',
    /** @param {string} path */
    read: (path) => {
      const found = Object.entries(installed).find(([name]) =>
        path.includes(join('node_modules', name)),
      );
      if (!found) throw new Error(`ENOENT: ${path}`);
      return JSON.stringify(found[1]);
    },
    /** @param {string} path @param {string} text */
    write: (path, text) => {
      written[path] = text;
    },
    /** @param {string} command @param {string[]} args @param {{cwd: string}} options */
    run: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const answered = script.answer?.(command, args);
      return {
        status: answered?.status ?? 0,
        stdout: answered?.stdout ?? '',
        stderr: answered?.stderr ?? '',
      };
    },
    /** @param {number} ms */
    pause: (ms) => {
      pauses.push(ms);
    },
  };

  return { io, calls, written, pauses };
}

/** Вызовы npm/node по первому аргументу — читать пробы так короче. */
const of = (calls, kind) =>
  calls.filter((call) =>
    kind === 'npm' ? call.command === 'npm' : call.command !== 'npm',
  );

describe('принимаем то, что назвал шаг переименования', () => {
  it('имена берутся ПУБЛИЧНЫЕ, а не внутренние', () => {
    expect(plan(REPORT)).toEqual([
      {
        name: '@omnifield/baser-contracts',
        version: '0.5.0',
        internal: '@baser/contracts',
      },
      {
        name: '@omnifield/baser-cli',
        version: '0.9.0',
        internal: '@baser/cli',
      },
    ]);
  });

  it('пустой отчёт — ОТКАЗ, а не зелёная приёмка ни по чему', () => {
    // Пустая приёмка зеленеет всегда, а зовётся она уже после публикации.
    expect(() => plan({ renamed: [], prose: [] })).toThrow(AcceptanceRefusal);
    expect(() => plan({})).toThrow(AcceptanceRefusal);
  });

  it('запись без публичного имени или номера — отказ, а не догадка', () => {
    expect(() => plan({ renamed: [{ internal: '@baser/cli' }] })).toThrow(
      AcceptanceRefusal,
    );
    expect(() =>
      plan({ renamed: [{ public: '@omnifield/baser-cli' }] }),
    ).toThrow(AcceptanceRefusal);
  });
});

describe('чистое место остаётся чистым, потому что названо явно', () => {
  const spot = spotOf('/чистое-место', REGISTRY);

  it('реестр назван адресом — зеркало с машины не подцепится', () => {
    expect(isolation(spot)).toContain('--registry');
    expect(isolation(spot)).toContain(REGISTRY);
  });

  it('кэш свежий и лежит ВНУТРИ чистого места', () => {
    // Прогретый кэш отдаёт устаревшую запись вместо отказа — тогда приёмка
    // судит фантом, пакет, которого в реестре может не быть (BASER2-161).
    const args = isolation(spot);
    expect(args[args.indexOf('--cache') + 1]).toBe(
      join('/чистое-место', 'cache'),
    );
  });

  it('настройки npm — свои, а не найденные на машине', () => {
    const args = isolation(spot);
    expect(args[args.indexOf('--userconfig') + 1]).toBe(
      join('/чистое-место', 'npmrc'),
    );
  });

  it('ставится ТОЧНЫЙ номер, а не диапазон', () => {
    const args = installArgs(plan(REPORT), spot);
    expect(args).toContain('@omnifield/baser-cli@0.9.0');
    expect(args.some((arg) => arg.includes('^') || arg.includes('~'))).toBe(
      false,
    );
  });

  it('реестр спрашивается про имя И номер, а не про имя', () => {
    expect(viewArgs(plan(REPORT)[0], spot)).toContain(
      '@omnifield/baser-contracts@0.5.0',
    );
  });
});

describe('приёмка идёт в чистом каталоге и из названного реестра', () => {
  it('все вызовы идут из чистого места, а не из репозитория', () => {
    const { io, calls } = world();
    accept({ report: REPORT }, io);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.cwd).toBe('/чистое-место');
  });

  it('в чистом месте лежит свой манифест — npm не уйдёт искать корень выше', () => {
    const { io, written } = world();
    accept({ report: REPORT }, io);
    expect(written[join('/чистое-место', 'package.json')]).toContain(
      '"private": true',
    );
    expect(written[join('/чистое-место', 'npmrc')]).toBe('');
  });

  it('каждый вызов npm несёт свой реестр и свой кэш', () => {
    const { io, calls } = world();
    accept({ report: REPORT, registry: 'https://реестр.example' }, io);
    for (const call of of(calls, 'npm')) {
      expect(call.args).toContain('--registry');
      expect(call.args).toContain('https://реестр.example');
      expect(call.args).toContain('--cache');
    }
  });

  it('ни одной сборки: рабочее дерево в проверяемое не попадает', () => {
    const { io, calls } = world();
    accept({ report: REPORT }, io);
    const built = calls.filter((call) =>
      call.args.some((arg) => arg === 'build' || arg === 'pack'),
    );
    expect(built).toEqual([]);
  });
});

describe('пакет ждут в реестре ограниченно, а не вечно', () => {
  it('появился со второй попытки — приёмка идёт дальше', () => {
    // Между `npm publish` и ответом реестра бывает задержка распространения.
    // Красный на ней дефектов не находит, а доверие к красному тратит.
    let asked = 0;
    const { io, pauses } = world({
      answer: (command, args) => {
        if (command !== 'npm' || args[0] !== 'view') return { status: 0 };
        asked += 1;
        return { status: asked === 1 ? 1 : 0 };
      },
    });
    const accepted = accept({ report: REPORT }, io);
    expect(accepted.packages[0].attempts).toBe(2);
    expect(pauses.length).toBe(1);
  });

  it('не появился — ОТКАЗ с числом попыток, а не бесконечное ожидание', () => {
    const { io, pauses } = world({
      answer: (command, args) =>
        command === 'npm' && args[0] === 'view'
          ? { status: 1, stderr: 'E404' }
          : { status: 0 },
    });
    expect(() => accept({ report: REPORT, attempts: 3 }, io)).toThrow(
      /не отдаёт этот номер после 3 попыток/,
    );
    expect(pauses.length).toBe(2);
  });
});

describe('приёмка судит установленное, а не отчёт о нём', () => {
  it('установка упала — дальше не идём и говорим, что это и есть потребитель', () => {
    const { io, calls } = world({
      answer: (command, args) =>
        command === 'npm' && args[0] === 'install'
          ? { status: 1, stderr: 'ERR_PNPM_FETCH_401' }
          : { status: 0 },
    });
    expect(() => accept({ report: REPORT }, io)).toThrow(AcceptanceRefusal);
    // Ни одной загрузки после упавшей установки: судить нечего.
    expect(of(calls, 'node')).toEqual([]);
  });

  it('внутреннее имя в зависимостях установленного — ОТКАЗ', () => {
    // Ровно тот дефект, ради которого переименование существует: манифест
    // переименован, а ссылка на соседа осталась внутренней.
    const { io } = world({
      installed: {
        ...INSTALLED,
        '@omnifield/baser-cli': {
          name: '@omnifield/baser-cli',
          version: '0.9.0',
          dependencies: { '@baser/contracts': '0.5.0' },
        },
      },
    });
    expect(() => accept({ report: REPORT }, io)).toThrow(/@baser\/contracts/);
  });

  it('каждая объявленная дверь ЗАГРУЖАЕТСЯ, а не резолвится путём', () => {
    // Резолв проходит по одному файлу и не трогает то, что этот файл
    // импортирует, — а весь класс дефекта живёт на второй ступени.
    const { io, calls } = world();
    accept({ report: REPORT }, io);
    const loaded = of(calls, 'node')
      .map((call) => call.args.at(-1))
      .filter((arg) => arg?.startsWith('await import('));
    expect(loaded.join(' ')).toContain('@omnifield/baser-contracts/locate');
    expect(loaded.join(' ')).toContain('@omnifield/baser-cli');
    expect(loaded.length).toBe(3);
  });

  it('дверь не загрузилась — отказ называет ЕЁ, а не «что-то упало»', () => {
    const { io } = world({
      answer: (command, args) =>
        command !== 'npm' && args.some((arg) => arg.startsWith('await import('))
          ? { status: 1, stderr: "ERR_MODULE_NOT_FOUND '@baser/contracts'" }
          : { status: 0 },
    });
    expect(() => accept({ report: REPORT }, io)).toThrow(
      /@omnifield\/baser-contracts@0\.5\.0.*`@omnifield\/baser-contracts`/s,
    );
  });

  it('объявленная команда запускается ФАЙЛОМ из пакета, а не шимом', () => {
    const { io, calls } = world();
    const accepted = accept({ report: REPORT }, io);
    const helps = of(calls, 'node').filter((call) =>
      call.args.includes('--help'),
    );
    expect(helps.length).toBe(1);
    expect(helps[0].args[0]).toContain(
      join('node_modules', '@omnifield/baser-cli', './dist/bin/baser.js'),
    );
    expect(helps[0].args[0]).not.toContain('.bin');
    expect(accepted.packages[1].bins).toEqual(['baser']);
  });

  it('команда не дошла до своего кода — отказ: она не выполнится и у потребителя', () => {
    const { io } = world({
      answer: (command, args) =>
        command !== 'npm' && args.includes('--help')
          ? { status: 1, stderr: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
          : { status: 0 },
    });
    expect(() => accept({ report: REPORT }, io)).toThrow(/`baser`/);
  });

  it('команда ответила СВОИМ отказом — это её работа, а не дефект выпуска', () => {
    // `baser-release-names` в пустом каталоге отвечает «карта имён не отдана» и
    // кодом 1: инструмент работает, каталог не тот (репетиция 2026-08-09).
    const { io } = world({
      answer: (command, args) =>
        command !== 'npm' && args.includes('--help')
          ? { status: 1, stderr: 'КАРТА ИМЁН НЕ ОТДАНА' }
          : { status: 0 },
    });
    expect(() => accept({ report: REPORT }, io)).not.toThrow();
  });
});

describe('запуск судится по тому, дошёл ли он до своего кода', () => {
  it('код 0 — дошёл, вопросов нет', () => {
    expect(launched({ status: 0, stdout: '', stderr: '' }).loaded).toBe(true);
  });

  it.each([
    'ERR_PACKAGE_PATH_NOT_EXPORTED',
    'ERR_MODULE_NOT_FOUND',
    'Cannot find package',
    'MODULE_NOT_FOUND',
  ])('сорванный резолв «%s» — НЕ дошёл', (marker) => {
    const verdict = launched({ status: 1, stdout: '', stderr: marker });
    expect(verdict.loaded).toBe(false);
    expect(verdict.marker).toBe(marker);
  });

  it('свой отказ инструмента — дошёл: код выхода тут не судья', () => {
    // Требовать от каждого инструмента понимать `--help` и любить пустой
    // каталог значило бы предъявлять требование чужим зонам приёмкой выпуска.
    expect(
      launched({ status: 2, stdout: '', stderr: 'каталог не назван' }).loaded,
    ).toBe(true);
  });

  it('сорванный резолв виден и в stdout, а не только в stderr', () => {
    expect(
      launched({ status: 1, stdout: 'ERR_MODULE_NOT_FOUND', stderr: '' })
        .loaded,
    ).toBe(false);
  });
});

describe('двери берутся из объявления, а не из догадки «имя пакета»', () => {
  // Правило родилось из репетиции прогона (2026-08-09): загрузка по имени
  // пакета краснела на `@baser/devbox` и `@baser/git`, у которых главного
  // входа нет по устройству, а не по дефекту.

  it('карта подпутей — дверь на каждый подпуть, `.` идёт именем пакета', () => {
    expect(
      doors({
        name: '@omnifield/baser-contracts',
        exports: {
          './package.json': './package.json',
          '.': './dist/index.js',
          './locate': './dist/locate.js',
        },
      }),
    ).toEqual([
      '@omnifield/baser-contracts',
      '@omnifield/baser-contracts/locate',
    ]);
  });

  it('пакет объявил ТОЛЬКО подпуть — грузим подпуть, а не имя', () => {
    expect(
      doors({
        name: '@omnifield/baser-devbox',
        exports: {
          './package.json': './package.json',
          './defaults.mjs': './defaults.mjs',
        },
      }),
    ).toEqual(['@omnifield/baser-devbox/defaults.mjs']);
  });

  it('пакет не везёт кода — дверей нет, и это НЕ отказ', () => {
    // `@baser/git` объявляет только `./package.json`: он везёт шаблоны.
    expect(
      doors({
        name: '@omnifield/baser-git',
        exports: { './package.json': './package.json' },
      }),
    ).toEqual([]);
  });

  it('карта условий — не подпути: дверь одна, именем пакета', () => {
    expect(
      doors({
        name: '@omnifield/baser-pack',
        exports: { import: './dist/index.js', default: './dist/index.js' },
      }),
    ).toEqual(['@omnifield/baser-pack']);
  });

  it('exports нет, но есть main — дверь именем пакета', () => {
    expect(doors({ name: '@omnifield/baser-old', main: './index.js' })).toEqual(
      ['@omnifield/baser-old'],
    );
  });

  it('шаблон со звёздочкой — не дверь, а правило: не грузим', () => {
    expect(
      doors({
        name: '@omnifield/baser-pack',
        exports: { '.': './dist/index.js', './lib/*': './dist/lib/*.js' },
      }),
    ).toEqual(['@omnifield/baser-pack']);
  });
});

describe('форма bin у npm двойная, и обе принимаются', () => {
  it('строка — команда именем пакета', () => {
    expect(bins({ name: '@omnifield/baser-cli', bin: './bin.js' })).toEqual([
      { name: '@omnifield/baser-cli', path: './bin.js' },
    ]);
  });

  it('объект — сколько объявлено, столько и команд', () => {
    expect(bins({ bin: { a: './a.js', b: './b.js' } })).toHaveLength(2);
  });

  it('нет bin — нечего запускать, и это не отказ', () => {
    expect(bins({ name: '@omnifield/baser-contracts' })).toEqual([]);
  });
});

describe('внутреннее имя ищется в ссылках, а не в тексте манифеста', () => {
  const internals = new Set(['@baser/contracts']);

  it('ссылка в dependencies — находится', () => {
    expect(
      internalLeftovers(
        { dependencies: { '@baser/contracts': '0.5.0' } },
        internals,
      ),
    ).toEqual(['@baser/contracts']);
  });

  it('ссылка в peerDependencies — тоже', () => {
    expect(
      internalLeftovers(
        { peerDependencies: { '@baser/contracts': '^0.5.0' } },
        internals,
      ),
    ).toEqual(['@baser/contracts']);
  });

  it('devDependencies потребителю не едут — и здесь не судятся', () => {
    expect(
      internalLeftovers(
        { devDependencies: { '@baser/contracts': 'workspace:*' } },
        internals,
      ),
    ).toEqual([]);
  });

  it('имя в описании — не ссылка, и отказом не является', () => {
    expect(
      internalLeftovers(
        { description: 'обвес @baser/contracts', dependencies: {} },
        internals,
      ),
    ).toEqual([]);
  });
});

describe('сводка прогона читается человеком', () => {
  it('принятый выпуск называет реестр, холодный кэш и каждый пакет', () => {
    const { io } = world();
    const text = render(accept({ report: REPORT }, io)).join('\n');
    expect(text).toContain(REGISTRY);
    expect(text).toContain('свежий');
    expect(text).toContain('@omnifield/baser-cli');
    expect(text).toContain('`@omnifield/baser-contracts/locate`');
    expect(text).toContain('`baser --help`');
  });

  it('пакет без дверей назван словами, а не пустой клеткой', () => {
    const { io } = world({
      installed: {
        '@omnifield/baser-contracts': {
          name: '@omnifield/baser-contracts',
          exports: { './package.json': './package.json' },
        },
        '@omnifield/baser-cli': { name: '@omnifield/baser-cli' },
      },
    });
    expect(render(accept({ report: REPORT }, io)).join('\n')).toContain(
      'кода не везёт',
    );
  });

  it('отказ НЕ зовёт перезапустить выпуск — номера уже заняты', () => {
    const text = renderRefusal('пакет не загружается').join('\n');
    expect(text).toContain('НЕ перезапускай');
    expect(text).toContain('СЛЕДУЮЩИМ номером');
    expect(text).toContain('npm deprecate');
    expect(text).not.toContain('не уехало ничего');
  });
});

describe('как это зовёт воркфлоу', () => {
  it('без --report — код 2: приёмке нечего судить', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('--report');
  });

  it('отчёт не разбирается — код 2, а не молчаливое зелёное', () => {
    const dir = mkdtempSync(join(tmpdir(), 'public-acceptance-spec-'));
    temporary.push(dir);
    const path = join(dir, 'report.json');
    writeFileSync(path, 'не джейсон');

    const run = spawnSync(process.execPath, [SCRIPT, '--report', path], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(2);
  });

  it('пустой отчёт — код 1 и отказ В СВОДКЕ, а не пустая сводка', () => {
    const dir = mkdtempSync(join(tmpdir(), 'public-acceptance-spec-'));
    temporary.push(dir);
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify({ renamed: [], prose: [] }));

    const run = spawnSync(process.execPath, [SCRIPT, '--report', path], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('НЕ принят');
  });
});
