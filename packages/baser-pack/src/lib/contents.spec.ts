/**
 * СОСТАВ ПОСТАВКИ: что мы принимаем от npm и что отказываемся принимать.
 *
 * Разбор ответа строгий намеренно. Неожиданная форма — это «состав неизвестен»,
 * а не повод собрать нагрузку из того, что удалось угадать: собранная по
 * догадке нагрузка выглядит как настоящая ровно до потребителя.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupBoxes, DEVBOX_ROOT } from './devbox.fixture.js';
import { listShippedFiles, parseShippedFiles } from './contents.js';

afterEach(cleanupBoxes);

describe('состав спрашивается у npm', () => {
  it('живой обвес перечислен целиком и в байтовом порядке', () => {
    const listed = listShippedFiles(DEVBOX_ROOT);

    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.files.map((file) => file.path)).toEqual([
      'README.md',
      'defaults.mjs',
      'package.json',
      'template/devcontainer-lock.json',
      'template/devcontainer.json.ejs',
    ]);
    expect(listed.files.every((file) => file.bytes > 0)).toBe(true);
  });
});

describe('ответ npm разбирается строго', () => {
  it('не JSON — состав неизвестен', () => {
    const listed = parseShippedFiles('npm ERR! что-то пошло не так');

    expect(listed).toEqual({
      ok: false,
      reason: expect.stringContaining('не разбирается как JSON'),
    });
  });

  it('пустой ответ — состав неизвестен', () => {
    expect(parseShippedFiles('[]').ok).toBe(false);
  });

  it('нет списка файлов — состав неизвестен', () => {
    expect(parseShippedFiles('[{"name":"x"}]').ok).toBe(false);
  });

  it('запись без пути — состав неизвестен', () => {
    expect(parseShippedFiles('[{"files":[{"size":1}]}]').ok).toBe(false);
  });

  it('пустой состав — выдавать нечего', () => {
    expect(parseShippedFiles('[{"files":[]}]').ok).toBe(false);
  });

  it('путь наружу пакета не принимается', () => {
    for (const path of ['../тайна', '/etc/passwd', 'a\\b']) {
      const listed = parseShippedFiles(
        JSON.stringify([{ files: [{ path, size: 1 }] }]),
      );
      expect(listed).toEqual({
        ok: false,
        reason: expect.stringContaining('вне пакета'),
      });
    }
  });

  it('порядок ответа не наследуется — опись обязана быть детерминированной', () => {
    const listed = parseShippedFiles(
      JSON.stringify([
        {
          files: [
            { path: 'template/b.txt', size: 2 },
            { path: 'a.txt', size: 1 },
          ],
        },
      ]),
    );

    expect(listed.ok && listed.files.map((file) => file.path)).toEqual([
      'a.txt',
      'template/b.txt',
    ]);
  });
});
