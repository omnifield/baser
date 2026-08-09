/**
 * ЖИЗНЕННЫЙ ЦИКЛ МАГАЗИНА: поднять · остановить · спросить · положить товар.
 *
 * Обещание инструмента — одна строка, и весь файл написан ради неё:
 *
 * > контейнер работает — раздача есть · контейнер остановился — магазин закрыт ·
 * > **товар остался**
 *
 * ── МАГАЗИН — ПРОЦЕСС ВНУТРИ КОНТЕЙНЕРА, А НЕ КОНТЕЙНЕР ─────────────────────
 *
 * Докера-в-докере не заводим: девбокс не вправе требовать сокет докера ради
 * раздачи пакетов (`kb:FUND-4`). Отсюда весь способ: раздача поднимается
 * отдельным процессом, отвязанным от команды, которая его завела, — иначе
 * магазин умирал бы вместе с вызовом `up`.
 *
 * ── ЗАЯВКА — ЭТО НАМЕРЕНИЕ. СОСТОЯНИЕ ОПРЕДЕЛЯЕТ ОТВЕТ РАЗДАЧИ ───────────────
 *
 * Ключевое решение файла. Запись о запуске (`runtime/shop.json`) говорит, что
 * мы ПЫТАЛИСЬ поднять и с каким pid, — и она врёт при первом же перезапуске
 * контейнера: процесса нет, а файл на месте. Хуже: номер процесса
 * переиспользуется системой, поэтому «pid жив» не означает «жив НАШ процесс».
 *
 * Поэтому состояние здесь спрашивается у самой раздачи по HTTP, а заявка нужна
 * ровно для двух вещей: знать, КОГО гасить, и отличить «магазин не пережил
 * остановку контейнера» от «магазина тут никогда не было». Ровно этой парой
 * фактов закрывается пункт приёмки про перезапуск.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readDecisions } from './decisions.js';
import { buildingLayout, shopLayout, type ShopLayout } from './layout.js';
import { locateBuilding } from './locate.js';
import { ShopProblemLog } from './problems.js';
import {
  clientAddress,
  listenAddress,
  logPath,
  readSettings,
  reachOf,
  settingsTemplate,
  type ShopSettings,
} from './settings.js';
import {
  SCHEMA_VERSION,
  type ScopeConflict,
  type ShopCommand,
  type ShopOutcome,
  type ShopResult,
  type ShopState,
  type WriteReport,
} from './result.js';
import {
  chooseManager,
  managerAvailable,
  onShelf,
  readManifest,
  runPublish,
  type PublishReport,
} from './publish.js';
import { createTrace, type TraceRecorder } from './trace.js';
import { shopEntry, verdaccioConfig } from './verdaccio.js';

/**
 * Сколько ждём ПЕРВОГО ответа раздачи после запуска.
 *
 * Verdaccio на холодном старте читает конфиг и поднимает http — на живом замере
 * это около секунды. Порог отвечает не на вопрос «медленно ли», а на вопрос
 * «уже никогда»: смерть процесса ловится отдельно и сразу, поэтому ждать здесь
 * можно спокойно, а срабатывает порог только на настоящем зависании.
 */
const START_TIMEOUT_MS = 20_000;

/** Сколько ждём, пока магазин замолчит после вежливого сигнала. */
const STOP_TIMEOUT_MS = 10_000;

/** И сколько — после жёсткого, прежде чем признать, что не вышло. */
const KILL_TIMEOUT_MS = 5_000;

/** Шаг опроса. Чаще — впустую греет процессор, реже — заметно человеку. */
const POLL_STEP_MS = 150;

/** Сколько ждём ответа на одиночный вопрос «ты живой». */
const PING_TIMEOUT_MS = 2_000;

/** Что лежит в заявке о запуске. */
interface ShopClaim {
  readonly pid: number;
  readonly address: string;
  readonly listen: string;
  /**
   * Постройка, из которой раздачу подняли.
   *
   * Магазин общий на локацию, но «кто его поднял» — осмысленный факт, и без
   * него постройка не может увидеть разницу между «работает моя раздача» и
   * «работает раздача участка». Не право владения: гасить и пользоваться может
   * любая постройка локации.
   */
  readonly building?: string;
}

