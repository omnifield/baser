/**
 * РАЗБОР ВЫЗОВА — тонкий слой, и намеренно тонкий.
 *
 * Здесь argv превращается в вызов механики, а её ответ — в поток и код
 * возврата. Ни одного решения в этом файле нет и не должно быть: всё, что можно
 * узнать, узнаётся прогоном, а не разбором флагов.
 *
 * **Ноль интерактива по построению.** Ни `process.stdin`, ни промптов, ни флага
 * «неинтерактивный режим»: режима, который надо выключать, не существует, и
 * поэтому в CI команда ведёт себя ровно как у человека
 * (`tasker:BASER2-18`, `tasker:BASER2-20`).
 *
 * ## Две семьи команд, и они разные
 *
 * **Материализация** — `plan` и `apply`. Две фазы разнесены не флагами одной
 * команды, а двумя командами, потому что читаемость плана ДО применения —
 * инвариант, а не удобство (рынок подтвердил дважды: `nx migrate` и схематики).
 *
 * **Подготовка обвеса к выдаче** — `check`, `pack`, `bundle` (`kb:BASER2-9`).
 * Механики живут в соседних зонах; дверь их зовёт и отдаёт ответ данными плюс
 * текст поверх. Своей семантики поверх чужой она не изобретает: коды приходят
 * снизу, и вторая правда о чужом событии нам уже дважды выходила боком.
 *
 * `bundle` — ОТДЕЛЬНАЯ команда, а не флаг у `pack`. Подготовка ≠ доставка
 * (`tasker:BASER2-31`): собрать нагрузку — всегда одно и то же, а бандл это
 * ровно один способ её вынести. Флагом это выглядело бы как настройка упаковки
 * и стёрло бы различение, на котором построена вся цепь.
 */

import { checkPackage, type CheckReport } from '@omnifield/baser-check';
import { FORM_VERSION } from '@omnifield/baser-contracts';
import { OUTPUT_SCHEMA_VERSION } from '@omnifield/baser-materialize';
import { packPackage, type PackReport } from '@omnifield/baser-pack';
import { bundle, BUNDLE_SCHEMA_VERSION, type BundleReport } from './bundle.js';
import { renderBundle, renderCheck, renderPack, renderText } from './report.js';
import { run } from './run.js';
import { DOOR_SCHEMA_VERSION } from './schema.js';
import { exitCodeOf, type DoorResult } from './result.js';

export const USAGE = `baser — дверь материализации и подготовка обвеса

  baser plan    показать план, ничего не применяя
  baser apply   применить план и записать на диск

  baser check  <каталог обвеса>                 обвес подходит посадочному месту?
  baser pack   <каталог обвеса> --into <куда>   собрать нагрузку к выдаче
  baser bundle <каталог обвеса> --into <куда>   собрать запускаемый бандл

  --json            отдать ответ данными (любая команда)
  --cwd <path>      корень репозитория потребителя — plan, apply
  --confirm <dest>  отдать чужой артефакт во владение обвесу, поимённо — plan, apply
  --difference      расхождение с чужим файлом целиком, без усечения — plan, apply
  --into <path>     каталог выдачи — pack, bundle
  --version         версии схем: двери, формы, вывода движка, бандла
  --help            это сообщение

Что из чужого файла не воспроизведётся, план называет построчно и БЕЗ ФЛАГА —
--difference только снимает усечение: показанного всегда меньше найденного, и
сколько именно, сказано счётчиком там же.

--confirm отдаёт ВЛАДЕНИЕ, и что при этом станет с содержимым, решает класс,
которым обвес держит артефакт: regenerated — твоя версия заменяется сборкой
обвеса целиком и дальше перегенерируется при каждом обновлении; placed-once —
артефакт записывается в паспорт укладки, а содержимое не трогается вовсе.
Класс каждого спорного артефакта называет отказ, который просит подтверждения.

Вопросов пользователю дверь не задаёт: не заполнено — работает дефолт.
Код возврата: 0 сделано либо нечего делать · 1 конфликт владения · 2 отказ.`;

/** Что произвёл вызов. Семьи команд разные, и ответы у них тоже разные. */
export type CliResult =
  | { readonly kind: 'door'; readonly door: DoorResult }
  | { readonly kind: 'check'; readonly check: CheckReport }
  | { readonly kind: 'pack'; readonly pack: PackReport }
  | { readonly kind: 'bundle'; readonly bundle: BundleReport };

export interface CliOutcome {
  readonly stdout: string;
  readonly exitCode: number;
  /** Ответ механики; `null` — до прогона не дошло (разбор вызова). */
  readonly result: CliResult | null;
}

export async function cli(
  argv: readonly string[],
  cwd: string,
): Promise<CliOutcome> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    return { stdout: parsed.stdout, exitCode: parsed.exitCode, result: null };
  }

  const emit = (
    result: CliResult,
    text: string,
    exitCode: number,
  ): CliOutcome => ({
    stdout: parsed.json
      ? `${JSON.stringify(payload(result), null, 2)}\n`
      : `${text}\n`,
    exitCode,
    result,
  });

  if (parsed.command === 'plan' || parsed.command === 'apply') {
    const door = await run({
      command: parsed.command,
      cwd: parsed.cwd ?? cwd,
      confirm: parsed.confirm,
      difference: parsed.difference,
    });
    return emit({ kind: 'door', door }, renderText(door), exitCodeOf(door));
  }

  if (parsed.command === 'check') {
    const report = checkPackage(parsed.target);
    return emit(
      { kind: 'check', check: report },
      renderCheck(report),
      report.ok ? 0 : 2,
    );
  }

  if (parsed.command === 'pack') {
    const report = packPackage(parsed.target, { into: parsed.into });
    return emit(
      { kind: 'pack', pack: report },
      renderPack(report),
      report.ok ? 0 : 2,
    );
  }

  const report = bundle(parsed.target, { into: parsed.into });
  return emit(
    { kind: 'bundle', bundle: report },
    renderBundle(report),
    report.ok ? 0 : 2,
  );
}

