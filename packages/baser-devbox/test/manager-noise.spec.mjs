/**
 * ОБВЕС НЕ СПОТЫКАЕТСЯ О ТО, ЧТО САМ ЖЕ И ПОСТАВИЛ.
 *
 * Находка потребителя с пересозданного контейнера (`tasker:BASER2-133`,
 * разбор — `tasker:BASER2-136`):
 *
 * ```
 * npm warn Unknown env config "store-dir".
 * This will stop working in the next major version of npm.
 * ```
 *
 * `NPM_CONFIG_STORE_DIR` обвес ставит сам — ради pnpm ниже 11-й линии, которая
 * читает npm-конфиг. npm такого имени не знает и ворчит на КАЖДЫЙ свой вызов, а
 * проверка доступа к реестру звала его дважды: `npm config get` и `npm whoami`.
 * Итог — вывод постсоздания, дважды испачканный нашей же переменной, и заявитель,
 * прочитавший это как «что-то не так с реестром».
 *
 * ── ЧТО ИМЕННО ЗДЕСЬ УТВЕРЖДАЕТСЯ ───────────────────────────────────────────
 *
 * Не «предупреждения не видно» — увидеть его можно только на npm 11-й линии, и
 * проба, зависящая от версии npm НА МАШИНЕ ПРОГОНА, зеленела бы у нас, краснея у
 * потребителя. Поэтому утверждается механика, из которой предупреждение растёт:
 *
 * 1. **проверка реестра не зовёт npm вовсе** — ловушкой в `PATH`, а не чтением
 *    шаблона глазами; ловушка при этом проверяется на себе, иначе пустой её
 *    журнал не доказывал бы ничего;
 * 2. **прогон молчит целиком** — настоящий шаг из артефакта, настоящий pnpm,
 *    настоящий стаб-реестр и ИМЕНА переменных, взятые из `containerEnv`;
 * 3. **стор доживает до установки** — снятие имени у одной команды не имеет права
 *    забрать его у той единственной, которой оно нужно.
 *
 * Третье не формальность: чинить шум, потеряв по дороге адрес стора, значило бы
 * вернуть `tasker:BASER2-111` — смертный стор внутри воркспейса, замеченный через
 * месяц.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerEnv } from './env.mjs';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  packedManifest,
  parseJsonc,
  run,
  tuning,
} from './packed.mjs';

const SCOPE = '@omnifield';
const INSTALL = packedManifest().baser.settings.installCommand.default;

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const box of boxes) {
    rmSync(box, { force: true, recursive: true });
  }
  boxes = [];
});

function box(prefix) {
  const path = mkdtempSync(join(tmpdir(), `baser-devbox-${prefix}-`));
  boxes.push(path);
  return path;
}

/**
 * Полный профиль потребителя: тома (значит имена стора) и приватный реестр
 * (значит проверка). Ровно та раскладка, на которой находка и случилась.
 */
