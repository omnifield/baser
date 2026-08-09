import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { plan, readPackages, releasedTags, report } from './dev-release-plan.mjs';

/**
 * Пакет в форме, которую отдаёт `readPackages`. Поля с умолчаниями названы явно:
 * проба про «непубличное не уезжает» не должна зависеть от того, какое из них
 * забыли написать.
 *
 * @param {string} name
 * @param {string} version
 * @param {{private?: boolean, dependencies?: Record<string, string>}} [rest]
 */
const pkg = (name, version, rest = {}) => ({
  name,
  version,
  dir: `packages/${name.replace('@baser/', '')}`,
  private: false,
  dependencies: {},
  ...rest,
});

/** Ничего ещё не выпускалось — самый частый случай в пробах ниже. */
const NOTHING_RELEASED = new Set();

describe('набор — только предвыпускные номера нашей схемы', () => {
  it('дев-номер уезжает, стабильная тройка — нет', () => {
    const { publish } = plan(
      [pkg('@baser/cli', '0.9.0-dev.1'), pkg('@baser/pack', '0.4.0')],
      NOTHING_RELEASED,
    );
    expect(publish.map((entry) => entry.name)).toEqual(['@baser/cli']);
  });

  it('невыпускаемый не уезжает, даже с дев-номером', () => {
    const { publish } = plan(
      [pkg('@baser/source', '0.9.0-dev.1', { private: true })],
      NOTHING_RELEASED,
    );
    expect(publish).toEqual([]);
  });

  it('форма сомкнута с обоих концов — соседние схемы за наш канал не выдаются', () => {
    const near = [
      '0.3.0-dev.1+meta',
      '0.3.0-beta.1',
      '0.3.0-dev',
      '0.3.0-dev.',
      '1.2-dev.1',
      'v0.3.0-dev.1',
      '0.3.0-dev.1-rc',
    ];
    for (const version of near) {
      const { publish } = plan([pkg('@baser/cli', version)], NOTHING_RELEASED);
      expect(publish, version).toEqual([]);
    }
  });

  it('номера нет вовсе — план не падает, а не берёт пакет', () => {
    const { publish } = plan(
      [{ name: '@baser/cli', dir: 'packages/baser-cli', private: false }],
      NOTHING_RELEASED,
    );
    expect(publish).toEqual([]);
  });

  it('тег выпуска — `<имя>@<номер>`, форма из nx.json', () => {
    const { publish } = plan(
      [pkg('@baser/cli', '0.9.0-dev.1')],
      NOTHING_RELEASED,
    );
    expect(publish[0].tag).toBe('@baser/cli@0.9.0-dev.1');
  });
});

/**
 * СЛУЧАЙ, РАДИ КОТОРОГО ЗАВЕДЁН `held` (`tasker:BASER2-168`). Выпуск номер в
 * манифесте не двигает: `@baser/release@0.1.0-dev.1` уехал, номер
 * остался, и следующий дев-выпуск девбокса потянул его за собой — упираясь в
 * собственную проверку «номер занят». Ловится это планом, а не прогоном.
 */
describe('уже выпущенный номер в набор не попадает', () => {
  const packages = [
    pkg('@baser/devbox', '0.9.0-dev.1'),
    pkg('@baser/release', '0.1.0-dev.1'),
  ];
  const released = new Set(['@baser/release@0.1.0-dev.1']);

  it('уезжает только тот, чей номер ещё не выпускался', () => {
    const { publish } = plan(packages, released);
    expect(publish.map((entry) => entry.tag)).toEqual([
      '@baser/devbox@0.9.0-dev.1',
    ]);
  });

  it('придержанный назван, а не пропал молча', () => {
    const { held } = plan(packages, released);
    expect(held.map((entry) => entry.tag)).toEqual([
      '@baser/release@0.1.0-dev.1',
    ]);
  });

  it('чужой тег того же пакета набор не трогает — сравнивается номер, а не имя', () => {
    const { publish, held } = plan(
      packages,
      new Set([
        '@baser/release@0.0.9',
        '@baser/release@0.1.0-dev.0',
        '@baser/devbox@0.8.0-dev.7',
      ]),
    );
    expect(publish.map((entry) => entry.name)).toEqual([
      '@baser/devbox',
      '@baser/release',
    ]);
    expect(held).toEqual([]);
  });

  it('выпущено всё — уезжать нечему, и это не «дев-номеров нет»', () => {
    const { publish, held } = plan(
      packages,
      new Set([
        '@baser/devbox@0.9.0-dev.1',
        '@baser/release@0.1.0-dev.1',
      ]),
    );
    expect(publish).toEqual([]);
    expect(held).toHaveLength(2);
  });
});

