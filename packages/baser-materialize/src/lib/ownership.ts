/**
 * Модель владения.
 *
 * Единица владения — файл `dest` (`kb:BASER-5`; осознанное упрощение против
 * пофайлового `managedFields` в Kubernetes SSA).
 *
 * Принадлежность НЕ хранится реестром: реестр рассинхронизируется сам и назван
 * анти-паттерном (`kb:BASER-3`). Она ВЫВОДИТСЯ ИЗ СОДЕРЖИМОГО — по маркеру,
 * который движок ставит в артефакт (паттерн projen). Из этого же маркера
 * выводятся сироты: файл с нашим маркером, которого больше нет в декларации,
 * потерял объявление.
 *
 * Гача из канона: сама магическая строка не должна лежать в исходниках целиком,
 * иначе исходник опознается как «свой» и будет снят как сирота. Поэтому магия
 * собирается на рантайме.
 */

import type { Tree } from '@nx/devkit';
import type { MaterializeMode } from './declaration.js';
import { isMaterializeMode } from './declaration.js';
import { joinRepoPath } from './paths.js';

/**
 * Класс владения `dest`. Объявляется стратегией режима, а не выводится
 * движком: движок лишь ЗАЩИЩАЕТ инвариант, кто бы ни был владельцем.
 */
export type OwnershipClass = 'engine' | 'shared' | 'product';

/** Запись о владении, вычитанная из артефакта. */
export interface OwnershipRecord {
  /** Запись `frame.src`, из которой артефакт материализован. */
  readonly src: string;
  readonly mode: MaterializeMode;
  readonly own: OwnershipClass;
  /**
   * ВЕРСИЯ КАНОНА, из которой артефакт материализован (`kb:BASER-5`, «база
   * трёхстороннего мерджа»). Это единственное состояние, которое движок хранит,
   * и хранит он его В САМОМ АРТЕФАКТЕ: отдельный файл состояния был бы тем
   * хранимым реестром, который канон называет анти-паттерном.
   *
   * По ней раннер восстанавливает базу мерджа через порт `CanonBaseline`
   * (`source.ts`). `undefined` — версия неизвестна: источник её не назвал либо
   * артефакт помечен движком более старой версии.
   */
  readonly version?: string;
}

/** Идентификатор движка в маркере. Собирается, а не пишется литералом. */
export const ENGINE_ID = ['@omnifield', 'baser-materialize'].join('/');

const MARKER_MAGIC = ['~~', 'Generated', 'by', ENGINE_ID, '~~'].join(' ');
const MARKER_HINT = 'ручные правки не сохраняются — правь декларацию';

/** Ключ-комментарий, которым помечается JSON (соглашение npm о ключе `//`). */
export const JSON_MARKER_KEY = '//';

/** Текст маркера: магия + человекочитаемая подсказка + машинная полезная нагрузка. */
export function markerText(record: OwnershipRecord): string {
  const payload = JSON.stringify({
    src: record.src,
    mode: record.mode,
    own: record.own,
    ...(record.version === undefined ? {} : { version: record.version }),
  });
  return `${MARKER_MAGIC} ${MARKER_HINT} ~~ ${payload}`;
}

/** Разбирает строку маркера обратно в запись о владении. */
export function parseMarkerText(line: string): OwnershipRecord | null {
  const magicAt = line.indexOf(MARKER_MAGIC);
  if (magicAt < 0) {
    return null;
  }

  const from = line.indexOf('{', magicAt);
  const to = line.lastIndexOf('}');
  if (from < 0 || to < from) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(line.slice(from, to + 1));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { src, mode, own, version } = payload as Record<string, unknown>;
  if (
    typeof src !== 'string' ||
    !isMaterializeMode(mode) ||
    !isOwnershipClass(own)
  ) {
    return null;
  }

  // Версия — необязательная часть нагрузки: маркер без неё остаётся валидным
  // (артефакт материализован источником, который версию не назвал).
  return {
    src,
    mode,
    own,
    ...(typeof version === 'string' ? { version } : {}),
  };
}

