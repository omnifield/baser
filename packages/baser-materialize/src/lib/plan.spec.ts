import { describe, expect, it } from 'vitest';
import type { FrameEntry } from './declaration.js';
import { computePlan, describePlan, isApplicable } from './plan.js';
import { applyPlan } from './apply.js';
import type { CanonBaseline } from './source.js';
import { createTreeSource } from './source.js';
import { DEFAULT_SCAN_IGNORE, readOwnership } from './ownership.js';
import {
  ALL_DOUBLES,
  CARELESS_DOUBLES,
  productDouble,
  refusingDouble,
} from './strategies.fixture.js';
import {
  CONTENT_ROOT,
  createWorkspace,
  redeclare,
} from './workspace.fixture.js';

const WORKFLOW = '.github/workflows/build.yml';

const exactEntry: FrameEntry = {
  src: 'ci/build.yml',
  dest: WORKFLOW,
  mode: 'exact',
};
const jsonEntry: FrameEntry = {
  src: 'ts/tsconfig.json',
  dest: 'tsconfig.json',
  mode: 'exact',
};
const mergeEntry: FrameEntry = {
  src: 'repo/gitignore',
  dest: '.gitignore',
  mode: 'merge',
};
const seedEntry: FrameEntry = {
  src: 'docs/CONTRIBUTING.md',
  dest: 'CONTRIBUTING.md',
  mode: 'seed',
};

const SOURCES = {
  'ci/build.yml': 'name: build\njobs: {}\n',
  'ts/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
  'repo/gitignore': 'node_modules\ndist\n',
  'docs/CONTRIBUTING.md': '# как участвовать\n',
};

describe('computePlan — чего не хватает', () => {
  it('объявленный, но отсутствующий артефакт даёт шаг создания', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('pending');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: 'create',
      dest: WORKFLOW,
      reason: 'missing',
      previous: null,
    });
    expect(plan.steps[0].content).toContain('name: build');
  });

  it('план не трогает дерево — он данные, а не побочка', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(tree.exists(WORKFLOW)).toBe(false);
  });

  it('план читается человеком до применения', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const text = describePlan(
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    expect(text).toContain('create');
    expect(text).toContain(WORKFLOW);
  });
});

describe('computePlan — что разошлось', () => {
  it('правка в файле, которым владеет движок, даёт шаг обновления с прежним содержимым', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const materialized = tree.read(WORKFLOW, 'utf-8') as string;
    tree.write(
      WORKFLOW,
      materialized.replace('jobs: {}', 'jobs: { local: {} }'),
    );

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(plan.steps[0].previous).toContain('local');
    expect(plan.steps[0].content).not.toContain('local');
  });
});

describe('идемпотентность (§1 контракта)', () => {
  it('прогон на выходе предыдущего прогона даёт ПУСТОЙ план', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry, jsonEntry, mergeEntry, seedEntry],
      sources: SOURCES,
    });

    const first = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    applyPlan(tree, first);
    const second = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(first.status).toBe('pending');
    expect(second.status).toBe('converged');
    expect(second.steps).toEqual([]);
    expect(second.conflicts).toEqual([]);
  });

  it('третий прогон тоже пуст — сходимость устойчива', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry, jsonEntry, mergeEntry, seedEntry],
      sources: SOURCES,
    });

    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    expect(
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }).status,
    ).toBe('converged');
  });
});

describe('сироты (§3 контракта)', () => {
  it('запись убрана из frame → артефакт движка снимается', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );
    expect(tree.exists(WORKFLOW)).toBe(true);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, []),
      strategies: ALL_DOUBLES,
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: 'delete',
      dest: WORKFLOW,
      reason: 'orphan',
    });

    applyPlan(tree, plan);
    expect(tree.exists(WORKFLOW)).toBe(false);
  });

  it('у файла совместного владения снимается только претензия, содержимое остаётся продукту', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, []),
      strategies: ALL_DOUBLES,
    });

    expect(plan.steps[0]).toMatchObject({
      kind: 'release',
      dest: '.gitignore',
    });

    applyPlan(tree, plan);
    expect(tree.exists('.gitignore')).toBe(true);
    expect(tree.read('.gitignore', 'utf-8')).toBe('node_modules\ndist\n');
  });

  it('файл, которым владеет продукт (seed), сиротой не считается и не удаляется', () => {
    const { tree, declaration } = createWorkspace({
      frame: [seedEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, []),
      strategies: ALL_DOUBLES,
    });

    expect(plan.status).toBe('converged');
    expect(tree.exists('CONTRIBUTING.md')).toBe(true);
  });

  it('снятие сироты доводит дерево до пустого плана', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const empty = redeclare(tree, []);
    applyPlan(
      tree,
      computePlan({ tree, declaration: empty, strategies: ALL_DOUBLES }),
    );

    expect(
      computePlan({ tree, declaration: empty, strategies: ALL_DOUBLES }).status,
    ).toBe('converged');
  });
});

