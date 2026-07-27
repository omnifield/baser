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
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  --confirm <dest>  подтвердить замену ЭТОГО своего файла, поимённо
  --json            отдать ответ данными

Сухой прогон делает то же, что npm i: кладёт обвес в node_modules и добавляет
его в dependencies. Артефактов не раскладывает — план читается до применения.`;

interface Args {
  readonly plan: boolean;
  readonly cwd: string;
  readonly rest: readonly string[];
}

function parse(argv: readonly string[]): Args | string {
  let plan = false;
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

  return { plan, cwd: resolve(cwd), rest };
}

const parsed = parse(process.argv.slice(2));
if (typeof parsed === 'string') {
  process.stdout.write(`${parsed}\n`);
  process.exitCode = parsed === USAGE ? 0 : 2;
} else {
  process.exitCode = await install(parsed);
}

async function install(args: Args): Promise<number> {
  const manifestPath = join(bundle, 'payload.json');
  if (!existsSync(manifestPath)) {
    process.stdout.write(
      `бандл повреждён: рядом с установщиком нет "payload.json" (${bundle})\n`,
    );
    return 2;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    source?: { package?: { name?: string; version?: string | null } };
  };
  const name = manifest.source?.package?.name;
  if (typeof name !== 'string' || name === '') {
    process.stdout.write('опись бандла не называет пакет обвеса\n');
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
  declareDependency(args.cwd, name, manifest.source?.package?.version ?? null);

  process.stdout.write(
    `обвес ${name}${
      manifest.source?.package?.version === null ||
      manifest.source?.package?.version === undefined
        ? ''
        : `@${manifest.source.package.version}`
    } → ${target}\n\n`,
  );

  const outcome = await cli(
    [args.plan ? 'plan' : 'apply', '--cwd', args.cwd, ...args.rest],
    args.cwd,
  );
  process.stdout.write(outcome.stdout);
  return outcome.exitCode;
}

/**
 * Объявляет обвес зависимостью репозитория — вторая половина того, что делает
 * пакетный менеджер.
 *
 * `package.json` создаётся, если его нет: `npm i` в каталоге без манифеста
 * поступает так же, и отдельного правила для этого случая заводить не за чем.
 * Всё прочее в чужом манифесте не трогается — меняется ровно одна запись.
 */
function declareDependency(
  cwd: string,
  name: string,
  version: string | null,
): void {
  const path = join(cwd, 'package.json');
  const manifest = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>)
    : { name: 'repo', private: true };

  const dependencies = {
    ...((manifest['dependencies'] as Record<string, string>) ?? {}),
    [name]: version === null ? '*' : version,
  };

  writeFileSync(
    path,
    `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`,
    'utf-8',
  );
}
