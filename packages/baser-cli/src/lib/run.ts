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
 *   виртуальное дерево → tree.flush()     ← дверь кладёт на реальную ФС
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
 *
 * ## Обвесов много — прогон по каждому (`tasker:BASER2-55`)
 *
 * Несколько инструментов в одном репозитории есть норма по построению
 * (`kb:BASER2-4`), а движок считает план ПО ОДНОЙ декларации. Значит дверь
 * читает перечень и гоняет прогон по каждому обвесу, сводя результат в один
 * ответ. Отказ `multiple-sources` снят вместе с причиной, а не подавлен: пока
 * движок считал сиротами чужие записи, проход по всем обвесам снёс бы репозиторий
 * вместо отказа — теперь он распоряжается только своими (`tasker:BASER2-7`).
 *
 * Порядок фаз при этом ЕДИНЫЙ на весь набор, а не «весь прогон по одному, потом
 * весь по второму»:
 *
 * ```
 * объявления всех обвесов → карта владения над НАБОРОМ → значения и содержимое
 *   каждого → [план обвеса → применение к виртуальному дереву]* → один сброс
 * ```
 *
 * **Карта владения спрашивается у набора, а не у обвеса.** Столкновение двух
 * инструментов на один `dest` — свойство комбинации: каждый обвес поодиночке
 * безупречен (`checkSingleProvider`, `kb:BASER2-6`). Проверка стоит ДО всякого
 * прогона, поэтому её отказ не зависит от того, чей прогон случился первым.
 *
 * **Виртуальное дерево доводится до конца обеими командами.** План второго
 * обвеса считается по дереву, в котором первый уже применён, — иначе он был бы
 * планом по состоянию, которого не будет. `plan` от `apply` по-прежнему
 * отличается ровно сбросом: на диск у него не уходит ничего, а отчёт применения
 * он не выдаёт вовсе — работой в репозитории это не было.
 *
 * **Столкновение дверь ДОНОСИТ, а не проглатывает.** Отказ движка
 * `cross-source-dest` (путь уже числится за соседом) уезжает в ответ как есть, и
 * порядком прогонов дверь его не снимает: перехват сделал бы владение функцией
 * очереди в конфиге.
 */

