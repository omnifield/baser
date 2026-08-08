/**
 * Публичная поверхность магазина.
 *
 * Наружу уходит то, чем магазином пользуются программно: раскладка папки,
 * настройки, форма ответа и коды отказов. Ветвиться потребитель обязан по ним, а
 * не по тексту, который мы печатаем (`kb:BASER3-10`).
 */

export {
  LEGACY_SETTINGS_PATH,
  LEGACY_SHOP_DIRECTORY,
  buildingLayout,
  shopLayout,
} from './lib/layout.js';
export type { BuildingLayout, ShopLayout } from './lib/layout.js';

export { HOME_VARIABLE, SHOP_DIRECTORY, shopHome } from './lib/location.js';
export type { ShopHome, ShopHomeOrigin } from './lib/location.js';

export {
  DEFAULT_SETTINGS,
  clientAddress,
  listenAddress,
  logPath,
  readSettings,
  settingsTemplate,
} from './lib/settings.js';
export type { ShopSettings } from './lib/settings.js';

export { locateBuilding } from './lib/locate.js';
export type { BuildingOrigin, LocatedBuilding } from './lib/locate.js';

export { ShopProblemLog } from './lib/problems.js';
export type { ShopProblem, ShopProblemCode } from './lib/problems.js';

export { createTrace } from './lib/trace.js';
export type { TraceRecorder, TraceSpan } from './lib/trace.js';

export { down, publish, status, up } from './lib/shop.js';
export type { PublishOptions, ShopOptions } from './lib/shop.js';

export type { Manager, PublishReport } from './lib/publish.js';

export { exitCodeOf, SCHEMA_VERSION } from './lib/result.js';
export type {
  AccessReport,
  BuildingReport,
  LocationReport,
  ScopeConflict,
  ShopCommand,
  ShopOutcome,
  ShopReport,
  ShopResult,
  ShopState,
  StockReport,
  WriteReport,
} from './lib/result.js';

export { renderText } from './lib/render.js';
export { cli, USAGE } from './lib/cli.js';
export type { CliOutcome } from './lib/cli.js';
