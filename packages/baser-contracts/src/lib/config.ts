/**
 * СТОРОНА ПОТРЕБИТЕЛЯ — два файла, и они про разное.
 *
 * | | что в нём | кто пишет |
 * |---|---|---|
 * | `baser.json` | ЧТО ПОСТАВЛЕНО: перечень обвесов, ни одного значения | дверь и человек |
 * | `.omnifield/<поставщик>-<обвес>.yaml` | КАК НАСТРОЕНО: пресеты и значения | человек |
 *
 * Разделение — решение user 2026-07-29 (`tasker:BASER2-10` §3). Настройки уехали
 * из `baser.json` в файл на инструмент по двум причинам сразу: **конфиги
 * человека лежат в одной папке** (`kb:BASER2-2` §4), а заполняет их человек — и
 * ему нужны комментарии, то есть YAML, а не JSON. У каждой настройки в
 * объявлении есть `title` и `description`, и им место в файле, который человек
 * открывает, а не в доке, которую он не открывает.
 *
 * **Имя файла считается из личности обвеса, а не берётся из ссылки.** Ссылки на
 * конфиг в `baser.json` нет намеренно: она была бы вторым местом для одного
 * факта и могла бы разъехаться, а правило разъехаться не может.
 *
 * Движок оба файла не кладёт, не владеет ими и ничего оттуда не чистит
 * (`kb:BASER2-5`). Уточнение формы 2: **файл настроек дверь создаёт один раз,
 * если его нет** — с закомментированными дефолтами и описаниями. Значений она не
 * пишет никогда, поэтому инвариант «заполненное не поднимается, потому что
 * движку писать некуда» остаётся целым. Рождение файла — зона `cli`
 * (`tasker:BASER2-53`); форма даёт имя, ключ и разбор.
 *
 * **Путей здесь нет и не появится.** Раскладку объявляет обвес, а не потребитель:
 * новая деталь в шаблоне обязана приезжать сама, без правки чужого файла.
 *
 * Разбор здесь только структурный: знает ли обвес такую настройку и такой
 * пресет — вопрос к паре «объявление + конфиг», он решается в `settings.ts`.
 */

import { byBytes } from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';
import { describeValue, type SettingValue } from './values.js';
import { isPlainObject } from './declaration.js';
import { FORM_VERSION, MIN_FORM_VERSION } from './version.js';

/** Где перечень поставленного лежит по умолчанию. Читает его дверь, не движок. */
export const CONSUMER_CONFIG_PATH = 'baser.json';

/**
 * Папка, в которой лежит всё, что заполняет человек (`kb:BASER2-2` §4).
 *
 * Исключение одно и оно названо: конфиг, путь которого диктует ЧУЖОЙ инструмент
 * (`.devcontainer/devcontainer.json`, `.claude/settings.json`), сюда не уводится —
 * там его никто не прочитает. Такой конфиг обвес кладёт обычной записью
 * раскладки по требуемому адресу, а дверь его не читает.
 *
 * **Класс из этого НЕ следует** (`tasker:BASER2-10` §3, поправка architect
 * 2026-07-29; прежняя формулировка «кладёт с классом `placed-once`» отозвана).
 * Оси независимы: чужой адрес — про местоположение, класс — про то, ЗАПОЛНЯЕТ ЛИ
 * ФАЙЛ ЧЕЛОВЕК (`classes.ts`). `.devcontainer/devcontainer.json` заполняем МЫ из
 * шаблона, значит он `regenerated` по чужому адресу — так и делает пример зоны.
 *
 * Обратное тоже верно: `placed-once` бывает и внутри этой папки —
 * `.omnifield/harness.yaml` кладётся один раз, дальше им владеет продукт. Папка
 * ничего не решает.
 */
export const SOURCE_CONFIG_DIR = '.omnifield';

/**
 * Единственный ключ файла настроек, который читает дверь.
 *
 * Всё остальное в файле принадлежит инструменту: у плагина агентов там живут
 * зоны, модели и адреса сервисов. Один файл, два читателя, конфликта нет — пишет
 * в него человек, а не два поставщика.
 *
 * Ключ назван так же, как блок в манифесте обвеса, по той же причине: **блок
 * называется по тому, кто его читает**.
 */
export const SOURCE_CONFIG_KEY = 'baser';

/**
 * Имя файла настроек обвеса у потребителя — считается из его личности.
 *
 * `omnifield/devbox` → `.omnifield/omnifield-devbox.yaml`. Слеш в имени файла не
 * живёт, поэтому он становится дефисом; остальное — как в `id`, чтобы человек
 * узнавал свой обвес по имени файла, а не по содержимому.
 *
 * **Отображение НЕОБРАТИМО:** дефис законен и внутри сегмента личности, поэтому
 * `a-b/c` и `a/b-c` дают один файл. Разделитель менять не стали — имя файла
 * человек читает глазами; столкновение ловится названным отказом на уровне
 * НАБОРА (`source-config-shared`, `providers.ts`), того же уровня, что и один
 * `dest` на двоих.
 *
 * @param sourceId `source.id` из объявления обвеса, уже разобранный
 */
