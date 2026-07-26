/**
 * ОБЪЯВЛЕНИЕ ОБВЕСА — хвостовик.
 *
 * Живёт в `package.json` пакета-поставщика, блок `baser`. Блок называется по
 * тому, КТО его читает (конвенция `package.json`: `prettier`, `jest`,
 * `packageManager`), а не по тому, чья экосистема: обвесы пишут посторонние
 * (`kb:BASER2-7`), и человек объявляет конфиг для инструмента, а не блок с
 * именем чужой организации.
 *
 * Разбор ничего не читает с диска: JSON подаёт дверь. Здесь только форма.
 */

import { byBytes, checkPath, PATH_PROBLEM, type CheckedPath } from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';
import {
  describeValue,
  isSettingType,
  matchesType,
  SETTING_TYPES,
  type SettingType,
  type SettingValue,
} from './values.js';
import { FORM_VERSION, MIN_FORM_VERSION } from './version.js';

/** Ключ блока самообъявления в `package.json` обвеса. */
export const DECLARATION_BLOCK = 'baser';

/**
 * Ссылка на вычисляемый дефолт: `<файл внутри пакета>#<экспорт>`.
 */
export interface ResolverRef {
  /** Путь к модулю относительно корня пакета обвеса. */
  readonly module: string;
  /** Имя экспорта в этом модуле. */
  readonly member: string;
}

export interface SettingSpec {
  /**
   * Человекочитаемое имя. ОБЯЗАТЕЛЬНО: пользователь имеет дело с настройкой, а
   * не с разметкой файла (`kb:BASER2-5`), — настройку без имени ему не показать.
   */
  readonly title: string;
  readonly description?: string;
  readonly type: SettingType;
  /** Литеральный дефолт. Ровно один из `default` / `defaultFrom`. */
  readonly default?: SettingValue;
  /** Вычисляемый дефолт — функция самого обвеса. */
  readonly defaultFrom?: ResolverRef;
}

export interface PresetSpec {
  readonly title: string;
  /** Ходовое положение регулировок: имя настройки → значение. */
  readonly values: Readonly<Record<string, SettingValue>>;
}

export interface LayoutEntry {
  /** Путь внутри `source.contentRoot` пакета обвеса. */
  readonly src: string;
  /** Путь артефакта в репозитории потребителя — он же единица владения. */
  readonly dest: string;
  /**
   * Подставлять ли значения настроек. Приведено к явному значению при разборе:
   * умолчание живёт здесь, а не в каждом читателе формы.
   */
  readonly render: boolean;
}

/** Идентичность обвеса — то, за что цепляются владение, столкновение и форк. */
export interface SourceHead {
  /** `<поставщик>/<обвес>`. НЕ имя npm-пакета: пакет — доставка, `id` — личность. */
  readonly id: string;
  readonly title: string;
  /** Корень содержимого шаблонов внутри пакета обвеса. */
  readonly contentRoot: string;
}

export interface SourceDeclaration {
  readonly formVersion: number;
  readonly source: SourceHead;
  readonly settings: Readonly<Record<string, SettingSpec>>;
  readonly presets: Readonly<Record<string, PresetSpec>>;
  readonly layout: readonly LayoutEntry[];
}

const BLOCK_FIELDS = new Set([
  'formVersion',
  'source',
  'settings',
  'presets',
  'layout',
]);
const SOURCE_FIELDS = new Set(['id', 'title', 'contentRoot']);
const SETTING_FIELDS = new Set([
  'title',
  'description',
  'type',
  'default',
  'defaultFrom',
]);
const PRESET_FIELDS = new Set(['title', 'values']);
const LAYOUT_FIELDS = new Set(['src', 'dest', 'render']);

/** `<поставщик>/<обвес>`: без верхнего регистра, чтобы `A/b` и `a/b` не разошлись. */
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

/**
 * Достаёт блок `baser` из уже разобранного `package.json` обвеса.
 *
 * @param manifest содержимое `package.json` как значение (не текст)
 * @param at адрес для сообщений, обычно путь к файлу
 */
export function readSourceDeclaration(
  manifest: unknown,
  at = 'package.json',
): FormResult<SourceDeclaration> {
  if (!isPlainObject(manifest)) {
    return refuse('not-an-object', at, 'ожидался JSON-объект манифеста');
  }

  const block = manifest[DECLARATION_BLOCK];
  if (block === undefined) {
    return refuse(
      'missing-field',
      `${at}.${DECLARATION_BLOCK}`,
      `пакет не объявил себя обвесом — нет блока "${DECLARATION_BLOCK}"`,
    );
  }

  return parseSourceDeclaration(block, `${at}.${DECLARATION_BLOCK}`);
}

