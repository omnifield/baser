#!/usr/bin/env node
/**
 * ПРИЁМКА ПУБЛИЧНОГО ВЫПУСКА: судится то, что УЕХАЛО, а не то, что собрано.
 *
 * Всё, что стоит в выпускном потоке до этого шага, судит рабочее дерево: пробы
 * бегут из исходников, сборка резолвится раскладкой монорепы, соседи лежат
 * рядом ссылками. Потребитель не получает ничего из этого — он получает тарбол
 * из публичного реестра и ставит его в пустой каталог. Разница между этими
 * двумя мирами уже стоила нам выпуска: `@omnifield/baser-registry@0.1.0-dev.1`
 * был зелёным в монорепе целиком — 69 проб, приёмка семи пунктов, `pnpm verify`
 * код 0 — и падал у потребителя на первой же команде (`tasker:BASER2-251`).
 *
 * Здесь этот класс закрыт единственным способом, который на него отвечает:
 * **установкой из публичного реестра в чистое место**.
 *
 * ── ЧТО ИМЕННО ЗДЕСЬ ДОКАЗЫВАЕТСЯ ───────────────────────────────────────────
 *
 * Шаг стоит ПОСЛЕ переименования (`public-rename.mjs`) и потому судит уже
 * публичные имена. Дефект, ради которого переименование существует, виден
 * только отсюда: манифест переименован, а собранный код внутри по-прежнему
 * зовёт `@baser/contracts` — в монорепе это резолвится соседом, у потребителя
 * не резолвится ничем.
 *
 * | что проверяется                          | какой дефект ловит                        |
 * | ---------------------------------------- | ----------------------------------------- |
 * | номер виден в реестре                    | публикация «прошла», а пакета нет         |
 * | установка в пустой каталог               | `workspace:*` и прочее нерезолвимое       |
 * | зависимости установленного — публичные   | внутреннее имя доехало до потребителя     |
 * | КАЖДАЯ объявленная дверь ЗАГРУЖАЕТСЯ     | оставшийся внутренний спецификатор в коде |
 * | объявленный бинарь ДОХОДИТ ДО СВОЕГО КОДА | падение на первой же команде             |
 *
 * Загрузка — именно загрузка, а не резолв пути: `require.resolve` проходит по
 * одному файлу и не трогает то, что этот файл импортирует, а весь класс дефекта
 * живёт как раз в импортах на второй ступени. Проба, проверяющая строку вместо
 * запуска, зеленеет на пути, который никуда не ведёт, — это и был второй урок
 * `tasker:BASER2-251`.
 *
 * ── ДВЕРИ БЕРУТСЯ ИЗ ОБЪЯВЛЕНИЯ, А НЕ ИЗ ДОГАДКИ «ИМЯ ПАКЕТА» ───────────────
 *
 * Первый заход грузил каждый пакет по его имени — и репетиция прогона
 * (2026-08-09, свой реестр, копия дерева) сразу показала, что это не правило, а
 * догадка: `@baser/devbox` объявляет только `./defaults.mjs`, а `@baser/git`
 * не объявляет ни одной поверхности вовсе — он везёт шаблоны. Обоим «нет главного
 * входа» — нормальное устройство, а не дефект.
 *
 * Поэтому грузится ровно то, что пакет ОБЪЯВИЛ в `exports`: `.` — по имени,
 * `./locate` — подпутём. Это заодно строже прежнего: подпуть, который обязан
 * пережить переименование (`@omnifield/baser-contracts/locate`), теперь тоже
 * под проверкой. Дверей не объявлено — грузить нечего, и это не отказ.
 *
 * ── ХОЛОДНЫЙ КЭШ — УСЛОВИЕ, А НЕ НАСТРОЙКА ──────────────────────────────────
 *
 * Пакетный менеджер при недоступном или неспрошенном реестре отдаёт устаревшую
 * запись вместо отказа (`tasker:BASER2-161`). На прогретом кэше «поставили —
 * встало» доказательством не является: проверяется фантом, пакет, которого в
 * реестре может не быть вовсе. Поэтому кэш здесь СВЕЖИЙ на каждый прогон и
 * лежит внутри чистого места, а не там, где его нашёл npm.
 *
 * По той же причине названы явно ещё две вещи: **адрес реестра** (иначе
 * подцепится зеркало или прокси, настроенные на машине) и **файл настроек npm**
 * (иначе в установку приедет `.npmrc` раннера — с чужим реестром и токеном).
 * Чистое место, которое зависит от обстановки машины, чистым не является.
 *
 * ── ЧЕГО ЗДЕСЬ НЕТ ──────────────────────────────────────────────────────────
 *
 * Сборки. Ни одной строки из рабочего дерева в проверяемое не попадает — иначе
 * это была бы та же приёмка исходника, только дороже.
 *
 * Отката. Уехавший номер занят навсегда (политика unpublish npmjs.com, сверено
 * 2026-08-06), и красная приёмка это не отменяет: она называет, что выпуск не
 * работает у потребителя, а починка едет СЛЕДУЮЩИМ номером. Что делать с
 * красным — говорит отказ (`release-refusal.mjs`, рубеж `delivered`).
 *
 * ```
 * node .github/scripts/public-acceptance.mjs --report <отчёт переименования>
 *      [--registry <url>] [--attempts <N>]
 * ```
 *
 * Отчёт — stdout `public-rename.mjs`: имена и номера берутся оттуда, а не
 * считаются заново, потому что уехало ровно то, что назвал тот шаг.
 * stdout — markdown для сводки прогона. Выход `0` — выпуск принят, `1` — не
 * принят, `2` — позван неверно.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Публичный реестр — тот же, что в `kb:ADR-19`. */
