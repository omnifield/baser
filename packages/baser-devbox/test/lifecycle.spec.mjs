/**
 * ДВЕ ТОЧКИ ЖИЗНЕННОГО ЦИКЛА, КОТОРЫХ У ОБВЕСА НЕ БЫЛО: ДО СОЗДАНИЯ И ПОСЛЕ СТАРТА.
 *
 * `tasker:BASER2-81` и `tasker:BASER2-82`. Обе про одно и то же свойство шаблона —
 * он обязан выражать раскладку живого репозитория, — но события разные, и путать
 * их нельзя:
 *
 * | точка                | где выполняется | когда                              |
 * | -------------------- | --------------- | ---------------------------------- |
 * | `initializeCommand`  | НА ХОСТЕ        | до создания контейнера И на стартах |
 * | `onCreateCommand`    | в контейнере    | один раз на том воркспейса         |
 * | `postCreateCommand`  | в контейнере    | один раз при создании              |
 * | `postStartCommand`   | в контейнере    | при КАЖДОМ старте                  |
 *
 * Сверено со спекой девконтейнеров 2026-08-04
 * (containers.dev/implementors/json_reference): `initializeCommand` —
 * «run on the host machine during initialization, including during container creation
 * and on subsequent starts… may run more than once during a given session»;
 * `postStartCommand` — «each time the container is successfully started».
 *
 * ── ПОЧЕМУ СЕТЬ ПРОВЕРЯЕТСЯ ИСПОЛНЕНИЕМ ─────────────────────────────────────
 *
 * «В артефакте есть строка про создание сети» — утверждение про текст. Находка же
 * была про поведение: **первый девбокс на чистой машине не встаёт**, потому что
 * войти в несуществующую сеть докер не даёт. Значит и проверять надо поведение
 * строки: она обязана СОЗДАВАТЬ сеть, когда её нет, и МОЛЧА проходить, когда она
 * уже есть, — иначе каждый второй старт кончался бы ошибкой инициализации.
 *
 * Докер здесь подставной: настоящий в пробе недоступен и не нужен — предмет
 * проверки не докер, а наша строка вокруг него. Подставной ещё и записывает, с чем
 * его позвали, поэтому «сеть создаётся» тоже факт, а не вера в подстроку.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerEnv } from './env.mjs';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  tuning,
} from './packed.mjs';

let consumer = null;
let host = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  if (host !== null) {
    rmSync(host, { force: true, recursive: true });
    host = null;
  }
});

async function materialize({ presets = [], settings } = {}) {
  consumer = installConsumer({
    repoName: 'tasker',
    config: consumerConfig(),
    tuning: tuning({ presets, settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  const text = consumer.read(LIVE);
  return { result, text, json: text === null ? null : parseJsonc(text) };
}

/**
 * ХОСТ, НА КОТОРОМ ЕСТЬ ДОКЕР И БОЛЬШЕ НИЧЕГО.
 *
 * Подставной `docker` пишет свой вызов в журнал и ведёт себя как настоящий в двух
 * состояниях: сети нет — создаёт и печатает её имя; сеть есть — отвечает отказом в
 * stderr и кодом 1, ровно как `docker network create` на существующей сети.
 * Состояние живёт файлом, поэтому идемпотентность проверяется повторным запуском, а
 * не отдельной веткой в пробе.
 */
