/**
 * `@omnifield/baser-cli` — дверь.
 *
 * Раннер, который зовёт станок и кладёт файлы на реальную ФС. Движок работает
 * только с виртуальным деревом и файловой системы не касается вовсе
 * (`packages/baser-materialize/README.md`), форма ничего не читает и ничего не
 * исполняет (`packages/baser-contracts/README.md`) — значит чтение конфига,
 * загрузка резолверов обвеса, подстановка значений и запись на диск живут здесь
 * и больше нигде.
 *
 * Публичная поверхность программная: дверь зовут не только из терминала, но и
 * из гейта, скрипта и — дальше — из пульта. `cli()` поверх `run()` тонкая ровно
 * настолько, чтобы разбор argv не был местом, где принимаются решения.
 */

export { DOOR_SCHEMA_VERSION } from './lib/schema.js';
export type { DoorSchemaVersion } from './lib/schema.js';

export { DoorProblemLog } from './lib/problems.js';
export type {
  DoorProblem,
  DoorProblemCode,
  ProblemCode,
} from './lib/problems.js';

export { exitCodeOf } from './lib/result.js';
export type {
  ConfigReport,
  DoorCommand,
  DoorResult,
  DoorStatus,
  RepoReport,
  SourceConfigReport,
  SourceReport,
  SourceRun,
  WriteReport,
} from './lib/result.js';

export { run } from './lib/run.js';
export type { RunOptions } from './lib/run.js';

export { cli, USAGE } from './lib/cli.js';
export type { CliOutcome, CliResult } from './lib/cli.js';

export { bundle, BUNDLE_SCHEMA_VERSION } from './lib/bundle.js';
export type {
  BundleOptions,
  BundleReport,
  BundleSpan,
  BundleStage,
  BundleStageName,
  BundleStageStatus,
  BundledPackage,
} from './lib/bundle.js';

export { createRepoTree } from './lib/tree.js';
export type { ChangeKind, RepoTree } from './lib/tree.js';

export {
  renderBundle,
  renderCheck,
  renderPack,
  renderText,
} from './lib/report.js';

export {
  readConsumerConfig,
  readRepo,
  serializeConsumerConfig,
} from './lib/repo.js';
export type { ConsumerConfigState, Repo } from './lib/repo.js';

export { locateContentRoot, resolveInstalledPackage } from './lib/installed.js';
export type {
  InstalledPackage,
  InstalledResult,
  SourceLocation,
} from './lib/installed.js';

export { readSourceConfig, renderSourceConfig } from './lib/settings.js';
export type { SourceConfigState } from './lib/settings.js';

export { loadDefaults, resolveValues } from './lib/values.js';
export type {
  DefaultsPort,
  ResolvedValues,
  SettingLink,
  SettingMovement,
} from './lib/values.js';

export { createDoorSource, renderLayout } from './lib/render.js';
export type { RenderedLayout } from './lib/render.js';