/** Что ответил адрес магазина. */
type Knock = 'registry' | 'foreign' | 'silent';

export interface ShopOptions {
  /** Откуда позвали команду. Корень постройки ищется вверх от него. */
  readonly cwd: string;
  /**
   * Окружение, из которого читается место магазина локации.
   *
   * Передаётся, а не берётся из `process.env` внутри: пробам нужно поднять
   * магазин в своём месте, не трогая глобальное состояние, и поведение при
   * этом обязано остаться тем же кодом.
   */
  readonly environment?: NodeJS.ProcessEnv;
  /** Подменяется пробами: настоящий `npm` дорог, а спрашиваем мы его ради факта. */
  readonly scopes?: (address: string, cwd: string) => Promise<ScopeConflict[]>;
}

export interface PublishOptions extends ShopOptions {
  /**
   * Каталог публикуемого пакета; по умолчанию — тот, откуда позвали команду.
   *
   * Относительный путь считается от каталога вызова, а не от корня постройки:
   * человек называет его, стоя где-то, и «относительно чего» для него очевидно
   * ровно одно — относительно того места, где он стоит.
   */
  readonly directory?: string;
}

/** Поднять раздачу. Идемпотентна: на поднятом магазине не делает ничего. */
export async function up(options: ShopOptions): Promise<ShopResult> {
  const run = await prepare('up', options);
  if (run.refused) return run.finish('refused', 'closed');

  const { layout, settings, trace } = run;
  const address = clientAddress(settings);

  const knock = await trace.span('knock', () => knockOn(address));
  if (knock === 'registry') {
    // Уже работает. Второй `up` — не ошибка и не повод перезапускать раздачу:
    // перезапуск оборвал бы установки, которые идут прямо сейчас.
    return run.finish('already-running', 'running');
  }
  if (knock === 'foreign') {
    run.problems.add(
      'address-busy',
      address,
      `на ${address} отвечает не реестр — там уже кто-то живёт. ` +
        `Смените порт в ${layout.config} либо освободите адрес`,
    );
    return run.finish('refused', 'closed');
  }

  // Заявка могла протухнуть: процесса нет, а файл остался от прошлой жизни
  // контейнера. Перетираем без сожаления — она уже неправда.
  await trace.span('prepare-storage', () => {
    mkdirSync(layout.storage, { recursive: true });
    mkdirSync(layout.runtime, { recursive: true });
  });

  const logFile = logPath(settings, run.layout.home.path);
  mkdirSync(dirname(logFile), { recursive: true });

  await trace.span('write-config', () => {
    const text = verdaccioConfig(settings, layout, logFile);
    run.write(layout.generatedConfig, text);
  });

  const pid = await trace.span('spawn', () =>
    startProcess(layout, settings, logFile),
  );
  run.write(
    layout.claim,
    `${JSON.stringify(
      {
        pid,
        address,
        listen: listenAddress(settings),
        building: run.building.root,
      },
      null,
      2,
    )}\n`,
  );

  const awake = await trace.span('await-answer', () =>
    waitForAnswer(address, pid, START_TIMEOUT_MS),
  );

  if (awake === 'died') {
    run.problems.add(
      'shop-died',
      logFile,
      `раздача запустилась и умерла, не начав отвечать. Причина — в логе: ${logFile}`,
    );
    removeIfExists(layout.claim);
    return run.finish('failed', 'closed');
  }
  if (awake === 'silent') {
    run.problems.add(
      'shop-silent',
      address,
      `процесс ${pid} живёт, а ${address} не ответил за ${START_TIMEOUT_MS / 1000} с. ` +
        `Что происходит — в логе: ${logFile}`,
    );
    return run.finish('failed', 'closed');
  }

  return run.finish('started', 'running', pid);
}

