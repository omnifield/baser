/**
 * ГЕРМЕТИЧНОСТЬ ПРОБ, ПОДНИМАЮЩИХ РЕПОЗИТОРИЙ (`tasker:BASER2-179`).
 *
 * Пробы этой зоны зовут настоящий `git`. Пойманный живьём 2026-08-04 дефект: под
 * машинным `pre-commit` вложенный `git` наследовал git-переменные хука и уходил
 * по ним В НАШ репозиторий — унесло ветку на три коммита и переключило основное
 * рабочее дерево в `bare`. Восстанавливал человек руками.
 *
 * Здесь это свойство ПРОВЕРЯЕТСЯ, а не соблюдается дисциплиной. Три утверждения,
 * и каждое обязано быть отдельным:
 *
 * 1. окружение чистится ПРАВИЛОМ (весь префикс `GIT_`), а не списком имён;
 * 2. подсунутое окружение вложенный `git` наружу не уводит;
 * 3. проверка КУСАЕТСЯ — без чистки тот же вызов уходит наружу и сорит там;
 * 4. правило распространяется на ВСЕ пробы зоны, а не на пойманную.
 *
 * ── ПОЧЕМУ ЗДЕСЬ ПОДСТАВНОЙ РЕПОЗИТОРИЙ ─────────────────────────────────────
 *
 * Утверждение «не ушёл наружу» проверяется только тем, что снаружи что-то
 * стоит и остаётся нетронутым. Ставить туда НАШ репозиторий нельзя по причине,
 * ради которой заход и случился: проба, доказывающая безопасность порчей
 * рабочего дерева, — это тот же дефект, только с зелёным отчётом. Поэтому
 * «наружу» здесь изображает подставной репозиторий во временном каталоге, и
 * пойманный случай воспроизводится на нём целиком.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitSealed, gitVariables, sealedEnv } from './sealed.fixture.js';

const boxes: string[] = [];
const restore: (() => void)[] = [];

afterEach(() => {
  while (restore.length > 0) {
    (restore.pop() as () => void)();
  }
  while (boxes.length > 0) {
    rmSync(boxes.pop() as string, { force: true, recursive: true });
  }
});

function box(name: string): string {
  const created = mkdtempSync(join(tmpdir(), `baser-${name}-`));
  boxes.push(created);
  return created;
}

/** «Снаружи» — чужой репозиторий, который проба не имеет права трогать. */
function outside(): string {
  const repo = join(box('outside'), 'чужой');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'своё.txt'), 'работа коллеги\n', 'utf-8');
  gitSealed(repo, 'init', '-q', '-b', 'main');
  gitSealed(repo, 'add', '-A');
  gitSealed(repo, 'commit', '-qm', 'исходный репозиторий');
  return repo;
}

/** Каталог, в котором проба собирается поднять СВОЙ репозиторий. */
function fresh(): string {
  const dir = join(box('fresh'), 'свой');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'моё.txt'), 'работа пробы\n', 'utf-8');
  return dir;
}

/**
 * Окружение хука — ровно то, что наследует проба под `pre-commit`.
 *
 * Адреса АБСОЛЮТНЫЕ: относительные (`GIT_INDEX_FILE=.git/index`) прятали дефект
 * годами, потому что из другого каталога попадали в свой репозиторий. Связанное
 * рабочее дерево (`git worktree`) отдаёт их абсолютными — и наследование
 * начинает уводить наружу.
 */
function inherited(repo: string): Record<string, string> {
  return {
    GIT_DIR: join(repo, '.git'),
    GIT_INDEX_FILE: join(repo, '.git/index'),
  };
}

