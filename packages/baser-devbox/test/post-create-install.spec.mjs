/**
 * ПОСТСОЗДАНИЕ НЕ ЗАДАЁТ ВОПРОСОВ — и это меряется ПРОГОНОМ, а не текстом шага.
 *
 * Находка первого чужого обвеса на живом (`tasker:BASER2-121`, `tasker:BASER2-125`):
 * `postCreateCommand` контейнера **молча провисел шесть часов**, ноль CPU, никакой
 * диагностики. Внутри — `pnpm install`, который увидел `node_modules`, собранный при
 * других настройках, и спросил разрешения снести его:
 *
 * ```
 * The modules directories will be removed and reinstalled from scratch. Proceed? (Y/n)
 * ```
 *
 * Отвечать в постсоздании некому. Со стороны это неотличимо от медленной установки
 * зависимостей — поэтому шесть часов, а не шесть минут.
 *
 * **Почему это наше.** Команду установки в постсоздание кладёт обвес, и первый вход в
 * девбокс — ровно тот случай, в котором вопрос поднимается: репозиторий ставился
 * снаружи, а контейнер направляет pnpm в ОБЩИЙ ТОМ СТОРА (`pnpmStoreVolume`, пресет
 * omnifield). Модули помнят один стор, установка идёт с другим — и pnpm спрашивает.
 * Тот же класс, что `tasker:BASER2-110`: там девбокс молчал о том, чего у него нет,
 * здесь — о том, чего он ждёт.
 *
 * ── ПОЧЕМУ ПРОБА ИСПОЛНЯЕТ, А НЕ ЧИТАЕТ ─────────────────────────────────────
 *
 * Проверить подстроку в дефолте — это утверждение ПРО ТЕКСТ, а находка была про
 * ПОВЕДЕНИЕ. Поэтому здесь воспроизводится неинтерактивная среда целиком:
 *
 * - репозиторий настоящий (pnpm-воркспейс, две группы пакетов, связь между ними),
 *   и его `node_modules` собран ЗАРАНЕЕ, с другим стором — «поставлен снаружи»;
 * - шаг берётся из АРТЕФАКТА, который положила дверь, а не переписывается в пробу;
 * - `stdin` — открытая пустая труба, как у `postCreateCommand`. Не `/dev/null`:
 *   на EOF вопрос отвечает сам собой и дефект ИСЧЕЗАЕТ, то есть проба на закрытом
 *   входе зеленела бы на сломанной команде.
 *
 * И к позитивной пробе приложен НЕГАТИВНЫЙ КОНТРОЛЬ: та же фикстура и тот же шаг без
 * флага обязаны повиснуть. Без него «вопросов не задаёт» доказывалось бы фикстурой, в
 * которой вопрос и не поднимался, — зелено и пусто.
 *
 * ── ФИКСТУРА НЕ НАСЛЕДУЕТ ПРОГОН ────────────────────────────────────────────
 *
 * Ровно это с контролем и случилось — в CI, при зелёном локальном verify. Фикстура
 * брала окружение прогона, вычищая из него `npm_config_*`; в GitHub Actions в
 * окружении лежит `CI=true`, а pnpm с ним подтверждений не спрашивает вовсе — вопрос
 * не поднялся, установка дошла до конца, контроль покраснел (PR #51). Он и обещал
 * покраснеть, если раскладка перестанет поднимать вопрос, — обещание сработало.
 *
 * Причина, однако, не в pnpm и не в CI: **фикстура, унаследовавшая чужое окружение,
 * перестаёт мерить то, ради чего заведена**. Постсоздание идёт в контейнере, и от
 * раннера ему наследовать нечего. Поэтому окружение здесь СОБИРАЕТСЯ по белому списку
 * (`env.mjs`), а контроль вдобавок гоняется ПОД ШУМОМ прогона, выставленным руками
 * (`withRunnerNoise`): вернись наследование — красное будет сразу и локально.
 * Зелёный локальный verify не равен зелёному CI, и цену этому мы уже заплатили.
 *
 * ── ПОД КАКИМ pnpm ЭТО ГОНЯЕТСЯ ─────────────────────────────────────────────
 *
 * Фикстура пинует `packageManager` этого репозитория, то есть ту же pnpm, под которой
 * идёт сама проба: версия менеджера — часть раскладки, а не фон машины.
 *
 * Форма отказа у версий разная, и обе — сломанное постсоздание: до 11-й pnpm ЖДЁТ
 * ответа вечно (это и есть шесть часов), с 11-й — отказывается вслух
 * (`ABORTED_REMOVE_MODULES_DIR_NO_TTY`) и зависимостей всё равно не ставит. Контроль
 * принимает обе и не принимает третью: если однажды та же раскладка вопроса не
 * поднимет вовсе, контроль позеленеет — и проба упадёт, потребовав пересмотра
 * фикстуры, а не тихо перестанет что-либо доказывать.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
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
import { soleRun } from '../../baser-cli/src/index.ts';
import { containerEnv } from './env.mjs';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  REPO_ROOT,
  run,
  tuning,
} from './packed.mjs';

/** Тот самый вопрос — текстом, которым его задаёт pnpm. */
const QUESTION = /will be removed and reinstalled from scratch/;

