/**
 * ПЕРВЫЕ ПЯТЬ МИНУТ ЧЕЛОВЕКА С БАНДЛОМ.
 *
 * Три дефекта (`tasker:BASER2-33`, `BASER2-34`, `BASER2-35`) нашлись за две
 * минуты живого переезда на weber и ни один — за 410 зелёных тестов. Причина
 * одна: все они живут не в коде, а в СРЕДЕ и в переходах между «собрали» и
 * «человек запустил».
 *
 * - бит исполнения теряется НА ПУТИ к потребителю, а не при сборке;
 * - Node проверяли там, где он есть по умолчанию, — внутри девбокса;
 * - запись в чужом `package.json` мешает не прогону, а КОММИТУ после него.
 *
 * Поэтому пробы здесь спрашивают ровно то, чего не спрашивает сборка: права
 * после архива, запуск без Node на `PATH`, состояние ЧУЖОГО РЕПОЗИТОРИЯ (не
 * каталога) после прогона — глазами `git status`.
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
import { basename, dirname, join, resolve } from 'node:path';
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

function requireBuiltDoor(): void {
  if (!existsSync(DOOR_DIST)) {
    throw new Error(
      `дверь не собрана (${DOOR_DIST}). Приёмка бандла идёт по dist — собери пакет перед прогоном`,
    );
  }
}

/** Собранный бандл. */
function built(): string {
  requireBuiltDoor();
  const into = join(box('bundle'), 'baser-devbox-bundle');
  const report = bundle(DEVBOX, { into });
  expect(report.ok).toBe(true);
  return into;
}

/** Чужой репозиторий — НАСТОЯЩИЙ git, иначе `git status` спросить не у кого. */
function repository(options: { manifest?: boolean; ignore?: boolean } = {}) {
  const repo = join(box('repo'), 'weber');
  mkdirSync(repo, { recursive: true });
  if (options.manifest !== false) {
    writeFileSync(
      join(repo, 'package.json'),
      '{\n  "name": "weber",\n  "private": true\n}\n',
      'utf-8',
    );
  }
  if (options.ignore !== false) {
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n', 'utf-8');
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'исходный репозиторий');
  return repo;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.email=проба@baser',
      '-c',
      'user.name=проба',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repo, encoding: 'utf-8' },
  );
}

/** Что видит человек, набравший `git status` перед коммитом. */
function status(repo: string): string[] {
  return git(repo, 'status', '--porcelain')
    .split('\n')
    .filter((line) => line !== '');
}

/** Установщик — ОТДЕЛЬНЫМ процессом: только так вопрос задаётся честно. */
function install(
  bundleDir: string,
  repo: string,
  ...args: string[]
): { out: string; code: number } {
  try {
    return {
      out: execFileSync(
        process.execPath,
        [join(bundleDir, 'install.mjs'), '--cwd', repo, ...args],
        { encoding: 'utf-8', cwd: repo },
      ),
      code: 0,
    };
  } catch (cause) {
    const failure = cause as { stdout?: string; status?: number };
    return { out: String(failure.stdout ?? cause), code: failure.status ?? 1 };
  }
}

describe('BASER2-33 · шебанг есть — бит исполнения обязан быть тоже', () => {
  it('запускаемые файлы бандла собраны исполняемыми', () => {
    const into = built();

    for (const name of ['install.mjs', 'baser.mjs']) {
      const file = join(into, name);
      expect(readFileSync(file, 'utf-8').startsWith('#!')).toBe(true);
      // Шебанг без бита — обещание «запускай напрямую», которого файл не держит.
      expect(statSync(file).mode & 0o111).toBeGreaterThan(0);
    }
  });

  it('обещание симметрично: бита без шебанга в бандле тоже нет', () => {
    const into = built();

    // Бит без шебанга — сломанный запуск: система отдаст файл шеллу, и он
    // споткнётся об import на первой же строке.
    for (const entry of readdirSync(into, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(mjs|js|cjs)$/.test(entry.name)) {
        continue;
      }
      const file = join(into, entry.name);
      const executable = (statSync(file).mode & 0o111) > 0;
      const shebang = readFileSync(file, 'utf-8').startsWith('#!');
      expect([entry.name, executable]).toEqual([entry.name, shebang]);
    }
  });

  it('бит переживает ДОРОГУ: архив, распаковка, прямой запуск без node', () => {
    const into = built();
    const carried = box('carried');

    // Мы уносим бандл архивом — значит именно этот путь и обязан держать права.
    execFileSync('tar', [
      '-cf',
      join(carried, 'bundle.tar'),
      '-C',
      dirname(into),
      basename(into),
    ]);
    execFileSync('tar', ['-xf', join(carried, 'bundle.tar'), '-C', carried]);

    const unpacked = join(carried, basename(into));
    expect(
      statSync(join(unpacked, 'install.mjs')).mode & 0o111,
    ).toBeGreaterThan(0);

    // И запуск НАПРЯМУЮ, без `node` в командной строке: ровно то движение,
    // которым человек упёрся в `Permission denied`.
    const out = execFileSync(join(unpacked, 'install.mjs'), ['--help'], {
      encoding: 'utf-8',
    });
    expect(out).toContain('install.mjs');
  });
});

