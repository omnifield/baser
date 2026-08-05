/**
 * ПРИЁМКА БАНДЛА — «унесли и заработало», а не «собралось».
 *
 * Собранная папка это ещё ничего не значит: оба дефекта, найденные на этой
 * работе, статикой не видны вовсе. Установщик искал опись на уровень выше
 * (писался под раскладку в пакете, а поехал в бандл), а копирование обвеса в
 * `node_modules` оказалось ПОЛОВИНОЙ того, что делает пакетный менеджер — без
 * записи в `package.json` дверь скопированного каталога не видела. И то и
 * другое собиралось зелёным и падало у человека.
 *
 * Поэтому центральная проба здесь запускает бандл **отдельным процессом из
 * каталога вне монорепы**: только так вопрос «заработает ли у человека»
 * задаётся по-настоящему.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceConfigPath } from '@omnifield/baser-contracts';
import { bundle } from './bundle.js';
import { DOOR_SCHEMA_VERSION } from './schema.js';
import { runSealed, streamsSealed } from './sealed.fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../../..');
const DEVBOX = join(REPO_ROOT, 'packages/baser-devbox');
const DOOR_DIST = join(REPO_ROOT, 'packages/baser-cli/dist/bundle/install.js');

const boxes: string[] = [];

afterEach(() => {
  while (boxes.length > 0) {
    rmSync(boxes.pop() as string, { force: true, recursive: true });
  }
});

function box(name: string): string {
  const created = mkdtempSync(join(tmpdir(), `baser-${name}-`));
  boxes.push(created);
  return created;
}

/**
 * Бандл требует СОБРАННОЙ двери: в него уезжает `dist`, а не исходники.
 *
 * Отдельная проверка с внятным текстом, а не молчаливый пропуск: проба,
 * которая тихо не прогоняется, ничем не отличается от отсутствующей.
 */
function requireBuiltDoor(): void {
  if (!existsSync(DOOR_DIST)) {
    throw new Error(
      `дверь не собрана (${DOOR_DIST}). Приёмка бандла идёт по dist — собери пакет перед прогоном`,
    );
  }
}

describe('бандл из живого обвеса', () => {
  it('собирается и называет ОБЪЁМ каждого шага', () => {
    requireBuiltDoor();
    const into = join(box('bundle'), 'выдача');

    const report = bundle(DEVBOX, { into });

    expect(report.ok).toBe(true);
    // Пустой счётчик виден: зелёный шаг, ничего не сделавший, невозможен по
    // конструкции, а не по договорённости.
    for (const stage of report.stages) {
      expect(stage.status).toBe('ok');
      expect(stage.counted).toBeGreaterThan(0);
    }
    expect(report.stages.map((stage) => stage.name)).toEqual([
      'pack',
      'runtime',
      'launcher',
      'docs',
      'verify',
    ]);
  });

  it('вкладывает саму дверь и её зависимости — и больше ничего', () => {
    requireBuiltDoor();
    const into = join(box('bundle'), 'выдача');

    const report = bundle(DEVBOX, { into });
    const names = report.runtime.map((item) => item.name);

    expect(names).toContain('@omnifield/baser-cli');
    expect(names).toContain('ejs');
    // `nx` и `@nx/devkit` в рантайме не нужны: дерево дверь держит сама. Это
    // одно решение сняло 21 МБ и платформенные бинари, без которых бандл не
    // был бы переносимым вовсе.
    expect(names).not.toContain('nx');
    expect(names).not.toContain('@nx/devkit');
  });

  it('в бандле нет ни одной ссылки на монорепу, из которой он собран', () => {
    requireBuiltDoor();
    const into = join(box('bundle'), 'выдача');
    bundle(DEVBOX, { into });

    // Унесённый бандл не имеет права знать, где его собирали: путь сборки в
    // содержимом означал бы, что он работает только на этой машине.
    const guilty: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(js|mjs|cjs|json|md)$/.test(entry.name)) {
          if (readFileSync(path, 'utf-8').includes(REPO_ROOT)) {
            guilty.push(path.slice(into.length + 1));
          }
        }
      }
    };
    walk(into);

    expect(guilty).toEqual([]);
  });
});

describe('негодный обвес: бандла из него не бывает', () => {
  it('отказ приходит от проверки и НЕ переупаковывается', () => {
    requireBuiltDoor();
    const broken = join(box('broken'), 'обвес');
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      join(broken, 'package.json'),
      '{ "name": "@чужой/не-обвес", "version": "1.0.0" }\n',
    );

    const report = bundle(broken, { into: join(box('bundle'), 'выдача') });

    expect(report.ok).toBe(false);
    // Побайтово отказ упаковки: своего «обвес непригоден» бандл поверх не
    // пишет — две правды об одном событии это два события для читателя.
    expect(report.problems).toEqual([]);
    expect(report.pack.ok).toBe(false);
    expect(report.pack.problems.length).toBeGreaterThan(0);

    // И шаги, до которых не дошли, названы пропущенными с причиной, а не
    // молча отсутствуют.
    const skipped = report.stages.filter((stage) => stage.status === 'skipped');
    expect(skipped.map((stage) => stage.name)).toEqual([
      'runtime',
      'launcher',
      'docs',
      'verify',
    ]);
    expect(skipped[0].reason).toContain('негодного обвеса не бывает');
  });
});

