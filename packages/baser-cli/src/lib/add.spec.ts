/**
 * ПРИВЯЗКА ПОСТАВКИ — `add` объявляет И ПРИМЕНЯЕТ (`tasker:BASER2-201`).
 *
 * Проба спрашивает то, чего не спрашивает ни одна другая: **можно ли начать с
 * пустой локации**. `plan` и `apply` работают против уже написанного
 * `baser.json`, и до этой команды первый шаг любого сценария делался руками
 * (`kb:SANDBOX-4`).
 *
 * ── ПОЧЕМУ НАСТОЯЩИЙ СКЛАД, А НЕ ДЕВ-ПЕТЛЯ ──────────────────────────────────
 *
 * У `add` нет `--source`: человек называет ПАКЕТ, а не каталог, — значит и проба
 * обязана называть пакет. Склад поднимается настоящий (`store.fixture.ts`),
 * поставку достаёт настоящий пакетный менеджер, артефакты ложатся в настоящую
 * локацию. Сети при этом не нужно: склад свой, версии выкладывает сама проба.
 *
 * ── ЧТО ЗДЕСЬ СУДИТСЯ ПОМИМО ПРИЁМКИ ────────────────────────────────────────
 *
 * **Тонкость обёртки.** Консоль не принимает ни одного решения про поставку:
 * отказ на двойном закреплении приезжает СЛОВОМ ДВИЖКА, и проба сверяет его с
 * тем, что движок отдаёт на тот же вход напрямую. Перенос решения в консоль —
 * хоть своим текстом, хоть своим кодом, хоть отказом в разборе argv — красит
 * пробу, потому что два ответа перестают совпадать (`kb:BASER3-33`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareSupply } from '@omnifield/baser-materialize';
import { cli, USAGE } from './cli.js';
import { createRepoTree } from './tree.js';
import { SUPPLY_CACHE_ENV } from './supply.js';
import { startStore, type FakeStore } from './store.fixture.js';
import type { AddResult } from './add.js';

const FIRST = 'baser-fixture-first';
const FIRST_ID = 'fixture/first';
const FIRST_DEST = 'tool/first.json';

const SECOND = 'baser-fixture-second';
const SECOND_ID = 'fixture/second';
const SECOND_DEST = 'tool/second.json';

let store: FakeStore | null = null;
let box: string | null = null;
let restoreCache: (() => void) | null = null;

beforeEach(async () => {
  store = await startStore();
  box = mkdtempSync(join(tmpdir(), 'baser-add-'));

  // Кэш поставок — свой на пробу: `cli` его входом не принимает (и правильно,
  // человеку в терминале настраивать тут нечего), а трогать кэш машины проба не
  // вправе.
  const was = process.env[SUPPLY_CACHE_ENV];
  process.env[SUPPLY_CACHE_ENV] = join(box, 'cache');
  restoreCache = () => {
    if (was === undefined) {
      delete process.env[SUPPLY_CACHE_ENV];
    } else {
      process.env[SUPPLY_CACHE_ENV] = was;
    }
  };
});

afterEach(async () => {
  restoreCache?.();
  restoreCache = null;
  await store?.close();
  store = null;
  if (box !== null) {
    rmSync(box, { force: true, recursive: true });
    box = null;
  }
});

/** Выкладывает версию первой поставки; содержимое различает версии. */
function publishFirst(version: string, content: string): void {
  store?.publish({
    packageName: FIRST,
    version,
    id: FIRST_ID,
    title: 'первая поставка пробы',
    layout: [{ src: 'first.json', dest: FIRST_DEST, render: false }],
    templates: { 'first.json': content },
  });
}

function publishSecond(version: string, content: string): void {
  store?.publish({
    packageName: SECOND,
    version,
    id: SECOND_ID,
    title: 'вторая поставка пробы',
    layout: [{ src: 'second.json', dest: SECOND_DEST, render: false }],
    templates: { 'second.json': content },
  });
}