/** Машинный ответ — сам отчёт механики, без обёртки двери поверх него. */
function payload(result: CliResult): unknown {
  switch (result.kind) {
    case 'door':
      return result.door;
    case 'check':
      return result.check;
    case 'pack':
      return result.pack;
    case 'bundle':
      return result.bundle;
  }
}

type Command = 'plan' | 'apply' | 'check' | 'pack' | 'bundle';

/** Командам подготовки нужен каталог обвеса; `pack` и `bundle` — ещё и `--into`. */
const NEEDS_TARGET: readonly Command[] = ['check', 'pack', 'bundle'];
const NEEDS_INTO: readonly Command[] = ['pack', 'bundle'];

/**
 * Какой флаг какой команде принадлежит.
 *
 * Флаг, знакомый ДРУГОЙ команде, для этой ничем не лучше опечатки: `baser check
 * <обвес> --confirm a` проходил с кодом 0 и не делал ничего, а человек был
 * уверен, что подтвердил. Это ровно то молчание, от которого файл отгораживается
 * абзацем ниже, — и оно жило прямо под ним (`tasker:BASER2-71`).
 *
 * `--json` не перечисляется: он есть у всех и означает у всех одно.
 */
const FLAGS_BY_COMMAND: Readonly<Record<Command, readonly string[]>> = {
  plan: ['--cwd', '--confirm', '--difference'],
  apply: ['--cwd', '--confirm', '--difference'],
  check: [],
  pack: ['--into'],
  bundle: ['--into'],
};

/** Флаги, которым значение не нужно: они называют не «что», а «как». */
const WITHOUT_VALUE: readonly string[] = ['--difference'];

/** Кому флаг всё-таки принадлежит — чтобы отказ показывал верную команду. */
function ownersOf(flag: string): readonly Command[] {
  return (Object.keys(FLAGS_BY_COMMAND) as Command[]).filter((command) =>
    FLAGS_BY_COMMAND[command].includes(flag),
  );
}

type ParsedArgv =
  | {
      readonly ok: true;
      readonly command: Command;
      readonly json: boolean;
      readonly cwd: string | null;
      readonly confirm: readonly string[];
      /** Показать расхождение с чужим файлом целиком, без усечения. */
      readonly difference: boolean;
      /** Каталог обвеса для команд подготовки. */
      readonly target: string;
      /** Каталог выдачи для `pack` и `bundle`. */
      readonly into: string;
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
      bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    };
    return { ok: false, stdout: `${JSON.stringify(versions)}\n`, exitCode: 0 };
  }

  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    return {
      ok: false,
      stdout: `неизвестная команда "${command}".\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }

  let json = false;
  let cwd: string | null = null;
  let into: string | null = null;
  let difference = false;
  const confirm: string[] = [];
  const positional: string[] = [];

  /** Флаг знаком другой команде: для этой он ничем не лучше опечатки. */
  const foreign = (flag: string): ParsedArgv => ({
    ok: false,
    stdout:
      `флаг "${flag}" команде "${command}" не принадлежит — ` +
      `он у ${ownersOf(flag).join(' и ')}. Молча пропустить его значило бы ` +
      'сделать вид, что он сработал.\n\n' +
      `${USAGE}\n`,
    exitCode: 2,
  });

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];

    if (!flag.startsWith('--')) {
      positional.push(flag);
      continue;
    }

    if (flag === '--json') {
      json = true;
      continue;
    }

    if (WITHOUT_VALUE.includes(flag)) {
      if (!FLAGS_BY_COMMAND[command].includes(flag)) {
        return foreign(flag);
      }
      difference = true;
      continue;
    }

    if (flag === '--cwd' || flag === '--confirm' || flag === '--into') {
      if (!FLAGS_BY_COMMAND[command].includes(flag)) {
        return foreign(flag);
      }

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
      } else if (flag === '--into') {
        into = argument;
      } else {
        confirm.push(argument);
      }
      continue;
    }

    return {
      ok: false,
      stdout: `неизвестный флаг "${flag}".\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }

  const wantsTarget = NEEDS_TARGET.includes(command);
  if (wantsTarget && positional.length !== 1) {
    return {
      ok: false,
      stdout:
        `команда "${command}" ждёт ОДИН каталог обвеса` +
        `${positional.length > 1 ? `, получено ${positional.length}` : ''}.\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }
  if (!wantsTarget && positional.length > 0) {
    return {
      ok: false,
      stdout: `команда "${command}" не ждёт позиционных аргументов.\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }
  if (NEEDS_INTO.includes(command) && into === null) {
    return {
      ok: false,
      stdout: `команда "${command}" ждёт "--into <каталог выдачи>".\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }

  return {
    ok: true,
    command,
    json,
    cwd,
    confirm,
    difference,
    target: positional[0] ?? '',
    into: into ?? '',
  };
}

function isCommand(value: string): value is Command {
  return (
    value === 'plan' ||
    value === 'apply' ||
    value === 'check' ||
    value === 'pack' ||
    value === 'bundle'
  );
}
