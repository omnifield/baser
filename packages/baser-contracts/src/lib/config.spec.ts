import { describe, expect, it } from 'vitest';
import { CONSUMER_CONFIG_PATH, parseConsumerConfig } from './config.js';
import { codesOf, consumerConfig } from './form.fixture.js';

function refusals(patch: Record<string, unknown>) {
  const result = parseConsumerConfig(consumerConfig(patch));
  if (result.ok) {
    throw new Error('ожидался отказ, конфиг разобрался');
  }
  return result.problems;
}

describe('конфиг потребителя', () => {
  it('разбирает запись с пресетом и заполненными значениями', () => {
    const result = parseConsumerConfig({
      $schema: 'https://omnifield.dev/baser.json',
      sources: [
        {
          use: '@omnifield/baser-devbox',
          presets: ['omnifield'],
          settings: { runtimeVersion: '24' },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0]).toEqual({
      use: '@omnifield/baser-devbox',
      presets: ['omnifield'],
      settings: { runtimeVersion: '24' },
    });
  });

  it('принимает запись без пресетов и без настроек — дефолты работают сами', () => {
    const result = parseConsumerConfig(consumerConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources[0]).toEqual({
        use: '@omnifield/baser-devbox',
        presets: [],
        settings: {},
      });
    }
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
    // Две записи на один обвес — неизвестно, чьи настройки победят.
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

  it('называет повторённый пресет — порядок пресетов значим', () => {
    const problems = refusals({
      sources: [
        { use: '@omnifield/baser-devbox', presets: ['omnifield', 'omnifield'] },
      ],
    });
    expect(codesOf(problems)).toEqual([
      'duplicate-consumer-entry @ baser.json.sources[0].presets[1]',
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

  it('отказывает значению настройки, которое значением быть не может', () => {
    const problems = refusals({
      sources: [
        {
          use: '@omnifield/baser-devbox',
          settings: { a: { вложенный: 'объект' } },
        },
      ],
    });
    expect(codesOf(problems)).toEqual([
      'wrong-type @ baser.json.sources[0].settings.a',
    ]);
  });

  it('требует сказать, какой пакет поставлен', () => {
    expect(
      codesOf(refusals({ sources: [{ presets: ['omnifield'] }] })),
    ).toEqual(['missing-field @ baser.json.sources[0].use']);
    expect(codesOf(refusals({ sources: [{ use: '  ' }] }))).toEqual([
      'empty-string @ baser.json.sources[0].use',
    ]);
  });
});
