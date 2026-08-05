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
import type { Tree } from './tree.js';
import type { ArtifactClass } from './classes.js';
import { ARTIFACT_CLASSES, isArtifactClass } from './classes.js';
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

/**
 * Версия формы манифеста; читается перед разбором остального.
 *
 * **2** — у записи появились `class` и `version`, а `hash` стал необязательным
 * (`tasker:BASER2-51`, `tasker:BASER2-52`). Форма 1 несовместима не по
 * отсутствию полей, а по невозможности их досочинить: класс у записи формы 1
 * действительно был бы `regenerated`, а вот версия обвеса, которым файл положен,
 * не известна НИКОМУ — подставить туда сегодняшнюю значило бы записать в паспорт
 * укладки неправду и на ней же строить «между твоей версией и новой было
 * ломающее изменение». Поэтому здесь отказ, а не миграция.
 */
export const MANIFEST_VERSION = 2;

/** Что положено по одному `dest`. */
export interface ManifestRecord {
  /** Путь артефакта — ключ записи и единица владения. */
  readonly dest: string;
  /** Шаблон, из которого артефакт положен. */
  readonly src: string;
  /** Идентичность обвеса (`source.id`), которым артефакт положен. */
  readonly source: string;
  /**
   * Версия обвеса, которой артефакт положен (`tasker:BASER2-52`).
   *
   * `null` — источник версии не назвал. Значение НАЗВАННОЕ, а не пропущенное:
   * ключ в файле стоит и говорит «неизвестно», тогда как отсутствие ключа
   * читалось бы как «форма такого не знает».
   */
  readonly version: string | null;
  /** Чем станок держит артефакт (`classes.ts`). */
  readonly class: ArtifactClass;
  /**
   * Хеш содержимого, КАК ЕГО ПОЛОЖИЛ ДВИЖОК.
   *
   * **Отсутствует у `placed-once`, и это не пропуск.** Такой артефакт движок с
   * шаблоном не сверяет никогда, а записанный и никогда не сравниваемый хеш —
   * половина имитации: он выглядел бы доказательством, которым не является.
   */
  readonly hash?: string;
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
        `движок понимает ${MANIFEST_VERSION}` +
        (parsed['version'] === 1 ? `. ${OLD_MANIFEST_DIFF}` : ''),
    );
  }

  const artifacts = parsed['artifacts'];
  if (!Array.isArray(artifacts)) {
    throw new ManifestError(`${path}: artifacts — ожидался массив записей`);
  }

  const records = new Map<string, ManifestRecord>();
  for (const [index, item] of artifacts.entries()) {
    const record = readRecord(item, `${path}: artifacts[${index}]`);
    records.set(record.dest, record);
  }

  return records;
}

/**
 * Одна запись паспорта укладки.
 *
 * Разбор строгий во ВСЕ стороны: недостающее поле — отказ, и лишний хеш у
 * `placed-once` — тоже отказ. Второе важнее первого: движок такой хеш не пишет
 * никогда, значит запись с ним пришла не от движка, а сверять его всё равно
 * некому — он молча изображал бы доказательство владения содержимым, которого у
 * этого класса нет по построению.
 */
function readRecord(item: unknown, at: string): ManifestRecord {
  if (!isRecord(item)) {
    throw new ManifestError(`${at} — ожидался объект`);
  }

  const { dest, src, source, version, hash } = item;
  if (
    typeof dest !== 'string' ||
    typeof src !== 'string' ||
    typeof source !== 'string'
  ) {
    throw new ManifestError(`${at} — ожидались строки dest, src, source`);
  }

  if (version !== null && typeof version !== 'string') {
    throw new ManifestError(
      `${at} — version: ожидалась строка с версией обвеса либо null, ` +
        'если версия не была названа; пропуск поля значил бы форму другой версии',
    );
  }

  const artifactClass = item['class'];
  if (!isArtifactClass(artifactClass)) {
    throw new ManifestError(
      `${at} — class: ожидался один из классов ${ARTIFACT_CLASSES.join(' · ')}, ` +
        `получено ${JSON.stringify(artifactClass)}. Без класса запись не говорит, ` +
        'чем станок держит артефакт, и снятие объявления решалось бы наугад',
    );
  }

  if (artifactClass === 'placed-once') {
    if (hash !== undefined) {
      throw new ManifestError(
        `${at} — у артефакта класса "placed-once" записан хеш, которого движок ` +
          'не пишет вовсе: он никогда не сравнивается и выглядел бы доказательством, ' +
          'которым не является',
      );
    }
    return { dest, src, source, version, class: artifactClass };
  }

  if (typeof hash !== 'string') {
    throw new ManifestError(
      `${at} — hash: ожидалась строка с хешем положенного содержимого`,
    );
  }
  return { dest, src, source, version, class: artifactClass, hash };
}

/** Манифест в текст. Порядок байтовый — файл лежит в git и не имеет права плавать. */
export function serializeManifest(manifest: Manifest): string {
  const artifacts = [...manifest.values()]
    .sort((left, right) => byBytes(left.dest, right.dest))
    .map((record) => ({
      dest: record.dest,
      src: record.src,
      source: record.source,
      version: record.version,
      class: record.class,
      // Ключ `hash` у `placed-once` не пишется ВОВСЕ — не пустой строкой и не
      // `null`: отсутствие сравнения выражается отсутствием поля.
      ...(record.hash === undefined ? {} : { hash: record.hash }),
    }));

  return `${JSON.stringify({ version: MANIFEST_VERSION, artifacts }, null, 2)}\n`;
}

/**
 * Чем форма 2 отличается от формы 1 — в тексте отказа, а не в доке.
 *
 * Потребитель читает отказ, а не changelog: сказать «версия не та» и не сказать,
 * чем не та, значит отправить его гадать. Продукт не выпущен, живых манифестов
 * формы 1 за пределами репозитория нет — поэтому здесь названный отказ, а не
 * механизм миграций (его в baser не будет вовсе, `tasker:BASER2-51`).
 */
const OLD_MANIFEST_DIFF =
  'В форме 2 у записи появились "class" (чем станок держит артефакт) и "version" ' +
  '(версия обвеса, которой он положен), а "hash" стал необязательным — у ' +
  '"placed-once" его нет. Версию, которой файлы были положены раньше, досочинить ' +
  'неоткуда, поэтому старый манифест не мигрируется: сними baser.lock.json и ' +
  'разложи заново — артефакты потребуют поимённого подтверждения, зато паспорт ' +
  'укладки не будет врать';

/** Манифест не читается или не той формы. */
export class ManifestError extends DeclarationError {
  override readonly code = 'manifest-unreadable';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
