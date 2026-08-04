/**
 * Release-капабилити baser: то, чем держится честность выпуска.
 *
 * Сегодня здесь один инструмент — гейт номеров (`bin/release-guard.mjs`), и
 * наружу отдаётся его суждение и разбор номеров: они пригодны сами по себе —
 * тому, кто считает версии, а не только тому, кто их проверяет.
 */

export { judge } from './guard.mjs';
export {
  factsOf,
  readPackages,
  releasedVersions,
  breakingSince,
  scopeOf,
} from './repo.mjs';
export { parse, compare, isPrerelease, baseOf } from './version.mjs';
export { createTrace } from './trace.mjs';