function isOwnershipClass(value: unknown): value is OwnershipClass {
  return value === 'engine' || value === 'shared' || value === 'product';
}

/**
 * Способ поставить/прочитать/снять маркер для конкретного класса файлов.
 * Класс файла определяет механизм — тот же принцип, что и у `frame[].mode`
 * (`kb:ADR-22`).
 */
export interface MarkerFormat {
  /** Возвращает содержимое с маркером. Бросает, если формат не позволяет. */
  stamp(body: string, record: OwnershipRecord): string;
  /** Читает маркер из содержимого; `null` — маркера нет. */
  parse(content: string): OwnershipRecord | null;
  /** Снимает маркер, возвращая «тело» артефакта. */
  strip(content: string): string;
}

/** Формат не может нести маркер (не тот синтаксис / не тот корень JSON). */
export class UnmarkableContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnmarkableContentError';
  }
}

/** Строки-прологи, перед которыми маркер ставить нельзя. */
const PROLOGUE = /^(#!|<\?xml|<!doctype)/i;

function commentFormat(wrap: (marker: string) => string): MarkerFormat {
  const isMarkerLine = (line: string): boolean => line.includes(MARKER_MAGIC);

  return {
    stamp(body, record) {
      const marker = wrap(markerText(record));
      const newline = body.indexOf('\n');
      const head = newline < 0 ? body : body.slice(0, newline);

      if (PROLOGUE.test(head)) {
        const rest = newline < 0 ? '' : body.slice(newline + 1);
        return `${head}\n${marker}\n${rest}`;
      }
      return `${marker}\n${body}`;
    },
    parse(content) {
      const line = content.split('\n', 2).find(isMarkerLine);
      return line === undefined ? null : parseMarkerText(line);
    },
    strip(content) {
      const lines = content.split('\n');
      const index = lines.slice(0, 2).findIndex(isMarkerLine);
      if (index < 0) {
        return content;
      }
      lines.splice(index, 1);
      return lines.join('\n');
    },
  };
}

const jsonFormat: MarkerFormat = {
  stamp(body, record) {
    const parsed = parseJson(body);
    if (
      parsed === undefined ||
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new UnmarkableContentError(
        'JSON-артефакт может нести маркер владения только с объектом в корне',
      );
    }
    const body_ = parsed as Record<string, unknown>;
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body_)) {
      if (key !== JSON_MARKER_KEY) {
        rest[key] = value;
      }
    }
    return `${JSON.stringify({ [JSON_MARKER_KEY]: markerText(record), ...rest }, null, 2)}\n`;
  },
  parse(content) {
    const parsed = parseJson(content);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const marker = (parsed as Record<string, unknown>)[JSON_MARKER_KEY];
    return typeof marker === 'string' ? parseMarkerText(marker) : null;
  },
  strip(content) {
    const parsed = parseJson(content);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return content;
    }
    const { [JSON_MARKER_KEY]: dropped, ...rest } = parsed as Record<
      string,
      unknown
    >;
    return dropped === undefined
      ? content
      : `${JSON.stringify(rest, null, 2)}\n`;
  },
};

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

const HASH_COMMENT = commentFormat((marker) => `# ${marker}`);
const SLASH_COMMENT = commentFormat((marker) => `// ${marker}`);
const XML_COMMENT = commentFormat((marker) => `<!-- ${marker} -->`);

