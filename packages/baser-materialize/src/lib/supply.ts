/**
 * СПОСОБНОСТЬ «ОБЪЯВИТЬ ПОСТАВКУ» — первая поверхность, которой у нас не было.
 *
 * Три поверхности пользователя описаны в `kb:BASER3-33`: привязать поставку,
 * настроить её, посмотреть состояние. Настройка и состояние у нас были, а ПЕРВОЙ
 * — той, с которой начинается любой сценарий, — не было вовсе: `plan` и `apply`
 * работают против УЖЕ написанного `baser.json`, а в пустой локации этого файла
 * нет и создать его нечем (замер `kb:SANDBOX-4`). Первый шаг делался руками, и
 * дальше уже неважно, насколько хороши сами мехи.
 *
 * Способность закрывает ровно этот шаг: добавить или изменить запись поставки в
 * объявлении локации. Форма — `capability.ts`: что запустить · описание ·
 * именованные параметры.
 *
 * ## Что она НЕ делает
 *
 * - **не ставит пакет и не ходит в реестр.** Она объявляет намерение в файле;
 *   достать поставку, разложить её и записать паспорт укладки — работа плана,
 *   применения и того, кто ходит на склад. Отсюда же и то, что «такой версии на
 *   складе нет» здесь не отказ: про наличие знает только склад;
 * - **не принимает настройки поставки** (решение user 2026-08-06): поставка
 *   несёт свою схему и дефолты сама, докрутка идёт файлом настроек после
 *   установки (`packages/baser-contracts`, `config.ts`);
 * - **не знает ни одного конкретного обвеса.** Имя пакета приходит параметром и
 *   ложится в файл как есть — способность его не интерпретирует. Это тот самый
 *   инвариант, который у baser легко теряется из-за двух шляп: мы и механизм, и
 *   автор некоторых обвесов, и автору удобно «чуть-чуть» научить движок про свой
 *   же случай (`kb:BASER3-34`). Границу держит проба, а не дисциплина.
 *
 * ## Изменение НАЗЫВАЕТСЯ, а не делается молча
 *
 * Ответ — данные со стабильной схемой (`kb:BASER3-10`): вид изменения, поставка,
 * закрепление до и после. Названо это ДО того, как что-либо окажется на диске:
 * движок пишет в виртуальное дерево, а сброс накопленного на диск — отдельная
 * фаза за его пределами (`tree.ts`, `apply.ts`). Тот, кто зовёт способность,
 * видит `pin-changed` с обоими закреплениями раньше, чем файл существует в новой
 * редакции.
 *
 * **Отсутствие закрепления в вызове ничего не снимает.** Позвать способность на
 * уже объявленную поставку, не назвав ни метки, ни номера, — это «объяви её»,
 * а не «сними закрепление»: молча выбросить то, что человек закрепил, значит
 * сделать ровно то, чего это правило не разрешает. Снятие закрепления — своя
 * операция со своим именем, и её здесь нет.
 */

import {
  CONSUMER_CONFIG_PATH,
  FORM_VERSION,
  parseConsumerConfig,
  type ConsumerSourceEntry,
} from '@omnifield/baser-contracts';
import type {
  Capability,
  CapabilityProblem,
  CapabilityResult,
  CapabilityRunOptions,
} from './capability.js';
import { OUTPUT_SCHEMA_VERSION } from './schema.js';
import { appendItem, findTopLevelArray, replaceItem } from './supply-text.js';
import type { TraceRecorder, TraceSpan } from './trace.js';
import { createTrace } from './trace.js';
import type { Tree } from './tree.js';

/** Машинное имя способности — им её зовут и по нему её узнаёт каталог. */
export const DECLARE_SUPPLY_NAME = 'declare-supply';

