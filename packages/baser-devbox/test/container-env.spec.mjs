/**
 * ПРОДУКТОВЫЕ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ — и граница, за которую они не заходят.
 *
 * Заявка brainer с переезда (`tasker:BASER2-107`): у продукта есть свои переменные
 * контейнера — живой случай `BRAINER_OTEL_ENDPOINT`, который бэкенд инжектит
 * спавнутым сессиям, — а в четырнадцати настройках обвеса их выразить нечем.
 * Шаблон писал ровно четыре переменные секрет-модели, и всё.
 *
 * Форма сначала была СПИСКОМ СТРОК `КЛЮЧ=значение`: карты у настроек не было, и
 * заводить её по одному примеру архитектор отказался — правильно, потому что
 * переменные окружения список выражает честно. Второй случай пришёл со стороны фич
 * (`tasker:BASER2-116`), где список врал по существу, — и с формой 3 настройка стала
 * тем, чем является: КАРТОЙ «имя → значение» (`kb:BASER2-23`). Ручной разбор строки
 * в шаблоне вместе с двумя своими отказами ушёл.
 *
 * Граница: **секрет-модель продуктовым слоем не перекрывается.** Четыре адреса
 * считаются от `secretsVolume`, адрес стора — от `pnpmStoreVolume`; переопределить
 * их своим значением значит получить девбокс, который ищет креды не там, где они
 * лежат. Поэтому здесь названный отказ, а не тихая победа последнего.
 *
 * Отказ приезжает кодом `render-failed`: своего кода у обвеса нет — их называет
 * форма, а не инструмент, — и это честнее выдуманного. Текст при этом наш, и он
 * говорит и ЧТО столкнулось, и от какой настройки считается, и чем чинить.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  tuning,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

async function materialize({ presets = [], settings } = {}) {
  consumer = installConsumer({
    repoName: 'brainer',
    config: consumerConfig(),
    tuning: tuning({ presets, settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  const text = consumer.read(LIVE);
  return { result, text, json: text === null ? null : parseJsonc(text) };
}

/**
 * Отказ прогона: код, текст и — главное — что на диск ничего не легло.
 *
 * Код называется явно, потому что отказы приходят с ДВУХ сторон и это видно:
 * непригодное значение отвергает форма (`value-type-mismatch`, до рендера), а
 * непригодное для шелла имя — обвес (`render-failed`, при рендере). Своего кода
 * у обвеса нет, коды называет форма.
 */
function refusal({ result, text }, code = 'render-failed') {
  expect(text, 'артефакт лёг, хотя отказ обязан был остановить прогон').toBe(
    null,
  );
  expect(result.problems.map((problem) => problem.code)).toContain(code);
  expect(result.writes.map((write) => write.path)).not.toContain(LIVE);
  return result.problems.map((problem) => problem.message).join('\n');
}

describe('продуктовые переменные выражаются настройкой', () => {
  it('едут в артефакт как есть — живой случай brainer', async () => {
    const { json } = await materialize({
      settings: {
        extraContainerEnv: {
          BRAINER_OTEL_ENDPOINT: 'http://host.docker.internal:4318',
        },
      },
    });

    expect(json.containerEnv).toEqual({
      BRAINER_OTEL_ENDPOINT: 'http://host.docker.internal:4318',
    });
  });

  it('без томов блок появляется ради них одних, а комментарий не врёт', async () => {
    const { json, text } = await materialize({
      settings: { extraContainerEnv: { A: '1', B: '2' } },
    });

    expect(json.containerEnv).toEqual({ A: '1', B: '2' });
    expect(text).toContain(
      'Переменные окружения контейнера: продуктовые переменные.',
    );
    // Секрет-модели тут нет вовсе — и про неё не сказано ни строки.
    expect(text).not.toContain('Секрет-модель');
  });

  it('рядом с секрет-моделью: считанное обвесом впереди, продуктовое следом', async () => {
    const { json, text } = await materialize({
      presets: ['omnifield'],
      settings: {
        extraContainerEnv: { BRAINER_OTEL_ENDPOINT: 'http://x:4318' },
      },
    });

    expect(Object.keys(json.containerEnv)).toEqual([
      'CLAUDE_CONFIG_DIR',
      'GIT_CONFIG_GLOBAL',
      'GH_CONFIG_DIR',
      'NPM_CONFIG_USERCONFIG',
      'NPM_CONFIG_STORE_DIR',
      'PNPM_CONFIG_STORE_DIR',
      'BRAINER_OTEL_ENDPOINT',
    ]);
    expect(text).toContain(
      'Переменные окружения контейнера: секрет-модель, адрес pnpm-стора, продуктовые переменные.',
    );
  });

  it('значение едет как есть — резать его больше нечем и незачем', async () => {
    // Вчера строка резалась по первому знаку равенства, и проба стерегла именно
    // этот разбор. Сегодня разбора нет: значение это значение.
    const { json } = await materialize({
      settings: { extraContainerEnv: { DSN: 'postgres://u:p@h/db?a=1&b=2' } },
    });

    expect(json.containerEnv.DSN).toBe('postgres://u:p@h/db?a=1&b=2');
  });

  it('пустое значение — законно: переменная задана и пуста', async () => {
    const { json } = await materialize({
      settings: { extraContainerEnv: { QUIET: '' } },
    });

    expect(json.containerEnv).toEqual({ QUIET: '' });
  });
});