describe('INSTALL.md написан про КОНКРЕТНЫЙ обвес', () => {
  it('называет пакет, его артефакты и что коммитить', () => {
    requireBuiltDoor();
    const into = join(box('bundle'), 'выдача');
    const report = bundle(DEVBOX, { into });

    const doc = readFileSync(join(into, 'INSTALL.md'), 'utf-8');

    expect(doc).toContain(report.pack.manifest?.source.package.name ?? '—');
    for (const artifact of report.pack.manifest?.artifacts ?? []) {
      expect(doc).toContain(artifact.dest);
    }

    // Файл настроек назван по НАСТОЯЩЕМУ имени этого обвеса, а не плейсхолдером:
    // человек, открывший бандл, читает про то, что у него в руках. И сказано,
    // что коммитить его надо, — иначе настройки уедут только у него одного.
    const tuning = sourceConfigPath(report.pack.manifest?.source.id ?? '');
    expect(doc).toContain(tuning);
    expect(
      doc.split('\n').find((line) => line.startsWith(`| \`${tuning}\``)),
    ).toContain('в git');
    // И про то, что дверь пишет в него ровно один раз: обещание, названное в
    // доке, — такой же контракт, как код.
    expect(doc).toContain('ОДИН РАЗ');
    expect(doc).toContain('Значений она не пишет никогда');
    // Служебная запись обязана коммититься, и это сказано человеку, а не
    // оставлено в комментарии к константе.
    expect(doc).toContain('baser.lock.json');
    // И что будет с его собственным файлом — до того, как он запустит.
    expect(doc).toContain('Ничего не будет затёрто');
    expect(doc).toContain('--confirm');
  });
});