/** Разбирает содержимое блока `baser`. */
export function parseSourceDeclaration(
  value: unknown,
  at = DECLARATION_BLOCK,
): FormResult<SourceDeclaration> {
  const log = new ProblemLog();

  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект объявления обвеса');
    return { ok: false, problems: log.list() };
  }

  namedUnknownFields(log, value, BLOCK_FIELDS, at);

  const formVersion = parseFormVersion(log, value['formVersion'], at);
  const source = parseSource(log, value['source'], `${at}.source`);
  const settings = parseSettings(log, value['settings'], `${at}.settings`);
  const presets = parsePresets(
    log,
    value['presets'],
    `${at}.presets`,
    settings,
  );
  const layout = parseLayout(log, value['layout'], `${at}.layout`);

  return log.result(() => ({
    formVersion,
    source,
    settings,
    presets,
    layout,
  }));
}

function parseFormVersion(log: ProblemLog, value: unknown, at: string): number {
  const field = `${at}.formVersion`;

  if (value === undefined) {
    log.add(
      'form-version-missing',
      field,
      `обвес не объявил версию формы — добавь "formVersion": ${FORM_VERSION}. ` +
        'Без неё несовместимость формы выяснялась бы по симптомам, а не вслух',
    );
    return FORM_VERSION;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    log.add(
      'form-version-invalid',
      field,
      `ожидалось целое число ≥ 1, получено ${describeValue(value)}`,
    );
    return FORM_VERSION;
  }
  if (value > FORM_VERSION) {
    log.add(
      'form-version-unsupported',
      field,
      `обвес рассчитан на форму ${value}, этот baser понимает по ${FORM_VERSION} — обнови baser`,
    );
    return value;
  }
  if (value < MIN_FORM_VERSION) {
    log.add(
      'form-version-unsupported',
      field,
      `форма ${value} больше не разбирается (самая старая — ${MIN_FORM_VERSION}) — обнови обвес`,
    );
  }
  return value;
}

function parseSource(log: ProblemLog, value: unknown, at: string): SourceHead {
  const blank: SourceHead = { id: '', title: '', contentRoot: '' };

  if (value === undefined) {
    log.add('missing-field', at, 'обвес не назвал себя — нет блока "source"');
    return blank;
  }
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект {id, title, contentRoot}');
    return blank;
  }

  namedUnknownFields(log, value, SOURCE_FIELDS, at);

  const id = requiredString(
    log,
    value['id'],
    `${at}.id`,
    'идентичность обвеса',
  );
  if (id !== '' && !SOURCE_ID.test(id)) {
    log.add(
      'invalid-source-id',
      `${at}.id`,
      `ожидалась идентичность вида "<поставщик>/<обвес>" строчными буквами, получено ${JSON.stringify(id)}. ` +
        'Это не имя npm-пакета: пакет — доставка, id — личность',
    );
  }

  const title = requiredString(
    log,
    value['title'],
    `${at}.title`,
    'человекочитаемое имя обвеса',
  );

  const contentRoot = requiredPath(
    log,
    value['contentRoot'],
    `${at}.contentRoot`,
    'корень содержимого шаблонов внутри пакета',
  );

  return { id, title, contentRoot };
}

function parseSettings(
  log: ProblemLog,
  value: unknown,
  at: string,
): Record<string, SettingSpec> {
  const settings: Record<string, SettingSpec> = {};

  // Обвес без настроек законен: не всякий инструмент имеет регулировки.
  if (value === undefined) {
    return settings;
  }
  if (!isPlainObject(value)) {
    log.add(
      'not-an-object',
      at,
      'ожидался объект «имя настройки → объявление»',
    );
    return settings;
  }

  for (const key of Object.keys(value).sort(byBytes)) {
    const spec = parseSetting(log, value[key], `${at}.${key}`);
    if (spec) {
      settings[key] = spec;
    }
  }
  return settings;
}