describe('BASER2-34 · Node на хосте — предусловие, а не данность', () => {
  it('без Node на PATH прямой запуск не проходит — предусловие ПОСТРОЕНО', () => {
    const into = built();

    // Ровно та слепота, что породила дефект: все прогоны шли там, где Node
    // есть по умолчанию. Здесь его нет — и видно, что человеку не поможет
    // ничего, кроме доки.
    //
    // ── ПОЧЕМУ КАТАЛОГ, А НЕ СПИСОК СИСТЕМНЫХ ПУТЕЙ (`tasker:BASER2-56`) ────
    //
    // Здесь стоял `PATH=/usr/bin:/bin` — то есть пустота УГАДЫВАЛАСЬ: в образе
    // `typescript-node` Node лежит в `/usr/local/bin`, и предусловие верно, а в
    // Alpine ровно в `/usr/bin`, и оно ложно — запуск проходит, проба краснеет,
    // проверив занятое. Предусловие, которое держит только одно окружение, —
    // не предусловие. Пустой каталог строится и держится везде.
    const empty = box('empty-path');
    expect(readdirSync(empty)).toEqual([]);

    expect(() =>
      execFileSync(join(into, 'install.mjs'), ['--help'], {
        encoding: 'utf-8',
        env: { PATH: empty },
      }),
    ).toThrow();

    // И вторая половина утверждения: падает оно ИМЕННО от отсутствия Node, а не
    // от пустого окружения вообще. Добавляем в тот же `PATH` каталог живого
    // интерпретатора — и та же команда проходит. Без этой пары первая проверка
    // зеленела бы на любой поломке запуска.
    expect(
      execFileSync(join(into, 'install.mjs'), ['--help'], {
        encoding: 'utf-8',
        env: { PATH: `${empty}:${dirname(process.execPath)}` },
      }),
    ).toContain('install.mjs');
  });

  it('INSTALL.md называет предусловие ДО первой команды', () => {
    const doc = readFileSync(join(built(), 'INSTALL.md'), 'utf-8');

    // Предусловие названо вслух и названо ВЕРНО: на хосте Node не нужен. Раньше
    // дока обещала обратное («нужен только Node»), и человек упирался в
    // сообщение операционной системы, из которого не следует ничего.
    const precondition = doc.indexOf('На хосте Node не нужен');
    const firstCommand = doc.indexOf('```');
    expect(precondition).toBeGreaterThan(-1);
    expect(precondition).toBeLessThan(firstCommand);
  });

  it('первая команда доки — контейнер, node install.mjs — вторым', () => {
    const doc = readFileSync(join(built(), 'INSTALL.md'), 'utf-8');
    const blocks = codeBlocks(doc);

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[0]).toContain('docker run');
    expect(blocks[0]).toContain('node:22');
    // Файлы обязаны остаться пользовательскими, иначе прилетают root-овы.
    expect(blocks[0]).toContain('--user');
    // `node install.mjs` существует, но НЕ первым и с названным условием.
    const direct = blocks.findIndex((block) =>
      /^node install\.mjs/m.test(block),
    );
    expect(direct).toBeGreaterThan(0);
    expect(doc).toMatch(/[Ее]сли Node на хосте уже есть/);
  });

  it('оговорка про имя репозитория СНЯТА вместе со своей причиной', () => {
    const doc = readFileSync(join(built(), 'INSTALL.md'), 'utf-8');

    // Раньше эта проба требовала обратного: пока имя девбокса приезжало от
    // точки монтирования, дока обязана была про это сказать и пометить
    // временным. `BASER2-32` смержен — имя берётся из `origin`, — и та же
    // логика теперь требует снятия: костыль, переживший свою причину, это ложь
    // в доке (`tasker:BASER2-38`). Помеченное временным обязано уезжать, иначе
    // пометка ничего не значит.
    expect(doc).not.toContain('BASER2-32');
    expect(doc).not.toMatch(/имя девбокса/);
  });

  it('КОМАНДА ИЗ ДОКИ РАБОТАЕТ: то, что запускается внутри контейнера', () => {
    const into = built();
    const repo = repository();
    const doc = readFileSync(join(into, 'INSTALL.md'), 'utf-8');

    // Разбираем НАПИСАННУЮ команду, а не пишем свою: доке верится проверкой.
    const argv = codeBlocks(doc)[0]
      .replace(/\\\n/g, ' ')
      .split(/\s+/)
      .filter((word) => word !== '');
    const image = argv.indexOf('node:22');
    expect(image).toBeGreaterThan(-1);

    // Всё после образа — то, что докер выполняет ВНУТРИ. Оболочку контейнера
    // проверить отсюда нечем (докера в девбоксе нет), но её содержимое —
    // можно, и именно в нём живут наши обещания: относительный путь до
    // установщика, рабочий каталог = репозиторий, отсутствие --cwd.
    const inside = argv.slice(image + 1);
    expect(inside[0]).toBe('node');
    const bundleName = dirname(inside[1]);
    cpSync(into, join(repo, bundleName), { recursive: true });

    const out = execFileSync(process.execPath, inside.slice(1), {
      cwd: repo,
      encoding: 'utf-8',
    });
    expect(out).toContain('план применим');
  });
});