export const REGISTRY = 'https://registry.npmjs.org';

/**
 * Сколько раз спрашиваем реестр про только что уехавший номер и с какой паузой.
 *
 * Публикация и видимость номера — не одно событие: между `npm publish` и
 * ответом реестра на `npm view` бывает задержка распространения. Приёмка,
 * краснеющая на ней, не находит дефектов — она их прячет, потому что красный
 * без причины перестают читать. Ожидание при этом ОГРАНИЧЕНО: «ждём, пока
 * появится» без предела превращает отсутствие пакета в вечно жёлтый прогон.
 */
export const APPEARANCE = { attempts: 10, pauseMs: 6000 };

/** Блоки манифеста, где имя соседа — ссылка, а не текст. */
const DEPENDENCY_BLOCKS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * Отказ приёмки: выпуск НЕ принят, и причина названа словами.
 */
export class AcceptanceRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AcceptanceRefusal';
  }
}

/**
 * @typedef {object} Subject
 * @property {string} name публичное имя — под ним пакет лежит в реестре
 * @property {string} version номер, который уехал
 * @property {string} internal внутреннее имя — только чтобы узнать его у потребителя
 */

/**
 * Что принимаем — по отчёту переименования.
 *
 * ИМЕНА БЕРУТСЯ ИЗ ОТЧЁТА, А НЕ ИЗ ДЕРЕВА: уехало ровно то, что назвал шаг
 * переименования, и второй подсчёт того же был бы вторым источником правды.
 *
 * @param {any} report отчёт `public-rename.mjs`
 * @returns {Subject[]}
 */
export function plan(report) {
  const renamed = report?.renamed;
  if (!Array.isArray(renamed) || renamed.length === 0) {
    throw new AcceptanceRefusal(
      'отчёт переименования не называет ни одного пакета. Пустая приёмка зеленеет всегда и не обещает ничего — а вызвана она после публикации, то есть по факту уехавшего.',
    );
  }

  return renamed.map((entry) => {
    if (!entry?.public || !entry?.version) {
      throw new AcceptanceRefusal(
        `запись отчёта не называет публичное имя или номер: ${JSON.stringify(entry)}. Принимать по неполной записи значит принимать не тот пакет.`,
      );
    }
    return {
      name: entry.public,
      version: entry.version,
      internal: entry.internal,
    };
  });
}

/**
 * @typedef {object} Spot
 * @property {string} root чистый каталог — не репозиторий
 * @property {string} cache свежий кэш npm на этот прогон
 * @property {string} npmrc пустые настройки npm — обстановка машины не приезжает
 * @property {string} registry адрес реестра, названный явно
 */

