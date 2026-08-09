/**
 * Release-капабилити baser: то, чем держится честность выпуска.
 *
 * Два инструмента, и оба про «что именно уезжает»: гейт номеров
 * (`bin/release-guard.mjs`) — под каким НОМЕРОМ, карта имён
 * (`bin/release-names.mjs`) — под каким ИМЕНЕМ. Наружу отдаётся и суждение, и
 * факты, на которых оно стоит: они пригодны сами по себе — тому, кто считает
 * версии или публикует, а не только тому, кто их проверяет.
 *
 * Конвейеру выпуска отдаётся не этот модуль, а печать бинаря: связывать шаг
 * публикации с внутренним API зоны хуже, чем дать ему данные.
 */

export { judge } from './guard.mjs';
export {
  factsOf,
  readPackages,
  readFormerNames,
  readPublicNames,
  nameCard,
  releases,
  allTags,
  breakingSince,
  scopeOf,
} from './repo.mjs';
export { parse, compare, isPrerelease, baseOf } from './version.mjs';
export { createTrace } from './trace.mjs';
