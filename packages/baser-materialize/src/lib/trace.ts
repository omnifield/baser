/**
 * Трейсы прогона (perf-логи).
 *
 * DoD зоны требует трейсов, а канон (`kb:BASER-3`, «цена паттерна А») прямо
 * называет marker-scan платой за корректность: скорость надо ВИДЕТЬ, а не
 * предполагать. Поэтому и план, и применение возвращают спаны с длительностями.
 *
 * Трейс — данные ВНЕ артефактов: он никогда не попадает в содержимое файлов,
 * иначе таймстемпы сломали бы инвариант идемпотентности (`kb:BASER-5` §1).
 */

/** Один замер: имя этапа, длительность в миллисекундах, произвольные детали. */
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
