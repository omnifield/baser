/**
 * НАСТРОЙКИ МАГАЗИНА — объявлены здесь, заполняются человеком, дефолт наш.
 *
 * Модель канонная (`kb:BASER3-6`): инструмент объявляет список настроек и дефолт
 * к каждой, человек заполняет свой файл — столько полей, сколько захотел, — а
 * подставляем мы. Отсюда два правила, которые здесь держатся формой:
 *
 * - **не заполнил — работает дефолт**, и с выпуском инструмента дефолт поднимается;
 * - **заполнил — не поднимется никогда**: в файл человека мы не пишем, подниматься
 *   физически неоткуда.
 *
 * ФАЙЛ РОЖДАЕТСЯ ОДИН РАЗ, И ЗНАЧЕНИЙ В НЁМ НЕТ. `up` в локации без файла кладёт
 * его — с описаниями и ЗАКОММЕНТИРОВАННЫМИ дефолтами. Записать туда посчитанное
 * значение значило бы молча заморозить его: инструмент выпустился бы с новым, у
 * человека остался бы вчерашний, и он бы даже не узнал, что что-то выбирал.
 * Пустой файл — рабочее состояние, а не пробел.
 *
 * АДРЕС И ПОРТ — НАСТРОЙКА, А НЕ ХАРДКОД, и это требование ТЗ, а не вкус: порт
 * магазина внутри контейнера может столкнуться с чем угодно, что человек там уже
 * держит, и единственный легальный ход в таком случае — поменять настройку
 * (`kb:BASER3-5`). Наружу хост-машины при этом не торчит ничего: единственная
 * публикация во всей системе — дверь `:8080` (`kb:FUND-5`), магазин остаётся
 * внутренним.
 */

import { parse } from 'yaml';
import type { ShopProblemLog } from './problems.js';

/** Значения, с которыми магазин работает. Всё поле обязательно — дефолт есть у каждого. */
export interface ShopSettings {
  /** Порт, на котором слушает раздача. */
  readonly port: number;
  /**
   * Интерфейс, на котором слушает раздача.
   *
   * Дефолт `0.0.0.0`, а не `127.0.0.1`, и это не «слушаем всё на всякий случай»:
   * сосед по docker-сети не видит `127.0.0.1` соседнего контейнера
   * (`kb:FUND-5`), а магазин затевается ровно ради того, чтобы из него ставили.
   * Наружу машины это ничего не открывает — публикации хост-порта у нас нет.
   */
  readonly host: string;
  /**
   * Апстрим: у кого магазин спрашивает то, чего нет на своём складе.
   *
   * Прокси, а не второй реестр рядом (`kb:BASER3-9`): потребитель вписывает ОДИН
   * адрес, чего нет локально — тянется снаружи и кэшируется. Альтернатива (два
   * адреса и список, что откуда) возвращает человеку ручную маршрутизацию имён
   * — ровно то, ради устранения чего магазин и заводится.
   */
  readonly uplink: string;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  // Порт verdaccio по умолчанию. Своего числа не выдумываем: человек, знающий
  // рынок, ждёт именно его, а незнающему всё равно.
  port: 4873,
  host: '0.0.0.0',
  uplink: 'https://registry.npmjs.org/',
};

/** Что человек вправе поменять — единственный перечень, из него же родится файл. */
interface SettingDeclaration {
  readonly key: keyof ShopSettings;
  readonly title: string;
  readonly description: string;
}

const DECLARATIONS: readonly SettingDeclaration[] = [
  {
    key: 'port',
    title: 'Порт раздачи',
    description:
      'На нём магазин слушает внутри контейнера. Меняют его, когда порт уже\n' +
      'занят чем-то своим: команда честно откажет с кодом address-busy, а не\n' +
      'займёт соседний молча. Наружу машины порт не публикуется ни при каком\n' +
      'значении — единственная дверь наружу это :8080.',
  },
  {
    key: 'host',
    title: 'Интерфейс раздачи',
    description:
      'Дефолт слушает все интерфейсы контейнера: сосед по docker-сети не видит\n' +
      '127.0.0.1 чужого контейнера, а магазин затевается ради того, чтобы из\n' +
      'него ставили. Значение 127.0.0.1 запирает раздачу внутри контейнера —\n' +
      'осмысленно, если ставит только он сам.',
  },
  {
    key: 'uplink',
    title: 'Апстрим — у кого спрашивать то, чего нет на складе',
    description:
      'Магазин работает прокси: чего нет локально, он берёт наверху и кэширует,\n' +
      'поэтому потребителю хватает одного адреса. Пустым не бывает: без апстрима\n' +
      'локация теряет доступ ко всему, что не публиковали руками.',
  },
];

/**
 * Разбирает файл человека. Диска не трогает — текст приходит снаружи.
 *
 * `text === null` — файла нет, и это НЕ отказ: работают дефолты целиком.
 * Отказы копятся в журнал, а разбор идёт до конца: человек получает все свои
 * опечатки за один прогон, а не по одной за запуск.
 */
