/**
 * ФАЗА 1 — ПЛАН.
 *
 * План — это ДАННЫЕ, а не побочка: он вычисляется и читается ДО применения
 * (`kb:BASER-5` «две фазы»; рынок подтвердил разрыв дважды независимо —
 * `nx migrate` разносит его на две команды, схематики — на две фазы).
 *
 * План машинночитаем в первую очередь (`kb:BASER-5`, «Вывод машинночитаем в
 * первую очередь»): вид шага, причина шага, вид конфликта и вид извещения —
 * стабильные МАШИННЫЕ КОДЫ, подробности причины лежат данными в `detail`, а
 * `message` — рендер для человека. Ветвиться по тексту сообщения нельзя ни
 * гейту, ни панели; `describePlan` — один из выходов, а не единственный.
 *
 * Инварианты, за которые отвечает именно эта фаза:
 *   §1 идемпотентность — сошедшийся артефакт НЕ порождает шага, поэтому второй
 *      прогон даёт план без шагов (операционное определение сходимости из IaC);
 *   §3 отсутствие сирот — артефакт с нашим маркером, потерявший запись в
 *      `frame`, попадает в план на снятие;
 *   §4 отказ вместо тихой перезаписи — конфликт владения попадает в
 *      `conflicts`, а не в `steps`, и делает план неприменимым;
 *   §5 показать расхождение — каждый шаг несёт `previous`, чтобы раннер мог
 *      показать разницу и архитектор мог принять решение `align`.
 *
 * Инварианты границ движок держит САМ, независимо от того, что вернула
 * стратегия (`kb:BASER-5`, «Что движок обязан защищать сам»): инвариант,
 * который держит только стратегия, — не инвариант, потому что стратегии
 * приходят из другой зоны и пишутся разными сессиями.
 */

import type { Tree } from '@nx/devkit';
import type {
  Declaration,
  FrameEntry,
  MaterializeMode,
} from './declaration.js';
import type { MaterializationStrategy, StrategyRegistry } from './strategy.js';
import { toStrategyRegistry } from './strategy.js';
import type { CanonBaseline, CanonSource } from './source.js';
import { EMPTY_BASELINE, createTreeSource } from './source.js';
import type {
  MarkerFormat,
  OwnershipClass,
  OwnershipRecord,
  ScanOptions,
} from './ownership.js';
import {
  DEFAULT_SCAN_IGNORE,
  UnmarkableContentError,
  markerFormatFor,
  scanOwnership,
} from './ownership.js';
import type { TraceRecorder, TraceSpan } from './trace.js';
import { createTrace } from './trace.js';
import { normalizeRepoPath } from './paths.js';
import { OUTPUT_SCHEMA_VERSION } from './schema.js';

export type PlanStepKind = 'create' | 'update' | 'delete' | 'release';

export type PlanReason =
  /** Объявленного артефакта нет — материализуем впервые. */
  | 'missing'
  /** Тело артефакта под нашим маркером разошлось с каноном. */
  | 'diverged'
  /** Существовавший непомеченный файл впервые берётся во владение. */
  | 'adopted'
  /**
   * Объявленное владение изменилось: маркер приводится к текущей декларации
   * (`kb:BASER-5`, «Маркер обязан отражать ТЕКУЩЕЕ объявленное владение»).
   * С `kind: 'release'` — переход в класс `product`, претензия снимается.
   */
  | 'reclaimed'
  /** Артефакт потерял объявление в `frame`. */
  | 'orphan';

/** Один шаг плана. `content === null` только у снятия артефакта. */
export interface PlanStep {
  readonly kind: PlanStepKind;
  readonly dest: string;
  readonly reason: PlanReason;
  readonly src?: string;
  readonly mode?: MaterializeMode;
  /** Класс владения, от имени которого выполняется шаг. */
  readonly ownership?: OwnershipClass;
  /** Целевое содержимое (с маркером владения), `null` для `delete`. */
  readonly content: string | null;
  /** Текущее содержимое до применения — материал для показа расхождения. */
  readonly previous: string | null;
}

export type ConflictKind =
  /** Две записи `frame` претендуют на один `dest`. */
  | 'duplicate-dest'
  /** `dest` существует и принадлежит не движку. */
  | 'foreign-dest'
  /**
   * Объявление СУЖАЕТ владение до единоличного (`shared` → `engine`): у
   * продукта отнимается право на вклад, который движок сам признавал законным.
   */
  | 'ownership-narrowing'
  /**
   * Объявленное состояние физически недостижимо: сегмент пути `dest` занят
   * файлом — объявленным другой записью или уже лежащим в дереве. Виртуальное
   * дерево такое терпит, реальная ФС — нет (`kb:BASER-5`).
   */
  | 'unreachable-dest'
  /** `dest` лежит внутри `contentRoot` — движок писал бы в собственный источник. */
  | 'dest-in-content-root'
  /** Класс файла не может нести маркер владения — доказать владение нечем. */
  | 'unmarkable-dest'
  /** Источник `src` не найден под `contentRoot`. */
  | 'missing-source'
  /** Для режима записи не зарегистрирована стратегия. */
  | 'unknown-mode'
  /** Отказ на уровне режима. */
  | 'strategy';

