/**
 * ГДЕ ЛЕЖИТ СОДЕРЖИМОЕ ОБВЕСА У ПОТРЕБИТЕЛЯ — вход для чужого рантайм-кода.
 *
 * Обвес везёт не только файлы, но и КОД, который живёт у потребителя и работает
 * после установки: хуки, генераторы, проверяльщики. Такому коду нужен
 * собственный файл обвеса — эталон, схема, шаблон, — и сказать об этом форме
 * было нечем (`tasker:BASER2-121` Н1, заход `tasker:BASER2-122`).
 *
 * Оба варианта, которые форма давала, неверны:
 *
 *   · объявить артефактом — появляется `dest`, то есть место в дереве
 *     потребителя и владелец. Но человеку файл не нужен, а оказавшись в
 *     репозитории, он начнёт расходиться с пакетом;
 *   · не везти — код не работает.
 *
 * Первый чужой обвес вышел из этого сам: прочитал `baser.json` потребителя,
 * отрезолвил объявленные пакеты, сверил личность и взял файл из `contentRoot`.
 * Обходом это не было — использованы публичные факты формы. Но это **навигация
 * по нашей форме, написанная в чужом коде**, и следующий обвес с рантайм-частью
 * написал бы её заново, по-своему. Чем кончается, когда чужая зона держится за
 * наши внутренности, мы уже видели (`tasker:BASER2-59`).
 *
 * Поэтому навигация переезжает СЮДА. Форма при этом не расширена: раздела
 * «содержимое, не являющееся артефактом» здесь нет и не заводится — объявление
 * обвеса от этого захода не изменилось ни на одно поле. Изменилось только то,
 * что дорогу к уже объявленному `contentRoot` показываем мы, а не каждый сам.
 *
 * ── ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ВХОД ПАКЕТА ────────────────────────────────────────
 *
 * `@omnifield/baser-contracts` обещает, что **ничего не читает и ничего не
 * исполняет**: JSON подаёт дверь, резолверы зовёт тоже она. Обещание несущее —
 * против него написаны все зоны, — и размывать его до «ничего, кроме вот
 * этого» нельзя: обещание с оговоркой перестаёт быть обещанием.
 *
 * Здесь оно не размыто, а РАЗГРАНИЧЕНО, и граница машинная, а не словесная:
 *
 *   `@omnifield/baser-contracts`         — форма. Ничего не читает. Как было.
 *   `@omnifield/baser-contracts/locate`  — этот модуль. Читает ФС и резолвит
 *                                          пакеты, и это видно прямо в импорте.
 *
 * Разбор формы чистым и остался: то, что делает этот модуль, — не разбор.
 * «Где у потребителя лежит установленный пакет» — факт файловой системы, и
 * чистой функцией он не бывает по построению.
 *
 * ── ОТКАЗЫ — ДАННЫЕ, А НЕ БРОСОК ────────────────────────────────────────────
 *
 * Исполняется это НА СТОРОНЕ ПОТРЕБИТЕЛЯ, в его репозитории, чужим кодом и в
 * обстановке, которой мы не управляем: обвеса может не быть, `baser.json` может
 * не быть, личность может не совпасть, файл может не приехать. Каждый случай
 * назван своим кодом и своим текстом, потому что чинятся они по-разному, а
 * сырой бросок из `node:fs` не сказал бы ни одному из них правильного слова.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseConsumerConfig } from './config.js';
import { readSourceDeclaration } from './declaration.js';
import {
  byBytes,
  checkPath,
  CONSUMER_CONFIG_PATH,
  PATH_PROBLEM,
} from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';

/** Откуда искать репозиторий потребителя. */
export interface LocateOptions {
  /**
   * Любой путь ВНУТРИ репозитория потребителя; по умолчанию — рабочий каталог.
   *
   * Не корень, а «где-то внутри», намеренно: хук запускают из подкаталога чаще,
   * чем принято думать, и требовать от чужого кода вычислить корень значило бы
   * оставить ему ровно ту навигацию, ради снятия которой этот вход и заведён.
   * Корнем считается ближайший каталог вверх, где лежит перечень поставленного.
   */
  readonly from?: string;
}

