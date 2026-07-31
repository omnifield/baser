/**
 * Значения настроек: какие бывают и как проверить, что пришло объявленное.
 *
 * Набор типов намеренно короткий. Настройка — это РЕГУЛИРОВКА, которую человек
 * видит и понимает (`kb:BASER2-5`), а не разметка файла: форма, дающая объявить
 * что угодно любой глубины, перестаёт быть формой настроек и становится схемой
 * документа.
 *
 * ── СОСТАВНОЙ ТИП И ЕГО ГЛУБИНА (`tasker:BASER2-116`) ───────────────────────
 *
 * Скаляров и списка строк не хватило по существу, а не по удобству. Рыночная
 * спека девконтейнеров принимает опции фичи ОБЪЕКТОМ:
 *
 *   "features": { "ghcr.io/va-h/devcontainers-features/uv:1": { "version": "0.11" } }
 *
 * Списком строк это не выражается никак, кроме изобретения словаря внутри
 * строки (`ref?version=0.11`), — а изобретать синтаксис внутри значения мы себе
 * запретили. То есть ограничивала форма не нас, а потребителя: через нас нельзя
 * было выразить то, что снаружи выражается штатно.
 *
 * **Выбрана КАРТА, а не список объектов, и это замер рынка, а не вкус.**
 * Закономерность у представителей одна: **карта там, где элемент — АДРЕС**
 * (`features` девконтейнеров, `services` docker compose, `dependencies`
 * package.json), **список там, где элемент — ШАГ** (`steps` GitHub Actions,
 * `repos` pre-commit). У адреса повтор — дефект, и карта ловит его даром, самим
 * форматом; у шага повтор законен, а позиция несёт смысл, и карта его потеряла
 * бы. Наш предмет — адреса: порядок установки фич задаётся не позицией, а
 * `installsAfter`/`overrideFeatureInstallOrder` самой спеки, а `containerEnv` —
 * объект, где порядка не существует.
 *
 * **ГЛУБИНА УПИРАЕТСЯ В ДВА УРОВНЯ, И ЭТО НЕ «ДВУХ ХВАТИТ».** Граница взята
 * замером целевой спеки: опции фичи по спеке девконтейнеров **плоские и
 * скалярные** — типов у опции ровно два, `string` и `boolean`, вложенности
 * внутри опций спека не допускает вовсе. Мы выражаем ровно то, что выражает
 * рынок, и ни на шаг больше.
 *
 * Держится эта граница ПО ПОСТРОЕНИЮ, а не проверкой вглубь: `of` — это СЛОВО
 * из закрытого словаря, а не выражение типа. Написать `map(map(map(…)))`
 * физически нечем: у слова `map` внутри `of` значение одно — «плоская карта
 * скаляров», и третьего этажа в грамматике нет.
 *
 * Снимет эту границу тот, у кого появится представитель рынка с третьим этажом.
 * Пока его нет, снимать нечего: форма не подстраивается под догадку о будущем.
 */

/**
 * Тип значения настройки.
 *
 * `map` приехал формой 3 (`version.ts`) — до неё составного типа не было вовсе.
 */
export type SettingType = 'string' | 'number' | 'boolean' | 'list' | 'map';

/** Список допустимых типов — для сообщений и для проверки объявления. */
export const SETTING_TYPES: readonly SettingType[] = [
  'string',
  'number',
  'boolean',
  'list',
  'map',
];

/**
 * Чем бывают значения карты — слово `of` в объявлении настройки.
 *
 * Словарь ЗАКРЫТ четырьмя словами, и `map` среди них означает «плоская карта
 * скаляров», а не «ещё один уровень чего угодно». Отсюда и потолок глубины: `of`
 * — слово, а не выражение, вложить его само в себя нечем.
 */
export type MapValueType = 'string' | 'number' | 'boolean' | 'map';

export const MAP_VALUE_TYPES: readonly MapValueType[] = [
  'string',
  'number',
  'boolean',
  'map',
];

/** Скаляр — то, чем бывает значение внутри карты. */
export type ScalarValue = string | number | boolean;

/**
 * Плоская карта скаляров — нижний этаж, и он же последний.
 *
 * Разнородность здесь не наша вольность, а форма чужой спеки: опции одной фичи
 * бывают и строкой, и флагом сразу (`{ "version": "3.10", "pip": false }`).
 * Однородной её сделать значило бы не выразить то, ради чего тип и заводился.
 */
export type ScalarMap = Readonly<Record<string, ScalarValue>>;

/** Карта настройки: имя → скаляр либо плоская карта опций. */
export type SettingMap = Readonly<Record<string, ScalarValue | ScalarMap>>;

export type SettingValue = ScalarValue | readonly string[] | SettingMap | null;

/**
 * Тип значения целиком: слово `type` и — у карты — слово `of`.
 *
 * Двумя аргументами это не передаётся честно: у карты тип неполон без `of`, и
 * проверять её «просто как карту» значило бы принять `{a: {b: {c: 1}}}`.
 */
export interface ValueShape {
  readonly type: SettingType;
  /** Чем бывают значения карты. Только у `type: "map"`, и там обязателен. */
  readonly of?: MapValueType;
}

export function isSettingType(value: unknown): value is SettingType {
  return (
    typeof value === 'string' &&
    (SETTING_TYPES as readonly string[]).includes(value)
  );
}

