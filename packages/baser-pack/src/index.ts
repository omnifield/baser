/**
 * `@omnifield/baser-pack` — «проверенная деталь, нормализованная и с манифестом
 * выдачи».
 *
 * Одно обещание: превратить каталог обвеса в полезную нагрузку, готовую к
 * ЛЮБОМУ способу доставки, и описать её так, чтобы принимающая сторона могла
 * сказать, что получила, не разбирая содержимое заново.
 *
 * **Подготовка ≠ доставка.** Собрать — всегда одно и то же; вынести можно
 * папкой в руках, в реестр, в локальный том. Поэтому здесь нет ни одного
 * способа доставки: упаковка ничего никуда не отправляет и не публикует
 * (`tasker:BASER2-29`).
 *
 * **Негодное не пакуется.** Первым делом зовётся `baser-check`, и его отказ
 * едет наверх как есть — своего «обвес непригоден» упаковка поверх не пишет
 * (`kb:BASER2-9`).
 *
 * Второе звено цепи `check → pack → выдача`; запускаемую папку из этой нагрузки
 * собирает дверь, потому что вложить себя может только она сама.
 */

export { packPackage } from './lib/pack.js';
export type { PackOptions } from './lib/pack.js';

export { PACK_SCHEMA_VERSION } from './lib/report.js';
export type {
  PackReport,
  PackSpan,
  PackStage,
  PackStageName,
  PackStageStatus,
} from './lib/report.js';

export type {
  BuildProblemCode,
  PackProblem,
  PackProblemCode,
} from './lib/problems.js';

export {
  payloadDigest,
  PAYLOAD_DIR,
  PAYLOAD_MANIFEST_FILE,
  PAYLOAD_SCHEMA_VERSION,
} from './lib/manifest.js';
export type {
  PayloadArtifact,
  PayloadFile,
  PayloadManifest,
  PayloadShipping,
  PayloadVerdict,
} from './lib/manifest.js';