/**
 * Машинные подробности причины отказа.
 *
 * Всё, о чём говорит `message`, доступно здесь данными: `message` — рендер, а
 * не единственный носитель причины (`kb:BASER-5`).
 */
export interface ConflictDetail {
  /** `duplicate-dest`: `src` записи, уже claim'нувшей этот `dest`. */
  readonly claimedBy?: string;
  /** `missing-source`: полный адрес источника, которого нет. */
  readonly sourcePath?: string;
  /** `unknown-mode`: режимы, для которых стратегии зарегистрированы. */
  readonly availableModes?: readonly MaterializeMode[];
  /**
   * `foreign-dest` · `ownership-narrowing`: чем отказ снимается.
   * Код совпадает с именем механизма в API (`PlanOptions.confirm`): панель,
   * показавшая одно имя, и вызов, требующий другого, — расхождение, которое
   * всплывёт у потребителя (`kb:BASER-5`, «Подтверждение называется одинаково
   * везде»).
   */
  readonly resolution?: 'confirm' | 'drop-frame-entry';
  /** `ownership-narrowing`: класс владения, записанный в маркере сейчас. */
  readonly fromOwnership?: OwnershipClass;
  /** `ownership-narrowing`: класс владения, которого требует декларация. */
  readonly toOwnership?: OwnershipClass;
  /** `unreachable-dest`: путь, который занят файлом и перекрывает `dest`. */
  readonly blockedBy?: string;
  /** `unreachable-dest`: чем именно занят перекрывающий путь. */
  readonly collision?: 'declared-dest' | 'existing-file' | 'existing-directory';
  /** `dest-in-content-root`: корень содержимого источника из декларации. */
  readonly contentRoot?: string;
  /** `unmarkable-dest`: почему маркер невозможен. */
  readonly unmarkable?: 'no-format-for-class' | 'content-shape';
  /** `strategy`: причина отказа, как её назвала стратегия режима. */
  readonly strategyReason?: string;
}

export interface PlanConflict {
  readonly kind: ConflictKind;
  readonly dest: string;
  readonly src?: string;
  readonly mode?: MaterializeMode;
  /** Класс владения, которого требует режим (если он известен). */
  readonly ownership?: OwnershipClass;
  /** Машинные подробности причины — источник истины для гейта и панели. */
  readonly detail: ConflictDetail;
  /** Человекочитаемое объяснение: рендер поверх `kind` + `detail`. */
  readonly message: string;
}

export type PlanNoticeKind =
  /**
   * `dest` существует и его класс владения — `product`: движок шага не
   * порождает, что бы ни вернула стратегия. Не отказ: так и должно быть.
   */
  | 'product-owned'
  /**
   * Базы трёхстороннего мерджа нет — мердж будет двухсторонним.
   * Контракт требует НАЗВАТЬ это, а не выродиться молча.
   */
  | 'baseline-missing'
  /**
   * Поданное подтверждение не понадобилось: по этому `dest` отказа не было
   * (или он вовсе не объявлен). Названо, чтобы «подтвердил, а ничего не
   * изменилось» не выглядело как молчание движка.
   */
  | 'confirmation-unused'
  /**
   * Раннер сузил охват скана, поэтому движок не отвечает за полноту снятия
   * сирот. Извещение уровня ПРОГОНА (без `dest`): потребитель обязан отличать
   * «сирот нет» от «сирот не искали во всём дереве» (`kb:BASER-5`).
   */
  | 'scan-scope-narrowed';

/**
 * Извещение: состояние, которое обязано быть НАЗВАНО, но не является ни шагом,
 * ни отказом. Извещения не влияют на применимость плана и на сходимость.
 */
export interface PlanNotice {
  readonly kind: PlanNoticeKind;
  /** Артефакт, которого касается извещение; нет — извещение уровня прогона. */
  readonly dest?: string;
  readonly src?: string;
  readonly mode?: MaterializeMode;
  readonly ownership?: OwnershipClass;
  readonly detail: NoticeDetail;
  readonly message: string;
}

export interface NoticeDetail {
  /** `baseline-missing`: версия канона из маркера (`null` — её там нет). */
  readonly version?: string | null;
  /** `baseline-missing`: почему база не восстановлена. */
  readonly cause?: 'no-version' | 'unresolved';
  /** `confirmation-unused`: почему подтверждение не пригодилось. */
  readonly confirmation?: 'not-required' | 'not-declared';
  /** `scan-scope-narrowed`: каталоги, с которых раннер начал скан. */
  readonly roots?: readonly string[];
  /** `scan-scope-narrowed`: пропуски сверх умолчания движка. */
  readonly ignored?: readonly string[];
}

