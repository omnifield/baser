/**
 * ПРИЁМКА МАГАЗИНА — ИСПОЛНЕНИЕМ, а не наличием файлов.
 *
 * Каждая проба здесь поднимает настоящую раздачу, публикует настоящим `npm` и
 * ставит настоящей установкой. «Файл лежит» не закрывает ни одного пункта: цена
 * такой приёмки — секунды, и она оплачена сознательно.
 *
 * ── ПУБЛИКАЦИЯ ИДЁТ ПО ПРАВИЛУ, КОТОРОЕ МЫ ОПЛАТИЛИ ЖИВЬЁМ ───────────────────
 *
 * Изолированный конфиг И явный адрес — ВМЕСТЕ, порознь не считается
 * (`tasker:BASER2-249`):
 *
 * - без изоляции чужая скоуп-настройка бьёт `--registry` МОЛЧА, и товар уезжает
 *   в чужой реестр с нулевым кодом возврата — так проба зоны однажды
 *   опубликовала мусор в GitHub Packages организации;
 * - изоляция без адреса хуже: пустой конфиг снимает и скоуп-настройку, и товар
 *   уезжает в ПУБЛИЧНЫЙ npm — наружу и навсегда.
 *
 * Поэтому перед каждой живой публикацией проба СПРАШИВАЕТ `--dry-run`, куда та
 * поедет, и сверяет строку `Publishing to <адрес>` буквально. Замер, а не
 * намерение: «команда выглядит правильной» доказательством не является.
 *
 * ── СТРОКИ КОНФИГА БЕРУТСЯ ИЗ ОТВЕТА КОМАНДЫ ────────────────────────────────
 *
 * `.npmrc` для публикации и установки собирается не руками пробы, а из
 * `access.npmrc` — того, что магазин ОБЕЩАЕТ человеку. Так обещание и его
 * мерило заведены парой: разойдясь, они красят приёмку, а не тихо расходятся.
 *
 * ── АПСТРИМ — ВТОРОЙ МАГАЗИН, А НЕ ПУБЛИЧНЫЙ NPM ────────────────────────────
 *
 * Пункт про прокси проверяется механикой, а не наличием интернета: наверху
 * стоит такая же раздача, поднятая тем же `up`. Проба не ходит в сеть ни разу и
 * потому не мигает в конвейере. Живой публичный апстрим проверен руками при
 * разработке — это другой вопрос (связь), и мешать его с этим не нужно.
 */

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { HOME_VARIABLE } from './location.js';
import { down, publish as shopPublish, status, up } from './shop.js';
import type { ShopResult } from './result.js';

/** Локация с магазином: корень, порт и конфиг, которым в неё ходят. */
interface Shop {
  /** Постройка, из которой зовут команды. */
  readonly root: string;
  /** Корень магазина ЛОКАЦИИ, в которой живёт эта постройка. */
  readonly shopRoot: string;
  readonly port: number;
  readonly npmrc: string;
  /** Окружение, называющее место магазина: у каждой пробы оно своё. */
  readonly environment: NodeJS.ProcessEnv;
}

let upstream: Shop;
let shop: Shop;
let cache: string;

beforeAll(async () => {
  cache = mkdtempSync(join(tmpdir(), 'baser-registry-cache-'));

  // Наверху — такая же раздача. Ей апстрим не нужен: всё, что у неё спросят,
  // положено туда пробой руками.
  upstream = await makeShop({ uplink: null });
  await up({ cwd: upstream.root, environment: upstream.environment });
  await npmrcFromAnswer(upstream);
  publish(upstream, '@sosed/from-upstream', '2.0.0');

  shop = await makeShop({ uplink: `http://127.0.0.1:${upstream.port}` });
}, 60_000);

afterAll(async () => {
  // Процессы гасим ВСЕГДА, даже если пробы упали: утёкшая раздача займёт порт
  // и покрасит следующий прогон причиной, которая к нему не относится.
  for (const one of [shop, upstream]) {
    if (one) await down({ cwd: one.root, environment: one.environment });
    if (one) rmSync(one.root, { recursive: true, force: true });
    if (one) rmSync(one.shopRoot, { recursive: true, force: true });
  }
  if (cache) rmSync(cache, { recursive: true, force: true });
}, 60_000);

