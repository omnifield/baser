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
 * конфигов и не знает, из каких файлов их собрали: настоящая декларация размазана
 * по трём файлам — объявление обвеса, перечень поставленного и настройки
 * инструмента, — и склеивает их дверь (`declaration.ts`, `README.md`,
 * `packages/baser-contracts/README.md`). Файловой системы движок не касается
 * вовсе — он работает с виртуальным деревом Nx.
 */

export type {
  Declaration,
  LayoutEntry,
  MaterializationSource,
} from './lib/declaration.js';

export {
  ARTIFACT_CLASSES,
  DEFAULT_ARTIFACT_CLASS,
  isArtifactClass,
} from './lib/classes.js';
export type { ArtifactClass } from './lib/classes.js';

export {
  BaserMaterializeError,
  DeclarationError,
  SourceOutsideTreeError,
} from './lib/errors.js';
export type { EngineProblemCode } from './lib/errors.js';

export { joinRepoPath, normalizeRepoPath, toRepoPath } from './lib/paths.js';
export type { RepoPath, RepoPathProblem } from './lib/paths.js';

export {
  EMPTY_MANIFEST,
  MANIFEST_PATH,
  MANIFEST_VERSION,
  ManifestError,
  hashContent,
  readManifest,
  serializeManifest,
} from './lib/manifest.js';
export type { Manifest, ManifestRecord } from './lib/manifest.js';

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
  RecordField,
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