describe('соседи, на которых ссылается выпускаемое', () => {
  it('сосед не уезжает — значит обязан уже лежать в реестре', () => {
    const { requires } = plan(
      [
        pkg('@baser/cli', '0.9.0-dev.1', {
          dependencies: { '@baser/contracts': 'workspace:*' },
        }),
        pkg('@baser/contracts', '0.5.0'),
      ],
      NOTHING_RELEASED,
    );
    expect(requires).toEqual([
      {
        name: '@baser/contracts',
        version: '0.5.0',
        neededBy: '@baser/cli',
      },
    ]);
  });

  it('сосед уезжает этим же прогоном — спрашивать про него реестр нечего', () => {
    const { requires } = plan(
      [
        pkg('@baser/cli', '0.9.0-dev.1', {
          dependencies: { '@baser/contracts': 'workspace:*' },
        }),
        pkg('@baser/contracts', '0.5.0-dev.3'),
      ],
      NOTHING_RELEASED,
    );
    expect(requires).toEqual([]);
  });

  it('придержанный сосед — тоже требование к реестру, и оно выполнено', () => {
    const { requires } = plan(
      [
        pkg('@baser/cli', '0.9.0-dev.1', {
          dependencies: { '@baser/release': 'workspace:*' },
        }),
        pkg('@baser/release', '0.1.0-dev.1'),
      ],
      new Set(['@baser/release@0.1.0-dev.1']),
    );
    expect(requires).toEqual([
      {
        name: '@baser/release',
        version: '0.1.0-dev.1',
        neededBy: '@baser/cli',
      },
    ]);
  });

  it('ссылка не на соседа по монорепе — не наше требование', () => {
    const { requires } = plan(
      [
        pkg('@baser/cli', '0.9.0-dev.1', {
          dependencies: { vitest: '^4.1.0', '@baser/contracts': '^0.5.0' },
        }),
        pkg('@baser/contracts', '0.5.0'),
      ],
      NOTHING_RELEASED,
    );
    expect(requires).toEqual([]);
  });

  it('все три записи `workspace:` признаются', () => {
    for (const range of ['workspace:*', 'workspace:^', 'workspace:~']) {
      const { requires } = plan(
        [
          pkg('@baser/cli', '0.9.0-dev.1', {
            dependencies: { '@baser/contracts': range },
          }),
          pkg('@baser/contracts', '0.5.0'),
        ],
        NOTHING_RELEASED,
      );
      expect(requires, range).toHaveLength(1);
    }
  });

  it('один сосед у двух выпускаемых — одна запись, а не две', () => {
    const { requires } = plan(
      [
        pkg('@baser/cli', '0.9.0-dev.1', {
          dependencies: { '@baser/contracts': 'workspace:*' },
        }),
        pkg('@baser/pack', '0.2.0-dev.4', {
          dependencies: { '@baser/contracts': 'workspace:*' },
        }),
        pkg('@baser/contracts', '0.5.0'),
      ],
      NOTHING_RELEASED,
    );
    expect(requires).toHaveLength(1);
  });

  it('ссылка на пакет, которого в дереве нет — не требование', () => {
    const { requires } = plan(
      [
        pkg('@baser/cli', '0.9.0-dev.1', {
          dependencies: { '@omnifield/baser-ghost': 'workspace:*' },
        }),
      ],
      NOTHING_RELEASED,
    );
    expect(requires).toEqual([]);
  });

  it('придержанный на соседей не ссылается — он не уезжает', () => {
    const { requires } = plan(
      [
        pkg('@baser/release', '0.1.0-dev.1', {
          dependencies: { '@baser/contracts': 'workspace:*' },
        }),
        pkg('@baser/devbox', '0.9.0-dev.1'),
        pkg('@baser/contracts', '0.5.0'),
      ],
      new Set(['@baser/release@0.1.0-dev.1']),
    );
    expect(requires).toEqual([]);
  });
});

/**
 * ВЫВОД НЕ РАСХОДИТСЯ С ПЛАНОМ. По логу прогона судят о выпуске, не открывая
 * JSON: отказ, называющий не ту причину, отправляет чинить не то.
 */