/** ПУСТАЯ ЛОКАЦИЯ: ни объявления, ни манифеста, ни склада — ничего. */
function emptyLocation(at = 'location'): string {
  const root = join(box ?? '', at);
  mkdirSync(root, { recursive: true });
  return root;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf-8');
}

/** Ответ `add` из вызова консоли — с проверкой, что это именно он. */
function addAnswer(result: unknown): AddResult {
  const outcome = result as { kind?: string; add?: AddResult } | null;
  if (outcome?.kind !== 'add' || outcome.add === undefined) {
    throw new Error(
      `ожидался ответ "add", а пришло ${JSON.stringify(outcome)}`,
    );
  }
  return outcome.add;
}

describe('add объявляет поставку и применяет её', () => {
  it('пустая локация: объявление создано, артефакты разложены, plan сошёлся', async () => {
    publishFirst('1.0.0', '{ "first": true }\n');
    const root = emptyLocation();

    const outcome = await cli(['add', FIRST, '--cwd', root], process.cwd());
    const answer = addAnswer(outcome.result);

    expect(outcome.exitCode).toBe(0);

    // ОБЪЯВЛЕНИЕ — словом движка, а не пересказом консоли.
    expect(answer.declared?.change).toBe('declaration-created');
    expect(JSON.parse(read(root, 'baser.json'))).toEqual({
      formVersion: expect.any(Number),
      sources: [{ use: FIRST }],
    });

    // ПРИМЕНЕНИЕ — той же командой, а не второй. Привязка модуля означает, что
    // он заработал: артефакт лежит на диске, паспорт укладки написан.
    expect(answer.door?.status).toBe('applied');
    expect(read(root, FIRST_DEST)).toBe('{ "first": true }\n');
    expect(existsSync(join(root, 'baser.lock.json'))).toBe(true);

    // И следующий вопрос локации отвечает «делать нечего».
    const planned = await cli(['plan', '--cwd', root], process.cwd());
    const door = (planned.result as { door: { status: string } }).door;
    expect(door.status).toBe('converged');
    expect(planned.stdout).toContain('сошлось');
  });

  it('вторая поставка: первая на месте, обе разложены', async () => {
    publishFirst('1.0.0', '{ "first": true }\n');
    publishSecond('1.0.0', '{ "second": true }\n');
    const root = emptyLocation();

    await cli(['add', FIRST, '--cwd', root], process.cwd());
    const declaredFirst = read(root, 'baser.json');

    const outcome = await cli(['add', SECOND, '--cwd', root], process.cwd());
    const answer = addAnswer(outcome.result);

    expect(outcome.exitCode).toBe(0);
    // Объявление БЫЛО — значит запись добавлена, а не файл переписан заново.
    expect(answer.declared?.change).toBe('supply-added');

    const declared = JSON.parse(read(root, 'baser.json')) as {
      sources: { use: string }[];
    };
    expect(declared.sources).toEqual([{ use: FIRST }, { use: SECOND }]);

    // Соседняя запись вернулась на диск ТЕМИ ЖЕ БАЙТАМИ: строка первой поставки
    // в файле осталась дословно той же, иначе человек увидел бы в `git diff`
    // весь файл вместо одной добавленной поставки (`tasker:BASER2-200`).
    const firstLine = declaredFirst
      .split('\n')
      .find((line) => line.includes(FIRST));
    expect(read(root, 'baser.json')).toContain(firstLine as string);

    // Разложены обе, и первая не снята применением второй.
    expect(read(root, FIRST_DEST)).toBe('{ "first": true }\n');
    expect(read(root, SECOND_DEST)).toBe('{ "second": true }\n');
    expect(answer.door?.runs.length).toBe(2);
  });

  it('метка канала уезжает в объявление, и берётся то, что за ней стоит', async () => {
    publishFirst('1.0.0', '{ "версия": "1.0.0" }\n');
    publishFirst('2.0.0', '{ "версия": "2.0.0" }\n');
    store?.tag(FIRST, 'dev', '1.0.0');
    const root = emptyLocation();

    const outcome = await cli(
      ['add', FIRST, '--channel', 'dev', '--cwd', root],
      process.cwd(),
    );

    expect(outcome.exitCode).toBe(0);
    // Метка ЛОЖИТСЯ в объявление: локация просит сегодняшнее из канала, а не
    // номер, который стоял за ним в день установки.
    expect(JSON.parse(read(root, 'baser.json')).sources).toEqual([
      { use: FIRST, channel: 'dev' },
    ]);
    // И разложено ровно то, что за меткой стоит, а не последнее на складе.
    expect(read(root, FIRST_DEST)).toBe('{ "версия": "1.0.0" }\n');
  });

  it('точный номер закрепляет поставку — и это НЕ вопрос про версии схем', async () => {
    publishFirst('1.0.0', '{ "версия": "1.0.0" }\n');
    publishFirst('2.0.0', '{ "версия": "2.0.0" }\n');
    const root = emptyLocation();

    const outcome = await cli(
      ['add', FIRST, '--version', '1.0.0', '--cwd', root],
      process.cwd(),
    );

    // `--version` носит два смысла, и у `add` он закрепляет поставку. Прочитай
    // консоль его по-старому — она напечатала бы версии схем и не объявила бы
    // ничего.
    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(read(root, 'baser.json')).sources).toEqual([
      { use: FIRST, version: '1.0.0' },
    ]);
    expect(read(root, FIRST_DEST)).toBe('{ "версия": "1.0.0" }\n');
  });

  it('прежний смысл --version цел: без команды и у прочих команд это версии схем', async () => {
    const versions = JSON.parse(
      (await cli(['--version'], process.cwd())).stdout,
    ) as Record<string, number>;
    expect(versions['doorSchemaVersion']).toBeGreaterThan(0);

    const withCommand = JSON.parse(
      (await cli(['plan', '--version'], process.cwd())).stdout,
    ) as Record<string, number>;
    expect(withCommand['formVersion']).toBeGreaterThan(0);
  });
});

