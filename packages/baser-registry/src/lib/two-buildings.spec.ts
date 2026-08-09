/**
 * ДВЕ ПОСТРОЙКИ В ОДНОЙ ЛОКАЦИИ — проба, ради которой всё переделывалось.
 *
 * Замер, вскрывший дефект (`tasker:BASER2-254`): первая постройка держит
 * поднятый магазин, вторая чистая. Из второй получалось так —
 *
 * | проверка  | было                                             |
 * | --------- | ------------------------------------------------ |
 * | `status`  | `running`, но `pid: null` и склада нет на диске   |
 * | `publish` | товар лёг на склад ПЕРВОЙ постройки, ответ `failed` |
 * | `down`    | `refused` — «чужой процесс гасить не станем»      |
 *
 * Ложный отказ при состоявшемся эффекте: человек читает «не получилось», а
 * пакет уже у соседа.
 *
 * Причина была в уровне: процесс и порт принадлежат контейнеру по построению, а
 * склад лежал в клоне. Теперь магазин целиком — вещь локации, и две постройки
 * рядом перестают быть конфликтом: у них общая раздача, общий склад и общий
 * адрес, как и общий участок (`kb:WORLD-14`).
 *
 * Здесь проверяется ровно это: из второй постройки всё РАБОТАЕТ, а не «работает
 * с оговорками», и при этом видно, что раздачу подняла не она.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { HOME_VARIABLE } from './location.js';
import { down, publish, status, up } from './shop.js';

/** Одна локация: один корень магазина на обе постройки. */
let shopRoot: string;
let first: string;
let second: string;
let environment: NodeJS.ProcessEnv;
let port: number;

const options = () => ({ environment, scopes: async () => [] });

beforeAll(async () => {
  shopRoot = mkdtempSync(join(tmpdir(), 'baser-registry-two-shop-'));
  environment = { [HOME_VARIABLE]: shopRoot };
  port = await freePort();
  writeFileSync(
    shopLayout(environment).config,
    `port: ${port}\n`,
    'utf8',
  );

  // Две постройки одного участка: разные клоны, один контейнер.
  first = makeBuilding('первая');
  second = makeBuilding('вторая');

  await up({ cwd: first, ...options() });
}, 120_000);

afterAll(async () => {
  if (shopRoot) {
    await down({ cwd: first, ...options() });
    for (const path of [shopRoot, first, second]) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}, 120_000);

describe('вторая постройка видит раздачу участка и говорит о ней правду', () => {
  it('status: работает, и процесс НАЗВАН — не «running при pid: null»', async () => {
    const answer = await status({ cwd: second, ...options() });

    expect(answer.state).toBe('running');
    // Тот самый разъезд: заявка лежала в другой постройке, и вторая её не
    // видела. Теперь заявка на уровне локации — процесс называется.
    expect(answer.shop.pid).toBeGreaterThan(0);
    expect(answer.shop.claimed).toBe(true);
  }, 60_000);

  it('и при этом ЗНАЕТ, что поднимала раздачу не она', async () => {
    const mine = await status({ cwd: first, ...options() });
    const theirs = await status({ cwd: second, ...options() });

    expect(mine.building.startedShop).toBe(true);
    expect(theirs.building.startedShop).toBe(false);
    // Обе смотрят на один магазин — это не два разных ответа про одно и то же.
    expect(theirs.location.shopHome).toBe(mine.location.shopHome);
  }, 60_000);
});

describe('публикация из второй постройки кладёт товар на общий склад', () => {
  it('и отвечает УСПЕХОМ, а не ложным failed при уехавшем байте', async () => {
    const where = makePackage(second, '@omnifield/two-buildings', '0.1.0');

    const answer = await publish({
      cwd: second,
      directory: where,
      ...options(),
    });

    // Прежде здесь был `failed` при том, что пакет уже лежал у соседа.
    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.published[0]?.destination).toBe(`http://127.0.0.1:${port}`);
  }, 120_000);

  it('склад один на локацию — товар виден и первой постройке', async () => {
    // «Чужой склад» перестал существовать как понятие: склад у участка один.
    const answer = await status({ cwd: first, ...options() });

    expect(answer.stock.storage).toBe(shopLayout(environment).storage);
    expect(
      existsSync(join(answer.stock.storage, '@omnifield', 'two-buildings')),
    ).toBe(true);
  }, 60_000);

  it('и обе постройки видят одно и то же число пакетов', async () => {
    const mine = await status({ cwd: first, ...options() });
    const theirs = await status({ cwd: second, ...options() });

    expect(theirs.stock.packages).toBe(mine.stock.packages);
    expect(theirs.stock.packages).toBeGreaterThan(0);
  }, 60_000);
});

describe('гасить раздачу участка может любая его постройка', () => {
  it('down из второй постройки закрывает магазин, а не отказывает', async () => {
    // Было `refused`: «чужой процесс гасить не станем». Чужим он не был —
    // раздача общая, как и участок.
    const stopped = await down({ cwd: second, ...options() });

    expect(stopped.outcome, JSON.stringify(stopped.problems)).toBe('stopped');

    const asked = await status({ cwd: first, ...options() });
    expect(asked.state).toBe('closed');
  }, 120_000);

  it('товар после этого на месте — он пережил остановку', async () => {
    expect(
      existsSync(
        join(shopLayout(environment).storage, '@omnifield', 'two-buildings'),
      ),
    ).toBe(true);
  }, 60_000);

  it('и раздачу можно вернуть из ЛЮБОЙ постройки', async () => {
    const started = await up({ cwd: second, ...options() });

    expect(started.outcome).toBe('started');
    expect(started.stock.packages).toBeGreaterThan(0);
    // Теперь подняла её вторая — и ответ САМОГО `up` это уже знает.
    //
    // Первая версия пробы ждала здесь `false` и была зелёной, потому что
    // признак снимался в начале прогона, до записи заявки: команда сообщала,
    // что раздачу подняла не она, сразу после того, как подняла её сама.
    // Поймано живым прогоном — пробы двух построек этого не показывали.
    expect(started.building.startedShop).toBe(true);

    const asked = await status({ cwd: second, ...options() });
    expect(asked.building.startedShop).toBe(true);

    const neighbour = await status({ cwd: first, ...options() });
    expect(neighbour.building.startedShop).toBe(false);
  }, 120_000);
});

function makeBuilding(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `baser-registry-${name}-`));
  // Постройка — это клон: пусть у неё будет граница, как в жизни.
  mkdirSync(join(root, '.git'), { recursive: true });
  return root;
}

function makePackage(where: string, name: string, version: string): string {
  const directory = mkdtempSync(join(where, 'tovar-'));
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name, version, license: 'MIT' }),
    'utf8',
  );
  return directory;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const found = (server.address() as AddressInfo).port;
      server.close(() => resolve(found));
    });
  });
}
