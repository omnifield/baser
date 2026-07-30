/**
 * `@omnifield/baser-check` — «обвес подходит посадочному месту».
 *
 * Одно обещание: сказать про каталог распакованного обвеса, встанет он в
 * посадочное место или нет, и если нет — назвать ВСЕ причины сразу, кодом и
 * адресом. Пакет ничего не производит, ничего не пишет и ничего не исполняет.
 *
 * Раз посадочное место наше, то и мультиметр «проверь, что обвес встаёт» — наш
 * (`kb:BASER2-9`): пользователь отвечает за свой кастом, но обязан иметь способ
 * узнать заранее, а не у потребителя.
 *
 * Форму объявления и язык подстановки судят контракты — здесь их зовут, а не
 * переписывают (`packages/baser-check/README.md`). Своё — поставка: то, что
 * объявлено, обязано лежать в пакете и уехать к потребителю.
 *
 * Первое звено цепи `check → pack → выдача` (`tasker:BASER2-29`).
 */

export { checkPackage } from './lib/check.js';
export type { CheckOptions } from './lib/check.js';

export { CHECK_SCHEMA_VERSION } from './lib/report.js';
export type {
  CheckReport,
  CheckSpan,
  CheckStage,
  CheckStageName,
  CheckStageStatus,
} from './lib/report.js';

export type {
  CheckProblem,
  CheckProblemCode,
  SupplyProblemCode,
} from './lib/problems.js';

export { readShippingList, shipsPath } from './lib/shipping.js';
export type { ShippingList } from './lib/shipping.js';
