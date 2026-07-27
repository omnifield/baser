/**
 * ДВЕРЬ — прогон целиком.
 *
 * Движок работает с виртуальным деревом и на диск не пишет, поэтому позвать
 * станок сегодня нечем (`tasker:BASER2-18`). Здесь то, что его зовёт:
 *
 * ```
 * baser.json + package.json обвеса        ← дверь читает
 *          ↓ resolveSettings                (контракты)
 *   значения + движение дефолта           ← дверь НАЗЫВАЕТ до применения
 *          ↓ checkTemplate → EJS           (форма решает, дверь рендерит)
 *   готовое содержимое → CanonSource      ← движок значений не видит
 *          ↓ computePlan / applyPlan       (движок)
 *   виртуальное дерево → flushChanges     ← дверь кладёт на реальную ФС
 * ```
 *
 * Инварианты прогона, за которые отвечает именно этот файл:
 *
 * **Ноль вопросов пользователю.** Ни одного промпта, ни одного `process.stdin`:
 * не заполнено — работает дефолт. В CI команда обязана вести себя ровно как у
 * человека (`tasker:BASER2-18`), поэтому «интерактивного режима» нет вовсе, а не
 * выключается флагом.
 *
 * **`plan` не пишет.** Обе команды идут по ОДНОМУ пути и строят одно и то же
 * дерево; расходятся они ровно на последнем шаге — сбросе. План, посчитанный по
 * другому состоянию, чем применение, не был бы планом.
 *
 * **Применение целиком либо никак.** Конфликт владения — и на диск не уходит
 * ничего, включая конфиг, который дверь родила бы этим же прогоном.
 */

