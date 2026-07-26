/**
 * Пути внутри репозитория потребителя.
 *
 * Движок работает ТОЛЬКО с путями, относительными корня дерева (`Tree`):
 * абсолютный путь или выход за корень через `..` — это выход за границу
 * материализации, и он отклоняется, а не «нормализуется по-тихому».
 */

import { DeclarationError } from './errors.js';

/** Разбор пути: либо каноничная форма, либо названная причина отказа. */
export type RepoPath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly problem: RepoPathProblem };

export type RepoPathProblem =
  /** Пустая строка или один мусор из разделителей. */
  | 'empty'
  /** Абсолютный путь — выход из дерева потребителя. */
  | 'absolute'
  /** Сегмент `..` — выход за корень. */
  | 'escapes-root';

/**
 * Приводит путь к каноничной форме репо-относительного пути (`a/b/c`).
 *
 * Проверка живёт В ДВИЖКЕ, хотя форму подаёт дверь, и это не дубль её
 * валидации: движок пишет в дерево сам, поэтому границу дерева обязан держать
 * сам. Инвариант, который держит только соседняя зона, — не инвариант.
 *
 * Нормализация (`./a.yml` → `a.yml`) тут же по той же причине: движок сверяет
 * объявленный `dest` с путями из скана владения, а скан отдаёт каноничные
 * пути. Разъехавшись в написании, артефакт стал бы сиротой сразу после
 * создания — и следующий прогон снёс бы собственный свежий файл.
 */
export function toRepoPath(value: string): RepoPath {
  // Значение приходит из JSON через дверь, поэтому строкой оно быть НЕ обязано:
  // не-строка — такой же непригодный путь, как пустая строка, и отвечать на неё
  // надо отказом по записи, а не падением на `.trim()`.
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

/** Человекочитаемая причина отказа по пути. */
export const REPO_PATH_PROBLEM: Record<RepoPathProblem, string> = {
  empty: 'путь пуст',
  absolute:
    'ожидается путь относительно корня репозитория, получен абсолютный',
  'escapes-root': 'путь выходит за корень репозитория (сегмент "..")',
};

/**
 * То же, но броском — для путей, которые подаёт САМ вызывающий код
 * (`PlanOptions.confirm`), а не декларация: кривой путь там означает ошибку
 * вызова, и отвечать на неё планом не за что.
 */
export function normalizeRepoPath(value: string, field: string): string {
  const result = toRepoPath(value);
  if (!result.ok) {
    throw new DeclarationError(
      `${field}: ${REPO_PATH_PROBLEM[result.problem]} ("${value}")`,
    );
  }
  return result.path;
}

/**
 * Сравнение путей для УПОРЯДОЧИВАНИЯ МАШИННОГО ВЫВОДА — байтовое.
 *
 * Схема вывода это контракт с пультом, и порядок в нём не имеет права плавать
 * между окружениями. `localeCompare` зависит от ICU и локали процесса: один и
 * тот же план на машине разработчика и в CI отдавал бы шаги в разном порядке —
 * данных это не портит, но ломает и сравнение выводов, и снапшоты потребителя.
 *
 * Порядок кодовых точек одинаков везде. Человекочитаемая сортировка — забота
 * того, кто рендерит для человека, а не формы ответа.
 */
export function byBytes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Склейка репо-относительных путей; пустой/точечный префикс означает корень. */
export function joinRepoPath(base: string, relative: string): string {
  const prefix = base
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  return prefix === '' || prefix === '.' ? relative : `${prefix}/${relative}`;
}