/** Отказ вместо вопроса: без TTY pnpm 11 не спрашивает, но и не ставит. */
const NO_TTY = /ABORTED_REMOVE_MODULES_DIR/;

/** Флаг, снимающий вопрос. Часть НАШЕГО дефолта, а не подмешивание в чужое. */
const FLAG = '--config.confirmModulesPurge=false';

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

/** Раскладывает обвес дверью и отдаёт разобранный артефакт вместе с ответом. */
async function materialize(settings) {
  consumer = installConsumer({
    repoName: 'weber',
    config: consumerConfig(),
    tuning: tuning({ settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  if (result.status !== 'applied') {
    throw new Error(`обвес не разложился: ${result.status}`);
  }
  return { result, json: parseJsonc(consumer.read(LIVE)) };
}

/**
 * Шаг установки — ЗНАЧЕНИЕМ НАСТРОЙКИ из ответа двери, а не нарезкой строки.
 *
 * Заодно проверяется инвариант зоны: постсоздание кончается установкой. Возьми проба
 * последний кусок сама — она доказывала бы собственную нарезку.
 */
function installStep({ result, json }) {
  const declared = soleRun(result).settings.find(
    (setting) => setting.key === 'installCommand',
  );
  expect(
    json.postCreateCommand.endsWith(` && ${declared.value}`),
    json.postCreateCommand,
  ).toBe(true);
  return declared.value;
}

/** pnpm, которым живёт ЭТОТ репозиторий: под ним идёт и проба, и её установка. */
function pinnedPnpm() {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'),
  );
  return manifest.packageManager;
}

/**
 * Шум прогона в окружении — НАРОЧНО, на время тела.
 *
 * Негативный контроль держится на том, что вопрос ПОДНИМЕТСЯ, и отменить его чужое
 * окружение может двумя разными способами — оба на нас уже сработали или могли:
 *
 * - `CI=true` — в GitHub Actions лежит в окружении всегда, и pnpm с ним подтверждений
 *   не спрашивает вовсе. Именно на этом контроль позеленел в CI при зелёном локальном
 *   verify (`tasker:BASER2-125`, PR #51 красным);
 * - `npm_config_store_dir` — унаследованный адрес стора БЬЁТ одноимённую UPPERCASE-
 *   переменную фикстуры (тот же приоритет, что в `registry.spec.mjs`), оба прогона
 *   уезжают в один стор, разъезда нет — и спрашивать не о чем.
 *
 * Поэтому контроль гоняется не «как повезёт с машиной», а под шумом, выставленным
 * руками: вернись фикстура к наследованию — он покраснеет СРАЗУ И ЛОКАЛЬНО, а не в
 * чужом CI через коммит. Шум пишется в `process.env` (фикстура читает оттуда) и
 * снимается в `finally`: соседние пробы файла живут в том же процессе.
 */
async function withRunnerNoise(body) {
  const store = mkdtempSync(join(tmpdir(), 'baser-devbox-runner-store-'));
  boxes.push(store);
  const noise = { CI: 'true', npm_config_store_dir: store };
  const before = new Map(
    Object.keys(noise).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, noise);
  try {
    return await body();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Репозиторий, чей `node_modules` СОБРАН НЕ ЗДЕСЬ.
 *
 * Две группы пакетов и связь между ними — раскладка настоящего монорепозитория:
 * вопрос pnpm задаёт во множественном числе, потому что каталогов модулей в
 * воркспейсе несколько.
 *
 * Зависимостей из реестра нет вовсе — установка герметична и не ходит в сеть.
 * Разъезд создаётся АДРЕСОМ СТОРА: снаружи один, у контейнера другой (общий том).
 */
function installedElsewhere() {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-postcreate-'));
  boxes.push(box);
  const root = join(box, 'weber');
  mkdirSync(join(root, 'packages', 'kit'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });

  const file = (path, value) =>
    writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
  file('package.json', {
    name: 'weber',
    private: true,
    packageManager: pinnedPnpm(),
    devDependencies: { kit: 'workspace:*' },
  });
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n  - apps/*\n',
  );
  file('packages/kit/package.json', { name: 'kit', version: '0.0.0' });
  file('apps/web/package.json', {
    name: 'web',
    version: '0.0.0',
    dependencies: { kit: 'workspace:*' },
  });

  const userconfig = join(box, 'npmrc');
  writeFileSync(userconfig, '');
  // Окружение СОБРАНО (`env.mjs`), а не унаследовано: контейнеру от раннера
  // наследовать нечего, и мерить проба обязана свою среду, а не машину прогона.
  const env = containerEnv({
    NPM_CONFIG_USERCONFIG: userconfig,
    NPM_CONFIG_STORE_DIR: join(box, 'store-host'),
  });

  // ДВА прогона, и это не суеверие: паспорт каталога модулей
  // (`node_modules/.modules.yaml`, в нём и записан адрес стора) pnpm кладёт не на
  // первом. Фикстура, установленная однажды, разъезда не заметила бы — сравнивать
  // ей было бы не с чем, и негативный контроль позеленел бы на пустом месте.
  execFileSync('pnpm', ['install'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('pnpm', ['install'], { cwd: root, env, stdio: 'pipe' });

  return {
    root,
    // Стор контейнера — общий том (`pnpmStoreVolume`), то есть НЕ тот, которым
    // собран `node_modules`. Ровно это pnpm и считает сменой настроек.
    env: { ...env, NPM_CONFIG_STORE_DIR: join(box, 'store-volume') },
  };
}

/**
 * Шаг постсоздания — так, как его запускает контейнер.
 *
 * `stdin` открыт и пуст, своя группа процессов (pnpm поднимает свой пин отдельным
 * процессом, и гасить надо группу целиком), а вопрос ловится по выводу: как только
 * он прозвучал, ждать нечего — отвечать здесь некому, ровно в этом и дефект.
 */
function postCreate(command, box) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: box.root,
      env: box.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    let output = '';
    let asked = false;
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const collect = (chunk) => {
      output += chunk;
      if (!asked && QUESTION.test(output)) {
        asked = true;
        kill();
      }
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (cause) => {
      output += String(cause);
    });
    // Дно: вопрос может и не прозвучать в вывод, а установка — не кончиться.
    const timer = setTimeout(kill, 90_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Хвост вывода доезжает после смерти процесса; писать в него больше некому.
      setTimeout(() => resolve({ completed: code === 0, asked, output }), 200);
    });
  });
}

describe('ПОСТСОЗДАНИЕ В НЕИНТЕРАКТИВНОЙ СРЕДЕ: установка доходит до конца', () => {
  it('дефолтная установка не задаёт вопросов и ставит зависимости', async () => {
    const artifact = await materialize();
    const step = installStep(artifact);
    const box = installedElsewhere();

    const attempt = await postCreate(step, box);

    expect(attempt.asked, attempt.output).toBe(false);
    expect(attempt.completed, attempt.output).toBe(true);
    // Модули пересобраны, а не «оставлены как были»: связь воркспейса на месте.
    expect(existsSync(join(box.root, 'node_modules', 'kit'))).toBe(true);
  }, 120_000);

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: без флага та же среда вешает постсоздание', async () => {
    const artifact = await materialize();
    const command = installStep(artifact);
    const yesterday = command.replace(` ${FLAG}`, '');
    expect(
      yesterday,
      'флага в дефолте нет — контролю нечего снимать, и он ничего не доказывает',
    ).not.toBe(command);

    // Под шумом прогона: контроль обязан держаться на СВОЕЙ среде. Наследующая
    // фикстура здесь и краснеет — той же ошибкой, что стоила нам красного CI.
    const attempt = await withRunnerNoise(() =>
      postCreate(yesterday, installedElsewhere()),
    );

    expect(attempt.completed, attempt.output).toBe(false);
    expect(
      attempt.asked || NO_TTY.test(attempt.output),
      `установка не дошла до конца, но и вопроса не задала:\n${attempt.output}`,
    ).toBe(true);
  }, 120_000);

  it('своя команда потребителя едет КАК НАПИСАНА — флаг не подмешивается', async () => {
    // Дефолт наш, команда — его: человек, написавший свою, получает ровно её.
    // Подмешать флаг значило бы решить за него, чем его команда является.
    const artifact = await materialize({ installCommand: 'npm ci' });

    expect(installStep(artifact)).toBe('npm ci');
    expect(artifact.json.postCreateCommand).not.toContain(
      'confirmModulesPurge',
    );
  }, 30_000);
});