/**
 * Чистое место: каталог, свой кэш и свои настройки.
 *
 * @param {string} root
 * @param {string} registry
 * @returns {Spot}
 */
export function spotOf(root, registry) {
  return {
    root,
    cache: join(root, 'cache'),
    npmrc: join(root, 'npmrc'),
    registry,
  };
}

/**
 * Аргументы, которыми чистое место остаётся чистым, — одни на все вызовы npm.
 *
 * @param {Spot} spot
 * @returns {string[]}
 */
export function isolation(spot) {
  return [
    '--registry',
    spot.registry,
    '--cache',
    spot.cache,
    '--userconfig',
    spot.npmrc,
  ];
}

/**
 * Вопрос реестру: виден ли этот номер.
 *
 * @param {Subject} subject
 * @param {Spot} spot
 * @returns {string[]}
 */
export function viewArgs(subject, spot) {
  return [
    'view',
    `${subject.name}@${subject.version}`,
    'version',
    ...isolation(spot),
  ];
}

/**
 * Установка — точными номерами, а не диапазонами.
 *
 * Диапазон привёл бы сюда не тот пакет, который мы только что выпустили, и
 * приёмка судила бы прошлый выпуск (`tasker:BASER2-251`, где диапазон
 * `^6.3.2` увёз потребителю не ту сборку чужого пакета).
 *
 * @param {Subject[]} subjects
 * @param {Spot} spot
 * @returns {string[]}
 */
export function installArgs(subjects, spot) {
  return [
    'install',
    ...subjects.map((subject) => `${subject.name}@${subject.version}`),
    '--no-audit',
    '--no-fund',
    ...isolation(spot),
  ];
}

/**
 * Внутренние имена, оставшиеся в зависимостях УСТАНОВЛЕННОГО манифеста.
 *
 * Это последний рубеж, где дефект ещё называется словами: у потребителя он
 * выглядит как отказ установки или падение импорта.
 *
 * @param {Record<string, any>} manifest
 * @param {ReadonlySet<string>} internals внутренние имена набора
 * @returns {string[]}
 */
export function internalLeftovers(manifest, internals) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const block of DEPENDENCY_BLOCKS) {
    for (const dep of Object.keys(manifest[block] ?? {})) {
      if (internals.has(dep)) found.add(dep);
    }
  }
  return [...found];
}

/**
 * Признаки того, что запуск НЕ ДОШЁЛ до своего кода: сорвался резолв поставки.
 *
 * Ровно этот класс ловится приёмкой — `ERR_PACKAGE_PATH_NOT_EXPORTED` из
 * `tasker:BASER2-251` стоит здесь первым не случайно.
 */
const NOT_LOADED = [
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_PACKAGE_IMPORT_NOT_DEFINED',
  'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_INVALID_MODULE_SPECIFIER',
  'ERR_REQUIRE_ESM',
  'MODULE_NOT_FOUND',
  'Cannot find module',
  'Cannot find package',
];

/**
 * Дошла ли команда до своего кода.
 *
 * СУДИТСЯ НЕ КОД ВЫХОДА, А ТО, ЗАПУСТИЛАСЬ ЛИ ПОСТАВКА. Инструмент вправе
 * ответить отказом на пустой каталог — `baser-release-names` так и делает, и
 * это его работа, а не дефект выпуска (репетиция 2026-08-09). Приёмка судит
 * другое: сорвался резолв — команда не выполнялась вовсе, и у потребителя она
 * не выполнится никогда.
 *
 * Судить по коду выхода значило бы требовать от каждого инструмента понимать
 * `--help` и любить пустой каталог — требование к чужим зонам, которое приёмка
 * выпуска предъявлять не должна. Судить по «запустилось хоть как-то» —
 * пропустить ровно тот дефект, ради которого она есть.
 *
 * @param {{status: number|null, stdout: string, stderr: string}} run
 * @returns {{loaded: boolean, marker?: string}}
 */
export function launched(run) {
  if (run.status === 0) return { loaded: true };
  const said = `${run.stderr}\n${run.stdout}`;
  const marker = NOT_LOADED.find((sign) => said.includes(sign));
  return marker === undefined ? { loaded: true } : { loaded: false, marker };
}

