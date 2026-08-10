/**
 * ЦЕПОЧКА РАЗВОРАЧИВАНИЯ ОБЪЯВЛЕНА ШАГАМИ: У ЗВЕНА ЕСТЬ ИМЯ, И ОТКАЗ ЕГО НАЗЫВАЕТ.
 *
 * `tasker:BASER2-291`, требование мира — `kb:WORLD-50`. Порядок разворачивания у нас
 * был реален и значим, но НЕ ОБЪЯВЛЕН: около четырёх килобайт шелла одной строкой,
 * шаги склеены `&&`. Отказы при этом человеческие — каждый называет, куда идти, — но
 * безымянные: снаружи нельзя было сказать «встало на проверке доступа к складу»,
 * можно было только прочитать текст и угадать.
 *
 * Безымянный шаг называет ПРИЧИНУ, но не МЕСТО (`kb:WORLD-31`), а без места нельзя
 * ни повторить, ни сравнить два прогона, ни сказать «у соседа встало на том же
 * шаге» (`kb:WORLD-38`).
 *
 * ── ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ ИСПОЛНЕНИЕМ, А ЧТО ЧТЕНИЕМ ────────────────────────
 *
 * «В артефакте есть слово „шаг“» — утверждение про текст, и оно ничего не стоит.
 * Предмет здесь поведенческий, поэтому цепочка **исполняется настоящим шеллом**:
 * прогон обязан назвать пройденные шаги, встать на сломанном и назвать именно его,
 * отдав наружу ЕГО код выхода. Чтением проверяется только состав цепочки — то, что
 * шаг без предмета в ней не существует, а нумерация считается по факту.
 *
 * Окружение СОБИРАЕТСЯ (`env.mjs`), а не наследуется: цепочка изображает создание
 * контейнера, и наследовать ей от прогона нечего.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerEnv } from './env.mjs';
import { MANAGER_PROBE_MS } from './limits.mjs';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  steps,
  tuning,
} from './packed.mjs';

const SCOPE = '@omnifield';

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const box of boxes) rmSync(box, { force: true, recursive: true });
  boxes = [];
});

async function materialize({ presets = [], settings } = {}) {
  consumer = installConsumer({
    repoName: 'weber',
    config: consumerConfig(),
    tuning: tuning({ presets, settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  expect(result.status, JSON.stringify(result.problems)).toBe('applied');
  return parseJsonc(consumer.read(LIVE));
}

/**
 * Цепочка, исполненная так, как её исполнит контейнер: `/bin/sh -c`, свой каталог,
 * собранное окружение. Возвращается КОД и вывод — оба предмет проверки.
 */
function chain(command, { cwd = consumer.root, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: containerEnv(env),
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
 * ЖУРНАЛ ПРОГОНА — то, по чему два прогона и сравниваются.
 *
 * Читается из ВЫВОДА, а не из артефакта: артефакт говорит, какие шаги объявлены, а
 * журнал — какие пройдены. Разница между этими двумя списками и есть «где встало».
 */
function journal(output) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('[devbox] шаг '))
    .map((line) => line.slice('[devbox] шаг '.length));
}

/** Строка отказа цепочки, если она была. */
function stopped(output) {
  return (
    output
      .split('\n')
      .find((line) => line.startsWith('[devbox] ОТКАЗ на шаге ')) ?? null
  );
}

/**
 * Клетка вокруг npm-конфига — та же, что в `registry.spec.mjs`, и по той же
 * причине: проба, доводящая менеджер до отказа, обязана быть герметичной, иначе
 * она правит npmrc машины прогона. Пришпилен и префикс: путь глобального конфига
 * npm выводится из него, и клетка не на том месте держать не будет.
 */
function caged(content = '') {
  const path = join(consumer.root, 'npmrc');
  writeFileSync(path, content);
  const prefix = join(consumer.root, 'npm-prefix');
  mkdirSync(prefix, { recursive: true });
  return { NPM_CONFIG_USERCONFIG: path, NPM_CONFIG_PREFIX: prefix };
}

/** Локация без манифеста ноды: цепочка проходима целиком и не стоит минут. */
function withoutNodeManifest() {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-steps-'));
  boxes.push(box);
  writeFileSync(join(box, 'go.mod'), 'module example.com/x\n');
  return box;
}