import { FsTree, flushChanges } from 'nx/src/generators/tree.js';
import {
  checkSingleProvider,
  FORM_VERSION,
  readSourceDeclaration,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';
import {
  applyPlan,
  computePlan,
  createTrace,
  DeclarationError,
  OUTPUT_SCHEMA_VERSION,
  type ApplyReport,
  type Declaration,
  type MaterializationPlan,
  type TraceRecorder,
} from '@omnifield/baser-materialize';
import { DOOR_SCHEMA_VERSION } from './schema.js';
import { DoorProblemLog, type DoorProblem } from './problems.js';
import {
  locateContentRoot,
  resolveInstalledPackage,
  type InstalledPackage,
  type SourceLocation,
} from './installed.js';
import {
  readConsumerConfig,
  readRepo,
  serializeConsumerConfig,
  type Repo,
} from './repo.js';
import { createDoorSource, renderLayout } from './render.js';
import { loadDefaults, resolveValues, type SettingMovement } from './values.js';
import type {
  ConfigReport,
  DoorCommand,
  DoorResult,
  SourceReport,
  WriteReport,
} from './result.js';

export interface RunOptions {
  readonly command: DoorCommand;
  /** Корень репозитория потребителя: откуда позвали либо `--cwd`. */
  readonly cwd: string;
  /**
   * Перечень `dest`, для которых перезапись чужого файла подтверждена.
   *
   * Поимённо, а не флагом: согласие не масштабируется само, и это правило
   * движка, а не двери (`PlanOptions.confirm`). Что подтверждать — план
   * называет сам, конфликтами с `detail.resolution === 'confirm'`.
   */
  readonly confirm?: readonly string[];
}

/**
 * Что известно про этот прогон на любой его точке.
 *
 * Собрано в один объект не ради краткости: отказ может случиться на любом шаге,
 * и ответ обязан нести ВСЁ, что дверь успела узнать к этому моменту, — иначе
 * починка идёт по одному прогону на догадку.
 */
interface Session {
  readonly repo: Repo;
  readonly command: DoorCommand;
  /** Спаны фаз двери. Движок мерит себя сам и своим трейсом. */
  readonly trace: TraceRecorder;
  config: ConfigReport;
}

/** Прогон двери. Бросков наружу не делает: сбой — тоже ответ. */
export async function run(options: RunOptions): Promise<DoorResult> {
  const session: Session = {
    repo: readRepo(options.cwd),
    command: options.command,
    trace: createTrace(),
    config: blankConfig(),
  };

  try {
    return await runInRepo(session, options);
  } catch (cause) {
    // Прогон в CI обязан отдавать разбираемый ответ даже когда дверь сломалась
    // сама: стек в поток — это не ответ, а симптом.
    return refused(session, [
      {
        code: 'door-failed',
        at: session.repo.root,
        message: `дверь сорвалась: ${describe(cause)}`,
      },
    ]);
  }
}

async function runInRepo(
  session: Session,
  options: RunOptions,
): Promise<DoorResult> {
  const { repo, trace } = session;
  const log = new DoorProblemLog();

  // ── 1. Конфиг потребителя.
  const state = trace.span('door.config', () => readConsumerConfig(repo));
  if (!state.ok) {
    log.addAll(state.problems);
    return refused(session, log.list());
  }
  const { config } = state.value;

  // Пустой конфиг дверь не кладёт: файл, объявляющий ноль обвесов, — мусор в
  // чужом репозитории, а не миграционный крючок.
  const creates = state.value.creates && config.sources.length > 0;
  session.config = {
    path: state.value.path,
    existed: state.value.existed,
    creates,
    formVersion: config.formVersion,
  };

  if (config.sources.length === 0) {
    return { ...shell(session), status: 'no-sources' };
  }

  // ── 2. Обвес. Ровно один — см. `multiple-sources`.
  if (config.sources.length > 1) {
    log.add(
      'multiple-sources',
      `${session.config.path}.sources`,
      `поставлено обвесов: ${config.sources.length} (${config.sources
        .map((entry) => entry.use)
        .join(
          ' · ',
        )}). Форма это допускает с первого дня, а движок сегодня — нет: ` +
        'план строится по ОДНОЙ декларации, а сироты ищутся сканом всего дерева, ' +
        'поэтому второй прогон снял бы артефакты первого как потерявшие объявление. ' +
        'Отказ вместо тихой порчи; много источников целиком — отдельная работа (A5)',
    );
    return refused(session, log.list());
  }

  const entry = config.sources[0];
  const declared = trace.span('door.declaration', () => {
    const installed = resolveInstalledPackage(entry.use, repo.root);
    if (!installed.ok) {
      log.add(
        installed.failure.reason === 'not-found'
          ? 'package-not-found'
          : 'package-manifest-unreadable',
        `${session.config.path}.sources[0].use`,
        installed.failure.detail,
      );
      return null;
    }

    const parsed = readSourceDeclaration(
      installed.value.manifest,
      `${installed.value.packageName}/package.json`,
    );
    if (!parsed.ok) {
      log.addAll(parsed.problems);
      return null;
    }

    // Карта владения над всеми поставленными обвесами сразу. Сегодня обвес
    // один, и проверка ловит столкновение ВНУТРИ него; список здесь не ради
    // будущего, а потому что столкновение — свойство НАБОРА, и спрашивать про
    // него надо там, где набор есть (`kb:BASER2-6`).
    const owners = checkSingleProvider([
      { declaration: parsed.value, packageName: installed.value.packageName },
    ]);
    if (!owners.ok) {
      log.addAll(owners.problems);
      return null;
    }

    return { declaration: parsed.value, pkg: installed.value };
  });

  if (declared === null) {
    return refused(session, log.list());
  }
  const { declaration, pkg } = declared;

  const location = locateContentRoot(
    repo.root,
    pkg.root,
    declaration.source.contentRoot,
  );
  const source = describeSource(declaration, pkg, location);

  // ── 3. Значения и движение дефолта.
  //
  // Загрузка модулей резолверов асинхронна, а спаны трейса — синхронны, и это
  // не недосмотр: резолвер обязан быть синхронной чистой функцией, асинхронна
  // только доставка его модуля. Она отмечается счётчиком, а не длительностью —
  // мерить нечего, а врать нулевым спаном хуже, чем не мерить.
  const defaults = await loadDefaults(declaration, pkg, repo);
  trace.event('door.resolvers', {
    settings: Object.keys(declaration.settings).length,
  });

  const values = trace.span('door.values', () =>
    resolveValues(declaration, entry, defaults),
  );
  if (!values.ok) {
    log.addAll(values.problems);
    return refused(session, log.list(), source);
  }
  const { movements } = values.value;

  // ── 4. Содержимое. Форма проверяется ДО подстановки, движок значений не видит.
  const rendered = trace.span(
    'door.render',
    () => renderLayout(declaration, pkg, values.value.values),
    { templates: declaration.layout.length },
  );
  if (rendered.problems.length > 0) {
    log.addAll(rendered.problems);
    return refused(session, log.list(), source, movements);
  }

  // ── 5. Дерево. `plan` и `apply` строят одно и то же — расходятся на сбросе.
  const tree = new FsTree(repo.root, false);
  if (creates) {
    tree.write(session.config.path, serializeConsumerConfig(config));
  }

  let plan: MaterializationPlan;
  try {
    plan = computePlan({
      tree,
      declaration: engineInput(declaration, location),
      source: createDoorSource(rendered, declaration, pkg),
      ...(options.confirm ? { confirm: options.confirm } : {}),
    });
  } catch (cause) {
    log.add(...engineRefusal(cause, source));
    return refused(session, log.list(), source, movements);
  }

  const base = { ...shell(session), source, settings: movements, plan };

  if (plan.status === 'blocked') {
    return { ...base, status: 'blocked', trace: trace.snapshot() };
  }

  // Есть ли работа — вопрос ко ВСЕМУ прогону, а не к одному плану. Конфиг,
  // который дверь родит этим прогоном, движок своим шагом не считает и считать
  // не может: он о нём не знает. Гейт, спросивший «сошлось?» и получивший «да»
  // там, где `apply` ещё поменяет репозиторий, зеленел бы вхолостую.
  const work = plan.steps.length > 0 || creates;

  if (options.command === 'plan') {
    // `plan` не пишет — значит и записей у него нет. Что ЛЯЖЕТ, читается из
    // `plan.steps` и `config.creates`; дублировать это третьим списком значило
    // бы завести две правды об одном.
    return {
      ...base,
      status: work ? 'pending' : 'converged',
      trace: trace.snapshot(),
    };
  }

  // ── 6. Применение и сброс на реальную ФС.
  let applied: ApplyReport;
  try {
    applied = applyPlan(tree, plan);
  } catch (cause) {
    log.add(
      'engine-refused',
      source.id,
      `применение не прошло: ${describe(cause)}`,
    );
    return refused(session, log.list(), source, movements, plan);
  }

  // Сходимость отделена от применения ровно так же, как у движка отделена от
  // пустоты: «применено» на дереве, где применять было нечего, — это отчёт о
  // работе, которой не было.
  const writes = changesOf(tree);
  if (writes.length === 0) {
    return { ...base, status: 'converged', applied, trace: trace.snapshot() };
  }

  try {
    trace.span(
      'door.flush',
      () => flushChanges(repo.root, tree.listChanges()),
      {
        writes: writes.length,
      },
    );
  } catch (cause) {
    log.add(
      'flush-failed',
      repo.root,
      `сброс дерева на диск сорвался: ${describe(cause)}. Движок откатить это ` +
        'не может — его журнал кончается на виртуальном дереве',
    );
    return refused(session, log.list(), source, movements, plan);
  }

  return {
    ...base,
    status: 'applied',
    applied,
    writes,
    trace: trace.snapshot(),
  };
}

/**
 * Вход движку.
 *
 * `contentRoot` подаётся ПРАВДОЙ, а не правдоподобием. Внутри дерева это
 * настоящий путь, и защита движка «не писать в собственный источник» работает в
 * полную силу. Вне дерева репо-относительного пути не существует, и дверь
 * говорит именно это: подделанный путь выглядел бы как защита, а защищал бы
 * пустоту (`installed.ts`, `README.md` § «Шов contentRoot»).
 */
function engineInput(
  declaration: SourceDeclaration,
  location: SourceLocation,
): Declaration {
  return {
    source: {
      id: declaration.source.id,
      // Форма «источника в этом дереве нет» принята architect'ом (2026-07-27);
      // типом движок её пока не объявляет — это правка его зоны. Дверь подаёт
      // её уже сейчас: переучивать дверь потом не придётся, а до тех пор отказ
      // движка переводится в названный `source-outside-tree`.
      contentRoot:
        location.kind === 'in-tree'
          ? location.path
          : (null as unknown as string),
    },
    layout: declaration.layout.map((item) => ({
      src: item.src,
      dest: item.dest,
    })),
  };
}

/**
 * Отказ движка на входе — в код двери.
 *
 * Отдельный код у случая «источник вне дерева» потому, что чинят его в разных
 * местах: непригодную структуру правит дверь, а вырожденную защиту закрывает
 * зона движка. Один код на оба означал бы «что-то не так со входом» — то есть
 * ничего.
 */
function engineRefusal(
  cause: unknown,
  source: SourceReport,
): [
  code: 'source-outside-tree' | 'engine-refused',
  at: string,
  message: string,
] {
  const detail = describe(cause);

  if (
    source.location.kind === 'outside-tree' &&
    cause instanceof DeclarationError
  ) {
    return [
      'source-outside-tree',
      `${source.packageName}/${source.contentRoot}`,
      `обвес "${source.packageName}" поставлен вне репозитория ("${source.location.absolute}"), ` +
        'поэтому репо-относительного пути к его шаблонам не существует. Движок адресует ' +
        'источник таким путём и им же защищается от записи в собственный источник; форма ' +
        '«источника в этом дереве нет» принята, но зоной движка ещё не выпущена. ' +
        `Пока её нет — поставь обвес в этот репозиторий. Отказ движка: ${detail}`,
    ];
  }

  return [
    'engine-refused',
    source.id,
    `движок отверг поданный вход: ${detail}`,
  ];
}

function describeSource(
  declaration: SourceDeclaration,
  pkg: InstalledPackage,
  location: SourceLocation,
): SourceReport {
  return {
    id: declaration.source.id,
    title: declaration.source.title,
    packageName: pkg.packageName,
    packageVersion: pkg.version,
    packageRoot: pkg.root,
    contentRoot: declaration.source.contentRoot,
    location,
  };
}

/**
 * Что ушло на реальную ФС — включая конфиг, о котором движок не знает.
 *
 * Список СОСТОЯВШИХСЯ записей, а не намерений: у `plan` он пуст по построению,
 * потому что `plan` не пишет. Намерения читаются из `plan.steps`.
 */
function changesOf(tree: FsTree): WriteReport[] {
  return tree
    .listChanges()
    .map((change) => ({ path: change.path, kind: change.type }));
}

function shell(session: Session): Omit<DoorResult, 'status'> {
  return {
    doorSchemaVersion: DOOR_SCHEMA_VERSION,
    formVersion: FORM_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    command: session.command,
    repo: { root: session.repo.root, name: session.repo.name },
    config: session.config,
    source: null,
    settings: [],
    plan: null,
    applied: null,
    writes: [],
    trace: session.trace.snapshot(),
    problems: [],
  };
}

/**
 * Отказ двери. Всё, что дверь успела узнать, остаётся в ответе.
 *
 * Отказ не обнуляет рассказ: пользователь, у которого не собрался один шаблон,
 * обязан видеть и разрешённые значения, и уже посчитанный план — иначе починка
 * идёт по одному прогону на догадку.
 */
function refused(
  session: Session,
  problems: readonly DoorProblem[],
  source: SourceReport | null = null,
  settings: readonly SettingMovement[] = [],
  plan: MaterializationPlan | null = null,
): DoorResult {
  return {
    ...shell(session),
    status: 'refused',
    source,
    settings,
    plan,
    problems,
  };
}

function blankConfig(): ConfigReport {
  return {
    path: 'baser.json',
    existed: false,
    creates: false,
    formVersion: FORM_VERSION,
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
