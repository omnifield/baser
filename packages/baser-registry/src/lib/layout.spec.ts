import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DIRECTORY,
  SETTINGS_FILE,
  SHOP_DIRECTORY,
  shopLayout,
} from './layout.js';

describe('человеческое и машинное лежат в РАЗНЫХ местах', () => {
  const layout = shopLayout('/локация');

  it('настройки — в общей папке локации, рядом с настройками соседей', () => {
    // Человек ходит в одно место, а не ищет по дереву, где что настраивается.
    expect(layout.config).toBe(
      `/локация/${SETTINGS_DIRECTORY}/${SETTINGS_FILE}`,
    );
  });

  it('имя файла — по конвенции соседей, а не «похожее»', () => {
    // omnifield/registry → omnifield-registry.yaml, как omnifield/devbox →
    // omnifield-devbox.yaml. Инструмент отдают другим продуктам, и каждый из
    // них должен искать настройки там же, где искал бы у любого другого.
    expect(SETTINGS_FILE).toBe('omnifield-registry.yaml');
    expect(SETTINGS_DIRECTORY).toBe('.omnifield');
  });

  it('в папке магазина не остаётся НИЧЕГО человеческого', () => {
    // Ради этого переезд и делался: папка целиком машинная, поэтому целиком
    // годится под один игнор. Конфиг, закрытый тем же игнором, человек не
    // увидел бы и не закоммитил.
    for (const path of [
      layout.storage,
      layout.runtime,
      layout.generatedConfig,
      layout.claim,
      layout.log,
    ]) {
      expect(path.startsWith(`${layout.home}/`)).toBe(true);
    }
    expect(layout.config.startsWith(layout.home)).toBe(false);
  });

  it('папка магазина лежит в корне локации', () => {
    expect(layout.home).toBe(`/локация/${SHOP_DIRECTORY}`);
  });

  it('товар переживает остановку, состояние запуска — нет', () => {
    // Граница, ради которой инструмент существует: контейнер остановился —
    // магазин закрыт, ТОВАР ОСТАЛСЯ.
    expect(layout.storage).toBe(`${layout.home}/storage`);
    expect(layout.storage.startsWith(layout.runtime)).toBe(false);
    for (const path of [layout.generatedConfig, layout.claim, layout.log]) {
      expect(path.startsWith(`${layout.runtime}/`)).toBe(true);
    }
  });

  it('прежнее место настроек названо — чтобы его заметить, а не читать', () => {
    expect(layout.legacyConfig).toBe(`${layout.home}/config.yml`);
  });
});
