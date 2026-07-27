/**
 * РЕЗОЛВЕРЫ: синхронные, чистые, без сети — и это проверяется, а не обещается.
 *
 * Форма даёт обвесу право исполнить свой код у потребителя
 * (`packages/baser-contracts/README.md` §3: «`defaultFrom` — это исполнение
 * чужого кода»). Радиус этого права ограничен ровно тремя свойствами резолвера,
 * и держать их обязан сам обвес: контракты умеют назвать `resolver-async`, но
 * «сходил в реестр за версией» они назвать не могут — увидят готовое значение.
 *
 * Поэтому свойства меряются здесь, и меряются у ОПУБЛИКОВАННОГО файла: у
 * потребителя исполняется тарбол, а не то, что лежит в монорепе.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packedRoot } from './packed.mjs';

/** Контекст ровно той формы, которую подаёт дверь. */
function context(repoName = 'baser') {
  return {
    repo: { name: repoName, root: `/tmp/${repoName}` },
    source: {
      id: 'omnifield/devbox',
      packageName: '@omnifield/baser-devbox',
      version: '0.1.0',
    },
  };
}

let defaults;
let source;

beforeAll(async () => {
  defaults = await import(
    pathToFileURL(join(packedRoot(), 'defaults.mjs')).href
  );
  source = readFileSync(join(packedRoot(), 'defaults.mjs'), 'utf-8');
});

describe('свойства, за которые обвес отвечает сам', () => {
  it('СИНХРОННЫ: ни один резолвер не возвращает обещание', () => {
    // Резолвер, вернувший обещание, — отказ `resolver-async` у контрактов.
    // Ловить это прогоном двери поздно: сломается у потребителя, не у нас.
    for (const [name, fn] of Object.entries(defaults)) {
      const value = fn(context());
      expect(value, `${name} вернул thenable`).not.toHaveProperty('then');
      expect(fn.constructor.name, `${name} объявлен async`).toBe('Function');
    }
  });

  it('ЧИСТЫ: тот же контекст — то же значение, другой контекст — своё', () => {
    for (const [name, fn] of Object.entries(defaults)) {
      expect(fn(context()), `${name} не воспроизводится`).toEqual(
        fn(context()),
      );
    }
    expect(defaults.devboxName(context('weber'))).toBe('weber-devbox');
    expect(defaults.repoName(context('weber'))).toBe('weber');
  });

  it('НЕ ХОДЯТ НАРУЖУ: в опубликованном модуле нет ни одного импорта', () => {
    // Утверждение проверяемое, а не декларативное: модуль без импортов не может
    // дотянуться ни до сети, ни до ФС, ни до окружения — дотягиваться нечем.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it('НЕ ЕДУТ ПО КАЛЕНДАРЮ: ни часов, ни случайности, ни окружения', () => {
    // Дефолт, ездящий по календарю, ломает воспроизводимость коммита: один и
    // тот же код поднимался бы по-разному завтра и в оффлайне.
    const code = withoutComments(source);
    expect(code).not.toMatch(/\bDate\b/);
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/process\.env/);
  });
});

describe('пин версии рантайма', () => {
  it('КОНКРЕТНОЕ значение, а не latest и не диапазон', () => {
    // В артефакт попадает число (`kb:BASER2-5`): иначе один и тот же коммит
    // поднимается по-разному на разных машинах — классическое «у меня работает».
    expect(defaults.latestStableNode(context())).toMatch(/^\d+$/);
  });

  it('пин выпуска 0.1.0 — Node 24 (Active LTS на дату выпуска)', () => {
    // Число зафиксировано тестом намеренно: это РЕШЕНИЕ выпуска, и двинуть его
    // молча правкой одной строки нельзя — обоснование живёт в `defaults.mjs`
    // рядом с точкой, где его придётся переписать.
    expect(defaults.latestStableNode(context())).toBe('24');
  });

  it('решение объяснено в самом файле, а не в чьей-то памяти', () => {
    expect(source).toMatch(/Active LTS/);
    expect(source).toMatch(/КОГДА ЭТО ЧИСЛО ПОРА ДВИГАТЬ/);
  });
});

describe('имена растут из имени репозитория — вопросов пользователю ноль', () => {
  it('имя девбокса и алиас в сети', () => {
    expect(defaults.devboxName(context('baser'))).toBe('baser-devbox');
    expect(defaults.repoName(context('baser'))).toBe('baser');
  });

  it('экспортов ровно столько, сколько названо объявлением', () => {
    // Лишний экспорт — это код, который уехал потребителю и никем не зовётся.
    expect(Object.keys(defaults).sort()).toEqual([
      'devboxName',
      'latestStableNode',
      'repoName',
    ]);
  });
});

function withoutComments(text) {
  return text.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
