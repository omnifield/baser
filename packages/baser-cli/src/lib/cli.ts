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
 * ## Три семьи команд, и они разные
 *
 * **Привязка поставки** — `add` (`tasker:BASER2-201`). Объявляет поставку в
 * локации и тут же применяет её: привязка модуля означает, что он заработал.
 * Механики здесь нет вовсе — способность «объявить» живёт в движке
 * (`kb:BASER3-33`), применение уже написано, а `add.ts` их складывает.
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
import { add, addExitCode, type AddResult } from './add.js';
import { bundle, BUNDLE_SCHEMA_VERSION, type BundleReport } from './bundle.js';
import {
  renderAdd,
  renderBundle,
  renderCheck,
  renderPack,
  renderText,
} from './report.js';
import { run } from './run.js';
import type { SupplyOverride } from './supply.js';
import { DOOR_SCHEMA_VERSION } from './schema.js';
import { exitCodeOf, type DoorResult } from './result.js';

export const USAGE = `baser — консоль материализации и подготовка обвеса

  baser add <пакет>  объявить поставку в локации и применить её

  baser plan    показать план, ничего не применяя
  baser apply   применить план и записать на диск

  baser check  <каталог обвеса>                 обвес подходит посадочному месту?
  baser pack   <каталог обвеса> --into <куда>   собрать нагрузку к выдаче
  baser bundle <каталог обвеса> --into <куда>   собрать запускаемый бандл

  --json            отдать ответ данными (любая команда)
  --cwd <path>      корень репозитория потребителя — add, plan, apply
  --channel <метка> взять последнее из канала, не зная номера ("dev") — add
  --version <номер> закрепить поставку на точной версии ("1.2.3") — add;
                    БЕЗ команды — версии схем: консоли, формы, вывода движка, бандла
  --confirm <dest>  отдать чужой артефакт во владение обвесу, поимённо — plan, apply
  --difference      расхождение с чужим файлом целиком, без усечения — plan, apply
  --source <имя>=<каталог>  взять поставку из каталога, а не со склада — plan, apply
  --into <path>     каталог выдачи — pack, bundle
  --help            это сообщение

add ОБЪЯВЛЯЕТ поставку и тут же ПРИМЕНЯЕТ её: привязка означает, что модуль
заработал, и второй командой это не делается. Объявления в локации нет — оно
создаётся; поставка уже объявлена — запись не дублируется, а смена закрепления
называется вслух. Метка канала и точный номер разом — отказ: что из двух
закрепление, вызов не сказал.

Применение отказало — объявление ОСТАЁТСЯ на диске, и это не след неудачи:
чинится названная причина, а повторяется тот же вызов. Конфликт владения так и
разрешается — подтверждение (--confirm) адресуется УЖЕ объявленной поставке, и
откат объявления сделал бы починку невозможной.

Поставку достаёт САМА консоль — тем же пакетным менеджером, в кэш снаружи твоей
локации ($BASER_CACHE, иначе $XDG_CACHE_HOME/baser, иначе ~/.cache/baser). В
локации от этого не появляется ни склада, ни лока, ни записи в твоём манифесте:
объявлять обвес зависимостью больше не нужно, и на локации не на ноде ничего
чужого не заводится.

Какую версию брать: закреплённую в "baser.json" (sources[].version), иначе ту,
что стоит сегодня за меткой канала (sources[].channel, например "dev"), иначе
ту, которой уже разложено по паспорту укладки, иначе последнюю доступную — и
каждый выбор план называет ДО применения, а не берёт молча.

Точный номер БЬЁТ метку канала, и проигравшую метку план называет тоже. Метка
спрашивается у склада каждый прогон и из кэша не отвечается: она указатель, и
вчерашний ответ про неё — вчерашний. Паспорт укладки при этом фиксирует НОМЕР,
а не метку. Метки у пакета нет — отказ с названной причиной и перечнем меток,
которые есть, а не тихий откат на стабильную.

--source называет каталог поставки поимённо и со складом не советуется: это
дев-петля для того, у кого обвес лежит рядом в исходниках.

Что из чужого файла не воспроизведётся, план называет построчно и БЕЗ ФЛАГА —
--difference только снимает усечение: показанного всегда меньше найденного, и
сколько именно, сказано счётчиком там же.

--confirm отдаёт ВЛАДЕНИЕ, и что при этом станет с содержимым, решает класс,
которым обвес держит артефакт: regenerated — твоя версия заменяется сборкой
обвеса целиком и дальше перегенерируется при каждом обновлении; placed-once —
артефакт записывается в паспорт укладки, а содержимое не трогается вовсе.
Класс каждого спорного артефакта называет отказ, который просит подтверждения.

Вопросов пользователю консоль не задаёт: не заполнено — работает дефолт.
Код возврата: 0 сделано либо нечего делать · 1 конфликт владения · 2 отказ.`;