describe('1 · в пустой локации магазин поднимается и называет себя', () => {
  it('up поднимает раздачу, а status подтверждает её ответом', async () => {
    const started = await up({ cwd: shop.root, environment: shop.environment });

    expect(started.outcome).toBe('started');
    expect(started.state).toBe('running');

    const asked = await status({ cwd: shop.root, environment: shop.environment });

    expect(asked.state).toBe('running');
    expect(asked.shop.address).toBe(`http://127.0.0.1:${shop.port}`);
    // Живость — ФАКТ ответа раздачи, а не наличие заявки на диске.
    expect(asked.shop.pid).toBeGreaterThan(0);

    // Дальше проба ходит в магазин ТЕМ, что он сам обещает человеку.
    await npmrcFromAnswer(shop);
  });

  it('второй up ничего не перезапускает — установки, идущие сейчас, живы', async () => {
    const again = await up({ cwd: shop.root, environment: shop.environment });

    expect(again.outcome).toBe('already-running');
    expect(again.state).toBe('running');
  });

  it('от магазина осталась ровно одна папка в корне локации', () => {
    // Весь магазин — на уровне локации; в постройке от него не остаётся ничего.
    const layout = shopLayout(shop.environment);
    expect(existsSync(layout.config)).toBe(true);
    expect(existsSync(layout.storage)).toBe(true);
    expect(
      existsSync(join(shop.root, '.baser-registry')),
      'в постройке не должно оставаться ничего от магазина',
    ).toBe(false);
  });
});

describe('2 · в магазин публикуется пакет', () => {
  it('назначение сверяется ДО живой команды, и это наш адрес', () => {
    const where = dryRunDestination(shop, '@omnifield/registry-acceptance', '0.1.0');

    expect(where).toBe(`http://127.0.0.1:${shop.port}`);
  });

  it('публикация проходит', () => {
    const done = publish(shop, '@omnifield/registry-acceptance', '0.1.0');

    expect(done).toContain('@omnifield/registry-acceptance');
  });

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: чужой адрес в окружении не уводит публикацию', () => {
    // Тот самый случай, на котором приёмка уже уехала в публичный npm:
    // переменные окружения бьют файл конфига, а пробы бегут из-под npm, который
    // раздаёт детям свои npm_config_*. Здесь яд подмешан НАМЕРЕННО, и защита
    // обязана его перебить — иначе регресс уедет наружу молча.
    const where = dryRunDestination(shop, '@omnifield/registry-poison', '0.0.1', {
      npm_config_registry: 'https://registry.npmjs.org/',
      'npm_config_@omnifield:registry': 'https://npm.pkg.github.com',
    });

    expect(where).toBe(`http://127.0.0.1:${shop.port}`);
  });

  it('товар виден в ответе магазина', async () => {
    const asked = await status({ cwd: shop.root, environment: shop.environment });

    expect(asked.stock.packages).toBeGreaterThan(0);
  });
});

describe('3 · из магазина пакет ставится — тот самый', () => {
  it('ставится в чистый каталог с холодным кэшем', () => {
    const where = install(shop, '@omnifield/registry-acceptance');
    const manifest = JSON.parse(
      readFileSync(
        join(where, 'node_modules', '@omnifield', 'registry-acceptance', 'package.json'),
        'utf8',
      ),
    ) as { version: string; stamp?: string };

    expect(manifest.version).toBe('0.1.0');
    // Метка внутри пакета: доказывает, что приехал НАШ, а не одноимённый
    // откуда-то ещё. Версии для этого мало — версия совпасть может.
    expect(manifest.stamp).toBe('из этого магазина');
  });
});

