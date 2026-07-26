/**
 * Пути внутри репозитория потребителя.
 *
 * Движок работает ТОЛЬКО с путями, относительными корня дерева (`Tree`):
 * абсолютный путь или выход за корень через `..` — это выход за границу
 * материализации, и он отклоняется, а не «нормализуется по-тихому».
 */

import { DeclarationError } from './errors.js';

/**
 * Приводит путь к каноничной форме репо-относительного пути (`a/b/c`).
 *
 * @param value путь из декларации
 * @param field адрес поля для сообщения об ошибке (напр. `omnifield.frame[0].dest`)
 */
export function normalizeRepoPath(value: string, field: string): string {
  const raw = value.trim().replace(/\\/g, '/');

  if (raw === '') {
    throw new DeclarationError(`${field}: путь пуст`);
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw new DeclarationError(
      `${field}: ожидается путь относительно корня репозитория, получен абсолютный "${value}"`,
    );
  }

  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      throw new DeclarationError(
        `${field}: путь "${value}" выходит за корень репозитория (сегмент "..")`,
      );
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new DeclarationError(
      `${field}: путь "${value}" не указывает на файл`,
    );
  }

  return segments.join('/');
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
