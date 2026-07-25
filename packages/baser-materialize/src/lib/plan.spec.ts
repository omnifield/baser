import { describe, expect, it } from 'vitest';
import type { Tree } from '@nx/devkit';
import type { Declaration, FrameEntry } from './declaration.js';
import { readDeclaration } from './declaration.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import {
  ALL_DOUBLES,
  productDouble,
  refusingDouble,
} from './strategies.fixture.js';
import { CONTENT_ROOT, createWorkspace } from './workspace.fixture.js';

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

/** Меняет объявленный `frame` продукта и перечитывает декларацию. */
function redeclare(tree: Tree, frame: readonly FrameEntry[]): Declaration {
  const manifest = JSON.parse(tree.read('package.json', 'utf-8') as string);
  manifest.omnifield.frame = frame;
  tree.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return readDeclaration(tree);
}

describe('computePlan — чего не хватает', () => {
  it('объявленный, но отсутствующий артефакт даёт шаг создания', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.applicable).toBe(true);
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

    expect(first.empty).toBe(false);
    expect(second.empty).toBe(true);
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
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }).empty,
    ).toBe(true);
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

    expect(plan.empty).toBe(true);
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
      computePlan({ tree, declaration: empty, strategies: ALL_DOUBLES }).empty,
    ).toBe(true);
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
    expect(plan.applicable).toBe(false);
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'foreign-dest',
      dest: WORKFLOW,
    });
    expect(plan.conflicts[0].message).toContain('конфликт владения');
    expect(tree.read(WORKFLOW, 'utf-8')).toBe('name: написано руками\n');
  });

  it('перезапись возможна только явным действием (force)', () => {
    const { tree, declaration } = createWorkspace({
      frame: [exactEntry],
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      force: true,
    });

    expect(plan.applicable).toBe(true);
    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'adopted' });
  });

  it('совместное владение принимает существующий файл продукта без отказа', () => {
    const { tree, declaration } = createWorkspace({
      frame: [mergeEntry],
      sources: SOURCES,
      existing: { '.gitignore': 'coverage\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.applicable).toBe(true);
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