/**
 * Чем поставка закреплена по имени.
 *
 * Оба поля разом ЗАКОННЫ в файле — форма это разрешает, а «номер бьёт метку»
 * говорит дверь (`packages/baser-contracts`, `config.ts`). Поэтому закрепление
 * здесь описывает, что в записи ЛЕЖИТ, а не что из этого победит: пересказывать
 * чужое правило значило бы завести вторую правду о нём.
 *
 * `null` вместо закрепления — «не закреплено»: берётся последняя доступная.
 */
export interface SupplyPin {
  /** Точный номер — адрес содержимого, под ним лежит ровно одна сборка. */
  readonly version?: string;
  /** Метка канала — указатель, который двигается. */
  readonly channel?: string;
}

/** Что случилось с объявлением локации. Ветвиться — по этому слову. */
export type SupplyChange =
  /** Объявления не было — файл создан, поставка в нём первая. */
  | 'declaration-created'
  /** Объявление было — запись добавлена, соседние не тронуты. */
  | 'supply-added'
  /** Поставка уже объявлена — сменилось закрепление. */
  | 'pin-changed'
  /** Поставка уже объявлена ровно так же — файл не тронут вовсе. */
  | 'already-declared';

export interface DeclareSupplyInput {
  /** Имя пакета поставки. */
  readonly use: string;
  /** Метка канала — взаимоисключающа с номером. */
  readonly channel?: string;
  /** Точный номер — взаимоисключающ с меткой. */
  readonly version?: string;
}

export interface DeclareSupplyOutcome {
  /** Версия схемы вывода — тот же контракт с пультом, что у плана и отчёта. */
  readonly schemaVersion: number;
  readonly change: SupplyChange;
  /** Где лежит объявление локации. */
  readonly at: string;
  /** Какая поставка объявлена. */
  readonly use: string;
  /** Как она закреплена ПОСЛЕ; `null` — не закреплена. */
  readonly pin: SupplyPin | null;
  /** Как она была закреплена ДО — только у `pin-changed`. */
  readonly previousPin?: SupplyPin | null;
  readonly trace: readonly TraceSpan[];
}

/**
 * ОДНО ЗАКРЕПЛЕНИЕ ЗА ВЫЗОВ — сужение на ВХОДЕ, а не в форме файла.
 *
 * Форма разрешает записи нести и номер, и метку сразу. Вызов — нет: «закрепи на
 * `dev` и на `1.2.3`» это не запись с двумя полями, а невыраженное намерение —
 * из него не следует, что записать. Принять оба и решить за человека значило бы
 * сделать молча то, что решается названно; поэтому здесь отказ данными, а
 * прочитанная запись с обоими полями остаётся законной и доезжает наверх целой.
 */
const PIN_AMBIGUOUS =
  'закрепление названо дважды — и меткой канала, и номером. ' +
  'Номер это адрес содержимого, метка — указатель, который двигается: ' +
  'что из этого закрепление, вызов не сказал. Назови одно';

const PARAMETERS = [
  {
    name: 'use',
    title: 'Пакет поставки',
    description:
      'Имя пакета, которым приезжает обвес. Способность его не проверяет по ' +
      'складу и не ставит — она объявляет его в локации.',
    type: 'string',
    required: true,
  },
  {
    name: 'channel',
    title: 'Метка канала',
    description:
      'Взять последнее из канала, не зная номера ("dev", "next"). Не названа ' +
      'и номер не назван — берётся последняя доступная. Взаимоисключающа с номером.',
    type: 'string',
    required: false,
  },
  {
    name: 'version',
    title: 'Точный номер',
    description:
      'Закрепить поставку на точной версии ("1.2.3"): под номером лежит ровно ' +
      'одна сборка, и завтра она та же. Взаимоисключающ с меткой канала.',
    type: 'string',
    required: false,
  },
] as const;

/**
 * Объявить поставку в локации.
 *
 * Локация — это дерево, которое подали: своего представления о том, где она
 * лежит, у движка нет и быть не может (`tree.ts`). Путь объявления берётся у
 * формы (`CONSUMER_CONFIG_PATH`) и параметром не выносится: второе место для
 * одного имени разъехалось бы с первым.
 */