describe('конфликт владения (§4 контракта)', () => {
  it('чужой файл не перезаписывается молча — отказ с внятным сообщением', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps).toEqual([]);
    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'foreign-dest',
      dest: WORKFLOW,
    });
    expect(plan.conflicts[0].message).toContain('конфликт владения');
    expect(tree.read(WORKFLOW, 'utf-8')).toBe('name: написано руками\n');
  });

  it('перезапись возможна только поимённым подтверждением', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: [WORKFLOW],
    });

    expect(plan.status).toBe('pending');
    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'adopted' });
  });

  it('совместное владение принимает существующий файл продукта без отказа', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
      existing: { '.gitignore': 'coverage\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('pending');
    expect(plan.steps[0]).toMatchObject({ kind: 'update', dest: '.gitignore' });
    expect(plan.steps[0].content).toContain('coverage');
  });

  it('два объявления одного dest — отказ, а не «последний победил»', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry, { ...exactEntry, src: 'ci/other.yml' }],
      sources: { ...SOURCES, 'ci/other.yml': 'name: other\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.conflicts.map((conflict) => conflict.kind)).toEqual([
      'duplicate-dest',
    ]);
    expect(plan.steps).toEqual([]);
  });

  it('класс файла без маркера не берётся во владение молча', () => {
    const { tree, declaration } = createWorkspace({
      frame: [{ src: 'LICENSE', dest: 'LICENSE', mode: 'exact' }],
      sources: { LICENSE: 'MIT\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unmarkable-dest',
      dest: 'LICENSE',
    });
  });
});

describe('computePlan — отказы движка', () => {
  it('режим без стратегии называет, кто его поставляет', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: [productDouble],
    });

    expect(plan.conflicts[0]).toMatchObject({ kind: 'unknown-mode' });
    expect(plan.conflicts[0].message).toContain('@omnifield/baser-modes');
  });

  it('отсутствующий источник называет полный путь', () => {
    const { tree, declaration } = createWorkspace({ frame: [exactEntry] });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.conflicts[0]).toMatchObject({ kind: 'missing-source' });
    expect(plan.conflicts[0].message).toContain(`${CONTENT_ROOT}/ci/build.yml`);
  });

  it('отказ режима попадает в конфликты, а не в шаги', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: [refusingDouble],
    });

    expect(plan.steps).toEqual([]);
    expect(plan.conflicts[0]).toMatchObject({ kind: 'strategy' });
  });
});

/**
 * Инвариант, который держит только стратегия, — не инвариант (`kb:BASER-5`,
 * «Что движок обязан защищать сам»). Стратегии приходят из зоны `baser-modes` и
 * пишутся разными сессиями, поэтому проверяем НЕБРЕЖНОЙ стратегией: она
 * злоупотребляет швом, а движок обязан устоять.
 */