describe('отказ назван ДО применения', () => {
  it('метка и номер разом — отказ, и на диск не ушло НИЧЕГО', async () => {
    publishFirst('1.0.0', '{ "first": true }\n');
    const root = emptyLocation();

    const outcome = await cli(
      ['add', FIRST, '--channel', 'dev', '--version', '1.0.0', '--cwd', root],
      process.cwd(),
    );
    const answer = addAnswer(outcome.result);

    expect(outcome.exitCode).toBe(2);
    expect(answer.problems[0].code).toBe('pin-ambiguous');
    // ДО применения — не по порядку строк, а по построению: способность пишет в
    // виртуальное дерево, сбрасывает его консоль, и сброса не было.
    expect(answer.declared).toBeNull();
    expect(answer.door).toBeNull();
    expect(existsSync(join(root, 'baser.json'))).toBe(false);
    expect(existsSync(join(root, 'baser.lock.json'))).toBe(false);
    expect(existsSync(join(root, FIRST_DEST))).toBe(false);
    expect(outcome.stdout).toContain('на диск не ушло НИЧЕГО');
  });

  it('РЕШЕНИЕ ПРИНИМАЕТ ДВИЖОК: отказ консоли равен отказу способности', async () => {
    const root = emptyLocation();

    const outcome = await cli(
      ['add', FIRST, '--channel', 'dev', '--version', '1.0.0', '--cwd', root],
      process.cwd(),
    );
    const answer = addAnswer(outcome.result);

    // Тот же вход, поданный способности напрямую. Совпадать обязаны и код, и
    // адрес, и текст: перенеси решение в консоль — своим отказом в разборе argv,
    // своим сообщением, своим кодом — и два ответа разойдутся.
    const engine = declareSupply.run(createRepoTree(root), {
      use: FIRST,
      channel: 'dev',
      version: '1.0.0',
    });

    expect(engine.ok).toBe(false);
    expect(answer.problems).toEqual(engine.ok ? [] : engine.problems);
  });

  it('поверхность вызова приходит ОТ СПОСОБНОСТИ, а не сочиняется консолью', async () => {
    // Способность описывает себя сама (`kb:BASER3-33`), и каждый её параметр
    // обязан быть достижим из консоли. Приедет у способности новый параметр —
    // проба покраснеет, пока консоль его не назовёт: обёртка, потерявшая
    // параметр, тонкой уже не является.
    for (const parameter of declareSupply.parameters) {
      if (parameter.name === 'use') {
        // Единственный, который консоль подаёт позиционно: `baser add <пакет>`.
        expect(USAGE).toContain('baser add <пакет>');
        continue;
      }
      expect([parameter.name, USAGE.includes(`--${parameter.name}`)]).toEqual([
        parameter.name,
        true,
      ]);
    }
  });
});

