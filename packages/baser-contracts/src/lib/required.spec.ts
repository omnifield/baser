/**
 * СВОДКА «ЧТО ОБЯЗАТЕЛЬНО» — прогоном, а не обещанием.
 *
 * Правила обязательности до этого извлекались только чтением разборщика
 * (`tasker:BASER2-70` §5): чужой автор узнавал их отказом на своём объявлении.
 * Сводка появилась в README, и здесь она проверяется — иначе это второе место
 * для одного факта, которое разъедется.
 *
 * Таблицы ниже повторяют README §«Что обязательно» построчно. Разошлись — красный
 * прогон, а не устаревший абзац.
 */

import { describe, expect, it } from 'vitest';
import {
  parseConsumerConfig,
  parseSourceConfig,
  sourceConfigPath,
} from './config.js';
import {
  parseSourceDeclaration,
  readSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { consumerConfig, declarationBlock } from './form.fixture.js';
import type { FormProblemCode } from './problems.js';

/** Объявление без одного поля — остальное на месте, чтобы отказ был про него. */
function без(patch: Record<string, unknown>): readonly FormProblemCode[] {
  const result = parseSourceDeclaration(declarationBlock(patch));
  if (result.ok) {
    throw new Error('ожидался отказ, объявление разобралось');
  }
  return result.problems.map((problem) => problem.code);
}

function разбирается(patch: Record<string, unknown>): SourceDeclaration {
  const result = parseSourceDeclaration(declarationBlock(patch));
  if (!result.ok) {
    throw new Error(
      `ожидалось, что поле необязательно: ${JSON.stringify(result.problems)}`,
    );
  }
  return result.value;
}

/** Минимальная настройка и минимальный пресет — от них отнимают по полю. */
const НАСТРОЙКА = { title: 'Имя', type: 'string', default: 'devbox' };
const ПРЕСЕТ = { title: 'Ходовое', values: { name: 'предустановлено' } };
const ЗАПИСЬ = { src: 'a.json', dest: 'a.json' };

describe('минимум из README §0 — первый обвес чужого автора', () => {
  it('РАЗБИРАЕТСЯ КАК ЕСТЬ: дока не обещает того, что форма отвергнет', () => {
    // Один в один блок из §0. Первое, что делает чужой автор, — копирует его;
    // копия, которую разборщик не примет, дороже отсутствующего примера.
    const result = readSourceDeclaration({
      name: '@brainer/agent-harness',
      version: '0.1.0',
      files: ['template', 'defaults.js'],
      baser: {
        formVersion: 3,
        source: {
          id: 'brainer/agent-harness',
          title: 'Плагин агентов брайнера',
          contentRoot: 'template',
        },
        layout: [{ src: 'harness.yaml.ejs', dest: '.omnifield/harness.yaml' }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ни настроек, ни пресетов — и это законный обвес, а не полупустой.
    expect(result.value.settings).toEqual({});
    expect(result.value.presets).toEqual({});
    // Умолчания проставлены при разборе, читателю формы их выводить не надо.
    expect(result.value.layout[0]).toMatchObject({
      render: true,
      class: 'regenerated',
      executable: false,
    });
  });

  it('и его файл настроек называется так, как обещает §6', () => {
    expect(sourceConfigPath('brainer/agent-harness')).toBe(
      '.omnifield/brainer-agent-harness.yaml',
    );
  });
});

describe('объявление обвеса: что обязательно', () => {
  it.each([
    ['formVersion', { formVersion: undefined }, 'form-version-missing'],
    ['source целиком', { source: undefined }, 'missing-field'],
    [
      'source.id',
      { source: { title: 'Девбокс', contentRoot: 'template' } },
      'missing-field',
    ],
    [
      'source.title',
      { source: { id: 'omnifield/devbox', contentRoot: 'template' } },
      'missing-field',
    ],
    [
      'source.contentRoot',
      { source: { id: 'omnifield/devbox', title: 'Девбокс' } },
      'missing-field',
    ],
    ['layout', { layout: undefined }, 'missing-field'],
    ['непустой layout', { layout: [] }, 'missing-field'],
    ['layout[].src', { layout: [{ dest: 'a.json' }] }, 'missing-field'],
    ['layout[].dest', { layout: [{ src: 'a.json' }] }, 'missing-field'],
    [
      'settings[].title',
      { settings: { name: { type: 'string', default: 'x' } } },
      'missing-field',
    ],
    [
      'settings[].type',
      { settings: { name: { title: 'Имя', default: 'x' } } },
      'missing-field',
    ],
    [
      'дефолт настройки — ровно один',
      { settings: { name: { title: 'Имя', type: 'string' } } },
      'setting-no-default',
    ],
    [
      'дефолт настройки — не два сразу',
      {
        settings: {
          name: {
            title: 'Имя',
            type: 'string',
            default: 'x',
            defaultFrom: './defaults.js#name',
          },
        },
      },
      'setting-two-defaults',
    ],
    [
      'settings[].of у карты',
      { settings: { m: { title: 'Карта', type: 'map', default: {} } } },
      'map-value-type',
    ],
    [
      'settings[].of ТОЛЬКО у карты',
      {
        settings: {
          s: { title: 'Строка', type: 'string', of: 'string', default: 'x' },
        },
      },
      'map-value-type',
    ],
    [
      'presets[].title',
      { presets: { omnifield: { values: { name: 'x' } } } },
      'missing-field',
    ],
    [
      'presets[].values',
      { presets: { omnifield: { title: 'Ходовое' } } },
      'missing-field',
    ],
  ])('%s — без него отказ', (_что, patch, код) => {
    expect(без(patch)).toContain(код);
  });
});

describe('объявление обвеса: что НЕобязательно', () => {
  it('settings — обвес без регулировок законен', () => {
    expect(разбирается({ settings: undefined }).settings).toEqual({});
  });

  it('presets — простой обвес ходовых положений не объявляет', () => {
    expect(разбирается({ presets: undefined }).presets).toEqual({});
  });

  it('settings[].description — необязателен, но уезжает в файл настроек', () => {
    const decl = разбирается({ settings: { name: НАСТРОЙКА } });
    expect(decl.settings['name'].description).toBeUndefined();
  });

  it('layout[].render — умолчание true, проставлено при разборе', () => {
    expect(разбирается({ layout: [ЗАПИСЬ] }).layout[0].render).toBe(true);
  });

  it('layout[].class — умолчание regenerated, проставлено при разборе', () => {
    expect(разбирается({ layout: [ЗАПИСЬ] }).layout[0].class).toBe(
      'regenerated',
    );
  });

  it('layout[].executable — умолчание false, проставлено при разборе', () => {
    // Умолчание «артефакт это данные»: обвес, написанный до формы 6, ничего не
    // объявляет и получает то же поведение, что и раньше.
    expect(разбирается({ layout: [ЗАПИСЬ] }).layout[0].executable).toBe(false);
  });

  it('warningFrom — обвесу нечего сказать, и это рабочее состояние', () => {
    // Форма 7 прибавила поле на стороне обвеса, но не потребовала его: до неё
    // так было у всех, и ни один выпущенный обвес от подъёма не правится.
    const decl = разбирается({ warningFrom: undefined });
    expect(decl.warningFrom).toBeUndefined();
    expect('warningFrom' in decl).toBe(false);
  });

  it('ОБЪЯВЛЕНИЕ ФОРМЫ 2 РАЗБИРАЕТСЯ КАК ЕСТЬ — подъём до 3 его не трогает', () => {
    // Сводка §0 обещает разбор с MIN_FORM_VERSION, а не с текущей: форма 3
    // только ДОБАВИЛА тип, ничего не сдвинув, и живой обвес формы 2 обязан
    // ехать без единой правки.
    const decl = разбирается({ formVersion: 2 });
    expect(decl.formVersion).toBe(2);
    expect(decl.settings['name'].type).toBe('string');
  });

  it('пресет с одним значением законен — это не «все настройки сразу»', () => {
    const decl = разбирается({
      settings: { name: НАСТРОЙКА },
      presets: { omnifield: ПРЕСЕТ },
    });
    expect(decl.presets['omnifield'].values).toEqual({
      name: 'предустановлено',
    });
  });
});

describe('сторона потребителя: что обязательно', () => {
  it('sources — без перечня разбирать нечего', () => {
    const result = parseConsumerConfig(consumerConfig({ sources: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toContain(
      'missing-field',
    );
  });

  it('sources[].use — без него не сказано, какой пакет поставлен', () => {
    const result = parseConsumerConfig(consumerConfig({ sources: [{}] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].code).toBe('missing-field');
  });

  it('formVersion — НЕобязателен: его пишет дверь, не человек', () => {
    expect(parseConsumerConfig(consumerConfig()).ok).toBe(true);
  });

  it('sources[].version — НЕобязателен: отсутствие значит «не закреплено»', () => {
    const result = parseConsumerConfig(consumerConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0].version).toBeUndefined();
  });

  it('sources[].channel — НЕобязателен: отсутствие значит «канал не назван»', () => {
    const result = parseConsumerConfig(consumerConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0].channel).toBeUndefined();
  });

  it('пустой перечень законен — репозиторий без обвесов это не отказ', () => {
    const result = parseConsumerConfig(consumerConfig({ sources: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources).toEqual([]);
  });

  it('ФАЙЛ НАСТРОЕК НЕОБЯЗАТЕЛЕН ЦЕЛИКОМ — работают дефолты обвеса', () => {
    // Ни файла, ни ключа `baser`, ни половин внутри него: «ничего не выбрано» —
    // рабочее состояние, а не отказ. Ноль вопросов пользователю.
    for (const документ of [
      undefined,
      null,
      {},
      { baser: null },
      { baser: {} },
      { baser: { presets: [] } },
      { services: { tasker: 'http://сосед' } },
    ]) {
      const result = parseSourceConfig(документ);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.settings).toEqual({});
    }
  });
});