import {
  checkSingleProvider,
  FORM_VERSION,
  readSourceDeclaration,
  sourceConfigPath,
  type ArtifactOwners,
  type ConsumerSourceEntry,
  type SettingValue,
  type SourceConfig,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';
import {
  applyPlan,
  BaserMaterializeError,
  computePlan,
  createTrace,
  MANIFEST_PATH,
  OUTPUT_SCHEMA_VERSION,
  readManifest,
  toRepoPath,
  type ApplyReport,
  type Declaration,
  type MaterializationPlan,
  type TraceRecorder,
} from '@omnifield/baser-materialize';
import { createRepoTree, type RepoTree } from './tree.js';
import { DOOR_SCHEMA_VERSION } from './schema.js';
import {
  DoorProblemLog,
  type DoorProblem,
  type ProblemCode,
} from './problems.js';
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
import {
  createDoorSource,
  renderLayout,
  type RenderedLayout,
} from './render.js';
import { readSourceConfig, renderSourceConfig } from './settings.js';
import { recoverPlacedValues, type PlacedValue } from './previous.js';
import { loadDefaults, resolveValues, type SettingMovement } from './values.js';
import type {
  ConfigReport,
  DoorCommand,
  DoorResult,
  SourceConfigReport,
  SourceReport,
  SourceRun,
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

/**
 * Прогон одного обвеса, пока он собирается.
 *
 * Черновик мутабелен намеренно: отказ может случиться на любой фазе, а рассказ
 * про обвесы, которые дверь успела разобрать, обязан доехать до ответа целиком.
 * Наружу уезжает `SourceRun` — та же запись, но уже неизменяемая.
 */
interface DraftRun {
  readonly source: SourceReport;
  config: SourceConfigReport;
  settings: readonly SettingMovement[];
  plan: MaterializationPlan | null;
  applied: ApplyReport | null;
}

/**
 * ОЧЕРЕДЬ ПРОГОНОВ: отдающий артефакт идёт раньше принимающего.
 *
 * Случай: сосед выпустился и перестал класть файл, а второй начал. Отдающий
 * снимет его как своего сироту и уберёт запись; принимающий положит и запишет
 * себя. Порядок между этими двумя действиями не свободен — освобождение обязано
 * случиться раньше захвата, иначе принимающий видит в паспорте чужую запись и
 * упирается в `cross-source-dest` (`tasker:BASER2-58`).
 *
 * ## Это НЕ «разрешение столкновения порядком прогона»
 *
 * Запрет, из-за которого правку однажды отложили, звучит иначе: **владение не
 * должно доставаться тому, кто прогнался первым** (`kb:BASER2-6`). Здесь
 * ровно наоборот — очередь УБИРАЕТ зависимость от порядка: при любой записи в
 * конфиге освобождение считается раньше захвата, и исход один и тот же.
 * Спор двух объявлений на один путь этим не решается и решаться не может: его
 * ловит форма (`checkSingleProvider`) ДО всякого прогона, и очередь его не
 * видит вовсе.
 *
 * ## Что считается связью
 *
 * `dest` объявлен обвесом B, а паспорт укладки числит его за A, и A **в этом
 * прогоне участвует и больше его не объявляет** — значит A отдаёт, B принимает.
 * Ни одно из трёх условий не лишнее: A вне прогона освободить путь не может
 * (отказ остаётся, и он верен), а A, всё ещё объявляющий этот путь, — это спор,
 * а не передача.
 *
 * ## Взаимный обмен
 *
 * Два обвеса, меняющиеся артефактами, дают цикл, и очередью он не разрешается:
 * кто бы ни пошёл первым, он захватывает путь, ещё числящийся за соседом.
 * Порядок в этом случае остаётся конфиговым, и дверь останавливается отказом —
 * ОДИНАКОВЫМ в обе стороны. Задача была не «пропустить всё», а «перестать
 * зависеть от очереди записей», и на цикле это соблюдено тоже.
 *
 * Порядок устойчив: при отсутствии связей он в точности конфиговый — рассказ о
 * прогонах читает человек, и переставлять его без причины значит путать без
 * причины.
 */
function handoverOrder(
  prepared: readonly Prepared[],
  tree: RepoTree,
): readonly Prepared[] {
  if (prepared.length < 2) {
    return prepared;
  }

  const manifest = readManifest(tree);
  const declaredBy = new Map<string, Set<string>>(
    prepared.map((item) => [
      item.declaration.source.id,
      new Set(item.declaration.layout.map((entry) => entry.dest)),
    ]),
  );
  const byId = new Map(
    prepared.map((item) => [item.declaration.source.id, item]),
  );

  /** Кого этот обвес обязан дождаться: ключ ждёт значений. */
  const waitsFor = new Map<Prepared, Set<Prepared>>(
    prepared.map((item) => [item, new Set()]),
  );

  for (const claimer of prepared) {
    for (const entry of claimer.declaration.layout) {
      const record = manifest.get(entry.dest);
      const owner = record === undefined ? null : byId.get(record.source);
      if (
        record === undefined ||
        owner === null ||
        owner === undefined ||
        owner === claimer ||
        declaredBy.get(record.source)?.has(entry.dest) === true
      ) {
        continue;
      }
      waitsFor.get(claimer)?.add(owner);
    }
  }

  const ordered: Prepared[] = [];
  const left = [...prepared];
  while (left.length > 0) {
    const index = left.findIndex((item) =>
      [...(waitsFor.get(item) ?? [])].every((wait) => ordered.includes(wait)),
    );
    if (index === -1) {
      // Цикл: очередью не разрешается. Остаток идёт как в конфиге — исход
      // (отказ) от этого не меняется, а порядок остаётся предсказуемым.
      ordered.push(...left);
      break;
    }
    ordered.push(...left.splice(index, 1));
  }
  return ordered;
}

/** Обвес, доведённый до входа в движок: объявление, содержимое, черновик. */
interface Prepared {
  readonly declaration: SourceDeclaration;
  readonly pkg: InstalledPackage;
  readonly location: SourceLocation;
  readonly rendered: RenderedLayout;
  /**
   * Значения, с которыми собрано содержимое.
   *
   * Держатся до конца прогона, потому что нужны ПОСЛЕ плана: прежний конец
   * движения восстанавливается пересчётом этого же шаблона на других значениях
   * (`previous.ts`).
   */
  readonly values: Readonly<Record<string, SettingValue>>;
  /**
   * Текст новорождённого файла настроек; `null` — файл уже есть.
   *
   * Считается на подготовке, а кладётся в дерево вместе с остальным: дверь
   * рождает файл ОДИН РАЗ и больше в него не пишет никогда (`settings.ts`).
   */
  readonly born: string | null;
  readonly draft: DraftRun;
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

  // ── 2. Объявления ВСЕХ поставленных обвесов.
  //
  // Разбор идёт по всему перечню и не встаёт на первом непригодном: два
  // ненайденных пакета — это два отказа, а не два прогона по штуке.
  const drafts: DraftRun[] = [];
  const declared = trace.span(
    'door.declarations',
    () => readDeclarations(config.sources, repo, session.config.path, log),
    { sources: config.sources.length },
  );
  if (declared === null) {
    return refused(session, log.list());
  }

  for (const item of declared) {
    drafts.push({
      source: describeSource(item.declaration, item.pkg, item.location),
      config: blankSourceConfig(item.declaration.source.id),
      settings: [],
      plan: null,
      applied: null,
    });
  }

  // «Чем шёл прогон» — первое, что спрашивают, когда у потребителя поехало:
  // каким обвесом, какой ВЕРСИИ и сколько артефактов он держит не своими
  // руками. Событие, а не спан: мерить здесь нечего, а врать нулевой
  // длительностью хуже, чем не мерить.
  trace.event('door.sources', {
    sources: declared.map((item) => ({
      id: item.declaration.source.id,
      version: item.pkg.version,
      artifacts: item.declaration.layout.length,
      placedOnce: item.declaration.layout.filter(
        (entry) => entry.class === 'placed-once',
      ).length,
    })),
  });

  // ── 3. Карта владения над НАБОРОМ обвесов.
  //
  // Столкновение двух инструментов на один `dest` — свойство комбинации, а не
  // обвеса: каждый поодиночке безупречен, непригодны они вместе (`kb:BASER2-6`).
  // Спрашивается это ДО всякого прогона — поэтому отказ не зависит от того, чей
  // прогон случился первым, и порядком записей в конфиге не разрешается.
  const owned = trace.span(
    'door.owners',
    () =>
      checkSingleProvider(
        declared.map((item) => ({
          declaration: item.declaration,
          packageName: item.pkg.packageName,
        })),
      ),
    { sources: declared.length },
  );
  if (!owned.ok) {
    log.addAll(owned.problems);
    return refused(session, log.list(), drafts);
  }
  const owners = owned.value;

  // ── 4. Значения и содержимое — по каждому обвесу.
  const prepared: Prepared[] = [];
  for (const [index, item] of declared.entries()) {
    const ready = await prepare(item, drafts[index], { repo, trace, log });
    if (ready !== null) {
      prepared.push(ready);
    }
  }
  if (!log.empty) {
    return refused(session, log.list(), drafts);
  }

  // ── 5. Дерево. `plan` и `apply` строят одно и то же — расходятся на сбросе.
  const tree = createRepoTree(repo.root);

  // Снимок ДО всякой записи: следующие прогоны положат в дерево служебную
  // запись, и признак «записи здесь нет» перестал бы отличать первую установку
  // от второго обвеса, который просто лёг раньше.
  const hadManifest = tree.exists(MANIFEST_PATH);

  if (creates) {
    tree.write(session.config.path, serializeConsumerConfig(config));
  }

  // Новорождённые файлы настроек — ДО планов и вместе с ними одним сбросом.
  // Движок о них не знает и знать не должен: файл настроек не запись раскладки,
  // в паспорте укладки не числится и сиротой не бывает (`tasker:BASER2-10` §3).
  for (const item of prepared) {
    if (item.born !== null) {
      tree.write(item.draft.config.path, item.born);
    }
  }

  // ── 6. Прогон по каждому обвесу: план → применение к ВИРТУАЛЬНОМУ дереву.
  //
  // Применяется и под командой `plan`: план второго обвеса обязан считаться по
  // дереву, в котором первый уже лёг, иначе это план по состоянию, которого не
  // будет. На диск при этом не уходит ничего — сброса ниже у `plan` нет.
  // Очередь прогонов: отдающий артефакт раньше принимающего (`BASER2-58`).
  // Сюда доходят ВСЕ обвесы — прогон с непригодным отказал бы выше, — поэтому
  // очередь и есть полный список прогонов, и ответ строится по ней.
  const sequence = handoverOrder(prepared, tree);

  let blocked = false;
  for (const item of sequence) {
    const { draft } = item;
    let plan: MaterializationPlan;
    try {
      plan = computePlan({
        tree,
        declaration: engineInput(item.declaration, item.location, item.pkg),
        source: createDoorSource(item.rendered, item.declaration, item.pkg),
        ...(options.confirm
          ? { confirm: confirmFor(draft.source.id, owners, options.confirm) }
          : {}),
      });
    } catch (cause) {
      log.add(...engineRefusal(cause, draft.source));
      return refused(session, log.list(), drafts);
    }
    draft.plan = plan;

    // Прежний конец движения — ПОСЛЕ плана и до применения: материал даёт сам
    // план (`step.previous`), а сказать это человеку надо раньше, чем что-то
    // поедет (`tasker:BASER2-38`).
    draft.settings = trace.span(
      'door.placed',
      () => withPlacedValues(draft.settings, plan, item),
      { source: draft.source.id, steps: plan.steps.length },
    );

    // Заблокированный прогон к дереву не применяется, а разбор идёт дальше:
    // соседний обвес целится в СВОИ пути (карта владения выше это доказала), и
    // его отказ, если он есть, тоже обязан быть назван. Применения при этом не
    // случится ни у кого — на диск не уйдёт ничего.
    if (plan.status === 'blocked') {
      blocked = true;
      continue;
    }

    let applied: ApplyReport;
    try {
      applied = applyPlan(tree, plan);
    } catch (cause) {
      log.add(...engineRefusal(cause, draft.source));
      return refused(session, log.list(), drafts);
    }
    // У `plan` отчёта применения нет вовсе: применяли виртуальное дерево, а не
    // репозиторий, и назвать это «применено» значило бы отчитаться о работе,
    // которой на диске не было.
    if (options.command === 'apply') {
      draft.applied = applied;
    }
  }

  // Прогоны отдаются В ТОМ ПОРЯДКЕ, в котором считались. Показать их порядком
  // из конфига значило бы соврать про причинность: план второго обвеса считан
  // по дереву, в котором первый уже применён, и читаться они обязаны так же.
  const base = {
    ...shell(session),
    runs: freeze(sequence.map((item) => item.draft)),
  };

  if (blocked) {
    // Отказы движка остаются его отказами — дверь их не переписывает. Но у
    // пачки «файл уже существует» бывает одна общая причина, которую видно
    // только отсюда, и назвать её обязана дверь.
    const why = diagnoseForeignDests(hadManifest, drafts, session.config);
    if (why !== null) {
      log.addAll([why]);
    }
    return {
      ...base,
      status: 'blocked',
      problems: log.list(),
      trace: trace.snapshot(),
    };
  }

  // Есть ли работа — вопрос ко ВСЕМУ прогону, а не к одному плану и не к одному
  // обвесу. Конфиг, который дверь родит этим прогоном, движок своим шагом не
  // считает и считать не может: он о нём не знает. Гейт, спросивший «сошлось?» и
  // получивший «да» там, где `apply` ещё поменяет репозиторий, зеленел бы
  // вхолостую.
  const work =
    drafts.some((draft) => hasWork(draft) || draft.config.creates) || creates;

  if (options.command === 'plan') {
    // `plan` не пишет — значит и записей у него нет. Что ЛЯЖЕТ, читается из
    // `runs[].plan.steps` и `config.creates`; дублировать это третьим списком
    // значило бы завести две правды об одном.
    return {
      ...base,
      status: work ? 'pending' : 'converged',
      trace: trace.snapshot(),
    };
  }

  // ── 7. Сброс на реальную ФС — ОДИН на все обвесы.
  //
  // Сходимость отделена от применения ровно так же, как у движка отделена от
  // пустоты: «применено» на дереве, где применять было нечего, — это отчёт о
  // работе, которой не было.
  const writes = changesOf(tree);
  if (writes.length === 0) {
    return { ...base, status: 'converged', trace: trace.snapshot() };
  }

  try {
    trace.span('door.flush', () => tree.flush(), {
      writes: writes.length,
    });
  } catch (cause) {
    log.add(
      'flush-failed',
      repo.root,
      `сброс дерева на диск сорвался: ${describe(cause)}. Движок откатить это ` +
        'не может — его журнал кончается на виртуальном дереве',
    );
    return refused(session, log.list(), drafts);
  }

  return {
    ...base,
    status: 'applied',
    writes,
    trace: trace.snapshot(),
  };
}

/** Объявление обвеса плюс то, где физически лежит его содержимое. */
interface DeclaredSource {
  readonly declaration: SourceDeclaration;
  readonly pkg: InstalledPackage;
  readonly location: SourceLocation;
}

/**
 * Читает объявления всех поставленных обвесов.
 *
 * `null` — хоть один непригоден, и прогона не будет: раскладывать половину
 * набора нельзя, потому что применение проходит целиком либо никак. Отказы при
 * этом собраны по ВСЕМУ перечню — адрес каждого несёт индекс записи конфига,
 * иначе при двух одинаковых кодах непонятно, какую из них чинить.
 */
function readDeclarations(
  entries: readonly ConsumerSourceEntry[],
  repo: Repo,
  configPath: string,
  log: DoorProblemLog,
): DeclaredSource[] | null {
  const declared: DeclaredSource[] = [];

  for (const [index, entry] of entries.entries()) {
    const at = `${configPath}.sources[${index}].use`;
    const installed = resolveInstalledPackage(entry.use, repo.root);
    if (!installed.ok) {
      log.add(
        installed.failure.reason === 'not-found'
          ? 'package-not-found'
          : 'package-manifest-unreadable',
        at,
        installed.failure.detail,
      );
      continue;
    }

    const parsed = readSourceDeclaration(
      installed.value.manifest,
      `${installed.value.packageName}/package.json`,
    );
    if (!parsed.ok) {
      log.addAll(parsed.problems);
      continue;
    }

    declared.push({
      declaration: parsed.value,
      pkg: installed.value,
      location: locateContentRoot(
        repo.root,
        installed.value.root,
        parsed.value.source.contentRoot,
      ),
    });
  }

  return log.empty ? declared : null;
}

interface PrepareContext {
  readonly repo: Repo;
  readonly trace: TraceRecorder;
  readonly log: DoorProblemLog;
}

/**
 * Значения и готовое содержимое одного обвеса.
 *
 * Отказ здесь не уносит соседей: черновик обвеса всё равно доезжает до ответа с
 * тем, что дверь про него успела узнать, а разбор идёт к следующему.
 */
async function prepare(
  item: DeclaredSource,
  draft: DraftRun,
  context: PrepareContext,
): Promise<Prepared | null> {
  const { declaration, pkg } = item;
  const { repo, trace, log } = context;
  const source = draft.source.id;

  // ── Файл настроек. Его нет — это не пробел, а «ничего не выбрано»: работают
  // дефолты обвеса, вопросов у двери не бывает (`tasker:BASER2-18`).
  const state = trace.span(
    'door.settings',
    () => readSourceConfig(repo, declaration, log),
    { source },
  );
  draft.config = {
    path: state.path,
    existed: state.existed,
    // Рождение — ровно один раз, когда файла нет. Существующий не трогается
    // никогда, поэтому «creates» и «existed» здесь взаимоисключающи по
    // построению, а не по дисциплине вызывающего.
    creates: !state.existed,
  };
  if (state.config === null) {
    return null;
  }

  // Загрузка модулей резолверов асинхронна, а спаны трейса — синхронны, и это
  // не недосмотр: резолвер обязан быть синхронной чистой функцией, асинхронна
  // только доставка его модуля. Она отмечается счётчиком, а не длительностью —
  // мерить нечего, а врать нулевым спаном хуже, чем не мерить.
  const defaults = await loadDefaults(declaration, pkg, repo);
  trace.event('door.resolvers', {
    source,
    settings: Object.keys(declaration.settings).length,
  });

  const values = trace.span(
    'door.values',
    () => resolveValues(declaration, state.config as SourceConfig, defaults),
    { source },
  );
  if (!values.ok) {
    log.addAll(values.problems);
    return null;
  }
  draft.settings = values.value.movements;

  // Содержимое. Форма проверяется ДО подстановки, движок значений не видит.
  const rendered = trace.span(
    'door.render',
    () => renderLayout(declaration, pkg, values.value.values),
    { source, templates: declaration.layout.length },
  );
  if (rendered.problems.length > 0) {
    log.addAll(rendered.problems);
    return null;
  }

  // Текст новорождённого файла считается ЗДЕСЬ, потому что здесь есть движение
  // значений: дефолты в нём — те же, что дверь назвала в ответе, а не вторая их
  // копия, посчитанная отдельно и способная разойтись.
  const born = draft.config.creates
    ? trace.span(
        'door.born',
        () => renderSourceConfig(declaration, values.value.movements),
        { source, path: draft.config.path },
      )
    : null;

  return { ...item, rendered, values: values.value.values, born, draft };
}

/**
 * Дописывает движению прежний конец — тот, с которым артефакт УЖЕ разложен.
 *
 * Считается по шагам плана, а не по диску: движок уже сказал, какие артефакты
 * НАШИ и разошлись (`diverged`), и отдал их прежнее содержимое. Читать файлы
 * самостоятельно значило бы завести вторую правду о том, что лежит, и утверждать
 * прежнее значение для файла, который дверью не владеется.
 *
 * Один артефакт доказывает значение целиком: если два артефакта одного обвеса
 * доказали РАЗНОЕ прежнее значение одной настройки, названо не будет ни одно —
 * такого не бывает при честной раскладке, а выбирать из двух правд наугад хуже,
 * чем промолчать.
 */
function withPlacedValues(
  movements: readonly SettingMovement[],
  plan: MaterializationPlan,
  item: Prepared,
): readonly SettingMovement[] {
  const placed = new Map<string, PlacedValue>();
  const conflicting = new Set<string>();

  for (const step of plan.steps) {
    if (
      step.reason !== 'diverged' ||
      step.previous === null ||
      step.src === undefined
    ) {
      continue;
    }
    const src = toRepoPath(step.src);
    if (!src.ok) {
      continue;
    }

    const found = recoverPlacedValues({
      values: item.values,
      placed: step.previous,
      dest: step.dest,
      rerender: (values) => item.rendered.rerender(src.path, values),
    });

    for (const [key, value] of found) {
      const seen = placed.get(key);
      if (seen !== undefined && seen.value !== value.value) {
        conflicting.add(key);
        continue;
      }
      placed.set(key, value);
    }
  }

  if (placed.size === 0) {
    return movements;
  }

  return movements.map((movement) => {
    const was = conflicting.has(movement.key)
      ? undefined
      : placed.get(movement.key);
    return was === undefined ? movement : { ...movement, placed: was };
  });
}

/**
 * Подтверждения, адресованные ИМЕННО этому обвесу.
 *
 * Подтверждение поимённо — правило движка, а он видит одну декларацию за прогон
 * и про соседние `dest` знает только «в моей раскладке такого нет». Отдать ему
 * весь список значило бы получить это извещение на артефакт, который сосед
 * кладёт совершенно законно, — верное по одному плану и неверное по набору.
 *
 * Путь, которого не кладёт НИКТО, при этом отдаётся всем: опечатка в `--confirm`
 * обязана быть названа, и называет её движок своим `confirmation-unused`, а не
 * дверь вторым языком поверх (`tasker:BASER2-24`).
 */
function confirmFor(
  sourceId: string,
  owners: ArtifactOwners,
  confirm: readonly string[],
): readonly string[] {
  return confirm.filter((dest) => {
    const owner = owners[dest];
    return owner === undefined || owner.sourceId === sourceId;
  });
}

/** Породит ли этот прогон работу: шаги движка считаются по каждому обвесу. */
function hasWork(draft: DraftRun): boolean {
  return draft.plan !== null && draft.plan.steps.length > 0;
}

/** Черновики — наружу неизменяемыми: ответ двери данные, а не рабочее место. */
function freeze(drafts: readonly DraftRun[]): readonly SourceRun[] {
  return drafts.map((draft) => ({
    source: draft.source,
    config: draft.config,
    settings: draft.settings,
    plan: draft.plan,
    applied: draft.applied,
  }));
}

/**
 * Вход движку — ВСЁ, что обвес сказал о себе, а не только пути.
 *
 * `contentRoot` подаётся ПРАВДОЙ, а не правдоподобием. Внутри дерева это
 * настоящий путь, и защита движка «не писать в собственный источник» работает в
 * полную силу. Вне дерева репо-относительного пути не существует, и дверь
 * говорит именно это: подделанный путь выглядел бы как защита, а защищал бы
 * пустоту (`installed.ts`, `README.md` § «Шов contentRoot»).
 *
 * ## Класс и версия — здесь стык, на котором терялось слово
 *
 * Движок класс ИСПОЛНЯЕТ (`tasker:BASER2-51`), паспорт укладки версию ХРАНИТ
 * (`tasker:BASER2-52`), форма то и другое разбирает — но обе работы не доезжали
 * до человека, пока эта функция собирала раскладку как `{src, dest}`:
 * объявленный обвесом `placed-once` приезжал к движку как `regenerated` и файл,
 * в котором человек месяц работал, перекладывался при первом же обновлении
 * шаблона (`tasker:BASER2-68`).
 *
 * Дверь здесь ничего не решает и ничего не выводит: класс приходит из формы уже
 * приведённым к явному значению, версия — из манифеста пакета. Дверь ПЕРЕНОСИТ,
 * и в этом вся её работа на этом шве.
 */
function engineInput(
  declaration: SourceDeclaration,
  location: SourceLocation,
  pkg: InstalledPackage,
): Declaration {
  return {
    source: {
      id: declaration.source.id,
      // `null` — «источника в этом дереве нет». Форма честная, а не заглушка:
      // подделать репо-относительный путь значило бы получить защиту, которая
      // защищает пустоту, а настоящий источник оставить незакрытым. Движок
      // называет этот случай сам (`SourceOutsideTreeError`).
      contentRoot: location.kind === 'in-tree' ? location.path : null,
      // Версия — из манифеста пакета, второго места для неё нет (`kb:BASER2-2`).
      // `null` едет как `null`: обвес версии не назвал, и паспорт скажет именно
      // это, а не сочинённое за него число.
      version: pkg.version,
    },
    layout: declaration.layout.map((item) => ({
      src: item.src,
      dest: item.dest,
      // Слово обвеса переносится КАК ЕСТЬ. Умолчание уже проставлено разбором
      // формы, и повторять его здесь значило бы завести второе умолчание,
      // способное разойтись с первым.
      class: item.class,
    })),
  };
}

/**
 * Отказ движка — его же кодом и его же текстом.
 *
 * Дверь больше НЕ угадывает причину по типу исключения плюс собственному знанию
 * о раскладке: у отказов движка есть машинный код (`EngineProblemCode`), и он
 * пробрасывается как есть. Своё дверь дописывает ровно там, где знает то, чего
 * не знает движок, — путь установки обвеса. Так на одно событие остаётся один
 * текст, а не два (`tasker:BASER2-24`).
 */
function engineRefusal(
  cause: unknown,
  source: SourceReport,
): [code: ProblemCode, at: string, message: string] {
  if (!(cause instanceof BaserMaterializeError)) {
    // Не отказ движка, а срыв: машинного кода у него нет, и выдумывать его
    // нечем — назвать можно только то, что это сорвалось, а не отказало.
    return ['door-failed', source.id, `движок сорвался: ${describe(cause)}`];
  }

  if (cause.code === 'source-outside-tree') {
    const where =
      source.location.kind === 'outside-tree'
        ? source.location.absolute
        : source.packageRoot;
    return [
      cause.code,
      `${source.packageName}/${source.contentRoot}`,
      `${cause.message} (обвес установлен в "${where}")`,
    ];
  }

  // Адрес — это КУДА ИДТИ ЧИНИТЬ, а не «чей отказ». У битой служебной записи
  // это сам файл: приписать ему обвес значило бы отправить человека править
  // объявление, с которым всё в порядке.
  if (cause.code === 'manifest-unreadable') {
    return [cause.code, MANIFEST_PATH, cause.message];
  }

  return [cause.code, source.id, cause.message];
}

/**
 * ПОЧЕМУ файлы оказались чужими — назвать это может только дверь.
 *
 * Движок прав, отказываясь трогать файл, о котором у него нет записи. Но для
 * него «записи нет» — одно состояние, а на деле их ДВА, и чинятся они
 * по-разному:
 *
 * | что видно                       | что это                                  |
 * | ------------------------------- | ---------------------------------------- |
 * | конфиг есть, записи нет         | мы тут раскладывали, запись пропала      |
 * | нет ни конфига, ни записи       | первая установка в непустой репозиторий  |
 *
 * Различает их **конфиг потребителя** — сигнал, которого у движка нет и быть не
 * должно. Одно сообщение на оба состояния уже соврало на живом репозитории
 * (`tasker:BASER2-28`): человека с его собственным `.devcontainer` послали
 * восстанавливать из истории запись, которой там никогда не было. Уверенный
 * указатель не туда хуже отсутствующего — он тратит чужое время.
 *
 * Условие узкое намеренно: записи нет И при этом есть отказы «файл уже
 * существует». В пустом репозитории таких отказов нет — и сообщения тоже, иначе
 * оно кричало бы каждому новому потребителю и через неделю перестало читаться.
 *
 * Считается по ВСЕМ обвесам сразу и говорится ОДИН раз: причина у пачки общая —
 * записи нет на весь репозиторий, — и повторить её на каждый обвес значило бы
 * сказать одно и то же столько раз, сколько инструментов поставлено.
 *
 * Существование записи берётся СНИМКОМ до прогонов, а не с дерева: соседний
 * обвес, легший раньше, уже положил бы её в дерево, и признак начал бы
 * молчать ровно там, где он и нужен.
 */
function diagnoseForeignDests(
  hadManifest: boolean,
  drafts: readonly DraftRun[],
  config: ConfigReport,
): DoorProblem | null {
  if (hadManifest) {
    return null;
  }

  const foreign = drafts.flatMap((draft) =>
    (draft.plan?.conflicts ?? []).filter(
      (conflict) => conflict.kind === 'foreign-dest',
    ),
  );
  if (foreign.length === 0) {
    return null;
  }

  // Конфиг лежал на диске ДО прогона: собственный, который дверь родила бы
  // этим же прогоном, здесь не считается — иначе признак был бы всегда верен.
  //
  // Признак не абсолютен, и это названо В САМОМ СООБЩЕНИИ, а не спрятано:
  // конфиг можно написать и руками, не запуская дверь. Различить это дверь
  // нечем — прежнего состояния она не хранит, — поэтому вместо второй догадки
  // человеку даётся дешёвая проверка («посмотри в историю») и верное действие
  // на КАЖДЫЙ из двух исходов. Когда различить нельзя, честнее отдать критерий,
  // чем угадать за человека.
  return config.existed
    ? {
        code: 'manifest-missing',
        at: MANIFEST_PATH,
        message:
          `конфиг "${config.path}" есть, а служебной записи "${MANIFEST_PATH}" нет. ` +
          'Обычно это значит, что раскладка здесь уже была, а запись пропала — её не ' +
          'закоммитили либо снесли; она обязана коммититься. Без неё владение ' +
          `артефактами недоказуемо, и они считаются чужими (${foreign.length}) — отсюда ` +
          'отказы выше. Восстанови запись из истории: это вернёт владение и ничего не ' +
          'перезапишет. А если в истории её нет — значит baser здесь ещё не раскладывал ' +
          '(конфиг написали руками), и файлы на этих местах не наши: подтверди их ' +
          'поимённо (--confirm), твоя версия будет заменена целиком, и запись родится ' +
          'заново',
      }
    : {
        code: 'first-install',
        // Адрес — место, где человек выражает решение. Файла ещё нет: план
        // заблокирован, и конфиг этим прогоном не родится. Он появится ровно
        // тогда, когда решение будет принято.
        at: config.path,
        message:
          `первая установка в непустой репозиторий: ни конфига "${config.path}", ни ` +
          `служебной записи "${MANIFEST_PATH}" здесь нет — значит baser в этом ` +
          `репозитории ничего не раскладывал. Файлы, на которые целится обвес ` +
          `(${foreign.length}), лежали до нас, и мы их НЕ ТРОНУЛИ: отказы выше — это ` +
          'отказ заменить чужое, а не поломка. Дальше решаешь ты. Пусть файл ведёт ' +
          'обвес — подтверди его поимённо (--confirm <путь>): твоя версия будет ' +
          'заменена целиком и дальше начнёт перегенерироваться из шаблона при каждом ' +
          'обновлении, правки руками в ней не переживут. Оставляешь свой — сними ' +
          'обвес, и baser сюда больше не поцелится',
      };
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
function changesOf(tree: RepoTree): WriteReport[] {
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
    runs: [],
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
  drafts: readonly DraftRun[] = [],
): DoorResult {
  return {
    ...shell(session),
    status: 'refused',
    runs: freeze(drafts),
    problems,
  };
}

/**
 * Файл настроек до того, как дверь до него дошла.
 *
 * Путь известен всегда — он считается из личности обвеса, а не берётся из
 * ссылки. Поэтому отказ на подготовке всё равно называет человеку файл, в
 * который идти, вместо пустого места в ответе.
 */
function blankSourceConfig(sourceId: string): SourceConfigReport {
  return { path: sourceConfigPath(sourceId), existed: false, creates: false };
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
