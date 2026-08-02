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
  type LayoutEntry,
  type SettingValue,
  type SourceConfig,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';
import {
  locatePackage,
  type LocatedPackage,
} from '@omnifield/baser-contracts/locate';
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
import { locateContentRoot, type SourceLocation } from './installed.js';
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
import {
  declaresTuning,
  readSourceConfig,
  renderSourceConfig,
} from './settings.js';
import { recoverPlacedValues, type PlacedValue } from './previous.js';
import { derivedMoves, type DerivedMove } from './derived.js';
import { differenceOf, type ArtifactDifference } from './difference.js';
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
   * Перечень `dest`, для которых ВЗЯТИЕ ВО ВЛАДЕНИЕ чужого файла подтверждено.
   *
   * Владение, а не перезапись: что станет с содержимым, решает класс артефакта —
   * `regenerated` заменяется сборкой обвеса целиком, `placed-once` только
   * записывается в паспорт укладки и остаётся байт в байт прежним
   * (`tasker:BASER2-123`).
   *
   * Поимённо, а не флагом: согласие не масштабируется само, и это правило
   * движка, а не двери (`PlanOptions.confirm`). Что подтверждать — план
   * называет сам, конфликтами с `detail.resolution === 'confirm'`.
   */
  readonly confirm?: readonly string[];
  /**
   * ПОСТРОЧНОЕ РАСХОЖДЕНИЕ С ЧУЖИМ ФАЙЛОМ — целиком, без усечения.
   *
   * По умолчанию расхождение считается всегда, а в ответ уезжает первыми
   * `SHOWN_LINES` строками на сторону: дифф бывает длинным, и вываливать чужой
   * файл целиком в лицо каждому, кто ставит обвес в живой репозиторий, значило
   * бы сделать его нечитаемым (`tasker:BASER2-112`). Сколько строк ВСЕГО,
   * говорят счётчики — усечение названо, а не молчаливо.
   *
   * Флаг снимает предел и для текста, и для машинного ответа сразу: усечение —
   * свойство ОТВЕТА, а не рендера. Второй правды о том, сколько строк
   * разошлось, у двери быть не должно.
   */
  readonly difference?: boolean;
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
  /**
   * Предел показа расхождения снят — прогон шёл с `--difference`.
   *
   * Держится в сессии, а не только в опциях фазы, потому что уезжает В ОТВЕТ:
   * отказать прогон может на любом шаге, а вопрос, который ему задали, ответ
   * обязан нести на любом исходе (`result.ts`, `DoorResult.difference`).
   */
  readonly difference: boolean;
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
  derived: readonly DerivedMove[];
  differences: readonly ArtifactDifference[];
  plan: MaterializationPlan | null;
  applied: ApplyReport | null;
}

/**
 * Сколько строк расхождения уезжает в ответ без `--difference`.
 *
 * Не «сколько поместится на экран»: число выбрано так, чтобы форма потери была
 * видна (чего лишаешься — обычно понятно по первым же строкам), а сам файл в
 * лицо не вываливался. Остаток при этом НАЗВАН счётчиком, и способ увидеть его
 * целиком назван тут же в тексте.
 */
