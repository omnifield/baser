/**
 * Трейсы прогона (perf-логи) — телеметрия, а не печать в поток.
 *
 * DoD зоны требует трейсов, и здесь они отвечают на вопрос, который иначе
 * задаётся глазами: «почему `up` шёл восемь секунд». У магазина ровно два
 * дорогих этапа — старт чужого процесса и ОЖИДАНИЕ его первого ответа, — и они
 * разной природы: первый чинится машиной, второй настройкой. Слить их в одну
 * длительность значило бы отправить человека чинить не то.
 *
 * ФОРМА СПАНА ТА ЖЕ, ЧТО У СТАНКА (`@baser/materialize`, `trace.ts`):
 * имя, миллисекунды, атрибуты. Совпадение намеренное — телеметрию читает один
 * пульт, и второй формы для того же факта он не ждёт. А вот ЗАВИСИМОСТИ на
 * станок здесь нет: магазин ставится глобально (`npm i -g`), как git и
 * ассистент, и тянуть за собой станок материализации ради трёх полей значило бы
 * везти потребителю пол-производства ради типа. Форма скопирована сознательно и
 * названа здесь, чтобы следующий не принял это за случайное расхождение.
 *
 * РЕКОРДЕР АСИНХРОННЫЙ, и это не украшение: у станка спан замеряет чистую
 * функцию, а здесь под спаном живут `spawn`, HTTP-опрос и ожидание смерти
 * процесса. Синхронной формой их не обернуть, а замерять то, что успел до
 * `await`, — это замер, который врёт.
 */

/** Один замер: имя этапа, длительность в миллисекундах, произвольные атрибуты. */
export interface TraceSpan {
  readonly name: string;
  readonly ms: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** Приёмник замеров; собирается прогоном и уезжает в ответ. */
export interface TraceRecorder {
  /** Замеряет асинхронный этап и возвращает его результат. */
  span<T>(
    name: string,
    run: () => Promise<T> | T,
    detail?: Record<string, unknown>,
  ): Promise<T>;
  /** Отмечает событие без длительности (счётчики, размеры). */
  event(name: string, detail?: Record<string, unknown>): void;
  /** Снимок собранных замеров. */
  snapshot(): readonly TraceSpan[];
}

export interface TraceOptions {
  /** Источник времени; подменяется в пробах ради детерминизма. */
  readonly now?: () => number;
}

/** Создаёт рекордер трейсов. По умолчанию время берётся из `performance.now()`. */
export function createTrace(options: TraceOptions = {}): TraceRecorder {
  const now = options.now ?? (() => performance.now());
  const spans: TraceSpan[] = [];

  return {
    async span<T>(
      name: string,
      run: () => Promise<T> | T,
      detail?: Record<string, unknown>,
    ): Promise<T> {
      const started = now();
      try {
        return await run();
      } finally {
        spans.push({ name, ms: now() - started, ...(detail ? { detail } : {}) });
      }
    },
    event(name: string, detail?: Record<string, unknown>): void {
      spans.push({ name, ms: 0, ...(detail ? { detail } : {}) });
    },
    snapshot(): readonly TraceSpan[] {
      return [...spans];
    },
  };
}
