/**
 * РЕПОЗИТОРИЙ ПОТРЕБИТЕЛЯ — то, откуда дверь зовут и куда она кладёт.
 *
 * Корень берётся ровно один: каталог, из которого дверь позвали (или `--cwd`).
 * Поиска вверх по дереву тут нет намеренно — «умный» поиск корня означал бы, что
 * один и тот же вызов из разных подкаталогов раскладывает по-разному, а прогон
 * в CI и у человека обязан быть один и тот же (`tasker:BASER2-20`).
 *
 * Конфиг потребителя дверь ЧИТАЕТ, а создаёт ровно один раз — когда его нет
 * вовсе. Дальше он пользовательский и авторитетный: движок в него не пишет и
 * ничего оттуда не чистит (`kb:BASER2-5`), и дверь ведёт себя так же.
 *
 * **Форма 2: здесь ТОЛЬКО перечень поставленного** (`tasker:BASER2-10` §3). Ни
 * одного значения: настройки и пресеты уехали в файл на инструмент
 * (`settings.ts`). Разделение не косметическое — конфиги человека лежат в одной
 * папке (`kb:BASER2-2` §4), а `baser.json` заполняет не он, а пакетный менеджер
 * через дверь.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CONSUMER_CONFIG_PATH,
  DECLARATION_BLOCK,
  FORM_VERSION,
  parseConsumerConfig,
  type ConsumerConfig,
  type FormProblem,
  type FormResult,
} from '@omnifield/baser-contracts';
import { locatePackage } from '@omnifield/baser-contracts/locate';
import type { SupplyOverride } from './supply.js';

/** Куда дверь пришла работать. */
export interface Repo {
  /** Абсолютный корень репозитория потребителя — он же корень дерева. */
  readonly root: string;
  /**
   * Имя репозитория — из имени его каталога.
   *
   * Из него растут имена, которые обвес считает резолвером (`ctx.repo.name`):
   * девбокс `<репозиторий>-devbox`, алиас в сети и прочее. Берётся каталог, а не
   * `name` из `package.json`: имя пакета бывает scope'нутым и служебным
   * (`@omnifield/baser-source`), а «имя репозитория» человек читает с диска.
   */
  readonly name: string;
}

export function readRepo(cwd: string): Repo {
  const root = resolve(cwd);
  return { root, name: basename(root) };
}

/** Конфиг потребителя и то, откуда он взялся. */
export interface ConsumerConfigState {
  /** Путь к `baser.json` относительно корня — он же адрес в сообщениях. */
  readonly path: string;
  /** Файл лежал на диске до прогона. */
  readonly existed: boolean;
  /**
   * Конфиг родила дверь этим прогоном. `plan` его только называет, `apply`
   * кладёт: конфиг рождается сразу пользовательским, поэтому режим владения ему
   * не нужен и движок о нём не знает.
   */
  readonly creates: boolean;
  readonly config: ConsumerConfig;
}

/**
 * Читает конфиг потребителя, а при его отсутствии — рождает.
 *
 * Засев идёт по УСТАНОВЛЕННЫМ зависимостям: обвес — это пакет, объявивший блок
 * `baser`, и другого признака у него нет. Вопросов пользователю при этом не
 * возникает ни одного (`tasker:BASER2-18`) — что поставлено, то и записано.
 *
 * Засев работает ТОЛЬКО когда файла нет. Существующий конфиг авторитетен
 * целиком: иначе снятый пользователем обвес возвращался бы в конфиг сам, и
 * отказаться от поставленного пакета стало бы нечем.
 *
 * Отказать чтение может и на засеве — когда поставленный пакет есть, а его
 * манифест непригоден: перечень, про который мы знаем, что он неполон, не
 * рождается вовсе (`discoverInstalledSources`).
 */
