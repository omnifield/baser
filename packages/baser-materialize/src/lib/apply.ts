/**
 * ФАЗА 2 — ПРИМЕНЕНИЕ.
 *
 * Применение работает ТОЛЬКО с виртуальным деревом (`Tree`): запись в реальную
 * ФС — отдельная финальная фаза, и она не наша (её делает раннер/Nx, см. README).
 * Отсюда §2 контракта: «применение проходит целиком либо не проходит вовсе».
 *
 * Дерево — не транзакция само по себе: генераторы Nx мутируют его сразу
 * (`kb:BASER-3`, «сознательный размен у Nx»). Поэтому атомарность держится
 * журналом отката: прежнее состояние каждого затронутого файла снимается ДО
 * мутации, и при сбое на любом шаге дерево возвращается в исходное состояние.
 */

import type { Tree } from '@nx/devkit';
import { BaserMaterializeError } from './errors.js';
import type { MaterializationPlan, PlanConflict, PlanStep } from './plan.js';
import { isApplicable } from './plan.js';
import type { TraceRecorder, TraceSpan } from './trace.js';
import { createTrace } from './trace.js';
import { OUTPUT_SCHEMA_VERSION } from './schema.js';

/** План содержит конфликты владения — применение отклонено целиком. */
export class MaterializationConflictError extends BaserMaterializeError {
  constructor(readonly conflicts: readonly PlanConflict[]) {
    super(
      `материализация отклонена: конфликтов владения — ${conflicts.length}\n` +
        conflicts
          .map((conflict) => `  - ${conflict.dest}: ${conflict.message}`)
          .join('\n'),
    );
  }
}

/** Сбой на шаге применения; дерево к этому моменту уже откачено. */
export class MaterializationApplyError extends BaserMaterializeError {
  constructor(
    readonly step: PlanStep,
    options: { cause?: unknown },
  ) {
    super(
      `сбой применения на шаге ${step.kind} "${step.dest}" — дерево откачено ` +
        'в состояние до применения (полуобновлённого дерева не бывает)',
      options,
    );
  }
}

export interface ApplyOptions {
  readonly trace?: TraceRecorder;
}

export interface ApplyReport {
  /** Версия схемы вывода — тот же контракт с панелью, что и у плана. */
  readonly schemaVersion: number;
  readonly applied: readonly PlanStep[];
  readonly trace: readonly TraceSpan[];
}

interface JournalEntry {
  readonly dest: string;
  readonly previous: string | null;
}

/**
 * Применяет план к дереву.
 *
 * @throws MaterializationConflictError если план неприменим (конфликт владения)
 * @throws MaterializationApplyError если шаг упал; дерево откачено
 */
export function applyPlan(
  tree: Tree,
  plan: MaterializationPlan,
  options: ApplyOptions = {},
): ApplyReport {
  const trace = options.trace ?? createTrace();

  if (!isApplicable(plan)) {
    throw new MaterializationConflictError(plan.conflicts);
  }

  const journal: JournalEntry[] = [];
  let current: PlanStep | null = null;

  try {
    trace.span(
      'apply.steps',
      () => {
        for (const step of plan.steps) {
          current = step;
          journal.push({
            dest: step.dest,
            previous: tree.exists(step.dest)
              ? tree.read(step.dest, 'utf-8')
              : null,
          });

          if (step.kind === 'delete') {
            tree.delete(step.dest);
          } else {
            if (step.content === null) {
              throw new BaserMaterializeError(
                `шаг ${step.kind} "${step.dest}" без содержимого — план повреждён`,
              );
            }
            tree.write(step.dest, step.content);
          }
        }
        current = null;
      },
      { steps: plan.steps.length },
    );
  } catch (cause) {
    trace.span('apply.rollback', () => rollback(tree, journal), {
      entries: journal.length,
    });
    throw new MaterializationApplyError(current ?? plan.steps[0], { cause });
  }

  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    applied: plan.steps,
    trace: trace.snapshot(),
  };
}

function rollback(tree: Tree, journal: readonly JournalEntry[]): void {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index];
    if (entry.previous === null) {
      if (tree.exists(entry.dest)) {
        tree.delete(entry.dest);
      }
    } else {
      tree.write(entry.dest, entry.previous);
    }
  }
}