/** Найденный обвес у потребителя — всё абсолютными путями. */
export interface LocatedSource {
  /** Личность, по которой искали, — она же `source.id` объявления. */
  readonly id: string;
  /** Чем привезли: имя пакета из перечня поставленного. */
  readonly packageName: string;
  /** Версия из манифеста пакета; `null` — версии в манифесте нет. */
  readonly version: string | null;
  /** Корень репозитория потребителя — каталог с `baser.json`. */
  readonly repoRoot: string;
  /** Корень пакета обвеса — каталог с его `package.json`. */
  readonly packageRoot: string;
  /** Абсолютный путь к `contentRoot` пакета: тут лежит содержимое обвеса. */
  readonly contentRoot: string;
}

/**
 * Находит обвес по его ЛИЧНОСТИ среди поставленных у потребителя.
 *
 * Личность, а не имя пакета: пакет — доставка, `id` — личность, и меняются они
 * порознь (`declaration.ts`). Обвес, переехавший в другой пакет, остаётся собой
 * — код, написанный против личности, переживает переезд, а против имени пакета
 * не переживёт.
 */
export function locateSource(
  sourceId: string,
  options: LocateOptions = {},
): FormResult<LocatedSource> {
  const from = resolve(options.from ?? process.cwd());
  const log = new ProblemLog();

  const repoRoot = findRepoRoot(from);
  if (repoRoot === null) {
    log.add(
      'consumer-config-missing',
      CONSUMER_CONFIG_PATH,
      `перечня поставленного нет ни в "${from}", ни выше по дереву. ` +
        'Либо это не репозиторий потребителя, либо обвесы в нём не ставили — ' +
        'передай options.from изнутри нужного репозитория',
    );
    return { ok: false, problems: log.list() };
  }

  const configPath = join(repoRoot, CONSUMER_CONFIG_PATH);
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (cause) {
    log.add(
      'consumer-config-unreadable',
      configPath,
      `перечень поставленного не разбирается как JSON: ${describe(cause)}`,
    );
    return { ok: false, problems: log.list() };
  }

  const config = parseConsumerConfig(document, configPath);
  if (!config.ok) {
    // Отказы перечня отдаём как есть: они уже названы формой, и переписывать их
    // своими словами значило бы завести второе описание одного события.
    return config;
  }

  /** Личности, которые у потребителя ЕСТЬ, — материал для отказа. */
  const found: string[] = [];
  /** Пакеты, до объявления которых дойти не удалось, и почему. */
  const skipped: string[] = [];

  for (const entry of config.value.sources) {
    const installed = resolvePackage(entry.use, repoRoot);
    if (!installed.ok) {
      skipped.push(`${entry.use} — ${installed.detail}`);
      continue;
    }

    // Соседнее объявление бывает непригодным (чужая форма, опечатка), и это не
    // повод обрывать поиск: искомый обвес может лежать следующим. Непригодность
    // назовёт разбор того обвеса, а не этот вход.
    const declared = readSourceDeclaration(
      installed.manifest,
      `${entry.use}/package.json`,
    );
    if (!declared.ok) {
      skipped.push(`${entry.use} — объявление непригодно`);
      continue;
    }

    const { source } = declared.value;
    found.push(source.id);
    if (source.id !== sourceId) {
      continue;
    }

    const contentRoot = resolve(installed.root, source.contentRoot);
    if (!isDirectory(contentRoot)) {
      log.add(
        'content-missing',
        contentRoot,
        `обвес "${sourceId}" объявил contentRoot "${source.contentRoot}", ` +
          'но в поставленном пакете такого каталога нет — содержимое не уехало в пакет ' +
          '(проверь "files" в его манифесте)',
      );
      return { ok: false, problems: log.list() };
    }

    return {
      ok: true,
      value: {
        id: source.id,
        packageName: entry.use,
        version: versionOf(installed.manifest),
        repoRoot,
        packageRoot: installed.root,
        contentRoot,
      },
    };
  }

  log.add(
    'source-not-installed',
    configPath,
    `обвеса с личностью "${sourceId}" среди поставленных нет` +
      (found.length
        ? `; поставлены: ${[...found].sort(byBytes).join(' · ')}`
        : ' — перечень поставленного пуст') +
      (skipped.length ? `. Не удалось посмотреть: ${skipped.join('; ')}` : ''),
  );
  return { ok: false, problems: log.list() };
}

/**
 * Абсолютный путь к файлу ВНУТРИ содержимого обвеса — то, ради чего вход заведён.
 *
 * ```js
 * const эталон = locateSourceContent('brainer/agent-harness', 'settings.hooks.json');
 * if (!эталон.ok) { console.error(describeProblems(эталон.problems)); return; }
 * readFileSync(эталон.value, 'utf-8');
 * ```
 *
 * Путь проверяется теми же правилами, что `src` записи раскладки (`paths.ts`):
 * склеивать его самому чужому коду не надо, и выйти `..` за пределы содержимого
 * он не сможет. **Существование файла проверяется здесь же:** вернуть путь к
 * тому, чего нет, значит отдать отказ дальше по цепочке, где он назовётся хуже.
 */
