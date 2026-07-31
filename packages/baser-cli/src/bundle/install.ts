#!/usr/bin/env node
/**
 * УСТАНОВЩИК БАНДЛА — то, что человек запускает в своём репозитории.
 *
 * Этот файл уезжает в бандл ручной выдачи и работает уже ТАМ: рядом с ним лежат
 * нагрузка (`payload/`), её опись (`payload.json`) и `node_modules` с дверью и
 * её зависимостями. Node резолвит от места файла вверх, поэтому импорт
 * `@omnifield/baser-cli` находит дверь внутри бандла, а не в репозитории
 * человека — и бандл остаётся самодостаточным (`tasker:BASER2-29`).
 *
 * ## Почему обвес кладётся в `node_modules` цели
 *
 * Дверь ищет обвес резолвом от корня репозитория потребителя — так же, как его
 * нашёл бы сам репозиторий. В ручной выдаче обвес лежит в бандле, и развилка
 * была такая: либо установщик кладёт его в `node_modules` цели, либо форма
 * учится указывать локальный источник.
 *
 * **Выбрано первое.** Второе — изменение контракта ради ВРЕМЕННОГО способа
 * доставки, а такие изменения остаются навсегда: «локальный источник» пришлось
 * бы поддерживать и после того, как появится публикация. Копирование же честно
 * повторяет то, что сделал бы пакетный менеджер, и ничего не обещает сверх
 * этого: `npm i` поверх заменит поставку на месте, а дверь не узнает разницы,
 * потому что её и нет.
 *
 * ## Почему запись в `dependencies` снимается ПОСЛЕ прогона
 *
 * Имитация пакетного менеджера верна ровно до момента коммита (`BASER2-35`).
 * Записанная зависимость не резолвится ни у кого, кроме того, кто прямо сейчас
 * держит бандл в руках: пакет нигде не опубликован. Закоммитил `package.json` —
 * у коллеги падает `pnpm install`, а первым падает CI.
 *
 * Это не дефект двери и не дефект контракта, а **цена временного способа
 * доставки**: через реестр всё сходится само — менеджер и файлы положит, и
 * строку напишет, и лок обновит. Поэтому чинится это здесь, в файле,
 * существующем ровно ради ручной доставки, а не в контракте двери: контракт,
 * изменённый ради временного костыля, переживает костыль.
 *
 * Отсюда формулировка задачи — не «убрать строку», а **ручная доставка не
 * оставляет за собой того, что нельзя закоммитить**. Значит: убирать ВСЕГДА (и
 * после `--plan`, и после установки, и после ОТКАЗА двери), убирать `package.json`
 * целиком, если его до нас не было, и говорить, что убрал, — молчаливая уборка
 * это тоже молчание.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '@omnifield/baser-cli';

/**
 * Корень бандла — каталог ЭТОГО файла.
 *
 * В бандле установщик лежит на верхнем уровне, рядом с `payload/` и
 * `payload.json`. В пакете двери он собирается в `dist/bundle/`, но оттуда его
 * никто не зовёт: туда он попадает только чтобы уехать сюда.
 */
const bundle = dirname(fileURLToPath(import.meta.url));

const USAGE = `установка обвеса из бандла

  node install.mjs --plan   сухой прогон: показать, что будет, ничего не применяя
  node install.mjs          установка: применить и записать на диск

  --cwd <path>      репозиторий, куда ставим (по умолчанию — текущий каталог)
  --confirm <dest>  отдать ЭТОТ свой файл во владение обвесу, поимённо
  --json            отдать ответ данными

--confirm отдаёт владение, а что станет с содержимым, решает класс артефакта:
regenerated — твоя версия заменяется сборкой обвеса целиком; placed-once —
файл записывается в паспорт укладки, а содержимое не трогается. Что именно
случится с каждым спорным файлом, называет отказ, который просит подтверждения.

Обвес кладётся в node_modules цели и на ВРЕМЯ прогона объявляется в
package.json — иначе дверь его не найдёт. После прогона запись снимается:
коммитить нечего. Сухой прогон артефактов не раскладывает.`;

interface Args {
  readonly plan: boolean;
  readonly cwd: string;
  /** Просят ДАННЫЕ — значит проза не имеет права идти в тот же поток. */
  readonly json: boolean;
  readonly rest: readonly string[];
}

