/**
 * ПРАВКА ПЕРЕЧНЯ ТЕКСТОМ, А НЕ ПЕРЕСБОРКОЙ ФАЙЛА.
 *
 * `baser.json` пишут двое — дверь и человек (`packages/baser-contracts`,
 * `config.ts`). Значит объявление это не служебная запись движка, которой он
 * владеет целиком: у файла есть отступы, порядок ключей и `$schema`, которые
 * поставил человек, а не мы.
 *
 * Разобрать файл в объект и записать его обратно `JSON.stringify` — самый
 * короткий путь, и он же самый вредный: соседние записи вернулись бы на диск
 * ДРУГИМИ БАЙТАМИ, не изменившись по смыслу. Человек увидел бы в `git diff` весь
 * файл вместо одной добавленной строки, а причину искал бы у себя. Поэтому
 * способность правит ровно тот кусок текста, который меняет, и копирует всё
 * остальное дословно.
 *
 * ## Почему свой обход, а не разборщик с позициями
 *
 * `JSON.parse` позиций не отдаёт вовсе, а библиотеки, которые отдают
 * (`jsonc-parser` и родня), — это зависимость В ПОСТАВКУ движка ради операции на
 * шестьдесят строк. Своя зависимость становится зависимостью каждого
 * потребителя, и цена тут явно выше пользы (`shared-policy`, сверено с рынком
 * 2026-08-06).
 *
 * Обход работает ТОЛЬКО по тексту, который уже прошёл `JSON.parse`: он не
 * проверяет форму и не сообщает об ошибках — он ищет границы. Не найдя их, он
 * отвечает `null`, а не догадкой: способность превращает это в названный отказ.
 */

/** Границы куска текста: `[start, end)`. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** Найденный массив: где он открылся, где закрылся и где лежит каждый элемент. */
export interface ArraySpan {
  /** Индекс открывающей `[`. */
  readonly open: number;
  /** Индекс закрывающей `]`. */
  readonly close: number;
  /** Границы элементов — по одному на каждый, в порядке файла. */
  readonly items: readonly TextSpan[];
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
/** Чем кончается число либо `true`/`false`/`null`. */
const SCALAR_END = new Set([',', '}', ']', ' ', '\t', '\n', '\r']);

/** Отступ по умолчанию — тот же, которым движок пишет паспорт укладки. */
const DEFAULT_STEP = '  ';

/**
 * Границы массива, лежащего в поле верхнего уровня.
 *
 * Ищется именно поле верхнего уровня: `sources` внутри чужого вложенного объекта
 * перечнем поставленного не является, и попасть в него значило бы править не тот
 * массив. `null` — поля нет, оно не массив либо текст не разбирается обходом.
 */
export function findTopLevelArray(text: string, field: string): ArraySpan | null {
  const at = findMemberValue(text, field);
  if (at < 0 || text[at] !== '[') {
    return null;
  }
  return readArray(text, at);
}

/**
 * Дописывает элемент в конец массива.
 *
 * Отступ и разделитель берутся у ПОСЛЕДНЕГО элемента: файл, написанный
 * табуляцией или в одну строку, остаётся написанным так же. Массив пуст — отступ
 * считается от строки, на которой массив открылся, плюс шаг файла.
 */
export function appendItem(
  text: string,
  array: ArraySpan,
  item: unknown,
): string {
  const step = indentStep(text);

  if (array.items.length === 0) {
    // Отступ берётся у СТРОКИ, на которой перечень открылся, а не у самой `[`:
    // она стоит после имени поля, и слева от неё не пробелы.
    const outer = leadingIndent(text, array.open);
    const inner = outer + step;
    return (
      text.slice(0, array.open + 1) +
      `\n${inner}${render(item, inner, step)}\n${outer}` +
      text.slice(array.close)
    );
  }

  const last = array.items[array.items.length - 1];

  // Стиль перечня определяется по САМОМУ перечню, а не по файлу: элементы,
  // выписанные в одну строку, дописываются в строку же. Чужой стиль не
  // выправляем заодно с правкой — иначе одна добавленная поставка выглядела бы
  // переписыванием файла, которого никто не просил.
  if (!text.slice(array.open, last.start).includes('\n')) {
    return text.slice(0, last.end) + `,${inline(item)}` + text.slice(last.end);
  }

  const indent = lineIndent(text, last.start);
  return (
    text.slice(0, last.end) +
    `,\n${indent}${render(item, indent, step)}` +
    text.slice(last.end)
  );
}

/** Заменяет элемент целиком; всё вокруг него — те же байты. */
export function replaceItem(
  text: string,
  span: TextSpan,
  item: unknown,
): string {
  const written = text.slice(span.start, span.end).includes('\n')
    ? render(item, lineIndent(text, span.start), indentStep(text))
    : inline(item);

  return text.slice(0, span.start) + written + text.slice(span.end);
}

/**
 * Шаг отступа ФАЙЛА, а не наш.
 *
 * Берётся у первого ключа, стоящего с новой строки: чем написан файл, тем и
 * дописываем. Однострочный файл шага не называет — тогда берётся умолчание, и
 * различить эти случаи неоткуда.
 */
export function indentStep(text: string): string {
  return /\n([ \t]+)"/.exec(text)?.[1] ?? DEFAULT_STEP;
}

/** Значение в одну строку — для перечня, написанного в строку. */
function inline(item: unknown): string {
  return JSON.stringify(item);
}

/** Значение в текст с нужным отступом: первая строка встаёт на место, остальные сдвигаются. */
function render(item: unknown, indent: string, step: string): string {
  return JSON.stringify(item, null, step)
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n');
}

/**
 * Отступ строки, на которой стоит `at`.
 *
 * Перед `at` не только пробелы (элемент стоит не с начала строки) — отступа у
 * него нет, и придумывать его нельзя: получилась бы лесенка там, где человек
 * писал в строку.
 */
function lineIndent(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const prefix = text.slice(lineStart, at);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
}

/**
 * Отступ СТРОКИ, на которой стоит `at`, — что бы на ней ни стояло левее.
 *
 * Нужен там, где место правки заведомо не начинает строку: перечень открывается
 * сразу после имени поля, и строгий `lineIndent` честно ответил бы «отступа
 * нет», хотя у строки он есть.
 */
function leadingIndent(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, at))?.[0] ?? '';
}

