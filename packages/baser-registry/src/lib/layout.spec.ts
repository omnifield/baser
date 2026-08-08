import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_SETTINGS_PATH,
  LEGACY_SHOP_DIRECTORY,
  buildingLayout,
  shopLayout,
} from './layout.js';
import { HOME_VARIABLE, SHOP_DIRECTORY, shopHome } from './location.js';

describe('магазин целиком лежит на уровне ЛОКАЦИИ', () => {
  const layout = shopLayout({ [HOME_VARIABLE]: '/участок/магазин' });

  it('склад, настройки и состояние — под одним корнем', () => {
    // Вещь живёт на одном уровне. Раньше процесс и порт принадлежали
    // контейнеру, а склад лежал в клоне, — и товар одной постройки уезжал на
    // склад другой (`tasker:BASER2-254`).
    for (const path of [
      layout.config,
      layout.storage,
      layout.runtime,
      layout.generatedConfig,
      layout.claim,
      layout.log,
    ]) {
      expect(path.startsWith('/участок/магазин/')).toBe(true);
    }
  });

  it('ничего из магазина не лежит внутри постройки', () => {
    // Требование задачи дословно: место не принадлежит ни одной постройке и не
    // попадает ни в один `git status`. Проверяется формой пути, а не обещанием.
    const building = buildingLayout('/участок/постройка');

    for (const path of [layout.config, layout.storage, layout.runtime]) {
      expect(path.startsWith(building.root)).toBe(false);
    }
  });

  it('товар отдельно от состояния запуска: чистка одного не уносит другое', () => {
    expect(layout.storage.startsWith(layout.runtime)).toBe(false);
    for (const path of [layout.generatedConfig, layout.claim, layout.log]) {
      expect(path.startsWith(`${layout.runtime}/`)).toBe(true);
    }
  });
});

describe('место магазина называет локация, а не инструмент', () => {
  it('переменная локации сильнее всего — судьба склада её решение', () => {
    expect(shopHome({ [HOME_VARIABLE]: '/том/магазин' })).toEqual({
      path: '/том/магазин',
      origin: 'variable',
    });
  });

  it('иначе — общее место данных по стандарту рынка', () => {
    expect(shopHome({ XDG_DATA_HOME: '/данные' })).toEqual({
      path: `/данные/${SHOP_DIRECTORY}`,
      origin: 'xdg',
    });
  });

  it('иначе — домашний каталог, и это тоже названо', () => {
    expect(shopHome({})).toEqual({
      path: join(homedir(), '.local', 'share', SHOP_DIRECTORY),
      origin: 'home',
    });
  });

  it('пустое значение переменной не считается выбором', () => {
    // Пустая строка в окружении — частый след «переменная объявлена, но не
    // заполнена». Принять её значило бы положить магазин в корень файловой
    // системы.
    expect(shopHome({ [HOME_VARIABLE]: '   ' }).origin).toBe('home');
  });
});

describe('прежние места названы, чтобы их ЗАМЕТИТЬ', () => {
  it('оба лежат в постройке — оба были неверным уровнем', () => {
    const building = buildingLayout('/участок/постройка');

    expect(building.legacyShopConfig).toBe(
      `/участок/постройка/${LEGACY_SHOP_DIRECTORY}/config.yml`,
    );
    expect(building.legacySettings).toBe(
      `/участок/постройка/${LEGACY_SETTINGS_PATH}`,
    );
  });
});
