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
 *      `layout`, попадает в план на снятие;
 *   §4 отказ вместо тихой перезаписи — конфликт владения попадает в
 *      `conflicts`, а не в `steps`, и делает план неприменимым;
 *   §5 показать расхождение — каждый шаг несёт `previous`, чтобы раннер мог
 *      показать разницу, а план — НАЗВАТЬ ПОТЕРИ до применения.
 */

import type { Tree } from '@nx/devkit';
import type { Declaration, LayoutEntry } from './declaration.js';
import type { CanonSource } from './source.js';
import { createTreeSource } from './source.js';
import { DeclarationError } from './errors.js';
import type { OwnershipRecord, ScanOptions } from './ownership.js';
import {
  DEFAULT_SCAN_IGNORE,
  UnmarkableContentError,
  markerFormatFor,
  scanOwnership,
} from './ownership.js';
import type { TraceRecorder, TraceSpan } from './trace.js';
import { createTrace } from './trace.js';
import {
  byBytes,
  joinRepoPath,
  normalizeRepoPath,
  REPO_PATH_PROBLEM,
  toRepoPath,
} from './paths.js';
import type { RepoPathProblem } from './paths.js';
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
  /** Артефакт потерял объявление в `layout`. */
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
  /** Две записи `layout` претендуют на один `dest`. */
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
  | 'missing-source'
  /**
   * Путь записи раскладки непригоден: пуст, абсолютен или выходит за корень
   * дерева. Границу дерева движок держит сам — он тот, кто пишет.
   */
  | 'invalid-path'
  /**
   * Обработка ЭТОЙ записи сорвалась исключением (битый порт источника, сбойное
   * дерево). Отказ привязан к своему `dest`: сбой на одной записи не имеет
   * права уносить план целиком.
   */
  | 'entry-failed';

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
  readonly resolution?: 'confirm' | 'drop-layout-entry';
  /** `unreachable-dest`: путь, который занят файлом и перекрывает `dest`. */
  readonly blockedBy?: string;
  /** `unreachable-dest`: чем именно занят перекрывающий путь. */
  readonly collision?: 'declared-dest' | 'existing-file' | 'existing-directory';
  /** `dest-in-content-root`: корень содержимого источника из декларации. */
  readonly contentRoot?: string;
  /** `unmarkable-dest`: почему маркер невозможен. */
  readonly unmarkable?: 'no-format-for-class' | 'content-shape';
  /** `entry-failed`: сообщение исключения, сорвавшего обработку записи. */
  readonly failure?: string;
  /** `invalid-path`: какое поле записи непригодно. */
  readonly field?: 'src' | 'dest';
  /** `invalid-path`: сам путь, как он пришёл. */
  readonly path?: string;
  /** `invalid-path`: чем именно путь непригоден. */
  readonly pathProblem?: RepoPathProblem;
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

/**
 * Годен ли вход движку — и ТОЛЬКО это.
 *
 * Форму декларации разбирает дверь (валидаторы объявления, настроек, пресетов,
 * столкновений — зона контрактов). Здесь проверяется не форма, а **пригодность
 * входа для работы движка**: без раскладки и без корня содержимого он не может
 * ни прочитать шаблон, ни защитить собственный источник.
 *
 * Отвечать на это планом не за что: план строится ПО декларации, а её нет.
 * Поэтому исключение — но названное, а не `TypeError` из недр (`BASER2-16`, Д14:
 * отказ обязан быть внятным, где бы он ни возник).
 */
function requireUsableDeclaration(declaration: Declaration): void {
  const shape = (problem: string): never => {
    throw new DeclarationError(
      `движку подана структура не той формы: ${problem}. ` +
        'Собрать вход из объявления обвеса и конфига потребителя — забота двери',
    );
  };

  if (typeof declaration !== 'object' || declaration === null) {
    shape('ожидался объект { source, layout }');
  }
  if (!Array.isArray(declaration.layout)) {
    shape('layout — ожидался массив записей { src, dest }');
  }
  if (
    typeof declaration.source !== 'object' ||
    declaration.source === null ||
    typeof declaration.source.contentRoot !== 'string'
  ) {
    shape('source.contentRoot — ожидалась строка с корнем содержимого');
  }

  // Вырожденный корень («.», «/», пустая строка) означает, что источником
  // объявлено ВСЁ дерево. Тогда защита «движок не пишет в собственный источник»
  // отваливается — `isInside` от такого корня ложна, — и прогон затирает
  // шаблон, из которого сам же читает. Отказ вместо тихой порчи источника.
  if (!toRepoPath(declaration.source.contentRoot).ok) {
    throw new DeclarationError(
      `корень содержимого "${declaration.source.contentRoot}" непригоден: ` +
        'источником объявлено бы всё дерево, и движок писал бы поверх ' +
        'собственных шаблонов. Нужен путь к каталогу шаблонов внутри пакета',
    );
  }
}

