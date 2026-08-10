/**
 * ЛОКАЦИЯ ЗНАЕТ, ЧТО ПРИЕХАЛО: ФИКСАЦИЯ РЕДАКЦИЙ ИНСТРУМЕНТОВ.
 *
 * `tasker:BASER2-292`, требование мира — `kb:WORLD-50`. Экземпляр обязан знать, из
 * какой редакции он поднят, и достигается это двумя равно законными способами:
 * **заморожен номер** — ничего сверх, шаблон сам себе доказательство; **табличка**
 * (`latest`, канал) — фиксация ПО ФАКТУ, то есть что именно приехало, записано в
 * состояние локации при подъёме.
 *
 * Мы прошли половину пути и встали: версию требуем называть значением, а `latest`
 * принимаем — и наша собственная локация объявляет ассистента именно так. Два
 * разворачивания дают разное, и «то же место» от «другого» отличить нечем. Случай
 * записан в мировой канон нашим именем.
 *
 * ── ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ, А ЧТО ДОКАЗАТЬ НЕЛЬЗЯ ──────────────────────────
 *
 * «В артефакте есть шаг фиксации» — утверждение про текст, и оно ничего не стоит:
 * запись обязана быть ПРАВДОЙ, а правду проверяют исполнением. Поэтому пробы ставят
 * настоящий пакет настоящим `npm` из стаб-реестра (`tool-registry.mjs`), исполняют
 * шаги ИЗ АРТЕФАКТА и читают файл, который после этого лежит.
 *
 * Главная проба здесь — **«табличка поехала»**: тот же `latest` в объявлении, другой
 * номер в реестре, и запись обязана поменяться следом. Без неё «фиксация работает»
 * доказывалось бы совпадением: запись сошлась бы с прошлой сама собой, ничего не
 * измерив. Ровно эту ловушку приёмка задачи и называет.
 *
 * Окружение СОБИРАЕТСЯ (`env.mjs`) и сидит в клетке: `HOME` уводится в свою папку —
 * иначе запись легла бы в дом машины прогона, а не в дом изображаемого контейнера.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerEnv } from './env.mjs';
import { MANAGER_PROBE_MS } from './limits.mjs';
import {
  chainStep,
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  stepRun,
  steps,
  tuning,
} from './packed.mjs';
import { installEnv, packTool, withRegistry } from './tool-registry.mjs';

/** Инструмент локации: настоящий пакет с командой, как магазин или ассистент. */
const TOOL = '@omnifield/baser-registry';
const BIN = 'baser-registry';
const ASSISTANT = '@anthropic-ai/claude-code';

/** Имя файла фиксации — ОДНО место, где оно записано в пробах. */
const RECORD = '.devbox-editions.json';

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const path of boxes) rmSync(path, { force: true, recursive: true });
  boxes = [];
});

function box(prefix) {
  const path = mkdtempSync(join(tmpdir(), `baser-devbox-${prefix}-`));
  boxes.push(path);
  return path;
}

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

function sh(script, named) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', script], {
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
 * ПОДЪЁМ ЛОКАЦИИ, изображённый целиком: установка инструмента и фиксация следом.
 *
 * Исполняются оба шага ИЗ АРТЕФАКТА и в том порядке, в котором они в нём стоят, —
 * а не один вырезанный. Между «приехало» и «записано» не должно быть ничего, и
 * проверить это можно только прогнав их вместе.
 */
async function bootstrap(artifact, { version, home = box('home') } = {}) {
  const tarball = packTool({
    name: TOOL,
    version,
    bin: BIN,
    says: 'МАГАЗИН-НА-МЕСТЕ',
    box,
  });
  const prefix = box('npm-prefix');

  return withRegistry({ name: TOOL, version, bin: BIN, tarball }, async ({ base }) => {
    const env = { ...installEnv(base, prefix, box), HOME: home };
    const install = await sh(stepRun(artifact.onCreateCommand, 'tools'), env);
    expect(install.code, `${install.out}\n${install.err}`).toBe(0);

    const fix = await sh(stepRun(artifact.onCreateCommand, 'editions'), env);
    const path = join(home, RECORD);
    return {
      fix,
      home,
      path,
      record: existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf-8'))
        : null,
    };
  });
}

