/**
 * КОМАНДА УСТАНОВКИ ИЗ ДОКИ — ИСПОЛНЯЕТСЯ, А НЕ ВЫЧИТЫВАЕТСЯ.
 *
 * Первая обратная связь от чужого продукта (`tasker:BASER2-103`) началась с
 * красной команды: `pnpm add -D @omnifield/baser-devbox` в pnpm-воркспейсе
 * отвечает `ERR_PNPM_ADDING_TO_ROOT`. Это была ПЕРВАЯ команда, которую выполнил
 * чужой человек, и первое, что он увидел от станка (`tasker:BASER2-104`).
 *
 * Класс тот же, что зона чистила весь этап — обещание, которое не выполняется, —
 * только здесь оно ИСПОЛНЯЕМОЕ: проверяется прогоном за секунду. Приём взят у
 * двери (`baser-cli/src/lib/first-five-minutes.spec.ts`): команда РАЗБИРАЕТСЯ ИЗ
 * ДОКИ и запускается, а не переписывается в пробу. Проба, гоняющая собственную
 * копию команды, доказывает только её.
 *
 * ── ПОЧЕМУ ФОРМ ДВЕ, И ОБЕ ПРОВЕРЯЮТСЯ ──────────────────────────────────────
 *
 * `pnpm` не даёт одной формы на оба случая, и это его решение, не наше:
 *
 * | раскладка репозитория | без `-w`                 | с `-w`                        |
 * | --------------------- | ------------------------ | ----------------------------- |
 * | pnpm-воркспейс        | `ERR_PNPM_ADDING_TO_ROOT` | ставится в корень             |
 * | обычный репозиторий   | ставится                 | `may only be used inside a workspace` |
 *
 * Поэтому дока называет обе, а проба исполняет каждую в СВОЕЙ раскладке — и,
 * отдельно, каждую в ЧУЖОЙ. Без второй половины «форм две» осталось бы словами:
 * обе команды зеленели бы там, где хватило бы и одной.
 *
 * ── ЧТО ПОДМЕНЯЕТСЯ И ПОЧЕМУ ЭТО ЧЕСТНО ─────────────────────────────────────
 *
 * Из команды берутся ФЛАГИ И ФОРМА — именно они и сломались, — а спецификатор
 * пакета подменяется на тарбол этого же обвеса. Поход в реестр проверял бы сеть
 * и публикацию, а не нашу доку; `ERR_PNPM_ADDING_TO_ROOT` при этом случается ДО
 * всякого разрешения версий, то есть ровно то, что чинится, подмена не прячет.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVBOX_PACKAGE, PACKAGE_DIR, packedTarball } from './packed.mjs';

const README = join(PACKAGE_DIR, 'README.md');

const boxes = [];

afterEach(() => {
  while (boxes.length > 0) {
    rmSync(boxes.pop(), { force: true, recursive: true });
  }
});

/** Содержимое ```-блоков доки по порядку — тот же разбор, что у двери. */
function codeBlocks(doc) {
  return [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) =>
    match[1].trim(),
  );
}

/**
 * Команды `pnpm add` из доки, каждая — своим списком аргументов.
 *
 * Комментарий над командой едет вместе с ней: он и есть ярлык раскладки, для
 * которой команда написана, и проба сверяет ярлык, а не порядок строк.
 */
function installCommands() {
  const doc = readFileSync(README, 'utf-8');
  const out = [];
  let label = '';
  for (const block of codeBlocks(doc)) {
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('#')) {
        label = line.slice(1).trim();
        continue;
      }
      if (line.startsWith('pnpm add')) {
        out.push({ label, argv: line.split(/\s+/).slice(1) });
      }
    }
  }
  return out;
}