describe('4 · down закрывает раздачу, и оттуда больше не ставится', () => {
  it('down отвечает закрытием, status с ним согласен', async () => {
    const stopped = await down({ cwd: shop.root, environment: shop.environment });

    expect(stopped.outcome).toBe('stopped');
    expect(stopped.state).toBe('closed');

    const asked = await status({ cwd: shop.root, environment: shop.environment });

    expect(asked.state).toBe('closed');
    expect(asked.shop.pid).toBeNull();
  });

  it('установка из закрытого магазина не проходит', () => {
    const outcome = tryInstall(shop, '@omnifield/registry-acceptance');

    expect(outcome.code).not.toBe(0);
  });

  it('второй down — не ошибка: команда идемпотентна', async () => {
    const again = await down({ cwd: shop.root, environment: shop.environment });

    expect(again.outcome).toBe('already-closed');
  });
});

describe('5 · up после down — товар на месте. Ради этого всё', () => {
  it('раздача возвращается, и тот же пакет ставится снова', async () => {
    const started = await up({ cwd: shop.root, environment: shop.environment });

    expect(started.outcome).toBe('started');
    expect(started.stock.packages).toBeGreaterThan(0);

    const where = install(shop, '@omnifield/registry-acceptance');

    expect(
      existsSync(
        join(where, 'node_modules', '@omnifield', 'registry-acceptance', 'package.json'),
      ),
    ).toBe(true);
  });
});

describe('6 · перезапуск контейнера: магазин закрыт, товар цел', () => {
  it('заявка пережила процесс — и магазин честно говорит «закрыт»', async () => {
    const before = await status({ cwd: shop.root, environment: shop.environment });
    const pid = before.shop.pid;
    expect(pid).not.toBeNull();

    // Контейнер останавливают не вежливо. Процесс умирает, папка остаётся —
    // ровно в этом состоянии просыпается локация.
    process.kill(pid as number, 'SIGKILL');
    await waitUntilClosed(shop);

    const asked = await status({ cwd: shop.root, environment: shop.environment });

    expect(asked.state).toBe('closed');
    // Заявка на диске осталась: по ней и видно, что магазин НЕ ПЕРЕЖИЛ
    // остановку, а не «его тут никогда не было».
    expect(asked.shop.claimed).toBe(true);
    expect(existsSync(shopLayout(shop.environment).storage)).toBe(true);
  });

  it('up возвращает раздачу с прежним товаром', async () => {
    const started = await up({ cwd: shop.root, environment: shop.environment });

    expect(started.outcome).toBe('started');

    const where = install(shop, '@omnifield/registry-acceptance');

    expect(
      existsSync(
        join(where, 'node_modules', '@omnifield', 'registry-acceptance', 'package.json'),
      ),
    ).toBe(true);
  });
});

describe('7 · чего у нас нет — берётся наверху и кэшируется', () => {
  it('пакет, которого на складе не было, ставится ЧЕРЕЗ магазин', () => {
    const storage = join(shopLayout(shop.environment).storage, '@sosed');
    expect(existsSync(storage)).toBe(false);

    const where = install(shop, '@sosed/from-upstream');
    const manifest = JSON.parse(
      readFileSync(
        join(where, 'node_modules', '@sosed', 'from-upstream', 'package.json'),
        'utf8',
      ),
    ) as { version: string };

    expect(manifest.version).toBe('2.0.0');
  });

  it('и остаётся на складе: прокси кэширует, а не просто проводит', () => {
    // Ради этого прокси и ставится: локация переживает падение апстрима на
    // том, что уже спрашивала.
    expect(
      existsSync(join(shopLayout(shop.environment).storage, '@sosed')),
    ).toBe(true);
  });
});

