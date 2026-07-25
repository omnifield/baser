/**
 * ФАЗА 1 — ПЛАН.
 *
 * План — это ДАННЫЕ, а не побочка: он вычисляется и читается ДО применения
 * (`kb:BASER-5` «две фазы»; рынок подтвердил разрыв дважды независимо —
 * `nx migrate` разносит его на две команды, схематики — на две фазы).
 *
 * Инварианты, за которые отвечает именно эта фаза:
 *   §1 идемпотентность — сошедшийся артефакт НЕ порождает шага, поэтому второй
 *      прогон даёт пустой план (операционное определение сходимости из IaC);
 *   §3 отсутствие сирот — артефакт с нашим маркером, потерявший запись в
 *      `frame`, попадает в план на снятие;
 *   §4 отказ вместо тихой перезаписи — конфликт владения попадает в
 *      `conflicts`, а не в `steps`, и назван человеческим текстом;
 *   §5 показать расхождение — каждый шаг несёт `previous`, чтобы раннер мог
 *      показать разницу и архитектор мог принять решение `align`.
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
  OwnershipRecord,
  ScanOptions,
} from './ownership.js';
import {
  UnmarkableContentError,
  markerFormatFor,
  scanOwnership,
} from './ownership.js';
import type { TraceRecorder, TraceSpan } from './trace.js';
import { createTrace } from './trace.js';

export type PlanStepKind = 'create' | 'update' | 'delete' | 'release';

export type PlanReason = 'missing' | 'diverged' | 'orphan' | 'adopted';

/** Один шаг плана. `content === null` только у снятия артефакта. */
export interface PlanStep {
  readonly kind: PlanStepKind;
  readonly dest: string;
  readonly reason: PlanReason;
  readonly src?: string;
  readonly mode?: MaterializeMode;
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
  /** Класс файла не может нести маркер владения — доказать владение нечем. */
  | 'unmarkable-dest'
  /** Источник `src` не найден под `contentRoot`. */
  | 'missing-source'
  /** Для режима записи не зарегистрирована стратегия. */
  | 'unknown-mode'
  /** Отказ на уровне режима. */
  | 'strategy';

export interface PlanConflict {
  readonly kind: ConflictKind;
  readonly dest: string;
  readonly src?: string;
  readonly mode?: MaterializeMode;
  /** Человекочитаемое объяснение: что отклонено и почему. */
  readonly message: string;
}

export interface MaterializationPlan {
  readonly steps: readonly PlanStep[];
  readonly conflicts: readonly PlanConflict[];
  /** Нечего делать. Второй прогон обязан давать `true` (§1 контракта). */
  readonly empty: boolean;
  /** Применим ли план: конфликт означает отказ, а не частичное применение. */
  readonly applicable: boolean;
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
   * Забрать владение силой (семантика `--force-conflicts` из Kubernetes SSA).
   * Отдельное ЯВНОЕ действие: по умолчанию конфликт = отказ (§4 контракта).
   */
  readonly force?: boolean;
  readonly scan?: ScanOptions;
  readonly trace?: TraceRecorder;
}

/** Вычисляет план материализации. Дерево при этом НЕ меняется. */
export function computePlan(options: PlanOptions): MaterializationPlan {
  const { tree, declaration } = options;
  const trace = options.trace ?? createTrace();
  const registry = toStrategyRegistry(options.strategies);
  const source =
    options.source ?? createTreeSource(tree, declaration.contentRoot);
  const baseline = options.baseline ?? EMPTY_BASELINE;

  const steps: PlanStep[] = [];
  const conflicts: PlanConflict[] = [];
  const claimed = new Map<string, FrameEntry>();

  trace.span(
    'plan.frame',
    () => {
      for (const entry of declaration.frame) {
        const previousClaim = claimed.get(entry.dest);
        if (previousClaim !== undefined) {
          // Спорный артефакт не получает шага вовсе: у файла под двойной
          // претензией нет решённого целевого состояния — есть только отказ.
          const planned = steps.findIndex((step) => step.dest === entry.dest);
          if (planned >= 0) {
            steps.splice(planned, 1);
          }
          conflicts.push({
            kind: 'duplicate-dest',
            dest: entry.dest,
            src: entry.src,
            mode: entry.mode,
            message:
              `конфликт владения: "${entry.dest}" объявлен дважды ` +
              `(src "${previousClaim.src}" и src "${entry.src}") — ` +
              'у артефакта может быть только одна запись frame',
          });
          continue;
        }
        claimed.set(entry.dest, entry);

        const conflictOrStep = planEntry(entry, {
          tree,
          declaration,
          registry,
          source,
          baseline,
          force: options.force === true,
        });

        if (conflictOrStep === null) {
          continue;
        }
        if (isConflict(conflictOrStep)) {
          conflicts.push(conflictOrStep);
        } else {
          steps.push(conflictOrStep);
        }
      }
    },
    { entries: declaration.frame.length },
  );

  const owned = trace.span('plan.scan-ownership', () =>
    scanOwnership(tree, options.scan),
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

  return {
    steps,
    conflicts,
    empty: steps.length === 0,
    applicable: conflicts.length === 0,
    trace: trace.snapshot(),
  };
}

interface EntryContext {
  readonly tree: Tree;
  readonly declaration: Declaration;
  readonly registry: StrategyRegistry;
  readonly source: CanonSource;
  readonly baseline: CanonBaseline;
  readonly force: boolean;
}

function planEntry(
  entry: FrameEntry,
  context: EntryContext,
): PlanStep | PlanConflict | null {
  const { tree, registry, source, baseline, declaration, force } = context;

  const strategy = registry.get(entry.mode);
  if (strategy === undefined) {
    return {
      kind: 'unknown-mode',
      dest: entry.dest,
      src: entry.src,
      mode: entry.mode,
      message:
        `режим "${entry.mode}" не реализован: стратегия не зарегистрирована ` +
        `(доступны: ${registry.modes.join(', ') || 'ни одной'}) — ` +
        'режимы поставляет @omnifield/baser-modes',
    };
  }

  const sourceContent = source.read(entry.src);
  if (sourceContent === null) {
    return {
      kind: 'missing-source',
      dest: entry.dest,
      src: entry.src,
      mode: entry.mode,
      message: `источник "${source.describe(entry.src)}" не найден — материализовать нечего`,
    };
  }

  const needsMarker = strategy.ownership !== 'product';
  const format = markerFormatFor(entry.dest);
  if (needsMarker && format === null) {
    return {
      kind: 'unmarkable-dest',
      dest: entry.dest,
      src: entry.src,
      mode: entry.mode,
      message:
        `владение "${entry.dest}" недоказуемо: класс файла не несёт маркер, ` +
        `а режим "${entry.mode}" требует владения (${strategy.ownership}) — ` +
        'движок не берёт файл во владение молча',
    };
  }

  const raw = tree.exists(entry.dest) ? tree.read(entry.dest, 'utf-8') : null;
  const record = raw !== null && format !== null ? format.parse(raw) : null;
  const owned = record !== null;

  if (strategy.ownership === 'engine' && raw !== null && !owned && !force) {
    return {
      kind: 'foreign-dest',
      dest: entry.dest,
      src: entry.src,
      mode: entry.mode,
      message:
        `конфликт владения: "${entry.dest}" уже существует и не помечен как ` +
        `материализованный движком, а режим "${entry.mode}" требует единоличного владения. ` +
        'Отказ вместо тихой перезаписи: прими файл в канон осознанно (force) ' +
        'или сними запись из frame',
    };
  }

  const decision = strategy.decide({
    entry,
    declaration,
    source: sourceContent,
    current: raw === null ? null : format !== null ? format.strip(raw) : raw,
    baseline: baseline.read(entry.src),
    owned,
    record,
  });

  if (decision.kind === 'keep') {
    return null;
  }
  if (decision.kind === 'conflict') {
    return {
      kind: 'strategy',
      dest: entry.dest,
      src: entry.src,
      mode: entry.mode,
      message: `режим "${entry.mode}" отказал по "${entry.dest}": ${decision.reason}`,
    };
  }

  let content: string;
  try {
    content = stampIfNeeded(
      decision.content,
      entry,
      strategy.ownership,
      needsMarker ? format : null,
    );
  } catch (error) {
    if (error instanceof UnmarkableContentError) {
      return {
        kind: 'unmarkable-dest',
        dest: entry.dest,
        src: entry.src,
        mode: entry.mode,
        message: `владение "${entry.dest}" недоказуемо: ${error.message}`,
      };
    }
    throw error;
  }

  if (raw === content) {
    return null;
  }

  return {
    kind: raw === null ? 'create' : 'update',
    dest: entry.dest,
    reason: raw === null ? 'missing' : owned || !force ? 'diverged' : 'adopted',
    src: entry.src,
    mode: entry.mode,
    content,
    previous: raw,
  };
}

function stampIfNeeded(
  content: string,
  entry: FrameEntry,
  own: OwnershipRecord['own'],
  format: MarkerFormat | null,
): string {
  if (format === null) {
    return content;
  }
  return format.stamp(format.strip(content), {
    src: entry.src,
    mode: entry.mode,
    own,
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
    content: released,
    previous: raw,
  };
}

function isConflict(value: PlanStep | PlanConflict): value is PlanConflict {
  return 'message' in value;
}

/** Человекочитаемый план — он обязан быть читаемым ДО применения. */
export function describePlan(plan: MaterializationPlan): string {
  const lines: string[] = [];

  if (plan.empty) {
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

  return lines.join('\n');
}
