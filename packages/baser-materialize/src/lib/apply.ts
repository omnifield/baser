/**
 * ФАЗА 2 — ПРИМЕНЕНИЕ.
 *
 * Применение работает ТОЛЬКО с виртуальным деревом (`Tree`): запись в реальную
 * ФС — отдельная финальная фаза, и она не наша (её делает раннер/Nx, см. README).
 * Отсюда §2 контракта: «применение проходит целиком либо не проходит вовсе».
 *
 * Дерево — не транзакция само по себе: генераторы Nx мутируют его сразу —
 * сознательный размен самого Nx, ушедшего от `Rule` схематиков к прямым
 * side-effect'ам. Поэтому атомарность держится
 * журналом отката: прежнее состояние каждого затронутого файла снимается ДО
 * мутации, и при сбое на любом шаге дерево возвращается в исходное состояние.
 *
 * РЕЖИМ АРТЕФАКТА ПРИВОДИТСЯ ТЕМ ЖЕ ШАГОМ, ЧТО И ВСЁ ОСТАЛЬНОЕ
 * (`tasker:BASER2-214`, `tasker:BASER2-222`): вместе с содержимым у `create` и
 * `update`, отдельно и без содержимого — у `chmod`, где разошёлся только бит.
 * Журнал отката режима не хранит и не переигрывает: дерево, пережившее откат, на
 * диск не уезжает вовсе, и восстанавливать в нём нечего.
 */

import type { Tree } from './tree.js';
import { BaserMaterializeError } from './errors.js';
import type { MaterializationPlan, PlanConflict, PlanStep } from './plan.js';
import { isApplicable } from './plan.js';
import { serializeManifest } from './manifest.js';
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
  /** Куда легла служебная запись этого прогона. */
  readonly manifestPath: string;
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
  const ordered = inApplyOrder(plan.steps);
  const mode = { declared: 0, delivered: 0 };

  try {
    trace.span(
      'apply.steps',
      () => {
        for (const step of ordered) {
          current = step;
          journal.push({
            dest: step.dest,
            previous: tree.exists(step.dest)
              ? tree.read(step.dest, 'utf-8')
              : null,
          });

          if (step.kind === 'delete') {
            tree.delete(step.dest);
          } else if (step.kind === 'record') {
            // Содержимое артефакта шаг `record` не трогает вовсе: он про
            // служебную запись. Файл остаётся байт в байт тем же.
            continue;
          } else if (step.kind === 'chmod') {
            // РЕЖИМ БЕЗ СОДЕРЖИМОГО: файл уже такой, какой объявлен, разошёлся
            // только бит (`kb:BASER3-36`). Перезаписать содержимое «заодно»
            // было бы удобнее для раннера, но это неправда в плане и лишняя
            // запись на диск у потребителя.
            declareMode(tree, step, mode);
          } else {
            if (step.content === null) {
              throw new BaserMaterializeError(
                `шаг ${step.kind} "${step.dest}" без содержимого — план повреждён`,
              );
            }
            tree.write(step.dest, step.content);
            declareMode(tree, step, mode);
          }
        }
        current = null;
      },
      { steps: ordered.length },
    );

    // ЧТО СТАЛО С ОБЪЯВЛЕННЫМ РЕЖИМОМ — данными, а не по факту его отсутствия.
    // Событие есть ровно тогда, когда режим кто-то объявлял: прогон, где про
    // исполняемость не сказано ни слова, носить пустой счётчик не обязан
    // (так же условен `apply.manifest`).
    //
    // `port: "blind"` — раннер про режим не знает, объявленное до диска не
    // доехало. Это НЕ отказ применения: приёмка требует, чтобы такой раннер
    // продолжал работать (`tasker:BASER2-214`). Но и не молчание: молчаливое
    // расхождение «объявлено исполняемым» и «лежит неисполняемым» — то самое,
    // из-за чего форма 6 вообще появилась (`tasker:BASER2-208`).
    if (mode.declared > 0) {
      trace.event('apply.executable', {
        ...mode,
        port: tree.setExecutable === undefined ? 'blind' : 'accepts',
      });
    }

    // Служебная запись приводится ПОСЛЕДНЕЙ и одной записью целиком: манифест,
    // обновлённый до артефактов, соврал бы про состояние, если бы применение
    // сорвалось на середине. Он же участвует в журнале отката — иначе откат
    // вернул бы файлы, но оставил запись о том, чего на диске нет.
    if (ordered.length > 0) {
      trace.span('apply.manifest', () => {
        journal.push({
          dest: plan.manifestPath,
          previous: tree.exists(plan.manifestPath)
            ? tree.read(plan.manifestPath, 'utf-8')
            : null,
        });
        writeManifest(tree, plan);
      });
    }
  } catch (cause) {
    trace.span('apply.rollback', () => rollback(tree, journal), {
      entries: journal.length,
    });
    throw new MaterializationApplyError(current ?? ordered[0], { cause });
  }

  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    applied: ordered,
    manifestPath: plan.manifestPath,
    trace: trace.snapshot(),
  };
}

