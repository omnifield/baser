/**
 * `@omnifield/baser-materialize` — ядро материализации baser.
 *
 * Реализует контракт `kb:BASER-5`: декларация → план → применение → владение.
 * Режимы (`exact` · `merge` · `seed`) реализует зона `@omnifield/baser-modes`
 * против интерфейса стратегии, опубликованного здесь (`./lib/strategy.js`).
 */

export {
  DECLARATION_BLOCK,
  DEFAULT_DECLARATION_PATH,
  MATERIALIZE_MODES,
  isMaterializeMode,
  parseDeclaration,
  readDeclaration,
} from './lib/declaration.js';
export type {
  Declaration,
  FrameEntry,
  MaterializeMode,
  ReadDeclarationOptions,
} from './lib/declaration.js';

export {
  BaserMaterializeError,
  DeclarationError,
  StrategyRegistryError,
} from './lib/errors.js';

export { joinRepoPath, normalizeRepoPath } from './lib/paths.js';

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
  OwnershipClass,
  OwnershipRecord,
  ScanOptions,
} from './lib/ownership.js';

export { EMPTY_BASELINE, createTreeSource } from './lib/source.js';
export type { CanonBaseline, CanonSource } from './lib/source.js';

export { createStrategyRegistry, toStrategyRegistry } from './lib/strategy.js';
export type {
  MaterializationStrategy,
  StrategyDecision,
  StrategyInput,
  StrategyRegistry,
} from './lib/strategy.js';

export { computePlan, describePlan } from './lib/plan.js';
export type {
  ConflictKind,
  MaterializationPlan,
  PlanConflict,
  PlanOptions,
  PlanReason,
  PlanStep,
  PlanStepKind,
} from './lib/plan.js';

export {
  MaterializationApplyError,
  MaterializationConflictError,
  applyPlan,
} from './lib/apply.js';
export type { ApplyOptions, ApplyReport } from './lib/apply.js';

export { createTrace } from './lib/trace.js';
export type { TraceOptions, TraceRecorder, TraceSpan } from './lib/trace.js';
