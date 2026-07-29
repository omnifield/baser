import { describe, expect, it } from 'vitest';
import {
  parseSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import { checkSingleProvider, type InstalledSource } from './providers.js';

function declare(patch: Record<string, unknown>): SourceDeclaration {
  const parsed = parseSourceDeclaration(declarationBlock(patch));
  if (!parsed.ok) {
    throw new Error(`заготовка непригодна: ${JSON.stringify(parsed.problems)}`);
  }
  return parsed.value;
}

const devbox: InstalledSource = {
  packageName: '@omnifield/baser-devbox',
  declaration: declare({
    source: {
      id: 'omnifield/devbox',
      title: 'Девбокс',
      contentRoot: 'template',
    },
    layout: [
      { src: 'devcontainer.json', dest: '.devcontainer/devcontainer.json' },
      {
        src: 'lock.json',
        dest: '.devcontainer/devcontainer-lock.json',
        render: false,
      },
    ],
  }),
};

const harness: InstalledSource = {
  packageName: '@omnifield/brainer-agent-harness',
  declaration: declare({
    source: {
      id: 'omnifield/agent-harness',
      title: 'Харнесс',
      contentRoot: 'tpl',
    },
    layout: [{ src: 'policy.md', dest: '.claude/agents/shared-policy.md' }],
  }),
};

describe('один артефакт — один поставщик', () => {
  it('сводит раскладки разных обвесов в одну карту владения', () => {
    const result = checkSingleProvider([devbox, harness]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value)).toEqual([
      '.claude/agents/shared-policy.md',
      '.devcontainer/devcontainer-lock.json',
      '.devcontainer/devcontainer.json',
    ]);
    expect(result.value['.devcontainer/devcontainer.json']).toEqual({
      sourceId: 'omnifield/devbox',
      packageName: '@omnifield/baser-devbox',
      src: 'devcontainer.json',
      render: true,
      class: 'regenerated',
    });
  });

  it('КЛАСС АРТЕФАКТА едет во владение — по нему строится план', () => {
    const плагин: InstalledSource = {
      packageName: '@omnifield/brainer-agent-harness',
      declaration: declare({
        source: {
          id: 'omnifield/agent-harness',
          title: 'Харнесс',
          contentRoot: 'tpl',
        },
        layout: [
          { src: 'policy.md.ejs', dest: '.claude/agents/shared-policy.md' },
          {
            src: 'harness.yaml.ejs',
            dest: '.omnifield/harness.yaml',
            class: 'placed-once',
          },
        ],
      }),
    };

    const result = checkSingleProvider([devbox, плагин]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value['.omnifield/harness.yaml'].class).toBe('placed-once');
    expect(result.value['.claude/agents/shared-policy.md'].class).toBe(
      'regenerated',
    );
  });

  it('СТОЛКНОВЕНИЕ ДВУХ ОБВЕСОВ НА ОДИН dest называется вслух', () => {
    // Ровно тот случай, на котором правило и нашлось: базовая докер-обвязка и
    // надстройка omnifield обе хотели писать devcontainer.json.
    const надстройка: InstalledSource = {
      packageName: '@omnifield/baser-devbox-omnifield',
      declaration: declare({
        source: {
          id: 'omnifield/devbox-plus',
          title: 'Надстройка',
          contentRoot: 'tpl',
        },
        layout: [
          { src: 'over.json', dest: './.devcontainer/devcontainer.json' },
        ],
      }),
    };

    const result = checkSingleProvider([devbox, надстройка]);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(codesOf(result.problems)).toEqual([
      'artifact-shared @ @omnifield/baser-devbox-omnifield.layout → .devcontainer/devcontainer.json',
    ]);
    const [problem] = result.problems;
    // Названы ОБА поставщика и путь — иначе чинить нечего.
    expect(problem.message).toContain('omnifield/devbox');
    expect(problem.message).toContain('omnifield/devbox-plus');
    expect(problem.message).toContain('пресетом внутри одного обвеса');
  });

  it('не разрешает столкновение порядком перечисления', () => {
    const прямой = checkSingleProvider([
      devbox,
      {
        ...harness,
        declaration: declare({
          source: {
            id: 'omnifield/other',
            title: 'Другой',
            contentRoot: 'tpl',
          },
          layout: [{ src: 'a.json', dest: '.devcontainer/devcontainer.json' }],
        }),
      },
    ]);
    const обратный = checkSingleProvider([
      {
        ...harness,
        declaration: declare({
          source: {
            id: 'omnifield/other',
            title: 'Другой',
            contentRoot: 'tpl',
          },
          layout: [{ src: 'a.json', dest: '.devcontainer/devcontainer.json' }],
        }),
      },
      devbox,
    ]);

    // Кто «первый», не имеет значения: набор непригоден в обе стороны.
    expect(прямой.ok).toBe(false);
    expect(обратный.ok).toBe(false);
  });

  it('называет две одинаковые идентичности', () => {
    const близнец: InstalledSource = {
      packageName: '@чужой/devbox-fork',
      declaration: devbox.declaration,
    };
    const result = checkSingleProvider([devbox, близнец]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'duplicate-source-id @ @чужой/devbox-fork.source.id',
    ]);
    expect(result.problems[0].message).toContain('группируется владение');
  });

  it('НЕ ДАЁТ ДВУМ ОБВЕСАМ ОДИН ФАЙЛ НАСТРОЕК', () => {
    // Имя файла считается из личности, слеш становится дефисом — и "a-b/c"
    // сходится с "a/b-c". Личности разные, файл один: человеку негде настроить
    // их порознь, и каждый назвал бы чужие ключи незнакомыми.
    const первый: InstalledSource = {
      packageName: '@omnifield/baser-devbox-plus',
      declaration: declare({
        source: {
          id: 'omnifield/devbox-plus',
          title: 'Надстройка',
          contentRoot: 'tpl',
        },
        layout: [{ src: 'a.json', dest: 'a.json' }],
      }),
    };
    const второй: InstalledSource = {
      packageName: '@чужой/plus',
      declaration: declare({
        source: {
          id: 'omnifield-devbox/plus',
          title: 'Однофамилец',
          contentRoot: 'tpl',
        },
        layout: [{ src: 'b.json', dest: 'b.json' }],
      }),
    };

    const result = checkSingleProvider([первый, второй]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'source-config-shared @ @чужой/plus.source.id',
    ]);
    expect(result.problems[0].message).toContain(
      '.omnifield/omnifield-devbox-plus.yaml',
    );
  });

  it('НЕ ДАЁТ ПОЛОЖИТЬ АРТЕФАКТ ПОВЕРХ ФАЙЛА НАСТРОЕК', () => {
    // Артефакт в .omnifield/ законен (там живёт placed-once харнесса), но адрес
    // файла настроек занят человеком: он не запись раскладки, владеть им нечем,
    // и перегенерация затирала бы настроенное.
    const жадный: InstalledSource = {
      packageName: '@omnifield/baser-devbox',
      declaration: declare({
        source: {
          id: 'omnifield/devbox',
          title: 'Девбокс',
          contentRoot: 'tpl',
        },
        layout: [
          { src: 'tuning.yaml', dest: '.omnifield/omnifield-devbox.yaml' },
        ],
      }),
    };

    const result = checkSingleProvider([жадный]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'artifact-over-source-config @ @omnifield/baser-devbox.layout → .omnifield/omnifield-devbox.yaml',
    ]);
    expect(result.problems[0].message).toContain('заполняет человек');
  });

  it('на чужой файл настроек — тот же отказ, и он свойство НАБОРА', () => {
    // Поодиночке каждый безупречен: девбокс не знает, как называется файл
    // настроек соседа, и увидеть столкновение можно только рядом с ним.
    const чужой: InstalledSource = {
      packageName: '@omnifield/baser-devbox',
      declaration: declare({
        source: {
          id: 'omnifield/devbox',
          title: 'Девбокс',
          contentRoot: 'tpl',
        },
        layout: [
          {
            src: 'tuning.yaml',
            dest: '.omnifield/omnifield-agent-harness.yaml',
          },
        ],
      }),
    };

    expect(checkSingleProvider([чужой]).ok).toBe(true);

    const result = checkSingleProvider([чужой, harness]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'artifact-over-source-config @ @omnifield/baser-devbox.layout → .omnifield/omnifield-agent-harness.yaml',
    ]);
  });

  it('артефакт в .omnifield/ сам по себе законен — папка ничего не решает', () => {
    // Обратная сторона того же правила: `placed-once` живёт и здесь, а класс
    // определяется не папкой, а тем, заполняет ли файл человек.
    const result = checkSingleProvider([harness, devbox]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['.claude/agents/shared-policy.md'].sourceId).toBe(
      'omnifield/agent-harness',
    );
  });

  it('пустой набор — пустая карта, а не отказ', () => {
    const result = checkSingleProvider([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });
});
