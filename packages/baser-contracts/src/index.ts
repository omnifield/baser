/**
 * `@omnifield/baser-contracts` — хвостовик.
 *
 * Форма, которой обвес объявляет себя станку: идентичность источника, раскладка с
 * классом артефакта, настройки с дефолтами, два файла на стороне потребителя и
 * правило «один артефакт — один поставщик». Против неё программируют все зоны
 * (`packages/baser-contracts/README.md`).
 *
 * **Пакет ничего не читает и ничего не исполняет.** Ни файловой системы, ни
 * сети, ни загрузки чужих модулей: JSON подаёт дверь, резолверы зовёт тоже она
 * (порт `ComputeDefault`). Здесь — только форма и её пригодность.
 *
 * Проверки здесь — про **пригодность объявления**, а не про безопасность чужого
 * действия. Движок проверяет свои границы сам, потому что пишет он: инвариант,
 * который держит только соседняя зона, — не инвариант.
 */

export { FORM_VERSION, MIN_FORM_VERSION } from './lib/version.js';
export type { FormVersion } from './lib/version.js';

export { describeProblems, ProblemLog } from './lib/problems.js';
export type {
  FormProblem,
  FormProblemCode,
  FormResult,
} from './lib/problems.js';

export { byBytes, checkPath, PATH_PROBLEM } from './lib/paths.js';
export type { CheckedPath, PathProblem } from './lib/paths.js';

export {
  describeValue,
  isSettingType,
  matchesType,
  SETTING_TYPES,
} from './lib/values.js';
export type { SettingType, SettingValue } from './lib/values.js';

export {
  DECLARATION_BLOCK,
  parseSourceDeclaration,
  readSourceDeclaration,
} from './lib/declaration.js';
export type {
  LayoutEntry,
  PresetSpec,
  ResolverRef,
  SettingSpec,
  SourceDeclaration,
  SourceHead,
} from './lib/declaration.js';

export {
  ARTIFACT_CLASSES,
  DEFAULT_ARTIFACT_CLASS,
  isArtifactClass,
} from './lib/classes.js';
export type { ArtifactClass } from './lib/classes.js';

export {
  CONSUMER_CONFIG_PATH,
  EMPTY_SOURCE_CONFIG,
  parseConsumerConfig,
  parseSourceConfig,
  SOURCE_CONFIG_DIR,
  SOURCE_CONFIG_KEY,
  sourceConfigPath,
} from './lib/config.js';
export type {
  ConsumerConfig,
  ConsumerSourceEntry,
  SourceConfig,
} from './lib/config.js';

export { resolveSettings } from './lib/settings.js';
export type {
  ComputeDefault,
  ResolvedSettings,
  ResolveOptions,
  ResolverContext,
  SettingOrigin,
  SettingResolver,
} from './lib/settings.js';

export { checkTemplate } from './lib/template.js';

export { checkSingleProvider } from './lib/providers.js';
export type {
  ArtifactOwner,
  ArtifactOwners,
  InstalledSource,
} from './lib/providers.js';
