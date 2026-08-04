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
 * новый файл в шаблоне обязан приезжать сам, без правки чужого файла.
 *
 * **Ни закрепление версии, ни метка канала значением не являются.** Формой 4 у
 * записи перечня появился необязательный `version` (`tasker:BASER2-145`),
 * формой 5 — `channel` (`tasker:BASER2-177`): оба говорят, КАКУЮ поставку брать
 * по имени, а не как её настроить. Обещание «ни одного значения» остаётся целым
 * — настройки живут только в файле на инструмент.
 *
 * Разбор здесь только структурный: знает ли обвес такую настройку и такой
 * пресет — вопрос к паре «объявление + конфиг», он решается в `settings.ts`.
 */

import { byBytes, CONSUMER_CONFIG_PATH } from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';
import {
  describeValue,
  isPossibleSettingValue,
  type SettingValue,
} from './values.js';
import { isPlainObject } from './declaration.js';
import {
  CHANNEL_SINCE,
  FORM_VERSION,
  MIN_FORM_VERSION,
  PINNED_VERSION_SINCE,
} from './version.js';

/**
 * Где перечень поставленного лежит по умолчанию. Читает его дверь, не движок.
 *
 * Само имя объявлено в `paths.ts`: в него обязано не целиться и объявление
 * обвеса, а держать одно имя в двух модулях значило бы дать ему разъехаться.
 */
export { CONSUMER_CONFIG_PATH };

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
  /**
   * Закреплённая версия поставки — НЕОБЯЗАТЕЛЬНА, и отсутствие тут законно.
   *
   * Есть — человек сказал, какую поставку брать по имени, и сказал её ТОЧНО
   * (`PINNED_VERSION`). Нет — «не закреплено»: дверь берёт последнюю доступную,
   * называет её в плане до применения и закрепляет в паспорте укладки (решение
   * architect, `tasker:BASER2-145`). Отсюда и необязательность: отсутствие — это
   * рабочее состояние, а не пропущенное поле.
   *
   * **Что дверь делает со значением, форма не решает.** Здесь оно только
   * принимается и проверяется на пригодность: ни реестра, ни файловой системы
   * этот вход не видит, а «есть ли такая версия у пакета» — вопрос к тому, кто
   * ставит, и задаётся он в другой зоне.
   *
   * Приехало формой 4 (`PINNED_VERSION_SINCE`): в конфиге, назвавшемся формой 3,
   * это отказ, а не тихое согласие.
   */
  readonly version?: string;
  /**
   * МЕТКА КАНАЛА — «дай последнее из дев-канала», не зная номера.
   * Необязательна, и отсутствие тут законно.
   *
   * **Отдельное поле, а не значение поля версии** (`kb:BASER3-26`, решение
   * architect 2026-08-04). Номер — адрес содержимого: под ним лежит ровно одна
   * сборка, и она не меняется. Метка — указатель, который двигается. Разные
   * обещания в одном поле означали бы, что читающий перечень не может сказать,
   * воспроизводим он, не разбирая строку.
   *
   * **Оба поля вместе законны, и номер бьёт метку** — но решает это не форма:
   * здесь оба разбираются и отдаются наверх целыми, а кто кого бьёт и что об
   * этом сказано вслух, называет дверь. Молча этого не решает никто.
   *
   * Чего здесь НЕТ: проверки, что такой канал у пакета существует. Про это
   * знает только склад, и спрашивает его дверь — этот вход не читает ни сети,
   * ни файловой системы.
   *
   * Приехала формой 5 (`CHANNEL_SINCE`): в конфиге, назвавшемся формой 4, это
   * отказ «подними formVersion», а не тихое согласие.
   */
  readonly channel?: string;
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
 * **Значение не проверяется, и схемы по этому адресу нет.** Она сознательно не
 * публикуется, пока формат шаблона отложен (`tasker:BASER2-8`): иначе у формы
 * появился бы второй дом — JSON Schema пришлось бы держать в согласии с этим
 * разборщиком, и они разъехались бы (решение architect, `tasker:BASER2-75`).
 * Поле — вежливый пропуск того, что редакторы подставляют сами, а не приглашение
 * сослаться: подсказок за ним человек не получит.
 */
const CONFIG_FIELDS = new Set(['$schema', 'formVersion', 'sources']);
const ENTRY_FIELDS = new Set(['use', 'version', 'channel']);
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
    const entry = parseEntry(log, item, `${at}.sources[${index}]`, formVersion);
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