describe('8 · раздача отвечает не только петле — иначе соседу она бесполезна', () => {
  it('по адресу контейнера в сети магазин отвечает тем же реестром', async () => {
    // ПРОБА СТОИТ РОВНО ЗДЕСЬ, ЧТОБЫ ДЕФОЛТ НЕ СЪЕХАЛ МОЛЧА. Магазин заводят,
    // чтобы соседний контейнер взял пакет; проверка на 127.0.0.1 этого не
    // меряет вовсе — петля отвечает и при запертой раздаче. Поэтому спрашиваем
    // по НЕ-петлевому адресу самого контейнера: он у соседа маршрутизируется
    // так же, как алиас локации (tasker:BASER2-267).
    //
    // Нет ни одного не-петлевого адреса — проба КРАСНАЯ, а не пропущенная:
    // молчаливый пропуск здесь неотличим от исправной видимости, а это ровно
    // тот способ, которым дефолт уезжает незамеченным.
    const outside = outsideAddress();
    expect(
      outside,
      'у контейнера нет ни одного не-петлевого адреса — видимость проверить нечем',
    ).not.toBeNull();

    const response = await fetch(`http://${outside}:${shop.port}/-/ping`, {
      signal: AbortSignal.timeout(5_000),
    });

    expect(response.ok).toBe(true);
    expect(await response.json()).toBeTypeOf('object');
  });

  it('и магазин говорит про это данными, а имя локации не выдумывает', async () => {
    const asked = await status({ cwd: shop.root, environment: shop.environment });

    expect(asked.shop.reach).toBe('network');
    expect(asked.shop.port).toBe(shop.port);
    // Адрес остаётся верным ХОЗЯИНУ: по 0.0.0.0 ходить некуда, а алиас
    // локации магазину неоткуда знать.
    expect(asked.shop.address).toBe(`http://127.0.0.1:${shop.port}`);
  });
});

describe('9 · клон в чистой локации знает, что и куда отгружать', () => {
  // ПРОБА ТЗ ДОСЛОВНО (`tasker:BASER2-270`): постройка приезжает в локацию, и
  // отгрузка идёт БЕЗ ЕДИНОЙ РУЧНОЙ НАСТРОЙКИ — ни адреса, ни списка пакетов
  // команде не называют. Всё, что она знает, приехало вместе с клоном: решения
  // лежат в его схеме и потому переживают пересоздание контейнера, а склад
  // лежит на участке и потому переживает остановку.
  let clone: string;

  beforeAll(() => {
    clone = mkdtempSync(join(tmpdir(), 'baser-registry-clone-'));
    mkdirSync(join(clone, '.git'), { recursive: true });

    for (const [where, name] of [
      ['packages/один', '@omnifield/registry-batch-one'],
      ['packages/два', '@omnifield/registry-batch-two'],
      // Третий пакет собран, но в партию НЕ объявлен: «есть, но не отдаю» —
      // решение владельца, и проверяется оно тем, что он не уехал.
      ['packages/не-в-партии', '@omnifield/registry-batch-kept'],
    ] as const) {
      const directory = join(clone, where);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', license: 'MIT' }),
        'utf8',
      );
    }

    const decisions = join(clone, '.omnifield', 'omnifield-registry.yaml');
    mkdirSync(dirname(decisions), { recursive: true });
    writeFileSync(
      decisions,
      ['shop: true', 'batch:', '  - packages/один', '  - packages/два', ''].join(
        '\n',
      ),
      'utf8',
    );
  });

  afterAll(() => {
    if (clone) rmSync(clone, { recursive: true, force: true });
  });

  it('status читает решения из схемы клона, ничего не запуская', async () => {
    const asked = await status({ cwd: clone, environment: shop.environment });

    expect(asked.building.decisions?.batch).toEqual([
      'packages/один',
      'packages/два',
    ]);
    expect(asked.building.decisions?.address).toBe('location');
    // «Под какими именами» отвечено, но вторым списком имён не спрошено.
    expect(asked.building.decisions?.names).toBe('internal');
  });

  it('publish без единого аргумента отгружает объявленную ПАРТИЮ', async () => {
    const done = await shopPublish({ cwd: clone, environment: shop.environment });

    expect(done.outcome, JSON.stringify(done.problems)).toBe('published');
    expect(done.published.map((one) => one.name).sort()).toEqual([
      '@omnifield/registry-batch-one',
      '@omnifield/registry-batch-two',
    ]);
    for (const one of done.published) {
      expect(one.destination).toBe(`http://127.0.0.1:${shop.port}`);
    }
  }, 180_000);

  it('на складе лежит объявленное — и НЕ лежит то, что не объявляли', async () => {
    for (const name of [
      '@omnifield/registry-batch-one',
      '@omnifield/registry-batch-two',
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${shop.port}/${encodeURIComponent(name)}`,
      );
      expect(response.ok, name).toBe(true);
    }

    const kept = await fetch(
      `http://127.0.0.1:${shop.port}/${encodeURIComponent('@omnifield/registry-batch-kept')}`,
    );
    expect(kept.ok, 'непартийный пакет уехал сам — партия ничего не значит').toBe(
      false,
    );
  });

  it('повтор той же партии спокоен: «уже на складе», а не «сломалось»', async () => {
    const again = await shopPublish({
      cwd: clone,
      environment: shop.environment,
    });

    expect(again.outcome).toBe('already-published');
    expect(again.problems).toEqual([]);
  }, 180_000);
});