describe('секрет-модель продуктовым слоем НЕ перекрывается', () => {
  it('попытка переопределить адрес кредов — названный отказ', async () => {
    const box = await materialize({
      presets: ['omnifield'],
      settings: {
        extraContainerEnv: { CLAUDE_CONFIG_DIR: '/tmp/claude' },
      },
    });

    const said = refusal(box);
    // Названо ЧТО столкнулось, ОТКУДА берётся верное значение и ЧЕМ чинить.
    expect(said).toContain('CLAUDE_CONFIG_DIR');
    expect(said).toContain('secretsVolume');
    expect(said).toContain('/home/node/.secrets/claude');
    expect(said).toContain('убери ключ из extraContainerEnv');
  });

  it('все четыре адреса секрет-модели закрыты, а не первый попавшийся', async () => {
    for (const key of [
      'CLAUDE_CONFIG_DIR',
      'GIT_CONFIG_GLOBAL',
      'GH_CONFIG_DIR',
      'NPM_CONFIG_USERCONFIG',
    ]) {
      const box = await materialize({
        presets: ['omnifield'],
        settings: { extraContainerEnv: { [key]: '/tmp/x' } },
      });
      expect(refusal(box), key).toContain(key);
      consumer.cleanup();
      consumer = null;
    }
  });

  it('адрес стора закрыт той же границей — он тоже считанный', async () => {
    const box = await materialize({
      presets: ['omnifield'],
      settings: {
        extraContainerEnv: { PNPM_CONFIG_STORE_DIR: '/workspaces/.store' },
      },
    });

    const said = refusal(box);
    expect(said).toContain('pnpmStoreVolume');
    // Именно этот обход и вернул бы дефект `tasker:BASER2-111` через чёрный ход.
    expect(said).toContain('/home/node/.pnpm-store');
  });

  it('БЕЗ тома то же имя законно: перекрывать нечего', async () => {
    // Запрет — не про имя, а про столкновение с ВЫЧИСЛЕННЫМ значением. Нет
    // `secretsVolume` — обвес ничего про этот адрес не утверждает, и продукт
    // волен сказать своё.
    const { json } = await materialize({
      settings: { extraContainerEnv: { GH_CONFIG_DIR: '/opt/gh' } },
    });

    expect(json.containerEnv).toEqual({ GH_CONFIG_DIR: '/opt/gh' });
  });
});

describe('ключ обязан быть именем переменной, а не чем угодно', () => {
  it('СПИСОК вчерашнего дня — отказ, который ПОКАЗЫВАЕТ правку', async () => {
    // Живые заполнившие держат настройку списком, и отказ обязан быть минутной
    // правкой: подсказка берёт строку самого человека и показывает, во что её
    // превратить.
    const box = await materialize({
      settings: {
        extraContainerEnv: ['BRAINER_OTEL_ENDPOINT=http://x:4318'],
      },
    });

    const said = refusal(box, 'value-type-mismatch');
    expect(said).toContain(
      '"- BRAINER_OTEL_ENDPOINT=http://x:4318" замени на "BRAINER_OTEL_ENDPOINT: http://x:4318"',
    );
  });

  it('имя, которого шелл не примет, — отказ на месте, а не сломанный контейнер', async () => {
    // Эту проверку форма за нас не делает и делать не может: ключ карты — просто
    // строка, а годность её в имя переменной окружения знает шелл, то есть мы.
    const said = refusal(
      await materialize({ settings: { extraContainerEnv: { '2FA': 'on' } } }),
    );

    expect(said).toContain('не годится в имя переменной окружения');
  });
});