/** Остановить раздачу, оставив товар на месте. Идемпотентна. */
export async function down(options: ShopOptions): Promise<ShopResult> {
  const run = await prepare('down', options);
  if (run.refused) return run.finish('refused', 'closed');

  const { layout, settings, trace } = run;
  const address = clientAddress(settings);
  const claim = readClaim(layout);

  const knock = await trace.span('knock', () => knockOn(address));

  if (knock === 'silent') {
    // Магазин и так закрыт. Заявку, если она осталась от прошлой жизни
    // контейнера, прибираем: врущая запись хуже отсутствующей.
    if (claim) run.remove(layout.claim);
    return run.finish('already-closed', 'closed');
  }

  if (!claim) {
    run.problems.add(
      'address-busy',
      address,
      `на ${address} кто-то отвечает, но нашей заявки о запуске нет — ` +
        `гасить чужой процесс мы не станем`,
    );
    return run.finish('refused', 'running');
  }

  const stopped = await trace.span('stop', () => stopProcess(claim.pid));
  if (!stopped) {
    run.problems.add(
      'shop-immortal',
      `pid ${claim.pid}`,
      `процесс ${claim.pid} не умер даже после жёсткого сигнала`,
    );
    return run.finish('failed', 'running', claim.pid);
  }

  run.remove(layout.claim);
  return run.finish('stopped', 'closed');
}

/**
 * Отгрузить товар на склад локации.
 *
 * Команда делает правильное независимо от менеджера и от того, что настроено у
 * человека: чистит окружение, называет адрес и на скоуп, выбирает менеджера по
 * содержимому манифеста и сверяет назначение ДО живой публикации. Человеку
 * знать про `.npmrc`, флаги скоупа и разницу менеджеров не нужно — в этом вся
 * причина, по которой команда существует (`publish.ts`).
 *
 * ЧТО ИМЕННО УЕЗЖАЕТ, РЕШАЕТ ПОСТРОЙКА, А НЕ КАТАЛОГ, ИЗ КОТОРОГО ПОЗВАЛИ.
 * Названный путь сильнее объявленного: человек, назвавший папку, просил именно
 * её. Не названо ничего — уезжает ПАРТИЯ из решений постройки (`decisions.ts`),
 * и только если решений нет вовсе, командой остаётся прежнее «пакет отсюда».
 *
 * ПОЛОВИНЫ ПАРТИИ НЕ БЫВАЕТ ПО НЕВНИМАТЕЛЬНОСТИ: всё, что можно проверить, не
 * трогая склада, проверяется до первой живой публикации — каталоги на месте,
 * манифесты читаются, менеджер в системе есть. Отказ на третьем пакете из пяти
 * оставил бы склад в состоянии, которого никто не выбирал.
 */
export async function publish(options: PublishOptions): Promise<ShopResult> {
  const run = await prepare('publish', options, { create: false });
  if (run.refused) return run.finish('refused', 'closed');

  const { trace } = run;
  const address = clientAddress(run.settings);

  const asked = whatToShip(run, options);
  if (asked === null) return run.finish('refused', 'closed');

  const cargo: Cargo[] = [];
  for (const directory of asked) {
    if (!existsSync(directory)) {
      run.problems.add(
        'batch-missing',
        directory,
        `в партии назван ${directory}, а такого каталога в постройке нет. ` +
          `Партия — объявление о своём товаре: пути в ней считаются от корня ` +
          `постройки (${run.building.root})`,
      );
      continue;
    }
    const manifest = await trace.span(
      'manifest',
      () => readManifest(directory, run.problems),
      { directory },
    );
    if (manifest !== null) cargo.push({ directory, ...manifest });
  }
  if (!run.problems.empty) return run.finish('refused', 'closed');

  // Менеджер спрашивается ОДИН раз на каждого, кто нужен партии: `--version`
  // стоит запуска процесса, а ответ у него один на весь прогон.
  for (const manager of new Set(
    cargo.map((one) => chooseManager(one.needsWorkspace)),
  )) {
    if (managerAvailable(manager)) continue;
    run.problems.add(
      manager === 'pnpm' ? 'pnpm-required' : 'publish-failed',
      run.building.root,
      manager === 'pnpm'
        ? `у пакета есть зависимости workspace:, а pnpm в системе нет. ` +
            `npm опубликовал бы его УСПЕШНО и сломанным — с workspace:* в манифесте, ` +
            `который не ставится нигде`
        : `npm в системе нет — публиковать нечем`,
    );
  }
  if (!run.problems.empty) return run.finish('refused', 'running');

  // Склад закрыт — класть некуда. Спрашиваем ДО того, как трогать чужой
  // `.npmrc`: отказ не должен оставлять следов в каталоге человека.
  const knock = await trace.span('knock', () => knockOn(address));
  if (knock !== 'registry') {
    run.problems.add(
      'shop-closed',
      address,
      `магазин закрыт — класть товар некуда. Поднимите его: baser-registry up`,
    );
    return run.finish('refused', 'closed');
  }

  const shipped: PublishReport[] = [];
  for (const one of cargo) {
    shipped.push(await shipOne(run, one, address));
  }

  return run.finish(outcomeOf(shipped), 'running', null, shipped);
}