function parseSetting(
  log: ProblemLog,
  value: unknown,
  at: string,
): SettingSpec | null {
  if (!isPlainObject(value)) {
    log.add(
      'not-an-object',
      at,
      'ожидался объект {title, type, default|defaultFrom}',
    );
    return null;
  }

  namedUnknownFields(log, value, SETTING_FIELDS, at);

  const title = requiredString(
    log,
    value['title'],
    `${at}.title`,
    'имя настройки для человека',
  );

  if (
    value['description'] !== undefined &&
    typeof value['description'] !== 'string'
  ) {
    log.add(
      'wrong-type',
      `${at}.description`,
      `ожидалась строка, получено ${describeValue(value['description'])}`,
    );
  }

  const rawType = value['type'];
  if (!isSettingType(rawType)) {
    log.add(
      rawType === undefined ? 'missing-field' : 'wrong-type',
      `${at}.type`,
      `ожидался один из типов ${SETTING_TYPES.join(' · ')}, получено ${describeValue(rawType)}`,
    );
    return null;
  }

  const hasDefault = 'default' in value;
  const hasResolver = value['defaultFrom'] !== undefined;

  if (hasDefault && hasResolver) {
    log.add(
      'setting-two-defaults',
      at,
      'объявлены сразу "default" и "defaultFrom" — неизвестно, что из них дефолт; оставь одно',
    );
    return null;
  }
  if (!hasDefault && !hasResolver) {
    log.add(
      'setting-no-default',
      at,
      'у настройки нет дефолта — нужен "default" или "defaultFrom". ' +
        'Настройка без дефолта означает вопрос пользователю, а вопросов у двери не бывает',
    );
    return null;
  }

  if (hasResolver) {
    const ref = parseResolverRef(
      log,
      value['defaultFrom'],
      `${at}.defaultFrom`,
    );
    return ref === null
      ? null
      : {
          title,
          type: rawType,
          defaultFrom: ref,
          ...optionalDescription(value),
        };
  }

  const fallback = value['default'] as SettingValue;
  if (!matchesType(rawType, fallback)) {
    log.add(
      'value-type-mismatch',
      `${at}.default`,
      `настройка объявлена как ${rawType}, дефолт — ${describeValue(fallback)}` +
        (fallback === null
          ? ' (null означает «не задано» и разрешён только для string и list)'
          : ''),
    );
    return null;
  }

  return {
    title,
    type: rawType,
    default: fallback,
    ...optionalDescription(value),
  };
}

function optionalDescription(value: Record<string, unknown>): {
  description?: string;
} {
  return typeof value['description'] === 'string'
    ? { description: value['description'] }
    : {};
}

function parseResolverRef(
  log: ProblemLog,
  value: unknown,
  at: string,
): ResolverRef | null {
  if (typeof value !== 'string') {
    log.add(
      'wrong-type',
      at,
      `ожидалась ссылка "<файл>#<экспорт>", получено ${describeValue(value)}`,
    );
    return null;
  }

  const hash = value.indexOf('#');
  if (hash <= 0 || hash === value.length - 1) {
    log.add(
      'invalid-resolver-ref',
      at,
      `ожидалась ссылка вида "./defaults.js#latestStableNode", получено ${JSON.stringify(value)}`,
    );
    return null;
  }

  const modulePath = checkPath(value.slice(0, hash));
  if (!modulePath.ok) {
    log.add(
      'invalid-resolver-ref',
      at,
      `модуль резолвера: ${PATH_PROBLEM[modulePath.problem]} — резолвер обязан лежать в пакете обвеса`,
    );
    return null;
  }

  const member = value.slice(hash + 1);
  if (!/^[A-Za-z_$][\w$]*$/.test(member)) {
    log.add(
      'invalid-resolver-ref',
      at,
      `имя экспорта ${JSON.stringify(member)} не похоже на идентификатор`,
    );
    return null;
  }

  return { module: modulePath.path, member };
}

function parsePresets(
  log: ProblemLog,
  value: unknown,
  at: string,
  settings: Readonly<Record<string, SettingSpec>>,
): Record<string, PresetSpec> {
  const presets: Record<string, PresetSpec> = {};

  if (value === undefined) {
    return presets;
  }
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект «имя пресета → объявление»');
    return presets;
  }

  for (const name of Object.keys(value).sort(byBytes)) {
    const spec = parsePreset(log, value[name], `${at}.${name}`, settings);
    if (spec) {
      presets[name] = spec;
    }
  }
  return presets;
}

function parsePreset(
  log: ProblemLog,
  value: unknown,
  at: string,
  settings: Readonly<Record<string, SettingSpec>>,
): PresetSpec | null {
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект {title, values}');
    return null;
  }

  namedUnknownFields(log, value, PRESET_FIELDS, at);

  const title = requiredString(
    log,
    value['title'],
    `${at}.title`,
    'имя пресета для человека',
  );

  const rawValues = value['values'];
  if (rawValues === undefined) {
    log.add(
      'missing-field',
      `${at}.values`,
      'пресет — это набор значений настроек; без "values" он ничего не выставляет',
    );
    return null;
  }
  if (!isPlainObject(rawValues)) {
    log.add(
      'not-an-object',
      `${at}.values`,
      'ожидался объект «имя настройки → значение»',
    );
    return null;
  }

  const values: Record<string, SettingValue> = {};
  for (const key of Object.keys(rawValues).sort(byBytes)) {
    const spec = settings[key];
    if (!spec) {
      log.add(
        'unknown-setting',
        `${at}.values.${key}`,
        `пресет выставляет настройку "${key}", которой обвес не объявлял — ` +
          'значение никуда не поедет',
      );
      continue;
    }
    const raw = rawValues[key] as SettingValue;
    if (!matchesType(spec.type, raw)) {
      log.add(
        'value-type-mismatch',
        `${at}.values.${key}`,
        `настройка объявлена как ${spec.type}, пресет даёт ${describeValue(raw)}`,
      );
      continue;
    }
    values[key] = raw;
  }

  return { title, values };
}

