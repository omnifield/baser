#!/usr/bin/env node
/**
 * ПЛАН ДЕВ-ВЫПУСКА: что именно уедет в дев-канал этим прогоном и что для этого
 * обязано уже лежать в реестре.
 *
 * Набор считается ПО РЕПОЗИТОРИЮ, а не по вводу человека при запуске. Номера
 * проставлены в манифестах и уже прошли гейт выпуска на PR — если бы набор
 * задавался вводом, про уезжающее было бы две правды, и разошлись бы они на
 * первом же расхождении, молча.
 *
 * Дев-канал берёт ТОЛЬКО предвыпускные номера нашей схемы — `<X.Y.Z>-dev.<N>`
 * (`kb:BASER3-20`). Отсюда «канал не врёт про себя» держится построением, а не
 * дисциплиной: стабильная тройка под меткой `dev` сюда просто не попадает.
 *
 * НОМЕР, КОТОРЫЙ УЖЕ УЕХАЛ, В НАБОР НЕ ПОПАДАЕТ. Выпуск номер в манифесте не
 * двигает — он там и остаётся после того, как сборка уехала. Значит признака
 * «несёт дев-номер» мало: по нему следующий дев-выпуск ЛЮБОГО пакета тащил за
 * собой всех, кто когда-либо выпускался и остался на том же номере, и краснел на
 * первом же из них (`tasker:BASER2-168`). Признак здесь — «несёт дев-номер,
 * который ещё НЕ выпускался», и вторую половину репозиторий знает сам: тег
 * `<имя>@<номер>` ставит этот же конвейер сразу после публикации.
 *
 * ПРОПУЩЕННОЕ НАЗЫВАЕТСЯ ВСЛУХ — списком `held` в плане и строкой в выводе.
 * Молча выпавший пакет неотличим от забытого: человек, не поднявший номер после
 * выпуска, узнал бы об этом не здесь, а тем, что его правка никуда не уехала.
 *
 * ТЕГ — НЕ ПОСЛЕДНЯЯ ИНСТАНЦИЯ, а локальный и осторожный её слепок. Занят номер
 * или нет, знает реестр, и спрашивают его шагом позже, с правом на чтение.
 * Разойтись они могут ровно в одну сторону — публикация прошла, а тег не встал;
 * тогда пакет останется в наборе, и остановит его реестр. Обратной стороны нет:
 * тега без публикации этот конвейер не ставит.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Не судит номера: старшинство, «назад не идёт» и «номер занят»
 * — работа гейта `@omnifield/baser-release`, он стоит на каждом PR, и
 * дублировать его суждение конвейеру нечего (`tasker:BASER2-158`). Тег читается
 * здесь не ради суждения о номере, а ради состава набора.
 *
 * ЗАВИСИМОСТЕЙ НЕТ, и по той же причине, что у гейта: план считается ДО
 * `pnpm install`, чтобы прогон падал на «нечего выпускать» за секунды, а не
 * после установки зависимостей.
 *
 * ```
 * node .github/scripts/dev-release-plan.mjs [--root <каталог>]
 * ```
 *
 * stdout — план в JSON (его читает воркфлоу), stderr — то же для человека.
 * Выход `0` — план есть, `1` — выпускать нечего, `2` — позван неверно.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Каталог с пакетами монорепы — раскладка «один пакет = одна зона». */
const PACKAGES = 'packages';

/**
 * Номер дев-сборки: тройка плюс суффикс `-dev.<N>` (`kb:BASER3-20`). Форма
 * сомкнута с обоих концов намеренно — `0.3.0-dev.1+meta` или `0.3.0-beta.1`
 * это не наш дев-канал, и молча принимать их за него нельзя.
 */
export const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+$/;

/** Ссылка на соседа по монорепе: `workspace:*`, `workspace:^`, `workspace:~`. */
const WORKSPACE = /^workspace:/;

/**
 * @typedef {object} Manifest
 * @property {string} name
 * @property {string} version
 * @property {string} dir      путь каталога пакета от корня репозитория
 * @property {boolean} private
 * @property {Record<string, string>} dependencies
 */

/**
 * Пакеты монорепы как они объявлены в манифестах.
 *
 * @param {string} where корень репозитория
 * @returns {Manifest[]}
 */
export function readPackages(where) {
  const dir = join(where, PACKAGES);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((entry) => existsSync(join(dir, entry, 'package.json')))
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(join(dir, entry, 'package.json'), 'utf-8'),
      );
      return {
        name: manifest.name,
        version: manifest.version,
        dir: `${PACKAGES}/${entry}`,
        private: Boolean(manifest.private),
        dependencies: manifest.dependencies ?? {},
      };
    });
}

/**
 * Теги выпуска, уже стоящие в репозитории.
 *
 * Форма тега — `<имя>@<номер>`, она задана `nx.json` (`releaseTag.pattern`), и
 * ставит их шаг «Тег выпуска» этого же конвейера. Сравниваем целой строкой, а не
 * разбором: у имён со скоупом два символа `@`, и разбор здесь ничего не даёт.
 *
 * @param {string} root корень репозитория
 * @returns {Set<string>}
 */