/**
 * Состояние плана.
 *
 * Признак сходимости ОТДЕЛЁН от признака пустоты намеренно (`kb:BASER-5`):
 * план без шагов, но с конфликтами, сходимости НЕ означает. Гейт, построенный
 * на «в плане нет шагов», отрапортовал бы «в каноне» при нерешённом конфликте
 * владения — гейт, зеленеющий на конфликте, опаснее отсутствующего.
 * Поэтому честный ответ нельзя получить случайно: спросить можно только
 * состояние целиком, отдельного «плана нет шагов» в схеме нет.
 */
export type PlanStatus =
  /** Нечего делать и нечего решать: дерево сошлось с декларацией. */
  | 'converged'
  /** Есть шаги, конфликтов нет — план применим. */
  | 'pending'
  /** Есть нерешённые конфликты — план не применяется целиком. */
  | 'blocked';

export interface MaterializationPlan {
  /** Версия схемы вывода — контракт с панелью и скриптами. */
  readonly schemaVersion: number;
  /** Сходимость. `converged` учитывает и шаги, и конфликты. */
  readonly status: PlanStatus;
  readonly steps: readonly PlanStep[];
  readonly conflicts: readonly PlanConflict[];
  /** Названные состояния, не требующие ни шага, ни отказа. */
  readonly notices: readonly PlanNotice[];
  readonly trace: readonly TraceSpan[];
}

export interface PlanOptions {
  readonly tree: Tree;
  readonly declaration: Declaration;
  /** Стратегии режимов; реализации приходят из `@omnifield/baser-modes`. */
  readonly strategies: StrategyRegistry | Iterable<MaterializationStrategy>;
  /** Источник канона; по умолчанию — дерево + `contentRoot` декларации. */
  readonly source?: CanonSource;
  /** База трёхстороннего мерджа; по умолчанию базы нет. */
  readonly baseline?: CanonBaseline;
  /**
   * ПЕРЕЧЕНЬ `dest`, для которых отнятие прав у продукта подтверждено
   * (семантика `--force-conflicts` из Kubernetes SSA, но адресная).
   *
   * Подтверждение — согласие на КОНКРЕТНОЕ действие, а не режим прогона
   * (`kb:BASER-5`, «Подтверждение адресно, а не глобально»). Булев флаг
   * превращал бы санкционированный escape hatch в оружие по площадям:
   * подтвердив одно сужение владения, потребитель молча усыновлял и переписывал
   * все прочие чужие файлы декларации. **Согласие не масштабируется само** —
   * артефакт вне перечня остаётся под отказом.
   *
   * Что подтверждать — план называет сам: конфликты с `detail.resolution`
   * несут `dest`, по которым подаётся этот список. Формы «подтвердить всё» нет
   * намеренно; перечислить всё — осознанное действие раннера.
   *
   * Инвариант класса `product` подтверждением НЕ снимается — он не про конфликт.
   */
  readonly confirm?: readonly string[];
  readonly scan?: ScanOptions;
  readonly trace?: TraceRecorder;
}

/** Применим ли план к дереву. Производная от `status`, а не отдельный признак. */
export function isApplicable(plan: MaterializationPlan): boolean {
  return plan.status !== 'blocked';
}