describe('УНЕСЛИ И ЗАРАБОТАЛО', () => {
  /** Бандл, унесённый в сторону от монорепы, и чужой репозиторий рядом. */
  function carried(): { far: string; repo: string } {
    requireBuiltDoor();
    const built = join(box('bundle'), 'выдача');
    bundle(DEVBOX, { into: built });

    const repo = join(box('repo'), 'weber');
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, 'package.json'),
      '{ "name": "weber", "private": true }\n',
    );

    // Бандл унесён от монорепы и положен В ЛОКАЦИЮ — туда, куда его кладёт
    // человек по доке («положи эту папку в корень своего репозитория»).
    // Место стало значимым: обвес в локацию не копируется, дверь берёт его
    // прямо отсюда, а содержимое обязано быть видно дереву локации
    // (`tasker:BASER2-146`).
    const far = join(repo, 'выдача-унесённая');
    cpSync(built, far, { recursive: true });
    return { far, repo };
  }

  /** Установщик — ОТДЕЛЬНЫМ процессом: только так вопрос задаётся честно. */
  function install(far: string, repo: string, ...args: string[]): string {
    try {
      return runSealed(
        process.execPath,
        [join(far, 'install.mjs'), '--cwd', repo, ...args],
        { cwd: repo },
      );
    } catch (cause) {
      return String((cause as { stdout?: string }).stdout ?? cause);
    }
  }

  /**
   * `--json` глазами того, ради кого флаг существует: скрипта.
   *
   * Он не читает — он разбирает. Поэтому проба и разбирает, а не сверяет
   * подстроки: «похоже на JSON» и «является JSON» — разные утверждения, и
   * второе флаг обещает с рождения (`tasker:BASER2-36`).
   */
  function installJson(
    far: string,
    repo: string,
    ...args: string[]
  ): { parsed: unknown; raw: string } {
    let raw: string;
    try {
      raw = runSealed(
        process.execPath,
        [join(far, 'install.mjs'), '--cwd', repo, '--json', ...args],
        { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (cause) {
      raw = String((cause as { stdout?: string }).stdout ?? cause);
    }
    return { parsed: JSON.parse(raw), raw };
  }

  it('--json: сухой прогон отдаёт РАЗБИРАЕМЫЕ данные', () => {
    const { far, repo } = carried();

    const { parsed } = installJson(far, repo, '--plan');

    // Проза установщика (строка про положенный обвес сверху и отчёт уборки
    // снизу) ломала разбор с рождения флага: JSON был валиден, вывод — нет.
    expect((parsed as { command?: string }).command).toBe('plan');
    expect((parsed as { doorSchemaVersion?: number }).doorSchemaVersion).toBe(
      DOOR_SCHEMA_VERSION,
    );
  });

  it('--json: установка отдаёт РАЗБИРАЕМЫЕ данные', () => {
    const { far, repo } = carried();

    const { parsed } = installJson(far, repo);

    expect((parsed as { status?: string }).status).toBe('applied');
  });

  it('--json: отказ двери тоже разбирается', () => {
    const { far, repo } = carried();
    mkdirSync(join(repo, '.devcontainer'), { recursive: true });
    writeFileSync(
      join(repo, '.devcontainer/devcontainer.json'),
      '{ "name": "мой, руками" }\n',
    );

    // Отказ — тот путь, на котором проза уборки печатается ровно так же, а
    // код возврата ненулевой: разбор обязан пережить и это.
    const { parsed } = installJson(far, repo);

    expect((parsed as { status?: string }).status).toBe('blocked');
  });

  it('--json: человек не остаётся без рассказа — он уходит в stderr', () => {
    const { far, repo } = carried();

    const streams = streamsSealed(
      process.execPath,
      [join(far, 'install.mjs'), '--cwd', repo, '--plan', '--json'],
      { cwd: repo },
    );

    // Уводить прозу в никуда было бы починкой за счёт человека: он по-прежнему
    // обязан узнать, ОТКУДА взялся обвес, который ему сейчас разложат.
    JSON.parse(streams.stdout);
    expect(streams.stderr).toContain('@omnifield/baser-devbox');
    expect(streams.stderr).toMatch(/из этой папки|не копируется/);
  });

  it('чистый чужой репозиторий: одна команда — и обвес разложен', () => {
    const { far, repo } = carried();

    const out = install(far, repo);

    expect(out).toContain('применено и записано на диск');
    expect(existsSync(join(repo, '.devcontainer/devcontainer.json'))).toBe(
      true,
    );
    expect(existsSync(join(repo, 'baser.lock.json'))).toBe(true);
    expect(existsSync(join(repo, 'baser.json'))).toBe(true);

    // Второй прогон сходится — тот же инвариант, что и у поставленного пакета.
    expect(install(far, repo)).toContain('сошлось');
  });

  it('сухой прогон не раскладывает артефактов', () => {
    const { far, repo } = carried();

    const out = install(far, repo, '--plan');

    expect(out).toContain('план применим');
    expect(existsSync(join(repo, '.devcontainer'))).toBe(false);
    expect(existsSync(join(repo, 'baser.json'))).toBe(false);
  });

  it('INSTALL.md не врёт про то, что сухой прогон ТРОГАЕТ и что оставляет', () => {
    const { far, repo } = carried();
    const before = readFileSync(join(repo, 'package.json'), 'utf-8');

    install(far, repo, '--plan');

    // Прежде дока обещала уборку («обвес кладётся в node_modules, запись
    // снимается»), и обещание было верным. Теперь верно другое, и проверяется
    // тоже оно: в локацию не кладётся НИЧЕГО — ни склада, ни строки в чужом
    // манифесте (`tasker:BASER2-146`).
    expect(existsSync(join(repo, 'node_modules'))).toBe(false);
    expect(readFileSync(join(repo, 'package.json'), 'utf-8')).toBe(before);

    const doc = readFileSync(join(far, 'INSTALL.md'), 'utf-8');
    expect(doc).toMatch(/не кладётся|не копируется/);
    expect(doc).toContain('--source');
  });

  it('WEBER: первая установка в непустой репозиторий — отказ, --confirm снимает', () => {
    const { far, repo } = carried();
    mkdirSync(join(repo, '.devcontainer'), { recursive: true });
    writeFileSync(
      join(repo, '.devcontainer/devcontainer.json'),
      '{\n  "name": "старый девбокс, руками"\n}\n',
    );

    const refused = install(far, repo);

    // Файл человека не тронут, и причина названа не как потеря.
    expect(refused).toContain('первая установка в непустой репозиторий');
    expect(refused).toContain('НЕ ТРОНУЛИ');
    expect(
      readFileSync(join(repo, '.devcontainer/devcontainer.json'), 'utf-8'),
    ).toContain('старый девбокс, руками');

    const confirmed = install(
      far,
      repo,
      '--confirm',
      '.devcontainer/devcontainer.json',
    );

    expect(confirmed).toContain('применено и записано на диск');
    const landed = readFileSync(
      join(repo, '.devcontainer/devcontainer.json'),
      'utf-8',
    );
    expect(landed).not.toContain('старый девбокс, руками');
    // Имя посчитано резолвером обвеса от каталога ЦЕЛИ, а не от монорепы.
    expect(landed).toContain('weber-devbox');
  });

  it('обвес берётся ИЗ ПАПКИ БАНДЛА, а в локацию не кладётся вовсе', () => {
    const { far, repo } = carried();
    const before = readFileSync(join(repo, 'package.json'), 'utf-8');

    const out = install(far, repo, '--plan');

    // План посчитан — значит дверь обвес нашла. Нашла она его по названному
    // каталогу, и доказательство тому — отсутствие всего остального: имитации
    // пакетного менеджера здесь больше нет, потому что она больше не нужна.
    expect(out).toContain('план применим');
    expect(statSync(join(far, 'payload')).isDirectory()).toBe(true);
    expect(existsSync(join(repo, 'node_modules'))).toBe(false);
    expect(readFileSync(join(repo, 'package.json'), 'utf-8')).toBe(before);
  });
});
