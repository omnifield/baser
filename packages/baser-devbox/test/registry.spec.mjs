/**
 * ПРОВЕРКА ДОСТУПА К ПРИВАТНОМУ РЕЕСТРУ — исполняется, а не читается глазами.
 *
 * Дыра, найденная на weber: старый девбокс перед установкой проверял токен и говорил
 * человеку, куда идти за кредами; наш обвес — нет. У репозитория с приватными
 * `@omnifield/*` npm уходит в npmjs.org и отвечает «404, пакета нет» — и человек идёт
 * искать несуществующий пакет вместо своих кредов. Стена без указателя.
 *
 * Это тот же класс, что «обещание в тексте отказа — контракт» (`baser-cli`,
 * `acceptance.spec.ts`): непроверенное обещание тихо протухает, и человек идёт по нему
 * в тупик. Поэтому здесь проверяется НЕ текст сообщения, а:
 *
 * 1. что проверка ловит оба состояния — реестр не настроен · доступа к нему нет;
 * 2. что при рабочем доступе она молчит и пропускает установку;
 * 3. **что путь восстановления, который она ОБЕЩАЕТ, работает** — команды берутся из
 *    самого сообщения, исполняются как есть, и после них стена исчезает.
 *
 * Шелл берётся из АРТЕФАКТА, который положила дверь, а не пишется в тесте заново:
 * проверка, гоняющая собственную копию шелла, доказывает только её.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../baser-cli/src/index.ts';
// Обвес здесь один — прогон под него берётся хелпером зоны `cli`, а не
// `runs[0]`: он бросает, если обвес не один (`tasker:BASER2-55`).
import { soleRun } from '../../baser-cli/src/lib/devbox.fixture.ts';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
} from './packed.mjs';

const SCOPE = '@omnifield';
const INSTALL = 'pnpm install --frozen-lockfile';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/**
 * Кладёт обвес с заданным `privateScope` и вырезает из артефакта ШАГ ПРОВЕРКИ.
 *
 * Профиль минимальный намеренно: без томов и ассистента шагов ровно два — проверка и
 * установка, — поэтому шаг отрезается по хвосту, а не выкусывается регуляркой. Заодно
 * это и есть доказательство порядка: проверка стоит ПЕРЕД установкой, иначе она
 * рассказывала бы про уже случившийся невнятный отказ.
 */
function checkStep(privateScope = SCOPE) {
  consumer = installConsumer({
    repoName: 'weber',
    config: consumerConfig({ settings: { privateScope } }),
  });
  return run({ command: 'apply', cwd: consumer.root }).then(() => {
    const post = parseJsonc(consumer.read(LIVE)).postCreateCommand;
    const tail = ` && ${INSTALL}`;
    expect(
      post.endsWith(tail),
      `постсоздание кончается не установкой: ${post}`,
    ).toBe(true);
    return post.slice(0, -tail.length);
  });
}

/**
 * Запуск шелла БЕЗ блокировки цикла событий.
 *
 * `execFileSync` здесь не годится и это не вкусовщина: стаб-реестр поднят в этом же
 * процессе, и синхронный запуск npm не дал бы ему принять соединение — проверка
 * «доступ есть» вечно падала бы по таймауту, доказывая несуществующий дефект.
 */
function sh(script, env) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', script], {
      env: { ...cleanEnv(), ...env },
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
 * Окружение БЕЗ следов npm, из-под которого запущены сами тесты.
 *
 * Прогон идёт через `npx`, а тот экспортирует `npm_config_*` — в том числе
 * `npm_config_prefix` и `npm_config_globalconfig`, указывающие на общий npmrc
 * машины. Они бьют одноимённые UPPERCASE-переменные, поэтому клетка из
 * `NPM_CONFIG_PREFIX` выглядела клеткой и не держала: мутация «`--location=user` →
 * `--location=global`» всё равно писала приватный реестр на машину.
 *
 * Чистка — не только защита. Постсоздание девбокса выполняется В КОНТЕЙНЕРЕ, а не
 * из-под npx: проверка, унаследовавшая чужой npm-контекст, меряла бы не то.
 */
function cleanEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_config/i.test(key)),
  );
}

/** Стаб приватного реестра: отвечает на то же, что спрашивает `npm whoami`. */
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