/**
 * Адрес этого контейнера в сети — не петля.
 *
 * Тот же адрес, по которому в него приходит сосед: алиас локации в docker-сети
 * разрешается именно в него. Берём первый не-внутренний IPv4; `null` — таких
 * интерфейсов нет вовсе.
 */
function outsideAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const one of addresses ?? []) {
      if (one.family === 'IPv4' && !one.internal) return one.address;
    }
  }
  return null;
}

/** Заводит постройку и магазин её локации; отдаёт то, чем в него ходить. */
async function makeShop(options: { uplink: string | null }): Promise<Shop> {
  const root = mkdtempSync(join(tmpdir(), 'baser-registry-loc-'));
  const shopRoot = mkdtempSync(join(tmpdir(), 'baser-registry-loc-shop-'));
  const environment = { [HOME_VARIABLE]: shopRoot };
  const port = await freePort();

  const config = shopLayout(environment).config;
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(
    config,
    [
      `port: ${port}`,
      ...(options.uplink ? [`uplink: ${options.uplink}`] : []),
      '',
    ].join('\n'),
    'utf8',
  );

  const npmrc = join(root, 'proba.npmrc');
  return { root, shopRoot, port, npmrc, environment };
}

/**
 * Пишет конфиг ИЗ ОТВЕТА МАГАЗИНА и возвращает путь к нему.
 *
 * Строки не сочиняются здесь: берётся `access.npmrc` — ровно то, что магазин
 * обещает человеку. Обещание и его мерило заведены парой.
 */
async function npmrcFromAnswer(one: Shop): Promise<string> {
  const answer: ShopResult = await status({
    cwd: one.root,
    environment: one.environment,
  });
  writeFileSync(one.npmrc, `${answer.access.npmrc.join('\n')}\n`, 'utf8');
  return one.npmrc;
}

function packageDir(name: string, version: string, root: string): string {
  const where = mkdtempSync(join(root, 'tovar-'));
  writeFileSync(
    join(where, 'package.json'),
    JSON.stringify({
      name,
      version,
      license: 'MIT',
      stamp: 'из этого магазина',
    }),
    'utf8',
  );
  return where;
}

/**
 * ОКРУЖЕНИЕ БЕЗ ЧУЖИХ НАСТРОЕК NPM.
 *
 * Третий уровень той же ловушки, и поймал его машинный pre-commit. Приоритет у
 * npm такой: флаги командной строки → ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ → файл конфига.
 * Пробы запускаются из `pnpm verify`, то есть из-под npm, а он раздаёт детям
 * свои `npm_config_*` — и они бьют наш `--userconfig` молча.
 *
 * Так проба, изолированная одним лишь файлом, ушла публиковать в ПУБЛИЧНЫЙ npm.
 * Спасло отсутствие токена (`ENEEDAUTH`), а не наша осторожность: с токеном
 * товар уехал бы наружу и навсегда — ровно то, о чём предупреждал вердикт
 * architect'а в `tasker:BASER2-249`.
 */
