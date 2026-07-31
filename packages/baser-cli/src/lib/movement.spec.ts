/**
 * ДВИЖЕНИЕ ЗНАЧЕНИЙ — обязательство двери и ничьё больше.
 *
 * Движок значений не видит вовсе (`tasker:BASER2-23`), форма их только
 * разрешает. Назвать ДО ПРИМЕНЕНИЯ, что поедет за нами, а что не поднимется
 * никогда, может только дверь (`kb:BASER2-5`, `tasker:BASER2-20`) — поэтому
 * здесь проверяется не «значения посчитались», а именно РАССКАЗ о них.
 *
 * Проверяются переходы, а не устойчивые состояния: центральный переход — «обвес
 * обновился, дефолт поднялся», и правильный ответ на него разный у заполненного
 * и незаполненного значения.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  describeProblems,
  parseSourceDeclaration,
  EMPTY_SOURCE_CONFIG,
  FORM_VERSION,
  type SettingValue,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';
import {
  declaredSettings,
  installDevbox,
  soleRun,
  BUMPED_RESOLVERS,
  DEVBOX_PACKAGE,
  MOVED_NODE,
  PINNED_NODE,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { renderText } from './report.js';
import {
  resolveValues,
  type DefaultsPort,
  type SettingMovement,
} from './values.js';

const DEVBOX_ID = 'omnifield/devbox';
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/**
 * Обвес поставлен, пресет выбран, поверх — что просит проба.
 *
 * Выбор и значения лежат в ФАЙЛЕ НА ИНСТРУМЕНТ, а не в `baser.json`
 * (`tasker:BASER2-10` §3): там теперь только перечень поставленного.
 */
function install(block: Record<string, unknown> = {}): Consumer {
  consumer = installDevbox({
    config: CONFIG,
    tuning: { [DEVBOX_ID]: { presets: ['omnifield'], ...block } },
  });
  return consumer;
}

async function movements(box: Consumer): Promise<Map<string, SettingMovement>> {
  const result = await run({ command: 'plan', cwd: box.root });
  return new Map(
    soleRun(result).settings.map((setting) => [setting.key, setting]),
  );
}

describe('ноль вопросов пользователю', () => {
  it('конфиг без единого заполненного значения даёт ПОЛНЫЙ набор', async () => {
    const box = install();
    const byKey = await movements(box);

    // Ни одна настройка не осталась без значения — вопросов задавать нечего.
    // Сверяется ПЕРЕЧЕНЬ, объявленный самим обвесом, а не число: число молча
    // устаревает на первом же его выпуске и проверяет уже не полноту набора.
    expect([...byKey.keys()].sort()).toEqual([...declaredSettings()].sort());
    expect(
      [...byKey.values()].every((setting) => setting.value !== undefined),
    ).toBe(true);
    // И ни одно из них не заполнено пользователем: всё это наше и поедет.
    expect([...byKey.values()].every((setting) => setting.ours)).toBe(true);
  });
});

describe('движение названо ОБОИМИ концами', () => {
  it('пресет поверх дефолта: видно и откуда, и куда', async () => {
    const network = (await movements(install())).get('network');

    expect(network?.moved).toBe(true);
    expect(network?.chain).toEqual([
      { kind: 'default', value: null },
      { kind: 'preset', value: 'omnifield-gateway', preset: 'omnifield' },
    ]);
    expect(network?.value).toBe('omnifield-gateway');
  });

  it('заполненное поверх пресета: три звена, и последнее — пользователя', async () => {
    const byKey = await movements(
      install({ settings: { network: 'своя-сеть' } }),
    );
    const network = byKey.get('network');

    expect(network?.chain.map((link) => link.kind)).toEqual([
      'default',
      'preset',
      'filled',
    ]);
    expect(network?.value).toBe('своя-сеть');
    // Заполненное — НЕ наше: подниматься ему неоткуда, движок в конфиг не пишет.
    expect(network?.ours).toBe(false);
  });

  it('вычисляемый дефолт называет, ЧЕМ он посчитан', async () => {
    const name = (await movements(install())).get('name');

    expect(name?.value).toBe('baser-devbox');
    expect(name?.chain[0]).toEqual({
      kind: 'computed',
      value: 'baser-devbox',
      // Путь каноничен: его привели контракты при разборе `defaultFrom`.
      resolver: 'defaults.mjs#devboxName',
    });
    // Ничего не двигалось — но значение всё равно наше и поедет за выпуском.
    expect(name?.moved).toBe(false);
    expect(name?.ours).toBe(true);
  });
});

describe('переход: обвес обновился, дефолт поднялся', () => {
  it('НЕзаполненное значение едет за нами', async () => {
    const box = install();
    expect((await movements(box)).get('imageTag')?.value).toBe(PINNED_NODE);

    box.updateResolvers(BUMPED_RESOLVERS);

    const bumped = (await movements(box)).get('imageTag');
    expect(bumped?.value).toBe(MOVED_NODE);
    expect(bumped?.ours).toBe(true);
  });

  it('ЗАПОЛНЕННОЕ значение не поднимается — подниматься неоткуда', async () => {
    const box = install({ settings: { imageTag: '20' } });
    expect((await movements(box)).get('imageTag')?.value).toBe('20');

    box.updateResolvers(BUMPED_RESOLVERS);

    const after = (await movements(box)).get('imageTag');
    // Дефолт под ним уехал вперёд, а значение осталось: заполненное бьёт всё.
    expect(after?.value).toBe('20');
    expect(after?.ours).toBe(false);
    expect(after?.chain[0].value).toBe(MOVED_NODE);
    expect(after?.chain[after.chain.length - 1]).toEqual({
      kind: 'filled',
      value: '20',
    });
  });
});

