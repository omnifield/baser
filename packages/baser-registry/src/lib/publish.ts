/**
 * ПУБЛИКАЦИЯ — РАБОТА ИНСТРУМЕНТА, А НЕ СОВЕТ ЧЕЛОВЕКУ.
 *
 * Раньше магазин печатал строки для `.npmrc` и предлагал человеку собрать
 * команду самому. Совет не работает там, где он нужнее всего, и это установлено
 * замерами, а не соображениями (`tasker:BASER2-252`, `kb:BASER3-39`):
 *
 * | попытка                                  | куда поехало       |
 * | ---------------------------------------- | ------------------ |
 * | `pnpm publish --userconfig <файл>`       | `Unknown option`   |
 * | `npm_config_userconfig` в окружении      | в чужой реестр     |
 * | `npm_config_@скоуп:registry` в окружении | в чужой реестр     |
 * | `pnpm publish --config.@скоуп:registry`  | в чужой реестр     |
 * | `.npmrc` уровня ПРОЕКТА                  | в магазин ✅       |
 *
 * Отсюда всё устройство файла: **человек не должен знать про `npmrc`, флаги
 * скоупа и разницу менеджеров, чтобы положить товар на свой склад.** Инструмент
 * отдают другим продуктам, и то, что сегодня приходится знать человеку, завтра
 * придётся знать каждому из них — по-своему.
 *
 * ── МЕНЕДЖЕР ВЫБИРАЕТ ИНСТРУМЕНТ, А НЕ ЧЕЛОВЕК ─────────────────────────────
 *
 * `workspace:*` в зависимостях — не стилистика, а требование. Замер 2026-08-08
 * на живом магазине:
 *
 * - `pnpm publish` → в манифесте на складе `"@omnifield/ws-lib": "1.2.3"`;
 * - `npm publish`  → `"@omnifield/ws-lib": "workspace:*"`.
 *
 * Второй пакет не ставится вовсе: такого спецификатора вне workspace не
 * существует (`tasker:BASER2-77`). Поэтому менеджер здесь выводится из
 * СОДЕРЖИМОГО манифеста, а не спрашивается: пакет с `workspace:` публикует
 * только `pnpm`, и если его нет — это названный отказ, а не тихая публикация
 * сломанного пакета.
 *
 * ── СВЕРКА НАЗНАЧЕНИЯ СТОИТ ВНУТРИ ШАГА ─────────────────────────────────────
 *
 * Сухой прогон спрашивает у самого менеджера, куда он собрался, и ответ
 * сверяется с адресом магазина. Шаг встроен в публикацию, а не лежит рядом
 * отдельной проверкой: отдельную можно забыть позвать, встроенную — нельзя
 * (`kb:BASER3-39`). Формат ответа у менеджеров разный, и это единственное, что
 * про них надо знать здесь.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ShopProblemLog } from './problems.js';

/** Чем публикуем. Выбирается инструментом из манифеста, а не человеком. */
export type Manager = 'npm' | 'pnpm';

/** Что сделала публикация — уезжает в ответ данными. */
export interface PublishReport {
  /** Имя пакета из манифеста. */
  readonly name: string;
  readonly version: string;
  /** Каталог, откуда публиковали. */
  readonly directory: string;
  /** Чем публиковали и почему именно им. */
  readonly manager: Manager;
  /**
   * Пакет требует `pnpm`: в зависимостях есть `workspace:`.
   *
   * Отдельным полем, а не выводом из `manager`: «выбрали pnpm» и «без pnpm
   * этот пакет опубликовать нельзя» — разные утверждения, и второе человек
   * должен видеть, когда разбирается, почему отказали.
   */
  readonly needsWorkspace: boolean;
  /** Куда поехало НА САМОМ ДЕЛЕ — по ответу сухого прогона, а не по намерению. */
  readonly destination: string;
}

/** Манифест публикуемого пакета — ровно те поля, которые нам нужны. */
interface Manifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, unknown>;
}

/**
 * Читает манифест публикуемого пакета.
 *
 * `null` — читать нечего, и отказ об этом называет каталог: человек мог позвать
 * команду не оттуда, и это самая частая причина.
 */