/** Подсовывает окружение прогону — как это делает хук. */
function poison(variables: Record<string, string>): void {
  const before = new Map(
    Object.keys(variables).map((name) => [name, process.env[name]]),
  );
  restore.push(() => {
    for (const [name, value] of before) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
  Object.assign(process.env, variables);
}

/** Снимок репозитория, по которому видно любое вмешательство извне. */
function snapshot(repo: string): {
  head: string;
  log: string;
  status: string;
  config: string;
} {
  return {
    head: gitSealed(repo, 'rev-parse', 'HEAD').trim(),
    log: gitSealed(repo, 'log', '--format=%s'),
    status: gitSealed(repo, 'status', '--porcelain'),
    config: readFileSync(join(repo, '.git/config'), 'utf-8'),
  };
}

describe('окружение чистится ПРАВИЛОМ, а не списком имён', () => {
  it('снимается весь префикс — включая переменную, которой сегодня нет', () => {
    poison({
      GIT_DIR: '/чужой/.git',
      GIT_INDEX_FILE: '/чужой/.git/index',
      // Имени такого у git нет. В этом и утверждение: поимённый список — снимок
      // сегодняшнего git, и устареет он молча, в сторону «мы думали, что
      // герметично».
      GIT_ЗАВТРАШНЯЯ_ПЕРЕМЕННАЯ: '/чужой',
    });

    expect(gitVariables(process.env).length).toBeGreaterThan(0);
    expect(gitVariables(sealedEnv())).toEqual([]);
  });

  it('и не трогает НИЧЕГО, кроме него', () => {
    poison({ GIT_DIR: '/чужой/.git' });

    const sealed = sealedEnv();

    // Чистка, уносящая `PATH`, «чинила» бы наследование ценой запуска: git
    // просто перестал бы находиться, и проба зеленела бы на пустом месте.
    expect(sealed['PATH']).toBe(process.env['PATH']);
    expect(Object.keys(sealed).sort()).toEqual(
      Object.keys(process.env)
        .filter((name) => !name.startsWith('GIT_'))
        .sort(),
    );
  });
});

describe('вложенный git не уходит наружу ни при каком окружении', () => {
  it('подсунули окружение чужого репозитория — работа осталась у себя', () => {
    const чужой = outside();
    const свой = fresh();
    const before = snapshot(чужой);

    poison(inherited(чужой));

    gitSealed(свой, 'init', '-q', '-b', 'проба');
    gitSealed(свой, 'add', '-A');
    gitSealed(свой, 'commit', '-qm', 'коммит пробы');

    // Репозиторий пробы существует, и коммит лёг именно в него.
    expect(existsSync(join(свой, '.git'))).toBe(true);
    expect(gitSealed(свой, 'log', '--format=%s').trim()).toBe('коммит пробы');
    expect(gitSealed(свой, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(
      'проба',
    );

    // А снаружи не изменилось ничего: ни ветка, ни история, ни рабочее дерево,
    // ни настройки — `core.bare` в том числе.
    expect(snapshot(чужой)).toEqual(before);
  });

  it('окружение подсунуто НЕ ТОЛЬКО адресом — трогать нечего всё равно', () => {
    const чужой = outside();
    const свой = fresh();
    const before = snapshot(чужой);

    poison({
      ...inherited(чужой),
      GIT_WORK_TREE: чужой,
      GIT_OBJECT_DIRECTORY: join(чужой, '.git/objects'),
      GIT_COMMON_DIR: join(чужой, '.git'),
      // Личность коммита пробы назначается флагами. Переменная, оставшаяся от
      // хука, переписала бы её молча — и подпись зависела бы от машины прогона.
      GIT_AUTHOR_NAME: 'коллега',
      GIT_COMMITTER_NAME: 'коллега',
      GIT_AUTHOR_EMAIL: 'коллега@чужой',
      GIT_COMMITTER_EMAIL: 'коллега@чужой',
    });

    gitSealed(свой, 'init', '-q', '-b', 'проба');
    gitSealed(свой, 'add', '-A');
    gitSealed(свой, 'commit', '-qm', 'коммит пробы');

    expect(gitSealed(свой, 'log', '--format=%an').trim()).toBe('проба');
    expect(snapshot(чужой)).toEqual(before);
  });
});

describe('проверка КУСАЕТСЯ: без чистки тот же вызов уходит наружу', () => {
  it('пойманный случай воспроизводится целиком — на подставном репозитории', () => {
    const чужой = outside();
    const свой = fresh();
    const before = snapshot(чужой);
    // Окружение строится ОТ ЧИСТОГО, а не от `process.env`: машина прогона сама
    // бывает под хуком (или под связанным деревом), и её собственные
    // git-переменные увели бы этот вызов в третье место. Проба, изображающая
    // наследование, обязана быть единственным его источником — иначе она
    // повторит дефект, который показывает.
    const env = { ...sealedEnv(), ...inherited(чужой) };

    // ТОТ ЖЕ порядок команд, что и в пробе выше, но окружение наследуется — то
    // есть ровно так, как это делали пробы зоны до `tasker:BASER2-179`.
    for (const args of [
      ['init', '-q', '-b', 'проба'],
      ['-c', 'user.email=проба@baser', '-c', 'user.name=проба', 'add', '-A'],
      [
        '-c',
        'user.email=проба@baser',
        '-c',
        'user.name=проба',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'проба насорила в чужом репозитории',
      ],
    ]) {
      // `stderr` глушится намеренно: `git init` по чужому адресу честно ругается
      // «re-init», и эта ругань — предмет пробы, а не поломка прогона. В общий
      // лог она попадала бы пугалкой без объяснения.
      execFileSync('git', args, {
        cwd: свой,
        env,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // Репозитория пробы не возникло вовсе: `git init` пошёл по адресу из
    // окружения и переинициализировал ЧУЖОЙ.
    expect(existsSync(join(свой, '.git'))).toBe(false);
    // А коммит пробы лёг наружу — вместе с удалением чужих файлов из индекса.
    const after = snapshot(чужой);
    expect(after.head).not.toBe(before.head);
    expect(after.log).toContain('проба насорила в чужом репозитории');
    expect(after.status).not.toBe(before.status);
  });
});

describe('правило распространяется на ВСЕ пробы зоны', () => {
  const LIB = dirname(fileURLToPath(import.meta.url));
  const ZONE = resolve(LIB, '../..');

  /**
   * Владельцы герметичности: фикстура, где чистка живёт, и эта проба, которой
   * без грязного вызова нечем показать, что проверка кусается.
   */
  const OWNERS = new Set(['sealed.fixture.ts', 'sealed.spec.ts']);

  function probes(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return probes(path);
      }
      return entry.name.endsWith('.spec.ts') || entry.name.endsWith('.fixture.ts')
        ? [path]
        : [];
    });
  }

  it('своего child_process у проб нет — внешние процессы идут через фикстуру', () => {
    // Дисциплина «не забудь передать env» держится ровно до следующей пробы,
    // написанной по образцу соседней. Поэтому граница здесь машинная: у проб
    // зоны нет своего входа к процессам, и чистка стоит на единственном.
    const свои = probes(join(ZONE, 'src'))
      .filter((path) => /node:child_process/.test(readFileSync(path, 'utf-8')))
      .map((path) => path.slice(ZONE.length + 1))
      .filter((path) => !OWNERS.has(path.split('/').pop() as string));

    expect(свои).toEqual([]);
  });
});