export const declareSupply: Capability<
  DeclareSupplyInput,
  DeclareSupplyOutcome
> = {
  name: DECLARE_SUPPLY_NAME,
  title: 'Объявить поставку',
  description:
    'Добавляет поставку в объявление локации или меняет её закрепление. ' +
    'Объявления нет — создаёт его. Поставка уже объявлена — не дублирует запись, ' +
    'а называет смену закрепления. Пакет не ставит и на склад не ходит.',
  parameters: PARAMETERS,
  run,
};

function run(
  tree: Tree,
  input: DeclareSupplyInput,
  options: CapabilityRunOptions = {},
): CapabilityResult<DeclareSupplyOutcome> {
  const trace = options.trace ?? createTrace();

  const refusals = checkInput(input);
  if (refusals.length > 0) {
    return { ok: false, problems: refusals };
  }

  const entry = entryOf(input);
  const at = CONSUMER_CONFIG_PATH;

  const raw = trace.span('declare.read', () => readDeclaration(tree, at));
  if (raw !== null && typeof raw !== 'string') {
    return { ok: false, problems: [raw.problem] };
  }

  return raw === null
    ? create(tree, at, entry, trace)
    : merge(tree, at, raw, entry, input, trace);
}

/** Непригодное содержимое отдаётся отказом, а не броском: наружу уходят данные. */
interface Unreadable {
  readonly problem: CapabilityProblem;
}

/**
 * Содержимое объявления либо `null`, если его нет.
 *
 * Каталог по этому пути — не «объявления нет»: создав файл поверх, движок
 * упёрся бы в занятый путь на записи, а сказать об этом надо раньше и понятнее.
 */
function readDeclaration(
  tree: Tree,
  at: string,
): string | null | Unreadable {
  if (!tree.exists(at)) {
    return null;
  }
  if (!tree.isFile(at)) {
    return {
      problem: {
        code: 'consumer-config-unreadable',
        at,
        message:
          'по этому пути лежит не файл — объявление локации туда не записать',
      },
    };
  }
  const content = tree.read(at, 'utf-8');
  return content === null
    ? {
        problem: {
          code: 'consumer-config-unreadable',
          at,
          message: 'объявление локации есть, но не читается',
        },
      }
    : content;
}

/** Объявления не было — оно рождается вместе с первой поставкой. */
function create(
  tree: Tree,
  at: string,
  entry: ConsumerSourceEntry,
  trace: TraceRecorder,
): CapabilityResult<DeclareSupplyOutcome> {
  const config = { formVersion: FORM_VERSION, sources: [entry] };

  const checked = check(config, at, trace);
  if (checked !== null) {
    return checked;
  }

  // Файл рождается ЦЕЛИКОМ нашим, поэтому пишется каноничной формой — тем же
  // отступом, которым движок пишет паспорт укладки. Дальше он принадлежит
  // человеку, и следующая правка уже сохранит его стиль (`supply-text.ts`).
  trace.span('declare.write', () =>
    tree.write(at, `${JSON.stringify(config, null, 2)}\n`),
  );

  return {
    ok: true,
    value: outcome('declaration-created', at, entry, trace),
  };
}