/** Вычисляет план материализации. Дерево при этом НЕ меняется. */
export function computePlan(options: PlanOptions): MaterializationPlan {
  const { tree, declaration } = options;
  requireUsableDeclaration(declaration);
  const trace = options.trace ?? createTrace();
  const source =
    options.source ?? createTreeSource(tree, declaration.source.contentRoot);

  const confirm = new Set(
    (options.confirm ?? []).map((dest, index) =>
      normalizeRepoPath(dest, `confirm[${index}]`),
    ),
  );
  const consumed = new Set<string>();

  const steps: PlanStep[] = [];
  const conflicts: PlanConflict[] = [];
  let notices: PlanNotice[] = [];
  const claimed = new Map<string, LayoutEntry>();
  /** Каталог пути → `dest`, ради которого он обязан быть каталогом. */
  const claimedDirs = new Map<string, string>();

  // Объявленные цели — в каноничной форме и без непригодных: дальше по ним
  // и сверяется скан, и считаются сироты, поэтому написание должно быть одно.
  const declaredDests = new Set(
    declaration.layout
      .map((entry) => toRepoPath(entry?.dest as string))
      .filter((path): path is { ok: true; path: string } => path.ok)
      .map((path) => path.path),
  );

  // Скан владения идёт ДО обхода `layout`: сироты нужны уже на проверке
  // достижимости — путь, занятый файлом, который этот же план снимает, не
  // является препятствием.
  const scan = trace.span('plan.scan-ownership', () =>
    scanOwnership(tree, {
      ...options.scan,
      // Объявленные `dest` всегда в зоне видимости скана, каким бы ни был
      // список пропуска: собственный артефакт не имеет права стать невидимым.
      declared: [...(options.scan?.declared ?? []), ...declaredDests],
      // Источник шаблонов скан не просматривает: движок туда не пишет
      // (`dest-in-content-root`), значит и снимать оттуда не вправе.
      exclude: [
        ...(options.scan?.exclude ?? []),
        declaration.source.contentRoot,
      ],
    }),
  );
  const owned = scan.owned;
  trace.event('plan.owned', {
    files: owned.size,
    ...(scan.failures.length > 0 ? { failed: scan.failures.length } : {}),
  });

  // Файл, который скан не смог прочитать, — не «его нет»: движок не знает,
  // наш он или нет, и обязан сказать это адресно, а не пропустить молча.
  const failedDests = new Set<string>();
  for (const failure of scan.failures) {
    failedDests.add(failure.path);
    conflicts.push(entryFailed(failure.path, undefined, failure.cause));
  }

  /** Наши артефакты, которые этот прогон снимает: они освобождают свой путь. */
  const removed = new Set(
    [...owned.keys()].filter((dest) => !declaredDests.has(dest)),
  );

  trace.span(
    'plan.layout',
    () => {
      for (const declared of declaration.layout) {
        // Пути приводятся к каноничной форме ЗДЕСЬ, а не там, где их читали:
        // читать движку больше нечего, а сверять объявленный `dest` с путями
        // из скана он обязан в одном написании — иначе свежесозданный артефакт
        // окажется сиротой сам себе.
        const entry = repoPathsOf(declared);
        if (entry === null) {
          conflicts.push(invalidPath(declared));
          continue;
        }

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
              'у артефакта может быть только одна запись layout',
          });
          continue;
        }
        // Сбой на ОДНОЙ записи не имеет права уносить план целиком: порт
        // источника и дерево приходят снаружи движка и могут бросить что
        // угодно. Отказ привязывается к своему `dest` — соседние записи
        // планируются как обычно (с несколькими источниками это уже не
        // удобство, а требование: битый шаблон одного поставщика не должен
        // гасить материализацию всех остальных).
        try {
          const unreachable = reachabilityConflict(entry, {
            tree,
            contentRoot: declaration.source.contentRoot,
            claimed,
            claimedDirs,
            removed,
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
        } catch (cause) {
          // Тот же файл мог сорвать и скан — отказ по нему уже назван, второй
          // раз называть его незачем: это один и тот же сбой одного артефакта.
          if (!failedDests.has(entry.dest)) {
            failedDests.add(entry.dest);
            conflicts.push(entryFailed(entry.dest, entry.src, cause));
          }
        }
      }
    },
    { entries: declaration.layout.length },
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
        : `подтверждение по "${dest}" ни к чему не относится: такой записи нет в layout`,
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
      try {
        const step = planOrphan(tree, dest);
        if (step !== null) {
          steps.push(step);
        }
      } catch (cause) {
        conflicts.push(entryFailed(dest, owned.get(dest)?.src, cause));
      }
    }
  });

  // Порядок вывода БАЙТОВЫЙ, а не локале-зависимый: схема вывода — контракт с
  // пультом, и порядок в нём не имеет права плавать по ICU и локали процесса.
  steps.sort((left, right) => byBytes(left.dest, right.dest));
  conflicts.sort((left, right) => byBytes(left.dest, right.dest));
  notices.sort((left, right) => byBytes(left.dest ?? '', right.dest ?? ''));

  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    status: statusOf(steps, conflicts),
    steps,
    conflicts,
    notices,
    trace: trace.snapshot(),
  };
}