export function readManifest(
  directory: string,
  problems: ShopProblemLog,
): { name: string; version: string; needsWorkspace: boolean } | null {
  const path = join(directory, 'package.json');
  if (!existsSync(path)) {
    problems.add(
      'manifest-missing',
      path,
      `в ${directory} нет package.json — публиковать нечего. ` +
        `Позовите команду из каталога пакета либо назовите его первым аргументом`,
    );
    return null;
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch (error) {
    problems.add(
      'manifest-unreadable',
      path,
      `package.json не разбирается как JSON: ${(error as Error).message}`,
    );
    return null;
  }

  const name = typeof manifest.name === 'string' ? manifest.name : null;
  const version =
    typeof manifest.version === 'string' ? manifest.version : null;
  if (name === null || version === null) {
    problems.add(
      'manifest-unreadable',
      path,
      'у пакета нет имени или версии — публиковать такое нельзя',
    );
    return null;
  }

  return { name, version, needsWorkspace: hasWorkspaceRange(manifest) };
}

/**
 * Есть ли в манифесте зависимость на соседа по workspace.
 *
 * Смотрим ВСЕ четыре набора: `workspace:` в любом из них означает, что при
 * публикации спецификатор обязан быть заменён на настоящий номер, а заменить
 * его умеет только `pnpm`.
 */
function hasWorkspaceRange(manifest: Manifest): boolean {
  const sets = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  return sets.some((set) =>
    Object.values(set ?? {}).some(
      (range) => typeof range === 'string' && range.startsWith('workspace:'),
    ),
  );
}

/** Выбирает менеджера: требование пакета сильнее любых предпочтений. */
export function chooseManager(needsWorkspace: boolean): Manager {
  return needsWorkspace ? 'pnpm' : 'npm';
}

/** Есть ли менеджер в системе. */
export function managerAvailable(manager: Manager): boolean {
  const outcome = spawnSync(manager, ['--version'], {
    encoding: 'utf8',
    env: cleanEnvironment(),
  });
  return outcome.status === 0;
}

/**
 * ОКРУЖЕНИЕ БЕЗ ЧУЖИХ НАСТРОЕК NPM.
 *
 * Приоритет у менеджеров такой: флаги → ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ → файл конфига.
 * Значит окружение бьёт наш `.npmrc` молча, а команду зовут откуда угодно — в
 * том числе из-под `pnpm`, который раздаёт детям свои `npm_config_*`.
 *
 * Чистим ПРЕФИКСОМ, а не перечнем имён: имён больше, чем помнит человек, и
 * забытое даёт не отказ, а тихо чужой ответ (`kb:BASER3-39`).
 */
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^npm_config_/i.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Строки `.npmrc`, с которыми публикация попадает в наш магазин.
 *
 * Скоуп называется отдельно от общего адреса: скоуп-настройка бьёт общий адрес,
 * и без своей строки пакет со скоупом уедет туда, куда указывает чужой конфиг.
 * Токен — любой непустой: без него менеджер не публикует вовсе, а проверять его
 * магазину локации нечем.
 */
export function npmrcFor(address: string, packageName: string): string {
  const host = address.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const scope = packageName.startsWith('@') ? packageName.split('/')[0] : null;
  return [
    `registry=${address}`,
    ...(scope ? [`${scope}:registry=${address}`] : []),
    `//${host}/:_authToken=baser-registry`,
    '',
  ].join('\n');
}

/**
 * ГДЕ МЕНЕДЖЕР ДЕЙСТВИТЕЛЬНО ЧИТАЕТ `.npmrc` — четвёртый уровень ловушки.
 *
 * Замер 2026-08-08, пакет с `workspace:` внутри pnpm-workspace:
 *
 * | где лежал `.npmrc`   | куда собрался pnpm         |
 * | -------------------- | -------------------------- |
 * | каталог ПАКЕТА       | `https://npm.pkg.github.com` ❌ |
 * | КОРЕНЬ workspace     | наш магазин ✅              |
 *
 * То есть `pnpm` внутри workspace читает конфиг КОРНЯ, а файл рядом с пакетом
 * не замечает вовсе. Правило «`.npmrc` уровня проекта работает» верно, но
 * «проект» для pnpm — это workspace целиком, а не каталог публикуемого пакета.
 *
 * Поймала это не догадка, а встроенная сверка назначения: живой публикации не
 * было, отказ назвал чужой адрес. Ровно ради таких случаев она и стоит ВНУТРИ
 * шага (`kb:BASER3-39`).
 */
function configHome(directory: string, manager: Manager): string {
  if (manager !== 'pnpm') return directory;

  for (let at = directory; ; at = dirname(at)) {
    if (existsSync(join(at, 'pnpm-workspace.yaml'))) return at;
    if (dirname(at) === at) return directory;
  }
}

/**
 * Кладёт наш `.npmrc` туда, где менеджер его прочитает, и возвращает то, чем
 * всё вернуть обратно.
 *
 * Чужой файл не теряется: его содержимое запоминается и возвращается на место в
 * любом исходе, включая падение. Это правка в дереве человека, пусть и на
 * секунды, — поэтому она обязана быть возвратной по построению, а не по
 * внимательности.
 */
function placeNpmrc(
  directory: string,
  content: string,
): { restore: () => void } {
  const path = join(directory, '.npmrc');
  const had = existsSync(path);
  const previous = had ? readFileSync(path, 'utf8') : null;

  writeFileSync(path, content, 'utf8');

  return {
    restore: () => {
      if (previous === null) {
        rmSync(path, { force: true });
        return;
      }
      writeFileSync(path, previous, 'utf8');
    },
  };
}

/**
 * Куда менеджер собрался публиковать — спрошено у него самого.
 *
 * Формат ответа у менеджеров разный, и это единственное место, где разница
 * названа: `npm` печатает `Publishing to <адрес>`, `pnpm` — `📦 имя@версия →
 * <адрес>`. Разбираем оба; не нашли адреса — считаем это неизвестным
 * назначением и отказываем, а не публикуем на удачу.
 */
function destinationOf(said: string): string | null {
  const npmSaid = /Publishing to (\S+)/.exec(said);
  if (npmSaid) return normalize(npmSaid[1]);

  const pnpmSaid = /→\s*(https?:\/\/\S+)/.exec(said);
  if (pnpmSaid) return normalize(pnpmSaid[1]);

  return null;
}

function normalize(address: string): string {
  return address.replace(/\/+$/, '');
}

/**
 * ЛЕЖИТ ЛИ ЭТА ВЕРСИЯ НА СКЛАДЕ — спрашиваем склад, а не читаем чужой текст.
 *
 * Повторная публикация — не провал, а «делать нечего»: то же состояние без
 * крика, ровно как второй `up` и второй `down`. Отличить этот исход можно двумя
 * способами, и выбран не первый:
 *
 * - **по выводу менеджера** (`E409`, `409 Conflict`, `already present`) — это
 *   разбор ЧУЖОГО ТЕКСТА, который у npm и pnpm разный и меняется с их выпусками.
 *   Ветвиться по тексту не должен никто (`kb:BASER3-10`), и мы не будем;
 * - **по складу** — один HTTP-вопрос с однозначным ответом. Замер 2026-08-08:
 *   пакет с версией → `200` и список версий, пакета нет вовсе → `400`.
 *
 * Спрашиваем ДВАЖДЫ и по разным поводам: до публикации — чтобы не запускать
 * менеджера впустую и не трогать чужой `.npmrc` ради работы, которой нет; после
 * неудачи — чтобы отличить гонку (кто-то положил ту же версию между нашим
 * вопросом и нашей попыткой) от настоящей беды.
 */
export async function onShelf(
  address: string,
  name: string,
  version: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${address}/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      versions?: Record<string, unknown>;
    };
    return Object.hasOwn(body.versions ?? {}, version);
  } catch {
    // Склад не ответил — утверждать, что версия там есть, нечем. Публикация
    // пойдёт своим путём и упрётся в настоящий отказ, который назовёт причину.
    return false;
  }
}

