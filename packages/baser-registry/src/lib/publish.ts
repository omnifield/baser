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
import type { PublicationSteps } from './steps.js';

/** Чем публикуем. Выбирается инструментом из манифеста, а не человеком. */
export type Manager = 'npm' | 'pnpm';

/**
 * Что стало с ОДНИМ пакетом партии.
 *
 * Отдельно от общего исхода прогона, потому что партия — это несколько пакетов
 * сразу, и общий исход у них один на всех: «два положено, один уже лежал, один
 * не поехал» одним словом не сказать, а человеку нужно именно это. Общий исход
 * отвечает на вопрос «идти ли разбираться», построчный — «с чем именно».
 */
export type ShipmentOutcome =
  /** Товар положен на склад этим прогоном. */
  | 'published'
  /** Тот же выпуск уже лежал: делать было нечего. Успех (`tasker:BASER2-257`). */
  | 'already-published'
  /** Везли и не довезли: склад, права, менеджер. */
  | 'failed'
  /**
   * Везти не начали: вход непригоден, и чинит его человек.
   *
   * Сюда попадает отказ ВЫПУСКА — «правишь выпущенное». Он не `failed`, потому
   * что ничего не ломалось: склад исправен, а номер надо поднять. Разные коды
   * возврата у этих двух исходов — не украшение, а весь смысл различения.
   */
  | 'refused';