/** Один пакет партии: каталог и то, что прочитано из его манифеста. */
interface Cargo {
  readonly directory: string;
  readonly name: string;
  readonly version: string;
  readonly needsWorkspace: boolean;
}

/**
 * Что уезжает этим прогоном.
 *
 * `null` — отгружать нечего, и причина названа отказом. Пустая партия при
 * заведённом органе решения — это «есть, но не отдаю»: законное состояние, а не
 * недоделка, и молча подменять его пакетом из текущего каталога значило бы
 * отгрузить то, чего постройка не объявляла.
 */
function whatToShip(run: Run, options: PublishOptions): string[] | null {
  if (options.directory !== undefined) {
    return [resolve(options.cwd, options.directory)];
  }

  const decisions = run.decisions;
  if (decisions === null) {
    // Постройка ничего не объявила — команда остаётся тем, чем была: «положи
    // пакет отсюда». Требовать решений от того, кто их не заводил, значило бы
    // сделать законное состояние отказом.
    return [resolve(options.cwd, '.')];
  }

  if (decisions.batch.length === 0) {
    run.problems.add(
      'batch-empty',
      run.inBuilding.decisions,
      `эта постройка не отгружает ничего: партия в её решениях пуста. ` +
        `Отгрузить конкретный пакет всё равно можно — назовите его путём: ` +
        `baser-registry publish <папка>`,
    );
    return null;
  }

  return decisions.batch.map((one) => resolve(run.building.root, one));
}

/** Отгружает ОДИН пакет партии и рассказывает, что с ним стало. */
async function shipOne(
  run: Run,
  cargo: Cargo,
  address: string,
): Promise<PublishReport> {
  const manager = chooseManager(cargo.needsWorkspace);
  const card = {
    name: cargo.name,
    version: cargo.version,
    directory: cargo.directory,
    manager,
    needsWorkspace: cargo.needsWorkspace,
    destination: address,
  };

  // УЖЕ ЛЕЖИТ — делать нечего, и менеджера мы даже не запускаем: незачем
  // тратить секунды и трогать чужой `.npmrc` ради работы, которой нет.
  if (
    await run.trace.span(
      'on-shelf',
      () => onShelf(address, cargo.name, cargo.version),
      { package: cargo.name },
    )
  ) {
    return { outcome: 'already-published', ...card };
  }

  const outcome = await run.trace.span(
    'publish',
    () =>
      runPublish({
        manager,
        directory: cargo.directory,
        address,
        packageName: cargo.name,
      }),
    { package: cargo.name },
  );

  const said = { ...card, destination: outcome.destination ?? 'неизвестно' };

  if (outcome.published) {
    return { outcome: 'published', ...said };
  }

  // ГОНКА: между нашим вопросом складу и нашей попыткой ту же версию мог
  // положить кто-то другой. Спрашиваем склад ещё раз — исход тот же, что и
  // при обычном повторе, и узнаём мы его снова замером, а не разбором
  // чужого текста.
  if (await onShelf(address, cargo.name, cargo.version)) {
    return { outcome: 'already-published', ...said };
  }

  // Менеджер отказал сам — причина в пакете, а не в адресе.
  const wrongPlace =
    !outcome.refusedByManager &&
    (outcome.destination === null || outcome.destination !== address);
  run.problems.add(
    wrongPlace ? 'wrong-destination' : 'publish-failed',
    wrongPlace ? (outcome.destination ?? cargo.directory) : cargo.directory,
    wrongPlace
      ? `${manager} собрался публиковать в ${outcome.destination ?? 'неизвестно куда'}, ` +
          `а магазин локации — ${address}. Живой публикации не было`
      : `${manager} отказал на публикации:\n${outcome.said.trim()}`,
  );
  return { outcome: 'failed', ...said };
}