/** Объявление есть — правится ровно одна запись, всё остальное копируется дословно. */
function merge(
  tree: Tree,
  at: string,
  raw: string,
  entry: ConsumerSourceEntry,
  input: DeclareSupplyInput,
  trace: TraceRecorder,
): CapabilityResult<DeclareSupplyOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      problems: [
        {
          code: 'consumer-config-unreadable',
          at,
          message:
            'объявление локации не разбирается как JSON — почини файл; ' +
            'дописывать поставку в непонятое содержимое движок не станет',
        },
      ],
    };
  }

  // Непригодное объявление НЕ правится: мы не знаем, что человек имел в виду, а
  // дописав в него запись, мы сделали бы файл непригодным ещё и по нашей вине.
  const current = trace.span('declare.form', () =>
    parseConsumerConfig(parsed, at),
  );
  if (!current.ok) {
    return { ok: false, problems: current.problems };
  }

  const array = findTopLevelArray(raw, 'sources');
  // Разбор и текстовый обход обязаны видеть один и тот же перечень. Разошлись —
  // значит один из них ошибся, и править текст вслепую нельзя: не тот элемент
  // это не опечатка, а снесённая чужая запись.
  if (array === null || array.items.length !== current.value.sources.length) {
    return {
      ok: false,
      problems: [
        {
          code: 'consumer-config-unreadable',
          at: `${at}.sources`,
          message:
            'перечень поставленного не удалось найти в тексте файла — ' +
            'записать в него поставку, не тронув соседние записи, нечем',
        },
      ],
    };
  }

  const index = current.value.sources.findIndex(
    (source) => source.use === entry.use,
  );

  if (index < 0) {
    const checked = check(withSources(parsed, splice(parsed, entry)), at, trace);
    if (checked !== null) {
      return checked;
    }
    trace.span('declare.write', () =>
      tree.write(at, appendItem(raw, array, entry)),
    );
    return { ok: true, value: outcome('supply-added', at, entry, trace) };
  }

  const previous = pinOf(current.value.sources[index]);
  const next = pinOf(entry);

  // Закрепление меняется только когда оно НАЗВАНО: вызов без метки и номера на
  // уже объявленной поставке ничего не снимает (см. заголовок модуля).
  if (!named(input) || samePin(previous, next)) {
    return {
      ok: true,
      value: {
        ...outcome('already-declared', at, entry, trace),
        pin: previous,
      },
    };
  }

  const checked = check(
    withSources(parsed, splice(parsed, entry, index)),
    at,
    trace,
  );
  if (checked !== null) {
    return checked;
  }

  trace.span('declare.write', () =>
    tree.write(at, replaceItem(raw, array.items[index], entry)),
  );

  return {
    ok: true,
    value: {
      ...outcome('pin-changed', at, entry, trace),
      previousPin: previous,
    },
  };
}

/**
 * Судит форму ТОГО ФАЙЛА, который получится, — а не отдельно взятую запись.
 *
 * Разборщик формы один на всех (`parseConsumerConfig`), и он же отвечает на
 * вопросы, на которые запись сама по себе не отвечает: приехало ли поле в той
 * форме, которой файл назвался, и не перечислена ли поставка дважды. Свой разбор
 * здесь был бы второй правдой о форме и разъехался бы с первой молча.
 *
 * `null` — форма сошлась; иначе готовый отказ с адресами внутри файла.
 */
function check(
  candidate: unknown,
  at: string,
  trace: TraceRecorder,
): CapabilityResult<DeclareSupplyOutcome> | null {
  const result = trace.span('declare.form', () =>
    parseConsumerConfig(candidate, at),
  );
  return result.ok ? null : { ok: false, problems: result.problems };
}

/** Перечень будущего файла: запись дописывается либо встаёт на своё место. */
function splice(
  parsed: unknown,
  entry: ConsumerSourceEntry,
  index?: number,
): unknown[] {
  const sources = [...sourcesOf(parsed)];
  if (index === undefined) {
    sources.push(entry);
  } else {
    sources[index] = entry;
  }
  return sources;
}

function sourcesOf(parsed: unknown): readonly unknown[] {
  const sources = (parsed as { sources?: unknown }).sources;
  return Array.isArray(sources) ? sources : [];
}

function withSources(parsed: unknown, sources: unknown[]): unknown {
  return { ...(parsed as Record<string, unknown>), sources };
}