const SHOWN_LINES = 12;

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
  readonly pkg: LocatedPackage;
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
    difference: options.difference === true,
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
      derived: [],
      differences: [],
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

    // ЦЕНА ДВИЖЕНИЯ — тем же порядком и по той же причине: последствие обязано
    // быть названо раньше, чем что-то поедет. Считается от плана, а не от
    // диска: оба конца содержимого несёт он сам (`tasker:BASER2-98`).
    draft.derived = trace.span(
      'door.derived',
      () => withDerivedMoves(draft.settings, plan),
      { source: draft.source.id },
    );

    // Чужой файл на пути обвеса — что из него не воспроизведётся
    // (`tasker:BASER2-112`). Тут дверь читает дерево сама: у спорного пути шага
    // нет вовсе, отказ на нём — конфликт, и второго конца в плане не лежит.
    draft.differences = trace.span(
      'door.difference',
      // Снятый предел берётся ИЗ СЕССИИ, а не из опций второй раз: он же уезжает
      // в ответ полем `difference`, и две дороги к одному факту разошлись бы
      // молча — гейт читал бы «усечения не было» над усечённым списком.
      () => foreignDifferences(plan, item, tree, session.difference),
      { source: draft.source.id },
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
    const why = diagnoseForeignDests(
      hadManifest,
      drafts,
      session.config,
      declared,
    );
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
  readonly pkg: LocatedPackage;
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
    const installed = locatePackage(entry.use, repo.root);
    if (!installed.ok) {
      // Код и слова — резолва, адрес — двери. Пересказать чужой отказ своими
      // словами значило бы завести второе описание одного события; а вот адрес
      // у двери свой и он точнее: отказ несёт ИНДЕКС записи конфига, иначе при
      // двух одинаковых кодах непонятно, какую из них чинить
      // (`tasker:BASER2-55`). Файл, который правят, назван в самом тексте.
      log.addAll(installed.problems.map((problem) => ({ ...problem, at })));
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
  const tunable = declaresTuning(declaration);
  draft.config = {
    path: state.path,
    existed: state.existed,
    tunable,
    // Рождение — ровно один раз, когда файла нет И обвесу есть что в него
    // положить. Существующий не трогается никогда, поэтому «creates» и «existed»
    // здесь взаимоисключающи по построению, а не по дисциплине вызывающего.
    //
    // Второй множитель — заход `tasker:BASER2-124`: пустой файл не документирует
    // ничего, кроме собственной пустоты. Обвес объявит настройку следующим
    // выпуском — файл родится тогда же, и это ровно тот момент, когда он нужен.
    creates: !state.existed && tunable,
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
 * ЧТО ПЕРЕЕДЕТ ВМЕСТЕ С НАЗВАННЫМ ЗНАЧЕНИЕМ — посчитанное от него.
 *
 * План говорит `imageUser "node" → "vscode"` и молчит о том, что от этой
 * настройки СЧИТАЕТСЯ адрес тома: `omnifield-secrets` и `omnifield-pnpm-store`
 * уезжают с `/home/node/…` на `/home/vscode/…`, а в томах лежит положенное
 * руками (`tasker:BASER2-98`). Значение человек выбрал сам — производное от него
 * он не выбирал и обязан прочитать вслух.
 *
 * Материал — те же два конца, что и у прежнего значения: лежащее содержимое
 * (`step.previous`) и то, которое ляжет (`step.content`). Ни про тома, ни про
 * формат дверь при этом не знает: она называет слово, которое исчезнет, и слово,
 * которое встанет на его место, и каждое утверждение доказано подстановкой
 * (`derived.ts`).
 *
 * Ищется только по НАЗВАННЫМ движениям: прежний конец, которого дверь доказать
 * не смогла, здесь не всплывает вторым путём — молчание `previous.ts` остаётся
 * молчанием.
 */
function withDerivedMoves(
  movements: readonly SettingMovement[],
  plan: MaterializationPlan,
): readonly DerivedMove[] {
  const moved = movements.flatMap((movement) =>
    movement.placed !== undefined &&
    typeof movement.value === 'string' &&
    typeof movement.placed.value === 'string'
      ? [
          {
            key: movement.key,
            from: movement.placed.value,
            to: movement.value,
          },
        ]
      : [],
  );
  if (moved.length === 0) {
    return [];
  }

  return plan.steps.flatMap((step) =>
    step.reason === 'diverged' &&
    step.previous !== null &&
    step.content !== null
      ? derivedMoves({
          dest: step.dest,
          placed: step.previous,
          comes: step.content,
          moved,
        })
      : [],
  );
}

/**
 * ЧТО ИЗ ЧУЖОГО ФАЙЛА НЕ ВОСПРОИЗВЕДЁТСЯ — построчно (`tasker:BASER2-112`).
 *
 * Чужой файл приходит к двери двумя дорогами, и обе ведут к одной потере:
 *
 * | что видно                          | где лежит второй конец                 |
 * | ---------------------------------- | -------------------------------------- |
 * | отказ `foreign-dest` (не подтверждено) | шага нет: содержимое читается из дерева |
 * | `adopted` с подтверждением         | оба конца несёт сам шаг                |
 *
 * **`placed-once` сюда не попадает вовсе**, и это не оптимизация: подтверждение
 * такого артефакта содержимое НЕ ТРОГАЕТ (`tasker:BASER2-123`), терять человеку
 * нечего, и показать ему «вот чего ты лишишься» значило бы пугать ценой,
 * которой нет. Класс берётся из объявления того обвеса, который в этот путь
 * целится, — из того же места, откуда его берёт движок.
 *
 * Читать дерево для первой дороги дверь вправе: это ровно тот файл, про который
 * человек прямо сейчас принимает решение, и второй правды о нём тут не заводится
 * — она у нас единственная (движок его содержимого не отдаёт, потому что шага по
 * нему нет).
 */
function foreignDifferences(
  plan: MaterializationPlan,
  item: Prepared,
  tree: RepoTree,
  whole: boolean,
): readonly ArtifactDifference[] {
  const limit = whole ? null : SHOWN_LINES;
  const found: ArtifactDifference[] = [];

  // Подтверждённое взятие во владение: оба конца уже в шаге. `placed-once`
  // здесь отсеивается сам собой — у него шаг `record` без содержимого.
  for (const step of plan.steps) {
    if (
      step.reason !== 'adopted' ||
      step.content === null ||
      step.previous === null
    ) {
      continue;
    }
    found.push(
      differenceOf({
        dest: step.dest,
        placed: step.previous,
        comes: step.content,
        limit,
      }),
    );
  }

  for (const conflict of plan.conflicts) {
    if (conflict.kind !== 'foreign-dest') {
      continue;
    }
    const entry = item.declaration.layout.find(
      (layout) => layout.dest === conflict.dest,
    );
    if (entry === undefined || entry.class === 'placed-once') {
      continue;
    }
    const src = toRepoPath(entry.src);
    const comes = src.ok ? item.rendered.bySrc.get(src.path) : undefined;
    const placed = tree.read(conflict.dest, 'utf-8');
    if (comes === undefined || typeof placed !== 'string') {
      continue;
    }
    found.push(differenceOf({ dest: conflict.dest, placed, comes, limit }));
  }

  return found;
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
    derived: draft.derived,
    differences: draft.differences,
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
  pkg: LocatedPackage,
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
 * него это ОДНО состояние, а на деле их ТРИ, и чинятся они по-разному:
 *
 * | что видно                       | что это                                  |
 * | ------------------------------- | ---------------------------------------- |
 * | конфиг есть, записи нет         | мы тут раскладывали, запись пропала      |
 * | нет ни конфига, ни записи       | первая установка в непустой репозиторий  |
 * | запись есть, а путей в ней нет  | по этим путям ещё не раскладывали        |
 *
 * Первые два различает **конфиг потребителя**, третье — **сама запись**; обоих
 * сигналов у движка нет и быть не должно. Одно сообщение на разные состояния
 * уже соврало на живом репозитории
 * (`tasker:BASER2-28`): человека с его собственным `.devcontainer` послали
 * восстанавливать из истории запись, которой там никогда не было. Уверенный
 * указатель не туда хуже отсутствующего — он тратит чужое время.
 *
 * Условие узкое намеренно: есть отказы «файл уже существует». В пустом
 * репозитории таких отказов нет — и сообщения тоже, иначе оно кричало бы каждому
 * новому потребителю и через неделю перестало читаться.
 *
 * Считается по ВСЕМ обвесам сразу и говорится ОДИН раз: причина у пачки общая, и
 * повторить её на каждый обвес значило бы сказать одно и то же столько раз,
 * сколько инструментов поставлено. Кто именно целится в спорные пути, третий
 * отказ при этом НАЗЫВАЕТ: «сними обвес» без имени в репозитории с двумя
 * инструментами отправляет снимать наугад.
 *
 * ## Третье состояние — заход `tasker:BASER2-134`
 *
 * Первые два кода привязаны к РЕПОЗИТОРИЮ, и оба молчали там, где живой случай
 * их и ждал: у weber запись есть и верна, baser раскладывает давно, а ВТОРОЙ
 * обвес целится в файлы, заполненные руками. Отказы движка были, отказа двери не
 * было ни одного — и класс спорных артефактов человек вытащил дедукцией по
 * счётчику в трейсе, хотя справка обещала, что его назовёт отказ.
 *
 * Перенастроить на этот случай `first-install` было нельзя: он выпущен со
 * смыслом «репозиторий девственный», и сменить смысл выпущенного слова значило
 * бы обмануть его читателя молча. Новое слово в перечислении — прибавление.
 *
 * Существование записи берётся СНИМКОМ до прогонов, а не с дерева: соседний
 * обвес, легший раньше, уже положил бы её в дерево, и признак начал бы
 * молчать ровно там, где он и нужен.
 *
 * ## Отказ первой установки говорит и то, чего дверь НЕ делает (`BASER2-106`)
 *
 * Первый чужой потребитель (`tasker:BASER2-103`) прочитал наши тексты так, что
 * станок подхватит значения из его файла, и посчитал цену: применённый вслепую
 * обвес дал бы девбокс без обоих томов — по дефолту они `null`. Спасла его не
 * формулировка, а сам отказ трогать чужой файл: «сработала подстраховка, а не
 * объяснение».
 *
 * Это хуже, чем выглядит: подстраховка снимается одним `--confirm`. Человек,
 * поверивший, что его значения подхватят, снимает единственное, что его
 * защищало, — ровно в тот момент, когда теряет их. Значит сказать про сборку от
 * дефолтов обязан САМ ОТКАЗ, и сказать РАНЬШЕ, чем назовёт `--confirm`.
 *
 * Второй конец того же — граница регулировки. Не назвав её, текст оставляет
 * читателя достраивать, что нерегулируемого не бывает: тот же потребитель завёл
 * на этом ложный риск «после apply теряем дверь к сервисам» и потратил заход с
 * экспериментом. Дверь называет ПРАВИЛО («регулируется только названное
 * настройкой»), а не список — что именно в универсальном слое, знает обвес, и
 * перечислять это здесь значило бы держать вторую копию его раскладки.
 *
 * ## Цена подтверждения зависит от КЛАССА, и одной ценой её называть нельзя
 *
 * Правка `tasker:BASER2-123` по находке первого чужого обвеса. Текст обещал
 * перезапись на оба класса сразу, а `placed-once` подтверждение НЕ ПЕРЕЗАПИСЫВАЕТ
 * — оно регистрирует артефакт в паспорте укладки, не трогая содержимое.
 *
 * Цена ошибки асимметрична и уже заплачена: заявитель по этому тексту готовился
 * потерять заполненный руками `harness.yaml` — снял контрольную сумму, держал
 * наготове откат через git. Станок сделал `record (adopted)`, файл цел. Второй
 * исход того же текста хуже: человек не решается подтвердить и застревает на
 * конфликте навсегда.
 *
 * Класс берётся из ОБЪЯВЛЕНИЯ того обвеса, который в этот путь целится, — из
 * того же места, откуда его берёт движок. Держать своё соответствие «путь →
 * класс» дверь не может: это была бы вторая копия чужой раскладки, и разошлась
 * бы она молча.
 */
function diagnoseForeignDests(
  hadManifest: boolean,
  drafts: readonly DraftRun[],
  config: ConfigReport,
  declared: readonly DeclaredSource[],
): DoorProblem | null {
  const foreign = drafts.flatMap((draft) =>
    (draft.plan?.conflicts ?? []).filter(
      (conflict) => conflict.kind === 'foreign-dest',
    ),
  );
  if (foreign.length === 0) {
    return null;
  }

  // Записи раскладки, ставшие спорными, — по тем же путям, что назвали отказы.
  // Пересечение, а не поиск класса по каждому отказу: так обе стороны считаются
  // из одного материала, и «класса для этого пути не нашлось» не бывает по
  // построению, а не по вере в вызывающего.
  const dests = new Set(foreign.map((conflict) => conflict.dest));
  const claimed = declared.flatMap((item) =>
    item.declaration.layout.filter((entry) => dests.has(entry.dest)),
  );
  const once = claimed.filter((entry) => entry.class === 'placed-once');
  const regenerated = claimed.filter((entry) => entry.class !== 'placed-once');
  const price = priceOfConfirmation(regenerated, once);

  // Кто в эти пути целится. Спрашивается у объявлений — тех же, откуда взят
  // класс: в репозитории с несколькими инструментами «сними обвес» без имени
  // отправляет снимать наугад, а обвесов там может быть сколько угодно.
  const claimers = declared
    .filter((item) =>
      item.declaration.layout.some((entry) => dests.has(entry.dest)),
    )
    .map((item) => `"${item.declaration.source.id}"`);

  // Указатель на блок расхождения ставится только там, где блок есть: у
  // `placed-once` содержимое не трогают вовсе, расхождения не считалось, и
  // ссылка вела бы в пустое место (`tasker:BASER2-112`).
  const named =
    regenerated.length === 0
      ? ''
      : '. Что именно из лежащих файлов не воспроизведётся, названо построчно ' +
        'блоком "чужое не воспроизведётся" выше';

  // ── ТРЕТЬЕ СОСТОЯНИЕ: запись есть и верна, а этих путей в ней нет.
  //
  // Оба соседних кода привязаны к РЕПОЗИТОРИЮ, и здесь оба неверны: запись на
  // месте, восстанавливать нечего, а `first-install` утверждал бы, что baser тут
  // никогда не был. Состояние же про ПУТИ — по ним не раскладывали, и файлы на
  // них не наши (`tasker:BASER2-134`, живой случай второго обвеса).
  if (hadManifest) {
    return {
      code: 'unrecorded-dest',
      // Адрес — место, где человек выражает решение: подтверждает он флагом, а
      // отказывается правкой перечня. Служебную запись здесь чинить не нужно, и
      // указать на неё значило бы отправить человека в файл, с которым всё в
      // порядке.
      at: config.path,
      message:
        `служебная запись "${MANIFEST_PATH}" на месте, и владение по ней доказано — ` +
        `восстанавливать нечего. Но спорные пути (${foreign.length}) в ней НЕ ЧИСЛЯТСЯ: ` +
        'по ним baser здесь ещё не раскладывал — их ' +
        `${claimers.length > 1 ? 'объявили обвесы' : 'объявил обвес'} ${claimers.join(' · ')}. ` +
        'Файлы на этих местах лежали ДО, и мы их НЕ ТРОНУЛИ: отказы выше — это ' +
        'отказ заменить чужое, а не поломка. ' +
        whatIsNotRead(regenerated, once) +
        'Дальше решаешь ты. Пусть файл ведёт ' +
        `обвес — подтверди его поимённо (--confirm <путь>): ${price}. ` +
        `Оставляешь своё — сними обвес из "${config.path}", и baser в эти пути ` +
        'больше не поцелится',
    };
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
          `поимённо (--confirm) — ${price}, и запись родится заново${named}`,
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
          'отказ заменить чужое, а не поломка. ' +
          whatIsNotRead(regenerated, once) +
          'Дальше решаешь ты. Пусть файл ведёт ' +
          `обвес — подтверди его поимённо (--confirm <путь>): ${price}. ` +
          'Оставляешь свой — сними обвес, и baser сюда больше не поцелится',
      };
}

/**
 * ЧЕГО ДВЕРЬ НЕ ДЕЛАЛА: твой файл она НЕ ЧИТАЛА (`tasker:BASER2-106`).
 *
 * Абзац общий на все отказы, которые ведут к `--confirm`, и общий он не ради
 * краткости: подстраховка снимается одним флагом, и человек, поверивший, что
 * его значения подхватят, снимает единственное, что его защищало, — ровно в тот
 * момент, когда их теряет. Починить один вход в потерю и оставить открытым
 * соседний это не починка, а две копии одного абзаца разъехались бы молча —
 * первая же правка досталась бы одному входу из трёх.
 *
 * Откуда берётся содержимое — вопрос только к ПЕРЕГЕНЕРИРУЕМЫМ: у `placed-once`
 * дверь не собирает ничего, и говорить про сборку от дефолтов там значило бы
 * пугать ценой, которой нет.
 */
function whatIsNotRead(
  regenerated: readonly LayoutEntry[],
  once: readonly LayoutEntry[],
): string {
  if (regenerated.length === 0) {
    return (
      'И НЕ ПРОЧИТАЛИ — читать было не для чего: всё, во что целится ' +
      'обвес, объявлено положенным однажды, и содержимое для таких ' +
      'артефактов он не собирает вовсе. '
    );
  }

  return (
    `И НЕ ПРОЧИТАЛИ: то, что ляжет${once.length === 0 ? '' : ' на месте перегенерируемых'}, ` +
    'собирается от дефолтов обвеса и его файла настроек, а из твоего файла в ' +
    'сборку не попадает НИЧЕГО — даже совпадающее по смыслу. Регулируется ' +
    'только названное настройкой, всё остальное приезжает из шаблона как ' +
    'есть. Что настраивается, этот прогон уже назвал блоком значений — сверь ' +
    'с ним своё ДО подтверждения: чего там нет, то не переедет. А ЧТО ИМЕННО ' +
    'из твоего файла не воспроизведётся, названо построчно блоком "чужое не ' +
    'воспроизведётся" выше — сверять глазами больше не надо. '
  );
}

/**
 * ЧТО СДЕЛАЕТ ПОДТВЕРЖДЕНИЕ — врозь по классам (`tasker:BASER2-123`).
 *
 * Подтверждение отдаёт ВЛАДЕНИЕ, а не содержимое: владение чужим файлом не
 * становится нашим оттого, что обвес объявил файл человеческим, — поэтому отказ
 * одинаков на оба класса. А вот дальше классы расходятся, и расходятся ровно в
 * том, чего человек боится: `regenerated` заменяется сборкой обвеса целиком,
 * `placed-once` берётся во владение НЕ ТРОГАЯ содержимое.
 *
 * Смешанный набор называется поимённо, а не средним по больнице: подтверждают
 * тоже поимённо, и «часть заменится, часть нет» без списка оставляет человека
 * гадать, какая именно часть — то есть ровно в том же положении, из которого он
 * пришёл. Порядок внутри списка — тот, в котором записи объявлены обвесом.
 */
function priceOfConfirmation(
  regenerated: readonly LayoutEntry[],
  once: readonly LayoutEntry[],
): string {
  const replaced =
    'твоя версия будет заменена целиком СБОРКОЙ ОТ ДЕФОЛТОВ обвеса и его файла ' +
    'настроек, из твоего файла не переедет ничего, и дальше она начнёт ' +
    'перегенерироваться из шаблона при каждом обновлении — правки руками в ней ' +
    'не переживут';
  const adopted =
    'СОДЕРЖИМОЕ НЕ ИЗМЕНИТСЯ: обвес объявил такой артефакт положенным однажды ' +
    '(placed-once), и подтверждение только запишет его в паспорт укладки — ни ' +
    'этот прогон, ни следующие в него не пишут';

  if (once.length === 0) {
    return replaced;
  }
  if (regenerated.length === 0) {
    return adopted;
  }
  return (
    `классы у них разные, и подтверждение сделает разное. Перегенерируемые ` +
    `(${dests(regenerated)}) — ${replaced}. Положенные однажды ` +
    `(${dests(once)}) — ${adopted}`
  );
}

function dests(entries: readonly LayoutEntry[]): string {
  return entries.map((entry) => entry.dest).join(' · ');
}

function describeSource(
  declaration: SourceDeclaration,
  pkg: LocatedPackage,
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
    difference: session.difference,
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
  return {
    path: sourceConfigPath(sourceId),
    existed: false,
    // Заготовка до чтения объявления: про регулировки ещё НЕ СПРАШИВАЛИ, и
    // `null` говорит именно это. Поставить сюда `false` значило бы утверждать
    // «регулировать нечего», не заглянув в объявление, — а прогон, отказавший
    // раньше разбора, доезжает до ответа с этой заготовкой как есть.
    tunable: null,
    creates: false,
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