describe('ЦЕПОЧКА ОБЪЯВЛЕНА ШАГАМИ, а не склеена `&&`', () => {
  it('полный профиль: каждый шаг НАЗВАН и стоит в объявленном порядке', async () => {
    const artifact = await materialize({
      presets: ['omnifield'],
      settings: { npmScope: SCOPE },
    });

    // Порядок здесь несущий, и он теперь читается ИМЕНАМИ, а не угадывается по
    // кускам тела: потери тулчейна первыми (постсоздание кончается установкой),
    // права на тома до проверки реестра (креды лежат в томе), проверка до
    // установки (иначе она рассказывает про уже случившийся отказ).
    expect(steps(artifact.postCreateCommand).map((step) => step.id)).toEqual([
      'toolchain',
      'volumes',
      'assistant',
      'registry',
      'install',
    ]);
    // Заголовок — человеческая половина имени, и она та же, что в комментарии над
    // шагом: комментарий считается из ТОГО ЖЕ объявления, второго списка нет.
    const titles = steps(artifact.postCreateCommand).map((step) => step.title);
    expect(titles).toContain('проверка доступа к реестру');
    expect(consumer.read(LIVE)).toContain(titles.join(', '));
  });

  it('ШАГА БЕЗ ПРЕДМЕТА В ЦЕПОЧКЕ НЕТ, и нумерация считается по факту', async () => {
    // Без пресета и без scope: томов нет, ассистента нет, проверять нечего. Шаг,
    // у которого нет предмета, обязан не существовать, а не стоять пустым
    // (`tasker:BASER2-188`) — и нумерация обязана это отражать, иначе «шаг 4 из 5»
    // означал бы разное в двух локациях и сравнивать прогоны было бы нечем.
    const artifact = await materialize();

    const chainSteps = steps(artifact.postCreateCommand);
    expect(chainSteps.map((step) => step.id)).toEqual(['toolchain', 'install']);
    expect(chainSteps.map((step) => step.label)).toEqual([
      '1/2 toolchain — названные потери тулчейна',
      '2/2 install — установка зависимостей',
    ]);
  });

  it('onCreate — ТОЖЕ ЦЕПОЧКА, и его шаги названы так же', async () => {
    // Разворачивание идёт двумя точками в контейнере, и вторая отказывает не реже
    // первой: `npm install -g` уходит в реестр. Оставь её безымянной — «сравнить два
    // прогона по шагам» было бы верно ровно наполовину.
    const artifact = await materialize({ presets: ['omnifield'] });

    expect(steps(artifact.onCreateCommand).map((step) => step.id)).toEqual([
      'corepack',
      'tools',
    ]);
    // Инструментов нет — шага нет, ровно как в постсоздании.
    consumer.cleanup();
    consumer = null;
    const bare = await materialize();
    expect(steps(bare.onCreateCommand).map((step) => step.id)).toEqual([
      'corepack',
    ]);
  });
});

describe('ЖУРНАЛ ПРОГОНА: шаг за шагом, и по нему прогоны сравнимы', () => {
  it('пройденная цепочка называет КАЖДЫЙ свой шаг, по порядку', async () => {
    const artifact = await materialize();

    const result = await chain(artifact.postCreateCommand, {
      cwd: withoutNodeManifest(),
    });

    expect(result.code, result.err).toBe(0);
    // Объявлено и пройдено — один и тот же список: цепочка дошла до конца.
    expect(journal(result.err)).toEqual(
      steps(artifact.postCreateCommand).map((step) => step.label),
    );
    // И это НЕ вместо старых слов: локация без манифеста по-прежнему слышит, что
    // ставить нечего, — имя шага добавлено К тексту, а не вместо него.
    expect(result.err).toContain('ставить нечего');
    expect(stopped(result.err)).toBe(null);
  });

  it(
    'ДВА ПРОГОНА СРАВНИМЫ: видно, где прошли одинаково и где разошлись',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      // Прогон первый — локация с приватным scope и ненастроенным реестром.
      const broken = await materialize({ settings: { npmScope: SCOPE } });
      const failed = await chain(broken.postCreateCommand, {
        env: caged(),
      });
      const there = journal(failed.err);
      consumer.cleanup();
      consumer = null;

      // Прогон второй — та же локация без приватного scope: цепочка проходит.
      const fine = await materialize();
      const passed = await chain(fine.postCreateCommand, {
        cwd: withoutNodeManifest(),
      });
      const here = journal(passed.err);

      // Вот оно, сравнение по шагам: первый шаг у обоих один и тот же, дальше
      // прогоны расходятся — и видно это списком имён, а не чтением четырёх
      // килобайт вывода.
      expect(there[0]).toContain('toolchain — названные потери тулчейна');
      expect(here[0]).toContain('toolchain — названные потери тулчейна');
      expect(there.at(-1)).toContain('registry — проверка доступа к реестру');
      expect(here.at(-1)).toContain('install — установка зависимостей');
      expect(failed.code).toBe(1);
      expect(passed.code).toBe(0);
    },
  );
});