describe('движение названо ДО применения, а не после', () => {
  it('в тексте оно стоит ВЫШЕ плана: человек читает сверху вниз', async () => {
    const box = install();
    const text = renderText(await run({ command: 'plan', cwd: box.root }));

    const values = text.indexOf('значения:');
    const plan = text.indexOf('шагов:');
    expect(values).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(-1);
    expect(values).toBeLessThan(plan);
  });

  it('назван и КРАЙ списка: что не настройка — то из шаблона как есть', async () => {
    // Список без этой строки читается как полный перечень того, из чего собран
    // артефакт. Первый чужой потребитель достроил ровно это: раз `--add-host`
    // настройкой не назван, значит станок его не кладёт, — и завёл ложный риск
    // «после apply теряем дверь к сервисам» (`tasker:BASER2-103`, пункт 3).
    //
    // Строка живёт ЗДЕСЬ, а не только в отказе первой установки: отказ читает
    // тот, у кого файл уже лежал, а этот блок — каждый, кто ставит обвес.
    const text = renderText(
      await run({ command: 'plan', cwd: install().root }),
    );

    expect(text).toContain(
      'регулируется ровно это: всё остальное приезжает из шаблона как есть',
    );
    expect(text.indexOf('регулируется ровно это')).toBeLessThan(
      text.indexOf('шагов:'),
    );
  });

  it('текст — рендер ПОВЕРХ ответа: в нём нет ничего, чего нет в данных', async () => {
    const result = await run({ command: 'plan', cwd: install().root });
    const text = renderText(result);

    for (const setting of soleRun(result).settings) {
      expect(text).toContain(setting.key);
      expect(text).toContain(JSON.stringify(setting.value));
    }
    // Оба конца движения — в тексте, а не только итог.
    expect(text).toContain('null → "omnifield-gateway"');
    expect(text).toContain('пресет omnifield');
  });
});

/**
 * КАРТА СРАВНИВАЕТСЯ ПО СОДЕРЖИМОМУ, А НЕ ПО ССЫЛКЕ (`tasker:BASER2-118`).
 *
 * Дверь сверяет свой рассказ с тем, что разрешили контракты: конец цепочки
 * обязан совпасть со значением. Пока значения были скалярами и списками,
 * сравнение по ссылке никого не жало; у карты оно означало бы, что дверь считает
 * расхождением ЛЮБОЕ второе чтение того же значения — содержимое то же, объект
 * другой.
 *
 * Прогон через настоящий обвес такого не показывает и показать не может: порт
 * `computeDefault` кэширует посчитанное, и обе дороги приходят к одному объекту.
 * Поэтому здесь дверь зовётся своим публичным входом (`resolveValues`) с
 * ПОРТОМ ПРОБЫ — он отдаёт на каждый вызов свой объект. Это не подмена
 * внутренностей: порт и есть то, чем дверь зовёт чужой резолвер, и чужая
 * реализация свежий объект отдаёт совершенно законно.
 */
describe('карта: одно значение — по содержимому, а не по объекту', () => {
  /** Объявление с ВЫЧИСЛЯЕМЫМ дефолтом-картой — только такой ходит через порт. */
  const DECLARED = {
    formVersion: FORM_VERSION,
    source: {
      id: 'omnifield/map-probe',
      title: 'Проба составного значения',
      contentRoot: 'template',
    },
    settings: {
      features: {
        title: 'Фичи',
        type: 'map',
        of: 'map',
        defaultFrom: './defaults.mjs#features',
      },
    },
    presets: {},
    layout: [{ src: 'a.ejs', dest: 'a' }],
  };

  function declaration(): SourceDeclaration {
    // Через настоящий разбор формы: объявление, собранное мимо неё, доказывало
    // бы поведение двери на структуре, которой у обвеса не бывает.
    const parsed = parseSourceDeclaration(DECLARED);
    if (!parsed.ok) {
      throw new Error(describeProblems(parsed.problems));
    }
    return parsed.value;
  }

  /** Порт, отдающий на каждый вызов СВОЙ объект: ссылки разные по построению. */
  function port(answers: readonly SettingValue[]): DefaultsPort {
    let call = 0;
    return {
      computeDefault: () => answers[Math.min(call++, answers.length - 1)],
    };
  }

  const FEATURES = { 'ghcr.io/va-h/devcontainers-features/uv:1': {} };

  it('ОДИНАКОВАЯ карта расхождением не считается — иначе дверь врала бы даром', () => {
    const result = resolveValues(
      declaration(),
      EMPTY_SOURCE_CONFIG,
      // Две копии одного значения — ровно то, чем обернётся любое второе чтение.
      port([{ ...FEATURES }, { ...FEATURES }]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.movements[0].value).toEqual(FEATURES);
    // И рассказ остался целым: конец цепочки — то же самое значение.
    expect(result.value.movements[0].chain[0].value).toEqual(FEATURES);
  });

  it('РАЗНАЯ карта расхождением СЧИТАЕТСЯ — и разница видна на втором этаже', () => {
    // Без этой половины сравнение, всегда говорящее «одинаково», прошло бы
    // первую пробу идеально. Разница здесь лежит в ОПЦИИ фичи, а не в её
    // ссылке: сравнение обязано дойти до нижнего этажа карты, а не сверить
    // верхние ключи и успокоиться.
    expect(() =>
      resolveValues(
        declaration(),
        EMPTY_SOURCE_CONFIG,
        port([
          { 'ghcr.io/va-h/devcontainers-features/uv:1': { version: '0.11' } },
          { 'ghcr.io/va-h/devcontainers-features/uv:1': { version: '0.12' } },
        ]),
      ),
    ).toThrow(/не то, что разрешили контракты/);
  });
});
