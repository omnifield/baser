import { describe, expect, it } from 'vitest';
import type { FrameEntry } from './declaration.js';
import { computePlan } from './plan.js';
import {
  MaterializationApplyError,
  MaterializationConflictError,
  applyPlan,
} from './apply.js';
import { ALL_DOUBLES } from './strategies.fixture.js';
import {
  createWorkspace,
  snapshotTree,
  treeFailingOnWrite,
} from './workspace.fixture.js';

const WORKFLOW = '.github/workflows/build.yml';
const RELEASE = '.github/workflows/release.yml';

const frame: readonly FrameEntry[] = [
  { src: 'ci/build.yml', dest: WORKFLOW, mode: 'exact' },
  { src: 'ci/release.yml', dest: RELEASE, mode: 'exact' },
];

const SOURCES = {
  'ci/build.yml': 'name: build\njobs: {}\n',
  'ci/release.yml': 'name: release\njobs: {}\n',
};

describe('applyPlan', () => {
  it('применяет шаги плана к дереву', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });

    const report = applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    expect(report.applied).toHaveLength(2);
    expect(tree.read(WORKFLOW, 'utf-8')).toContain('name: build');
    expect(tree.read(RELEASE, 'utf-8')).toContain('name: release');
  });

  it('трейсит применение', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });

    const report = applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    expect(report.trace.map((span) => span.name)).toEqual(['apply.steps']);
    expect(report.trace[0].detail).toEqual({ steps: 2 });
  });

  it('план с конфликтом не применяется вовсе', () => {
    const { tree, declaration } = createWorkspace({
      frame,
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });
    const before = snapshotTree(tree);

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(() => applyPlan(tree, plan)).toThrow(MaterializationConflictError);
    expect(snapshotTree(tree)).toEqual(before);
  });
});

describe('атомарность (§2 контракта)', () => {
  it('сбой в середине применения не оставляет полуобновлённого дерева', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    const before = snapshotTree(tree);

    expect(plan.steps).toHaveLength(2);
    expect(() => applyPlan(treeFailingOnWrite(tree, 2), plan)).toThrow(
      MaterializationApplyError,
    );

    expect(snapshotTree(tree)).toEqual(before);
    expect(tree.exists(WORKFLOW)).toBe(false);
    expect(tree.exists(RELEASE)).toBe(false);
  });

  it('откат возвращает прежнее содержимое, а не удаляет файл', () => {
    const { tree, declaration } = createWorkspace({
      frame,
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });
    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: [WORKFLOW],
    });
    const before = snapshotTree(tree);

    expect(() => applyPlan(treeFailingOnWrite(tree, 2), plan)).toThrow(
      MaterializationApplyError,
    );

    expect(snapshotTree(tree)).toEqual(before);
    expect(tree.read(WORKFLOW, 'utf-8')).toBe('name: написано руками\n');
  });

  it('сбой на снятии сироты откатывает уже применённые шаги', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const manifest = JSON.parse(tree.read('package.json', 'utf-8') as string);
    manifest.omnifield.frame = [
      { src: 'ci/build.yml', dest: WORKFLOW, mode: 'exact' },
    ];
    tree.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    tree.write(WORKFLOW, 'name: правка\n');

    const declarationAfter = {
      ...declaration,
      frame: manifest.omnifield.frame,
    };
    const plan = computePlan({
      tree,
      declaration: declarationAfter,
      strategies: ALL_DOUBLES,
      confirm: [WORKFLOW],
    });
    const before = snapshotTree(tree);

    expect(plan.steps.map((step) => step.kind)).toEqual(['update', 'delete']);
    expect(() => applyPlan(failingOnDelete(tree, RELEASE), plan)).toThrow(
      MaterializationApplyError,
    );

    expect(snapshotTree(tree)).toEqual(before);
  });
});

/** Дерево, роняющее удаление конкретного файла. */
function failingOnDelete(tree: import('@nx/devkit').Tree, failOn: string) {
  return new Proxy(tree, {
    get(target, property, receiver) {
      if (property === 'delete') {
        return (path: string): void => {
          if (path === failOn) {
            throw new Error(`искусственный сбой удаления "${path}"`);
          }
          target.delete(path);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