/** Вычисляет план материализации. Дерево при этом НЕ меняется. */
export function computePlan(options: PlanOptions): MaterializationPlan {
  const { tree, declaration } = options;
  const trace = options.trace ?? createTrace();
  const registry = toStrategyRegistry(options.strategies);
  const source =
    options.source ?? createTreeSource(tree, declaration.contentRoot);
  const baseline = options.baseline ?? EMPTY_BASELINE;

  const confirm = new Set(
    (options.confirm ?? []).map((dest, index) =>
      normalizeRepoPath(dest, `confirm[${index}]`),
    ),
  );
  const consumed = new Set<string>();

  const steps: PlanStep[] = [];
  const conflicts: PlanConflict[] = [];
  let notices: PlanNotice[] = [];
  const claimed = new Map<string, FrameEntry>();
  /** Каталог пути → `dest`, ради которого он обязан быть каталогом. */
  const claimedDirs = new Map<string, string>();

  trace.span(
    'plan.frame',
    () => {
      for (const entry of declaration.frame) {
        const previousClaim = claimed.get(entry.dest);
        if (previousClaim !== undefined) {
          // Спорный артефакт не получает ни шага, ни извещения: у файла под
          // двойной претензией нет решённого целевого состояния — есть отказ.
          const planned = steps.findIndex((step) => step.dest === entry.dest);
          if (planned >= 0) {
            steps.splice(planned, 1);
          }
          notices = notices.filter((notice) => notice.dest !== entry.dest);
          conflicts.push({
            kind: 'duplicate-dest',
            dest: entry.dest,
            src: entry.src,
            mode: entry.mode,
            detail: { claimedBy: previousClaim.src },
            message:
              `конфликт владения: "${entry.dest}" объявлен дважды ` +
              `(src "${previousClaim.src}" и src "${entry.src}") — ` +
              'у артефакта может быть только одна запись frame',
          });
          continue;
        }
        const unreachable = reachabilityConflict(entry, {
          tree,
          contentRoot: declaration.contentRoot,
          claimed,
          claimedDirs,
        });
        if (unreachable !== null) {
          conflicts.push(unreachable);
          continue;
        }

        claimed.set(entry.dest, entry);
        for (const dir of ancestorsOf(entry.dest)) {
          if (!claimedDirs.has(dir)) {
            claimedDirs.set(dir, entry.dest);
          }
        }

        const outcome = planEntry(entry, {
          tree,
          declaration,
          registry,
          source,
          baseline,
          confirmed: confirm.has(entry.dest),
        });

        if (outcome.step !== undefined) {
          steps.push(outcome.step);
        }
        if (outcome.conflict !== undefined) {
          conflicts.push(outcome.conflict);
        }
        if (outcome.notice !== undefined) {
          notices.push(outcome.notice);
        }
        if (outcome.confirmationUsed === true) {
          consumed.add(entry.dest);
        }
      }
    },
    { entries: declaration.frame.length },
  );

  for (const dest of confirm) {
    if (consumed.has(dest)) {
      continue;
    }
    const declared = claimed.has(dest);
    notices.push({
      kind: 'confirmation-unused',
      dest,
      detail: { confirmation: declared ? 'not-required' : 'not-declared' },
      message: declared
        ? `подтверждение по "${dest}" не понадобилось: отказа по этому артефакту нет`
        : `подтверждение по "${dest}" ни к чему не относится: такой записи нет в frame`,
    });
  }

  // Сужение охвата скана раннером — законно, но обязано быть НАЗВАНО:
  // движок перестаёт отвечать за полноту снятия сирот, и потребитель обязан
  // отличать «сирот нет» от «сирот не искали во всём дереве» (`kb:BASER-5`).
  const narrowing = scanNarrowing(options.scan);
  if (narrowing !== null) {
    notices.push(narrowing);
  }

  const owned = trace.span('plan.scan-ownership', () =>
    scanOwnership(tree, {
      ...options.scan,
      // Объявленные `dest` всегда в зоне видимости скана, каким бы ни был
      // список пропуска: собственный артефакт не имеет права стать невидимым.
      declared: [
        ...(options.scan?.declared ?? []),
        ...declaration.frame.map((entry) => entry.dest),
      ],
    }),
  );
  trace.event('plan.owned', { files: owned.size });

  trace.span('plan.orphans', () => {
    for (const [dest, record] of owned) {
      if (claimed.has(dest)) {
        continue;
      }
      const step = planOrphan(tree, dest, record);
      if (step !== null) {
        steps.push(step);
      }
    }
  });

  steps.sort((left, right) => left.dest.localeCompare(right.dest));
  conflicts.sort((left, right) => left.dest.localeCompare(right.dest));
  notices.sort((left, right) =>
    (left.dest ?? '').localeCompare(right.dest ?? ''),
  );

  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    status: statusOf(steps, conflicts),
    steps,
    conflicts,
    notices,
    trace: trace.snapshot(),
  };
}

function statusOf(
  steps: readonly PlanStep[],
  conflicts: readonly PlanConflict[],
): PlanStatus {
  if (conflicts.length > 0) {
    return 'blocked';
  }
  return steps.length === 0 ? 'converged' : 'pending';
}

/**
 * Извещение о сокращённом охвате скана; `null` — охват полный.
 *
 * Сокращением считается и старт не от корня (`roots`), и пропуск сверх
 * умолчания движка (`ignore`): в обоих случаях часть дерева не просматривалась.
 * Расширение списка пропуска в меньшую сторону извещения не требует — оно
 * охват не сужает.
 */
function scanNarrowing(scan: ScanOptions | undefined): PlanNotice | null {
  const roots = scan?.roots;
  const extraIgnored = (scan?.ignore ?? []).filter(
    (name) => !DEFAULT_SCAN_IGNORE.includes(name),
  );
  const narrowedByRoots = roots !== undefined;

  if (!narrowedByRoots && extraIgnored.length === 0) {
    return null;
  }

  return {
    kind: 'scan-scope-narrowed',
    detail: {
      ...(narrowedByRoots ? { roots } : {}),
      ...(extraIgnored.length > 0 ? { ignored: extraIgnored } : {}),
    },
    message:
      'охват скана сокращён раннером ' +
      (narrowedByRoots ? `(корни: ${roots.join(', ')}) ` : '') +
      (extraIgnored.length > 0
        ? `(пропуск: ${extraIgnored.join(', ')}) `
        : '') +
      '— движок не отвечает за полноту снятия сирот вне этого охвата: ' +
      '«сирот нет» и «сирот не искали во всём дереве» это разные состояния',
  };
}

