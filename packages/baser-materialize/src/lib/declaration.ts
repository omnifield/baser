/**
 * Декларация продукта — вход движка.
 *
 * Форма: блок `omnifield` с полями `kind` · `target` · `stack` ·
 * `contentRoot` · `frame[{src,dest}]` (`kb:BASER2-2`).
 *
 * РЕЖИМОВ МАТЕРИАЛИЗАЦИИ В ДЕКЛАРАЦИИ НЕТ. Единственное поведение движка —
 * перегенерация артефакта целиком из шаблона (модель A по `kb:BASER2-1`):
 * `merge` отменён вместе с трёхсторонним мерджем, `seed` перестал быть
 * режимом — файл, рождающийся сразу пользовательским, выражается ФОРКОМ
 * ИСТОЧНИКА, а не пометкой на записи `frame`.
 *
 * Источник декларации — `package.json` опубликованного пакета-потребителя.
 * Вендор-ветка (`plugin.json`) сознательно НЕ поддерживается: это обходной путь
 * потребителя, а не форма канона (`kb:BASER-4` «обходные пути не канонизируются»).
 */

import type { Tree } from '@nx/devkit';
import { DeclarationError } from './errors.js';
import { normalizeRepoPath } from './paths.js';

/** Ключ блока самообъявления в манифесте продукта. */
export const DECLARATION_BLOCK = 'omnifield';

/** Файл, из которого декларация читается по умолчанию. */
export const DEFAULT_DECLARATION_PATH = 'package.json';

/** Единица материализации: один артефакт `dest` из одного шаблона `src`. */
export interface FrameEntry {
  /** Путь внутри `contentRoot` источника. */
  readonly src: string;
  /** Путь артефакта в репозитории потребителя — он же единица владения. */
  readonly dest: string;
}

export interface Declaration {
  /** Что объявляет о себе продукт (напр. `plugin`). Движком не интерпретируется. */
  readonly kind?: string;
  readonly target?: string;
  readonly stack?: string;
  /** Корень содержимого источника, относительно корня дерева. */
  readonly contentRoot: string;
  readonly frame: readonly FrameEntry[];
  /**
   * Поля блока, которые движок не интерпретирует, — сохраняются как есть.
   * Движок валидирует то, чем пользуется, и не изобретает требований сверх
   * контракта (`kb:BASER-4`: фундамент не подстраивается, но и не додумывает).
   */
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface ReadDeclarationOptions {
  /** Манифест с блоком `omnifield`; по умолчанию `package.json` в корне. */
  readonly path?: string;
}

/** Читает и валидирует декларацию продукта из виртуального дерева. */
export function readDeclaration(
  tree: Tree,
  options: ReadDeclarationOptions = {},
): Declaration {
  const path = options.path ?? DEFAULT_DECLARATION_PATH;
  const raw = tree.read(path, 'utf-8');

  if (raw === null) {
    throw new DeclarationError(`${path}: манифест не найден в дереве`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (cause) {
    throw new DeclarationError(`${path}: манифест не разбирается как JSON`, {
      cause,
    });
  }

  if (!isPlainObject(manifest)) {
    throw new DeclarationError(`${path}: ожидался JSON-объект`);
  }

  const block = manifest[DECLARATION_BLOCK];
  if (block === undefined) {
    throw new DeclarationError(
      `${path}: нет блока "${DECLARATION_BLOCK}" — продукт не объявил себя (kb:BASER-5)`,
    );
  }

  return parseDeclaration(block, path);
}

/**
 * Разбирает блок `omnifield` из уже прочитанного значения.
 *
 * @param value содержимое блока
 * @param source адрес источника для сообщений об ошибках
 */
export function parseDeclaration(value: unknown, source: string): Declaration {
  const at = (field: string): string =>
    `${source}: ${DECLARATION_BLOCK}.${field}`;

  if (!isPlainObject(value)) {
    throw new DeclarationError(
      `${source}: ${DECLARATION_BLOCK} — ожидался объект`,
    );
  }

  const { kind, target, stack, contentRoot, frame, ...extra } = value;

  if (typeof contentRoot !== 'string' || contentRoot.trim() === '') {
    throw new DeclarationError(
      `${at('contentRoot')} — ожидалась непустая строка`,
    );
  }
  if (!Array.isArray(frame)) {
    throw new DeclarationError(
      `${at('frame')} — ожидался массив записей {src,dest,mode}`,
    );
  }

  const entries = frame.map((entry, index) =>
    parseFrameEntry(entry, index, at),
  );

  return {
    ...optionalString(kind, at('kind')),
    ...optionalString(target, at('target'), 'target'),
    ...optionalString(stack, at('stack'), 'stack'),
    contentRoot,
    frame: entries,
    extra,
  };
}

function parseFrameEntry(
  entry: unknown,
  index: number,
  at: (field: string) => string,
): FrameEntry {
  if (!isPlainObject(entry)) {
    throw new DeclarationError(
      `${at(`frame[${index}]`)} — ожидался объект {src,dest}`,
    );
  }

  const { src, dest, mode } = entry;

  if (typeof src !== 'string') {
    throw new DeclarationError(
      `${at(`frame[${index}].src`)} — ожидалась строка`,
    );
  }
  if (typeof dest !== 'string') {
    throw new DeclarationError(
      `${at(`frame[${index}].dest`)} — ожидалась строка`,
    );
  }
  // Снятое поле отвергается ВСЛУХ, а не игнорируется: декларация с `mode`
  // объявляет поведение, которого у движка больше нет, и молчаливый разбор
  // оставил бы потребителя в уверенности, что его `merge`/`seed` соблюдается
  // (`kb:BASER2-2`: «затирание не дефект — дефектом было молчание»).
  if (mode !== undefined) {
    throw new DeclarationError(
      `${at(`frame[${index}].mode`)} — режимов материализации больше нет ` +
        `(получено ${JSON.stringify(mode)}): движок перегенерирует артефакт целиком ` +
        'из шаблона. "merge" отменён вместе со сведением версий, "seed" выражается ' +
        'форком источника, а не режимом записи — убери поле',
    );
  }

  return {
    src: normalizeRepoPath(src, at(`frame[${index}].src`)),
    dest: normalizeRepoPath(dest, at(`frame[${index}].dest`)),
  };
}

function optionalString(
  value: unknown,
  field: string,
  key: 'kind' | 'target' | 'stack' = 'kind',
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string') {
    throw new DeclarationError(`${field} — ожидалась строка`);
  }
  return { [key]: value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