describe('фиксация — ЗВЕНО ЦЕПОЧКИ, и заводится она только под табличку', () => {
  it('объявлена ТАБЛИЧКА — шаг есть, и стоит он сразу за установкой', async () => {
    const artifact = await materialize({
      settings: { globalTools: { [TOOL]: 'latest' } },
    });

    // Порядок несущий: между «приехало» и «записано» не должно быть ничего, что
    // могло бы это изменить. Читается он именами шагов (`tasker:BASER2-291`).
    // Первым звеном идёт фиксация редакции УЧАСТКА (`tasker:BASER2-290`) — другой
    // ярус, другая запись, и на соседство «приехало → записано» она не влияет.
    expect(steps(artifact.onCreateCommand).map((step) => step.id)).toEqual([
      'plot',
      'corepack',
      'tools',
      'editions',
    ]);
  });

  it('объявлен ПОЛНЫЙ НОМЕР — шага нет вовсе: там шаблон сам себе доказательство', async () => {
    const artifact = await materialize({
      settings: { globalTools: { [TOOL]: '0.4.0' } },
    });

    // Мир просит фиксацию только там, где объявлена табличка. Заводить работу
    // там, где её не просят, — это шаг без предмета, а он обязан не существовать
    // (`tasker:BASER2-188`).
    expect(steps(artifact.onCreateCommand).map((step) => step.id)).toEqual([
      'plot',
      'corepack',
      'tools',
    ]);
    expect(artifact.onCreateCommand).not.toContain(RECORD);
  });

  it('ЧАСТИЧНЫЙ НОМЕР — тоже табличка: `1.2` не закрепляет ничего', async () => {
    // Ловушка, которую легко не заметить: `1.2` состоит из цифр и выглядит
    // заморозкой, а npm читает его как «последняя из 1.2.x». Признак заморозки —
    // ПОЛНЫЙ `X.Y.Z`, а не «начинается с цифры».
    const artifact = await materialize({
      settings: { globalTools: { [TOOL]: '1.2' } },
    });

    expect(steps(artifact.onCreateCommand).map((step) => step.id)).toContain(
      'editions',
    );
  });

  it('СМЕШАННЫЙ ПЕРЕЧЕНЬ: фиксируются только таблички, номер в запись не едет', async () => {
    const artifact = await materialize({
      settings: { globalTools: { [TOOL]: '0.4.0', [ASSISTANT]: 'latest' } },
    });

    const step = stepRun(artifact.onCreateCommand, 'editions');
    expect(step).toContain(ASSISTANT);
    // Замороженный номер в записи не нужен: он и так виден в объявлении, и
    // повторять его значило бы завести вторую правду о том же значении.
    expect(step).not.toContain(TOOL);
  });

  it('пресет omnifield ставит ассистента ТАБЛИЧКОЙ — значит фиксация в нём есть', async () => {
    // Наше собственное нарушение, названное в `kb:WORLD-50` нашим именем: пресет
    // объявляет ассистента `latest`. Проба стоит здесь, чтобы починка не уехала
    // мимо того самого случая, ради которого затевалась.
    const artifact = await materialize({ presets: ['omnifield'] });

    expect(steps(artifact.onCreateCommand).map((step) => step.id)).toContain(
      'editions',
    );
    expect(stepRun(artifact.onCreateCommand, 'editions')).toContain(ASSISTANT);
  });
});

