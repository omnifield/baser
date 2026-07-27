/**
 * МАНИФЕСТ МАТЕРИАЛИЗАЦИИ — служебная запись СБОКУ от артефактов.
 *
 * Раньше владение доказывалось наклейкой внутри самого файла, и это упёрлось
 * дважды сразу (`tasker:BASER2-4`, прогон живого обвеса):
 *   - наклейку некуда поставить в JSONC и в бинаре, а класс файла оказывался
 *     условием владения: не пометили — не наш — не найдём сиротой;
 *   - `render: false` не мог лечь байт в байт, потому что маркер вписывался
 *     всё равно.
 * Плюс корень главного дефекта прошлой модели: наклейка устаревала и врала.
 *
 * Здесь запись живёт снаружи. Из неё выводится всё: наш ли артефакт, из какого
 * шаблона он положен, каким обвесом, и совпадает ли то, что лежит на диске, с
 * тем, что положил движок. **Содержимое артефакта движок не трогает вовсе** —
 * значит любой класс файла берётся во владение, а байт в байт получается сам
 * собой, а не как отдельная поблажка.
 *
 * Манифест — не артефакт: он не объявляется раскладкой, сиротой не бывает и
 * сам себя в себе не учитывает.
 */

import { createHash } from 'node:crypto';
import type { Tree } from '@nx/devkit';
import { DeclarationError } from './errors.js';
import { byBytes } from './paths.js';

/**
 * Где лежит манифест в репозитории потребителя.
 *
 * Рядом с конфигом (`baser.json`) и по идиоме лок-файла: пара «что я хочу» и
 * «что из этого положено машиной». **Файл обязан коммититься** — без него
 * следующий прогон не может доказать владение ни одним артефактом и берёт их
 * как чужие.
 */
export const MANIFEST_PATH = 'baser.lock.json';

/** Версия формы манифеста; читается перед разбором остального. */
export const MANIFEST_VERSION = 1;

/** Что положено по одному `dest`. */
export interface ManifestRecord {
  /** Путь артефакта — ключ записи и единица владения. */
  readonly dest: string;
  /** Шаблон, из которого артефакт положен. */
  readonly src: string;
  /** Идентичность обвеса (`source.id`), которым артефакт положен. */
  readonly source: string;
  /** Хеш содержимого, КАК ЕГО ПОЛОЖИЛ ДВИЖОК. */
  readonly hash: string;
}

/** Разобранный манифест: записи по `dest`. */
export type Manifest = ReadonlyMap<string, ManifestRecord>;

/** Пустой манифест — состояние «мы тут ещё ничего не клали». */
export const EMPTY_MANIFEST: Manifest = new Map();

/** Хеш содержимого артефакта. Алгоритм назван в самой строке, а не подразумевается. */
export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf-8').digest('hex')}`;
}

/**
 * Читает манифест из дерева.
 *
 * Битый манифест — это ОТКАЗ, а не «считаем, что записей нет». Пустой манифест
 * означает «ничего не клали», и молча подменить им нечитаемый файл значит
 * объявить все свои артефакты чужими: прогон превратился бы в отказ по каждому
 * `dest` либо, под подтверждением, в тихую перезапись поверх непонятного
 * состояния.
 */
export function readManifest(tree: Tree, path = MANIFEST_PATH): Manifest {
  if (!tree.exists(path)) {
    return EMPTY_MANIFEST;
  }

  const raw = tree.read(path, 'utf-8');
  if (raw === null) {
    return EMPTY_MANIFEST;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ManifestError(
      `${path}: манифест материализации не разбирается как JSON. ` +
        'Это служебная запись движка: без неё владение артефактами недоказуемо. ' +
        'Восстанови файл из истории или сними его — тогда артефакты станут ' +
        'чужими и потребуют поимённого подтверждения',
      { cause },
    );
  }

  if (!isRecord(parsed)) {
    throw new ManifestError(`${path}: ожидался JSON-объект`);
  }
  if (parsed['version'] !== MANIFEST_VERSION) {
    throw new ManifestError(
      `${path}: версия манифеста ${JSON.stringify(parsed['version'])}, ` +
        `движок понимает ${MANIFEST_VERSION}`,
    );
  }

  const artifacts = parsed['artifacts'];
  if (!Array.isArray(artifacts)) {
    throw new ManifestError(`${path}: artifacts — ожидался массив записей`);
  }

  const records = new Map<string, ManifestRecord>();
  for (const [index, item] of artifacts.entries()) {
    if (!isRecord(item)) {
      throw new ManifestError(`${path}: artifacts[${index}] — ожидался объект`);
    }
    const { dest, src, source, hash } = item;
    if (
      typeof dest !== 'string' ||
      typeof src !== 'string' ||
      typeof source !== 'string' ||
      typeof hash !== 'string'
    ) {
      throw new ManifestError(
        `${path}: artifacts[${index}] — ожидались строки dest, src, source, hash`,
      );
    }
    records.set(dest, { dest, src, source, hash });
  }

  return records;
}

/** Манифест в текст. Порядок байтовый — файл лежит в git и не имеет права плавать. */
export function serializeManifest(manifest: Manifest): string {
  const artifacts = [...manifest.values()]
    .sort((left, right) => byBytes(left.dest, right.dest))
    .map((record) => ({
      dest: record.dest,
      src: record.src,
      source: record.source,
      hash: record.hash,
    }));

  return `${JSON.stringify({ version: MANIFEST_VERSION, artifacts }, null, 2)}\n`;
}

/** Манифест не читается или не той формы. */
export class ManifestError extends DeclarationError {
  override readonly code = 'manifest-unreadable';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