/**
 * Общий исход отгрузки из построчных.
 *
 * Один упавший пакет красит весь прогон: конвейеру нужно знать, идти ли
 * разбираться, а с ЧЕМ именно — он прочитает построчно. «Уже на складе» на всю
 * партию остаётся успехом по той же причине, по которой им остаётся второй
 * `up`: то же состояние без крика.
 */
function outcomeOf(shipped: readonly PublishReport[]): ShopOutcome {
  if (shipped.some((one) => one.outcome === 'failed')) return 'failed';
  return shipped.every((one) => one.outcome === 'already-published')
    ? 'already-published'
    : 'published';
}

/** Спросить, что сейчас. Ничего не меняет — в том числе не прибирает заявку. */
export async function status(options: ShopOptions): Promise<ShopResult> {
  const run = await prepare('status', options, { create: false });
  if (run.refused) return run.finish('refused', 'closed');

  const address = clientAddress(run.settings);
  const knock = await run.trace.span('knock', () => knockOn(address));
  const claim = readClaim(run.layout);

  return run.finish(
    'reported',
    knock === 'registry' ? 'running' : 'closed',
    knock === 'registry' ? (claim?.pid ?? null) : null,
  );
}

/**
 * Общее начало всех команд: найти постройку и магазин её локации, прочитать
 * настройки, родить файл.
 *
 * Вынесено сюда, потому что порядок здесь — часть контракта: настройки читаются
 * ДО первого действия, и непригодный конфиг отказывает, не тронув ни процесса,
 * ни диска.
 */