export function sourceConfigPath(sourceId: string): string {
  return `${SOURCE_CONFIG_DIR}/${sourceId.replace(/\//g, '-')}.yaml`;
}

export interface ConsumerSourceEntry {
  /** Чем привезли: имя пакета обвеса. Идентичность приходит из объявления. */
  readonly use: string;
}

export interface ConsumerConfig {
  /**
   * Версия формы, по которой конфиг написан. НЕОБЯЗАТЕЛЬНА в файле: пишет её
   * дверь при создании конфига, отсутствие означает самую старую разбираемую.
   *
   * Конфиги пользователей — такой же прод, как выпущенные обвесы, и молчаливая
   * поломка там будет нашей виной, а не чужой. Разница только в том, кто файл
   * пишет, и она не отменяет поломку, а лишь меняет виноватого.
   *
   * Номер тот же, что у объявления обвеса (`FORM_VERSION`), потому что форма
   * одна: конфиг и объявление склеиваются дверью в одну декларацию, и версионировать
   * половинки по отдельности значило бы обещать совместимость, которой нет.
   *
   * Пользователь при этом не вводит ничего — вопросов у двери не бывает.
   */
  readonly formVersion: number;
  /**
   * СПИСОК с первого дня, а не единственный корень: несколько поставщиков в
   * одном репозитории — норма по построению (`kb:BASER2-2` §2). Форма, которую
   * для этого пришлось бы «расширять», сломала бы обе соседние зоны.
   */
  readonly sources: readonly ConsumerSourceEntry[];
}

/** Как человек настроил ОДИН обвес — содержимое ключа `baser` его файла. */
export interface SourceConfig {
  /** Выбранные ходовые положения регулировок, в порядке применения. */
  readonly presets: readonly string[];
  /** Заполненные значения — они бьют и дефолт, и пресет. */
  readonly settings: Readonly<Record<string, SettingValue>>;
}

/** Конфиг обвеса, которого у потребителя нет: ничего не выбрано, ничего не заполнено. */
export const EMPTY_SOURCE_CONFIG: SourceConfig = { presets: [], settings: {} };

/**
 * Поля `baser.json`.
 *
 * `$schema` разрешён ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ: это единственный файл формы, который
 * человек открывает как самостоятельный JSON, и редактору надо чем-то подтянуть
 * подсказки. Асимметрия намеренная: в блоке `baser` манифеста обвеса схема у
 * файла своя и живёт на верхнем уровне `package.json`, а в файле настроек
 * `$schema` лежит ВНЕ ключа `baser` — там дверь и так молчит про чужие ключи.
 * В обоих этих местах `$schema` — обычное незнакомое поле (`unknown-field`).
 *
 * Сама схема по адресу из `$schema` пока не публикуется: поле принимается,
 * подсказок за ним нет (`tasker:BASER2-70`, побочный пункт).
 */
const CONFIG_FIELDS = new Set(['$schema', 'formVersion', 'sources']);
const ENTRY_FIELDS = new Set(['use']);
const SOURCE_CONFIG_FIELDS = new Set(['presets', 'settings']);

/**
 * Поля формы 1, уехавшие в файл на инструмент.
 *
 * Человеку надо сказать не «поля нет», а КУДА оно уехало: иначе он ищет опечатку
 * там, где её нет, — он написал ровно то, что работало вчера.
 */
const MOVED_FIELDS = new Set(['presets', 'settings']);

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

  const formVersion = parseFormVersion(log, value['formVersion'], at);

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
        `пакет "${entry.use}" уже перечислен записью [${first}] — ` +
          'два раза поставить один обвес нельзя; оставь одну запись',
      );
      return;
    }
    seen.set(entry.use, index);
    sources.push(entry);
  });

  return log.result(() => ({ formVersion, sources }));
}

/**
 * Версия формы конфига — необязательная.
 *
 * Отсутствие означает САМУЮ СТАРУЮ разбираемую форму, а не отказ: конфиг пишет
 * пользователь, и требовать от него поле, которого он не понимает, значило бы
 * завести вопрос там, где вопросов не бывает. Проставляет его дверь при создании
 * файла — миграционный крючок появляется, а пользователь ничего не вводит.
 *
 * Форму 1 это молчание не пропускает: `baser.json` первой формы отличается от
 * второй не версией, а содержимым — настройками и пресетами внутри записи, и они
 * называются вслух отдельно (`parseEntry`).
 */