interface ReachabilityContext {
  readonly tree: Tree;
  readonly contentRoot: string;
  readonly claimed: ReadonlyMap<string, FrameEntry>;
  readonly claimedDirs: ReadonlyMap<string, string>;
}

/**
 * Достижимо ли объявленное состояние ТАМ, ГДЕ АРТЕФАКТЫ В ИТОГЕ ЖИВУТ.
 *
 * Атомарность движка кончается на виртуальном дереве: сброс на реальную ФС
 * делает раннер, и его сбой происходит уже ВНЕ журнала отката. Поэтому всё, что
 * упадёт при записи на диск, обязано быть поймано планом (`kb:BASER-5`,
 * «Объявленное состояние обязано быть физически достижимым»). Дерево Nx терпит
 * файл и каталог с одним путём одновременно — файловая система не терпит, и
 * эталон реальности здесь она, а не дерево.
 *
 * Проверки стоят ПО СУЩЕСТВУ, а не побочно: коллизия `cfg` + `cfg/inner.yml`
 * раньше отбивалась правилом про неразмечаемый класс файла, а `dest` внутри
 * `contentRoot` — конфликтом чужого файла. Побочная защита отвалится, как
 * только изменится смежное правило.
 */
function reachabilityConflict(
  entry: FrameEntry,
  context: ReachabilityContext,
): PlanConflict | null {
  const { tree, contentRoot, claimed, claimedDirs } = context;

  if (isInside(entry.dest, contentRoot)) {
    return {
      kind: 'dest-in-content-root',
      dest: entry.dest,
      src: entry.src,
      mode: entry.mode,
      detail: { contentRoot },
      message:
        `"${entry.dest}" лежит внутри contentRoot "${contentRoot}": движок писал бы ` +
        'в собственный источник канона — материализация в источник не имеет смысла',
    };
  }

  for (const ancestor of ancestorsOf(entry.dest)) {
    if (claimed.has(ancestor)) {
      return unreachable(entry, ancestor, 'declared-dest');
    }
    if (tree.exists(ancestor) && tree.isFile(ancestor)) {
      return unreachable(entry, ancestor, 'existing-file');
    }
  }

  const blockedDest = claimedDirs.get(entry.dest);
  if (blockedDest !== undefined) {
    return unreachable(entry, blockedDest, 'declared-dest');
  }

  // Симметричный случай: сам `dest` уже занят КАТАЛОГОМ. Контракт его отдельно
  // не перечисляет, но правило то же — файл на месте каталога не создать, и
  // упадёт это опять при сбросе на диск, вне журнала отката.
  if (tree.exists(entry.dest) && !tree.isFile(entry.dest)) {
    return unreachable(entry, entry.dest, 'existing-directory');
  }

  return null;
}

const COLLISION_CAUSE: Record<
  'declared-dest' | 'existing-file' | 'existing-directory',
  string
> = {
  'declared-dest': 'путь занят файлом, объявленным другой записью frame',
  'existing-file': 'путь занят файлом, который уже лежит в дереве',
  'existing-directory': 'путь занят каталогом, который уже лежит в дереве',
};

function unreachable(
  entry: FrameEntry,
  blockedBy: string,
  collision: 'declared-dest' | 'existing-file' | 'existing-directory',
): PlanConflict {
  return {
    kind: 'unreachable-dest',
    dest: entry.dest,
    src: entry.src,
    mode: entry.mode,
    detail: { blockedBy, collision },
    message:
      `"${entry.dest}" недостижим: ${COLLISION_CAUSE[collision]} ("${blockedBy}"). ` +
      'Виртуальное дерево такое состояние терпит, файловая система — нет',
  };
}

/** Каталоги-предки пути, от ближнего к корню: `a/b/c.yml` → `a`, `a/b`. */
function ancestorsOf(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  const dirs: string[] = [];
  let current = '';
  for (const segment of segments) {
    current = current === '' ? segment : `${current}/${segment}`;
    dirs.push(current);
  }
  return dirs;
}

/** Лежит ли путь внутри каталога (или совпадает с ним). */
function isInside(path: string, directory: string): boolean {
  const root = directory.replace(/\/+$/, '');
  return root !== '' && (path === root || path.startsWith(`${root}/`));
}

interface EntryContext {
  readonly tree: Tree;
  readonly declaration: Declaration;
  readonly registry: StrategyRegistry;
  readonly source: CanonSource;
  readonly baseline: CanonBaseline;
  /** Подтверждено ли отнятие прав именно по ЭТОМУ `dest`. */
  readonly confirmed: boolean;
}

