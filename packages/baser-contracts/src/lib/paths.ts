/**
 * Пути внутри объявления: `contentRoot`, `src`, `dest`.
 *
 * **Это не дубль проверки движка.** Движок проверяет пути потому, что ПИШЕТ
 * ими в дерево, — граница дерева его собственная, и держать её за него нельзя
 * (инвариант, который держит только соседняя зона, — не инвариант). Здесь
 * проверка про другое: про ПРИГОДНОСТЬ ОБЪЯВЛЕНИЯ. Обвес, объявивший
 * `dest: "/etc/hosts"`, непригоден сам по себе, и сказать ему об этом надо в тот
 * момент, когда разбирают его объявление, а не когда движок откажется писать.
 *
 * Нормализация здесь же по третьей причине: `dest` — единица владения и ключ, по
 * которому ловится столкновение двух поставщиков (`kb:BASER2-6`). Разъехавшись в
 * написании, `./a.json` и `a.json` разошлись бы и как ключи — и столкновение,
 * ради которого правило заведено, прошло бы мимо.
 */

export type PathProblem =
  /** Пустая строка или один мусор из разделителей. */
  | 'empty'
  /** Абсолютный путь — объявление целится вне репозитория потребителя. */
  | 'absolute'
  /** Сегмент `..` — объявление целится выше корня. */
  | 'escapes-root';

export type CheckedPath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly problem: PathProblem };

/** Человекочитаемая причина отказа по пути. */
export const PATH_PROBLEM: Record<PathProblem, string> = {
  empty: 'путь пуст',
  absolute:
    'ожидался путь относительно корня репозитория, получен абсолютный — обвес целится наружу',
  'escapes-root':
    'путь выходит за корень репозитория (сегмент ".."), обвес целится наружу',
};

/** Приводит путь к каноничной форме (`a/b/c`) либо называет причину отказа. */
export function checkPath(value: unknown): CheckedPath {
  // Значение приходит из чужого JSON, поэтому строкой быть НЕ обязано:
  // не-строка — такой же непригодный путь, а не повод падать на `.trim()`.
  if (typeof value !== 'string') {
    return { ok: false, problem: 'empty' };
  }

  const raw = value.trim().replace(/\\/g, '/');
  if (raw === '') {
    return { ok: false, problem: 'empty' };
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    return { ok: false, problem: 'absolute' };
  }

  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return { ok: false, problem: 'escapes-root' };
    }
    segments.push(segment);
  }

  return segments.length === 0
    ? { ok: false, problem: 'empty' }
    : { ok: true, path: segments.join('/') };
}

/**
 * Сравнение строк для УПОРЯДОЧИВАНИЯ МАШИННОГО ВЫВОДА — байтовое.
 *
 * Перечень отказов это контракт с дверью и пультом; `localeCompare` зависит от
 * локали процесса, и один и тот же непригодный конфиг отдавал бы отказы в разном
 * порядке на машине разработчика и в CI.
 */
export function byBytes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