export interface PublishRun {
  readonly manager: Manager;
  readonly directory: string;
  readonly address: string;
  readonly packageName: string;
}

export interface PublishOutcome {
  readonly destination: string | null;
  readonly published: boolean;
  readonly said: string;
  /**
   * Сухой прогон САМ отказал — до того, как назвал назначение.
   *
   * Отдельно от «назначение не прочитано», потому что чинят это по-разному:
   * непрочитанный адрес отправляет смотреть на реестр, а отказ менеджера — на
   * пакет. Поймано собственной пробой: битое имя пакета приезжало как
   * `wrong-destination`, и человек пошёл бы проверять адрес (`tasker:BASER2-257`).
   */
  readonly refusedByManager: boolean;
}

/**
 * Публикует: сперва спрашивает назначение, потом отправляет товар.
 *
 * Порядок здесь — не стиль, а защита: живая публикация не начинается, пока
 * назначение не подтверждено. Уехавшее в чужой реестр обратно не забирается,
 * а `unpublish` там может быть и запрещён.
 */
export function runPublish(run: PublishRun): PublishOutcome {
  const npmrc = placeNpmrc(
    configHome(run.directory, run.manager),
    npmrcFor(run.address, run.packageName),
  );

  try {
    const dry = call(run, ['--dry-run']);
    const destination = destinationOf(dry.said);
    if (destination === null || destination !== normalize(run.address)) {
      return {
        destination,
        published: false,
        said: dry.said,
        refusedByManager: dry.code !== 0,
      };
    }

    const live = call(run, []);
    return {
      destination,
      published: live.code === 0,
      said: live.said,
      refusedByManager: false,
    };
  } finally {
    npmrc.restore();
  }
}

function call(
  run: PublishRun,
  extra: string[],
): { code: number | null; said: string } {
  const flags =
    run.manager === 'pnpm'
      ? [
          // Гит-проверки `pnpm publish` про выпуск наружу: чистое дерево,
          // правильная ветка, тег. Склад локации — это дев-канал, куда кладут
          // ровно на середине работы, и требовать там чистого дерева значило бы
          // запретить пользоваться собственным магазином.
          '--no-git-checks',
        ]
      : [
          // У `npm` адрес можно назвать ещё и флагами — второй рубеж поверх
          // `.npmrc`. У `pnpm` таких флагов нет (замер), поэтому там рубеж один.
          '--registry',
          run.address,
        ];

  const outcome = spawnSync(run.manager, ['publish', ...flags, ...extra], {
    cwd: run.directory,
    encoding: 'utf8',
    env: cleanEnvironment(),
  });

  return {
    code: outcome.status,
    said: `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`,
  };
}
