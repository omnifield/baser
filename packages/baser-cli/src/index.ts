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

export { exitCodeOf, soleRun } from './lib/result.js';
export type {
  ConfigReport,
  DoorCommand,
  DoorResult,
  DoorStatus,
  RepoReport,
  SourceConfigReport,
  SourceReport,
  SourceRun,
  SupplyReport,
  WriteReport,
} from './lib/result.js';

// ПОСТАВКУ ДОСТАЁТ ДВЕРЬ (`kb:BASER2-22`). Наружу уезжает то же, что и всегда:
// форма ответа (`SupplyOrigin` — на неё ссылается `SupplyReport`), вход
// (`SupplyOverride` — ручка дев-петли в `RunOptions`) и адрес кэша, который
// прогревают конвейер и проба. Само доставание (`takeSupply`) внутреннее — тем
// же правилом, что и остальные механики: наружу ответ, а не то, чем он получен.
export { SUPPLY_CACHE_ENV, supplyCacheRoot } from './lib/supply.js';
export type { SupplyOrigin, SupplyOverride } from './lib/supply.js';

export { run } from './lib/run.js';
export type { RunOptions } from './lib/run.js';

// ПРИВЯЗКА ПОСТАВКИ (`tasker:BASER2-201`). Наружу уезжает механика целиком:
// `add` зовут не только из терминала, но и из гейта, скрипта и — дальше — из
// интерфейса, ровно как `run`. Способность при этом остаётся в движке: здесь
// только раннер, который даёт ей дерево и кладёт объявление на диск.
export { add, addExitCode } from './lib/add.js';
export type { AddOptions, AddResult } from './lib/add.js';

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
  renderAdd,
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

// Резолв пакета ПО ИМЕНИ отсюда ушёл: он живёт одним экземпляром в
// `@omnifield/baser-contracts/locate` (`locatePackage`), и второго имени у него
// нет — реэкспорт был бы вторым именем одного факта (`tasker:BASER2-128`).
export { locateContentRoot } from './lib/installed.js';
export type { SourceLocation } from './lib/installed.js';

export { readSourceConfig, renderSourceConfig } from './lib/settings.js';
export type { SourceConfigState } from './lib/settings.js';

export { loadDefaults, resolveValues } from './lib/values.js';
export type {
  DefaultsPort,
  ResolvedValues,
  SettingLink,
  SettingMovement,
} from './lib/values.js';

// ЦЕНА ДВИЖЕНИЯ — часть ОТВЕТА, значит формы публичные: `SourceRun.derived` и
// `SourceRun.differences` на них ссылаются. Механики (`derivedMoves`,
// `differenceOf`) остаются внутренними по тому же правилу, что и восстановление
// прежнего конца: наружу уезжает ответ, а не то, чем он посчитан.
export type { DerivedMove } from './lib/derived.js';
export type { ArtifactDifference } from './lib/difference.js';

// `SettingMovement.placed` ссылается на эту форму — значит она публичная тоже.
// Механизм восстановления (`recoverPlacedValues`) остаётся внутренним: наружу
// уезжает ОТВЕТ, а не то, чем он посчитан.
export type { PlacedValue } from './lib/previous.js';

export { createDoorSource, renderLayout } from './lib/render.js';
export type { RenderedLayout } from './lib/render.js';
