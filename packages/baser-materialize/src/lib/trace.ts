/**
 * Трейсы прогона (perf-логи).
 *
 * DoD зоны требует трейсов, и требует не ради скорости одной: спаны отвечают на
 * вопрос «почему станок ничего не сделал» ДАННЫМИ. `plan.layout` несёт
 * `placedOnce` — сколько объявленных файлов не трогается по построению,
 * `plan.orphans` несёт `retained` — сколько записей потеряло объявление и
 * осталось у человека, `plan.owned` называет обвес, его версию и его долю
 * паспорта. В репозитории с несколькими инструментами это обязано быть видно в
 * телеметрии, а не выводиться на глаз по раскладке.
 *
 * Прежнее обоснование здесь было другим — «цена marker-scan», плата за проход по
 * дереву в поисках наклейки. Механизм снят вместе со сканом (`plan.ts` §3:
 * сироты ищутся по записям), и обоснование снято ВМЕСТЕ С ПРИЧИНОЙ, а не
 * подкручено под сохранившийся вывод.
 *
 * Трейс — данные ВНЕ артефактов: он никогда не попадает в содержимое файлов,
 * иначе таймстемпы сломали бы идемпотентность — инвариант §1 фазы плана
 * (`plan.ts`), который держится приёмкой зоны, а не соглашением.
 */

/** Один замер: имя этапа, длительность в миллисекундах, произвольные атрибуты. */
export interface TraceSpan {
  readonly name: string;
  readonly ms: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** Приёмник замеров; собирается движком и отдаётся наружу планом/отчётом. */
export interface TraceRecorder {
  /** Замеряет синхронный этап и возвращает его результат. */
  span<T>(name: string, run: () => T, detail?: Record<string, unknown>): T;
  /** Отмечает событие без длительности (счётчики, размеры). */
  event(name: string, detail?: Record<string, unknown>): void;
  /** Снимок собранных замеров. */
  snapshot(): readonly TraceSpan[];
}

export interface TraceOptions {
  /** Источник времени; подменяется в тестах ради детерминизма. */
  readonly now?: () => number;
  /** Куда стримить спаны по мере закрытия (perf-лог потребителя). */
  readonly sink?: (span: TraceSpan) => void;
}

/** Создаёт рекордер трейсов. По умолчанию время берётся из `performance.now()`. */
export function createTrace(options: TraceOptions = {}): TraceRecorder {
  const now = options.now ?? (() => performance.now());
  const sink = options.sink;
  const spans: TraceSpan[] = [];

  const push = (span: TraceSpan): void => {
    spans.push(span);
    sink?.(span);
  };

  return {
    span<T>(name: string, run: () => T, detail?: Record<string, unknown>): T {
      const started = now();
      try {
        return run();
      } finally {
        push({ name, ms: now() - started, ...(detail ? { detail } : {}) });
      }
    },
    event(name: string, detail?: Record<string, unknown>): void {
      push({ name, ms: 0, ...(detail ? { detail } : {}) });
    },
    snapshot(): readonly TraceSpan[] {
      return [...spans];
    },
  };
}