/**
 * Файл кредов, который проверка называет человеку, — и КЛЕТКА вокруг него.
 *
 * Пришпилен не только пользовательский конфиг, но и ПРЕФИКС npm, хотя проверка в
 * глобальный конфиг не пишет. Причина конкретная, найденная мутацией: тест ниже
 * исполняет команды, ВЗЯТЫЕ ИЗ СООБЩЕНИЯ, — а сообщение можно испортить. Стоило
 * подменить в шаблоне `--location=user` на `--location=global`, и тест записал
 * приватный реестр в общий npmrc машины, отравив все последующие прогоны.
 *
 * Пришпиливать пришлось именно префикс: `NPM_CONFIG_GLOBALCONFIG` оказался
 * недостаточен — путь глобального конфига npm выводит из `prefix`, и клетка,
 * поставленная не там, выглядела клеткой, но не держала. Проверено той же мутацией.
 *
 * Урок не про npm: проба, исполняющая то, что ей продиктовали, обязана быть
 * герметичной НЕЗАВИСИМО от продиктованного. Иначе она чинит одно и ломает машину.
 */
function npmrc(content = '') {
  const path = join(consumer.root, 'npmrc');
  writeFileSync(path, content);
  const prefix = join(consumer.root, 'npm-prefix');
  mkdirSync(prefix, { recursive: true });
  return {
    NPM_CONFIG_USERCONFIG: path,
    NPM_CONFIG_PREFIX: prefix,
    path,
    global: join(prefix, 'etc/npmrc'),
  };
}

describe('стена без указателя: проверка ловит оба состояния', () => {
  it('РЕЕСТР НЕ НАСТРОЕН — отказ до установки, с адресом и командами', async () => {
    const step = await checkStep();
    const env = npmrc();

    const result = await sh(step, env);

    // Отказ, а не предупреждение: установка дальше не идёт вовсе.
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      'тянутся из приватного реестра, а он не настроен',
    );
    // Названа ПРИЧИНА путаницы, а не только факт: иначе человек идёт искать пакет.
    expect(result.err).toContain('404, пакета нет');
    // И названо, КУДА идти — конкретным файлом, а не «настрой доступ».
    expect(result.err).toContain('~/.npmrc');
    expect(result.err).toContain(`npm config set ${SCOPE}:registry`);
    expect(result.err).toContain(':_authToken');
    // Без тома креды не переживут пересоздание контейнера — это сказано вслух, иначе
    // человек положит токен, пересоздаст девбокс и упрётся в ту же стену второй раз.
    expect(result.err).toContain('не переживёт пересоздание');
    expect(env.path.endsWith('npmrc')).toBe(true);
  });

  it('С ТОМОМ КРЕДОВ адрес другой — и это тот, который реально смонтирован', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig({
        presets: ['omnifield'],
        settings: { privateScope: SCOPE, installAssistant: false },
      }),
    });
    await run({ command: 'apply', cwd: consumer.root });
    const artifact = parseJsonc(consumer.read(LIVE));
    const post = artifact.postCreateCommand;
    const step = post.slice(
      post.indexOf('( reg='),
      post.indexOf(` && ${INSTALL}`),
    );

    const result = await sh(step, npmrc());

    expect(result.code).toBe(1);
    // Путь в сообщении = путь, на который смотрит npm внутри контейнера, = точка
    // монтирования тома. Разъедься они — человек положил бы токен мимо.
    expect(result.err).toContain('/home/node/.secrets/npmrc');
    expect(artifact.containerEnv.NPM_CONFIG_USERCONFIG).toBe(
      '/home/node/.secrets/npmrc',
    );
    expect(artifact.mounts).toContain(
      'source=omnifield-secrets,target=/home/node/.secrets,type=volume',
    );
    expect(result.err).toContain('переживает пересоздание');
  });

  it('РЕЕСТР ЕСТЬ, ДОСТУПА НЕТ — другой отказ, с адресом реестра и хостом', async () => {
    const step = await checkStep();
    // Порт, на котором заведомо никого нет: сетевого доступа проверке не нужно.
    const env = npmrc(`${SCOPE}:registry=http://127.0.0.1:1/\n`);

    const result = await sh(step, env);

    expect(result.code).toBe(1);
    expect(result.err).toContain('токен не положен или протух');
    // Два состояния — два разных сообщения: чинят их по-разному.
    expect(result.err).not.toContain('а он не настроен');
    expect(result.err).toContain('реестр: http://127.0.0.1:1/');
    // Хост вынут из адреса в самом шелле — команда для копипасты уже готовая.
    expect(result.err).toContain('npm config set //127.0.0.1:1/:_authToken');
  });

  it('ДОСТУП ЕСТЬ — проверка молчит и пропускает установку', async () => {
    const step = await checkStep();

    const { result, seen } = await withRegistry(async ({ port, seen }) => {
      const env = npmrc(
        `${SCOPE}:registry=http://127.0.0.1:${port}/\n` +
          `//127.0.0.1:${port}/:_authToken=tok\n`,
      );
      return { result: await sh(step, env), seen };
    });

    expect(result.code).toBe(0);
    // Молчит целиком: шаг, печатающий в норме, приучает не читать вывод.
    expect(result.out).toBe('');
    expect(result.err).toBe('');
    // И проверка была НАСТОЯЩЕЙ — реестр действительно спрашивали.
    expect(seen).toEqual(['GET /-/whoami']);
  });
});

