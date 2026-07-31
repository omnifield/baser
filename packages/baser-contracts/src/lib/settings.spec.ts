import { describe, expect, it } from 'vitest';
import {
  parseSourceConfig,
  sourceConfigPath,
  SOURCE_CONFIG_KEY,
  type SourceConfig,
} from './config.js';
import {
  parseSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import {
  resolveSettings,
  type ComputeDefault,
  type ResolverContext,
  type SettingResolver,
} from './settings.js';

const BLOCK = declarationBlock({
  settings: {
    name: {
      title: 'Имя девбокса',
      type: 'string',
      defaultFrom: './defaults.js#devboxName',
    },
    runtimeVersion: { title: 'Версия Node', type: 'string', default: '22' },
    installCommand: {
      title: 'Установка',
      type: 'string',
      default: 'pnpm install',
    },
    network: { title: 'Сеть', type: 'string', default: null },
    installAssistant: { title: 'Ассистент', type: 'boolean', default: false },
    features: {
      title: 'Фичи и их опции',
      type: 'map',
      of: 'map',
      default: { 'ghcr.io/фикстура/gh:1': {} },
    },
    extraEnv: {
      title: 'Переменные окружения',
      type: 'map',
      of: 'string',
      default: {},
    },
  },
  presets: {
    omnifield: {
      title: 'Раскладка omnifield',
      values: {
        network: 'omnifield-gateway',
        installAssistant: true,
        features: { 'ghcr.io/фикстура/uv:1': { version: '0.11' } },
      },
    },
  },
});

function declaration(): SourceDeclaration {
  const parsed = parseSourceDeclaration(BLOCK);
  if (!parsed.ok) {
    throw new Error(`заготовка непригодна: ${JSON.stringify(parsed.problems)}`);
  }
  return parsed.value;
}

/** Адрес, который человек откроет, увидев отказ: его файл, а не объявление. */
const CONFIG_AT = sourceConfigPath('omnifield/devbox');
const MINE = `${CONFIG_AT}.${SOURCE_CONFIG_KEY}`;

/** Как обвес настроен у потребителя — файл на инструмент, ключ `baser`. */
function tuned(patch: Record<string, unknown> = {}): SourceConfig {
  const parsed = parseSourceConfig({ [SOURCE_CONFIG_KEY]: patch }, CONFIG_AT);
  if (!parsed.ok) {
    throw new Error(`заготовка непригодна: ${JSON.stringify(parsed.problems)}`);
  }
  return parsed.value;
}

/** Дверь-заглушка: резолвер синхронный и знает только локальный контекст. */
const computeDefault: ComputeDefault = (ref) =>
  ref.member === 'devboxName' ? 'baser-devbox' : '';

function resolve(
  patch: Record<string, unknown> = {},
  compute = computeDefault,
) {
  return resolveSettings(declaration(), tuned(patch), {
    computeDefault: compute,
  });
}

describe('разрешение значений', () => {
  it('дефолт обвеса работает, когда пользователь не заполнил ничего', () => {
    const result = resolve();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.values).toEqual({
      name: 'baser-devbox',
      runtimeVersion: '22',
      installCommand: 'pnpm install',
      network: null,
      installAssistant: false,
      features: { 'ghcr.io/фикстура/gh:1': {} },
      extraEnv: {},
    });
    expect(result.value.origins['name']).toEqual({
      kind: 'computed',
      ref: { module: 'defaults.js', member: 'devboxName' },
    });
  });

  it('пресет бьёт дефолт, а заполненное бьёт пресет', () => {
    const result = resolve({
      presets: ['omnifield'],
      settings: { installAssistant: false, runtimeVersion: '24' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Сеть пришла из пресета, ассистента пользователь выключил обратно.
    expect(result.value.values['network']).toBe('omnifield-gateway');
    expect(result.value.values['installAssistant']).toBe(false);
    expect(result.value.values['runtimeVersion']).toBe('24');

    expect(result.value.origins['network']).toEqual({
      kind: 'preset',
      preset: 'omnifield',
    });
    expect(result.value.origins['installAssistant']).toEqual({
      kind: 'filled',
    });
  });

  it('следующий пресет бьёт предыдущего — порядок перечисления значим', () => {
    const twoPresets = parseSourceDeclaration(
      declarationBlock({
        settings: { name: { title: 'Имя', type: 'string', default: 'a' } },
        presets: {
          first: { title: 'Первый', values: { name: 'первый' } },
          second: { title: 'Второй', values: { name: 'второй' } },
        },
      }),
    );
    expect(twoPresets.ok).toBe(true);
    if (!twoPresets.ok) return;

    const result = resolveSettings(
      twoPresets.value,
      tuned({ presets: ['first', 'second'] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.values['name']).toBe('второй');
    }
  });

  it('НЕЗНАКОМЫЙ КЛЮЧ НАСТРОЙКИ называется вслух и подсказывает знакомые', () => {
    // Опечатка, которая тихо ничего не делает, — то самое молчание, из-за
    // которого затирание становилось дефектом.
    const result = resolve({ settings: { runtimeVersion_: '24' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `unknown-setting @ ${MINE}.settings.runtimeVersion_`,
    ]);
    expect(result.problems[0].message).toContain('никуда не поедет');
    expect(result.problems[0].message).toContain('runtimeVersion');
  });

  it('называет пресет, которого у обвеса нет', () => {
    const result = resolve({ presets: ['омнифилд'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `unknown-preset @ ${MINE}.presets[0]`,
    ]);
    expect(result.problems[0].message).toContain('есть: omnifield');
  });

  it('сверяет заполненное значение с объявленным типом', () => {
    const result = resolve({ settings: { installAssistant: 'да' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `value-type-mismatch @ ${MINE}.settings.installAssistant`,
    ]);
  });

  describe('составной тип — карта', () => {
    it('ПРЕСЕТ ЗАМЕНЯЕТ КАРТУ ЦЕЛИКОМ, а не сливает её с дефолтом', () => {
      const result = resolve({ presets: ['omnifield'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Ключа дефолта в разрешённом значении НЕТ: слейся карты, убрать его было
      // бы нечем — только надгробием, то есть словарём внутри значения.
      expect(result.value.values['features']).toEqual({
        'ghcr.io/фикстура/uv:1': { version: '0.11' },
      });
      // Происхождение осталось ОДНИМ — на нём стоит рассказ двери про движение.
      expect(result.value.origins['features']).toEqual({
        kind: 'preset',
        preset: 'omnifield',
      });
    });

    it('заполненное бьёт пресет тем же правилом — картой целиком', () => {
      const result = resolve({
        presets: ['omnifield'],
        settings: { features: {} },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Пустая карта — это сказанное «фич нет», а не «не заполнено».
      expect(result.value.values['features']).toEqual({});
      expect(result.value.origins['features']).toEqual({ kind: 'filled' });
    });

    it('ОБЪЯВЛЕНА КАРТА, ЗАПОЛНЕН СПИСОК: отказ показывает, ЧТО ДЕЛАТЬ', () => {
      // Так выглядит переход у двух живых потребителей (`tasker:BASER2-116`):
      // вчера настройка была списком ссылок, и человек написал не опечатку.
      const result = resolve({
        settings: { features: ['ghcr.io/фикстура/uv:1'] },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(codesOf(result.problems)).toEqual([
        `value-type-mismatch @ ${MINE}.settings.features`,
      ]);
      const [{ message }] = result.problems;
      // Тип назван полностью: «просто карта» не сказала бы, чем её заполнять.
      expect(message).toContain('map «ключ → map»');
      // Правка показана строкой ЧЕЛОВЕКА, а не абстрактной «ссылкой».
      expect(message).toContain(
        '"- ghcr.io/фикстура/uv:1" замени на "ghcr.io/фикстура/uv:1: {}"',
      );
      expect(message).toContain('опции пиши под ней с отступом');
    });

    it('у карты скаляров подсказка своя — пара «ключ=значение» разбирается', () => {
      const result = resolve({ settings: { extraEnv: ['TZ=UTC'] } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems[0].message).toContain(
        '"- TZ=UTC" замени на "TZ: UTC"',
      );
    });

    it('ВТОРОЙ ЭТАЖ ПРОВЕРЯЕТСЯ: of: "map" ждёт карту опций, а не скаляр', () => {
      // Ссылка без опций пишется как `{}`, а не как строка: у ключа карты
      // обязано быть значение, и `of` говорит, какое именно.
      const result = resolve({
        settings: { features: { 'ghcr.io/фикстура/uv:1': '0.11' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(codesOf(result.problems)).toEqual([
        `value-type-mismatch @ ${MINE}.settings.features`,
      ]);
      expect(result.problems[0].message).toContain('map «ключ → map»');
    });

    it('третий этаж не доезжает даже до сверки с объявлением', () => {
      // Разбор файла настроек судит ФОРМУ значения и знать объявление для этого
      // не обязан: третьего этажа нет ни при каком `of`, поэтому отказ приходит
      // раньше — от чтения конфига, а не от сверки пары.
      const parsed = parseSourceConfig(
        {
          [SOURCE_CONFIG_KEY]: {
            settings: { features: { ссылка: { опции: { глубже: 'некуда' } } } },
          },
        },
        CONFIG_AT,
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(codesOf(parsed.problems)).toEqual([
        `wrong-type @ ${MINE}.settings.features`,
      ]);
    });

    it('карта скаляров не принимает карту значением — of назван не зря', () => {
      const result = resolve({
        settings: { extraEnv: { TZ: { значение: 'UTC' } } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems[0].message).toContain('map «ключ → string»');
    });
  });

  describe('вычисляемый дефолт', () => {
    it('отказывает, если звать резолверы некому', () => {
      const result = resolveSettings(declaration(), tuned());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(codesOf(result.problems)).toEqual([
        'resolver-failed @ omnifield/devbox.settings.name.defaultFrom',
      ]);
    });

    it('ловит бросок резолвера и называет его, а не роняет разбор', () => {
      const result = resolve({}, () => {
        throw new Error('модуль не нашёлся');
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems[0].code).toBe('resolver-failed');
      expect(result.problems[0].message).toContain('модуль не нашёлся');
    });

    it('ЗАПРЕЩАЕТ асинхронный резолвер — дефолт не ездит по календарю', () => {
      // Обещание означает поход наружу; дефолт, зависящий от даты прогона,
      // ломает воспроизводимость коммита, а запинить вычисленное сегодня некуда.
      const result = resolve({}, () => Promise.resolve('24'));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(codesOf(result.problems)).toEqual([
        'resolver-async @ omnifield/devbox.settings.name.defaultFrom',
      ]);
      expect(result.problems[0].message).toContain('воспроизводимость');
    });

    it('сверяет вычисленное значение с объявленным типом', () => {
      const result = resolve({}, () => 22);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(codesOf(result.problems)).toEqual([
        'value-type-mismatch @ omnifield/devbox.settings.name.defaultFrom',
      ]);
    });

    describe('версия обвеса в контексте резолвера', () => {
      /** Контекст собирает дверь; форма только объявляет, что в нём бывает. */
      function context(version: string | null): ResolverContext {
        return {
          repo: { name: 'baser', root: '/репо' },
          source: {
            id: 'omnifield/devbox',
            packageName: '@omnifield/baser-devbox',
            version,
          },
        };
      }

      it('ОБВЕС БЕЗ ВЕРСИИ В МАНИФЕСТЕ: отсутствие названо, а не изображено', () => {
        // У одного факта одна форма во всех зонах — `string | null`, как в
        // паспорте укладки и на входе движка (`tasker:BASER2-69`). Пока форма
        // требовала здесь строку, дверь изображала отсутствие пустой строкой.
        const резолвер: SettingResolver = (ctx) =>
          ctx.source.version === null ? 'без версии' : ctx.source.version;

        expect(резолвер(context(null))).toBe('без версии');
        expect(резолвер(context('0.5.0'))).toBe('0.5.0');
      });

      it('версия доезжает до резолвера через порт двери', () => {
        const result = resolve({}, () => context(null).source.version ?? 'нет');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.values['name']).toBe('нет');
      });
    });
  });
});