export function isMapValueType(value: unknown): value is MapValueType {
  return (
    typeof value === 'string' &&
    (MAP_VALUE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Подходит ли значение объявленному типу.
 *
 * `null` разрешён только для `string`, `list` и `map` и означает «не задано»:
 * шаблон такой блок не разворачивает. Для `number`/`boolean` «не задано» смысла
 * не имеет — выключенный флаг это `false`, а не отсутствие флага.
 *
 * **У карты `null` и `{}` — РАЗНЫЕ состояния, и путать их нельзя:** `null` —
 * «не задано», блока в артефакте не будет вовсе; `{}` — «задано и пусто», то
 * есть человек сказал «никаких фич», и это сказано значением, а не умолчанием.
 * Ровно так же, как у списка.
 */
export function matchesType(shape: ValueShape, value: unknown): boolean {
  if (value === null) {
    return (
      shape.type === 'string' || shape.type === 'list' || shape.type === 'map'
    );
  }
  switch (shape.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'list':
      return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
      );
    case 'map':
      return isFlatObject(value) && matchesMapValues(shape.of, value);
  }
}

function matchesMapValues(
  of: MapValueType | undefined,
  value: Record<string, unknown>,
): boolean {
  // `of` не объявлен — тип карты неполон, и разбор объявления это уже назвал
  // (`map-value-type`). Принимать значение «на всякий случай» значило бы
  // пропустить его мимо единственной проверки, которая у карты есть.
  if (of === undefined) {
    return false;
  }
  return Object.values(value).every((item) =>
    of === 'map' ? isScalarMap(item) : matchesScalar(of, item),
  );
}

function matchesScalar(of: MapValueType, value: unknown): boolean {
  switch (of) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    // Значением скаляра карта не бывает: сюда `of: "map"` не приходит.
    case 'map':
      return false;
  }
}

/**
 * Нижний этаж: плоская карта разнородных скаляров, и глубже некуда.
 *
 * `null` внутри карты не живёт — ни ключом, ни значением: отсутствие выражается
 * ОТСУТСТВИЕМ КЛЮЧА, а не значением-пустышкой. Иначе «нет опции» и «опция
 * выключена» стали бы одним и тем же, и по конфигу нельзя было бы сказать,
 * подумал ли человек про эту опцию.
 */
function isScalarMap(value: unknown): boolean {
  return (
    isFlatObject(value) &&
    Object.values(value).every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)),
    )
  );
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * ПОДСКАЗКА К ОТКАЗУ «объявлена карта, заполнен список».
 *
 * Названа отдельно от текста отказа по той же причине, что `source.version` и
 * `layout.once` в разборе объявления: человек написал не опечатку, а ровно то,
 * что работало вчера. Сказать ему «ожидалась карта» значит отправить читать
 * доку там, где правка занимает минуту.
 *
 * Случай не гипотетический: два живых потребителя держат `devcontainerFeatures`
 * заполненным СПИСКОМ ссылок, и после перевода настройки на карту отказ увидят
 * оба (`tasker:BASER2-116`). Пример в подсказке берётся из их же строки, а не
 * из абстрактной «ссылки»: свою строку человек узнаёт, чужую разбирает.
 *
 * @returns готовый хвост сообщения либо пустая строка, если подсказывать нечего
 */
export function typeMismatchHint(shape: ValueShape, value: unknown): string {
  if (shape.type !== 'map' || !Array.isArray(value)) {
    return '';
  }

  const sample = value.find((item) => typeof item === 'string') as
    | string
    | undefined;

  if (shape.of === 'map') {
    const key = sample ?? 'ссылка';
    return (
      '. Список стал картой «ключ → опции»: строку ' +
      `"- ${key}" замени на "${key}: {}", а опции пиши под ней с отступом ` +
      '(например "version: \'0.11\'"). Пустые фигурные скобки — это «опций нет», ' +
      'и они обязательны: без них у ключа не будет значения'
    );
  }

  const pair = sample?.includes('=') ? sample.split('=') : null;
  const key = pair ? pair[0] : (sample ?? 'ключ');
  const val = pair ? pair.slice(1).join('=') : 'значение';
  return (
    '. Список стал картой «ключ → значение»: строку ' +
    `"- ${sample ?? 'ключ=значение'}" замени на "${key}: ${val || "''"}"`
  );
}

/**
 * Может ли значение вообще быть значением настройки — БЕЗ объявления.
 *
 * Так смотрит на файл настроек разбор потребителя: обвеса рядом ещё нет, знать
 * объявленный тип неоткуда, и вопрос стоит иначе — бывают ли значения такой
 * ФОРМЫ вообще. Тип с объявленным сверяется потом и в другом месте
 * (`settings.ts`), когда обе половины сошлись.
 *
 * Глубина здесь та же, что и везде: скаляр, список строк или карта, значения
 * которой — скаляры либо плоская карта опций. Третьего этажа нет и тут.
 */
export function isPossibleSettingValue(value: unknown): value is SettingValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string');
  }
  if (!isFlatObject(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) =>
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      isScalarMap(item),
  );
}

/**
 * Тип настройки человеческими словами: у карты он НЕПОЛОН без `of`.
 *
 * Сказать про карту просто «map» значит не сказать главного — чем бывают её
 * значения, а именно на этом отказ и случается.
 */
export function describeShape(shape: ValueShape): string {
  return shape.type === 'map' ? `map «ключ → ${shape.of ?? '?'}»` : shape.type;
}

/** Как значение выглядит в сообщении об отказе. */
export function describeValue(value: unknown): string {
  if (value === undefined) {
    return 'ничего';
  }
  if (Array.isArray(value)) {
    return `список (${value.length})`;
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return `карта (${Object.keys(value as object).length})`;
  }
  return `${typeof value} ${JSON.stringify(value)}`;
}
