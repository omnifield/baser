/**
 * ПРОДУКТОВЫЕ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ — и граница, за которую они не заходят.
 *
 * Заявка brainer с переезда (`tasker:BASER2-107`): у продукта есть свои переменные
 * контейнера — живой случай `BRAINER_OTEL_ENDPOINT`, который бэкенд инжектит
 * спавнутым сессиям, — а в четырнадцати настройках обвеса их выразить нечем.
 * Шаблон писал ровно четыре переменные секрет-модели, и всё.
 *
 * Форма — СПИСОК СТРОК `КЛЮЧ=значение`, а не карта: карты у настроек нет намеренно
 * (`packages/baser-contracts/README.md` §3), и заводить её по одному примеру значило
 * бы то же угадывание, от которого мы отложили формат шаблона. Решение architect.
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
import { run } from '../../baser-cli/src/index.ts';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
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

/** Отказ прогона: код, текст и — главное — что на диск ничего не легло. */
function refusal({ result, text }) {
  expect(text, 'артефакт лёг, хотя отказ обязан был остановить прогон').toBe(
    null,
  );
  expect(result.problems.map((problem) => problem.code)).toContain(
    'render-failed',
  );
  expect(result.writes.map((write) => write.path)).not.toContain(LIVE);
  return result.problems.map((problem) => problem.message).join('\n');
}

describe('продуктовые переменные выражаются настройкой', () => {
  it('едут в артефакт как есть — живой случай brainer', async () => {
    const { json } = await materialize({
      settings: {
        extraContainerEnv: [
          'BRAINER_OTEL_ENDPOINT=http://host.docker.internal:4318',
        ],
      },
    });

    expect(json.containerEnv).toEqual({
      BRAINER_OTEL_ENDPOINT: 'http://host.docker.internal:4318',
    });
  });

  it('без томов блок появляется ради них одних, а комментарий не врёт', async () => {
    const { json, text } = await materialize({
      settings: { extraContainerEnv: ['A=1', 'B=2'] },
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
      settings: { extraContainerEnv: ['BRAINER_OTEL_ENDPOINT=http://x:4318'] },
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

  it('знак равенства внутри ЗНАЧЕНИЯ не режет строку — режет только первый', async () => {
    const { json } = await materialize({
      settings: { extraContainerEnv: ['DSN=postgres://u:p@h/db?a=1&b=2'] },
    });

    expect(json.containerEnv.DSN).toBe('postgres://u:p@h/db?a=1&b=2');
  });

  it('пустое значение — законно: переменная задана и пуста', async () => {
    const { json } = await materialize({
      settings: { extraContainerEnv: ['QUIET='] },
    });

    expect(json.containerEnv).toEqual({ QUIET: '' });
  });
});

describe('секрет-модель продуктовым слоем НЕ перекрывается', () => {
  it('попытка переопределить адрес кредов — названный отказ', async () => {
    const box = await materialize({
      presets: ['omnifield'],
      settings: {
        extraContainerEnv: ['CLAUDE_CONFIG_DIR=/tmp/claude'],
      },
    });

    const said = refusal(box);
    // Названо ЧТО столкнулось, ОТКУДА берётся верное значение и ЧЕМ чинить.
    expect(said).toContain('CLAUDE_CONFIG_DIR');
    expect(said).toContain('secretsVolume');
    expect(said).toContain('/home/node/.secrets/claude');
    expect(said).toContain('убери строку из extraContainerEnv');
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
        settings: { extraContainerEnv: [`${key}=/tmp/x`] },
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
        extraContainerEnv: ['PNPM_CONFIG_STORE_DIR=/workspaces/.store'],
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
      settings: { extraContainerEnv: ['GH_CONFIG_DIR=/opt/gh'] },
    });

    expect(json.containerEnv).toEqual({ GH_CONFIG_DIR: '/opt/gh' });
  });
});

describe('строка обязана быть переменной, а не чем угодно', () => {
  it('строка без знака равенства — отказ, а не переменная без значения', async () => {
    const said = refusal(
      await materialize({ settings: { extraContainerEnv: ['BRAINER_OTEL'] } }),
    );

    expect(said).toContain('не в форме КЛЮЧ=значение');
  });

  it('имя, которого шелл не примет, — отказ на месте, а не сломанный контейнер', async () => {
    const said = refusal(
      await materialize({ settings: { extraContainerEnv: ['2FA=on'] } }),
    );

    expect(said).toContain('не годится в имя переменной окружения');
  });

  it('один ключ дважды — отказ: какое значение верное, обвес не решает', async () => {
    const said = refusal(
      await materialize({
        settings: { extraContainerEnv: ['A=1', 'A=2'] },
      }),
    );

    expect(said).toContain('задан дважды');
  });
});