function parse(argv: readonly string[]): Args | string {
  let plan = false;
  let json = false;
  let cwd = process.cwd();
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      return USAGE;
    }
    if (flag === '--plan') {
      plan = true;
      continue;
    }
    if (flag === '--json') {
      // Флаг уезжает дальше в дверь (`rest`) — решает она, а установщик только
      // узнаёт, что поток занят данными.
      json = true;
      rest.push(flag);
      continue;
    }
    if (flag === '--cwd') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return `флаг "--cwd" ждёт значения.\n\n${USAGE}`;
      }
      cwd = value;
      index += 1;
      continue;
    }
    rest.push(flag);
  }

  return { plan, cwd: resolve(cwd), json, rest };
}

const parsed = parse(process.argv.slice(2));
if (typeof parsed === 'string') {
  process.stdout.write(`${parsed}\n`);
  process.exitCode = parsed === USAGE ? 0 : 2;
} else {
  process.exitCode = await install(parsed);
}

/**
 * Рассказ установщика — человеку, но не в поток данных.
 *
 * `--json` обещает «отдать ответ данными», и обещание не выполнялось с рождения
 * флага (`tasker:BASER2-36`): своя проза шла в тот же `stdout`, что и JSON
 * двери, — сверху строка про положенный обвес, снизу отчёт уборки. Вывод не
 * разбирался ничем, то есть флаг существовал ради того, кто зовёт нас из
 * скрипта, и ровно ему не работал.
 *
 * Выбран `stderr`, а не молчание: уборка чужого манифеста — это факт, который
 * человек обязан узнать, и убрать его совсем значило бы починить разбор за счёт
 * человека. Вносить прозу ВНУТРЬ ответа тоже нельзя: форма ответа принадлежит
 * двери, а установщик — временный файл ручной доставки, и лепить в чужую форму
 * поле ради него значит менять шов ради костыля.
 *
 * Без `--json` ничего не меняется: оба потока идут человеку в терминал.
 */
function say(args: Args, text: string): void {
  if (args.json) {
    process.stderr.write(text);
    return;
  }
  process.stdout.write(text);
}