async function prepare(
  command: ShopCommand,
  options: ShopOptions,
  behaviour: { create: boolean } = { create: true },
) {
  const trace = createTrace();
  const problems = new ShopProblemLog();
  const writes: WriteReport[] = [];

  const building = await trace.span('locate', () =>
    locateBuilding(options.cwd),
  );
  const layout = shopLayout(options.environment);
  const inBuilding = buildingLayout(building.root);

  const text = existsSync(layout.config)
    ? readFileSync(layout.config, 'utf8')
    : null;
  const settings = await trace.span('settings', () =>
    readSettings(text, layout.config, problems),
  );

  // МАГАЗИН СТАЛ ВЕЩЬЮ ЛОКАЦИИ, И ПОСТРОЙКА СО СТАРЫМИ НАСТРОЙКАМИ УЗНАЁТ ОБ
  // ЭТОМ ОТКАЗОМ.
  //
  // Раздача принадлежит контейнеру, и её настройки не могут жить внутри одного
  // клона. Читать их мы не станем: молча подхватить значения, писанные для
  // другой раскладки, — тот же тихий эффект, от которого уходим.
  //
  // Проверяется только там, где нового файла ещё нет: перенёс человек значения
  // или начал с чистого листа — его дело, и напоминать про старый файл, когда
  // новый уже заполнен, значит мешать работать. Второе прежнее место
  // (`.omnifield/omnifield-registry.yaml`) сюда не входит: путь занят решениями
  // постройки, и старое содержимое ловится там по ключам — всегда, а не только
  // на пустом конфиге локации.
  if (text === null && existsSync(inBuilding.legacyShopConfig)) {
    problems.add(
      'config-in-old-place',
      inBuilding.legacyShopConfig,
      `настройки раздачи переехали на уровень локации — в ${layout.config}, ` +
        `а заполненный файл лежит в постройке (${inBuilding.legacyShopConfig}). ` +
        `Раздача одна на весь контейнер, поэтому её настройки не могут жить ` +
        `внутри одного клона. Перенесите значения: ` +
        `mv ${inBuilding.legacyShopConfig} ${layout.config}`,
    );
  }

  // РЕШЕНИЯ ПОСТРОЙКИ — читаются каждой командой, а не только публикацией.
  //
  // Спрашивают их у `status` ровно затем, зачем орган решения и заводился:
  // узнать, что эта постройка отгружает, не запуская отгрузку. Файла нет —
  // решений нет, и это законное состояние, а не пробел (`decisions.ts`).
  const decisionsText = existsSync(inBuilding.decisions)
    ? readFileSync(inBuilding.decisions, 'utf8')
    : null;
  const decisions = await trace.span('decisions', () =>
    readDecisions(decisionsText, inBuilding.decisions, layout.config, problems),
  );

  // Файл человека рождается один раз и только у команд, которые вообще пишут:
  // `status` — вопрос, а вопрос ничего не создаёт.
  if (behaviour.create && text === null && problems.empty) {
    mkdirSync(dirname(layout.config), { recursive: true });
    writeFileSync(layout.config, settingsTemplate(), 'utf8');
    writes.push({ path: layout.config, kind: 'CREATE' });
  }

  const address = clientAddress(settings);
  const scopes = options.scopes ?? readScopeConflicts;
  const scopeConflicts = await trace.span('scopes', () =>
    scopes(address, building.root),
  );

  const write = (path: string, content: string): void => {
    const existed = existsSync(path);
    writeFileSync(path, content, 'utf8');
    writes.push({ path, kind: existed ? 'UPDATE' : 'CREATE' });
  };

  const remove = (path: string): void => {
    if (removeIfExists(path)) writes.push({ path, kind: 'DELETE' });
  };

  const finish = (
    outcome: ShopOutcome,
    state: ShopState,
    pid: number | null = null,
    published: readonly PublishReport[] = [],
  ): ShopResult => ({
    schemaVersion: SCHEMA_VERSION,
    command,
    outcome,
    state,
    location: {
      shopHome: layout.home.path,
      origin: layout.home.origin,
    },
    building: {
      root: building.root,
      origin: building.origin,
      // Заявка читается ЗДЕСЬ, а не в начале прогона: `up` записывает её по
      // дороге, и признак, снятый заранее, соврал бы про собственный запуск —
      // поймано живым прогоном сразу после переезда.
      startedShop: readClaim(layout)?.building === building.root,
      decisions:
        decisions === null ? null : { at: inBuilding.decisions, ...decisions },
    },
    shop: {
      address,
      listen: listenAddress(settings),
      // Считается из настроек, а не из ответа раздачи: спросить «кому ты
      // виден» у самого процесса нечем — он отвечает всем, кто дошёл. Знание
      // тут ровно одно, и лежит оно в том, что мы отдали ему как `--listen`.
      reach: reachOf(settings),
      port: settings.port,
      uplink: settings.uplink,
      pid,
      claimed: existsSync(layout.claim),
      log: logPath(settings, layout.home.path),
    },
    stock: {
      storage: layout.storage,
      packages: countStock(layout.storage),
    },
    scopeConflicts,
    access: { npmrc: npmrcLines(address, scopeConflicts) },
    published,
    writes,
    trace: trace.snapshot(),
    problems: problems.list(),
  });

  return {
    building,
    inBuilding,
    layout,
    settings,
    decisions,
    trace: trace as TraceRecorder,
    problems,
    refused: !problems.empty,
    write,
    remove,
    finish,
  };
}