/**
 * Двери пакета — то, что потребитель может у него импортировать.
 *
 * Форма `exports` у npm многозначная, и различать её надо здесь, а не гадать:
 *
 * | объявлено                          | двери                          |
 * | ---------------------------------- | ------------------------------ |
 * | карта подпутей (`"."`, `"./locate"`) | имя пакета и `имя/locate`      |
 * | только `"./package.json"`          | ни одной — пакет везёт не код  |
 * | строка или карта условий           | имя пакета                     |
 * | `exports` нет, но есть `main`      | имя пакета                     |
 *
 * Шаблоны с `*` пропускаются: это не дверь, а правило, и загрузить его нельзя.
 *
 * @param {Record<string, any>} manifest
 * @returns {string[]} спецификаторы, которые обязаны загружаться у потребителя
 */
export function doors(manifest) {
  const exported = manifest.exports;

  if (exported === undefined || exported === null) {
    return manifest.main === undefined ? [] : [manifest.name];
  }
  if (typeof exported === 'string') return [manifest.name];

  const keys = Object.keys(exported);
  // Карта условий (`import`/`require`/`default`), а не подпутей: дверь одна.
  if (!keys.some((key) => key.startsWith('.'))) return [manifest.name];

  return keys
    .filter((key) => key.startsWith('.') && key !== './package.json')
    .filter((key) => !key.includes('*'))
    .map((key) =>
      key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`,
    );
}

/**
 * Объявленные пакетом команды.
 *
 * Форма `bin` у npm двойная: строка (одна команда именем пакета) и объект.
 * Запускаем ФАЙЛ, а не шим из `node_modules/.bin`: шим — свойство раскладки
 * установки, а проверяем мы поставленное содержимое.
 *
 * @param {Record<string, any>} manifest
 * @returns {{name: string, path: string}[]}
 */
export function bins(manifest) {
  const bin = manifest.bin;
  if (bin === undefined || bin === null) return [];
  if (typeof bin === 'string') return [{ name: manifest.name, path: bin }];
  return Object.entries(bin).map(([name, path]) => ({
    name,
    path: /** @type {string} */ (path),
  }));
}

/**
 * @typedef {object} Accepted
 * @property {string} registry
 * @property {string} place
 * @property {{name: string, version: string, attempts: number, doors: string[], bins: string[]}[]} packages
 */

/**
 * @typedef {object} Io
 * @property {() => string} place чистый каталог
 * @property {(path: string) => string} read
 * @property {(path: string, text: string) => void} write
 * @property {(command: string, args: string[], options: {cwd: string}) => {status: number|null, stdout: string, stderr: string}} run
 * @property {(ms: number) => void} pause
 */

/**
 * Приёмка публичного выпуска.
 *
 * @param {{report: any, registry?: string, attempts?: number}} options
 * @param {Io} [io]
 * @returns {Accepted}
 */
export function accept(options, io) {
  const run = io?.run ?? nativeIo.run;
  const read = io?.read ?? nativeIo.read;
  const write = io?.write ?? nativeIo.write;
  const pause = io?.pause ?? nativeIo.pause;
  const place = io?.place ?? nativeIo.place;

  const subjects = plan(options.report);
  const internals = new Set(
    subjects.map((subject) => subject.internal).filter(Boolean),
  );
  const spot = spotOf(place(), options.registry ?? REGISTRY);
  const attempts = options.attempts ?? APPEARANCE.attempts;

  // Манифест ставит установке границу: без него npm пошёл бы искать корень
  // проекта вверх по дереву и мог бы уйти в чужую раскладку.
  write(
    join(spot.root, 'package.json'),
    `${JSON.stringify({ name: 'public-acceptance', version: '0.0.0', private: true }, null, 2)}\n`,
  );
  write(spot.npmrc, '');

  /** @type {Accepted['packages']} */
  const packages = [];

  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const subject of subjects) {
    seen.set(subject.name, appear(subject, spot, attempts, { run, pause }));
  }

  const install = run('npm', installArgs(subjects, spot), { cwd: spot.root });
  if (install.status !== 0) {
    throw new AcceptanceRefusal(
      `установка выпуска в чистый каталог не прошла. Это и есть то, что получит потребитель: команда та же, реестр тот же, кэш пустой.\n${install.stderr || install.stdout}`,
    );
  }

  for (const subject of subjects) {
    const home = join(spot.root, 'node_modules', subject.name);

    /** @type {Record<string, any>} */
    let manifest;
    try {
      manifest = JSON.parse(read(join(home, 'package.json')));
    } catch (cause) {
      throw new AcceptanceRefusal(
        `${subject.name}@${subject.version}: установка прошла, а пакета в чистом каталоге нет — ${cause instanceof Error ? cause.message : cause}`,
      );
    }

    const left = internalLeftovers(manifest, internals);
    if (left.length > 0) {
      throw new AcceptanceRefusal(
        `${subject.name}@${subject.version}: у потребителя объявлены зависимости под ВНУТРЕННИМ именем — ${left.join(', ')}. Таких пакетов в публичном реестре нет, и установка у него упрётся ровно в это.`,
      );
    }

    for (const door of doors(manifest)) {
      const loaded = run(
        NODE,
        [
          '--input-type=module',
          '--eval',
          `await import(${JSON.stringify(door)});`,
        ],
        { cwd: spot.root },
      );
      if (loaded.status !== 0) {
        throw new AcceptanceRefusal(
          `${subject.name}@${subject.version}: объявленная дверь \`${door}\` у потребителя не загружается. Так выглядит внутреннее имя, оставшееся в поставляемом коде.\n${loaded.stderr || loaded.stdout}`,
        );
      }
    }

    for (const bin of bins(manifest)) {
      const answered = run(NODE, [join(home, bin.path), '--help'], {
        cwd: spot.root,
      });
      const start = launched(answered);
      if (!start.loaded) {
        throw new AcceptanceRefusal(
          `${subject.name}@${subject.version}: команда \`${bin.name}\` не доходит до своего кода — ${start.marker}. Первая же команда потребителя — эта, и она не выполнится.\n${answered.stderr || answered.stdout}`,
        );
      }
    }

    packages.push({
      name: subject.name,
      version: subject.version,
      attempts: seen.get(subject.name) ?? 1,
      doors: doors(manifest),
      bins: bins(manifest).map((bin) => bin.name),
    });
  }

  return { registry: spot.registry, place: spot.root, packages };
}