async function install(args: Args): Promise<number> {
  const manifestPath = join(bundle, 'payload.json');
  if (!existsSync(manifestPath)) {
    say(
      args,
      `бандл повреждён: рядом с установщиком нет "payload.json" (${bundle})\n`,
    );
    return 2;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    source?: { package?: { name?: string; version?: string | null } };
  };
  const name = manifest.source?.package?.name;
  if (typeof name !== 'string' || name === '') {
    say(args, 'опись бандла не называет пакет обвеса\n');
    return 2;
  }

  // Обвес ставится ровно туда, где его ищет дверь, — и ровно так же, как его
  // положил бы пакетный менеджер. Каталог сносится целиком, а не сливается:
  // поставка это снимок, а не накопление (иначе файл, убранный из выпуска,
  // пережил бы обновление).
  const target = join(args.cwd, 'node_modules', name);
  rmSync(target, { force: true, recursive: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(bundle, 'payload'), target, { recursive: true });

  // Пакетный менеджер кладёт не только файлы: он ещё и объявляет пакет
  // зависимостью. Дверь ищет обвесы именно по объявленным зависимостям, поэтому
  // без этой записи скопированный каталог для неё не существует — прогон
  // отвечает «обвесов не поставлено», и человек ищет причину на ровном месте.
  // Это половина имитации, а половина имитации хуже её отсутствия.
  //
  // Запись живёт РОВНО прогон: снимок делается до неё, уборка идёт в `finally`,
  // и отказ двери на неё не влияет — отказ штатный исход, а не повод оставить
  // мину в чужом манифесте.
  const before = snapshot(args.cwd);
  const written = declareDependency(
    args.cwd,
    name,
    manifest.source?.package?.version ?? null,
  );

  say(
    args,
    `обвес ${name}${
      manifest.source?.package?.version === null ||
      manifest.source?.package?.version === undefined
        ? ''
        : `@${manifest.source.package.version}`
    } → ${target}\n\n`,
  );

  try {
    const outcome = await cli(
      [args.plan ? 'plan' : 'apply', '--cwd', args.cwd, ...args.rest],
      args.cwd,
    );
    process.stdout.write(outcome.stdout);
    return outcome.exitCode;
  } finally {
    say(
      args,
      `\n${restore(before, written, name, relative(args.cwd, target))}`,
    );
  }
}

/** Манифест потребителя до того, как мы его тронули. `null` — файла не было. */
interface Snapshot {
  readonly path: string;
  readonly text: string | null;
}

function snapshot(cwd: string): Snapshot {
  const path = join(cwd, 'package.json');
  return {
    path,
    text: existsSync(path) ? readFileSync(path, 'utf-8') : null,
  };
}

/**
 * Возвращает манифест в то состояние, в котором мы его застали, и РАССКАЗЫВАЕТ
 * об этом.
 *
 * Восстановление побайтовое, а не «удалить ключ и записать заново»: чужой файл
 * не должен даже переформатироваться. Разошедшийся отступ — это тоже строка в
 * `git status`, которую человек не просил.
 *
 * Если во время прогона манифест изменил КТО-ТО ЕЩЁ, побайтовый возврат затёр бы
 * чужую работу. Тогда снимается ровно своя запись, а остальное остаётся как
 * есть, и это говорится вслух: тихо выбирать за человека между его правкой и
 * нашей уборкой мы не вправе.
 */
function restore(
  before: Snapshot,
  written: string,
  name: string,
  installed: string,
): string {
  const store = `обвес остался в ${installed} — git его не отслеживает.\n`;
  const current = existsSync(before.path)
    ? readFileSync(before.path, 'utf-8')
    : null;

  if (current !== written) {
    return `${surgical(before, current, name)}${store}`;
  }

  if (before.text === null) {
    rmSync(before.path, { force: true });
    return (
      `package.json у тебя не было — создали на время прогона и убрали.\n` +
      `Дверь ищет обвесы по объявленным зависимостям, и на прогон запись нужна; ` +
      `коммитить её нельзя — пакет нигде не опубликован.\n${store}`
    );
  }

  writeFileSync(before.path, before.text, 'utf-8');
  return (
    `package.json возвращён как был: запись "${name}" снята.\n` +
    `Она нужна была на прогон — дверь ищет обвесы по объявленным зависимостям, — ` +
    `но закоммитить её нельзя: пакет нигде не опубликован, и у коллеги такая ` +
    `строка не резолвится.\n${store}`
  );
}

/**
 * Уборка, когда манифест во время прогона изменили не мы.
 *
 * Случай узкий (артефакт обвеса, целящийся в `package.json`, — известный долг
 * `tasker:BASER2-25`), но выбор в нём неочевиден, поэтому он назван, а не
 * оставлен на «обычно не случается».
 */
function surgical(
  before: Snapshot,
  current: string | null,
  name: string,
): string {
  if (current === null) {
    return `package.json во время прогона исчез — убирать нечего.\n`;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(current) as Record<string, unknown>;
  } catch {
    // Разобрать не смогли — трогать тем более не станем: снести чужой файл
    // вслепую хуже, чем оставить строку и честно сказать про неё.
    return (
      `package.json изменился во время прогона и не разбирается как JSON — ` +
      `запись "${name}" оставлена. Сними её руками перед коммитом: ` +
      `пакет нигде не опубликован.\n`
    );
  }

  const dependencies = {
    ...((parsed['dependencies'] as object) ?? {}),
  } as Record<string, string>;
  delete dependencies[name];
  const hadBlock =
    before.text !== null &&
    (JSON.parse(before.text) as Record<string, unknown>)['dependencies'] !==
      undefined;
  const next = { ...parsed, dependencies };
  if (Object.keys(dependencies).length === 0 && !hadBlock) {
    delete (next as Record<string, unknown>)['dependencies'];
  }

  writeFileSync(before.path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return (
    `package.json изменился во время прогона не нами — вернули не файл целиком, ` +
    `а сняли только свою запись "${name}". Остальное оставлено как есть.\n`
  );
}

/**
 * Объявляет обвес зависимостью репозитория — вторая половина того, что делает
 * пакетный менеджер. **На время прогона**: снимает запись `restore`.
 *
 * `package.json` создаётся, если его нет: без манифеста дверь не видит ни одной
 * объявленной зависимости, а значит и обвеса. Файл при этом временный ровно так
 * же, как запись, — в Go- или Python-репозитории он чужероден, и оставить его
 * значило бы оставить след, которого там отродясь не было.
 *
 * Отдаёт то, что записал: уборка сверяется с этим текстом, чтобы отличить
 * «манифест как мы его оставили» от «манифест успели изменить».
 */
function declareDependency(
  cwd: string,
  name: string,
  version: string | null,
): string {
  const path = join(cwd, 'package.json');
  const manifest = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>)
    : { name: 'repo', private: true };

  const dependencies = {
    ...((manifest['dependencies'] as Record<string, string>) ?? {}),
    [name]: version === null ? '*' : version,
  };

  const text = `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`;
  writeFileSync(path, text, 'utf-8');
  return text;
}