describe('ответ машинночитаем в первую очередь', () => {
  it('--json отдаёт РАЗБИРАЕМЫЕ данные, и в них оба ответа целиком', async () => {
    publishFirst('1.0.0', '{ "first": true }\n');
    const root = emptyLocation();

    const outcome = await cli(
      ['add', FIRST, '--cwd', root, '--json'],
      process.cwd(),
    );

    // Разбирается целиком, а не «данные вперемешку с прозой»: то же правило,
    // что у остальных команд.
    const answer = JSON.parse(outcome.stdout) as AddResult;

    expect(answer.doorSchemaVersion).toBeGreaterThan(0);
    // Обе механики отвечают СВОИМИ словами, и консоль их не пересказывает.
    expect(answer.declared?.change).toBe('declaration-created');
    expect(answer.declared?.use).toBe(FIRST);
    expect(answer.door?.command).toBe('apply');
    expect(answer.door?.status).toBe('applied');
    // Трейс консоли — только её собственная работа: сброс объявления на диск.
    expect(answer.trace.map((span) => span.name)).toEqual(['add.flush']);
  });

  it('машинный ответ есть и у отказа — ветвиться по нему, а не по тексту', async () => {
    const root = emptyLocation();

    const outcome = await cli(
      [
        'add',
        FIRST,
        '--channel',
        'dev',
        '--version',
        '1.0.0',
        '--cwd',
        root,
        '--json',
      ],
      process.cwd(),
    );
    const answer = JSON.parse(outcome.stdout) as AddResult;

    expect(answer.problems.map((problem) => problem.code)).toEqual([
      'pin-ambiguous',
    ]);
    expect(answer.door).toBeNull();
  });
});

describe('объявление остаётся, когда применение отказало', () => {
  it('конфликт владения: запись на месте и названа вслух', async () => {
    publishFirst('1.0.0', '{ "first": true }\n');
    const root = emptyLocation();
    // Чужой файл ровно там, куда целится поставка: первая установка в непустой
    // репозиторий — штатный отказ, и чинится он подтверждением.
    mkdirSync(join(root, 'tool'), { recursive: true });
    writeFileSync(join(root, FIRST_DEST), '{ "моё": true }\n');

    const outcome = await cli(['add', FIRST, '--cwd', root], process.cwd());
    const answer = addAnswer(outcome.result);

    // Применение не прошло — а объявление лежит: подтверждение адресуется УЖЕ
    // объявленной поставке, и снятая запись сделала бы починку невозможной.
    expect(outcome.exitCode).not.toBe(0);
    expect(answer.declared?.change).toBe('declaration-created');
    expect(existsSync(join(root, 'baser.json'))).toBe(true);
    expect(read(root, FIRST_DEST)).toBe('{ "моё": true }\n');
    expect(outcome.stdout).toContain('объявление ОСТАЁТСЯ');
    expect(outcome.stdout).toContain('--confirm');

    // И починка ДЕЙСТВИТЕЛЬНО работает тем, что названо: подтверждение по имени.
    const confirmed = await cli(
      ['apply', '--cwd', root, '--confirm', FIRST_DEST],
      process.cwd(),
    );
    expect(confirmed.exitCode).toBe(0);
    expect(read(root, FIRST_DEST)).toBe('{ "first": true }\n');
  });
});