/** Репозиторий потребителя: pnpm-воркспейс или обычный, по-настоящему. */
function repository(kind) {
  const root = mkdtempSync(join(tmpdir(), `baser-install-${kind}-`));
  boxes.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'weber', private: true }, null, 2)}\n`,
  );

  if (kind === 'workspace') {
    // ДВЕ группы пакетов, а не одна, и это не украшение фикстуры: pnpm поднимает
    // ERR_PNPM_ADDING_TO_ROOT только когда в воркспейсе объявлено больше одного
    // шаблона путей. Ровно поэтому дефект и не всплыл у нас — в корне baser
    // группа одна («packages/*»), и команда без `-w` тут проходит. Фикстура с
    // одной группой зеленела бы на СЛОМАННОЙ команде.
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n  - apps/*\n',
    );
    for (const [dir, name] of [
      ['packages/kit', 'kit'],
      ['apps/web', 'web'],
    ]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(
        join(root, dir, 'package.json'),
        `${JSON.stringify({ name, version: '0.0.0' }, null, 2)}\n`,
      );
    }
  }

  // Клетка вокруг npm-контекста: у прогона свой пользовательский конфиг может
  // указывать на приватный реестр машины, а проба обязана быть герметичной
  // независимо от того, из-под чего её запустили.
  const userconfig = join(root, 'npmrc');
  writeFileSync(userconfig, '');
  return { root, userconfig };
}

/** Исполняет команду ИЗ ДОКИ, подставив вместо имени пакета его тарбол. */
function install({ argv }, repo) {
  const args = argv.map((word) =>
    word === DEVBOX_PACKAGE ? packedTarball() : word,
  );
  expect(args, 'в команде доки не нашлось имени обвеса').not.toEqual(argv);

  try {
    execFileSync('pnpm', args, {
      cwd: repo.root,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: {
        ...process.env,
        NPM_CONFIG_USERCONFIG: repo.userconfig,
      },
    });
    return { ok: true, output: '' };
  } catch (failure) {
    return {
      ok: false,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

/** Ставший зависимостью обвес — глазами манифеста, а не вывода команды. */
function devDependency(repo) {
  const manifest = JSON.parse(
    readFileSync(join(repo.root, 'package.json'), 'utf-8'),
  );
  return manifest.devDependencies?.[DEVBOX_PACKAGE] ?? null;
}

describe('дока называет ОБЕ формы установки, и они не перепутаны', () => {
  it('команд ровно две: воркспейс и обычный репозиторий, каждая с ярлыком', () => {
    const commands = installCommands();

    expect(commands).toHaveLength(2);
    const [workspace, plain] = commands;
    expect(workspace.label).toContain('воркспейс');
    expect(workspace.argv).toContain('-w');
    expect(plain.argv).not.toContain('-w');
    // Обе ставят обвес в РАЗРАБОТЧЕСКИЕ зависимости: обвес не едет в рантайм.
    for (const command of commands) {
      expect(command.argv).toContain('-D');
      expect(command.argv).toContain(DEVBOX_PACKAGE);
    }
  });
});

describe('КОМАНДА ИЗ ДОКИ РАБОТАЕТ: каждая форма в своей раскладке', () => {
  it('монорепозиторий: команда с -w ставит обвес в корень воркспейса', () => {
    const [workspace] = installCommands();
    const repo = repository('workspace');

    const result = install(workspace, repo);

    expect(result.ok, `команда доки упала: ${result.output}`).toBe(true);
    expect(devDependency(repo)).not.toBe(null);
  });

  it('обычный репозиторий: команда без -w ставит обвес', () => {
    const [, plain] = installCommands();
    const repo = repository('plain');

    const result = install(plain, repo);

    expect(result.ok, `команда доки упала: ${result.output}`).toBe(true);
    expect(devDependency(repo)).not.toBe(null);
  });
});

describe('формы РАЗНЫЕ по существу, а не по вкусу автора доки', () => {
  it('в воркспейсе форма без -w — тот самый ERR_PNPM_ADDING_TO_ROOT', () => {
    // Дефект weber воспроизведён целиком: это и есть краснота, против которой
    // стоит первая проба. Без неё «нужен -w» осталось бы утверждением доки.
    const [, plain] = installCommands();
    const repo = repository('workspace');

    const result = install(plain, repo);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('ERR_PNPM_ADDING_TO_ROOT');
    expect(devDependency(repo)).toBe(null);
  });

  it('вне воркспейса форма с -w — отказ pnpm, а не безобидный лишний флаг', () => {
    const [workspace] = installCommands();
    const repo = repository('plain');

    const result = install(workspace, repo);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('may only be used inside a workspace');
    expect(devDependency(repo)).toBe(null);
  });
});