/** Исход одной записи `frame`: не более одного шага, отказа и извещения. */
interface EntryOutcome {
  readonly step?: PlanStep;
  readonly conflict?: PlanConflict;
  readonly notice?: PlanNotice;
  /** Подтверждение по этому `dest` пригодилось: отказ снят именно им. */
  readonly confirmationUsed?: boolean;
}

function planEntry(entry: FrameEntry, context: EntryContext): EntryOutcome {
  const { tree, registry, source, baseline, declaration, confirmed } = context;

  const strategy = registry.get(entry.mode);
  if (strategy === undefined) {
    return {
      conflict: {
        kind: 'unknown-mode',
        dest: entry.dest,
        src: entry.src,
        mode: entry.mode,
        detail: { availableModes: registry.modes },
        message:
          `режим "${entry.mode}" не реализован: стратегия не зарегистрирована ` +
          `(доступны: ${registry.modes.join(', ') || 'ни одной'}) — ` +
          'режимы поставляет @omnifield/baser-modes',
      },
    };
  }

  const sourceContent = source.read(entry.src);
  if (sourceContent === null) {
    return {
      conflict: {
        kind: 'missing-source',
        dest: entry.dest,
        src: entry.src,
        mode: entry.mode,
        ownership: strategy.ownership,
        detail: { sourcePath: source.describe(entry.src) },
        message: `источник "${source.describe(entry.src)}" не найден — материализовать нечего`,
      },
    };
  }

  const needsMarker = strategy.ownership !== 'product';
  const format = markerFormatFor(entry.dest);
  if (needsMarker && format === null) {
    return {
      conflict: {
        kind: 'unmarkable-dest',
        dest: entry.dest,
        src: entry.src,
        mode: entry.mode,
        ownership: strategy.ownership,
        detail: { unmarkable: 'no-format-for-class' },
        message:
          `владение "${entry.dest}" недоказуемо: класс файла не несёт маркер, ` +
          `а режим "${entry.mode}" требует владения (${strategy.ownership}) — ` +
          'движок не берёт файл во владение молча',
      },
    };
  }

  const raw = tree.exists(entry.dest) ? tree.read(entry.dest, 'utf-8') : null;
  const record = raw !== null && format !== null ? format.parse(raw) : null;
  const owned = record !== null;

  // ИНВАРИАНТ ДВИЖКА, а не добросовестности режима (`kb:BASER-5`): существующий
  // `dest` класса `product` не порождает шага записи, что бы ни вернула
  // стратегия. Стратегию для такого файла даже не спрашиваем — «однократно,
  // если файла нет» держится проверкой здесь, а не тем, что стратегия вернёт
  // `keep`.
  if (strategy.ownership === 'product' && raw !== null) {
    // Но молчать нельзя, если файл всё ещё несёт НАШ маркер: декларация уже
    // отдала его продукту, а артефакт продолжает утверждать снятое владение —
    // и следующее снятие записи из `frame` удалило бы файл продукта вместе с
    // его правками. Смена объявленного класса на `product` — это ОТПУСКАНИЕ
    // ПРЕТЕНЗИИ (`kb:BASER-5`, «Маркер обязан отражать ТЕКУЩЕЕ объявленное
    // владение»), той же семантикой, что у осиротевшего `shared`.
    if (record !== null && format !== null) {
      const released = format.strip(raw as string);
      if (released !== raw) {
        return {
          step: {
            kind: 'release',
            dest: entry.dest,
            reason: 'reclaimed',
            src: entry.src,
            mode: entry.mode,
            ownership: 'product',
            content: released,
            previous: raw,
          },
        };
      }
    }

    return {
      notice: {
        kind: 'product-owned',
        dest: entry.dest,
        src: entry.src,
        mode: entry.mode,
        ownership: 'product',
        detail: {},
        message:
          `"${entry.dest}" уже существует и принадлежит продукту ` +
          `(режим "${entry.mode}" материализует однократно) — движок его не трогает`,
      },
    };
  }

  // Подтверждение адресно: снимает отказ ТОЛЬКО по своему `dest`.
  let confirmationUsed = false;

  if (strategy.ownership === 'engine' && raw !== null && !owned) {
    if (!confirmed) {
      return {
        conflict: {
          kind: 'foreign-dest',
          dest: entry.dest,
          src: entry.src,
          mode: entry.mode,
          ownership: 'engine',
          detail: { resolution: 'confirm' },
          message:
            `конфликт владения: "${entry.dest}" уже существует и не помечен как ` +
            `материализованный движком, а режим "${entry.mode}" требует единоличного ` +
            'владения. Отказ вместо тихой перезаписи: подтверди этот dest поимённо ' +
            'или сними запись из frame',
        },
      };
    }
    confirmationUsed = true;
  }

  // СУЖЕНИЕ владения до единоличного требует явного подтверждения
  // (`kb:BASER-5`). Забрать единоличное владение у совместного молча нельзя:
  // продукт вносил вклад с нашего же ведома — движок сам признавал его
  // законным, — и переход стёр бы этот вклад без следа. Строгий гейт не может
  // стоять на слабом случае (непомеченный чужой файл) и отсутствовать на
  // сильном. Обратное направление подтверждения НЕ требует: расширяя владение
  // до `shared` или отпуская его в `product`, движок отдаёт права, а не
  // отнимает, — симметрии здесь быть не должно.
  if (
    strategy.ownership === 'engine' &&
    record !== null &&
    record.own !== 'engine'
  ) {
    if (!confirmed) {
      return {
        conflict: {
          kind: 'ownership-narrowing',
          dest: entry.dest,
          src: entry.src,
          mode: entry.mode,
          ownership: 'engine',
          detail: {
            resolution: 'confirm',
            fromOwnership: record.own,
            toOwnership: 'engine',
          },
          message:
            `конфликт владения: "${entry.dest}" материализован как совместный ` +
            `(${record.own}), а режим "${entry.mode}" требует единоличного владения — ` +
            'вклад продукта будет стёрт. Отнять права у продукта можно только ' +
            'подтвердив этот dest поимённо; иначе оставь режим совместного владения',
        },
      };
    }
    confirmationUsed = true;
  }

  const baselineContent =
    record?.version === undefined
      ? null
      : baseline.read(entry.src, record.version);

  const decision = strategy.decide({
    entry,
    declaration,
    source: sourceContent,
    current: raw === null ? null : format !== null ? format.strip(raw) : raw,
    baseline: baselineContent,
    owned,
    record,
  });

  // Базу мерджа спрашивают только у совместного владения, и только когда есть
  // что мерджить: у отсутствующего `dest` третьей стороны нет по определению.
  const notice =
    strategy.ownership === 'shared' && raw !== null && baselineContent === null
      ? baselineMissing(entry, record)
      : undefined;

  if (decision.kind === 'keep') {
    return { notice, confirmationUsed };
  }
  if (decision.kind === 'conflict') {
    return {
      notice,
      confirmationUsed,
      conflict: {
        kind: 'strategy',
        dest: entry.dest,
        src: entry.src,
        mode: entry.mode,
        ownership: strategy.ownership,
        detail: { strategyReason: decision.reason },
        message: `режим "${entry.mode}" отказал по "${entry.dest}": ${decision.reason}`,
      },
    };
  }

  let content: string;
  try {
    content = stampIfNeeded(
      decision.content,
      entry,
      strategy.ownership,
      needsMarker ? format : null,
      source.version,
    );
  } catch (error) {
    if (error instanceof UnmarkableContentError) {
      return {
        notice,
        confirmationUsed,
        conflict: {
          kind: 'unmarkable-dest',
          dest: entry.dest,
          src: entry.src,
          mode: entry.mode,
          ownership: strategy.ownership,
          detail: { unmarkable: 'content-shape' },
          message: `владение "${entry.dest}" недоказуемо: ${error.message}`,
        },
      };
    }
    throw error;
  }

  const reason = transitionReason({
    raw,
    content,
    record,
    entry,
    ownership: strategy.ownership,
    format,
  });
  if (reason === null) {
    return { notice, confirmationUsed };
  }

  return {
    notice,
    confirmationUsed,
    step: {
      kind: raw === null ? 'create' : 'update',
      dest: entry.dest,
      reason,
      src: entry.src,
      mode: entry.mode,
      ownership: strategy.ownership,
      content,
      previous: raw,
    },
  };
}