describe('движок защищает границы сам, а не добросовестностью режима', () => {
  it('существующий файл класса product не порождает шага, что бы ни вернула стратегия', () => {
    const { tree, declaration } = createWorkspace({
      frame: [seedEntry],
      sources: SOURCES,
      existing: { 'CONTRIBUTING.md': '# правила продукта\n' },
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: CARELESS_DOUBLES,
    });

    expect(plan.steps).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.status).toBe('converged');
    expect(plan.notices[0]).toMatchObject({
      kind: 'product-owned',
      dest: 'CONTRIBUTING.md',
      ownership: 'product',
    });
    expect(tree.read('CONTRIBUTING.md', 'utf-8')).toBe('# правила продукта\n');
  });

  it('небрежная стратегия не пробивает инвариант и через подтверждение', () => {
    const { tree, declaration } = createWorkspace({
      frame: [seedEntry],
      sources: SOURCES,
      existing: { 'CONTRIBUTING.md': '# правила продукта\n' },
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: CARELESS_DOUBLES,
      confirm: ['CONTRIBUTING.md'],
    });

    expect(plan.steps).toEqual([]);
    expect(tree.read('CONTRIBUTING.md', 'utf-8')).toBe('# правила продукта\n');
  });

  it('отсутствующий файл класса product материализуется однократно', () => {
    const { tree, declaration } = createWorkspace({
      frame: [seedEntry],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: CARELESS_DOUBLES,
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({
      kind: 'create',
      dest: 'CONTRIBUTING.md',
      reason: 'missing',
      ownership: 'product',
    });
    expect(
      computePlan({ tree, declaration, strategies: CARELESS_DOUBLES }).steps,
    ).toEqual([]);
  });
});

/**
 * «Нечего делать» и «сошлось» — разные состояния (`kb:BASER-5`). Гейт из зоны
 * `tasker:BASER-22` вяжет exit-код к сходимости, и зелёный гейт на нерешённом
 * конфликте владения опаснее отсутствующего.
 */
describe('сходимость отделена от пустоты', () => {
  it('план без шагов, но с конфликтом, сходимости НЕ означает', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.status).toBe('blocked');
    expect(isApplicable(plan)).toBe(false);
  });

  it('признака «в плане нет шагов» в схеме нет — сходимость нельзя получить случайно', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(Object.keys(plan)).not.toContain('empty');
    expect(Object.keys(plan)).not.toContain('applicable');
  });

  it('сошлось — это отсутствие и шагов, и конфликтов', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('converged');
    expect(isApplicable(plan)).toBe(true);
  });
});

/**
 * «Файл разошёлся с каноном» и «файл впервые взят под управление» — разные
 * события, и гейт обязан показывать их по-разному (`kb:BASER-5`).
 */
describe('первичное взятие во владение — событие adopted', () => {
  it('совместное владение берёт непомеченный файл с причиной adopted', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
      existing: { '.gitignore': 'coverage\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      dest: '.gitignore',
      reason: 'adopted',
      ownership: 'shared',
    });
  });

  it('расхождение уже помеченного файла остаётся diverged', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
      existing: { '.gitignore': 'coverage\n' },
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );
    tree.write(
      '.gitignore',
      (tree.read('.gitignore', 'utf-8') as string).replace('dist', 'build'),
    );

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps[0]).toMatchObject({ reason: 'diverged' });
  });

  it('единоличное владение берёт чужой файл только под подтверждением — тоже adopted', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: [WORKFLOW],
    });

    expect(plan.steps[0]).toMatchObject({ reason: 'adopted' });
  });
});

/**
 * База 3-way не хранится копией: маркер несёт версию канона, а содержимое той
 * версии подаёт раннер через порт `CanonBaseline` (`kb:BASER-5`).
 */
describe('база трёхстороннего мерджа', () => {
  it('маркер несёт версию канона, из которой материализован артефакт', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    applyPlan(
      tree,
      computePlan({
        tree,
        declaration,
        strategies: ALL_DOUBLES,
        source: createTreeSource(tree, declaration.contentRoot, '1.4.0'),
      }),
    );

    expect(readOwnership(tree, WORKFLOW)).toEqual({
      src: 'ci/build.yml',
      mode: 'exact',
      own: 'engine',
      version: '1.4.0',
    });
  });

  it('база запрашивается по версии из маркера, а не по «текущей»', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
    });
    applyPlan(
      tree,
      computePlan({
        tree,
        declaration,
        strategies: ALL_DOUBLES,
        source: createTreeSource(tree, declaration.contentRoot, '1.0.0'),
      }),
    );

    const asked: Array<readonly [string, string]> = [];
    const baseline: CanonBaseline = {
      read: (src, version) => {
        asked.push([src, version]);
        return 'node_modules\n';
      },
    };
    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source: createTreeSource(tree, declaration.contentRoot, '2.0.0'),
      baseline,
    });

    expect(asked).toEqual([['repo/gitignore', '1.0.0']]);
    expect(plan.notices).toEqual([]);
  });

  it('отсутствие базы НАЗВАНО, а не выродилось в 2-way молча', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
    });
    const source = createTreeSource(tree, declaration.contentRoot, '1.0.0');
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES, source }),
    );

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source,
    });

    expect(plan.status).toBe('converged');
    expect(plan.notices[0]).toMatchObject({
      kind: 'baseline-missing',
      dest: '.gitignore',
      detail: { version: '1.0.0', cause: 'unresolved' },
    });
  });

  it('артефакт без версии в маркере называет причину отдельно', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
      existing: { '.gitignore': 'coverage\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.notices[0]).toMatchObject({
      kind: 'baseline-missing',
      detail: { version: null, cause: 'no-version' },
    });
  });

  it('у отсутствующего артефакта третьей стороны нет — извещения не будет', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps[0]).toMatchObject({ kind: 'create' });
    expect(plan.notices).toEqual([]);
  });
});

