import { describe, expect, it } from 'vitest';
import type { LayoutEntry } from './declaration.js';
import { computePlan } from './plan.js';
import {
  MaterializationApplyError,
  MaterializationConflictError,
  applyPlan,
} from './apply.js';
import { MANIFEST_PATH } from './manifest.js';
import {
  createWorkspace,
  manifestOf,
  redeclare,
  snapshotTree,
  treeFailingOnWrite,
} from './workspace.fixture.js';

const WORKFLOW = '.github/workflows/build.yml';
const RELEASE = '.github/workflows/release.yml';

const LAYOUT: readonly LayoutEntry[] = [
  { src: 'ci/build.yml', dest: WORKFLOW },
  { src: 'ci/release.yml', dest: RELEASE },
];

const SOURCES = {
  'ci/build.yml': 'name: build\njobs: {}\n',
  'ci/release.yml': 'name: release\njobs: {}\n',
};

describe('applyPlan', () => {
  it('применяет шаги плана к дереву', () => {
    const { tree, declaration } = createWorkspace({ layout: LAYOUT, sources: SOURCES });

    const report = applyPlan(tree, computePlan({ tree, declaration }));

    expect(report.applied).toHaveLength(2);
    expect(tree.read(WORKFLOW, 'utf-8')).toContain('name: build');
    expect(tree.read(RELEASE, 'utf-8')).toContain('name: release');
  });

  it('трейсит применение', () => {
    const { tree, declaration } = createWorkspace({ layout: LAYOUT, sources: SOURCES });

    const report = applyPlan(tree, computePlan({ tree, declaration }));

    expect(report.trace.map((span) => span.name)).toEqual([
      'apply.steps',
      'apply.manifest',
    ]);
    expect(report.trace[0].detail).toEqual({ steps: 2 });
  });

  it('план с конфликтом не применяется вовсе', () => {
    const { tree, declaration } = createWorkspace({
      layout: LAYOUT,
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });
    const before = snapshotTree(tree);

    const plan = computePlan({ tree, declaration });

    expect(() => applyPlan(tree, plan)).toThrow(MaterializationConflictError);
    expect(snapshotTree(tree)).toEqual(before);
  });
});

describe('служебная запись применяется вместе с артефактами', () => {
  it('манифест ложится последним и назван в отчёте', () => {
    const { tree, declaration } = createWorkspace({
      layout: LAYOUT,
      sources: SOURCES,
    });

    const report = applyPlan(tree, computePlan({ tree, declaration }));

    expect(report.manifestPath).toBe(MANIFEST_PATH);
    expect(manifestOf(tree).map((record) => record.dest)).toEqual(
      [...LAYOUT].map((entry) => entry.dest).sort(),
    );
  });

  it('сходящийся план манифест не трогает', () => {
    const { tree, declaration } = createWorkspace({
      layout: LAYOUT,
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));
    const written = tree.read(MANIFEST_PATH, 'utf-8');

    applyPlan(tree, computePlan({ tree, declaration }));

    expect(tree.read(MANIFEST_PATH, 'utf-8')).toBe(written);
  });

  it('сбой применения откатывает и запись: полуправды о состоянии не бывает', () => {
    // Откат, вернувший файлы, но оставивший запись о том, чего на диске нет, —
    // это ровно та ложь служебного состояния, ради которой затевался переезд.
    const { tree, declaration } = createWorkspace({
      layout: LAYOUT,
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));

    tree.write(WORKFLOW, 'name: правка\n');
    const plan = computePlan({ tree, declaration });
    const before = snapshotTree(tree);
    expect(plan.steps).toHaveLength(1);

    // Сбой ровно НА ЗАПИСИ МАНИФЕСТА: артефакт к этому моменту уже переписан.
    expect(() => applyPlan(treeFailingOnWrite(tree, 2), plan)).toThrow(
      MaterializationApplyError,
    );

    // Откат вернул и артефакт, и запись — состояние целиком, а не наполовину.
    expect(snapshotTree(tree)).toEqual(before);
    expect(tree.read(WORKFLOW, 'utf-8')).toBe('name: правка\n');
  });
});

describe('атомарность (§2 контракта)', () => {
  it('сбой в середине применения не оставляет полуобновлённого дерева', () => {
    const { tree, declaration } = createWorkspace({ layout: LAYOUT, sources: SOURCES });
    const plan = computePlan({ tree, declaration });
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
      layout: LAYOUT,
      sources: SOURCES,
      existing: { [WORKFLOW]: 'name: написано руками\n' },
    });
    const plan = computePlan({ tree, declaration, confirm: [WORKFLOW] });
    const before = snapshotTree(tree);

    expect(() => applyPlan(treeFailingOnWrite(tree, 2), plan)).toThrow(
      MaterializationApplyError,
    );

    expect(snapshotTree(tree)).toEqual(before);
    expect(tree.read(WORKFLOW, 'utf-8')).toBe('name: написано руками\n');
  });

  it('сбой на снятии сироты откатывает уже применённые шаги', () => {
    const { tree, declaration } = createWorkspace({ layout: LAYOUT, sources: SOURCES });
    applyPlan(tree, computePlan({ tree, declaration }));

    tree.write(WORKFLOW, 'name: правка\n');

    const declarationAfter = redeclare(declaration, [
      { src: 'ci/build.yml', dest: WORKFLOW },
    ]);
    const plan = computePlan({
      tree,
      declaration: declarationAfter,
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
