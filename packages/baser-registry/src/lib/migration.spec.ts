/**
 * ПЕРЕЕЗД НА УРОВЕНЬ ЛОКАЦИИ: постройка со старыми настройками узнаёт об этом
 * ОТКАЗОМ.
 *
 * Худший исход переезда — не отказ и не ошибка, а МОЛЧАНИЕ: человек заполнил
 * порт и апстрим, файл остался в постройке, инструмент его не читает и спокойно
 * уезжает на дефолтах.
 *
 * Мест было два, потому что переездов было два: `.baser-registry/config.yml` и
 * `.omnifield/omnifield-registry.yaml`, оба внутри клона. Раздача принадлежит
 * контейнеру, а не одному из его клонов, — и оба уровня оказались неверными.
 *
 * ── ВТОРОЕ МЕСТО С ТЕХ ПОР ЗАНЯТО, И ЭТО МЕНЯЕТ ПРИЗНАК ─────────────────────
 *
 * `.omnifield/omnifield-registry.yaml` теперь держит РЕШЕНИЯ постройки: что она
 * отгружает и куда. Поэтому «файл лежит» больше ничего не значит, а значат
 * КЛЮЧИ: `port` в органе решения — это настройка участка, попавшая в схему
 * производства, и молча её проглотить нельзя ни при каком состоянии конфига
 * локации.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildingLayout, shopLayout } from './layout.js';
import { HOME_VARIABLE } from './location.js';
import { status } from './shop.js';

let building: string;
let shopRoot: string;

/** Магазин пробы живёт в своём месте: чужой ~/.local/share не трогаем. */
function options() {
  return {
    cwd: building,
    environment: { [HOME_VARIABLE]: shopRoot },
    scopes: async () => [],
  };
}

/** Кладёт файл в постройку, заводя каталоги по дороге. */
function place(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

beforeEach(() => {
  building = mkdtempSync(join(tmpdir(), 'baser-registry-building-'));
  shopRoot = mkdtempSync(join(tmpdir(), 'baser-registry-shop-'));
  // Постройка — это клон: пусть у неё будет граница, как в жизни.
  mkdirSync(join(building, '.git'), { recursive: true });
});

afterEach(() => {
  for (const path of [building, shopRoot]) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('первое прежнее место: файл в постройке не проглатывается молча', () => {
  it('названный отказ с кодом и обоими путями', async () => {
    const stale = buildingLayout(building).legacyShopConfig;
    place(stale, 'port: 4999\n');

    const answer = await status(options());

    expect(answer.outcome).toBe('refused');
    const problem = answer.problems.find(
      (one) => one.code === 'config-in-old-place',
    );
    expect(problem).toBeDefined();
    expect(problem?.at).toBe(stale);
    // Человеку названы оба места: откуда забрать и куда положить.
    expect(problem?.message).toContain(
      shopLayout(options().environment).config,
    );
  });

  it('настройки из старого файла НЕ применяются втихую', async () => {
    place(buildingLayout(building).legacyShopConfig, 'port: 4999\n');

    const answer = await status(options());

    expect(answer.shop.address).not.toContain('4999');
  });

  it('новый файл при этом НЕ рождается: сперва разберитесь со старым', async () => {
    place(buildingLayout(building).legacyShopConfig, 'port: 4999\n');

    await status(options());

    expect(existsSync(shopLayout(options().environment).config)).toBe(false);
  });

  it('настройки локации заполнены — старое в постройке больше не мешает', async () => {
    // Перенёс человек значения или начал с чистого листа — его дело. Напоминать
    // про старый файл, когда новый уже заполнен, значит мешать работать.
    place(buildingLayout(building).legacyShopConfig, 'port: 4999\n');

    const config = shopLayout(options().environment).config;
    place(config, 'port: 4901\n');

    const answer = await status(options());

    expect(answer.problems).toEqual([]);
    expect(answer.shop.address).toContain('4901');
  });
});

describe('второе прежнее место занято решениями — старое ловится по КЛЮЧАМ', () => {
  it('настройки раздачи в органе решения — отказ, и назван каждый ключ', async () => {
    const decisions = buildingLayout(building).decisions;
    place(decisions, 'port: 4999\nuplink: http://сосед:4873\n');

    const answer = await status(options());

    expect(answer.outcome).toBe('refused');
    const problem = answer.problems.find(
      (one) => one.code === 'config-in-old-place',
    );
    expect(problem?.at).toBe(decisions);
    expect(problem?.message).toContain('port');
    expect(problem?.message).toContain('uplink');
    expect(problem?.message).toContain(
      shopLayout(options().environment).config,
    );
  });

  it('отказ не зависит от того, заполнены ли настройки локации', async () => {
    // Признак сменился вместе с причиной: раньше файл в старом месте был
    // «настройками, которые не читаются», и заполненный конфиг локации снимал
    // вопрос. Теперь тот же файл — орган решения, и настройка участка внутри
    // него остаётся ошибкой уровня при любом состоянии магазина.
    place(buildingLayout(building).decisions, 'port: 4999\n');
    place(shopLayout(options().environment).config, 'port: 4901\n');

    const answer = await status(options());

    expect(answer.outcome).toBe('refused');
    expect(answer.problems.map((one) => one.code)).toContain(
      'config-in-old-place',
    );
  });

  it('ключ обвесной формы `baser` — тот же отказ: файл родила дверь', async () => {
    place(buildingLayout(building).decisions, 'baser:\n  settings:\n    port: 4999\n');

    const answer = await status(options());

    expect(answer.problems.map((one) => one.code)).toContain(
      'config-in-old-place',
    );
  });

  it('решения в том же файле читаются как решения, а не как переезд', async () => {
    place(
      buildingLayout(building).decisions,
      'shop: true\nbatch:\n  - packages/штука\n',
    );

    const answer = await status(options());

    expect(answer.problems).toEqual([]);
    expect(answer.building.decisions?.batch).toEqual(['packages/штука']);
  });

  it('чистая постройка: отказа нет, решений нет, магазин ищется на своём уровне', async () => {
    const answer = await status(options());

    expect(answer.problems).toEqual([]);
    expect(answer.location.shopHome).toBe(shopRoot);
    expect(answer.building.root).toBe(building);
    // Ничего не объявлено — это «не продаём», а не «не настроено».
    expect(answer.building.decisions).toBeNull();
  });
});