function parseFormVersion(log: ProblemLog, value: unknown, at: string): number {
  const field = `${at}.formVersion`;

  if (value === undefined) {
    return MIN_FORM_VERSION;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    log.add(
      'form-version-invalid',
      field,
      `ожидалось целое число ≥ 1, получено ${describeValue(value)}`,
    );
    return MIN_FORM_VERSION;
  }
  if (value > FORM_VERSION) {
    log.add(
      'form-version-unsupported',
      field,
      `конфиг написан по форме ${value}, этот baser понимает по ${FORM_VERSION} — обнови baser`,
    );
  }
  if (value < MIN_FORM_VERSION) {
    log.add(
      'form-version-unsupported',
      field,
      `конфиг написан по форме ${value}, этот baser разбирает с ${MIN_FORM_VERSION}. ` +
        `Настройки и пресеты переехали из ${CONSUMER_CONFIG_PATH} в файл на инструмент ` +
        `(${sourceConfigPath('<поставщик>/<обвес>')}); здесь остаётся только перечень поставленного`,
    );
  }
  return value;
}

function parseEntry(
  log: ProblemLog,
  value: unknown,
  at: string,
): ConsumerSourceEntry | null {
  if (!isPlainObject(value)) {
    log.add('not-an-object', at, 'ожидался объект {use}');
    return null;
  }

  for (const key of Object.keys(value).sort(byBytes)) {
    if (ENTRY_FIELDS.has(key)) {
      continue;
    }
    if (MOVED_FIELDS.has(key)) {
      log.add(
        'consumer-settings-moved',
        `${at}.${key}`,
        `"${key}" больше не живёт в ${CONSUMER_CONFIG_PATH}: настройки обвеса переехали в ` +
          `файл на инструмент — ${sourceConfigPath('<поставщик>/<обвес>')}, ключ "${SOURCE_CONFIG_KEY}". ` +
          'Здесь — только что поставлено, там — как настроено',
      );
      continue;
    }
    log.add(
      'unknown-field',
      `${at}.${key}`,
      'запись такого поля не знает; путей в конфиге потребителя не бывает — ' +
        'раскладку объявляет обвес',
    );
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

  return { use: use.trim() };
}

/**
 * Разбирает файл настроек ОДНОГО обвеса — уже разобранный YAML, а не текст.
 *
 * **YAML читает дверь.** Пакет контрактов ничего не читает и ничего не исполняет:
 * ни файловой системы, ни сети, ни чужих модулей. Зависимость на разборщик
 * ставит зона `cli` (`tasker:BASER2-53`), сюда приезжает значение.
 *
 * Файла нет или он пуст (только что рождён и весь закомментирован) — это не
 * отказ, а «ничего не выбрано»: работают дефолты обвеса.
 *
 * @param value содержимое файла как значение; `undefined`/`null` = файла нет
 * @param at адрес для сообщений — путь файла, `sourceConfigPath(id)`
 */
export function parseSourceConfig(
  value: unknown,
  at = sourceConfigPath('<поставщик>/<обвес>'),
): FormResult<SourceConfig> {
  const log = new ProblemLog();

  if (value === undefined || value === null) {
    return { ok: true, value: EMPTY_SOURCE_CONFIG };
  }
  if (!isPlainObject(value)) {
    log.add(
      'not-an-object',
      at,
      `ожидался YAML-документ с ключом "${SOURCE_CONFIG_KEY}", получено ${describeValue(value)}`,
    );
    return { ok: false, problems: log.list() };
  }

  // Всё, что вне `baser`, — дело самого инструмента: у плагина агентов там зоны и
  // модели. Дверь их не открывает и об их полях молчит.
  const block = value[SOURCE_CONFIG_KEY];
  if (block === undefined || block === null) {
    return { ok: true, value: EMPTY_SOURCE_CONFIG };
  }
  if (!isPlainObject(block)) {
    log.add(
      'not-an-object',
      `${at}.${SOURCE_CONFIG_KEY}`,
      `ожидался объект {presets, settings}, получено ${describeValue(block)}`,
    );
    return { ok: false, problems: log.list() };
  }

  const blockAt = `${at}.${SOURCE_CONFIG_KEY}`;
  for (const key of Object.keys(block).sort(byBytes)) {
    if (!SOURCE_CONFIG_FIELDS.has(key)) {
      log.add(
        'unknown-field',
        `${blockAt}.${key}`,
        `в ключе "${SOURCE_CONFIG_KEY}" бывают только "presets" и "settings" — ` +
          'опечатка либо надежда на поведение, которого нет. ' +
          `Всё, что принадлежит самому инструменту, кладётся вне "${SOURCE_CONFIG_KEY}"`,
      );
    }
  }

  const presets = parsePresetNames(log, block['presets'], `${blockAt}.presets`);
  const settings = parseFilledValues(
    log,
    block['settings'],
    `${blockAt}.settings`,
  );

  return log.result(() => ({ presets, settings }));
}

function parsePresetNames(
  log: ProblemLog,
  value: unknown,
  at: string,
): readonly string[] {
  if (value === undefined || value === null) {
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

  if (value === undefined || value === null) {
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