/**
 * Приёмочный критерий контракта: любую операцию можно вызвать программно и
 * получить полный результат ДАННЫМИ, ни разу не разобрав текст
 * (`kb:BASER-5`, «Вывод машинночитаем в первую очередь»).
 */
describe('вывод машинночитаем в первую очередь', () => {
  it('каждая причина отказа доступна кодом и данными, а не только текстом', () => {
    const { tree, declaration } = createWorkspace({
      frame: [
        exactEntry,
        { ...exactEntry, src: 'ci/other.yml' },
        { src: 'ci/missing.yml', dest: 'ci/missing.yml', mode: 'exact' },
        { src: 'ci/build.yml', dest: 'LICENSE', mode: 'exact' },
        { src: 'repo/gitignore', dest: '.gitignore', mode: 'merge' },
      ],
      sources: { ...SOURCES, 'ci/other.yml': 'name: other\n' },
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: [ALL_DOUBLES[0]],
    });
    const byKind = new Map(
      plan.conflicts.map((conflict) => [conflict.kind, conflict]),
    );

    expect(byKind.get('duplicate-dest')?.detail).toEqual({
      claimedBy: 'ci/build.yml',
    });
    expect(byKind.get('missing-source')?.detail).toEqual({
      sourcePath: `${CONTENT_ROOT}/ci/missing.yml`,
    });
    expect(byKind.get('unmarkable-dest')?.detail).toEqual({
      unmarkable: 'no-format-for-class',
    });
    expect(byKind.get('unknown-mode')?.detail).toEqual({
      availableModes: ['exact'],
    });
  });

  it('отказ режима несёт причину полем, а не только внутри сообщения', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: [refusingDouble],
    });

    expect(plan.conflicts[0].detail).toEqual({
      strategyReason: 'двойник отказывает намеренно',
    });
    expect(plan.conflicts[0].ownership).toBe('engine');
  });

  it('план и отчёт переживают сериализацию: решение принимается без парсинга текста', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry, mergeEntry, seedEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    const report = applyPlan(tree, plan);
    const wire = JSON.parse(JSON.stringify({ plan, report }));

    expect(wire.plan.schemaVersion).toBe(plan.schemaVersion);
    expect(wire.report.schemaVersion).toBe(plan.schemaVersion);
    expect(wire.plan.status).toBe('pending');
    expect(
      wire.plan.steps.map((step: { kind: string; reason: string }) => [
        step.kind,
        step.reason,
      ]),
    ).toEqual([
      ['create', 'missing'],
      ['create', 'missing'],
      ['create', 'missing'],
    ]);
    expect(wire.report.applied).toHaveLength(3);
    expect(wire.report.trace[0].name).toBe('apply.steps');
  });

  it('трейсы — именованные спаны с длительностью и атрибутами', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    for (const span of plan.trace) {
      expect(typeof span.name).toBe('string');
      expect(typeof span.ms).toBe('number');
    }
    expect(
      plan.trace.find((span) => span.name === 'plan.owned')?.detail,
    ).toEqual({ files: 0 });
  });
});

/**
 * Атомарность движка кончается на виртуальном дереве: сброс на реальную ФС
 * делает раннер, и его сбой происходит уже ВНЕ журнала отката. Поэтому всё,
 * что упадёт при записи на диск, обязано быть поймано ПЛАНОМ (`kb:BASER-5`,
 * «Объявленное состояние обязано быть физически достижимым»).
 */
