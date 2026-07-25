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

/** Склейка репо-относительных путей; пустой/точечный префикс означает корень. */
export function joinRepoPath(base: string, relative: string): string {
  const prefix = base
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  return prefix === '' || prefix === '.' ? relative : `${prefix}/${relative}`;
}