function npmEnv(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^npm_config_/i.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/** Адрес магазина — то, куда обязана поехать любая публикация этой пробы. */
function addressOf(one: Shop): string {
  return `http://127.0.0.1:${one.port}`;
}

/**
 * Флаги адреса: общий И на скоуп пакета.
 *
 * Оба, а не один: скоуп-настройка бьёт общий `--registry` молча, поэтому пакету
 * со скоупом адрес называется отдельно и явно.
 */
function addressFlags(one: Shop, name: string): string[] {
  const address = addressOf(one);
  const scope = name.startsWith('@') ? name.split('/')[0] : null;
  return [
    '--registry',
    address,
    ...(scope ? [`--${scope}:registry=${address}`] : []),
  ];
}

/** Куда поедет публикация — спрошено сухим прогоном, а не предположено. */
function dryRunDestination(
  one: Shop,
  name: string,
  version: string,
  poison: Record<string, string> = {},
): string {
  const where = packageDir(name, version, one.root);
  const outcome = spawnSync(
    'npm',
    [
      'publish',
      '--dry-run',
      '--userconfig',
      one.npmrc,
      ...addressFlags(one, name),
    ],
    { cwd: where, encoding: 'utf8', env: { ...npmEnv(), ...poison } },
  );

  const said = `${outcome.stdout}${outcome.stderr}`;
  const found = /Publishing to (\S+)/.exec(said);
  return found ? found[1] : said;
}

/**
 * Публикует — но СНАЧАЛА спрашивает, куда поедет.
 *
 * Сверка стоит внутри самой публикации, а не отдельной пробой: пробу можно
 * забыть позвать, а этот шаг обойти нельзя. Ровно на «забыл проверить»
 * приёмка уже один раз уехала в чужой реестр.
 */
function publish(one: Shop, name: string, version: string): string {
  const destination = dryRunDestination(one, name, version);
  expect(destination, 'публикация поедет НЕ в наш магазин').toBe(addressOf(one));

  const where = packageDir(name, version, one.root);
  const outcome = spawnSync(
    'npm',
    ['publish', '--userconfig', one.npmrc, ...addressFlags(one, name)],
    { cwd: where, encoding: 'utf8', env: npmEnv() },
  );

  const said = `${outcome.stdout}${outcome.stderr}`;
  expect(outcome.status, said).toBe(0);
  return said;
}

function tryInstall(
  one: Shop,
  name: string,
): { code: number | null; said: string } {
  const where = mkdtempSync(join(one.root, 'client-'));
  const outcome = spawnSync(
    'npm',
    [
      'install',
      name,
      '--userconfig',
      one.npmrc,
      ...addressFlags(one, name),
      '--no-package-lock',
      // Кэш свой и холодный: иначе установка могла бы взять пакет из чужого
      // кэша и зеленеть на закрытом магазине.
      '--cache',
      mkdtempSync(join(cache, 'cold-')),
      // ПОВТОРЫ СНЯТЫ НАМЕРЕННО. Проба спрашивает «идёт ли установка из
      // закрытого магазина», а не «сколько npm готов ждать»: с дефолтными
      // повторами он терпел больше минуты и упирался в порог пробы — красное по
      // таймауту вместо честного отказа. Отказ от этого не изменился, изменилось
      // только время, за которое он назван.
      '--fetch-retries',
      '0',
      '--fetch-timeout',
      '5000',
    ],
    { cwd: where, encoding: 'utf8', env: npmEnv() },
  );
  return {
    code: outcome.status,
    said: `${outcome.stdout}${outcome.stderr}`,
  };
}

function install(one: Shop, name: string): string {
  const where = mkdtempSync(join(one.root, 'client-'));
  const outcome = spawnSync(
    'npm',
    [
      'install',
      name,
      '--userconfig',
      one.npmrc,
      ...addressFlags(one, name),
      '--no-package-lock',
      '--cache',
      mkdtempSync(join(cache, 'cold-')),
    ],
    { cwd: where, encoding: 'utf8', env: npmEnv() },
  );
  expect(outcome.status, `${outcome.stdout}${outcome.stderr}`).toBe(0);
  return where;
}

/** Ждёт, пока раздача перестанет отвечать: смерть процесса не мгновенна. */
async function waitUntilClosed(one: Shop): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const asked = await status({ cwd: one.root });
    if (asked.state === 'closed') return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
