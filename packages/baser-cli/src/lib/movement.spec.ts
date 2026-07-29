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
  installDevbox,
  soleRun,
  DEVBOX_PACKAGE,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { renderText } from './report.js';
import type { SettingMovement } from './values.js';

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

/** Резолверы, поднявшие версию рантайма: обвес выпустился заново. */
const BUMPED = `
export function repoName(ctx) { return ctx.repo.name; }
export function devboxName(ctx) { return \`\${ctx.repo.name}-devbox\`; }
export function latestStableNode() { return '24'; }
`;

describe('ноль вопросов пользователю', () => {
  it('конфиг без единого заполненного значения даёт ПОЛНЫЙ набор', async () => {
    const box = install();
    const byKey = await movements(box);

    // Ни одна настройка не осталась без значения — вопросов задавать нечего.
    expect(byKey.size).toBe(10);
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
    expect((await movements(box)).get('runtimeVersion')?.value).toBe('22');

    box.updateResolvers(BUMPED);

    const bumped = (await movements(box)).get('runtimeVersion');
    expect(bumped?.value).toBe('24');
    expect(bumped?.ours).toBe(true);
  });

  it('ЗАПОЛНЕННОЕ значение не поднимается — подниматься неоткуда', async () => {
    const box = install({ settings: { runtimeVersion: '20' } });
    expect((await movements(box)).get('runtimeVersion')?.value).toBe('20');

    box.updateResolvers(BUMPED);

    const after = (await movements(box)).get('runtimeVersion');
    // Дефолт под ним уехал на 24, а значение осталось: заполненное бьёт всё.
    expect(after?.value).toBe('20');
    expect(after?.ours).toBe(false);
    expect(after?.chain[0].value).toBe('24');
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