export function locateSourceContent(
  sourceId: string,
  path: string,
  options: LocateOptions = {},
): FormResult<string> {
  const located = locateSource(sourceId, options);
  if (!located.ok) {
    return located;
  }

  const checked = checkPath(path);
  if (!checked.ok) {
    return {
      ok: false,
      problems: [
        {
          code: 'invalid-path',
          at: path,
          message:
            `${PATH_PROBLEM[checked.problem]} — путь отсчитывается от contentRoot обвеса ` +
            'и за его пределы не выходит',
        },
      ],
    };
  }

  const file = join(located.value.contentRoot, checked.path);
  if (!existsSync(file)) {
    return {
      ok: false,
      problems: [
        {
          code: 'content-missing',
          at: file,
          message:
            `обвес "${sourceId}" поставлен (${located.value.packageName}), но файла ` +
            `"${checked.path}" в его содержимом нет — либо он не уехал в пакет, либо имя другое`,
        },
      ],
    };
  }

  return { ok: true, value: file };
}

/**
 * Корень репозитория потребителя — ближайший вверх каталог с перечнем.
 *
 * Именно перечень, а не `package.json` и не `.git`: перечень поставленного —
 * СЛОВО САМОЙ ФОРМЫ, и искать по нему мы вправе. Искать по чужим признакам
 * значило бы завести догадку о чужом инструменте там, где у нас есть свой факт.
 */
function findRepoRoot(from: string): string | null {
  for (let current = from; ; current = dirname(current)) {
    if (existsSync(join(current, CONSUMER_CONFIG_PATH))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
  }
}

interface ResolvedPackage {
  readonly ok: true;
  readonly root: string;
  readonly manifest: unknown;
}

/**
 * Находит пакет так же, как его нашёл бы сам репозиторий потребителя.
 *
 * Резолв ведётся ОТ КОРНЯ ПОТРЕБИТЕЛЯ, а не от каталога вызывающего: обвес
 * поставлен пользователю, и его раскладка на диске (плоская, симлинки pnpm,
 * hoisting) — свойство его репозитория.
 *
 * **Тот же резолв держит у себя дверь** (`baser-cli`, `installed.ts`): ей он
 * нужен был раньше, чем появился этот вход, и зависеть от неё контракты не
 * могут — стрелка идёт в другую сторону. Два места для одного факта названы
 * вслух, чтобы разъехаться молча они не могли; сводить их — заход зоны двери.
 */
function resolvePackage(
  packageName: string,
  repoRoot: string,
): ResolvedPackage | { readonly ok: false; readonly detail: string } {
  const require = createRequire(join(repoRoot, 'package.json'));

  let manifestPath: string | null = null;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    manifestPath = manifestByWalkingUp(require, packageName);
  }

  if (manifestPath === null) {
    return { ok: false, detail: 'пакет не резолвится, то есть не поставлен' };
  }

  try {
    return {
      ok: true,
      root: dirname(manifestPath),
      manifest: JSON.parse(readFileSync(manifestPath, 'utf-8')),
    };
  } catch (cause) {
    return { ok: false, detail: `манифест не читается: ${describe(cause)}` };
  }
}

/**
 * Манифест пакета, закрывшего `./package.json` в `exports`.
 *
 * Идём от точки входа вверх до `package.json` с ТЕМ ЖЕ именем: подниматься до
 * первого попавшегося нельзя — у вложенной зависимости он бы тоже нашёлся, и мы
 * прочитали бы объявление не того пакета.
 */
function manifestByWalkingUp(
  require: NodeJS.Require,
  packageName: string,
): string | null {
  let dir: string;
  try {
    dir = dirname(require.resolve(packageName));
  } catch {
    return null;
  }

  for (let current = dir; ; current = dirname(current)) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: unknown;
        };
        if (parsed.name === packageName) {
          return candidate;
        }
      } catch {
        // Битый манифест по дороге наверх не обрывает поиск: искомый выше.
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
  }
}

function versionOf(manifest: unknown): string | null {
  const head = manifest as { version?: unknown };
  return typeof head.version === 'string' && head.version.trim() !== ''
    ? head.version
    : null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