function fakeHost() {
  host = mkdtempSync(join(tmpdir(), 'baser-devbox-host-'));
  const bin = join(host, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/bin/sh',
      `echo "$@" >> "${join(host, 'calls.log')}"`,
      `net="${join(host, 'networks')}"`,
      'mkdir -p "$net"',
      'if [ "$1" = "network" ] && [ "$2" = "create" ]; then',
      '  if [ -f "$net/$3" ]; then',
      '    echo "Error response from daemon: network with name $3 already exists" >&2',
      '    exit 1',
      '  fi',
      '  : > "$net/$3"',
      '  echo "$3"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return {
    /** Выполняет строку так, как её выполнит хост: `/bin/sh -c`, свой PATH. */
    sh(command, { docker = true } = {}) {
      const out = execFileSync('/bin/sh', ['-c', `${command}; echo "код:$?"`], {
        env: containerEnv({ PATH: docker ? bin : '/nonexistent' }),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return out;
    },
    calls() {
      try {
        return readFileSync(join(host, 'calls.log'), 'utf-8').trim().split('\n');
      } catch {
        return [];
      }
    },
  };
}

describe('СЕТЬ: девбокс обеспечивает, что она есть, а не надеется на неё', () => {
  it('сеть задана — точка на хосте появилась; не задана — её нет вовсе', async () => {
    const withNetwork = await materialize({ presets: ['omnifield'] });
    expect(withNetwork.json.initializeCommand).toBe(
      'docker network create omnifield-gateway 2>/dev/null || true',
    );
    consumer.cleanup();
    consumer = null;

    // Без сети точке неоткуда взяться: обвес не заводит хостовых команд «на всякий
    // случай». Внешний потребитель получает девбокс без единой строки, выполняемой
    // на его машине.
    const bare = await materialize();
    expect(bare.json.initializeCommand).toBeUndefined();
    expect(bare.text).not.toContain('initializeCommand');
  });

  it('ЧИСТАЯ МАШИНА: сети нет — строка её СОЗДАЁТ (исполнено)', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });
    const machine = fakeHost();

    const out = machine.sh(json.initializeCommand);

    expect(out).toContain('код:0');
    // Вот он, тот самый день: человек клонировал репозиторий на новом компьютере, и
    // сеть создавать некому. Проверяется не подстрока в артефакте, а факт вызова.
    expect(machine.calls()).toEqual(['network create omnifield-gateway']);
  });

  it('СЕТЬ УЖЕ ЕСТЬ: второй запуск молчит и не роняет инициализацию', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });
    const machine = fakeHost();

    machine.sh(json.initializeCommand);
    const second = machine.sh(json.initializeCommand);

    // Идемпотентность — не украшение: по спеке точка выполняется и на последующих
    // стартах, то есть отказ «сеть уже есть» приезжал бы при каждом втором подъёме
    // девбокса. Отказ гасится целиком: ни кода, ни строки в выводе.
    expect(second).toBe('код:0\n');
    expect(machine.calls()).toHaveLength(2);
  });

  it('ДОКЕРА НА ХОСТЕ НЕТ: точка молчит — и это НАЗВАННАЯ граница, а не недосмотр', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });
    const machine = fakeHost();

    const out = machine.sh(json.initializeCommand, { docker: false });

    // Строка обещает «сеть есть», а не «диагностика, если докера нет»: без докера
    // девбокс не поднимется в принципе, и об этом скажет сам инструмент
    // девконтейнеров — своим текстом и в свой момент. Наш `|| true` тут ничего не
    // прячет: прятать нечего.
    expect(out).toBe('код:0\n');
    expect(machine.calls()).toEqual([]);
  });

  it('имя сети едет в команду на ХОСТЕ — значит проверяется', async () => {
    const { result, text } = await materialize({
      settings: { network: 'gateway; touch /tmp/pwned' },
    });

    expect(text).toBe(null);
    expect(result.problems.map((problem) => problem.code)).toContain(
      'render-failed',
    );
    const message = result.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('не годится в имя сети docker');
    expect(message).toContain('НА ХОСТЕ');
  });

  it('сеть — слой ПРЕСЕТА, и точка снимается вместе с ним', async () => {
    const preset = await materialize({ presets: ['omnifield'] });
    expect(preset.json.initializeCommand).toBeDefined();
    consumer.cleanup();
    consumer = null;

    // Универсальное обязано пережить снятие пресета, а пресетное — уйти с ним.
    // Точка на хосте пресетная: она есть ровно там, где есть сеть.
    const without = await materialize();
    expect(without.json.initializeCommand).toBeUndefined();
    expect(without.json.runArgs).not.toContain('--network=omnifield-gateway');
  });
});