/** Прогон команды: всё, что прочитано до первого действия. */
type Run = Awaited<ReturnType<typeof prepare>>;

/**
 * Стучится по адресу магазина.
 *
 * `/-/ping` — вопрос из протокола npm, и отвечает на него любой реестр. Нам
 * важно различить три исхода, а не два: тишина (магазин закрыт), реестр (это
 * раздача) и «кто-то есть, но не реестр» (адрес занят чужим). Третий исход
 * отдельным словом, потому что чинится он не так, как первые два.
 */
async function knockOn(address: string): Promise<Knock> {
  try {
    const response = await fetch(`${address}/-/ping`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) return 'foreign';
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? 'registry' : 'foreign';
  } catch (error) {
    // Разбираем причину: отказ соединения — это тишина, а вот чужой сервер,
    // ответивший не-JSON, — это занятый адрес, и молчанием его звать нельзя.
    return isConnectionRefused(error) ? 'silent' : 'foreign';
  }
}

function isConnectionRefused(error: unknown): boolean {
  const causes = [error, (error as { cause?: unknown } | undefined)?.cause];
  return causes.some((one) => {
    const code = (one as { code?: string } | undefined)?.code;
    return (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'EHOSTUNREACH' ||
      (one as { name?: string } | undefined)?.name === 'TimeoutError'
    );
  });
}

/** Запускает раздачу отдельным процессом и возвращает его номер. */
function startProcess(
  layout: ShopLayout,
  settings: ShopSettings,
  logFile: string,
): number {
  const handle = openSync(logFile, 'a');
  try {
    const child = spawn(
      process.execPath,
      [
        // Наш запускатель, а не чужой bin: подпуть `verdaccio/bin/verdaccio` тот
        // пакет публичным не объявлял, и у потребителя он закрыт
        // (`tasker:BASER2-251`, разбор в `serve.ts`).
        shopEntry(),
        layout.generatedConfig,
        settings.host,
        String(settings.port),
      ],
      {
        // Отвязан от команды: `up` кончится, магазин останется. Ради этого всё.
        detached: true,
        stdio: ['ignore', handle, handle],
        // Рабочий каталог — корень магазина, а не то место, откуда позвали
        // команду: чужой процесс не обязан ничего писать нам под ноги, но если
        // напишет, пусть это будет наша территория.
        cwd: layout.home.path,
      },
    );
    child.unref();
    return child.pid ?? -1;
  } finally {
    closeSync(handle);
  }
}

type Awakening = 'awake' | 'died' | 'silent';

/**
 * Ждёт первого ответа раздачи, следя за тем, жив ли процесс.
 *
 * Смерть процесса ловится отдельно от таймаута НАМЕРЕННО: упавший на конфиге
 * магазин иначе выглядел бы как медленный, и человек ждал бы двадцать секунд
 * вместо того, чтобы сразу пойти в лог.
 */
async function waitForAnswer(
  address: string,
  pid: number,
  timeoutMs: number,
): Promise<Awakening> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return 'died';
    if ((await knockOn(address)) === 'registry') return 'awake';
    await delay(POLL_STEP_MS);
  }
  return alive(pid) ? 'silent' : 'died';
}

/**
 * Гасит процесс: сперва вежливо, потом жёстко.
 *
 * Порядок не формальность: `SIGTERM` даёт раздаче закрыть файлы склада, а
 * `SIGKILL` — последнее средство, и применяется он только когда первое не
 * сработало. Начать с жёсткого значило бы рисковать товаром ради секунд.
 */
async function stopProcess(pid: number): Promise<boolean> {
  if (!alive(pid)) return true;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return !alive(pid);
  }
  if (await waitForDeath(pid, STOP_TIMEOUT_MS)) return true;

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return !alive(pid);
  }
  return waitForDeath(pid, KILL_TIMEOUT_MS);
}

async function waitForDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await delay(POLL_STEP_MS);
  }
  return !alive(pid);
}

