/**
 * СОСТАВ ПОСТАВКИ — что из каталога реально поедет потребителю.
 *
 * Каталог разработчика и поставка это не одно и то же. `files` в манифесте —
 * белый список npm: объявил его пакет — уедет только перечисленное, и шаблон,
 * забытый в этом списке, пропадёт РОВНО У ПОТРЕБИТЕЛЯ, а у автора будет лежать
 * на месте и проходить все его прогоны. Это тот самый отказ, о котором узнают
 * не у себя, а у чужого человека (`kb:BASER2-9`), — значит ловить его надо до
 * выдачи.
 *
 * ## Разбор здесь НЕ полный, и это названо, а не подразумевается
 *
 * Полная семантика упаковки живёт в npm (`files` + `.npmignore` + встроенные
 * правила), и переписывать её сюда значило бы завести вторую правду, которая
 * разъедется с первой на первом же выпуске. Поэтому разбираются только те
 * формы, в которых ошибиться нельзя:
 *
 * | форма                        | как понимается                              |
 * | ---------------------------- | -------------------------------------------- |
 * | `template`, `defaults.mjs`   | имя без `/` — совпадение на любой глубине    |
 * | `dist/bin`                   | путь с `/` — от корня пакета                 |
 * | каталог                      | поедет со всем поддеревом                    |
 * | `*`, `**`, `?`               | подстановки, `*` не переходит через `/`      |
 *
 * Всё остальное (отрицания `!x`, классы `[a-z]`, группы `{a,b}`) — **не
 * «пропущено», а `undecidable`**: состав такой поставки этот разбор судить не
 * берётся и говорит об этом в ответе. Молчаливое «годен» на неразобранном
 * списке было бы зелёной пробой, которая ничего не сверила.
 */

/** Что известно про состав поставки. */
export type ShippingList =
  /** `files` объявлен и разобран целиком — состав известен. */
  | { readonly kind: 'declared'; readonly patterns: readonly string[] }
  /**
   * `files` не объявлен: npm увезёт всё, что не отсечено `.npmignore` и
   * встроенными правилами. Состав определять нечем — и выдумывать его нельзя.
   */
  | { readonly kind: 'not-declared' }
  /** `files` объявлен, но в нём есть форма, которую этот разбор не судит. */
  | { readonly kind: 'undecidable'; readonly reason: string };

/** Магия, которую разбор понимает. Всё прочее делает список неразбираемым. */
const UNSUPPORTED = /[[\]{}]/;

/**
 * Достаёт состав поставки из уже разобранного манифеста.
 *
 * `main` добавляется к списку: npm увозит точку входа независимо от `files`, и
 * не учесть этого значило бы обвинить пригодный пакет.
 */
export function readShippingList(manifest: unknown): ShippingList {
  if (typeof manifest !== 'object' || manifest === null) {
    return { kind: 'not-declared' };
  }

  const raw = (manifest as Record<string, unknown>)['files'];
  if (raw === undefined) {
    return { kind: 'not-declared' };
  }
  if (!Array.isArray(raw)) {
    return {
      kind: 'undecidable',
      reason: '"files" в манифесте не массив — состав поставки читать нечем',
    };
  }

  const patterns: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return {
        kind: 'undecidable',
        reason: 'в "files" есть запись, которая не строка',
      };
    }
    const pattern = normalize(entry);
    if (pattern === '') {
      continue;
    }
    if (pattern.startsWith('!')) {
      return {
        kind: 'undecidable',
        reason:
          `в "files" есть отрицание (${JSON.stringify(entry)}): ` +
          'что оно вычитает из состава, решает npm, а не эта проверка',
      };
    }
    if (UNSUPPORTED.test(pattern)) {
      return {
        kind: 'undecidable',
        reason:
          `в "files" есть образец с классом или группой (${JSON.stringify(entry)}): ` +
          'такую форму этот разбор не судит',
      };
    }
    patterns.push(pattern);
  }

  const main = (manifest as Record<string, unknown>)['main'];
  if (typeof main === 'string' && normalize(main) !== '') {
    patterns.push(normalize(main));
  }

  return { kind: 'declared', patterns };
}

/**
 * Уедет ли этот путь к потребителю.
 *
 * Путь — репо-относительный внутри пакета, в каноничной форме (`a/b/c`), то
 * есть ровно такой, каким его отдаёт разбор объявления.
 *
 * Совпадение проверяется по КАЖДОМУ префиксу пути: образец, попавший в предка,
 * увозит всё поддерево — иначе `files: ["template"]` не покрыл бы
 * `template/devcontainer.json.ejs`, и проверка обвинила бы пригодный обвес.
 */
export function shipsPath(
  list: { readonly patterns: readonly string[] },
  path: string,
): boolean {
  const segments = path.split('/');

  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join('/');
    const leaf = segments[depth - 1];
    for (const pattern of list.patterns) {
      const anchored = pattern.includes('/');
      if (matches(pattern, anchored ? prefix : leaf)) {
        return true;
      }
    }
  }
  return false;
}

/** `./a/b/` → `a/b`. Разъехавшись в написании, образец и путь разошлись бы. */
function normalize(value: string): string {
  let path = value.trim().replace(/\\/g, '/');
  while (path.startsWith('./')) {
    path = path.slice(2);
  }
  while (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

/** Образец → регулярка. `*` не переходит через `/`, `**` переходит. */
function matches(pattern: string, value: string): boolean {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += char.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`).test(value);
}