/**
 * ПРОЦЕССЫ ЛОКАЦИИ: КАРТА ИМЁН ВМЕСТО ОДНОЙ СТРОКИ (`tasker:BASER2-196`,
 * решение `kb:BASER3-32`).
 *
 * Точка «после старта» была, а механика подъёма оставалась за репозиторием —
 * и четыре продукта носили в себе по копии одного и того же раннера. Теперь
 * локация объявляет свои процессы НАСТРОЙКОЙ, а раннер из репозитория уходит.
 *
 * Проверяется здесь форма и её края; что объектная форма делает С ПРОЦЕССАМИ
 * (параллельно, без порядка и без проб готовности) — свойство ИНСТРУМЕНТА
 * девконтейнеров, и меряется оно живым подъёмом, а не пробой: докера в прогоне
 * проб нет и быть не должно. Сценарий подъёма — `test/live/README.md`.
 */
describe('ПОСЛЕ СТАРТА: локация объявляет свои ПРОЦЕССЫ, а не одну строку', () => {
  /**
   * Карта таскера — выведенная из ЕГО файлов, а не сочинённая примером.
   *
   * `publish` — то, что делает его `scripts/devbox-publish.mjs`: копия
   * манифеста в общий том реестра. `backend` и `frontend` — две записи его
   * `devbox.services.json` слово в слово (снимки — `test/live/`).
   */
  const PROCESSES = {
    publish: 'cp omnifield.yaml /omnifield-registry/tasker.yaml',
    backend:
      'env TASKER_PORT=8030 TASKER_DB=/data/tasker/tasker.db go run ./cmd/tasker',
    frontend: 'pnpm -C web dev',
  };

  it('карта раскладывается в ОБЪЕКТНУЮ форму — ту, что спека завела ради параллельного запуска', async () => {
    const { json } = await materialize({ settings: { startCommand: PROCESSES } });

    // Именно объект, а не строка и не список: строка ушла бы в один шелл
    // последовательно, список — в exec без шелла. Параллельный запуск спека
    // даёт только объектной формой.
    expect(json.postStartCommand).toEqual(PROCESSES);
    expect(typeof json.postStartCommand).toBe('object');
    expect(Array.isArray(json.postStartCommand)).toBe(false);
  });

  it('РАННЕРА В РЕПОЗИТОРИИ БОЛЬШЕ НЕТ: ни одна команда не зовёт скрипт локации', async () => {
    const { json } = await materialize({ settings: { startCommand: PROCESSES } });

    // Ради этого всё и затевалось (`kb:BASER3-32`): раньше на точке висела пара
    // СВОИХ скриптов продукта, и их копии у четырёх продуктов уже разъехались.
    // Проверяется не «команд три», а то, что ни одна из них не уходит в
    // `scripts/` репозитория.
    for (const command of Object.values(json.postStartCommand)) {
      expect(command, `команда всё ещё зовёт скрипт локации: ${command}`).not.toContain(
        'scripts/',
      );
    }
  });

  it('УРОВНИ НЕ ПУТАЮТСЯ: startCommand не трогает постсоздание, installCommand — старт', async () => {
    const { json } = await materialize({
      settings: {
        startCommand: PROCESSES,
        installCommand: 'pnpm install --frozen-lockfile',
      },
    });

    // `installCommand` — последний шаг ПОСТСОЗДАНИЯ, один раз на жизнь контейнера.
    // `startCommand` — при каждом подъёме. Обещать одно другим нельзя, поэтому
    // проверяется и то, что каждая осталась в своей точке.
    expect(json.postCreateCommand.endsWith('pnpm install --frozen-lockfile')).toBe(
      true,
    );
    expect(json.postCreateCommand).not.toContain('go run');
    expect(json.postStartCommand).toEqual(PROCESSES);
  });

  it('не задана — ключа нет вовсе, а не пустой объект', async () => {
    const { json, text } = await materialize();

    expect(json.postStartCommand).toBeUndefined();
    expect(text).not.toContain('postStartCommand');
    // Артефакт остаётся валидным JSON: хвостовая запятая — самая дешёвая поломка,
    // которую можно внести условным блоком в конце файла.
    expect(json.postCreateCommand).toBeDefined();
  });

  it('ПУСТАЯ КАРТА — «процессов нет», сказанное значением: ключа нет, артефакт цел', async () => {
    const { json, text } = await materialize({ settings: { startCommand: {} } });

    // Те же два состояния пустоты, что у фич и томов (`kb:BASER3-7`): `null` —
    // «не задано», `{}` — «задано и пусто». В артефакте они совпадают, и это не
    // небрежность: пустой объект в `postStartCommand` инструмент считает
    // отсутствием команды (число ключей), то есть ключ был бы шумом.
    expect(json.postStartCommand).toBeUndefined();
    expect(text).not.toContain('postStartCommand');
    expect(json.postCreateCommand).toBeDefined();
  });

  it('в пресет omnifield НЕ уехала: что запускать на старте — дело репозитория', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });

    // Пресет — ходовое положение регулировок раскладки, а подъём сервисов это
    // свойство КОНКРЕТНОГО продукта: у tasker и knowledger он есть, у baser и
    // weber его нет и быть не должно.
    expect(json.postStartCommand).toBeUndefined();
  });

  it('свои команды — своя неинтерактивность: обвес в них не дописывает ничего', async () => {
    const { json } = await materialize({
      settings: { startCommand: { привет: 'echo привет' } },
    });

    expect(json.postStartCommand).toEqual({ привет: 'echo привет' });
  });

  it('ИМЯ С ПРОБЕЛОМ едет как есть: это ярлык вывода, а не идентификатор', async () => {
    const { json } = await materialize({
      settings: { startCommand: { 'подъём базы': 'echo up' } },
    });

    // Отказ здесь был бы ВЫДУМАННЫМ правилом. Имя попадает ровно в одно место —
    // строку инструмента `Running <имя> of postStartCommand…`
    // (`devcontainers/cli`, `src/spec-common/injectHeadless.ts`, сверено
    // 2026-08-06); шелл его не видит, докер не видит, годность в идентификатор
    // никем не требуется. Запрещать то, что работает, значит заводить правило,
    // которое нечем объяснить читателю конфига.
    expect(json.postStartCommand).toEqual({ 'подъём базы': 'echo up' });
  });

  it('ПУСТАЯ КОМАНДА — названный отказ: имя объявлено, а запускать нечего', async () => {
    const { result, text } = await materialize({
      settings: { startCommand: { backend: '   ' } },
    });

    // Тот же класс, что шаг без предмета в постсоздании (`tasker:BASER2-188`):
    // объявленное имя обещает процесс, которого нет. Промолчи обвес — в
    // артефакте оказался бы ключ, запускающий пустой шелл, а локация считала бы
    // свой процесс объявленным.
    expect(text).toBe(null);
    expect(result.problems.map((problem) => problem.code)).toContain(
      'render-failed',
    );
    const message = result.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('команда backend');
    expect(message).toContain('команда пустая');
  });

  it('ПУСТОЕ ИМЯ — названный отказ: ярлык, который ничего не называет', async () => {
    const { result, text } = await materialize({
      settings: { startCommand: { ' ': 'echo up' } },
    });

    expect(text).toBe(null);
    const message = result.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('пустое имя команды');
  });

  it('СТРОКОЙ БОЛЬШЕ НЕ ЗАПОЛНЯЕТСЯ — и это сказано отказом, а не молчанием', async () => {
    const { result, text } = await materialize({
      settings: {
        startCommand:
          'node scripts/devbox-publish.mjs; node scripts/devbox-services.mjs up',
      },
    });

    // Ломающее изменение (`tasker:BASER2-196`), и оно обязано быть НАЗВАННЫМ:
    // ровно два живых репозитория держали здесь эту строку. Молчаливое принятие
    // строки было бы хуже отказа — она уехала бы в артефакт формой, которой
    // инструмент запускает всё в одном шелле последовательно, то есть тихо
    // вернула бы то, от чего решение уходит.
    expect(text).toBe(null);
    expect(result.problems.map((problem) => problem.code)).toContain(
      'value-type-mismatch',
    );
    // Отказ обязан назвать ТРИ вещи: какой файл править, какую настройку и чем
    // она стала. Адрес живёт отдельным полем — человеку нужен файл, а не только
    // текст, — поэтому проверяются оба конца.
    const problem = result.problems.find(
      (item) => item.code === 'value-type-mismatch',
    );
    expect(problem.at).toContain('settings.startCommand');
    expect(problem.at).toContain('omnifield-devbox.yaml');
    expect(problem.message).toContain('map «ключ → string»');
    expect(problem.message).toContain('заполнено string');
  });
});