export function releasedTags(root) {
  const out = execFileSync('git', ['tag', '--list'], {
    cwd: root,
    encoding: 'utf-8',
  });
  return new Set(
    out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

/**
 * @typedef {object} Shipment
 * @property {string} name
 * @property {string} version
 * @property {string} dir
 * @property {string} tag
 */

/**
 * @typedef {object} Plan
 * @property {Shipment[]} publish   уезжает этим прогоном
 * @property {{name: string, version: string, neededBy: string}[]} requires
 *   соседи, которых прогон не выпускает, но на которых выпускаемое ссылается
 * @property {Shipment[]} held      дев-номер есть, но он уже выпускался
 */

/**
 * План по манифестам и уже выпущенным тегам. Фактов не добывает — иначе его
 * нельзя было бы прогнать на наборе, которого в рабочем дереве нет.
 *
 * @param {Manifest[]} packages
 * @param {ReadonlySet<string>} released теги выпуска, уже стоящие в репозитории
 * @returns {Plan}
 */
export function plan(packages, released) {
  /** Непубличное отсекается там же, где и не-дев-номера. */
  const candidates = packages
    .filter((pkg) => !pkg.private && DEV_VERSION.test(pkg.version ?? ''))
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      dir: pkg.dir,
      tag: `${pkg.name}@${pkg.version}`,
    }));

  const publish = candidates.filter((entry) => !released.has(entry.tag));
  const held = candidates.filter((entry) => released.has(entry.tag));

  const shipping = new Set(publish.map((entry) => entry.name));

  /**
   * Соседи, которых этот прогон НЕ выпускает, но на которых выпускаемое
   * ссылается.
   *
   * Ссылка `workspace:*` превращается при публикации в ТОЧНЫЙ номер соседа из
   * рабочего дерева. Значит выпуск одной двери молча обещает потребителю, что
   * названные номера соседей в реестре уже есть, — а если их там нет, узнает он
   * об этом установкой, а не выпуском. Поэтому они выписаны отдельным списком:
   * реестр спрашивается про них ДО публикации.
   *
   * Придержанный сосед попадает сюда же, и это не исключение из правила, а оно
   * само: его номер в реестре уже лежит, и проверка это подтвердит.
   *
   * @type {{name: string, version: string, neededBy: string}[]}
   */
  const requires = [];
  const seen = new Set();

  for (const pkg of packages) {
    if (!shipping.has(pkg.name)) continue;
    for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
      if (!WORKSPACE.test(range) || shipping.has(dep)) continue;
      const neighbour = packages.find((entry) => entry.name === dep);
      if (neighbour === undefined) continue;
      const key = `${dep}@${neighbour.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requires.push({ name: dep, version: neighbour.version, neededBy: pkg.name });
    }
  }

  return { publish, requires, held };
}

/**
 * План словами — тот же факт, что и в JSON, но для человека в логе прогона.
 *
 * Живёт рядом с планом и пробуется вместе с ним: вывод, разошедшийся с планом,
 * хуже его отсутствия — по нему судят о прогоне, не открывая JSON.
 *
 * @param {Plan} result
 * @param {Manifest[]} packages все пакеты дерева — их называет отказ
 * @returns {string[]}
 */
export function report(result, packages) {
  const { publish, requires, held } = result;
  const lines = [];

  if (publish.length === 0) {
    lines.push('ДЕВ-ВЫПУСК: выпускать нечего.', '');
    if (held.length > 0) {
      lines.push(
        'Дев-номера есть, но все они УЖЕ ВЫПУЩЕНЫ — занятый номер не',
        'переиспользуется (kb:BASER3-20). Подними номер тому, что должно уехать:',
      );
      for (const entry of held) lines.push(`  · ${entry.name}@${entry.version}`);
    } else {
      lines.push(
        'Ни один пакет не несёт дев-номера. Дев-канал берёт номера вида',
        '<мажор>.<минор>.<патч>-dev.<N> и только их. Номер проставляет человек в',
        'package.json пакета, а не конвейер при запуске: на нулевых мажорах',
        'считалка версий информации не несёт (tasker:BASER2-95).',
      );
    }
    lines.push('', 'Сейчас в дереве:');
    for (const pkg of packages) {
      lines.push(
        `  · ${pkg.name}: ${pkg.version}${pkg.private ? ' (невыпускаемый)' : ''}`,
      );
    }
    return lines;
  }

  lines.push('ДЕВ-ВЫПУСК: уезжает');
  for (const entry of publish) lines.push(`  · ${entry.name}@${entry.version}`);

  if (held.length > 0) {
    lines.push(
      '',
      'НЕ уезжает — этот номер уже выпускался, а в манифесте не двинулся:',
    );
    for (const entry of held) lines.push(`  · ${entry.name}@${entry.version}`);
    lines.push(
      'Так и задумано: занятый номер не переиспользуется. Но если правка в этом',
      'пакете уехать ДОЛЖНА — подними ему номер, иначе она не уедет и в этот раз.',
    );
  }

  if (requires.length > 0) {
    lines.push('', 'Обязано уже лежать в реестре (ссылки выпускаемого на соседей):');
    for (const entry of requires) {
      lines.push(`  · ${entry.name}@${entry.version} — нужен ${entry.neededBy}`);
    }
  }

  return lines;
}

/**
 * Запуск в конвейере.
 *
 * @param {string[]} argv аргументы после имени скрипта
 * @returns {number} код выхода
 */
function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? process.cwd() : argv[rootFlag + 1];

  if (rootFlag !== -1 && !root) {
    console.error('dev-release-plan: у --root не назван каталог');
    return 2;
  }

  const packages = readPackages(root);

  /** @type {Set<string>} */
  let released;
  try {
    released = releasedTags(root);
  } catch {
    // Теги — половина ответа о составе набора, и половина эта здесь
    // обязательная: без них план вернул бы к поведению, которое чинит
    // `tasker:BASER2-168`, и вернул бы молча.
    console.error(
      `dev-release-plan: теги выпуска не прочитаны — «${root}» не репозиторий git или git недоступен`,
    );
    return 2;
  }

  const result = plan(packages, released);
  for (const line of report(result, packages)) console.error(line);

  if (result.publish.length === 0) return 1;

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