interface TransitionInput {
  readonly raw: string | null;
  readonly content: string;
  readonly record: OwnershipRecord | null;
  readonly entry: FrameEntry;
  readonly ownership: OwnershipClass;
  readonly format: MarkerFormat | null;
}

/**
 * Что произошло с артефактом — или `null`, если делать нечего.
 *
 * Сравнение ведётся по ТЕЛУ артефакта и по АКТУАЛЬНОСТИ ПРЕТЕНЗИИ, а не по
 * строке маркера целиком (`kb:BASER-5`, «Маркер обязан отражать ТЕКУЩЕЕ
 * объявленное владение»):
 *   - **версия канона — провенанс, а не основание для шага.** Бамп версии при
 *     том же теле переписал бы все артефакты у всех потребителей и отрапортовал
 *     бы расхождение там, где ничего не разошлось; версия обновляется вместе с
 *     телом, когда шаг и так происходит;
 *   - **claim (src · mode · класс владения) обязан отражать декларацию.**
 *     Устаревший маркер утверждает снятое владение, а это прямой путь к потере
 *     файла продукта на следующем снятии записи.
 *
 * Первичное взятие непомеченного файла во владение — отдельное событие
 * (`adopted`), отличное от расхождения: гейт обязан показывать их по-разному.
 */
