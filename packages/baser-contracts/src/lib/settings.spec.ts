import { describe, expect, it } from 'vitest';
import { parseConsumerConfig, type ConsumerSourceEntry } from './config.js';
import {
  parseSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import { resolveSettings, type ComputeDefault } from './settings.js';

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
  },
  presets: {
    omnifield: {
      title: 'Раскладка omnifield',
      values: { network: 'omnifield-gateway', installAssistant: true },
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

function entry(patch: Record<string, unknown> = {}): ConsumerSourceEntry {
  const parsed = parseConsumerConfig({
    sources: [{ use: '@omnifield/baser-devbox', ...patch }],
  });
  if (!parsed.ok) {
    throw new Error(`заготовка непригодна: ${JSON.stringify(parsed.problems)}`);
  }
  return parsed.value.sources[0];
}

/** Дверь-заглушка: резолвер синхронный и знает только локальный контекст. */
const computeDefault: ComputeDefault = (ref) =>
  ref.member === 'devboxName' ? 'baser-devbox' : '';

function resolve(
  patch: Record<string, unknown> = {},
  compute = computeDefault,
) {
  return resolveSettings(declaration(), entry(patch), {
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
      entry({ presets: ['first', 'second'] }),
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
      'unknown-setting @ omnifield/devbox.settings.runtimeVersion_',
    ]);
    expect(result.problems[0].message).toContain('никуда не поедет');
    expect(result.problems[0].message).toContain('runtimeVersion');
  });

  it('называет пресет, которого у обвеса нет', () => {
    const result = resolve({ presets: ['омнифилд'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'unknown-preset @ omnifield/devbox.presets[0]',
    ]);
    expect(result.problems[0].message).toContain('есть: omnifield');
  });

  it('сверяет заполненное значение с объявленным типом', () => {
    const result = resolve({ settings: { installAssistant: 'да' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'value-type-mismatch @ omnifield/devbox.settings.installAssistant',
    ]);
  });

  describe('вычисляемый дефолт', () => {
    it('отказывает, если звать резолверы некому', () => {
      const result = resolveSettings(declaration(), entry());
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
  });
});
