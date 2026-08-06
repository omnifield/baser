/**
 * ПРИЁМКА СПОСОБНОСТИ «ОБЪЯВИТЬ ПОСТАВКУ» (`tasker:BASER2-200`).
 *
 * Судится не «записалось ли», а четыре обещания, каждое из которых легко
 * потерять правкой в одну строку:
 *
 * 1. **объявление рождается** в локации, где его не было, — это и есть
 *    «фундамент в пустой репозиторий» (`kb:SANDBOX-3`);
 * 2. **чужое не затирается** — соседние записи возвращаются на диск ТЕМИ ЖЕ
 *    БАЙТАМИ. Проверяется побайтово, а не «по смыслу»: пересборка файла
 *    `JSON.stringify` прошла бы проверку на смысл и провалила бы обещание;
 * 3. **повтор не дублирует, а называет** смену закрепления;
 * 4. **небрежный вход отвечает ДАННЫМИ** с кодом, а не броском (`kb:BASER3-10`).
 *
 * Форма файла здесь не пересказывается: там, где судится пригодность объявления,
 * проба зовёт разборщик формы (`parseConsumerConfig`) — тот же, что зовёт сама
 * способность. Своё представление о форме в пробе разъехалось бы с формой ровно
 * так же, как разъехалось бы в коде.
 */

import { parseConsumerConfig } from '@omnifield/baser-contracts';
import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it } from 'vitest';
import { declareSupply, describeSupplyChange } from './supply.js';
import { findTopLevelArray } from './supply-text.js';

const AT = 'baser.json';

/** Локация без объявления: файлы в дереве есть, `baser.json` — нет. */
function emptyLocation(): Tree {
  return createTreeWithEmptyWorkspace();
}

function locationWith(declaration: string): Tree {
  const tree = emptyLocation();
  tree.write(AT, declaration);
  return tree;
}

function textOf(tree: Tree): string {
  return tree.read(AT, 'utf-8') ?? '';
}

/** Тексты записей перечня — ровно те байты, которыми они лежат в файле. */
function entryTexts(text: string): readonly string[] {
  const array = findTopLevelArray(text, 'sources');
  if (array === null) {
    throw new Error('перечень не найден — проба судит не то, что думает');
  }
  return array.items.map((span) => text.slice(span.start, span.end));
}