function outcome(
  change: SupplyChange,
  at: string,
  entry: ConsumerSourceEntry,
  trace: TraceRecorder,
): DeclareSupplyOutcome {
  trace.event('declare.outcome', { change, use: entry.use });
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    change,
    at,
    use: entry.use,
    pin: pinOf(entry),
    trace: trace.snapshot(),
  };
}

/** Названо ли в вызове хоть какое-то закрепление. */
function named(input: DeclareSupplyInput): boolean {
  return input.channel !== undefined || input.version !== undefined;
}

function pinOf(entry: ConsumerSourceEntry): SupplyPin | null {
  const pin: SupplyPin = {
    ...(entry.version === undefined ? {} : { version: entry.version }),
    ...(entry.channel === undefined ? {} : { channel: entry.channel }),
  };
  return pin.version === undefined && pin.channel === undefined ? null : pin;
}

function samePin(left: SupplyPin | null, right: SupplyPin | null): boolean {
  return left?.version === right?.version && left?.channel === right?.channel;
}

/**
 * Запись перечня из параметров вызова.
 *
 * Пустые поля не пишутся вовсе, а не пустой строкой: отсутствие закрепления —
 * рабочее состояние, и выражается оно отсутствием ключа.
 */
function entryOf(input: DeclareSupplyInput): ConsumerSourceEntry {
  return {
    use: input.use.trim(),
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.channel === undefined ? {} : { channel: input.channel }),
  };
}

/**
 * Отказы по самому ВЫЗОВУ — до того, как тронут файл.
 *
 * Грамматика метки и номера здесь не судится: их судит форма на готовом файле, и
 * её отказ называет адрес внутри файла, а не имя параметра. Продублировав
 * грамматику тут, мы получили бы два разных ответа на один вопрос.
 */
function checkInput(input: DeclareSupplyInput): readonly CapabilityProblem[] {
  const problems: CapabilityProblem[] = [];
  const at = DECLARE_SUPPLY_NAME;

  if (input.use === undefined || input.use === null) {
    problems.push({
      code: 'missing-field',
      at: `${at}.use`,
      message: 'не сказано, какую поставку объявлять',
    });
  } else if (typeof input.use !== 'string') {
    problems.push({
      code: 'wrong-type',
      at: `${at}.use`,
      message: 'имя пакета поставки ожидалось строкой',
    });
  } else if (input.use.trim() === '') {
    problems.push({
      code: 'empty-string',
      at: `${at}.use`,
      message: 'имя пакета поставки пусто — объявлять нечего',
    });
  }

  if (input.channel !== undefined && input.version !== undefined) {
    problems.push({ code: 'pin-ambiguous', at, message: PIN_AMBIGUOUS });
  }

  return problems;
}

/**
 * Человеческий рендер ПОВЕРХ тех же данных — как `describePlan` у плана.
 *
 * Источником он не является и ветвиться по нему нельзя ни пульту, ни гейту:
 * машине — `change`, человеку — эта строка (`kb:BASER3-10`).
 */
export function describeSupplyChange(value: DeclareSupplyOutcome): string {
  const pin = describePin(value.pin);

  switch (value.change) {
    case 'declaration-created':
      return `${value.at}: объявление создано, поставка "${value.use}" ${pin}`;
    case 'supply-added':
      return `${value.at}: поставка "${value.use}" объявлена, ${pin}`;
    case 'pin-changed':
      return (
        `${value.at}: поставка "${value.use}" уже объявлена — ` +
        `закрепление ${describePin(value.previousPin ?? null)} → ${pin}`
      );
    case 'already-declared':
      return `${value.at}: поставка "${value.use}" уже объявлена, ${pin} — файл не тронут`;
  }
}

function describePin(pin: SupplyPin | null): string {
  if (pin === null) {
    return 'без закрепления (берётся последняя доступная)';
  }
  return [
    ...(pin.version === undefined ? [] : [`номер ${pin.version}`]),
    ...(pin.channel === undefined ? [] : [`канал ${pin.channel}`]),
  ].join(' и ');
}