describe('объявленное состояние обязано быть физически достижимым', () => {
  it('dest внутри пути другого dest — конфликт плана, а не сходимость', () => {
    const { tree, declaration } = createWorkspace({
      frame: [
        { src: 'ci/build.yml', dest: 'cfg.yml', mode: 'exact' },
        { src: 'ci/build.yml', dest: 'cfg.yml/inner.yml', mode: 'exact' },
      ],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      dest: 'cfg.yml/inner.yml',
      detail: { blockedBy: 'cfg.yml', collision: 'declared-dest' },
    });
    expect(plan.steps.map((step) => step.dest)).toEqual(['cfg.yml']);
  });

  it('порядок объявления не спасает: вложенный объявлен первым — отказ у внешнего', () => {
    const { tree, declaration } = createWorkspace({
      frame: [
        { src: 'ci/build.yml', dest: 'cfg.yml/inner.yml', mode: 'exact' },
        { src: 'ci/build.yml', dest: 'cfg.yml', mode: 'exact' },
      ],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      dest: 'cfg.yml',
      detail: { blockedBy: 'cfg.yml/inner.yml', collision: 'declared-dest' },
    });
  });

  it('родительский путь занят файлом в дереве — тоже конфликт плана', () => {
    const { tree, declaration } = createWorkspace({
      frame: [
        { src: 'ci/build.yml', dest: 'cfg.yml/inner.yml', mode: 'exact' },
      ],
      sources: SOURCES,
      existing: { 'cfg.yml': 'настройка: продукта\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      detail: { blockedBy: 'cfg.yml', collision: 'existing-file' },
    });
    expect(tree.read('cfg.yml', 'utf-8')).toBe('настройка: продукта\n');
  });

  it('коллизия отбивается ПО СУЩЕСТВУ, а не побочно правилом про маркер', () => {
    // `cfg` без расширения маркер нести не может, и раньше пара отбивалась
    // именно этим. Побочная защита отвалится, как только класс станет
    // размечаемым, — значит проверка обязана стоять по существу.
    const { tree, declaration } = createWorkspace({
      frame: [
        { src: 'ci/build.yml', dest: 'cfg', mode: 'exact' },
        { src: 'ci/build.yml', dest: 'cfg/inner.yml', mode: 'exact' },
      ],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(
      plan.conflicts.find((conflict) => conflict.dest === 'cfg/inner.yml'),
    ).toMatchObject({
      kind: 'unreachable-dest',
      detail: { blockedBy: 'cfg', collision: 'declared-dest' },
    });
  });

  it('dest, чей путь уже занят каталогом, — тот же класс недостижимости', () => {
    // Контракт перечисляет обратный случай (каталог занят файлом); правило
    // «объявленное обязано быть достижимо» покрывает и этот, а падение было бы
    // опять при сбросе на диск — вне журнала отката.
    const { tree, declaration } = createWorkspace({
      frame: [{ src: 'ci/build.yml', dest: 'cfg', mode: 'exact' }],
      sources: SOURCES,
      existing: { 'cfg/inner.yml': 'настройка: продукта\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      dest: 'cfg',
      detail: { blockedBy: 'cfg', collision: 'existing-directory' },
    });
  });

  it('dest внутри contentRoot отбивается по существу, а не как чужой файл', () => {
    const { tree, declaration } = createWorkspace({
      frame: [
        {
          src: 'ci/build.yml',
          dest: `${CONTENT_ROOT}/ci/build.yml`,
          mode: 'exact',
        },
      ],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.conflicts[0]).toMatchObject({
      kind: 'dest-in-content-root',
      detail: { contentRoot: CONTENT_ROOT },
    });
    expect(plan.steps).toEqual([]);
  });
});

describe('охват скана', () => {
  it('сужение охвата раннером названо извещением уровня прогона', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      scan: { roots: ['.github'], ignore: [...DEFAULT_SCAN_IGNORE, 'vendor'] },
    });

    expect(plan.notices[0]).toMatchObject({
      kind: 'scan-scope-narrowed',
      detail: { roots: ['.github'], ignored: ['vendor'] },
    });
    expect(plan.notices[0].dest).toBeUndefined();
  });

  it('полный охват извещения не порождает', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.notices).toEqual([]);
  });
});

describe('трейсы', () => {
  it('план несёт замеры этапов', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.trace.map((span) => span.name)).toEqual([
      'plan.frame',
      'plan.scan-ownership',
      'plan.owned',
      'plan.orphans',
    ]);
    expect(plan.trace[0].detail).toEqual({ entries: 1 });
  });
});