/** Жив ли процесс. Сигнал `0` не шлётся — только проверяется право послать. */
function alive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM означает «процесс есть, но не наш» — он жив, и это важнее прав.
    return (error as { code?: string }).code === 'EPERM';
  }
}

function readClaim(layout: ShopLayout): ShopClaim | null {
  if (!existsSync(layout.claim)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(layout.claim, 'utf8'));
    const pid = (parsed as { pid?: unknown }).pid;
    return typeof pid === 'number' ? (parsed as ShopClaim) : null;
  } catch {
    // Битая заявка равна её отсутствию: доверять ей нечем, а падать из-за
    // служебного файла команда не вправе.
    return null;
  }
}

/**
 * Сколько ИМЁН лежит на складе.
 *
 * Считаются каталоги, а скоуп разворачивается: `@baser/cli` — один
 * пакет, а не два и не ноль. Служебные файлы реестра (`.verdaccio-db.json`) и
 * всё скрытое пропускаются: человек спрашивает про товар, а не про наши записи.
 */
function countStock(storage: string): number {
  if (!existsSync(storage)) return 0;
  let count = 0;
  for (const entry of readdirSync(storage, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      count += readdirSync(join(storage, entry.name), {
        withFileTypes: true,
      }).filter((one) => one.isDirectory() && !one.name.startsWith('.')).length;
      continue;
    }
    count += 1;
  }
  return count;
}

function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}


/**
 * ЗНАЧЕНИЕ ТОКЕНА, которое магазин локации кладёт в подсказку.
 *
 * Проверять его некому: прав доступа в первом выпуске нет по решению ТЗ, и
 * раздача принимает любой непустой. Осмысленное слово вместо `fake` или
 * случайных букв — чтобы человек, наткнувшийся на эту строку в своём конфиге
 * через месяц, понял, откуда она и почему безобидна.
 */
const ANY_TOKEN = 'baser-registry';

/**
 * Строки конфига, которыми в этот магазин ходят.
 *
 * Общий адрес — первым: он покрывает всё, что не перебито скоупом. Дальше по
 * строке на КАЖДЫЙ скоуп, настроенный мимо нас: без неё публикация по такому
 * скоупу уедет в чужой реестр молча. Токен — последним, потому что без него
 * npm не станет публиковать вовсе, сколько адресов ни назови.
 */
function npmrcLines(
  address: string,
  conflicts: readonly ScopeConflict[],
): string[] {
  const host = address.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return [
    `registry=${address}`,
    ...conflicts.map((one) => `${one.scope}:registry=${address}`),
    `//${host}/:_authToken=${ANY_TOKEN}`,
  ];
}

/**
 * Спрашивает у npm, какие скоупы настроены МИМО этого магазина.
 *
 * Замер, а не совет. Скоуп-специфичная настройка бьёт `--registry` молча, и мы
 * это уже оплатили живьём: публикация пробы уехала в GitHub Packages вместо
 * локального магазина (`tasker:BASER2-249`). Инструмент, который сказал бы
 * «публикуйте так» не заглянув в конфиг человека, повторил бы ту же ловушку — с
 * той разницей, что теперь под нашей подписью.
 *
 * Молчание вместо отказа, если npm не отвечает: знать про расхождение — польза,
 * но не повод не поднять магазин.
 */
async function readScopeConflicts(
  address: string,
  cwd: string,
): Promise<ScopeConflict[]> {
  const printed = await runNpmConfig(cwd);
  if (printed === null) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(printed) as Record<string, unknown>;
  } catch {
    return [];
  }

  const ours = address.replace(/\/+$/, '');
  const found: ScopeConflict[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const match = /^(@[^:]+):registry$/.exec(key);
    if (!match || typeof value !== 'string') continue;
    if (value.replace(/\/+$/, '') === ours) continue;
    found.push({ scope: match[1], registry: value });
  }
  return found;
}

function runNpmConfig(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['config', 'list', '--json'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out : null));
  });
}
