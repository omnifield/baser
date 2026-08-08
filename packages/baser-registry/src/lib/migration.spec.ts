/**
 * ПЕРЕЕЗД НА УРОВЕНЬ ЛОКАЦИИ: постройка со старыми настройками узнаёт об этом
 * ОТКАЗОМ.
 *
 * Худший исход переезда — не отказ и не ошибка, а МОЛЧАНИЕ: человек заполнил
 * порт и апстрим, файл остался в постройке, инструмент его не читает и спокойно
 * уезжает на дефолтах.
 *
 * Мест два, потому что переездов было два: сперва настройки лежали в папке
 * магазина внутри клона, потом в `.omnifield/` клона. Оба уровня оказались
 * неверными — раздача принадлежит контейнеру, а не одному из его клонов.
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

describe('старые настройки в постройке не проглатываются молча', () => {
  for (const place of ['legacySettings', 'legacyShopConfig'] as const) {
    it(`${place}: названный отказ с кодом и обоими путями`, async () => {
      const stale = buildingLayout(building)[place];
      mkdirSync(dirname(stale), { recursive: true });
      writeFileSync(stale, 'port: 4999\n', 'utf8');

      const answer = await status(options());

      expect(answer.outcome).toBe('refused');
      const problem = answer.problems.find(
        (one) => one.code === 'config-in-old-place',
      );
      expect(problem).toBeDefined();
      expect(problem?.at).toBe(stale);
      // Человеку названы оба места: откуда забрать и куда положить.
      expect(problem?.message).toContain(shopLayout(options().environment).config);
    });
  }

  it('настройки из старого файла НЕ применяются втихую', async () => {
    const stale = buildingLayout(building).legacySettings;
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, 'port: 4999\n', 'utf8');

    const answer = await status(options());

    expect(answer.shop.address).not.toContain('4999');
  });

  it('новый файл при этом НЕ рождается: сперва разберитесь со старым', async () => {
    const stale = buildingLayout(building).legacySettings;
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, 'port: 4999\n', 'utf8');

    await status(options());

    expect(existsSync(shopLayout(options().environment).config)).toBe(false);
  });

  it('настройки локации заполнены — старое в постройке больше не мешает', async () => {
    // Перенёс человек значения или начал с чистого листа — его дело. Напоминать
    // про старый файл, когда новый уже заполнен, значит мешать работать.
    const stale = buildingLayout(building).legacySettings;
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, 'port: 4999\n', 'utf8');

    const config = shopLayout(options().environment).config;
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, 'port: 4901\n', 'utf8');

    const answer = await status(options());

    expect(answer.problems).toEqual([]);
    expect(answer.shop.address).toContain('4901');
  });

  it('чистая постройка: отказа нет, магазин ищется на своём уровне', async () => {
    const answer = await status(options());

    expect(answer.problems).toEqual([]);
    expect(answer.location.shopHome).toBe(shopRoot);
    expect(answer.building.root).toBe(building);
  });
});