describe('план словами', () => {
  const said = (result, packages) => report(result, packages).join('\n');

  it('дев-номеров нет — так и сказано, и дерево названо', () => {
    const packages = [pkg('@baser/cli', '0.9.0')];
    const text = said(plan(packages, NOTHING_RELEASED), packages);
    expect(text).toMatch(/Ни один пакет не несёт дев-номера/);
    expect(text).toMatch(/@baser\/cli: 0\.9\.0/);
  });

  it('дев-номера есть, но выпущены — причина названа ЭТА, а не «номеров нет»', () => {
    const packages = [pkg('@baser/cli', '0.9.0-dev.1')];
    const text = said(
      plan(packages, new Set(['@baser/cli@0.9.0-dev.1'])),
      packages,
    );
    expect(text).toMatch(/УЖЕ ВЫПУЩЕНЫ/);
    expect(text).toMatch(/Подними номер/);
    expect(text).not.toMatch(/Ни один пакет не несёт дев-номера/);
  });

  it('невыпускаемый в перечне дерева помечен', () => {
    const packages = [pkg('@baser/source', '0.0.0', { private: true })];
    expect(said(plan(packages, NOTHING_RELEASED), packages)).toMatch(
      /невыпускаемый/,
    );
  });

  it('уезжающее перечислено номерами', () => {
    const packages = [pkg('@baser/cli', '0.9.0-dev.1')];
    expect(said(plan(packages, NOTHING_RELEASED), packages)).toMatch(
      /уезжает[\s\S]*@baser\/cli@0\.9\.0-dev\.1/,
    );
  });

  it('придержанное названо рядом с уезжающим, а не только в JSON', () => {
    const packages = [
      pkg('@baser/devbox', '0.9.0-dev.1'),
      pkg('@baser/release', '0.1.0-dev.1'),
    ];
    const text = said(
      plan(packages, new Set(['@baser/release@0.1.0-dev.1'])),
      packages,
    );
    expect(text).toMatch(/НЕ уезжает/);
    expect(text).toMatch(/@baser\/release@0\.1\.0-dev\.1/);
  });

  it('придержанного нет — про него и не говорится', () => {
    const packages = [pkg('@baser/devbox', '0.9.0-dev.1')];
    expect(said(plan(packages, NOTHING_RELEASED), packages)).not.toMatch(
      /НЕ уезжает/,
    );
  });

  it('требования к реестру названы вместе с тем, кому они нужны', () => {
    const packages = [
      pkg('@baser/cli', '0.9.0-dev.1', {
        dependencies: { '@baser/contracts': 'workspace:*' },
      }),
      pkg('@baser/contracts', '0.5.0'),
    ];
    expect(said(plan(packages, NOTHING_RELEASED), packages)).toMatch(
      /@baser\/contracts@0\.5\.0 — нужен @baser\/cli/,
    );
  });
});

/**
 * ПРОГОН НА ЖИВОМ ДЕРЕВЕ. Выше пробуется суждение, здесь — то, что план читает
 * с диска и из git ровно те факты, по которым судит, и отдаёт их конвейеру
 * кодом выхода и JSON'ом на stdout. Разойтись эти половины могут молча.
 */