export function readConsumerConfig(
  repo: Repo,
  named: readonly SupplyOverride[] = [],
): FormResult<ConsumerConfigState> {
  const path = CONSUMER_CONFIG_PATH;
  const absolute = join(repo.root, path);

  if (!existsSync(absolute)) {
    const seeded = discoverInstalledSources(repo, named);
    if (!seeded.ok) {
      return seeded;
    }
    const config: ConsumerConfig = {
      // Версию формы проставляет дверь, а не пользователь: миграционный крючок
      // появляется, вводить его никто не вводит (`kb:BASER2-5`, §6 формы).
      formVersion: FORM_VERSION,
      // Ни пресетов, ни значений: их место — файл на инструмент. Записать сюда
      // пустые заготовки значило бы предъявить человеку два места под одно и
      // то же и обещать, что работает любое.
      sources: seeded.value.map((use) => ({ use })),
    };
    return {
      ok: true,
      value: { path, existed: false, creates: true, config },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf-8'));
  } catch (cause) {
    return {
      ok: false,
      problems: [
        {
          code: 'not-an-object',
          at: path,
          message: `конфиг не разбирается как JSON: ${describe(cause)}`,
        },
      ],
    };
  }

  const parsed = parseConsumerConfig(raw, path);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    value: { path, existed: true, creates: false, config: parsed.value },
  };
}

/**
 * Сериализация конфига — ровно то, что дверь кладёт при его рождении.
 *
 * Пишется поле в поле, а не `JSON.stringify` над разобранным объектом: форма
 * `baser.json` — это `formVersion` и `sources: [{ use }]`, и перечислить их
 * здесь значит сломаться заметно, если форма разъедется, вместо того чтобы тихо
 * вынести наружу чужое поле.
 */
export function serializeConsumerConfig(config: ConsumerConfig): string {
  return `${JSON.stringify(
    {
      formVersion: config.formVersion,
      sources: config.sources.map((entry) => ({ use: entry.use })),
    },
    null,
    2,
  )}\n`;
}

/**
 * Имена поставленных пакетов, объявивших себя обвесами.
 *
 * Проход по объявленным зависимостям, а не по всему `node_modules`: обвес — это
 * то, что потребитель поставил СЕБЕ, а не то, что приехало транзитивно с чужой
 * зависимостью. Порядок байтовый — конфиг, рождённый дважды на одной раскладке,
 * обязан выйти одинаковым.
 *
 * ── ДВА РАЗНЫХ «НЕ ПОЛУЧИЛОСЬ», И МОЛЧАНИЕ ТУТ РОВНО ОДНО ───────────────────
 *
 * Пока резолв путал «пакета нет» с «манифест непригоден» (`tasker:BASER2-127`),
 * у засева был один факт на оба случая, и не назвать его было честно: мы и
 * правда не знали. Резолв контрактов их развёл — и молчание про второй стало
 * бы уже не «мы не знаем», а «мы знаем и не говорим».
 *
 * **`package-not-installed` — молчим, и вот почему.** Засев отвечает на вопрос
 * «что ПОСТАВЛЕНО», а пакет, объявленный в зависимостях и не поставленный, лежит
 * за границей этого вопроса целиком: обвес он или нет, сказать может только его
 * манифест, а манифеста нет вовсе. Отказывать на таком соседе значило бы ронять
 * дверь в репозитории, где просто не сделан `install`, — причём ронять её на
 * пакете, к обвесам, возможно, никакого отношения не имеющем.
 *
 * **`package-manifest-unreadable` — отказываем.** Пакет лежит на диске, и
 * объявление обвеса живёт ровно в том файле, который прочитать не вышло: «обвес
 * ли это» — вопрос, на который у нас нет ответа, а не ответ «нет». Перечень
 * рождается ОДИН РАЗ и дальше авторитетен целиком (существующий конфиг засев не
 * трогает), поэтому дыра, допущенная при рождении, следующим прогоном не
 * лечится — человек чинит её правкой `baser.json` руками, и сперва догадавшись,
 * что чинить. Положить перечень, про который мы знаем, что он неполон, значит
 * соврать его полнотой.
 *
 * Цена отказа при этом маленькая: файла ещё нет, чинится названный файл, а
 * следующий прогон засевает заново — ничего не потеряно и ничего не застыло.
 *
 * ── НАЗВАННЫЙ КАТАЛОГ ПОСТАВКИ — ТОЖЕ «ПОСТАВЛЕНО» ──────────────────────────
 *
 * Поставку достаёт дверь, и обвес больше не обязан лежать в зависимостях
 * потребителя (`tasker:BASER2-146`). Значит в локации не на ноде объявленных
 * зависимостей нет вовсе — а вопрос «что поставлено» ответ имеет: то, каталог
 * чего человек назвал сам (`--source`). Ровно этим живёт ручная выдача: папку
 * бандла принесли в локацию, и перечень рождается по ней.
 *
 * Догадки тут нет: названный флагом каталог — прямое утверждение человека, а не
 * найденный дверью рядом файл. Существующий конфиг это по-прежнему не трогает.
 */