function parseLayout(
  log: ProblemLog,
  value: unknown,
  at: string,
): readonly LayoutEntry[] {
  if (value === undefined) {
    log.add(
      'missing-field',
      at,
      'обвес не объявил раскладку — нечего класть в репозиторий потребителя',
    );
    return [];
  }
  if (!Array.isArray(value)) {
    log.add('wrong-type', at, 'ожидался массив записей {src, dest}');
    return [];
  }
  if (value.length === 0) {
    log.add(
      'missing-field',
      at,
      'раскладка пуста — обвес, который ничего не кладёт, поставить нельзя',
    );
    return [];
  }

  const entries: LayoutEntry[] = [];
  const seen = new Map<string, number>();

  value.forEach((raw, index) => {
    const entry = parseLayoutEntry(log, raw, `${at}[${index}]`);
    if (!entry) {
      return;
    }
    const first = seen.get(entry.dest);
    if (first !== undefined) {
      // Внутри ОДНОГО обвеса это тот же инвариант, что и между двумя
      // (`kb:BASER2-6`): артефакт кладётся целиком, поэтому вторая запись не
      // дополняет первую, а тихо её вытесняет — порядком записей.
      log.add(
        'duplicate-dest',
        `${at}[${index}].dest`,
        `обвес уже кладёт "${entry.dest}" записью [${first}] — один артефакт, один поставщик; ` +
          'порядком записей это не разрешается',
      );
      return;
    }
    seen.set(entry.dest, index);
    entries.push(entry);
  });

  return entries;
}

function parseLayoutEntry(
  log: ProblemLog,
  value: unknown,
  at: string,
): LayoutEntry | null {
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект {src, dest}');
    return null;
  }

  namedUnknownFields(log, value, LAYOUT_FIELDS, at);

  const src = requiredPath(
    log,
    value['src'],
    `${at}.src`,
    'путь шаблона внутри contentRoot',
  );
  const dest = requiredPath(
    log,
    value['dest'],
    `${at}.dest`,
    'путь артефакта в репозитории потребителя',
  );

  const rawRender = value['render'];
  if (rawRender !== undefined && typeof rawRender !== 'boolean') {
    log.add(
      'wrong-type',
      `${at}.render`,
      `ожидался true/false, получено ${describeValue(rawRender)}`,
    );
    return null;
  }

  if (src === '' || dest === '') {
    return null;
  }

  return { src, dest, render: rawRender ?? true };
}

function requiredString(
  log: ProblemLog,
  value: unknown,
  at: string,
  what: string,
): string {
  if (value === undefined) {
    log.add('missing-field', at, `не объявлено: ${what}`);
    return '';
  }
  if (typeof value !== 'string') {
    log.add(
      'wrong-type',
      at,
      `ожидалась строка (${what}), получено ${describeValue(value)}`,
    );
    return '';
  }
  if (value.trim() === '') {
    log.add('empty-string', at, `пустая строка вместо: ${what}`);
    return '';
  }
  return value;
}

function requiredPath(
  log: ProblemLog,
  value: unknown,
  at: string,
  what: string,
): string {
  if (value === undefined) {
    log.add('missing-field', at, `не объявлено: ${what}`);
    return '';
  }
  const checked: CheckedPath = checkPath(value);
  if (!checked.ok) {
    log.add('invalid-path', at, `${PATH_PROBLEM[checked.problem]} (${what})`);
    return '';
  }
  return checked.path;
}

/** Лишнее поле называется вслух — см. код `unknown-field`. */
function namedUnknownFields(
  log: ProblemLog,
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  at: string,
): void {
  for (const key of Object.keys(value).sort(byBytes)) {
    if (!known.has(key)) {
      log.add(
        'unknown-field',
        `${at}.${key}`,
        `форма ${FORM_VERSION} такого поля не знает — опечатка либо надежда на поведение, которого нет`,
      );
    }
  }
}

function refuse<T>(
  code: 'not-an-object' | 'missing-field',
  at: string,
  message: string,
): FormResult<T> {
  return { ok: false, problems: [{ code, at, message }] };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