/** Что сделала публикация — уезжает в ответ данными. */
export interface PublishReport {
  /**
   * Что стало с этим пакетом — одним словом.
   *
   * Производная от `steps` и оставлена намеренно: конвейеру, который читает
   * партию построчно, нужен короткий ответ «идти ли разбираться», а с ЧЕМ
   * именно — он прочитает шагами.
   */
  readonly outcome: ShipmentOutcome;
  /**
   * Три действия ЭТОГО пакета: выпуск · отгрузка · объявление.
   *
   * У пакетов партии они разные — один уехал, второй уже лежал, третьему
   * отказал выпуск, — поэтому шаги живут на пакете, а не только на прогоне.
   */
  readonly steps: PublicationSteps;
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
 * ОТПЕЧАТОК ТОВАРА — чем сверяют содержимое, не разбирая его глазами.
 *
 * Оба поля — про один и тот же тарбол, и оба приезжают ровно в том виде, в
 * котором их называет и склад, и менеджер: `integrity` (`sha512-…`) и `shasum`
 * (sha1). Держим оба, потому что назвать своё содержимое склад может любым из
 * них: лежащее у нас пришло от менеджера, а проксированное сверху — от чужого
 * реестра, и там набор полей не наш.
 */
export interface Fingerprint {
  readonly integrity: string | null;
  readonly shasum: string | null;
}

/**
 * ЧТО ЛЕЖИТ НА СКЛАДЕ ПОД ЭТИМ НОМЕРОМ — спрашиваем склад, а не читаем чужой
 * текст. `null` — номер свободен.
 *
 * Отличить занятый номер можно двумя способами, и выбран не первый:
 *
 * - **по выводу менеджера** (`E409`, `409 Conflict`, `already present`) — это
 *   разбор ЧУЖОГО ТЕКСТА, который у npm и pnpm разный и меняется с их выпусками.
 *   Ветвиться по тексту не должен никто (`kb:BASER3-10`), и мы не будем;
 * - **по складу** — один HTTP-вопрос с однозначным ответом. Замер 2026-08-08:
 *   пакет с версией → `200` и список версий, пакета нет вовсе → `400`.
 *
 * ОТВЕТ СТАЛ ЗАПИСЬЮ, А НЕ «ДА/НЕТ», и это главная правка захода. «Номер занят»
 * само по себе не отвечает ни на один из двух вопросов, которые здесь на самом
 * деле задают: тот же это выпуск или уже другой. Пока ответ был булевым, любое
 * «занят» означало успех — и порча выпуска ехала мимо человека молча
 * (`tasker:BASER2-287`).
 *
 * Спрашиваем ДВАЖДЫ и по разным поводам: до публикации — чтобы судить выпуск и
 * не запускать менеджера впустую; после неудачи — чтобы отличить гонку (кто-то
 * положил ту же версию между нашим вопросом и нашей попыткой) от настоящей беды.
 */
export async function lookOnShelf(
  address: string,
  name: string,
  version: string,
): Promise<Fingerprint | null> {
  try {
    const response = await fetch(`${address}/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      versions?: Record<string, { dist?: { integrity?: unknown; shasum?: unknown } }>;
    };
    const found = body.versions?.[version];
    if (found === undefined) return null;
    return {
      integrity: text(found.dist?.integrity),
      shasum: text(found.dist?.shasum),
    };
  } catch {
    // Склад не ответил — утверждать, что версия там есть, нечем. Публикация
    // пойдёт своим путём и упрётся в настоящий отказ, который назовёт причину.
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * ОТПЕЧАТОК ТОГО, ЧТО МЫ СОБРАЛИСЬ ПОЛОЖИТЬ, — спрошен у самого менеджера.
 *
 * Здесь стоит вся тяжесть отказа «правишь выпущенное», поэтому способ выбран
 * замером, а не соображением. Замеры 2026-08-10, npm 10.9.8 и pnpm 11.17.0 на
 * живой раздаче verdaccio 6.9.2:
 *
 * | что проверяли                                   | чем кончилось          |
 * | ----------------------------------------------- | ---------------------- |
 * | `integrity` сухого прогона против `dist.integrity` на складе | совпадает побайтово ✅ |
 * | два сухих прогона подряд                        | тот же отпечаток ✅     |
 * | правка файла в пакете                           | отпечаток разошёлся ✅  |
 * | bump соседа по `workspace:`                     | отпечаток разошёлся ✅  |
 * | без `.npmrc`, без токена, с ядовитым скоупом    | тот же отпечаток ✅     |
 * | пакет, который менеджер не собрал               | код 1, отпечатка нет ✅ |
 *
 * Из первой строки и следует, что сверка вообще возможна: отпечаток сухого
 * прогона — это отпечаток ТОГО САМОГО тарбола, который уехал бы на склад, а не
 * похожая на него величина. Из последней — что «сверить нечем» отличимо от
 * «сверили и разошлось», и молча считать первое вторым не придётся.
 *
 * Четвёртая строка — не ложное срабатывание, а правда: `pnpm` подставляет в
 * манифест настоящий номер вместо `workspace:*`, значит выпуск с тем же номером
 * тянул бы за собой ДРУГОГО соседа. Это и есть правка выпущенного.
 *
 * ── ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ВЫЗОВ, А НЕ ФЛАГ К СВЕРКЕ НАЗНАЧЕНИЯ ────────────────
 *
 * Соблазн был: сухой прогон уже есть в `runPublish`, добавь `--json` и получи
 * заодно отпечаток. Замер запретил — **`pnpm` с `--json` СЪЕДАЕТ строку
 * назначения** (`📦 имя@версия → адрес`), а она наш единственный рубеж против
 * отгрузки в чужой реестр. Менять рубеж на удобство мы не станем.
 *
 * Платы это не стоит: два прогона никогда не случаются на одном пакете.
 * Отпечаток снимается ТОЛЬКО когда номер на складе уже занят, а назначение
 * сверяется только когда мы реально везём.
 */
export function fingerprintOf(
  manager: Manager,
  directory: string,
): { print: Fingerprint | null; said: string } {
  const outcome = spawnSync(
    manager,
    [
      'publish',
      '--dry-run',
      '--json',
      // Та же причина, что и в живой публикации: склад локации — дев-канал, и
      // требовать там чистого дерева значило бы запретить им пользоваться.
      ...(manager === 'pnpm' ? ['--no-git-checks'] : []),
    ],
    { cwd: directory, encoding: 'utf8', env: cleanEnvironment() },
  );

  const said = `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`;
  if (outcome.status !== 0) return { print: null, said };
  return { print: printIn(outcome.stdout ?? ''), said };
}

/**
 * Достаёт отпечаток из ответа менеджера.
 *
 * Разбираем JSON, а не ищем подстроку: «похоже на отпечаток» и «является
 * отпечатком» — разные утверждения (`kb:BASER3-10`). Замечания менеджеры пишут
 * в другой поток, но от чужой строки перед телом ответа мы всё равно
 * прикрываемся — ищем начало объекта, а не считаем весь поток JSON'ом.
 */
function printIn(stdout: string): Fingerprint | null {
  const start = stdout.indexOf('{');
  if (start < 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }

  const said = parsed as { integrity?: unknown; shasum?: unknown };
  const print = { integrity: text(said.integrity), shasum: text(said.shasum) };
  return print.integrity === null && print.shasum === null ? null : print;
}

/**
 * Одно ли это содержимое. `null` — сверить нечем, и это НЕ «да».
 *
 * Сильное поле вперёд: `integrity` называет и алгоритм, и значение, а `shasum`
 * остаётся запасным — им отвечают записи, приехавшие не от нашего менеджера.
 */
export function sameContent(
  onShelf: Fingerprint,
  ours: Fingerprint,
): boolean | null {
  if (onShelf.integrity !== null && ours.integrity !== null) {
    return onShelf.integrity === ours.integrity;
  }
  if (onShelf.shasum !== null && ours.shasum !== null) {
    return onShelf.shasum === ours.shasum;
  }
  return null;
}

/**
 * ВЫПУСК — ПЕРВОЕ ИЗ ТРЁХ ДЕЙСТВИЙ: вещь замерзает и получает номер.
 *
 * Судит ровно один вопрос — вправе ли это содержимое ехать под этим номером, — и
 * ничего не отгружает. Четыре исхода, и все четыре разные:
 *
 * | что на складе                    | вердикт     | что дальше                       |
 * | -------------------------------- | ----------- | -------------------------------- |
 * | номера нет                       | `free`      | выпуск состоялся, везём          |
 * | тот же тарбол                    | `same`      | это повтор, отгрузка идемпотентна |
 * | другой тарбол                    | `diverged`  | ОТКАЗ: правишь выпущенное        |
 * | занят, а сверить нечем           | `unjudged`  | ОТКАЗ: молча не пропускаем       |
 *
 * Вторая строка — то самое решение `tasker:BASER2-257`, и оно остаётся в силе:
 * второй `publish` тем же товаром — то же состояние без крика, как второй `up`.
 * Третья — то, ради чего заход: прежде она была неотличима от второй.
 */
export type ReleaseVerdict =
  | { readonly kind: 'free' }
  | { readonly kind: 'same' }
  | { readonly kind: 'diverged' }
  | { readonly kind: 'unjudged'; readonly said: string };

export function judgeRelease(
  onShelf: Fingerprint | null,
  manager: Manager,
  directory: string,
): ReleaseVerdict {
  // Номер свободен — судить нечего, и менеджера ради этого не запускаем.
  if (onShelf === null) return { kind: 'free' };

  const ours = fingerprintOf(manager, directory);
  if (ours.print === null) {
    return { kind: 'unjudged', said: ours.said };
  }

  const same = sameContent(onShelf, ours.print);
  if (same === null) {
    return {
      kind: 'unjudged',
      said: 'склад не назвал отпечаток того, что у него лежит',
    };
  }
  return same ? { kind: 'same' } : { kind: 'diverged' };
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
