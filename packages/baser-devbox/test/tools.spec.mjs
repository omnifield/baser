/**
 * ИНСТРУМЕНТЫ ЛОКАЦИИ: ОБЪЯВИЛ — И ОНИ В МАШИНЕ, БЕЗ ЕДИНОЙ РУЧНОЙ УСТАНОВКИ.
 *
 * `tasker:BASER2-274`. Настройка была одна и булева (`installAssistant`), то есть
 * выражала РОВНО ОДИН инструмент, названный в шаблоне поимённо. Второй пришёл сразу
 * же — магазин локации ставился `npm i -g` руками, и клонировавший репозиторий не
 * получал его вовсе. Выразить второй было нечем: отсутствие регулировки под ходовую
 * нужду — наш брак, а не выбор потребителя (`kb:BASER2-7`).
 *
 * ── ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ, КРОМЕ «СТРОКА ЕДЕТ В АРТЕФАКТ» ──────────────────
 *
 * **Команда РЕАЛЬНО появляется в машине.** Проверка подстроки в `onCreateCommand`
 * — утверждение про текст, а задача была про факт: «контейнер, созданный по нашему
 * девбоксу с объявленным магазином, имеет команду». Поэтому шаг берётся ИЗ
 * АРТЕФАКТА, положенного дверью, и исполняется настоящим `npm` против настоящего
 * реестра — стаб-реестр этой пробы отдаёт настоящий тарбол, собранный `npm pack`.
 * После этого проба спрашивает не npm, а PATH: `command -v` и запуск команды.
 *
 * Изображать установку подставным `npm` здесь было бы половиной имитации
 * (`kb:BASER2-2` §5): она доказала бы, что мы позвали менеджер, и промолчала бы о
 * том, кладёт ли глобальная установка команду туда, где её потом ищут. Подставной
 * менеджер у зоны есть и живёт в `manager-noise.spec.mjs` — там предмет другой (с
 * ЧЕМ позвали), и там он честен.
 *
 * **Ассистент — элемент перечня, а не отдельная механика.** Снял его локация —
 * уходит и установка, и seed онбординга, хотя том кредов на месте. Это ровно то,
 * что раньше выражалось булевой настройкой, и оно обязано было пережить переезд.
 *
 * **Версия названа ЗНАЧЕНИЕМ.** `@latest`, стоявший в шаблоне, не был виден нигде,
 * кроме шаблона. Отказы («версия не названа», «диапазон») держат обещание с той
 * стороны, с которой его можно нарушить молча.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  steps,
  tuning,
} from './packed.mjs';
import { containerEnv } from './env.mjs';
import { MANAGER_PROBE_MS } from './limits.mjs';

/** Инструмент локации, ради которого задача и заведена. */
const STORE = '@omnifield/baser-registry';
const STORE_VERSION = '0.4.0';
/** Команда, которую он кладёт в машину: она и есть предмет проверки. */
const STORE_BIN = 'baser-registry';
const ASSISTANT = '@anthropic-ai/claude-code';

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const path of boxes) {
    rmSync(path, { force: true, recursive: true });
  }
  boxes = [];
});

function box(prefix) {
  const path = mkdtempSync(join(tmpdir(), `baser-devbox-${prefix}-`));
  boxes.push(path);
  return path;
}