/** Чем запускаем поставленное — тем же интерпретатором, что и себя. */
const NODE = process.execPath;

/**
 * Дождаться, пока реестр начнёт отдавать номер.
 *
 * @param {Subject} subject
 * @param {Spot} spot
 * @param {number} attempts
 * @param {Pick<Io, 'run'|'pause'>} io
 * @returns {number} с какой попытки номер увиден
 */
function appear(subject, spot, attempts, io) {
  /** @type {{status: number|null, stdout: string, stderr: string}} */
  let asked = { status: null, stdout: '', stderr: '' };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    asked = io.run('npm', viewArgs(subject, spot), { cwd: spot.root });
    if (asked.status === 0) return attempt;
    if (attempt < attempts) io.pause(APPEARANCE.pauseMs);
  }

  throw new AcceptanceRefusal(
    `${subject.name}@${subject.version}: реестр не отдаёт этот номер после ${attempts} попыток. Публикация отчиталась успехом, а пакета по публичному имени в реестре нет — принимать нечего.\n${asked.stderr || asked.stdout}`,
  );
}

/**
 * Принятый выпуск — markdown для сводки прогона.
 *
 * @param {Accepted} accepted
 * @returns {string[]}
 */
export function render(accepted) {
  const lines = [
    '## ✅ Публичный выпуск принят — установкой из реестра, а не сборкой у себя',
    '',
    '| | |',
    '|---|---|',
    `| реестр | \`${accepted.registry}\` |`,
    '| кэш | свежий на этот прогон |',
    '| место | пустой каталог вне репозитория |',
    '',
    '### Что поставлено и чем подтверждено',
    '',
    '| пакет | номер | загружены двери | команды |',
    '|---|---|---|---|',
  ];

  for (const entry of accepted.packages) {
    lines.push(
      `| \`${entry.name}\` | ${entry.version} | ${
        entry.doors.length === 0
          ? '— (кода не везёт)'
          : entry.doors.map((door) => `\`${door}\``).join(', ')
      } | ${
        entry.bins.length === 0
          ? '—'
          : entry.bins.map((bin) => `\`${bin} --help\``).join(', ')
      } |`,
    );
  }

  lines.push('');
  return lines;
}

/**
 * Отказ приёмки — markdown для сводки прогона.
 *
 * Уехавшее не отзывается, поэтому отказ говорит не «перезапусти», а «чини
 * причину и выпускай следующим номером».
 *
 * @param {string} message
 * @returns {string[]}
 */
export function renderRefusal(message) {
  return [
    '## ❌ Публичный выпуск НЕ принят — у потребителя он не работает',
    '',
    '| | |',
    '|---|---|',
    '| в публичном реестре | **уехал весь набор** |',
    '| перезапуск с нуля | ОПАСЕН — номера заняты навсегда |',
    '',
    '### Что не сошлось',
    '',
    '```',
    message,
    '```',
    '',
    '### Что делать',
    '',
    '- НЕ перезапускай выпуск: номера уже заняты, и прогон с нуля упрётся в них.',
    '- Уехавшему номер не поднимают и содержимое не подменяют — чини причину и выпускай СЛЕДУЮЩИМ номером.',
    '- Пока починка не уехала, пометь сломанный номер в реестре — `npm deprecate <имя>@<номер> "<причина>"`: снять его нельзя, а предупредить потребителя можно.',
    '',
  ];
}