/**
 * Доносит режим до порта — то, что шаг про бит уже решил.
 *
 * РЕШЕНИЕ ПРИНЯТО В ПЛАНЕ, здесь оно только исполняется: поле `executable` есть
 * ровно тогда, когда с битом надо что-то сделать (`plan.ts`, `modeOf` — таблица
 * `kb:BASER3-36` §2). Шаг без поля порта не касается вовсе, и это тот самый
 * случай «объявлено `false`, следа нет»: снимать нечего, а чужой бит — чужое
 * состояние.
 *
 * ЗОВЁТСЯ И БЕЗ ЗАПИСИ СОДЕРЖИМОГО — у шага `chmod`. Раньше режим ехал только
 * вместе с содержимым, и раннеру хватало держать его при записи; теперь порт
 * обязан уметь привести бит файла, которого этот прогон не пишет (`tree.ts`,
 * `setExecutable`).
 *
 * Раннер, не знающий про режим, работает как работал: член порта необязателен,
 * и его отсутствие — не сбой шага, а факт про раннера. Факт этот СЧИТАЕТСЯ и
 * уезжает в трейс: разница между `declared` и `delivered` и есть ответ на
 * «объявили исполняемым, а лежит обычным».
 */
function declareMode(
  tree: Tree,
  step: PlanStep,
  mode: { declared: number; delivered: number },
): void {
  if (step.executable === undefined) {
    return;
  }

  mode.declared += 1;
  if (tree.setExecutable === undefined) {
    return;
  }

  tree.setExecutable(step.dest, step.executable);
  mode.delivered += 1;
}

/**
 * Кладёт манифест — либо снимает его, если класть больше нечего.
 *
 * Пустой манифест не остаётся файлом: репозиторий, из которого убрали все
 * обвесы, не должен носить служебный огрызок, объявляющий ноль артефактов.
 */
function writeManifest(tree: Tree, plan: MaterializationPlan): void {
  if (plan.manifest.length === 0) {
    if (tree.exists(plan.manifestPath)) {
      tree.delete(plan.manifestPath);
    }
    return;
  }

  tree.write(
    plan.manifestPath,
    serializeManifest(new Map(plan.manifest.map((item) => [item.dest, item]))),
  );
}

/**
 * Порядок применения: СНАЧАЛА СНЯТИЯ, потом записи.
 *
 * Порядок в самом плане — байтовый по `dest`, потому что это контракт вывода с
 * пультом, а не программа действий. Но на дереве порядок значим: артефакт,
 * переобъявленный из файла в каталог (`cfg.yml` → `cfg.yml/inner.yml`),
 * освобождает путь именно шагом снятия — выполнив запись первой, движок
 * упёрся бы в занятый путь и уронил бы применение там, где план сходится.
 *
 * Внутри каждой группы порядок плана сохраняется: детерминизм вывода
 * детерминизмом же и применяется.
 */
function inApplyOrder(steps: readonly PlanStep[]): readonly PlanStep[] {
  return [
    ...steps.filter((step) => step.kind === 'delete'),
    ...steps.filter((step) => step.kind !== 'delete'),
  ];
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
