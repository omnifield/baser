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
import { execFileSync } from 'node:child_process';
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
import { bundle } from './bundle.js';

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
    // Служебная запись обязана коммититься, и это сказано человеку, а не
    // оставлено в комментарии к константе.
    expect(doc).toContain('baser.lock.json');
    expect(doc).toContain('node_modules/');
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

    const far = join(box('far'), 'выдача-унесённая');
    cpSync(built, far, { recursive: true });

    const repo = join(box('repo'), 'weber');
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, 'package.json'),
      '{ "name": "weber", "private": true }\n',
    );
    return { far, repo };
  }

  /** Установщик — ОТДЕЛЬНЫМ процессом: только так вопрос задаётся честно. */
  function install(far: string, repo: string, ...args: string[]): string {
    try {
      return execFileSync(
        process.execPath,
        [join(far, 'install.mjs'), '--cwd', repo, ...args],
        { encoding: 'utf-8', cwd: repo },
      );
    } catch (cause) {
      return String((cause as { stdout?: string }).stdout ?? cause);
    }
  }

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

    // Тронуто то же, что тронул бы `npm i`, — но остаётся из этого только
    // склад: запись в манифесте живёт ровно прогон (`tasker:BASER2-35`).
    // Инструкция, назвавшая одно и умолчавшая о другом, была бы тем же
    // уверенным указателем не туда, за который здесь уже чинили сообщения.
    expect(existsSync(join(repo, 'node_modules/@omnifield/baser-devbox'))).toBe(
      true,
    );
    expect(readFileSync(join(repo, 'package.json'), 'utf-8')).toBe(before);

    const doc = readFileSync(join(far, 'INSTALL.md'), 'utf-8');
    expect(doc).toContain('node_modules/');
    expect(doc).toContain('package.json');
    expect(doc).toMatch(/сниме|снимае/);
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

  it('обвес встал так, как его поставил бы пакетный менеджер — НА ПРОГОН', () => {
    const { far, repo } = carried();

    const out = install(far, repo, '--plan');

    // Файлы на месте — и пакет был ОБЪЯВЛЕН зависимостью, иначе дверь
    // скопированного каталога не увидела бы: половина имитации хуже её
    // отсутствия. Доказательство объявления — сам план: без него ответом было
    // бы «обвесов не поставлено».
    const installed = join(repo, 'node_modules/@omnifield/baser-devbox');
    expect(statSync(installed).isDirectory()).toBe(true);
    expect(out).toContain('план применим');

    // А после прогона имитация сворачивается: запись, которую нельзя
    // закоммитить, за собой не оставляют (`tasker:BASER2-35`).
    const manifest = JSON.parse(
      readFileSync(join(repo, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.['@omnifield/baser-devbox']).toBeUndefined();
  });
});