/**
 * ТОЧНАЯ версия — та, которая закрепляет.
 *
 * Грамматика взята у semver (semver.org, официальное выражение спеки; сверено
 * 2026-08-03) и сужена до одного случая: **ровно версия, без диапазона и без
 * метки.** `^1.2.0`, `~1.2`, `>=1`, `latest`, `next` — законные строки для
 * установщика, но НЕ закрепление: тот же коммит завтра поставит другое
 * содержимое, а поле заведено ровно затем, чтобы этого не было (та же причина,
 * по которой резолвер дефолта не ходит в сеть, — `declaration.ts`).
 *
 * Своей зависимости на `semver` для этого не заводим: обвес ставится в ЧУЖИЕ
 * репозитории, и каждая наша зависимость становится зависимостью потребителя.
 * Проверяется здесь ФОРМА строки, а не разрешение диапазонов, — для формы
 * выражения спеки достаточно.
 *
 * Предрелиз и метка сборки законны (`1.2.3-beta.1+build.5`): они точную версию
 * не размывают.
 */
const PINNED_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?:[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function parseEntry(
  log: ProblemLog,
  value: unknown,
  at: string,
  formVersion: number,
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

  const version = parsePinnedVersion(log, value['version'], at, formVersion);
  const channel = parseChannel(log, value['channel'], at, formVersion);

  // Оба поля вместе законны и оба доезжают до читателя формы целыми: «номер
  // бьёт метку» — правило ДВЕРИ, и сказать это вслух обязана она. Отдать здесь
  // половину значило бы решить молча то, что решается названно.
  return {
    use: use.trim(),
    ...(version === undefined ? {} : { version }),
    ...(channel === undefined ? {} : { channel }),
  };
}

/**
 * Закрепление версии поставки — необязательное, точное и ничем не проверяемое
 * снаружи.
 *
 * Три отказа, и все три — про пригодность самой записи:
 *
 * 1. **поле приехало формой 4, а конфиг назвался старше** — `PINNED_VERSION_SINCE`.
 *    Отказ, а не тихое согласие: приняв закрепление под номером 3, мы дали бы
 *    двери записать файл, который baser формы 3 назовёт `unknown-field`, то есть
 *    опечаткой. Человек написал не опечатку, и сказать ему надо «обнови baser», а
 *    не «поля не знаю»;
 * 2. **не строка** — обычный `wrong-type`;
 * 3. **строка есть, но версией не является** — `invalid-version`.
 *
 * Чего здесь НЕТ и не будет: проверки, что такая версия у пакета существует.
 * Этот вход не читает ни файловой системы, ни сети, ни реестра — здесь только
 * форма и её пригодность.
 */
function parsePinnedVersion(
  log: ProblemLog,
  value: unknown,
  at: string,
  formVersion: number,
): string | undefined {
  const field = `${at}.version`;

  if (value === undefined) {
    return undefined;
  }
  if (formVersion < PINNED_VERSION_SINCE) {
    log.add(
      'form-version-unsupported',
      field,
      `закрепление версии приехало формой ${PINNED_VERSION_SINCE}, а ${CONSUMER_CONFIG_PATH} ` +
        `назвался формой ${formVersion} — подними "formVersion" до ${PINNED_VERSION_SINCE}. ` +
        `Иначе baser, который формы ${PINNED_VERSION_SINCE} не знает, назовёт закрепление ` +
        'опечаткой вместо «обнови baser»',
    );
    return undefined;
  }
  if (typeof value !== 'string') {
    log.add(
      'wrong-type',
      field,
      `ожидалась точная версия поставки строкой, получено ${describeValue(value)}`,
    );
    return undefined;
  }

  const pinned = value.trim();
  if (!PINNED_VERSION.test(pinned)) {
    log.add(
      'invalid-version',
      field,
      `ожидалась ТОЧНАЯ версия поставки вида "1.2.3", получено ${describeValue(value)}. ` +
        'Диапазон ("^1.2.0") и метка ("latest") не закрепляют ничего: тот же коммит ' +
        'завтра поставит другое содержимое. Не закрепляешь — не пиши поле вовсе: ' +
        'его отсутствие законно и означает «бери последнюю доступную»',
    );
    return undefined;
  }
  return pinned;
}

/**
 * МЕТКА КАНАЛА — слово-указатель, а не номер.
 *
 * Грамматика узкая и взята замером склада: у npm метка выдачи (`dist-tag`) и
 * номер версии **делят одно пространство имён**, поэтому реестр отвергает метку,
 * которая читается как диапазон версий («Tag name must not be a valid SemVer
 * range»), а сама дока советует не начинать метку с цифры и с буквы `v`
 * (docs.npmjs.com/cli/v11/commands/npm-dist-tag, сверено 2026-08-04). Живые
 * метки — `latest` · `next` · `dev` · `beta` · `rc`.
 *
 * Отсюда правило: **метка начинается с латинской буквы**, дальше буквы и цифры,
 * а точка, дефис и подчёркивание разделяют слова (`dev` · `next-major` · `v.1`
 * — нет). Латиница, как и у личности обвеса (`declaration.ts`): метку человек
 * пишет в чужой реестр и читает в чужой выдаче. Регистр при этом не режем — у
 * склада метки регистрозависимы, и запретить прописные значило бы отказать в
 * том, что снаружи законно.
 *
 * Разрешения диапазонов здесь нет и своей зависимости на `semver` не заводим —
 * судится ФОРМА строки, ровно как у закрепления версии.
 *
 * **«Такого канала нет на складе» — НЕ отказ формы.** Про наличие метки знает
 * только склад, спрашивает его дверь, и отвечает она сегодняшним ответом
 * (`kb:BASER3-26`). Этот вход не читает ни сети, ни файловой системы.
 */
const CHANNEL_LABEL = /^[a-zA-Z][a-zA-Z0-9]*(?:[-._][a-zA-Z0-9]+)*$/;

/**
 * Метка, которую склад прочитает как ДИАПАЗОН ВЕРСИЙ, а не как указатель:
 * `v1.4` для semver это `>=1.4.0 <1.5.0`, `v2` — `>=2.0.0 <3.0.0`.
 *
 * Второе правило, а не буква в первом: буквой `v` метка начинаться вправе
 * (`vnext`), номером после неё — нет. Ровно это и советует дока склада («не
 * начинай метку с цифры или с буквы `v`»), и ровно на этом реестр отвечает
 * «Tag name must not be a valid SemVer range».
 */
const VERSION_LIKE = /^v\d/i;

/**
 * Метка канала — необязательная, законная рядом с номером и ничем не
 * проверяемая снаружи.
 *
 * Три отказа, и все три — про пригодность самой записи:
 *
 * 1. **поле приехало формой 5, а конфиг назвался старше** — `CHANNEL_SINCE`.
 *    Отказ, а не тихое согласие, по той же причине, что у закрепления версии:
 *    приняв метку под номером 4, мы дали бы двери записать файл, который baser
 *    формы 4 назовёт `unknown-field`, то есть опечаткой. Человек написал не
 *    опечатку, и сказать ему надо «обнови baser»;
 * 2. **не строка** — обычный `wrong-type`;
 * 3. **строка есть, но меткой не является** (пустая, номер, мусор) —
 *    `invalid-channel`, отдельным кодом от `invalid-version`: номер в этом поле
 *    чинится переносом в `version`, а не другой меткой.
 */
function parseChannel(
  log: ProblemLog,
  value: unknown,
  at: string,
  formVersion: number,
): string | undefined {
  const field = `${at}.channel`;

  if (value === undefined) {
    return undefined;
  }
  if (formVersion < CHANNEL_SINCE) {
    log.add(
      'form-version-unsupported',
      field,
      `метка канала приехала формой ${CHANNEL_SINCE}, а ${CONSUMER_CONFIG_PATH} ` +
        `назвался формой ${formVersion} — подними "formVersion" до ${CHANNEL_SINCE}. ` +
        `Иначе baser, который формы ${CHANNEL_SINCE} не знает, назовёт метку ` +
        'опечаткой вместо «обнови baser»',
    );
    return undefined;
  }
  if (typeof value !== 'string') {
    log.add(
      'wrong-type',
      field,
      `ожидалась метка канала строкой, получено ${describeValue(value)}`,
    );
    return undefined;
  }

  const channel = value.trim();
  if (!CHANNEL_LABEL.test(channel) || VERSION_LIKE.test(channel)) {
    log.add(
      'invalid-channel',
      field,
      `ожидалась метка канала одним словом ("dev", "next", "beta"), ` +
        `получено ${describeValue(value)}. Метка начинается с буквы и не с "v" ` +
        'перед номером: номер и метка на складе делят одно пространство имён, ' +
        'и метку, читающуюся как версия, склад не примет. Нужен номер — он ' +
        'закрепляется полем "version": номер это адрес содержимого, метка — ' +
        'указатель, который двигается',
    );
    return undefined;
  }
  return channel;
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
    if (!isPossibleSettingValue(raw)) {
      log.add(
        'wrong-type',
        `${at}.${key}`,
        'значением настройки бывает строка, число, true/false, список строк, ' +
          'карта «ключ → значение» (значением карты — скаляр или ПЛОСКАЯ карта опций) ' +
          `или null; получено ${describeValue(raw)}`,
      );
      continue;
    }
    filled[key] = raw;
  }
  return filled;
}