function discoverInstalledSources(
  repo: Repo,
  named: readonly SupplyOverride[],
): FormResult<string[]> {
  const manifest = join(repo.root, 'package.json');
  if (!existsSync(manifest)) {
    return { ok: true, value: [...named.map((supply) => supply.packageName)] };
  }

  let parsed: { dependencies?: unknown; devDependencies?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf-8'));
  } catch {
    // Битый манифест потребителя — не наша забота и не повод падать: обвесов из
    // него просто не видно, а конфиг родится пустым и скажет об этом вслух.
    return { ok: true, value: [] };
  }

  const names = new Set<string>();
  for (const block of [parsed.dependencies, parsed.devDependencies]) {
    if (typeof block === 'object' && block !== null) {
      for (const name of Object.keys(block)) {
        names.add(name);
      }
    }
  }

  // Названный каталог резолвом по имени не ищется — его назвали ПУТЁМ, и
  // спрашивать про него `node_modules` значило бы искать там, где человек уже
  // сказал «оно вот тут».
  const sources: string[] = namedSources(named);
  const problems: FormProblem[] = [];
  for (const name of [...names].sort()) {
    if (sources.includes(name)) {
      continue;
    }
    const installed = locatePackage(name, repo.root);
    if (!installed.ok) {
      // Код и слова — резолва: он назвал и файл, и то, что чинится этот случай
      // правкой файла, а не установкой. Второе описание одного события завело бы
      // два места для одной правды.
      problems.push(
        ...installed.problems.filter(
          (problem) => problem.code === 'package-manifest-unreadable',
        ),
      );
      continue;
    }
    if (declaresItselfSource(installed.value.manifest)) {
      sources.push(name);
    }
  }

  return problems.length === 0
    ? { ok: true, value: sources }
    : { ok: false, problems };
}

/**
 * Названные каталоги, в которых лежит именно ОБВЕС.
 *
 * Проверка та же, что и у поставленного пакета: объявил блок `baser` — обвес,
 * не объявил — молчим. Каталог, названный по ошибке, перечень не засевает, но и
 * отказом не становится: назвать его мог человек, только начинающий писать свой
 * обвес, а отказ на этом месте объявил бы дефектом его незаконченность.
 */
function namedSources(named: readonly SupplyOverride[]): string[] {
  const found: string[] = [];
  for (const supply of named) {
    const manifest = join(resolve(supply.path), 'package.json');
    if (!existsSync(manifest)) {
      continue;
    }
    try {
      if (declaresItselfSource(JSON.parse(readFileSync(manifest, 'utf-8')))) {
        found.push(supply.packageName);
      }
    } catch {
      // Непригодность манифеста назовёт доставание поставки: у него на это есть
      // свой код и свой адрес, а вторая правда об одном событии не нужна.
    }
  }
  return found.sort();
}

function declaresItselfSource(manifest: unknown): boolean {
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    (manifest as Record<string, unknown>)[DECLARATION_BLOCK] !== undefined
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
