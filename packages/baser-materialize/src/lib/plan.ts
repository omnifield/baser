/**
 * ФАЗА 1 — ПЛАН.
 *
 * План — это ДАННЫЕ, а не побочка: он вычисляется и читается ДО применения
 * («две фазы»; рынок подтвердил разрыв дважды независимо — `nx migrate`
 * разносит его на две команды, схематики — на две фазы).
 *
 * План машинночитаем в первую очередь: вид шага, причина шага, вид конфликта и
 * вид извещения — стабильные МАШИННЫЕ КОДЫ, подробности причины лежат данными в
 * `detail`, а `message` — рендер для человека. Ветвиться по тексту сообщения
 * нельзя ни гейту, ни панели; `describePlan` — один из выходов, а не
 * единственный.
 *
 * ЧТО ДЕЛАЕТ ДВИЖОК С ОБЪЯВЛЕННЫМ АРТЕФАКТОМ — ровно одно: перегенерирует его
 * целиком из шаблона (`kb:BASER2-2`, модель A). Режимов нет, сведения исходной,
 * пользовательской и новой версии нет ни под каким флагом, класса владения на
 * записи нет. Правка нашего артефакта руками не делает его пользовательским —
 * владение переходит только форком источника, снаружи движка.
 *
 * Инварианты, за которые отвечает именно эта фаза:
 *   §1 идемпотентность — сошедшийся артефакт НЕ порождает шага, поэтому второй
 *      прогон даёт план без шагов (операционное определение сходимости из IaC);
 *   §3 отсутствие сирот — артефакт с нашим маркером, потерявший запись в
 *      `frame`, попадает в план на снятие;
 *   §4 отказ вместо тихой перезаписи — конфликт владения попадает в
 *      `conflicts`, а не в `steps`, и делает план неприменимым;
 *   §5 показать расхождение — каждый шаг несёт `previous`, чтобы раннер мог
 *      показать разницу, а план — НАЗВАТЬ ПОТЕРИ до применения.
 */

import type { Tree } from '@nx/devkit';
import type { Declaration, FrameEntry } from './declaration.js';
import type { CanonSource } from './source.js';
import { createTreeSource } from './source.js';
import type { OwnershipRecord, ScanOptions } from './ownership.js';
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

export type PlanStepKind = 'create' | 'update' | 'delete';

export type PlanReason =
  /** Объявленного артефакта нет — материализуем впервые. */
  | 'missing'
  /** Тело артефакта под нашим маркером разошлось с шаблоном. */
  | 'diverged'
  /** Существовавший непомеченный файл впервые берётся во владение. */
  | 'adopted'
  /**
   * Служебная запись артефакта разошлась с декларацией: маркер утверждает
   * не тот `src`, что объявлен сейчас, — претензия приводится к декларации.
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
  /** Целевое содержимое (с маркером владения), `null` для `delete`. */
  readonly content: string | null;
  /** Текущее содержимое до применения — материал для показа расхождения. */
  readonly previous: string | null;
}

export type ConflictKind =
  /** Две записи `frame` претендуют на один `dest`. */
  | 'duplicate-dest'
  /** `dest` существует и не помечен как материализованный движком. */
  | 'foreign-dest'
  /**
   * Объявленное состояние физически недостижимо: сегмент пути `dest` занят
   * файлом — объявленным другой записью или уже лежащим в дереве. Виртуальное
   * дерево такое терпит, реальная ФС — нет.
   */
  | 'unreachable-dest'
  /** `dest` лежит внутри `contentRoot` — движок писал бы в собственный источник. */
  | 'dest-in-content-root'
  /** Класс файла не может нести маркер владения — доказать владение нечем. */
  | 'unmarkable-dest'
  /** Источник `src` не найден под `contentRoot`. */
  | 'missing-source';

/**
 * Машинные подробности причины отказа.
 *
 * Всё, о чём говорит `message`, доступно здесь данными: `message` — рендер, а
 * не единственный носитель причины.
 */
export interface ConflictDetail {
  /** `duplicate-dest`: `src` записи, уже claim'нувшей этот `dest`. */
  readonly claimedBy?: string;
  /** `missing-source`: полный адрес источника, которого нет. */
  readonly sourcePath?: string;
  /**
   * `foreign-dest`: чем отказ снимается.
   * Код совпадает с именем механизма в API (`PlanOptions.confirm`): панель,
   * показавшая одно имя, и вызов, требующий другого, — расхождение, которое
   * всплывёт у потребителя.
   */
  readonly resolution?: 'confirm' | 'drop-frame-entry';
  /** `unreachable-dest`: путь, который занят файлом и перекрывает `dest`. */
  readonly blockedBy?: string;
  /** `unreachable-dest`: чем именно занят перекрывающий путь. */
  readonly collision?: 'declared-dest' | 'existing-file' | 'existing-directory';
  /** `dest-in-content-root`: корень содержимого источника из декларации. */
  readonly contentRoot?: string;
  /** `unmarkable-dest`: почему маркер невозможен. */
  readonly unmarkable?: 'no-format-for-class' | 'content-shape';
}