export function readSettings(
  text: string | null,
  at: string,
  problems: ShopProblemLog,
): ShopSettings {
  if (text === null) {
    return DEFAULT_SETTINGS;
  }

  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    problems.add(
      'config-unreadable',
      at,
      `настройки магазина не разбираются как YAML: ${(error as Error).message}`,
    );
    return DEFAULT_SETTINGS;
  }

  // Пустой файл — законное состояние: ровно таким он и рождается.
  if (parsed === null || parsed === undefined) {
    return DEFAULT_SETTINGS;
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.add(
      'config-not-mapping',
      at,
      'настройки магазина — это набор ключей; здесь лежит ' +
        (Array.isArray(parsed) ? 'список' : typeof parsed),
    );
    return DEFAULT_SETTINGS;
  }

  const raw = parsed as Record<string, unknown>;
  const known = new Set<string>(DECLARATIONS.map((one) => one.key));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      problems.add(
        'setting-unknown',
        `${at}#${key}`,
        `настройки "${key}" у магазина нет; есть: ${[...known].join(' · ')}`,
      );
    }
  }

  return {
    port: readPort(raw['port'], at, problems),
    host: readText(raw['host'], 'host', at, problems),
    uplink: readUplink(raw['uplink'], at, problems),
  };
}

function readPort(
  value: unknown,
  at: string,
  problems: ShopProblemLog,
): number {
  if (value === undefined || value === null) {
    return DEFAULT_SETTINGS.port;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    problems.add(
      'setting-type',
      `${at}#port`,
      `порт — целое число, а здесь ${describe(value)}`,
    );
    return DEFAULT_SETTINGS.port;
  }
  if (value < 1 || value > 65535) {
    problems.add(
      'port-out-of-range',
      `${at}#port`,
      `порт бывает от 1 до 65535, а здесь ${value}`,
    );
    return DEFAULT_SETTINGS.port;
  }
  return value;
}

function readText(
  value: unknown,
  key: 'host' | 'uplink',
  at: string,
  problems: ShopProblemLog,
): string {
  if (value === undefined || value === null) {
    return DEFAULT_SETTINGS[key];
  }
  if (typeof value !== 'string' || value.trim() === '') {
    problems.add(
      'setting-type',
      `${at}#${key}`,
      `${key} — непустая строка, а здесь ${describe(value)}`,
    );
    return DEFAULT_SETTINGS[key];
  }
  return value.trim();
}

function readUplink(
  value: unknown,
  at: string,
  problems: ShopProblemLog,
): string {
  const text = readText(value, 'uplink', at, problems);
  if (text === DEFAULT_SETTINGS.uplink) {
    return text;
  }
  // Адрес апстрима проверяется здесь, а не под первым запросом: непригодный
  // адрес иначе всплыл бы установкой, которая «почему-то не находит пакет».
  try {
    new URL(text);
  } catch {
    problems.add(
      'setting-type',
      `${at}#uplink`,
      `uplink — адрес реестра целиком, вместе со схемой; "${text}" на него не похож`,
    );
    return DEFAULT_SETTINGS.uplink;
  }
  return text;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'список';
  return `${typeof value} (${JSON.stringify(value)})`;
}

/**
 * АДРЕС, ПО КОТОРОМУ В МАГАЗИН ХОДЯТ, — не то же самое, что интерфейс, который
 * он слушает.
 *
 * `0.0.0.0` — это «слушаю на всех», и ходить по нему нельзя: как адрес назначения
 * он не означает ничего осмысленного. Подставить его в `--registry` значит выдать
 * человеку строку, которая где-то сработает, а где-то нет, — поэтому здесь он
 * переводится в петлевой адрес, по которому ходит тот же контейнер.
 *
 * Соседу по docker-сети нужен третий адрес — имя контейнера, — и магазин его не
 * знает и знать не может: имя даёт тот, кто контейнер поднимал. Врать про него
 * мы не будем; называем то, что верно всегда.
 */
export function clientAddress(settings: ShopSettings): string {
  const host =
    settings.host === '0.0.0.0' || settings.host === '::'
      ? '127.0.0.1'
      : settings.host;
  return `http://${host}:${settings.port}`;
}

/** Адрес, который слушает процесс: то, что уходит verdaccio как `--listen`. */
export function listenAddress(settings: ShopSettings): string {
  return `${settings.host}:${settings.port}`;
}

/**
 * Текст файла настроек, каким он рождается: описания и закомментированные дефолты.
 *
 * Формат YAML выбран ради человека — файл заполняет он, значит ему нужны
 * комментарии, и имя с описанием каждой настройки обязаны лежать в файле,
 * который он открывает, а не в доке, которую он не открывает (`kb:BASER3-6`).
 */
export function settingsTemplate(): string {
  const head = [
    '# Настройки магазина этой локации.',
    '#',
    '# Файл ваш: инструмент его читает и никогда в него не пишет. Не заполнено —',
    '# работает дефолт, и с новым выпуском инструмента дефолт поднимется сам.',
    '# Заполнено — останется вашим навсегда.',
    '#',
    '# Значения ниже закомментированы намеренно: это ДЕФОЛТЫ на день рождения',
    '# файла, а не ваш выбор. Раскомментировав строку, вы замораживаете значение.',
    '',
  ];

  const body = DECLARATIONS.flatMap((one) => [
    `# ${one.title}`,
    ...one.description.split('\n').map((line) => `# ${line}`),
    `# ${one.key}: ${JSON.stringify(DEFAULT_SETTINGS[one.key])}`,
    '',
  ]);

  return [...head, ...body].join('\n');
}