async function materialize({ presets = [], settings } = {}) {
  consumer = installConsumer({
    repoName: 'baser',
    config: consumerConfig(),
    tuning: tuning({ presets, settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  const text = consumer.read(LIVE);
  return { result, text, json: text === null ? null : parseJsonc(text) };
}

/** Отказ прогона: код формы, текст обвеса и пустой диск. */
function refusal({ result, text }, code = 'render-failed') {
  expect(text, 'артефакт лёг, хотя отказ обязан был остановить прогон').toBe(
    null,
  );
  expect(result.problems.map((problem) => problem.code)).toContain(code);
  return result.problems.map((problem) => problem.message).join('\n');
}

/**
 * Шаг установки инструментов — ВЗЯТЫЙ ИЗ АРТЕФАКТА ПО ИМЕНИ (`tasker:BASER2-291`).
 *
 * Раньше шаг искался по куску его тела (`part.includes('npm install -g')`) — это и
 * была цена безымянности, заплаченная в пробе. Теперь у шага есть имя, и адресуется
 * он именем; тело перестало быть опознавательным знаком и стало только предметом.
 *
 * `null`, если шага нет вовсе: «инструментов не объявлено» — рабочее состояние, и
 * проба обязана уметь его назвать, а не упасть на поиске.
 */
function toolsStep(json) {
  return (
    steps(json.onCreateCommand).find((step) => step.id === 'tools')?.run ?? null
  );
}

describe('перечень инструментов: пустой — рабочее состояние, заполненный — команда', () => {
  it('НИЧЕГО НЕ ОБЪЯВЛЕНО — шага установки в артефакте нет вовсе', async () => {
    const { json } = await materialize();

    // Не «пустая установка» и не установка ничего: шага нет. Локация без
    // ассистента и без магазина — законная раскладка, а не недонастроенная.
    // Читается это теперь СОСТАВОМ ЦЕПОЧКИ, а не сравнением всей строки: шаг без
    // предмета не существует, значит в перечне остаётся один corepack.
    expect(steps(json.onCreateCommand).map((step) => step.id)).toEqual([
      'corepack',
    ]);
    expect(toolsStep(json)).toBe(null);
  });

  it('ОБЪЯВЛЕННЫЙ ИНСТРУМЕНТ едет вместе со своей версией', async () => {
    const { json } = await materialize({
      settings: { globalTools: { [STORE]: STORE_VERSION } },
    });

    // Без тома стора имени, от которого его снимают, нет вовсе: `env -u`
    // приезжает вместе с `pnpmStoreVolume`, и проба это разводит, а не
    // переписывает ожидание под то, что увидела.
    expect(toolsStep(json)).toBe(`npm install -g ${STORE}@${STORE_VERSION}`);
    // Версия в артефакте ЕСТЬ, а не подразумевается: имя без неё означало бы
    // «последняя молча», от которой задача и уходит.
    expect(json.onCreateCommand).not.toContain(`${STORE} `);
  });

  it('ДВА ИНСТРУМЕНТА — одна установка и порядок объявления', async () => {
    const { json } = await materialize({
      settings: {
        globalTools: { [ASSISTANT]: 'latest', [STORE]: STORE_VERSION },
      },
    });

    // Одна команда на весь перечень: npm решает спецификаторы одним проходом, а
    // цепочка `&&` всё равно обрывается на первом отказе — изоляции
    // команда-на-инструмент не даёт, лишние проходы даёт.
    expect(toolsStep(json)).toBe(
      `npm install -g ${ASSISTANT}@latest ${STORE}@${STORE_VERSION}`,
    );
  });

  it('перечень ЗАМЕНЯЕТ пресет целиком — как карта фич и карта томов', async () => {
    // Пресет omnifield объявляет ассистента. Локация, которой нужен ещё и
    // магазин, называет ОБОИХ: заполненная карта не дополняет дефолт, а встаёт
    // вместо него (`kb:BASER2-23`, то же правило у devcontainerFeatures).
    const { json } = await materialize({
      presets: ['omnifield'],
      settings: { globalTools: { [STORE]: STORE_VERSION } },
    });

    // Пресет несёт том стора — значит и снятие его имени с этой команды
    // (`tasker:BASER2-136`): установка глобального пакета зовёт npm напрямую.
    expect(toolsStep(json)).toBe(
      `env -u NPM_CONFIG_STORE_DIR npm install -g ${STORE}@${STORE_VERSION}`,
    );
    expect(json.onCreateCommand).not.toContain(ASSISTANT);
  });
});

describe('ассистент — ЭЛЕМЕНТ перечня, а не отдельная механика', () => {
  it('пресет omnifield ставит его перечнем, и seed онбординга на месте', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });

    expect(toolsStep(json)).toBe(
      `env -u NPM_CONFIG_STORE_DIR npm install -g ${ASSISTANT}@latest`,
    );
    expect(json.postCreateCommand).toContain('$CLAUDE_CONFIG_DIR');
  });

  it('локация СНЯЛА ассистента — уходит и установка, и seed, а том кредов остаётся', async () => {
    const { json } = await materialize({
      presets: ['omnifield'],
      settings: { globalTools: {} },
    });

    expect(toolsStep(json)).toBe(null);
    // Seed привязан к ИНСТРУМЕНТУ, а не к тому: том кредов на месте (его ставит
    // тот же пресет), а класть в него онбординг больше некому.
    expect(json.postCreateCommand).not.toContain('CLAUDE_CONFIG_DIR');
    expect(json.mounts.join(' ')).toContain('omnifield-secrets');
  });

  it('магазин БЕЗ ассистента: seed не появляется от чужого инструмента', async () => {
    const { json } = await materialize({
      presets: ['omnifield'],
      settings: { globalTools: { [STORE]: STORE_VERSION } },
    });

    expect(json.postCreateCommand).not.toContain('CLAUDE_CONFIG_DIR');
  });
});

describe('названные отказы: версия обязана называть, что приедет в машину', () => {
  it('версия не названа — отказ говорит, чем её заполнить', async () => {
    const message = refusal(
      await materialize({ settings: { globalTools: { [STORE]: '' } } }),
    );

    expect(message).toContain(`инструмент ${STORE}: версия не названа`);
    expect(message).toContain('latest');
  });

  it('ДИАПАЗОН не принимается: он ничего не закрепляет и едет в шелл', async () => {
    const message = refusal(
      await materialize({ settings: { globalTools: { [STORE]: '>=0.4' } } }),
    );

    expect(message).toContain('не годится в версию');
    expect(message).toContain('шелл контейнера');
  });

  it('имя не npm-пакета — отказ называет, что ключ это ИМЯ, а версия значение', async () => {
    const message = refusal(
      await materialize({
        settings: { globalTools: { 'baser registry': '0.4.0' } },
      }),
    );

    expect(message).toContain('не годится в имя npm-пакета');
  });

  it('пустой ключ — тем же отказом: имя пакета это адрес, а не пустое место', async () => {
    const message = refusal(
      await materialize({ settings: { globalTools: { '': '0.4.0' } } }),
    );

    expect(message).toContain('не годится в имя npm-пакета');
  });
});

/**
 * ПРОБА ЗАДАЧИ, ИСПОЛНЕНИЕМ: локация объявила магазин — команда в машине есть.
 *
 * Стаб-реестр отдаёт НАСТОЯЩИЙ тарбол, собранный `npm pack` из фикстуры: пакет с
 * `bin`, то есть ровно то, чем является магазин для машины — команда. Дальше
 * исполняется шаг ИЗ АРТЕФАКТА, и спрашивается не менеджер, а PATH.
 */
describe('ПРОБА: объявил магазин — команда есть, без единой ручной установки', () => {
  /** Тарбол фикстуры: настоящий пакет с командой, собранный настоящим `npm pack`. */
  function packTool() {
    const source = join(box('tool-src'), 'tool');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, 'package.json'),
      `${JSON.stringify(
        {
          name: STORE,
          version: STORE_VERSION,
          bin: { [STORE_BIN]: 'bin.js' },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(source, 'bin.js'),
      '#!/usr/bin/env node\nprocess.stdout.write("МАГАЗИН-НА-МЕСТЕ\\n");\n',
    );

    const out = box('tool-pack');
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', out, source],
      { stdio: 'pipe' },
    );
    const name = readdirSync(out).find((file) => file.endsWith('.tgz'));
    return readFileSync(join(out, name));
  }

  /** Реестр, отвечающий на то, что спрашивает установка: манифест и тарбол. */
  async function withRegistry(tarball, body) {
    const asked = [];
    let base = '';
    const server = createServer((req, res) => {
      asked.push(decodeURIComponent(req.url));
      if (req.url.endsWith('.tgz')) {
        res.setHeader('content-type', 'application/octet-stream');
        res.end(tarball);
        return;
      }
      if (decodeURIComponent(req.url) !== `/${STORE}`) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          name: STORE,
          'dist-tags': { latest: STORE_VERSION },
          versions: {
            [STORE_VERSION]: {
              name: STORE,
              version: STORE_VERSION,
              bin: { [STORE_BIN]: 'bin.js' },
              dist: {
                tarball: `${base}/tarball/tool.tgz`,
                integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
              },
            },
          },
        }),
      );
    });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    base = `http://127.0.0.1:${server.address().port}`;
    try {
      return await body({ base, asked });
    } finally {
      server.close();
    }
  }

  /**
   * Окружение установки: изображает контейнер и СИДИТ В КЛЕТКЕ.
   *
   * Клетка — не аккуратность: глобальная установка без своего префикса легла бы
   * в машину прогона, а конфиг пользователя привёл бы её в настоящий реестр.
   * Имена строчные (`npm_config_*`) намеренно: они бьют одноимённые UPPERCASE, и
   * ровно этим у зоны уже разъезжалась клетка (`test/env.mjs`).
   */
  function install(base, prefix) {
    return {
      npm_config_registry: `${base}/`,
      npm_config_prefix: prefix,
      npm_config_cache: box('npm-cache'),
      npm_config_userconfig: join(box('npm-conf'), 'npmrc'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    };
  }

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

  it(
    'ОБЪЯВЛЕН — и в контейнере появляется команда, которую можно запустить',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      const tarball = packTool();
      const { json } = await materialize({
        settings: { globalTools: { [STORE]: STORE_VERSION } },
      });
      const step = toolsStep(json);
      expect(step, json.onCreateCommand).toBeTruthy();

      await withRegistry(tarball, async ({ base, asked }) => {
        const prefix = box('npm-prefix');
        const put = await sh(step, install(base, prefix));
        expect(put.code, `${put.out}\n${put.err}`).toBe(0);
        // Установка ходила за ИМЕНЕМ, которое объявила локация, а не за чем-то,
        // что проба подсунула ему сама.
        expect(asked).toContain(`/${STORE}`);

        // И вот здесь спрашивается уже не менеджер, а машина: есть ли команда.
        const found = await sh(`command -v ${STORE_BIN} && ${STORE_BIN}`, {
          PATH: `${join(prefix, 'bin')}:${process.env.PATH}`,
        });

        expect(found.code, `${found.out}\n${found.err}`).toBe(0);
        expect(found.out).toContain('МАГАЗИН-НА-МЕСТЕ');
      });
    },
  );

  it(
    'НЕГАТИВНЫЙ КОНТРОЛЬ: не объявлен — ставить нечего, и команды нет',
    { timeout: MANAGER_PROBE_MS },
    async () => {
      const { json } = await materialize({ settings: { globalTools: {} } });

      // Ставить нечего по построению: шага в артефакте нет. Без этого контроля
      // проба выше доказывала бы, что npm умеет ставить пакеты, — а не что
      // команда появляется ОТ ОБЪЯВЛЕНИЯ локации.
      expect(toolsStep(json)).toBe(null);

      // PATH — ТОЛЬКО пустой префикс, и это не педантизм: на машине прогона
      // команда `baser-registry` есть (монорепа связывает свои пакеты в
      // `node_modules/.bin`), и с унаследованным PATH контроль зеленел бы,
      // ничего не проверив. Проверено: он и зеленел.
      const prefix = box('npm-prefix-empty');
      const found = await sh(`command -v ${STORE_BIN}`, {
        // Системные каталоги оставлены ровно для того, чтобы было чем запустить
        // сам шелл: `baser-registry` в них не лежит, а связка монорепы живёт в
        // `node_modules/.bin`, которого здесь нет.
        PATH: `${join(prefix, 'bin')}:/usr/bin:/bin`,
      });

      expect(found.code).not.toBe(0);
    },
  );
});