/** Что произвёл вызов. Семьи команд разные, и ответы у них тоже разные. */
export type CliResult =
  | { readonly kind: 'add'; readonly add: AddResult }
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

  if (parsed.command === 'add') {
    // Ни одного решения по дороге: имя пакета и закрепление уезжают способности
    // движка как есть, а «объявить и применить» — это `add.ts`, а не разбор
    // argv (`tasker:BASER2-201`).
    const result = await add({
      use: parsed.target,
      ...(parsed.channel === null ? {} : { channel: parsed.channel }),
      ...(parsed.version === null ? {} : { version: parsed.version }),
      cwd: parsed.cwd ?? cwd,
    });
    return emit(
      { kind: 'add', add: result },
      renderAdd(result),
      addExitCode(result),
    );
  }

  if (parsed.command === 'plan' || parsed.command === 'apply') {
    const door = await run({
      command: parsed.command,
      cwd: parsed.cwd ?? cwd,
      confirm: parsed.confirm,
      difference: parsed.difference,
      sources: parsed.sources,
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
    case 'add':
      // Механик здесь две — объявление и применение, — и ответ отдаёт обе
      // целыми (`AddResult`). Своей обёртки поверх них консоль не изобретает:
      // и то, и другое едет ровно так, как его отдала своя зона.
      return result.add;
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

type Command = 'add' | 'plan' | 'apply' | 'check' | 'pack' | 'bundle';

/**
 * Чем команда зовётся позиционно — и как это НАЗЫВАЕТСЯ в отказе.
 *
 * Слово здесь не украшение: командам подготовки подают каталог на диске, а
 * `add` — имя пакета, которого на диске может не быть вовсе. Общее «ждёт ОДИН
 * каталог обвеса» отправило бы человека искать папку там, где нужна строка.
 */
const POSITIONAL: Readonly<Record<Command, string | null>> = {
  add: 'ОДНО имя пакета поставки',
  plan: null,
  apply: null,
  check: 'ОДИН каталог обвеса',
  pack: 'ОДИН каталог обвеса',
  bundle: 'ОДИН каталог обвеса',
};

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
  add: ['--cwd', '--channel', '--version'],
  plan: ['--cwd', '--confirm', '--difference', '--source'],
  apply: ['--cwd', '--confirm', '--difference', '--source'],
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
      /** Дев-петля: поставки, названные каталогом вместо склада. */
      readonly sources: readonly SupplyOverride[];
      /** Метка канала, которой закрепляется поставка у `add`. */
      readonly channel: string | null;
      /** Точный номер, которым закрепляется поставка у `add`. */
      readonly version: string | null;
      /** Позиционный аргумент: каталог обвеса либо имя пакета поставки. */
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

  // `--version` НОСИТ ДВА СМЫСЛА, и разводятся они принадлежностью команде.
  //
  // Своим он был всегда — «версии схем», — а поставка закрепляется на точной
  // версии тем же словом: так это поле называется и в перечне (`sources[].version`),
  // и у способности движка (`declareSupply.parameters`). Переименовать его у
  // консоли значило бы завести второе имя одному факту — ровно то, чего зона не
  // делает нигде.
  //
  // Поэтому смысл выбирает КОМАНДА, а не порядок аргументов: у `add` флаг её
  // собственный (`FLAGS_BY_COMMAND`), у всех прочих вызовов — прежний общий.
  // Механика та же, что и у «флаг принадлежит команде», и другого места, где
  // это решалось бы, не заводится.
  const head = argv[0];
  const claimed =
    isCommand(head) && FLAGS_BY_COMMAND[head].includes('--version');
  if (!claimed && argv.includes('--version')) {
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
  let channel: string | null = null;
  let version: string | null = null;
  let difference = false;
  const confirm: string[] = [];
  const sources: SupplyOverride[] = [];
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

    if (
      flag === '--cwd' ||
      flag === '--confirm' ||
      flag === '--into' ||
      flag === '--source' ||
      flag === '--channel' ||
      flag === '--version'
    ) {
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
      } else if (flag === '--confirm') {
        confirm.push(argument);
      } else if (flag === '--channel') {
        // Метка и номер здесь только СОБИРАЮТСЯ. Что бывает, когда названы оба,
        // решает движок своим `pin-ambiguous`: второе такое же решение, принятое
        // разбором argv, разошлось бы с первым молча (`kb:BASER3-33`).
        channel = argument;
      } else if (flag === '--version') {
        version = argument;
      } else {
        // Значение флага — ПАРА «имя пакета = каталог», и разбор её требует:
        // «--source packages/baser-devbox» не сказал бы, к какой записи перечня
        // каталог относится, а угадать это дверь не вправе — в локации обвесов
        // бывает несколько.
        const split = argument.indexOf('=');
        if (split <= 0 || split === argument.length - 1) {
          return {
            ok: false,
            stdout:
              `флаг "--source" ждёт пару "<имя пакета>=<каталог>", а получил ` +
              `"${argument}". Каталог называется поимённо: дев-петля включается ` +
              'для НАЗВАННОЙ поставки, а не для всех сразу.\n\n' +
              `${USAGE}\n`,
            exitCode: 2,
          };
        }
        sources.push({
          packageName: argument.slice(0, split),
          path: argument.slice(split + 1),
        });
      }
      continue;
    }

    return {
      ok: false,
      stdout: `неизвестный флаг "${flag}".\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }

  const wants = POSITIONAL[command];
  if (wants !== null && positional.length !== 1) {
    return {
      ok: false,
      stdout:
        `команда "${command}" ждёт ${wants}` +
        `${positional.length > 1 ? `, получено ${positional.length}` : ''}.\n\n${USAGE}\n`,
      exitCode: 2,
    };
  }
  if (wants === null && positional.length > 0) {
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
    sources,
    channel,
    version,
    target: positional[0] ?? '',
    into: into ?? '',
  };
}

function isCommand(value: string | undefined): value is Command {
  return (
    value === 'add' ||
    value === 'plan' ||
    value === 'apply' ||
    value === 'check' ||
    value === 'pack' ||
    value === 'bundle'
  );
}
