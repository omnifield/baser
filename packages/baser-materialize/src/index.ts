/**
 * `@omnifield/baser-materialize` — ядро материализации baser.
 *
 * Декларация → план → применение → владение (`kb:BASER2-2`).
 *
 * Единственное поведение движка — **перегенерация артефакта целиком из
 * шаблона** (модель A). Режимов материализации нет; сведения исходной,
 * пользовательской и новой версии файла нет ни под каким флагом; владение
 * продукта выражается форком источника — снаружи движка.
 *
 * **Вход подаётся готовой структурой.** Движок не читает ни манифестов, ни
 * конфигов и не знает, из каких файлов их собрали: настоящая декларация
 * размазана по объявлению обвеса и конфигу потребителя, и склеивает их дверь
 * (`packages/baser-contracts/README.md`). Файловой системы движок не касается
 * вовсе — он работает с виртуальным деревом Nx.
 */

export type {
  Declaration,
  LayoutEntry,
  MaterializationSource,
} from './lib/declaration.js';

export { BaserMaterializeError, DeclarationError } from './lib/errors.js';

export { joinRepoPath, normalizeRepoPath, toRepoPath } from './lib/paths.js';
export type { RepoPath, RepoPathProblem } from './lib/paths.js';

export {
  DEFAULT_SCAN_IGNORE,
  ENGINE_ID,
  JSON_MARKER_KEY,
  UnmarkableContentError,
  markerFormatFor,
  markerText,
  parseMarkerText,
  readOwnership,
  scanOwnership,
} from './lib/ownership.js';
export type {
  MarkerFormat,
  OwnershipRecord,
  ScanFailure,
  ScanOptions,
  ScanResult,
} from './lib/ownership.js';

export { createTreeSource } from './lib/source.js';
export type { CanonSource } from './lib/source.js';

export { computePlan, describePlan, isApplicable } from './lib/plan.js';
export type {
  ConflictDetail,
  ConflictKind,
  MaterializationPlan,
  NoticeDetail,
  PlanConflict,
  PlanNotice,
  PlanNoticeKind,
  PlanOptions,
  PlanReason,
  PlanStatus,
  PlanStep,
  PlanStepKind,
} from './lib/plan.js';

export { OUTPUT_SCHEMA_VERSION } from './lib/schema.js';
export type { OutputSchemaVersion } from './lib/schema.js';

export {
  MaterializationApplyError,
  MaterializationConflictError,
  applyPlan,
} from './lib/apply.js';
export type { ApplyOptions, ApplyReport } from './lib/apply.js';

export { createTrace } from './lib/trace.js';
export type { TraceOptions, TraceRecorder, TraceSpan } from './lib/trace.js';