describe('обещание в тексте отказа — контракт', () => {
  it('команды ИЗ САМОГО СООБЩЕНИЯ выполняются и снимают стену', async () => {
    const step = await checkStep();

    await withRegistry(async ({ port }) => {
      const env = npmrc();
      const blocked = await sh(step, env);
      expect(blocked.code).toBe(1);

      // Человек делает ровно то, что ему написали: берём команды из сообщения как
      // есть и подставляем свои значения на места угловых скобок.
      const commands = blocked.err
        .split('\n')
        .filter((line) => line.includes('npm config set'))
        .map((line) =>
          line
            .replace(/^\[devbox\]\s+/, '')
            .replace('<адрес-реестра>', `http://127.0.0.1:${port}/`)
            .replace('<хост-реестра>', `127.0.0.1:${port}`)
            .replace('<токен>', 'tok'),
        );
      expect(commands).toHaveLength(2);

      for (const command of commands) {
        expect((await sh(command, env)).code, command).toBe(0);
      }

      // Команды написали ровно в тот файл, который сообщение назвало, — и ни в
      // какой другой. Второе не придирка: адрес в сообщении обязан указывать на
      // конфиг, который девбокс потом и прочитает.
      const written = readFileSync(env.path, 'utf-8');
      expect(written).toContain(`${SCOPE}:registry=http://127.0.0.1:${port}/`);
      expect(written).toContain('_authToken=tok');
      expect(existsSync(env.global), 'креды уехали мимо названного файла').toBe(
        false,
      );

      // И стена исчезла — путь восстановления рабочий, а не правдоподобный.
      expect((await sh(step, env)).code).toBe(0);
    });
  });
});

describe('внешнему потребителю приватный реестр не нужен вообще', () => {
  it('scope не задан — в артефакте нет НИ СТРОКИ про реестр', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
    });
    await run({ command: 'apply', cwd: consumer.root });

    const text = consumer.read(LIVE);
    expect(text).not.toContain('npm whoami');
    expect(text).not.toContain('registry');
    expect(text).not.toContain('_authToken');
    // Постсоздание — ровно установка зависимостей, и ничего больше.
    expect(parseJsonc(text).postCreateCommand).toBe(INSTALL);
  });

  it('проверка НЕ в пресете omnifield: baser сам публикует @omnifield/*', async () => {
    // Пресет — ходовое положение регулировок для раскладки omnifield, а зависимость
    // от приватного реестра — свойство КОНКРЕТНОГО репозитория. baser свои
    // `@omnifield/*` производит и ставит воркспейс-ссылками; включи проверку
    // пресетом — и наш собственный девбокс падал бы на постсоздании, требуя кредов,
    // которые ему не нужны. Пресет, ломающий своего же потребителя, — не пресет.
    consumer = installConsumer({
      repoName: 'baser',
      config: consumerConfig({ presets: ['omnifield'] }),
    });
    const result = await run({ command: 'apply', cwd: consumer.root });

    const scope = soleRun(result).settings.find(
      (setting) => setting.key === 'privateScope',
    );
    expect(scope.value).toBe(null);
    expect(scope.origin.kind).toBe('default');
    expect(consumer.read(LIVE)).not.toContain('npm whoami');
  });
});

describe('проверка стоит ПЕРЕД установкой, а не после', () => {
  it('в полном профиле порядок: права на тома → креды → проверка → установка', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig({
        presets: ['omnifield'],
        settings: { privateScope: SCOPE },
      }),
    });
    await run({ command: 'apply', cwd: consumer.root });

    const post = parseJsonc(consumer.read(LIVE)).postCreateCommand;
    const chown = post.indexOf('sudo chown');
    const check = post.indexOf('npm whoami');
    const install = post.indexOf(INSTALL);

    // chown раньше проверки не для красоты: креды лежат в томе, права на который он
    // и выставляет, — проверка до него читала бы чужой по владельцу файл.
    expect(chown).toBeGreaterThanOrEqual(0);
    expect(chown).toBeLessThan(check);
    expect(check).toBeLessThan(install);
  });
});