/** Где начинается значение поля верхнего уровня; `-1` — поля нет либо обход не прошёл. */
function findMemberValue(text: string, field: string): number {
  let at = skipWhitespace(text, 0);
  if (text[at] !== '{') {
    return -1;
  }
  at = skipWhitespace(text, at + 1);

  while (at < text.length && text[at] !== '}') {
    if (text[at] !== '"') {
      return -1;
    }
    const keyEnd = skipString(text, at);
    if (keyEnd < 0) {
      return -1;
    }
    const key = text.slice(at + 1, keyEnd - 1);

    at = skipWhitespace(text, keyEnd);
    if (text[at] !== ':') {
      return -1;
    }
    at = skipWhitespace(text, at + 1);

    // Ключ сравнивается сырым срезом, поэтому экранированное имя (`"sources"`)
    // сюда не подойдёт — и это правильно: такой файл написан не нами и не
    // человеком, а генератором, и дописывать в него вслепую нечего.
    if (key === field) {
      return at;
    }

    const valueEnd = skipValue(text, at);
    if (valueEnd < 0) {
      return -1;
    }
    at = skipWhitespace(text, valueEnd);
    if (text[at] === ',') {
      at = skipWhitespace(text, at + 1);
    }
  }

  return -1;
}

/** Границы элементов массива, открытого на `open`. */
function readArray(text: string, open: number): ArraySpan | null {
  const items: TextSpan[] = [];
  let at = skipWhitespace(text, open + 1);

  while (at < text.length && text[at] !== ']') {
    const end = skipValue(text, at);
    if (end < 0) {
      return null;
    }
    items.push({ start: at, end });

    at = skipWhitespace(text, end);
    if (text[at] === ',') {
      at = skipWhitespace(text, at + 1);
    } else if (text[at] !== ']') {
      return null;
    }
  }

  return text[at] === ']' ? { open, close: at, items } : null;
}

function skipWhitespace(text: string, at: number): number {
  let index = at;
  while (index < text.length && WHITESPACE.has(text[index])) {
    index += 1;
  }
  return index;
}

/** Индекс сразу за строковым литералом, начинающимся на `at`; `-1` — литерал оборван. */
function skipString(text: string, at: number): number {
  let index = at + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '"') {
      return index + 1;
    }
    index += 1;
  }
  return -1;
}

/** Индекс сразу за значением, начинающимся на `at`; `-1` — значение оборвано. */
function skipValue(text: string, at: number): number {
  const first = text[at];

  if (first === '"') {
    return skipString(text, at);
  }

  if (first === '{' || first === '[') {
    let depth = 0;
    let index = at;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index = skipString(text, index);
        if (index < 0) {
          return -1;
        }
        continue;
      }
      if (char === '{' || char === '[') {
        depth += 1;
      } else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) {
          return index + 1;
        }
      }
      index += 1;
    }
    return -1;
  }

  let index = at;
  while (index < text.length && !SCALAR_END.has(text[index])) {
    index += 1;
  }
  return index === at ? -1 : index;
}
