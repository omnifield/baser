/**
 * РАЗБОР ВЫЗОВА — тонкий слой, и намеренно тонкий.
 *
 * Здесь argv превращается в вызов механики, а её ответ — в поток и код возврата.
 * Решений в этом файле нет: всё, что можно узнать, узнаётся прогоном, а не
 * разбором флагов.
 *
 * НОЛЬ ИНТЕРАКТИВА ПО ПОСТРОЕНИЮ. Ни `stdin`, ни промптов, ни режима «не
 * спрашивай»: режима, который надо выключать, не существует, поэтому в конвейере
 * команда ведёт себя ровно как у человека (`kb:BASER3-10`).
 *
 * НЕЗНАКОМОЕ — ОТКАЗ, А НЕ «ПРОПУСТИМ». Опечатка во флаге, которая тихо ничего
 * не делает, — то самое молчание, из-за которого человек уверен, что попросил, а
 * его не услышали.
 */

import { createRequire } from 'node:module';
import { renderText } from './render.js';
import { exitCodeOf, SCHEMA_VERSION, type ShopResult } from './result.js';
import { down, publish, status, up } from './shop.js';

export const USAGE = `baser-registry — магазин локации: раздача, пока жив контейнер, и склад, который её переживает

  baser-registry up               поднять раздачу в этой локации
  baser-registry down             остановить раздачу; товар остаётся на месте
  baser-registry status           что сейчас: работает ли, по какому адресу, сколько товара
  baser-registry publish [папка]  положить пакет на склад этой локации

  --json     ответ данными; текст — рендер поверх них
  --help     эта подсказка
  --version  версия формы ответа и версия пакета

Магазин принадлежит ЛОКАЦИИ (контейнеру), а не отдельной постройке: раздача,
склад и настройки — одни на весь контейнер, и постройки одного участка
пользуются ими вместе. Где лежит магазин, печатает команда status; локация
может назвать своё место переменной BASER_REGISTRY_HOME.
Остановка уносит раздачу, но не товар.`;

export interface CliOutcome {
  readonly stdout: string;
  readonly exitCode: number;
  /** Ответ прогона; `null` — до прогона не дошло (подсказка, отказ разбора). */
  readonly result: ShopResult | null;
}

const COMMANDS = {
  up,
  down,
  status,
  publish,
} as const;

/**
 * Команды, принимающие путь позиционным аргументом.
 *
 * Перечень, а не «любой аргумент, начинающийся не с дефиса»: у `up` лишний
 * аргумент — это опечатка, и молча её проглотить значит сделать не то, о чём
 * просили.
 */
const TAKES_PATH = new Set(['publish']);

export async function cli(argv: string[], cwd: string): Promise<CliOutcome> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { stdout: `${USAGE}\n`, exitCode: 0, result: null };
  }

  if (argv.includes('--version')) {
    // Версий две, и они про разное: форма ответа — контракт для скриптов,
    // версия пакета — что именно установлено. Одной здесь не обойтись.
    const versions = {
      schemaVersion: SCHEMA_VERSION,
      packageVersion: packageVersion(),
    };
    return {
      stdout: `${JSON.stringify(versions, null, 2)}\n`,
      exitCode: 0,
      result: null,
    };
  }

  const [name, ...rest] = argv;
  if (name === undefined) {
    return { stdout: `${USAGE}\n`, exitCode: 2, result: null };
  }
  if (!(name in COMMANDS)) {
    return {
      stdout: `${refusal('unknown-command', name, `команды "${name}" у магазина нет`)}\n${USAGE}\n`,
      exitCode: 2,
      result: null,
    };
  }

  const json = rest.includes('--json');
  const loose = rest.filter((one) => one !== '--json');

  const flags = loose.filter((one) => one.startsWith('-'));
  if (flags.length > 0) {
    return {
      stdout: `${refusal('unknown-flag', flags[0], `флага "${flags[0]}" у команды "${name}" нет`)}\n${USAGE}\n`,
      exitCode: 2,
      result: null,
    };
  }

  const paths = loose.filter((one) => !one.startsWith('-'));
  if (paths.length > (TAKES_PATH.has(name) ? 1 : 0)) {
    return {
      stdout: `${refusal('unknown-flag', paths[0], `команда "${name}" столько аргументов не принимает`)}\n${USAGE}\n`,
      exitCode: 2,
      result: null,
    };
  }

  const result = await COMMANDS[name as keyof typeof COMMANDS]({
    cwd,
    ...(paths.length > 0 ? { directory: paths[0] } : {}),
  });

  return {
    stdout: json ? `${JSON.stringify(result, null, 2)}\n` : renderText(result),
    exitCode: exitCodeOf(result),
    result,
  };
}

/** Отказ разбора — тоже с кодом: ветвиться по тексту не должен никто. */
function refusal(code: string, at: string, message: string): string {
  return `[${code}] ${at}\n  ${message}`;
}

function packageVersion(): string {
  const manifest = createRequire(import.meta.url)(
    '../../package.json',
  ) as Record<string, unknown>;
  return typeof manifest['version'] === 'string' ? manifest['version'] : '0.0.0';
}