function transitionReason(input: TransitionInput): PlanReason | null {
  const { raw, content, record, entry, ownership, format } = input;

  if (raw === null) {
    return 'missing';
  }
  if (record === null) {
    return 'adopted';
  }
  // Порядок значим: если декларация сменила claim, первичное событие — именно
  // это, а не расхождение тела (тело разошлось ВСЛЕДСТВИЕ смены объявления).
  // Причина обязана быть правдой — на неё ветвятся гейт и панель.
  if (!claimMatches(record, entry, ownership)) {
    return 'reclaimed';
  }
  return bodyOf(raw, format) !== bodyOf(content, format) ? 'diverged' : null;
}

/** Содержимое без служебной строки владения. */
function bodyOf(content: string, format: MarkerFormat | null): string {
  return format === null ? content : format.strip(content);
}

/** Утверждает ли маркер ровно то владение, которое объявлено сейчас. */
function claimMatches(
  record: OwnershipRecord,
  entry: FrameEntry,
  ownership: OwnershipClass,
): boolean {
  return (
    record.src === entry.src &&
    record.mode === entry.mode &&
    record.own === ownership
  );
}

function baselineMissing(
  entry: FrameEntry,
  record: OwnershipRecord | null,
): PlanNotice {
  const version = record?.version ?? null;
  return {
    kind: 'baseline-missing',
    dest: entry.dest,
    src: entry.src,
    mode: entry.mode,
    ownership: 'shared',
    detail: {
      version,
      cause: version === null ? 'no-version' : 'unresolved',
    },
    message:
      version === null
        ? `база мерджа для "${entry.dest}" неизвестна: артефакт не несёт версии канона — ` +
          'мердж будет двухсторонним'
        : `база мерджа для "${entry.dest}" не восстановлена: версия канона "${version}" ` +
          'недоступна источнику базы — мердж будет двухсторонним',
  };
}

function stampIfNeeded(
  content: string,
  entry: FrameEntry,
  own: OwnershipClass,
  format: MarkerFormat | null,
  version: string | null,
): string {
  if (format === null) {
    return content;
  }
  return format.stamp(format.strip(content), {
    src: entry.src,
    mode: entry.mode,
    own,
    ...(version === null ? {} : { version }),
  });
}

/**
 * Артефакт потерял объявление.
 *
 * Что именно делать — определяет класс владения, записанный в маркере
 * (`kb:BASER-3`, «отпускание владения» в Kubernetes SSA):
 *   - `engine` — файл был целиком наш → снимается;
 *   - `shared` — вклад вносил и продукт → мы лишь отпускаем претензию, снимая
 *     маркер; содержимое остаётся продукту;
 *   - `product` — такие файлы маркер не несут и сюда не попадают.
 */
function planOrphan(
  tree: Tree,
  dest: string,
  record: OwnershipRecord,
): PlanStep | null {
  const raw = tree.read(dest, 'utf-8');
  if (raw === null) {
    return null;
  }

  if (record.own === 'engine') {
    return {
      kind: 'delete',
      dest,
      reason: 'orphan',
      ownership: 'engine',
      content: null,
      previous: raw,
    };
  }

  const format = markerFormatFor(dest);
  if (format === null) {
    return null;
  }
  const released = format.strip(raw);
  if (released === raw) {
    return null;
  }

  return {
    kind: 'release',
    dest,
    reason: 'orphan',
    mode: record.mode,
    src: record.src,
    ownership: record.own,
    content: released,
    previous: raw,
  };
}

/**
 * Человекочитаемый рендер плана — ОДИН ИЗ выходов, а не источник.
 *
 * Ветвиться по этому тексту нельзя: решения принимаются по `status`, `kind`,
 * `reason` и `detail` (`kb:BASER-5`, «Вывод машинночитаем в первую очередь»).
 */
export function describePlan(plan: MaterializationPlan): string {
  const lines: string[] = [];

  if (plan.status === 'converged') {
    lines.push('план пуст: дерево сошлось с декларацией');
  } else {
    lines.push(`шагов: ${plan.steps.length}`);
    for (const step of plan.steps) {
      lines.push(`  ${step.kind.padEnd(7)} ${step.dest}  (${step.reason})`);
    }
  }

  if (plan.conflicts.length > 0) {
    lines.push(`конфликтов: ${plan.conflicts.length} — план не применяется`);
    for (const conflict of plan.conflicts) {
      lines.push(`  ${conflict.kind}: ${conflict.message}`);
    }
  }

  if (plan.notices.length > 0) {
    lines.push(`извещений: ${plan.notices.length}`);
    for (const notice of plan.notices) {
      lines.push(`  ${notice.kind}: ${notice.message}`);
    }
  }

  return lines.join('\n');
}