export interface PlanConflict {
  readonly kind: ConflictKind;
  readonly dest: string;
  readonly src?: string;
  /** Машинные подробности причины — источник истины для гейта и панели. */
  readonly detail: ConflictDetail;
  /** Человекочитаемое объяснение: рендер поверх `kind` + `detail`. */
  readonly message: string;
}

export type PlanNoticeKind =
  /**
   * Поданное подтверждение не понадобилось: по этому `dest` отказа не было
   * (или он вовсе не объявлен). Названо, чтобы «подтвердил, а ничего не
   * изменилось» не выглядело как молчание движка.
   */
  | 'confirmation-unused'
  /**
   * Раннер сузил охват скана, поэтому движок не отвечает за полноту снятия
   * сирот. Извещение уровня ПРОГОНА (без `dest`): потребитель обязан отличать
   * «сирот нет» от «сирот не искали во всём дереве».
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
  readonly detail: NoticeDetail;
  readonly message: string;
}

export interface NoticeDetail {
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
 * Признак сходимости ОТДЕЛЁН от признака пустоты намеренно: план без шагов, но
 * с конфликтами, сходимости НЕ означает. Гейт, построенный на «в плане нет
 * шагов», отрапортовал бы «в каноне» при нерешённом конфликте владения — гейт,
 * зеленеющий на конфликте, опаснее отсутствующего. Поэтому честный ответ нельзя
 * получить случайно: спросить можно только состояние целиком, отдельного «плана
 * нет шагов» в схеме нет.
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
  /** Источник шаблонов; по умолчанию — дерево + `contentRoot` декларации. */
  readonly source?: CanonSource;
  /**
   * ПЕРЕЧЕНЬ `dest`, для которых перезапись чужого файла подтверждена
   * (семантика `--force-conflicts` из Kubernetes SSA, но адресная).
   *
   * Подтверждение — согласие на КОНКРЕТНОЕ действие, а не режим прогона. Булев
   * флаг превращал бы санкционированный escape hatch в оружие по площадям:
   * подтвердив одну перезапись, потребитель молча усыновлял и переписывал все
   * прочие чужие файлы декларации. **Согласие не масштабируется само** —
   * артефакт вне перечня остаётся под отказом.
   *
   * Что подтверждать — план называет сам: конфликты с `detail.resolution`
   * несут `dest`, по которым подаётся этот список. Формы «подтвердить всё» нет
   * намеренно; перечислить всё — осознанное действие раннера.
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
  const source =
    options.source ?? createTreeSource(tree, declaration.contentRoot);

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

  // Скан владения идёт ДО обхода `frame`: сироты нужны уже на проверке
  // достижимости — путь, занятый файлом, который этот же план снимает, не
  // является препятствием.
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

  const declaredDests = new Set(declaration.frame.map((entry) => entry.dest));
  /** Наши артефакты, которые этот прогон снимает: они освобождают свой путь. */
  const removed = new Set(
    [...owned.keys()].filter((dest) => !declaredDests.has(dest)),
  );

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
          source,
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
    const declared = declaredDests.has(dest);
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
  // отличать «сирот нет» от «сирот не искали во всём дереве».
  const narrowing = scanNarrowing(options.scan);
  if (narrowing !== null) {
    notices.push(narrowing);
  }

  trace.span('plan.orphans', () => {
    for (const dest of removed) {
      const step = planOrphan(tree, dest);
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
 * упадёт при записи на диск, обязано быть поймано планом. Дерево Nx терпит файл
 * и каталог с одним путём одновременно — файловая система не терпит, и эталон
 * реальности здесь она, а не дерево.
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
      detail: { contentRoot },
      message:
        `"${entry.dest}" лежит внутри contentRoot "${contentRoot}": движок писал бы ` +
        'в собственный источник шаблонов — материализация в источник не имеет смысла',
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
  readonly source: CanonSource;
  /** Подтверждена ли перезапись чужого файла именно по ЭТОМУ `dest`. */
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

/**
 * Целевое состояние одной записи `frame`.
 *
 * Здесь нет развилки по режиму и нет вопроса «каким должно быть содержимое»:
 * содержимое артефакта — это содержимое шаблона целиком (`kb:BASER2-2`).
 * Единственное, что движок решает, — можно ли трогать существующий файл и
 * требуется ли шаг.
 */
function planEntry(entry: FrameEntry, context: EntryContext): EntryOutcome {
  const { tree, source, confirmed } = context;

  const sourceContent = source.read(entry.src);
  if (sourceContent === null) {
    return {
      conflict: {
        kind: 'missing-source',
        dest: entry.dest,
        src: entry.src,
        detail: { sourcePath: source.describe(entry.src) },
        message: `шаблон "${source.describe(entry.src)}" не найден — материализовать нечего`,
      },
    };
  }

  const format = markerFormatFor(entry.dest);
  if (format === null) {
    return {
      conflict: {
        kind: 'unmarkable-dest',
        dest: entry.dest,
        src: entry.src,
        detail: { unmarkable: 'no-format-for-class' },
        message:
          `владение "${entry.dest}" недоказуемо: класс файла не несёт маркер — ` +
          'движок не берёт файл во владение молча',
      },
    };
  }

  const raw = tree.exists(entry.dest) ? tree.read(entry.dest, 'utf-8') : null;
  const record = raw !== null ? format.parse(raw) : null;

  // Подтверждение адресно: снимает отказ ТОЛЬКО по своему `dest`.
  let confirmationUsed = false;

  // Отказ вместо тихой перезаписи: файл, которого движок не материализовал,
  // перезаписывается только по поимённому подтверждению.
  if (raw !== null && record === null) {
    if (!confirmed) {
      return {
        conflict: {
          kind: 'foreign-dest',
          dest: entry.dest,
          src: entry.src,
          detail: { resolution: 'confirm' },
          message:
            `конфликт владения: "${entry.dest}" уже существует и не помечен как ` +
            'материализованный движком. Отказ вместо тихой перезаписи: подтверди ' +
            'этот dest поимённо или сними запись из frame',
        },
      };
    }
    confirmationUsed = true;
  }

  let content: string;
  try {
    content = format.stamp(format.strip(sourceContent), { src: entry.src });
  } catch (error) {
    if (error instanceof UnmarkableContentError) {
      return {
        confirmationUsed,
        conflict: {
          kind: 'unmarkable-dest',
          dest: entry.dest,
          src: entry.src,
          detail: { unmarkable: 'content-shape' },
          message: `владение "${entry.dest}" недоказуемо: ${error.message}`,
        },
      };
    }
    throw error;
  }

  const reason = transitionReason({ raw, content, record, entry });
  if (reason === null) {
    return { confirmationUsed };
  }

  return {
    confirmationUsed,
    step: {
      kind: raw === null ? 'create' : 'update',
      dest: entry.dest,
      reason,
      src: entry.src,
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
}

/**
 * Что произошло с артефактом — или `null`, если делать нечего.
 *
 * Сравнение ведётся по ТЕЛУ артефакта и по АКТУАЛЬНОСТИ ПРЕТЕНЗИИ. Второе —
 * обязательно и не сводится к первому: **служебная запись обязана утверждать
 * ровно то, что объявляет декларация сейчас, независимо от того, совпало
 * содержимое или нет.** Совпадение тела не повод пропустить приведение записи —
 * устаревшая претензия молча переживает смену объявления и всплывает потом
 * снятием не того файла.
 *
 * Первичное взятие непомеченного файла во владение — отдельное событие
 * (`adopted`), отличное от расхождения: гейт обязан показывать их по-разному.
 */
function transitionReason(input: TransitionInput): PlanReason | null {
  const { raw, content, record, entry } = input;

  if (raw === null) {
    return 'missing';
  }
  if (record === null) {
    return 'adopted';
  }
  // Порядок значим: если декларация сменила claim, первичное событие — именно
  // это, а не расхождение тела (тело разошлось ВСЛЕДСТВИЕ смены объявления).
  // Причина обязана быть правдой — на неё ветвятся гейт и панель.
  if (record.src !== entry.src) {
    return 'reclaimed';
  }
  // Сверяются и тело, и служебная строка целиком: маркер, разошедшийся с тем,
  // что движок записал бы сейчас, — это тоже расхождение, а не «мелочь».
  return raw !== content ? 'diverged' : null;
}

/**
 * Артефакт потерял объявление — снимается целиком.
 *
 * Развилки по классу владения здесь больше нет: всё, что несёт наш маркер,
 * материализовано движком и им же убирается. Файл, который должен пережить
 * снятие записи, — это форкнутый источник, а форк живёт снаружи движка.
 */
function planOrphan(tree: Tree, dest: string): PlanStep | null {
  const raw = tree.read(dest, 'utf-8');
  if (raw === null) {
    return null;
  }

  return {
    kind: 'delete',
    dest,
    reason: 'orphan',
    content: null,
    previous: raw,
  };
}

/**
 * Человекочитаемый рендер плана — ОДИН ИЗ выходов, а не источник.
 *
 * Ветвиться по этому тексту нельзя: решения принимаются по `status`, `kind`,
 * `reason` и `detail`.
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
