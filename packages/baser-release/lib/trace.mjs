/**
 * Трейсы прогона (perf-логи) гейта.
 *
 * Отвечают на вопрос «почему гейт ничего не сказал» ДАННЫМИ, а не на глаз.
 * Зелёный прогон гейта выглядит одинаково в двух разных случаях: когда версии
 * никто не двигал (сказать нечего) и когда пакет пропущен как невыпускаемый.
 * Разница между ними видна только в вердикте на каждый пакет — он и пишется
 * событием.
 *
 * Второй замер — цена похода в git: `release.breaking-scan` на пакет. Джоб
 * гейта стоит на каждом PR и держит выпуск, поэтому его время — это не
 * любопытство, а то, за чем следят: сегодня он укладывается в секунды ровно
 * потому, что не ставит зависимостей.
 *
 * Форма спана намеренно та же, что у трейсов движка (`имя · мс · detail`), —
 * язык один, хотя код общим быть не может: инструмент выпуска не тянет
 * зависимостей вовсе (иначе CI-джоб пришлось бы ставить перед прогоном).
 *
 * Трейс идёт в stderr и только по явной просьбе (`--trace`): stdout гейта —
 * это его «сказано», и подмешивать туда телеметрию значило бы ломать чтение.
 */

/**
 * @typedef {object} TraceSpan
 * @property {string} name
 * @property {number} ms
 * @property {Record<string, unknown>} [detail]
 */

/**
 * Приёмник замеров. Тот же интерфейс ждёт от наблюдателя суждение гейта —
 * поэтому подменить его пробой можно, ничего не собирая.
 *
 * @typedef {object} Trace
 * @property {(name: string, detail?: Record<string, unknown>) => void} event
 * @property {<T>(name: string, run: () => T, detail?: Record<string, unknown>) => T} span
 */

/**
 * @param {{now?: () => number, sink?: (span: TraceSpan) => void}} [options]
 * @returns {Trace & {snapshot: () => TraceSpan[]}}
 */
export function createTrace(options = {}) {
  const now = options.now ?? (() => performance.now());
  const sink = options.sink;
  /** @type {TraceSpan[]} */
  const spans = [];

  /** @param {TraceSpan} span */
  const push = (span) => {
    spans.push(span);
    sink?.(span);
  };

  return {
    /**
     * Замеряет синхронный этап и возвращает его результат.
     * @template T
     * @param {string} name
     * @param {() => T} run
     * @param {Record<string, unknown>} [detail]
     * @returns {T}
     */
    span(name, run, detail) {
      const started = now();
      try {
        return run();
      } finally {
        push({ name, ms: now() - started, ...(detail ? { detail } : {}) });
      }
    },

    /**
     * Отмечает событие без длительности (вердикты, счётчики).
     * @param {string} name
     * @param {Record<string, unknown>} [detail]
     */
    event(name, detail) {
      push({ name, ms: 0, ...(detail ? { detail } : {}) });
    },

    /** Снимок собранных замеров. */
    snapshot() {
      return [...spans];
    },
  };
}
