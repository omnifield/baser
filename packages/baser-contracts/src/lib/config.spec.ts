import { describe, expect, it } from 'vitest';
import {
  CONSUMER_CONFIG_PATH,
  EMPTY_SOURCE_CONFIG,
  parseConsumerConfig,
  parseSourceConfig,
  SOURCE_CONFIG_DIR,
  SOURCE_CONFIG_KEY,
  sourceConfigPath,
} from './config.js';
import { codesOf, consumerConfig, sourceConfigFile } from './form.fixture.js';
import {
  FORM_VERSION,
  MIN_FORM_VERSION,
  PINNED_VERSION_SINCE,
} from './version.js';

function refusals(patch: Record<string, unknown>) {
  const result = parseConsumerConfig(consumerConfig(patch));
  if (result.ok) {
    throw new Error('ожидался отказ, конфиг разобрался');
  }
  return result.problems;
}

const CONFIG_AT = sourceConfigPath('omnifield/devbox');

function tuning(
  baser: Record<string, unknown>,
  rest: Record<string, unknown> = {},
) {
  return parseSourceConfig(sourceConfigFile(baser, rest), CONFIG_AT);
}

describe('baser.json — ЧТО ПОСТАВЛЕНО', () => {
  it('перечень обвесов, и ни одного значения', () => {
    const result = parseConsumerConfig({
      $schema: 'https://omnifield.dev/baser.json',
      formVersion: FORM_VERSION,
      sources: [{ use: '@omnifield/baser-devbox' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0]).toEqual({ use: '@omnifield/baser-devbox' });
  });

  it('НАСТРОЙКИ И ПРЕСЕТЫ ЗДЕСЬ БОЛЬШЕ НЕ ЖИВУТ — сказано, куда уехали', () => {
    // Человек написал ровно то, что работало в форме 1; сказать ему «поля нет»
    // значит отправить искать опечатку там, где её нет.
    const problems = refusals({
      sources: [
        {
          use: '@omnifield/baser-devbox',
          presets: ['omnifield'],
          settings: { runtimeVersion: '24' },
        },
      ],
    });
    expect(codesOf(problems)).toEqual([
      `consumer-settings-moved @ ${CONSUMER_CONFIG_PATH}.sources[0].presets`,
      `consumer-settings-moved @ ${CONSUMER_CONFIG_PATH}.sources[0].settings`,
    ]);
    expect(problems[0].message).toContain(SOURCE_CONFIG_DIR);
    expect(problems[1].message).toContain('как настроено');
  });

  describe('версия формы', () => {
    it('НЕОБЯЗАТЕЛЬНА: её отсутствие означает самую старую разбираемую', () => {
      // Конфиг пишет пользователь, и требовать от него поле, которого он не
      // понимает, значило бы завести вопрос там, где вопросов не бывает.
      const result = parseConsumerConfig(consumerConfig());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.formVersion).toBe(MIN_FORM_VERSION);
      }
    });

    it('принимает версию, которую проставила дверь', () => {
      const result = parseConsumerConfig(
        consumerConfig({ formVersion: FORM_VERSION }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.formVersion).toBe(FORM_VERSION);
      }
    });

    it('отказывает конфигу из будущего, а не разбирает его наполовину', () => {
      const problems = refusals({ formVersion: FORM_VERSION + 1 });
      expect(codesOf(problems)).toEqual([
        `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.formVersion`,
      ]);
      expect(problems[0].message).toContain('обнови baser');
    });

    it('отказывает конфигу первой формы и называет, куда уехали настройки', () => {
      const problems = refusals({ formVersion: 1 });
      expect(codesOf(problems)).toEqual([
        `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.formVersion`,
      ]);
      expect(problems[0].message).toContain(SOURCE_CONFIG_DIR);
    });

    it('не принимает версию строкой или дробью', () => {
      expect(codesOf(refusals({ formVersion: '1' }))).toEqual([
        `form-version-invalid @ ${CONSUMER_CONFIG_PATH}.formVersion`,
      ]);
      expect(codesOf(refusals({ formVersion: 0 }))).toEqual([
        `form-version-invalid @ ${CONSUMER_CONFIG_PATH}.formVersion`,
      ]);
    });
  });

  describe('закрепление версии поставки', () => {
    it('ПРИНИМАЕТСЯ и доезжает до читателя формы', () => {
      const result = parseConsumerConfig(
        consumerConfig({
          formVersion: PINNED_VERSION_SINCE,
          sources: [{ use: '@omnifield/baser-devbox', version: '0.2.0' }],
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.sources[0]).toEqual({
        use: '@omnifield/baser-devbox',
        version: '0.2.0',
      });
    });

    it('ОТСУТСТВИЕ ЗАКОННО — это «не закреплено», а не пропущенное поле', () => {
      // Дверь возьмёт последнюю доступную, назовёт её в плане до применения и
      // закрепит в паспорте (решение architect, `tasker:BASER2-145`).
      const result = parseConsumerConfig(
        consumerConfig({ formVersion: FORM_VERSION }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.sources[0].version).toBeUndefined();
    });

    it('ЗАКРЕПЛЕНИЕ В КОНФИГЕ ФОРМЫ 3 — отказ, а не тихое согласие', () => {
      // Метка, по которой ничего не ветвится, — украшение. Приняв закрепление
      // под старым номером, мы дали бы двери записать файл, который прежний
      // baser назовёт опечаткой вместо «обнови baser».
      const problems = refusals({
        formVersion: PINNED_VERSION_SINCE - 1,
        sources: [{ use: '@omnifield/baser-devbox', version: '0.2.0' }],
      });
      expect(codesOf(problems)).toEqual([
        `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.sources[0].version`,
      ]);
      expect(problems[0].message).toContain('обнови baser');
      expect(problems[0].message).toContain(
        `подними "formVersion" до ${PINNED_VERSION_SINCE}`,
      );
    });

    it('и так же — в конфиге БЕЗ версии формы: молчание значит самую старую', () => {
      const problems = refusals({
        sources: [{ use: '@omnifield/baser-devbox', version: '0.2.0' }],
      });
      expect(codesOf(problems)).toEqual([
        `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.sources[0].version`,
      ]);
    });

    it('ДИАПАЗОН И МЕТКА НЕ ЗАКРЕПЛЯЮТ — названы отдельным кодом', () => {
      // Строка на месте и типом верна: непригодно её СОДЕРЖАНИЕ, и чинится это
      // не другим типом, а другим решением — точной версией либо снятием поля.
      for (const version of [
        '^1.2.0',
        '~1.2',
        '>=1.0.0',
        'latest',
        '1.2',
        '',
      ]) {
        const problems = refusals({
          formVersion: FORM_VERSION,
          sources: [{ use: '@omnifield/baser-devbox', version }],
        });
        expect([version, codesOf(problems)]).toEqual([
          version,
          [`invalid-version @ ${CONSUMER_CONFIG_PATH}.sources[0].version`],
        ]);
      }
      expect(
        refusals({
          formVersion: FORM_VERSION,
          sources: [{ use: '@omnifield/baser-devbox', version: 'latest' }],
        })[0].message,
      ).toContain('не пиши поле вовсе');
    });

    it('предрелиз и метка сборки точную версию не размывают', () => {
      const result = parseConsumerConfig(
        consumerConfig({
          formVersion: FORM_VERSION,
          sources: [
            { use: '@omnifield/baser-devbox', version: '1.2.3-beta.1+build.5' },
          ],
        }),
      );
      expect(result.ok).toBe(true);
    });

    it('версию строкой, а не числом', () => {
      expect(
        codesOf(
          refusals({
            formVersion: FORM_VERSION,
            sources: [{ use: '@omnifield/baser-devbox', version: 2 }],
          }),
        ),
      ).toEqual([`wrong-type @ ${CONSUMER_CONFIG_PATH}.sources[0].version`]);
    });

    it('СУЩЕСТВОВАНИЕ ВЕРСИИ НЕ ПРОВЕРЯЕТСЯ — этот вход не читает реестр', () => {
      // Форма судит пригодность записи, а не наличие поставки: ни сети, ни
      // файловой системы здесь нет. «Такой версии у пакета нет» — отказ того,
      // кто ставит, и приходит он из другой зоны.
      const result = parseConsumerConfig(
        consumerConfig({
          formVersion: FORM_VERSION,
          sources: [{ use: '@нет/такого-пакета', version: '999.999.999' }],
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it('перечень источников — список с первого дня, а не единственный корень', () => {
    const result = parseConsumerConfig({
      sources: [{ use: '@omnifield/baser-devbox' }, { use: '@чужой/обвес' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources).toHaveLength(2);
    }
  });

  it('требует перечень источников', () => {
    const result = parseConsumerConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `missing-field @ ${CONSUMER_CONFIG_PATH}.sources`,
    ]);
  });

  it('называет один и тот же пакет, перечисленный дважды', () => {
    const problems = refusals({
      sources: [
        { use: '@omnifield/baser-devbox' },
        { use: '@omnifield/baser-devbox' },
      ],
    });
    expect(codesOf(problems)).toEqual([
      'duplicate-consumer-entry @ baser.json.sources[1].use',
    ]);
  });

  it('путей в конфиге потребителя не бывает — раскладку объявляет обвес', () => {
    const problems = refusals({
      sources: [
        { use: '@omnifield/baser-devbox', layout: [{ src: 'a', dest: 'b' }] },
      ],
    });
    expect(codesOf(problems)).toEqual([
      'unknown-field @ baser.json.sources[0].layout',
    ]);
    expect(problems[0].message).toContain('раскладку объявляет обвес');
  });

  it('называет опечатку в поле верхнего уровня, но пропускает $schema', () => {
    expect(codesOf(refusals({ source: [] }))).toEqual([
      'unknown-field @ baser.json.source',
    ]);
  });

  it('требует сказать, какой пакет поставлен', () => {
    expect(codesOf(refusals({ sources: [{}] }))).toEqual([
      'missing-field @ baser.json.sources[0].use',
    ]);
    expect(codesOf(refusals({ sources: [{ use: '  ' }] }))).toEqual([
      'empty-string @ baser.json.sources[0].use',
    ]);
  });
});

describe('файл настроек обвеса — КАК НАСТРОЕНО', () => {
  it('ИМЯ СЧИТАЕТСЯ ИЗ ЛИЧНОСТИ, а не берётся из ссылки', () => {
    // Ссылка в baser.json была бы вторым местом для одного факта и могла бы
    // разъехаться; правило разъехаться не может.
    expect(sourceConfigPath('omnifield/devbox')).toBe(
      '.omnifield/omnifield-devbox.yaml',
    );
    expect(sourceConfigPath('чужой/веб')).toBe(
      `${SOURCE_CONFIG_DIR}/чужой-веб.yaml`,
    );
  });

  it('разбирает пресеты и заполненные значения', () => {
    const result = tuning({
      presets: ['omnifield'],
      settings: { runtimeVersion: '24', installAssistant: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      presets: ['omnifield'],
      settings: { runtimeVersion: '24', installAssistant: true },
    });
  });

  it('ОДИН ФАЙЛ, ДВА ЧИТАТЕЛЯ: всё вне ключа baser — дело инструмента', () => {
    // У плагина агентов в этом же файле живут зоны, модели и адреса сервисов.
    // Дверь их не открывает и об их полях молчит: пишет в файл человек, а не два
    // поставщика.
    const result = tuning(
      { settings: { runtimeVersion: '24' } },
      {
        zones: { contracts: { paths: ['packages/baser-contracts'] } },
        models: { architect: 'claude-opus-5' },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.settings).toEqual({ runtimeVersion: '24' });
    }
  });

  it('но опечатку ВНУТРИ baser называет вслух', () => {
    const result = tuning({ setings: { runtimeVersion: '24' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `unknown-field @ ${CONFIG_AT}.${SOURCE_CONFIG_KEY}.setings`,
    ]);
    expect(result.problems[0].message).toContain('presets');
  });

  it('файла нет или он весь закомментирован — это не отказ, а дефолты', () => {
    // Дверь рождает файл с закомментированными дефолтами: активного ключа в нём
    // сразу после рождения нет вовсе.
    for (const empty of [undefined, null, {}, { baser: null }]) {
      const result = parseSourceConfig(empty, CONFIG_AT);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(EMPTY_SOURCE_CONFIG);
      }
    }
  });

  it('отказывает документу, который объектом не является', () => {
    const result = parseSourceConfig('runtimeVersion: 24', CONFIG_AT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([`not-an-object @ ${CONFIG_AT}`]);
  });

  it('отказывает ключу baser, который объектом не является', () => {
    const result = parseSourceConfig({ baser: ['omnifield'] }, CONFIG_AT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `not-an-object @ ${CONFIG_AT}.${SOURCE_CONFIG_KEY}`,
    ]);
  });

  it('отказывает значению настройки, которое значением быть не может', () => {
    // Третий этаж — не значение настройки ни при каком объявлении: словарь `of`
    // закрыт, и вложить карту в карту в карту нечем (`values.ts`).
    const result = tuning({
      settings: { a: { фича: { опции: { глубже: 'некуда' } } } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `wrong-type @ ${CONFIG_AT}.${SOURCE_CONFIG_KEY}.settings.a`,
    ]);
    expect(result.problems[0].message).toContain('ПЛОСКАЯ карта опций');
  });

  it('КАРТА — ЗАКОННОЕ ЗНАЧЕНИЕ, и оба её этажа разбираются', () => {
    // Разбор потребителя объявления ещё не видел: он судит не тип, а ФОРМУ
    // значения. Сверка с объявленным типом — дальше и в другом месте.
    const result = tuning({
      settings: {
        features: { 'ghcr.io/фикстура/uv:1': { version: '0.11', pip: false } },
        env: { TZ: 'UTC' },
        пусто: {},
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.settings['features']).toEqual({
      'ghcr.io/фикстура/uv:1': { version: '0.11', pip: false },
    });
    expect(result.value.settings['пусто']).toEqual({});
  });

  it('называет повторённый пресет — порядок пресетов значим', () => {
    const result = tuning({ presets: ['omnifield', 'omnifield'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `duplicate-consumer-entry @ ${CONFIG_AT}.${SOURCE_CONFIG_KEY}.presets[1]`,
    ]);
  });

  it('отказывает пресетам, перечисленным не списком', () => {
    const result = tuning({ presets: 'omnifield' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      `wrong-type @ ${CONFIG_AT}.${SOURCE_CONFIG_KEY}.presets`,
    ]);
  });
});