describe('BASER2-35 · ручная доставка не оставляет того, что нельзя закоммитить', () => {
  it('после сухого прогона git status ПУСТ', () => {
    const into = built();
    const repo = repository();
    const before = readFileSync(join(repo, 'package.json'), 'utf-8');

    const { out } = install(into, repo, '--plan');

    expect(out).toContain('план применим');
    expect(status(repo)).toEqual([]);
    // Манифест возвращён побайтово: чужой файл не должен даже переформатироваться.
    expect(readFileSync(join(repo, 'package.json'), 'utf-8')).toBe(before);
  });

  it('после установки коммитить можно ВСЁ, что осталось', () => {
    const into = built();
    const repo = repository();
    const before = readFileSync(join(repo, 'package.json'), 'utf-8');

    install(into, repo);

    // Осталось ровно то, что человек и обязан закоммитить: артефакты, конфиг
    // и служебная запись. Манифеста в списке нет вовсе.
    const changed = status(repo).map((line) => line.slice(3));
    expect(changed).toContain('.devcontainer/');
    expect(changed).toContain('baser.json');
    expect(changed).toContain('baser.lock.json');
    // Файл настроек родился и тоже коммитится: без него у коллеги обвес
    // разложится по дефолтам, а человек будет уверен, что настроил.
    expect(changed).toContain('.omnifield/');
    expect(changed).not.toContain('package.json');
    expect(readFileSync(join(repo, 'package.json'), 'utf-8')).toBe(before);
  });

  it('запись ЖИВЁТ во время прогона — иначе дверь обвеса не увидела бы', () => {
    const into = built();
    const repo = repository();

    const { out } = install(into, repo);

    // Уборка, отменившая саму установку, — не уборка. Артефакты на диске
    // доказывают, что дверь нашла обвес по объявленной зависимости, пока та
    // была объявлена.
    expect(out).toContain('применено и записано на диск');
    expect(existsSync(join(repo, '.devcontainer/devcontainer.json'))).toBe(
      true,
    );
    // А обвес на складе остаётся: git его не отслеживает, он никому не мешает.
    expect(existsSync(join(repo, 'node_modules/@omnifield/baser-devbox'))).toBe(
      true,
    );
  });

  it('установщик ГОВОРИТ, что убрал за собой', () => {
    const into = built();
    const repo = repository();

    const { out } = install(into, repo, '--plan');

    // Молчаливая уборка — тоже молчание: человек должен понимать, что
    // произошло с его манифестом.
    expect(out).toContain('package.json');
    expect(out).toMatch(/сн(ял|ято)|верн(ул|уто)|как был/);
  });

  it('репозиторий БЕЗ package.json: создали — снесли', () => {
    const into = built();
    const repo = repository({ manifest: false });

    const { out } = install(into, repo);

    // В Go- или Python-репозитории чужеродный манифест — след, которого там
    // отродясь не было. Убирать тогда файл целиком, а не строчку.
    expect(out).toContain('применено и записано на диск');
    expect(existsSync(join(repo, 'package.json'))).toBe(false);
    expect(status(repo).map((line) => line.slice(3))).not.toContain(
      'package.json',
    );
  });

  it('второй прогон после уборки сходится — уборка не ломает повторяемость', () => {
    const into = built();
    const repo = repository();

    install(into, repo);
    const again = install(into, repo);

    expect(again.out).toContain('сошлось');
    expect(status(repo).map((line) => line.slice(3))).not.toContain(
      'package.json',
    );
  });

  it('прогон УПАЛ — за собой всё равно убрано', () => {
    const into = built();
    const repo = repository();
    mkdirSync(join(repo, '.devcontainer'), { recursive: true });
    writeFileSync(
      join(repo, '.devcontainer/devcontainer.json'),
      '{\n  "name": "старый девбокс, руками"\n}\n',
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'свой девбокс');
    const before = readFileSync(join(repo, 'package.json'), 'utf-8');

    const { out, code } = install(into, repo);

    // Отказ двери — штатный исход, а не повод оставить мину в манифесте.
    expect(code).not.toBe(0);
    expect(out).toContain('первая установка в непустой репозиторий');
    expect(readFileSync(join(repo, 'package.json'), 'utf-8')).toBe(before);
    expect(status(repo)).toEqual([]);
  });

  it('дока говорит и про САМУ ПАПКУ бандла — она тоже след', () => {
    const into = built();
    const doc = readFileSync(join(into, 'INSTALL.md'), 'utf-8');

    // Докерная команда зовёт установщик относительным путём, то есть просит
    // положить бандл В репозиторий. Значит после прогона он висит в `git
    // status` — и умолчать об этом значило бы оставить след, назвав репозиторий
    // чистым. Живой прогон показал ровно эту строку.
    expect(doc).toContain(`${basename(into)}/`);
    expect(doc).toMatch(/не коммить|удали|унеси/);
  });

  it('дверь после уборки работает: конфиг авторитетнее манифеста', () => {
    const into = built();
    const repo = repository();
    install(into, repo);

    // Уборка снимает запись, по которой обвес НАШЛИ, — и вопрос «а дальше-то
    // дверь его увидит?» надо задать, а не предположить. Ответ: увидит, потому
    // что после установки авторитетен `baser.json`, а он остаётся и коммитится.
    const out = execFileSync(
      process.execPath,
      [join(into, 'baser.mjs'), 'plan', '--cwd', repo],
      { encoding: 'utf-8', cwd: repo },
    );

    expect(out).toContain('сошлось');
    expect(out).not.toContain('обвесов не поставлено');
  });

  it('INSTALL.md описывает уборку как есть', () => {
    const doc = readFileSync(join(built(), 'INSTALL.md'), 'utf-8');

    // Сказано, что запись снимается, — а не только что она появляется.
    expect(doc).toMatch(/сниме|снимае|возвраща/);
    expect(doc).toContain('package.json');
    // И названа причина: пакет нигде не опубликован, поэтому запись не
    // резолвится ни у кого, кроме того, кто держит бандл в руках.
    expect(doc).toMatch(/не опубликован|не резолвится/);
  });
});

/** Содержимое ```-блоков доки по порядку. */
function codeBlocks(doc: string): string[] {
  return [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) =>
    (match[1] as string).trim(),
  );
}
