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

import {
  DEFAULT_ARTIFACT_CLASS,
  isArtifactClass,
  ARTIFACT_CLASSES,
  type ArtifactClass,
} from './classes.js';
import {
  byBytes,
  checkPath,
  CONSUMER_CONFIG_PATH,
  PATH_PROBLEM,
  type CheckedPath,
} from './paths.js';
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
  /**
   * Чем станок держит этот артефакт (`classes.ts`). Приведён к явному значению
   * при разборе — как и `render`.
   */
  readonly class: ArtifactClass;
}

/**
 * Идентичность обвеса — то, за что цепляются владение, столкновение и форк.
 *
 * **Версии здесь нет и не будет.** Она уже есть в манифесте пакета, дверь её
 * оттуда читает и показывает; второе место для одного факта — приглашение им
 * разъехаться (`tasker:BASER2-10` §1). Из личности же считается имя файла
 * настроек у потребителя (`config.ts`).
 */
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
const LAYOUT_FIELDS = new Set(['src', 'dest', 'render', 'class']);

/**
 * Снятые и не заведённые поля, у которых есть НАЗВАННАЯ замена.
 *
 * Обычное «форма такого поля не знает» отправляет человека искать опечатку там,
 * где её нет: он написал ровно то, что было в форме 1 или что напрашивается по
 * виду. Поэтому у этих трёх — свой текст, а код остаётся `unknown-field`:
 * ветвление у двери от подсказки не меняется.
 */
const NAMED_ABSENCE: Readonly<Record<string, string>> = {
  'source.version':
    'версия обвеса берётся из манифеста пакета ("version" рядом с "name"), а не объявляется вторым полем: ' +
    'два места для одного факта разъедутся, и разъехались — на приёмке pack',
  'layout.once':
    'класс артефакта — перечисление, а не флаг: объяви "class": "placed-once". ' +
    `Классы формы ${FORM_VERSION}: ${ARTIFACT_CLASSES.join(' · ')}`,
};

/**
 * `<поставщик>/<обвес>` — РОВНО два сегмента, разделённых одним слешем.
 *
 * Каждый сегмент: первый символ — буква или цифра, дальше `a-z 0-9 . _ -`.
 * Верхнего регистра нет, чтобы `A/b` и `a/b` не разошлись как две личности при
 * одном человеческом прочтении.
 *
 * Двух сегментов, а не любого числа: из личности считается ИМЯ ФАЙЛА настроек
 * (`config.ts`), и чем длиннее личность, тем чаще разные личности сходятся в
 * одно имя.
 */
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

/** Грамматика личности человеческими словами — в тексте отказа, а не в доке. */
const SOURCE_ID_GRAMMAR =
  'ровно два сегмента через один слеш; в сегменте — строчные буквы, цифры, точка, ' +
  'подчёркивание и дефис, а первый символ сегмента — буква или цифра';

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

  // Версия формы разбирается ПЕРВОЙ и в одиночку: она говорит, по каким
  // правилам читать остальное. Не сойдясь на ней, разбирать дальше нечего —
  // получится тот самый разбор наполовину, ради отказа от которого версия и
  // заведена. Поэтому здесь не `log.add`, а выход целиком.
  const version = checkFormVersion(value['formVersion'], `${at}.formVersion`);
  if (!version.ok) {
    return version;
  }
  const formVersion = version.value;

  namedUnknownFields(log, value, BLOCK_FIELDS, at);

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

/**
 * Версия формы объявления — отказ целиком, а не пункт в копилке.
 *
 * Обвес чужой формы разбирается не «почти»: поля той формы лежат не там, где их
 * ищет эта, и половина объявления молча не доедет. Поэтому все четыре случая
 * (не назвал · назвал не числом · из будущего · из прошлого) — выход, а не
 * продолжение разбора.
 */