const BY_EXTENSION = new Map<string, MarkerFormat>([
  ['.yml', HASH_COMMENT],
  ['.yaml', HASH_COMMENT],
  ['.toml', HASH_COMMENT],
  ['.sh', HASH_COMMENT],
  ['.bash', HASH_COMMENT],
  ['.env', HASH_COMMENT],
  ['.conf', HASH_COMMENT],
  ['.properties', HASH_COMMENT],
  ['.ts', SLASH_COMMENT],
  ['.tsx', SLASH_COMMENT],
  ['.mts', SLASH_COMMENT],
  ['.cts', SLASH_COMMENT],
  ['.js', SLASH_COMMENT],
  ['.mjs', SLASH_COMMENT],
  ['.cjs', SLASH_COMMENT],
  ['.jsx', SLASH_COMMENT],
  ['.css', SLASH_COMMENT],
  ['.scss', SLASH_COMMENT],
  ['.jsonc', SLASH_COMMENT],
  ['.json5', SLASH_COMMENT],
  ['.md', XML_COMMENT],
  ['.html', XML_COMMENT],
  ['.xml', XML_COMMENT],
  ['.svg', XML_COMMENT],
  ['.json', jsonFormat],
]);

const BY_BASENAME = new Map<string, MarkerFormat>([
  ['Dockerfile', HASH_COMMENT],
  ['Makefile', HASH_COMMENT],
  ['.gitignore', HASH_COMMENT],
  ['.gitattributes', HASH_COMMENT],
  ['.dockerignore', HASH_COMMENT],
  ['.editorconfig', HASH_COMMENT],
  ['.npmrc', HASH_COMMENT],
  ['.prettierignore', HASH_COMMENT],
]);

/**
 * Формат маркера для `dest`; `null` — класс файла маркер нести не может.
 *
 * Ограничение названо честно (`kb:BASER-3`, «переносим принципы, а не
 * реализацию»): для неразмечаемых классов движок не может ДОКАЗАТЬ владение,
 * поэтому отказывается брать файл во владение, а не берёт его молча.
 */
export function markerFormatFor(dest: string): MarkerFormat | null {
  const basename = dest.slice(dest.lastIndexOf('/') + 1);
  const byName = BY_BASENAME.get(basename);
  if (byName) {
    return byName;
  }

  const dot = basename.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  return BY_EXTENSION.get(basename.slice(dot).toLowerCase()) ?? null;
}

/** Читает запись о владении артефактом из дерева. */
export function readOwnership(
  tree: Tree,
  dest: string,
): OwnershipRecord | null {
  const format = markerFormatFor(dest);
  if (format === null || !tree.exists(dest)) {
    return null;
  }
  const content = tree.read(dest, 'utf-8');
  return content === null ? null : format.parse(content);
}

/** Каталоги, которые не сканируются на владение (не артефакты потребителя). */
export const DEFAULT_SCAN_IGNORE: readonly string[] = [
  'node_modules',
  '.git',
  '.nx',
  'dist',
  'build',
  'coverage',
  'out-tsc',
  'tmp',
];

export interface ScanOptions {
  /** Каталоги, с которых начинается скан; по умолчанию — корень дерева. */
  readonly roots?: readonly string[];
  /** Имена каталогов, которые скан пропускает. */
  readonly ignore?: readonly string[];
}

/**
 * Сканирует дерево и собирает всё, чем движок владеет по маркеру.
 *
 * Цена паттерна названа в каноне: это проход по дереву на каждый прогон
 * (корректность↑, скорость↓). Скан ограничен классами файлов, которые ВООБЩЕ
 * могут нести маркер, и трейсится — см. `trace.ts`.
 */
export function scanOwnership(
  tree: Tree,
  options: ScanOptions = {},
): Map<string, OwnershipRecord> {
  const ignore = new Set(options.ignore ?? DEFAULT_SCAN_IGNORE);
  const owned = new Map<string, OwnershipRecord>();
  const queue: string[] = [...(options.roots ?? [''])];

  while (queue.length > 0) {
    const dir = queue.pop() as string;
    for (const child of tree.children(dir)) {
      if (ignore.has(child)) {
        continue;
      }
      const path = joinRepoPath(dir, child);
      if (tree.isFile(path)) {
        const record = readOwnership(tree, path);
        if (record !== null) {
          owned.set(path, record);
        }
      } else {
        queue.push(path);
      }
    }
  }

  return owned;
}