describe('объявление рождается в пустой локации', () => {
  it('создаёт файл с одной поставкой, и форма его принимает', () => {
    const tree = emptyLocation();

    const result = declareSupply.run(tree, { use: '@omnifield/baser-devbox' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.change).toBe('declaration-created');
    expect(result.value.at).toBe(AT);
    expect(result.value.pin).toBeNull();

    const written = JSON.parse(textOf(tree)) as unknown;
    const form = parseConsumerConfig(written, AT);
    expect(form.ok).toBe(true);
    if (!form.ok) {
      return;
    }
    expect(form.value.sources).toEqual([{ use: '@omnifield/baser-devbox' }]);
  });

  it('кладёт закрепление, когда оно названо', () => {
    const tree = emptyLocation();

    const result = declareSupply.run(tree, { use: 'pkg', channel: 'dev' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.pin).toEqual({ channel: 'dev' });
    expect(JSON.parse(textOf(tree))).toMatchObject({
      sources: [{ use: 'pkg', channel: 'dev' }],
    });
  });

  it('файл кончается переводом строки — он лежит в git', () => {
    const tree = emptyLocation();

    declareSupply.run(tree, { use: 'pkg' });

    expect(textOf(tree).endsWith('}\n')).toBe(true);
  });
});

describe('чужое не затирается', () => {
  /**
   * Файл написан ЧЕЛОВЕКОМ, а не нами: четыре пробела, `$schema` сверху, свой
   * порядок ключей. Ровно это и обязано вернуться на диск нетронутым — иначе
   * человек увидит в `git diff` весь файл вместо одной добавленной поставки.
   */
  const HAND_WRITTEN = `{
    "$schema": "https://omnifield.dev/baser.json",
    "formVersion": 5,
    "sources": [
        {
            "use": "@omnifield/brainer-harness"
        },
        {
            "channel": "dev",
            "use": "@omnifield/baser-devbox"
        }
    ]
}
`;

  it('соседние записи остаются побайтово теми же', () => {
    const tree = locationWith(HAND_WRITTEN);
    const before = entryTexts(HAND_WRITTEN);

    const result = declareSupply.run(tree, { use: 'weber-web' });

    expect(result.ok).toBe(true);
    const after = entryTexts(textOf(tree));
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('всё вне перечня — те же байты, включая `$schema` и отступ файла', () => {
    const tree = locationWith(HAND_WRITTEN);

    declareSupply.run(tree, { use: 'weber-web' });

    const text = textOf(tree);
    expect(text.startsWith(HAND_WRITTEN.slice(0, HAND_WRITTEN.indexOf('[') + 1))).toBe(true);
    expect(text.endsWith(']\n}\n')).toBe(true);
    // Отступ файла свой, и дописанное встало в него, а не в наш.
    expect(text).toContain('\n        {\n            "use": "weber-web"\n        }');
  });

  it('получившийся файл форма по-прежнему принимает', () => {
    const tree = locationWith(HAND_WRITTEN);

    declareSupply.run(tree, { use: 'weber-web' });

    const form = parseConsumerConfig(JSON.parse(textOf(tree)), AT);
    expect(form.ok).toBe(true);
    if (!form.ok) {
      return;
    }
    expect(form.value.sources.map((source) => source.use)).toEqual([
      '@omnifield/brainer-harness',
      '@omnifield/baser-devbox',
      'weber-web',
    ]);
  });

  it('перечень, написанный в строку, дописывается в строку же', () => {
    const tree = locationWith('{"formVersion":5,"sources":[{"use":"a"}]}');

    declareSupply.run(tree, { use: 'b' });

    expect(textOf(tree)).toBe(
      '{"formVersion":5,"sources":[{"use":"a"},{"use":"b"}]}',
    );
  });

  it('пустой перечень принимает первую запись', () => {
    const tree = locationWith('{\n  "formVersion": 5,\n  "sources": []\n}\n');

    const result = declareSupply.run(tree, { use: 'a' });

    expect(result.ok).toBe(true);
    expect(textOf(tree)).toBe(
      '{\n  "formVersion": 5,\n  "sources": [\n    {\n      "use": "a"\n    }\n  ]\n}\n',
    );
  });
});

describe('повтор не дублирует, а называет смену закрепления', () => {
  const DECLARED = `{
  "formVersion": 5,
  "sources": [
    {
      "use": "pkg",
      "channel": "dev"
    }
  ]
}
`;

  it('смена метки на номер названа ДО того, как файл станет другим', () => {
    const tree = locationWith(DECLARED);

    const result = declareSupply.run(tree, { use: 'pkg', version: '1.2.3' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.change).toBe('pin-changed');
    expect(result.value.previousPin).toEqual({ channel: 'dev' });
    expect(result.value.pin).toEqual({ version: '1.2.3' });

    const form = parseConsumerConfig(JSON.parse(textOf(tree)), AT);
    expect(form.ok).toBe(true);
    if (!form.ok) {
      return;
    }
    // Не дубль: запись одна, и она новая.
    expect(form.value.sources).toEqual([{ use: 'pkg', version: '1.2.3' }]);
  });

  it('то же самое второй раз — файл не тронут вовсе', () => {
    const tree = locationWith(DECLARED);

    const result = declareSupply.run(tree, { use: 'pkg', channel: 'dev' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.change).toBe('already-declared');
    expect(result.value.pin).toEqual({ channel: 'dev' });
    expect(textOf(tree)).toBe(DECLARED);
  });

  it('вызов без закрепления НЕ снимает уже закреплённое', () => {
    const tree = locationWith(DECLARED);

    const result = declareSupply.run(tree, { use: 'pkg' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.change).toBe('already-declared');
    expect(result.value.pin).toEqual({ channel: 'dev' });
    expect(textOf(tree)).toBe(DECLARED);
  });

  it('соседняя поставка при смене закрепления не шевелится', () => {
    const tree = locationWith(`{
  "formVersion": 5,
  "sources": [
    { "use": "neighbour", "channel": "next" },
    {
      "use": "pkg",
      "channel": "dev"
    }
  ]
}
`);
    const neighbour = entryTexts(textOf(tree))[0];

    declareSupply.run(tree, { use: 'pkg', version: '2.0.0' });

    expect(entryTexts(textOf(tree))[0]).toBe(neighbour);
  });
});

describe('небрежный вход — отказ данными, а не броском', () => {
  it('пустое имя поставки', () => {
    const tree = emptyLocation();

    const result = declareSupply.run(tree, { use: '   ' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'empty-string',
    ]);
    expect(tree.exists(AT)).toBe(false);
  });

  it('метка канала и номер разом — закрепление названо дважды', () => {
    const tree = emptyLocation();

    const result = declareSupply.run(tree, {
      use: 'pkg',
      channel: 'dev',
      version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'pin-ambiguous',
    ]);
    expect(tree.exists(AT)).toBe(false);
  });

  it('форма, которой этот baser не знает', () => {
    const tree = locationWith('{"formVersion": 99, "sources": []}');

    const result = declareSupply.run(tree, { use: 'pkg' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toContain(
      'form-version-unsupported',
    );
  });

  it('метка канала в файле формы 4 — «подними форму», а не тихое согласие', () => {
    const tree = locationWith('{"formVersion": 4, "sources": []}');

    const result = declareSupply.run(tree, { use: 'pkg', channel: 'dev' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toContain(
      'form-version-unsupported',
    );
    // Файл не тронут: отказ пришёл ДО записи.
    expect(textOf(tree)).toBe('{"formVersion": 4, "sources": []}');
  });

  it('номер, который ничего не закрепляет', () => {
    const tree = locationWith('{"formVersion": 5, "sources": []}');

    const result = declareSupply.run(tree, { use: 'pkg', version: '^1.2.0' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toContain(
      'invalid-version',
    );
  });

  it('объявление, которое не разбирается как JSON', () => {
    const tree = locationWith('{ "formVersion": 5, "sources": [ ');

    const result = declareSupply.run(tree, { use: 'pkg' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'consumer-config-unreadable',
    ]);
  });

  it('непригодное объявление не дописывается, а называется', () => {
    const tree = locationWith('{"formVersion": 5, "sources": [{"use": ""}]}');

    const result = declareSupply.run(tree, { use: 'pkg' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toContain(
      'empty-string',
    );
    expect(textOf(tree)).toBe('{"formVersion": 5, "sources": [{"use": ""}]}');
  });

  it('по пути объявления лежит каталог', () => {
    const tree = emptyLocation();
    tree.write(`${AT}/inner.txt`, 'занято');

    const result = declareSupply.run(tree, { use: 'pkg' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'consumer-config-unreadable',
    ]);
  });
});

describe('способность описывает себя машинно', () => {
  it('несёт имя, описание и именованные параметры', () => {
    expect(declareSupply.name).toBe('declare-supply');
    expect(declareSupply.title).not.toBe('');
    expect(declareSupply.description).not.toBe('');

    expect(declareSupply.parameters.map((parameter) => parameter.name)).toEqual([
      'use',
      'channel',
      'version',
    ]);
  });

  it('у каждого параметра есть все три части формы', () => {
    for (const parameter of declareSupply.parameters) {
      expect(parameter.title).not.toBe('');
      expect(parameter.description).not.toBe('');
      expect(parameter.type).toBe('string');
      expect(typeof parameter.required).toBe('boolean');
    }
  });

  it('обязателен ровно один параметр — сама поставка', () => {
    expect(
      declareSupply.parameters
        .filter((parameter) => parameter.required)
        .map((parameter) => parameter.name),
    ).toEqual(['use']);
  });
});

describe('ответ — данные, текст рисуется поверх', () => {
  it('несёт версию схемы и трейс прогона', () => {
    const tree = emptyLocation();

    const result = declareSupply.run(tree, { use: 'pkg' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.schemaVersion).toBe(5);
    expect(result.value.trace.map((span) => span.name)).toContain(
      'declare.write',
    );
    expect(result.value.trace.map((span) => span.name)).toContain(
      'declare.outcome',
    );
  });

  it('рендер называет обе стороны смены закрепления', () => {
    const tree = locationWith('{"formVersion":5,"sources":[{"use":"pkg","channel":"dev"}]}');

    const result = declareSupply.run(tree, { use: 'pkg', version: '1.0.0' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const text = describeSupplyChange(result.value);
    expect(text).toContain('канал dev');
    expect(text).toContain('номер 1.0.0');
  });
});