function checkFormVersion(value: unknown, field: string): FormResult<number> {
  const refusal = (
    code:
      | 'form-version-missing'
      | 'form-version-invalid'
      | 'form-version-unsupported',
    message: string,
  ): FormResult<number> => ({
    ok: false,
    problems: [{ code, at: field, message }],
  });

  if (value === undefined) {
    return refusal(
      'form-version-missing',
      `обвес не объявил версию формы — добавь "formVersion": ${FORM_VERSION}. ` +
        'Без неё несовместимость формы выяснялась бы по симптомам, а не вслух',
    );
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return refusal(
      'form-version-invalid',
      `ожидалось целое число ≥ 1, получено ${describeValue(value)}`,
    );
  }
  if (value > FORM_VERSION) {
    return refusal(
      'form-version-unsupported',
      `обвес рассчитан на форму ${value}, этот baser понимает по ${FORM_VERSION} — обнови baser`,
    );
  }
  if (value < MIN_FORM_VERSION) {
    return refusal(
      'form-version-unsupported',
      `обвес написан по форме ${value}, этот baser разбирает с ${MIN_FORM_VERSION} — обнови обвес. ` +
        OLD_FORM_DIFF,
    );
  }
  return { ok: true, value };
}

/**
 * Что именно поменялось между 1 и 2 — в тексте отказа, а не в доке.
 *
 * Автор обвеса читает отказ, а не changelog: сказать «форма старая» и не сказать,
 * чем она старая, значит отправить его гадать.
 */
const OLD_FORM_DIFF =
  'Форма 1 держала настройки и пресеты потребителя в baser.json — форма 2 держит их в ' +
  'файле на инструмент (.omnifield/<поставщик>-<обвес>.yaml), а у записи раскладки ' +
  'появился "class"';

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

  namedUnknownFields(log, value, SOURCE_FIELDS, at, 'source');

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
      `ожидалась идентичность вида "<поставщик>/<обвес>": ${SOURCE_ID_GRAMMAR}. ` +
        `Получено ${JSON.stringify(id)}. ` +
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

  namedUnknownFields(log, value, LAYOUT_FIELDS, at, 'layout');

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

  const rawClass = value['class'];
  if (rawClass !== undefined && !isArtifactClass(rawClass)) {
    log.add(
      'unknown-artifact-class',
      `${at}.class`,
      `ожидался один из классов ${ARTIFACT_CLASSES.join(' · ')}, получено ${describeValue(rawClass)}. ` +
        'Класс говорит, чем станок держит артефакт: "regenerated" перегенерируется целиком, ' +
        '"placed-once" кладётся один раз и дальше не трогается',
    );
    return null;
  }

  if (src === '' || dest === '') {
    return null;
  }

  // Артефакт не имеет права лечь поверх перечня поставленного. Проверка ЗДЕСЬ, а
  // не у движка и не у двери: имя конфига потребителя — константа формы, значит
  // объявление, целящееся в него, непригодно САМО ПО СЕБЕ, независимо от того,
  // чем его прогоняют (`tasker:BASER2-25`). Про паспорт укладки форма так не
  // говорит: его имя — не её слово, и защищает его движок (`dest-is-manifest`).
  if (dest === CONSUMER_CONFIG_PATH) {
    log.add(
      'artifact-over-consumer-config',
      `${at}.dest`,
      `артефакт целится в "${CONSUMER_CONFIG_PATH}" — это перечень поставленного, ` +
        'который ведут дверь и человек. Записью раскладки он не является и в паспорте ' +
        'укладки не числится: владеть им нечем, а перегенерация снесла бы перечень, ' +
        'по которому этот же обвес и нашли. Артефакту нужен другой адрес',
    );
    return null;
  }

  return {
    src,
    dest,
    render: rawRender ?? true,
    class: rawClass ?? DEFAULT_ARTIFACT_CLASS,
  };
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

/**
 * Лишнее поле называется вслух — см. код `unknown-field`.
 *
 * @param kind к какому месту формы относится объект — по нему ищется названная
 *   замена (`NAMED_ABSENCE`) для полей, которые человек пишет не по ошибке
 */
function namedUnknownFields(
  log: ProblemLog,
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  at: string,
  kind?: string,
): void {
  for (const key of Object.keys(value).sort(byBytes)) {
    if (!known.has(key)) {
      log.add(
        'unknown-field',
        `${at}.${key}`,
        NAMED_ABSENCE[`${kind}.${key}`] ??
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
