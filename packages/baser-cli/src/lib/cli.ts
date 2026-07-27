/**
 * РАЗБОР ВЫЗОВА — тонкий слой, и намеренно тонкий.
 *
 * Здесь argv превращается в `RunOptions`, а `DoorResult` — в поток и код
 * возврата. Ни одного решения о материализации в этом файле нет и не должно
 * быть: всё, что можно узнать, узнаётся прогоном, а не разбором флагов.
 *
 * **Ноль интерактива по построению.** Ни `process.stdin`, ни промптов, ни флага
 * «неинтерактивный режим»: режима, который надо выключать, не существует, и
 * поэтому в CI команда ведёт себя ровно как у человека
 * (`tasker:BASER2-18`, `tasker:BASER2-20`).
 *
 * Команд ровно две — показать план не применяя и применить. Две фазы разнесены
 * не двумя флагами одной команды, а двумя командами, потому что читаемость плана
 * ДО применения — инвариант, а не удобство (рынок подтвердил дважды: `nx
 * migrate` и схематики).
 */

import { DOOR_SCHEMA_VERSION } from './schema.js';
import { FORM_VERSION } from '@omnifield/baser-contracts';
import { OUTPUT_SCHEMA_VERSION } from '@omnifield/baser-materialize';
import { run } from './run.js';
import { renderText } from './report.js';
import { exitCodeOf, type DoorCommand, type DoorResult } from './result.js';

export const USAGE = `baser — дверь материализации

  baser plan   показать план, ничего не применяя
  baser apply  применить план и записать на диск

  --json            отдать ответ данными (то же, поверх чего рендерится текст)
  --cwd <path>      корень репозитория потребителя (по умолчанию — текущий каталог)
  --confirm <dest>  подтвердить перезапись ЭТОГО чужого артефакта, поимённо
  --version         версии схем: двери, формы, вывода движка
  --help            это сообщение

Вопросов пользователю дверь не задаёт: не заполнено — работает дефолт.
Код возврата: 0 сделано либо нечего делать · 1 конфликт владения · 2 отказ двери.`;

export interface CliOutcome {
  readonly stdout: string;
  readonly exitCode: number;
  /** Ответ прогона; `null` — до прогона не дошло (разбор вызова). */
  readonly result: DoorResult | null;
}

export async function cli(
  argv: readonly string[],
  cwd: string,
): Promise<CliOutcome> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    return { stdout: parsed.stdout, exitCode: parsed.exitCode, result: null };
  }

  const result = await run({
    command: parsed.command,
    cwd: parsed.cwd ?? cwd,
    confirm: parsed.confirm,
  });

  return {
    stdout: parsed.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderText(result)}\n`,
    exitCode: exitCodeOf(result),
    result,
  };
}

type ParsedArgv =
  | {
      readonly ok: true;
      readonly command: DoorCommand;
      readonly json: boolean;
      readonly cwd: string | null;
      readonly confirm: readonly string[];
    }
  | { readonly ok: false; readonly stdout: string; readonly exitCode: number };

/**
 * Разбор вызова.
 *
 * Незнакомый флаг — отказ, а не «пропустим»: опечатка в `--confrim`, которая
 * тихо ничего не делает, — то самое молчание, из-за которого затирание
 * становилось дефектом (`kb:BASER2-2` §4). Тот же принцип, что у формы с
 * незнакомым полем.
 */
function parseArgv(argv: readonly string[]): ParsedArgv {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return {
      ok: false,
      stdout: `${USAGE}\n`,
      exitCode: argv.length === 0 ? 2 : 0,
    };
  }

  if (argv.includes('--version')) {
    const versions = {
      doorSchemaVersion: DOOR_SCHEMA_VERSION,
      formVersion: FORM_VERSION,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    };
    return { ok: false, stdout: `${JSON.stringify(versions)}\n`, exitCode: 0 };
  }

  const [command, ...rest] = argv;
  if (command !== 'plan' && command !== 'apply') {
    return {
      ok: false,
      stdout: `неизвестная команда "${command}".\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }

  let json = false;
  let cwd: string | null = null;
  const confirm: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    switch (flag) {
      case '--json':
        json = true;
        break;
      case '--cwd':
      case '--confirm': {
        const argument = rest[index + 1];
        if (argument === undefined || argument.startsWith('--')) {
          return {
            ok: false,
            stdout: `флаг "${flag}" ждёт значения.\n\n${USAGE}\n`,
            exitCode: 2,
          };
        }
        index += 1;
        if (flag === '--cwd') {
          cwd = argument;
        } else {
          confirm.push(argument);
        }
        break;
      }
      default:
        return {
          ok: false,
          stdout: `неизвестный флаг "${flag}".\n\n${USAGE}\n`,
          exitCode: 2,
        };
    }
  }

  return { ok: true, command, json, cwd, confirm };
}