describe('прогон на дереве', () => {
  const SCRIPT = fileURLToPath(new URL('./dev-release-plan.mjs', import.meta.url));

  /** @type {string[]} */
  const trash = [];

  afterAll(() => {
    for (const dir of trash) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Репозиторий-фикстура: пакеты в манифестах, теги выпуска в git.
   *
   * Теги ставятся НАСТОЯЩИЕ, а не подставляются в код: план читает их `git tag`,
   * и подмена читалки оставила бы непроверенной ровно ту половину, которая
   * ходит наружу.
   *
   * @param {{packages?: Record<string, object>, tags?: string[], git?: boolean}} shape
   */
  function repo({ packages = {}, tags = [], git = true } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'dev-release-plan-'));
    trash.push(root);

    for (const [dir, manifest] of Object.entries(packages)) {
      mkdirSync(join(root, 'packages', dir), { recursive: true });
      writeFileSync(
        join(root, 'packages', dir, 'package.json'),
        JSON.stringify(manifest, null, 2),
      );
    }

    if (git) {
      const run = (...args) =>
        execFileSync('git', args, { cwd: root, stdio: 'ignore' });
      run('init', '-q');
      run('config', 'user.email', 'probe@example.invalid');
      run('config', 'user.name', 'probe');
      run('commit', '--allow-empty', '-q', '-m', 'фикстура');
      for (const tag of tags) run('tag', tag);
    }

    return root;
  }

  /** @param {string[]} args */
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });

  it('манифесты читаются с диска, а не додумываются', () => {
    const root = repo({
      packages: {
        'baser-cli': {
          name: '@baser/cli',
          version: '0.9.0-dev.1',
          dependencies: { '@baser/contracts': 'workspace:*' },
        },
        'baser-contracts': { name: '@baser/contracts', version: '0.5.0' },
      },
    });

    expect(readPackages(root)).toEqual([
      {
        name: '@baser/cli',
        version: '0.9.0-dev.1',
        dir: 'packages/baser-cli',
        private: false,
        dependencies: { '@baser/contracts': 'workspace:*' },
      },
      {
        name: '@baser/contracts',
        version: '0.5.0',
        dir: 'packages/baser-contracts',
        private: false,
        dependencies: {},
      },
    ]);
  });

  it('каталога пакетов нет — пусто, а не падение', () => {
    expect(readPackages(repo())).toEqual([]);
  });

  it('теги выпуска читаются из git', () => {
    const root = repo({ tags: ['@baser/cli@0.9.0-dev.1', 'веха'] });
    expect(releasedTags(root)).toEqual(
      new Set(['@baser/cli@0.9.0-dev.1', 'веха']),
    );
  });

  it('выпускать есть что — JSON на stdout и выход 0', () => {
    const root = repo({
      packages: {
        'baser-cli': {
          name: '@baser/cli',
          version: '0.9.0-dev.1',
          dependencies: { '@baser/contracts': 'workspace:*' },
        },
        'baser-contracts': { name: '@baser/contracts', version: '0.5.0' },
      },
    });

    const got = run('--root', root);
    expect(got.status).toBe(0);
    expect(JSON.parse(got.stdout)).toEqual({
      publish: [
        {
          name: '@baser/cli',
          version: '0.9.0-dev.1',
          dir: 'packages/baser-cli',
          tag: '@baser/cli@0.9.0-dev.1',
        },
      ],
      requires: [
        {
          name: '@baser/contracts',
          version: '0.5.0',
          neededBy: '@baser/cli',
        },
      ],
      held: [],
    });
  });

  it('живой тег придерживает пакет — тот самый случай BASER2-168', () => {
    const root = repo({
      packages: {
        'baser-devbox': { name: '@baser/devbox', version: '0.9.0-dev.1' },
        'baser-release': { name: '@baser/release', version: '0.1.0-dev.1' },
      },
      tags: ['@baser/release@0.1.0-dev.1'],
    });

    const got = run('--root', root);
    expect(got.status).toBe(0);

    const { publish, held } = JSON.parse(got.stdout);
    expect(publish.map((entry) => entry.tag)).toEqual([
      '@baser/devbox@0.9.0-dev.1',
    ]);
    expect(held.map((entry) => entry.tag)).toEqual([
      '@baser/release@0.1.0-dev.1',
    ]);
    expect(got.stderr).toMatch(/НЕ уезжает/);
  });

  it('выпускать нечего — выход 1 и пустой stdout: воркфлоу нечего читать', () => {
    const root = repo({
      packages: { 'baser-cli': { name: '@baser/cli', version: '0.9.0' } },
    });

    const got = run('--root', root);
    expect(got.status).toBe(1);
    expect(got.stdout).toBe('');
    expect(got.stderr).toMatch(/выпускать нечего/);
  });

  it('всё выпущено — тоже выход 1, но причина названа своя', () => {
    const root = repo({
      packages: {
        'baser-cli': { name: '@baser/cli', version: '0.9.0-dev.1' },
      },
      tags: ['@baser/cli@0.9.0-dev.1'],
    });

    const got = run('--root', root);
    expect(got.status).toBe(1);
    expect(got.stderr).toMatch(/УЖЕ ВЫПУЩЕНЫ/);
  });

  it('у --root не назван каталог — выход 2, а не отчёт про текущее дерево', () => {
    const got = run('--root');
    expect(got.status).toBe(2);
    expect(got.stderr).toMatch(/не назван каталог/);
  });

  it('корень не репозиторий — выход 2: без тегов план врал бы составом', () => {
    const root = repo({
      packages: {
        'baser-cli': { name: '@baser/cli', version: '0.9.0-dev.1' },
      },
      git: false,
    });

    const got = run('--root', root);
    expect(got.status).toBe(2);
    expect(got.stdout).toBe('');
    expect(got.stderr).toMatch(/теги выпуска не прочитаны/);
  });
});