describe('ЗАПИСЬ ПО ФАКТУ: что приехало, а не что объявлено', () => {
  it(
    'после подъёма редакция читается ИЗ ФАЙЛА, а не спрашивается у инструмента',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });

      const { fix, record } = await bootstrap(artifact, { version: '0.4.0' });

      expect(fix.code, `${fix.out}\n${fix.err}`).toBe(0);
      // Приёмка задачи: на вопрос «какая редакция здесь стоит» отвечает ЗАПИСЬ.
      // Объявлено при этом по-прежнему `latest` — фиксация это запись факта, а не
      // подмена объявления.
      expect(record).toEqual({
        globalTools: { [TOOL]: { declared: 'latest', version: '0.4.0' } },
      });
    },
  );

  it(
    'ТАБЛИЧКА ПОЕХАЛА: то же объявление, другой номер — запись идёт следом',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      // Ровно тот день, ради которого фиксация и заводится: объявление не
      // менялось, а `latest` в реестре стал другим. Без этой пробы «фиксация
      // работает» доказывалось бы совпадением — запись сошлась бы с прошлой сама
      // собой, ничего не измерив.
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });

      const first = await bootstrap(artifact, { version: '0.4.0' });
      const second = await bootstrap(artifact, { version: '0.5.0' });

      // Две записи СРАВНИМЫ: одинаковой формы, без шума вроде отметки времени, —
      // и расходятся ровно тем, чем разошлись прогоны.
      expect(Object.keys(first.record.globalTools)).toEqual(
        Object.keys(second.record.globalTools),
      );
      expect(first.record.globalTools[TOOL].declared).toBe(
        second.record.globalTools[TOOL].declared,
      );
      expect(first.record.globalTools[TOOL].version).toBe('0.4.0');
      expect(second.record.globalTools[TOOL].version).toBe('0.5.0');
    },
  );

  it(
    'ДВА ПОДЪЁМА БЕЗ ДВИЖЕНИЯ дают одинаковые записи — сравнивать можно побайтово',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      // Вторая половина сравнимости, и она про ШУМ: если бы запись несла отметку
      // времени, два одинаковых подъёма выглядели бы разными, и сравнение
      // пришлось бы учить отличать шум от расхождения.
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });

      const first = await bootstrap(artifact, { version: '0.4.0' });
      const second = await bootstrap(artifact, { version: '0.4.0' });

      expect(readFileSync(second.path, 'utf-8')).toBe(
        readFileSync(first.path, 'utf-8'),
      );
    },
  );

  it(
    'ЗАПИСЬ ЖИВЁТ ТАМ, ГДЕ ЖИВЁТ ТО, ЧТО ОНА ОПИСЫВАЕТ — в доме машины, не в репозитории',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });

      const { home } = await bootstrap(artifact, { version: '0.4.0' });

      // Состояние принадлежит своему пространству целиком (`kb:WORLD-28`):
      // инструменты лежат в файловой системе контейнера, значит и запись о них —
      // там же. Запись, пережившая то, что она описывает, — это ложь.
      expect(existsSync(join(home, RECORD))).toBe(true);
      // И ни строки в дереве потребителя: `.devcontainer/` принадлежит двери, а
      // вне его это был бы вечно грязный файл в ЧУЖОМ репозитории.
      expect(consumer.exists(RECORD)).toBe(false);
      expect(consumer.exists(join('.devcontainer', RECORD))).toBe(false);
    },
  );

  it(
    'ОБЪЯВЛЕН, А В МАШИНЕ НЕТ — названный отказ, а не запись с пустотой',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      // Запись, честно сообщающая, что не знает, чего стоит, не выполняет того,
      // ради чего заведена. Поэтому шаг фиксации исполняется БЕЗ установки перед
      // ним — и обязан отказать, а не положить `version: null`.
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });
      const home = box('home-empty');
      const prefix = box('npm-prefix-empty');

      const fix = await sh(stepRun(artifact.onCreateCommand, 'editions'), {
        npm_config_prefix: prefix,
        npm_config_cache: box('npm-cache'),
        npm_config_userconfig: join(box('npm-conf'), 'npmrc'),
        HOME: home,
      });

      expect(fix.code).not.toBe(0);
      expect(fix.err).toContain('[devbox] Фиксация редакций');
      expect(fix.err).toContain(TOOL);
      expect(existsSync(join(home, RECORD))).toBe(false);
    },
  );
});

describe('фиксация — звено ЦЕПОЧКИ, и ведёт себя как звено', () => {
  it(
    'её отказ НАЗЫВАЕТ ШАГ — фиксация не механика сбоку, о поломке которой молчат',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      // Шаг гоняется В ОБЁРТКЕ (`tasker:BASER2-291`), а не голым телом: предмет
      // здесь не текст отказа — он проверен выше, — а то, что цепочка встаёт на
      // фиксации и называет её. Приписанная сбоку механика упала бы молча.
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });
      const home = box('home-chain');

      const result = await sh(chainStep(artifact.onCreateCommand, 'editions'), {
        npm_config_prefix: box('npm-prefix-dead'),
        npm_config_cache: box('npm-cache'),
        npm_config_userconfig: join(box('npm-conf'), 'npmrc'),
        HOME: home,
      });

      expect(result.code).not.toBe(0);
      expect(result.err).toContain(
        'ОТКАЗ на шаге 4/4 editions — фиксация редакций инструментов',
      );
      // И сегодняшний текст при этом на месте: имя добавлено К нему.
      expect(result.err).toContain('[devbox] Фиксация редакций');
      expect(existsSync(join(home, RECORD))).toBe(false);
    },
  );

  it(
    'ПРОЙДЕННАЯ фиксация молчит: шаг, печатающий в норме, приучают не читать',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      const artifact = await materialize({
        settings: { globalTools: { [TOOL]: 'latest' } },
      });

      const { fix } = await bootstrap(artifact, { version: '0.4.0' });

      expect(fix.code).toBe(0);
      expect(fix.out).toBe('');
      expect(fix.err).toBe('');
    },
  );
});
