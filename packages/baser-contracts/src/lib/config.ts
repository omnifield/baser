/**
 * КОНФИГ ПОТРЕБИТЕЛЯ — `baser.json` в корне его репозитория.
 *
 * Движок его не кладёт, не владеет им и ничего оттуда не чистит — только читает
 * (`kb:BASER2-5`). Он рождается сразу пользовательским, поэтому режим владения
 * ему не нужен.
 *
 * **Путей здесь нет и не появится.** Раскладку объявляет обвес, а не потребитель:
 * новая деталь в шаблоне обязана приезжать сама, без правки чужого файла. Всё,
 * что пишет пользователь, — какие обвесы поставлены и чем они у него настроены.
 *
 * Разбор здесь только структурный: знает ли обвес такую настройку и такой
 * пресет — вопрос к паре «объявление + конфиг», он решается в `settings.ts`.
 */

import { byBytes } from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';
import { describeValue, type SettingValue } from './values.js';
import { isPlainObject } from './declaration.js';

/** Где конфиг лежит по умолчанию. Читает его дверь, не движок. */
export const CONSUMER_CONFIG_PATH = 'baser.json';

export interface ConsumerSourceEntry {
  /** Чем привезли: имя пакета обвеса. Идентичность приходит из объявления. */
  readonly use: string;
  /** Ходовые положения регулировок, выбранные пользователем. */
  readonly presets: readonly string[];
  /** Заполненные значения — они бьют и дефолт, и пресет. */
  readonly settings: Readonly<Record<string, SettingValue>>;
}

export interface ConsumerConfig {
  /**
   * СПИСОК с первого дня, а не единственный корень: несколько поставщиков в
   * одном репозитории — норма по построению (`kb:BASER2-2` §2). Форма, которую
   * для этого пришлось бы «расширять», сломала бы обе соседние зоны.
   */
  readonly sources: readonly ConsumerSourceEntry[];
}

const CONFIG_FIELDS = new Set(['$schema', 'sources']);
const ENTRY_FIELDS = new Set(['use', 'presets', 'settings']);

/** Разбирает уже прочитанный `baser.json` (значение, а не текст). */
export function parseConsumerConfig(
  value: unknown,
  at = CONSUMER_CONFIG_PATH,
): FormResult<ConsumerConfig> {
  const log = new ProblemLog();

  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался JSON-объект конфига');
    return { ok: false, problems: log.list() };
  }

  for (const key of Object.keys(value).sort(byBytes)) {
    if (!CONFIG_FIELDS.has(key)) {
      log.add(
        'unknown-field',
        `${at}.${key}`,
        'конфиг такого поля не знает — опечатка либо надежда на поведение, которого нет',
      );
    }
  }

  const raw = value['sources'];
  if (raw === undefined) {
    log.add(
      'missing-field',
      `${at}.sources`,
      'нет перечня поставленных обвесов — добавь "sources": []',
    );
    return { ok: false, problems: log.list() };
  }
  if (!Array.isArray(raw)) {
    log.add(
      'wrong-type',
      `${at}.sources`,
      `ожидался массив записей {use}, получено ${describeValue(raw)}`,
    );
    return { ok: false, problems: log.list() };
  }

  const sources: ConsumerSourceEntry[] = [];
  const seen = new Map<string, number>();

  raw.forEach((item, index) => {
    const entry = parseEntry(log, item, `${at}.sources[${index}]`);
    if (!entry) {
      return;
    }
    const first = seen.get(entry.use);
    if (first !== undefined) {
      log.add(
        'duplicate-consumer-entry',
        `${at}.sources[${index}].use`,
        `пакет "${entry.use}" уже перечислен записью [${first}] — неизвестно, ` +
          'какая из настроек победит; оставь одну запись',
      );
      return;
    }
    seen.set(entry.use, index);
    sources.push(entry);
  });

  return log.result(() => ({ sources }));
}

function parseEntry(
  log: ProblemLog,
  value: unknown,
  at: string,
): ConsumerSourceEntry | null {
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект {use, presets?, settings?}');
    return null;
  }

  for (const key of Object.keys(value).sort(byBytes)) {
    if (!ENTRY_FIELDS.has(key)) {
      log.add(
        'unknown-field',
        `${at}.${key}`,
        'запись такого поля не знает; путей в конфиге потребителя не бывает — ' +
          'раскладку объявляет обвес',
      );
    }
  }

  const use = value['use'];
  if (use === undefined) {
    log.add('missing-field', `${at}.use`, 'не сказано, какой пакет поставлен');
    return null;
  }
  if (typeof use !== 'string' || use.trim() === '') {
    log.add(
      typeof use === 'string' ? 'empty-string' : 'wrong-type',
      `${at}.use`,
      `ожидалось имя пакета обвеса, получено ${describeValue(use)}`,
    );
    return null;
  }

  const presets = parsePresetNames(log, value['presets'], `${at}.presets`);
  const settings = parseFilledValues(log, value['settings'], `${at}.settings`);

  return { use: use.trim(), presets, settings };
}

function parsePresetNames(
  log: ProblemLog,
  value: unknown,
  at: string,
): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    log.add(
      'wrong-type',
      at,
      `ожидался список имён пресетов, получено ${describeValue(value)}`,
    );
    return [];
  }

  const names: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      log.add(
        typeof item === 'string' ? 'empty-string' : 'wrong-type',
        `${at}[${index}]`,
        `ожидалось имя пресета, получено ${describeValue(item)}`,
      );
      return;
    }
    // Порядок пресетов значим (следующий бьёт предыдущего), поэтому повтор —
    // не безобидный дубль, а неоднозначность: называем.
    if (names.includes(item)) {
      log.add(
        'duplicate-consumer-entry',
        `${at}[${index}]`,
        `пресет "${item}" уже выбран — повтор ничего не добавляет, но делает порядок неочевидным`,
      );
      return;
    }
    names.push(item);
  });
  return names;
}

function parseFilledValues(
  log: ProblemLog,
  value: unknown,
  at: string,
): Record<string, SettingValue> {
  const filled: Record<string, SettingValue> = {};

  if (value === undefined) {
    return filled;
  }
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект «имя настройки → значение»');
    return filled;
  }

  for (const key of Object.keys(value).sort(byBytes)) {
    const raw = value[key];
    if (!isSettingValue(raw)) {
      log.add(
        'wrong-type',
        `${at}.${key}`,
        `значением настройки бывает строка, число, true/false, список строк или null; получено ${describeValue(raw)}`,
      );
      continue;
    }
    filled[key] = raw;
  }
  return filled;
}

function isSettingValue(value: unknown): value is SettingValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}