/**
 * Каноничная запись раскладки; `null` — путь непригоден.
 *
 * Возвращается новая запись, а не мутируется входная: структура приходит
 * снаружи, и движок её не переписывает.
 */
function repoPathsOf(entry: LayoutEntry): LayoutEntry | null {
  const src = toRepoPath(entry?.src as string);
  const dest = toRepoPath(entry?.dest as string);
  return src.ok && dest.ok ? { src: src.path, dest: dest.path } : null;
}

/**
 * Отказ по записи, чей путь непригоден: пуст, абсолютен или выходит за корень.
 *
 * Границу дерева движок держит САМ, даже получая структуру от двери: он и есть
 * тот, кто пишет. Отказ — план, а не исключение: одна кривая запись не имеет
 * права уносить прогон, остальные планируются как обычно.
 */
function invalidPath(entry: LayoutEntry): PlanConflict {
  const src = toRepoPath(entry?.src as string);
  const dest = toRepoPath(entry?.dest as string);
  const field = dest.ok ? 'src' : 'dest';
  const problem = (dest.ok ? src : dest) as {
    ok: false;
    problem: RepoPathProblem;
  };
  const value = String(field === 'dest' ? entry?.dest : entry?.src);

  return {
    kind: 'invalid-path',
    dest: String(entry?.dest),
    src: String(entry?.src),
    detail: { field, path: value, pathProblem: problem.problem },
    message:
      `запись раскладки непригодна: ${field} "${value}" — ` +
      `${REPO_PATH_PROBLEM[problem.problem]}`,
  };
}

/**
 * Отказ по записи, обработка которой сорвалась исключением.
 *
 * Сбой НЕ проглатывается и НЕ превращается в шаг: он попадает в конфликты, то
 * есть план становится неприменимым целиком. Право уносить прогон
 * `TypeError`'ом из недр движка при этом снимается — потребитель получает
 * машинный код и адрес, а не стек.
 */
