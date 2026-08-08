import { describe, expect, it } from 'vitest';
import { SHOP_DIRECTORY, shopLayout } from './layout.js';

describe('от магазина в локации остаётся одна папка', () => {
  const layout = shopLayout('/локация');

  it('папка лежит в корне локации, рядом с .git', () => {
    expect(layout.home).toBe(`/локация/${SHOP_DIRECTORY}`);
  });

  it('переживает остановку то, что лежит в папке напрямую', () => {
    // Граница, ради которой инструмент существует: контейнер остановился —
    // магазин закрыт, ТОВАР ОСТАЛСЯ. Настройки человека рядом с товаром, и
    // ни то, ни другое не лежит внутри одноразового runtime.
    expect(layout.config).toBe(`${layout.home}/config.yml`);
    expect(layout.storage).toBe(`${layout.home}/storage`);
    expect(layout.config.startsWith(layout.runtime)).toBe(false);
    expect(layout.storage.startsWith(layout.runtime)).toBe(false);
  });

  it('всё одноразовое лежит внутри runtime и только там', () => {
    // Проба стоит здесь затем, чтобы служебный файл нельзя было завести мимо
    // runtime незаметно: чистка одноразового не должна однажды унести товар.
    for (const path of [layout.generatedConfig, layout.claim, layout.log]) {
      expect(path.startsWith(`${layout.runtime}/`)).toBe(true);
    }
  });
});