/** Работа с миром — отдельно от суждений, чтобы пробам было что подменить. */
const nativeIo = {
  place: () => mkdtempSync(join(tmpdir(), 'public-acceptance-')),
  /** @param {string} path */
  read: (path) => readFileSync(path, 'utf-8'),
  /** @param {string} path @param {string} text */
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  /** @param {string} command @param {string[]} args @param {{cwd: string}} options */
  run: (command, args, options) => {
    const done = spawnSync(command, args, {
      encoding: 'utf-8',
      cwd: options.cwd,
    });
    return {
      status: done.status,
      stdout: done.stdout ?? '',
      stderr: done.stderr ?? '',
    };
  },
  /** @param {number} ms */
  pause: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

/**
 * Запуск в конвейере.
 *
 * @param {string[]} argv аргументы после имени скрипта
 * @returns {number} код выхода
 */
function main(argv) {
  const reportFlag = argv.indexOf('--report');
  const registryFlag = argv.indexOf('--registry');
  const attemptsFlag = argv.indexOf('--attempts');

  if (reportFlag === -1 || !argv[reportFlag + 1]) {
    console.error(
      'public-acceptance: не назван отчёт переименования (--report <файл>). Что уехало наружу, знает шаг переименования, а не этот шаг.',
    );
    return 2;
  }
  if (registryFlag !== -1 && !argv[registryFlag + 1]) {
    console.error('public-acceptance: у --registry не назван адрес');
    return 2;
  }

  /** @type {any} */
  let report;
  try {
    report = JSON.parse(readFileSync(argv[reportFlag + 1], 'utf-8'));
  } catch (cause) {
    console.error(
      `public-acceptance: отчёт «${argv[reportFlag + 1]}» не прочитан или не разбирается как JSON: ${cause instanceof Error ? cause.message : cause}`,
    );
    return 2;
  }

  try {
    const accepted = accept({
      report,
      registry: registryFlag === -1 ? undefined : argv[registryFlag + 1],
      attempts:
        attemptsFlag === -1 ? undefined : Number(argv[attemptsFlag + 1]),
    });
    for (const line of render(accepted)) console.log(line);
    console.error(
      `ПРИЁМКА ПУБЛИЧНОГО ВЫПУСКА: принято пакетов ${accepted.packages.length}, место ${accepted.place}`,
    );
    return 0;
  } catch (cause) {
    if (cause instanceof AcceptanceRefusal) {
      for (const line of renderRefusal(cause.message)) console.log(line);
      console.error(`public-acceptance: ВЫПУСК НЕ ПРИНЯТ — ${cause.message}`);
      return 1;
    }
    throw cause;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