function entryFailed(
  dest: string,
  src: string | undefined,
  cause: unknown,
): PlanConflict {
  const failure = cause instanceof Error ? cause.message : String(cause);
  return {
    kind: 'entry-failed',
    dest,
    ...(src === undefined ? {} : { src }),
    detail: { failure },
    message:
      `обработка "${dest}" сорвалась: ${failure} — отказ привязан к этой записи, ` +
      'остальные спланированы как обычно; план целиком неприменим',
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
  readonly claimed: ReadonlyMap<string, LayoutEntry>;
  readonly claimedDirs: ReadonlyMap<string, string>;
  /** Наши артефакты, которые этот же план снимает. */
  readonly removed: ReadonlySet<string>;
}

/**
 * Достижимо ли объявленное состояние ТАМ, ГДЕ АРТЕФАКТЫ В ИТОГЕ ЖИВУТ.
 *
 * Атомарность движка кончается на виртуальном дереве: сброс на реальную ФС
 * делает раннер, и его сбой происходит уже ВНЕ журнала отката. Поэтому всё, что
 * упадёт при записи на диск, обязано быть поймано планом. Дерево Nx терпит файл
 * и каталог с одним путём одновременно — файловая система не терпит, и эталон
 * реальности здесь она, а не дерево.
 *
 * ПРЕПЯТСТВИЕ СНИМАЕТ ТОЛЬКО СОБСТВЕННЫЙ ШАГ УДАЛЕНИЯ. Путь, занятый нашим же
 * артефактом, который этот план снимает как сироту, перекрывать `dest` не
 * может: иначе штатная миграция «файл стал каталогом» блокирует сама себя —
 * план СОДЕРЖИТ снятие мешающего файла и одновременно объявляет состояние
 * недостижимым, применение отклоняется целиком, дерево не меняется, следующий
 * прогон даёт то же самое. Дедлок, снимаемый только руками по ФС.
 *
 * Правило намеренно узкое. Движок НЕ моделирует гипотетическое дерево «после
 * применения» — он смотрит ровно на один факт: есть ли в этом плане шаг
 * удаления этого пути. Файл, который остаётся лежать законно (чужой или
 * по-прежнему объявленный), продолжает мешать законно.
 */
function reachabilityConflict(
  entry: LayoutEntry,
  context: ReachabilityContext,
): PlanConflict | null {
  const { tree, contentRoot, claimed, claimedDirs, removed } = context;

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
    if (
      tree.exists(ancestor) &&
      tree.isFile(ancestor) &&
      !removed.has(ancestor)
    ) {
      return unreachable(entry, ancestor, 'existing-file');
    }
  }

  const blockedDest = claimedDirs.get(entry.dest);
  if (blockedDest !== undefined) {
    return unreachable(entry, blockedDest, 'declared-dest');
  }

  // Симметричный случай: сам `dest` уже занят КАТАЛОГОМ. Контракт его отдельно
  // не перечисляет, но правило то же — файл на месте каталога не создать, и
  // упадёт это опять при сбросе на диск, вне журнала отката. Каталог, ВСЁ
  // содержимое которого снимается этим же планом, препятствием не является: от
  // него не остаётся ничего, что мешало бы.
  if (
    tree.exists(entry.dest) &&
    !tree.isFile(entry.dest) &&
    !isEmptiedBy(tree, entry.dest, removed)
  ) {
    return unreachable(entry, entry.dest, 'existing-directory');
  }

  return null;
}

/** Останется ли от каталога хоть что-то после снятия наших сирот. */
function isEmptiedBy(
  tree: Tree,
  directory: string,
  removed: ReadonlySet<string>,
): boolean {
  const queue = [directory];
  while (queue.length > 0) {
    const dir = queue.pop() as string;
    for (const child of tree.children(dir)) {
      const path = joinRepoPath(dir, child);
      if (tree.isFile(path)) {
        if (!removed.has(path)) {
          return false;
        }
      } else {
        queue.push(path);
      }
    }
  }
  return true;
}

const COLLISION_CAUSE: Record<
  'declared-dest' | 'existing-file' | 'existing-directory',
  string
> = {
  'declared-dest': 'путь занят файлом, объявленным другой записью layout',
  'existing-file': 'путь занят файлом, который уже лежит в дереве',
  'existing-directory': 'путь занят каталогом, который уже лежит в дереве',
};

function unreachable(
  entry: LayoutEntry,
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

/** Исход одной записи `layout`: не более одного шага, отказа и извещения. */
interface EntryOutcome {
  readonly step?: PlanStep;
  readonly conflict?: PlanConflict;
  readonly notice?: PlanNotice;
  /** Подтверждение по этому `dest` пригодилось: отказ снят именно им. */
  readonly confirmationUsed?: boolean;
}

/**
 * Целевое состояние одной записи `layout`.
 *
 * Здесь нет развилки по режиму и нет вопроса «каким должно быть содержимое»:
 * содержимое артефакта — это содержимое шаблона целиком (`kb:BASER2-2`).
 * Единственное, что движок решает, — можно ли трогать существующий файл и
 * требуется ли шаг.
 */
function planEntry(entry: LayoutEntry, context: EntryContext): EntryOutcome {
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
            'этот dest поимённо или сними запись из layout',
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
  readonly entry: LayoutEntry;
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