describe('ОТКАЗ НАЗЫВАЕТ ШАГ, а не только беду', () => {
  it(
    'НЕДОСТУПНЫЙ РЕЕСТР: назван шаг registry — и текст отказа при нём цел',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      // Ровно приёмка задачи: прогон, вставший на недоступном реестре, называет ШАГ.
      const artifact = await materialize({ settings: { npmScope: SCOPE } });

      const result = await chain(artifact.postCreateCommand, { env: caged() });

      expect(result.code).toBe(1);
      expect(stopped(result.err)).toBe(
        '[devbox] ОТКАЗ на шаге 2/3 registry — проверка доступа к реестру (код 1)',
      );
      // Ни одно сегодняшнее слово не потеряно: имя добавлено К отказу. Проверяются
      // все три вещи, которые он обещает, — причина, путаница и куда идти.
      expect(result.err).toContain(
        'тянутся из приватного реестра, а он не настроен',
      );
      expect(result.err).toContain('404, пакета нет');
      expect(result.err).toContain(`npm config set ${SCOPE}:registry`);
      // И установка дальше не пошла: цепочка встала, а не доложила и поехала.
      expect(journal(result.err).some((step) => step.includes('install'))).toBe(
        false,
      );
    },
  );

  it('СЛОМАН ДРУГОЙ ШАГ — назван другой шаг, и код выхода ЕГО', async () => {
    // Имя в отказе не прибито к одному месту: ломается установка — называется
    // установка. Код 7 выбран не круглым намеренно: подмени `devbox_stop` код своей
    // единицей, и проба покраснеет именно на этом.
    const artifact = await materialize({ settings: { installCommand: 'exit 7' } });

    const result = await chain(artifact.postCreateCommand, {
      cwd: withoutNodeManifest(),
    });

    expect(result.code).toBe(7);
    expect(stopped(result.err)).toBe(
      '[devbox] ОТКАЗ на шаге 2/2 install — установка зависимостей (код 7)',
    );
  });

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: цепочка БЕЗ имён называет беду и молчит про место', async () => {
    // Вчерашняя форма, собранная ИЗ САМОГО АРТЕФАКТА, а не написанная здесь
    // константой: шаги те же, склейка та же `&&`, обёртки нет. Она обязана
    // отказать так же — и не сказать, где именно. Пропади имена из шаблона, этот
    // контроль позеленеет вместе с соседом сверху и скажет об этом вслух.
    const artifact = await materialize({ settings: { installCommand: 'exit 7' } });
    const yesterday = steps(artifact.postCreateCommand)
      .map((step) => step.run)
      .join(' && ');

    const result = await chain(yesterday, { cwd: withoutNodeManifest() });

    expect(result.code).toBe(7);
    expect(journal(result.err)).toEqual([]);
    expect(stopped(result.err)).toBe(null);
  });
});

describe('обёртка добавляет ИМЯ и больше ничего', () => {
  it('тело шага доезжает в артефакт слово в слово', async () => {
    const artifact = await materialize({
      presets: ['omnifield'],
      settings: { npmScope: SCOPE, installCommand: 'npm ci' },
    });

    const byId = Object.fromEntries(
      steps(artifact.postCreateCommand).map((step) => [step.id, step.run]),
    );

    // Каждая сегодняшняя формулировка лежит в теле НАЗВАННОГО шага, а не в обёртке
    // и не в соседе: имя шага и текст отказа — про одно и то же место. Разъедься
    // они, «встало на registry» указывало бы не туда, куда ведёт текст.
    expect(byId.toolchain).toContain('Девбокс НОДОВЫЙ');
    expect(byId.toolchain).toContain('Репозиторий объявляет go (go.mod)');
    expect(byId.registry).toContain('токен не положен или протух');
    expect(byId.registry).toContain('404, пакета нет');
    expect(byId.assistant).toContain('$CLAUDE_CONFIG_DIR');
    expect(byId.volumes).toBe('sudo chown -R node:node /home/node/.secrets /home/node/.pnpm-store');
    // Чужая команда едет КАК НАПИСАНА: обёртка её не оборачивает гардом и не
    // дописывает в неё ни символа.
    expect(byId.install).toBe('npm ci');
  });
});