async function materialize(settings = {}) {
  consumer = installConsumer({
    repoName: 'weber',
    config: consumerConfig(),
    tuning: tuning({
      presets: ['omnifield'],
      settings: { npmScope: SCOPE, installAssistant: false, ...settings },
    }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  expect(result.status, JSON.stringify(result.problems)).toBe('applied');
  return parseJsonc(consumer.read(LIVE));
}

/** Шаг проверки реестра — вырезанный из АРТЕФАКТА, а не написанный здесь заново. */
function checkStep(artifact) {
  const post = artifact.postCreateCommand;
  const from = post.indexOf('( reg=');
  const to = post.indexOf(` && ${INSTALL}`);
  expect(
    from !== -1 && to > from,
    `шага проверки нет в постсоздании: ${post}`,
  ).toBe(true);
  return post.slice(from, to);
}

/** Шаг установки ассистента — тоже вырезанный из АРТЕФАКТА, а не собранный здесь. */
function assistantStep(artifact) {
  const step = artifact.onCreateCommand
    .split(' && ')
    .find((part) => part.includes('@anthropic-ai/claude-code'));
  expect(
    step,
    `шага установки ассистента нет в постсоздании: ${artifact.onCreateCommand}`,
  ).toBeTruthy();
  return step;
}

/**
 * Окружение контейнера — ИМЕНАМИ ИЗ АРТЕФАКТА, значениями пробы.
 *
 * Имена свои проба не знает намеренно (то же правило, что в `store.spec.mjs`):
 * знай она их, доказывала бы себя. Значения адресов стора подменяются на
 * временный каталог — настоящий том машины пробе не принадлежит, — а креды
 * уводятся в свой файл с клеткой вокруг него (`registry.spec.mjs` объясняет,
 * почему клетка стоит и на префиксе npm тоже).
 */
function env(artifact, extra = {}) {
  const store = box('store');
  const named = {};
  for (const [key, value] of Object.entries(artifact.containerEnv)) {
    named[key] = key.endsWith('_STORE_DIR') ? store : value;
  }

  const npmrc = join(consumer.root, 'npmrc');
  writeFileSync(npmrc, extra.npmrc ?? '');
  const prefix = join(consumer.root, 'npm-prefix');
  mkdirSync(prefix, { recursive: true });
  named.NPM_CONFIG_USERCONFIG = npmrc;
  named.NPM_CONFIG_PREFIX = prefix;

  return { named: { ...named, ...(extra.named ?? {}) }, store };
}

/** Шелл в корне потребителя — там же, где постсоздание идёт у него. */
function sh(script, named) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', script], {
      cwd: consumer.root,
      env: containerEnv(named),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/**
 * ЛОВУШКА НА NPM: подставной `npm` первым в `PATH`, который ничего не делает, но
 * записывает, что его позвали и с каким окружением.
 *
 * Так предмет проверки перестаёт зависеть от версии npm на машине: ворчит только
 * 11-я линия, а «наша команда показала npm имя, которого он не знает» — факт,
 * видимый на любой.
 */
function npmTrap() {
  const dir = box('npm-trap');
  const log = join(dir, 'calls.log');
  writeFileSync(
    join(dir, 'npm'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "npm $* | store-dir=\${NPM_CONFIG_STORE_DIR:-нет}" >> ${JSON.stringify(log)}`,
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'npm'), 0o755);
  return {
    PATH: `${dir}:${process.env.PATH}`,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf-8').split('\n').filter(Boolean)
        : [],
  };
}

/** Стаб приватного реестра с рабочим доступом. */
async function withRegistry(body) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/-/whoami') {
      res.end(JSON.stringify({ username: 'weber-ci' }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  try {
    return await body({ port: server.address().port, seen });
  } finally {
    server.close();
  }
}

/** Настроенный доступ: реестр и токен на стабе. */
const credentials = (port) =>
  `${SCOPE}:registry=http://127.0.0.1:${port}/\n//127.0.0.1:${port}/:_authToken=tok\n`;

describe('проверка реестра спрашивает ТОГО, КЕМ СТАВИТ', () => {
  it('ЛОВУШКА: npm за весь шаг не позвали ни разу', async () => {
    const artifact = await materialize();
    const step = checkStep(artifact);
    const trap = npmTrap();

    const result = await withRegistry(({ port }) =>
      sh(
        step,
        env(artifact, {
          npmrc: credentials(port),
          named: { PATH: trap.PATH },
        }).named,
      ),
    );

    // Журнал проверяется ПЕРВЫМ, до кода возврата: с ловушкой в `PATH` шаг,
    // который зовёт npm, отказывает и по существу — и упавшая проба называла бы
    // отказ вместо причины, по которой он случился.
    //
    // Пустой журнал — и есть утверждение: обвес ставит pnpm'ом, спрашивает
    // pnpm'ом, и npm в этом шаге не участвует ни прямо, ни через `pnpm whoami`
    // (до 11-й линии pnpm отдаёт его npm'у — `passThruToNpm`).
    expect(trap.calls()).toEqual([]);
    expect(result.code, result.err).toBe(0);
  });

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: ловушка ловит — иначе пустой журнал ничего не значит', async () => {
    const artifact = await materialize();
    const trap = npmTrap();

    // Тот же `PATH`, то же окружение, команда зовёт npm явно. Не сработай
    // ловушка здесь — проба выше зеленела бы, ничего не проверив.
    const result = await sh(
      'npm config get registry',
      env(artifact, { named: { PATH: trap.PATH } }).named,
    );

    expect(result.code).toBe(0);
    expect(trap.calls()).toHaveLength(1);
    // И журнал видит ровно то, из-за чего npm ворчит: имя стора у него в
    // окружении. Пока оно там, любой наш вызов npm пачкает вывод обвеса.
    expect(trap.calls()[0]).toContain('npm config get registry');
    expect(trap.calls()[0]).not.toContain('store-dir=нет');
  });
});

describe('одноразовая настройка тома тоже идёт без имени стора', () => {
  it('УСТАНОВКА АССИСТЕНТА: npm позвали — и имени, которого он не знает, не показали', async () => {
    const artifact = await materialize({ installAssistant: true });
    const step = assistantStep(artifact);
    const trap = npmTrap();

    const result = await sh(
      step,
      env(artifact, { named: { PATH: trap.PATH } }).named,
    );

    // Предмет здесь ДРУГОЙ, чем у проверки реестра: там утверждается, что npm не
    // зовут вовсе, тут — что зовут нарочно (глобальный пакет ставит именно он) и
    // при этом не показывают ему `store-dir`. Что ловушка видит имя, когда оно
    // есть, доказано негативным контролем выше.
    expect(result.code, result.err).toBe(0);
    expect(trap.calls()).toHaveLength(1);
    expect(trap.calls()[0]).toContain(
      'install -g @anthropic-ai/claude-code@latest',
    );
    expect(trap.calls()[0]).toContain('store-dir=нет');

    // Имя снято у КОМАНДЫ, а не у контейнера: установке зависимостей оно нужно, и
    // приезжает она за ним в `containerEnv`. Починка шума, забравшая адрес стора,
    // вернула бы `tasker:BASER2-111`.
    expect(artifact.containerEnv.NPM_CONFIG_STORE_DIR).toBeTruthy();
  });
});

describe('прогон постсоздания молчит целиком', () => {
  it('с переменными ИЗ АРТЕФАКТА шаг проходит и не печатает ни строки', async () => {
    const artifact = await materialize();
    const step = checkStep(artifact);

    const { result, seen } = await withRegistry(async ({ port, seen }) => ({
      result: await sh(step, env(artifact, { npmrc: credentials(port) }).named),
      seen,
    }));

    // Ровно то, что видит потребитель на пересоздании: тишина и проход дальше.
    // Шаг, печатающий в норме, приучает не читать вывод — и предупреждение,
    // приехавшее следом, тоже не прочтут.
    expect(result.code, result.err).toBe(0);
    expect(result.out).toBe('');
    expect(result.err).toBe('');
    // И проверка была настоящей: реестр действительно спрашивали.
    expect(seen).toEqual(['GET /-/whoami']);
  });

  it('СТОР ДОЖИВАЕТ ДО УСТАНОВКИ: снятое у проверки не снято у неё', async () => {
    const artifact = await materialize();
    const step = checkStep(artifact);
    const { named, store } = env(artifact, { npmrc: '' });

    // Имя снимается у ОДНОЙ команды, а не у шелла: за проверкой в том же
    // постсоздании идёт установка, и ей адрес стора нужен. Проверяется это тем
    // же вопросом, на который потребитель получил неверный ответ, — куда
    // указывает `pnpm store path` ПОСЛЕ шага проверки.
    const result = await sh(`{ ${step}; }; pnpm store path`, named);

    expect(
      result.out.trim().startsWith(store),
      `стор лёг мимо тома: ${result.out.trim()}`,
    ).toBe(true);
  });
});
