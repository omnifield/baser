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
 * ## Обвес НЕ кладётся в чужой репозиторий вовсе
 *
 * Раньше здесь была имитация пакетного менеджера: обвес копировался в
 * `node_modules` цели и на время прогона объявлялся в её `package.json` — иначе
 * дверь его не находила, потому что искала обвесы по объявленным зависимостям.
 * Имитация была верна ровно до коммита, и за неё пришлось платить целым
 * механизмом уборки: снимок манифеста, возврат побайтово, отдельная ветка на
 * «манифест изменили не мы», рассказ обо всём этом человеку
 * (`tasker:BASER2-35`, `tasker:BASER2-36`).
 *
 * **Механизм снят вместе с причиной, а не подавлен** (`tasker:BASER2-146`).
 * Поставку теперь достаёт дверь, и НАЗВАННЫЙ КАТАЛОГ — законный источник
 * поставки, а не обход (`kb:BASER2-22`): бандл говорит `--source <имя>=<путь до
 * нагрузки>`, дверь берёт обвес прямо оттуда. В репозитории человека не
 * появляется ни склада, ни строки в манифесте — значит и убирать за собой
 * нечего, и рассказывать про уборку тоже.
 *
 * Ровно этого свойства ручная доставка не могла дать в принципе: «полной
 * имитация быть не может» — так и было записано, пока обвес обязан был лежать
 * внутри чужого дерева. Обязанность снята.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

Обвес берётся ИЗ ЭТОЙ ПАПКИ и в твой репозиторий не копируется: ни склада, ни
записи в твоём манифесте после прогона не остаётся. Сухой прогон артефактов не
раскладывает.`;

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
 * двери. Вывод не разбирался ничем, то есть флаг существовал ради того, кто
 * зовёт нас из скрипта, и ровно ему не работал.
 *
 * Выбран `stderr`, а не молчание: откуда взялся обвес — факт, который человек
 * обязан узнать. Вносить прозу ВНУТРЬ ответа нельзя: форма ответа принадлежит
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

  const payload = join(bundle, 'payload');
  const version = manifest.source?.package?.version;
  say(
    args,
    `обвес ${name}${
      version === null || version === undefined ? '' : `@${version}`
    } — из этой папки (${payload}); в репозиторий не копируется\n\n`,
  );

  // Каталог поставки называется двери тем же входом, каким его называет человек
  // с обвесом в исходниках рядом. Ручной доставке отдельного механизма больше не
  // нужно: она пользуется штатным.
  const outcome = await cli(
    [
      args.plan ? 'plan' : 'apply',
      '--cwd',
      args.cwd,
      '--source',
      `${name}=${payload}`,
      ...args.rest,
    ],
    args.cwd,
  );
  process.stdout.write(outcome.stdout);
  return outcome.exitCode;
}
