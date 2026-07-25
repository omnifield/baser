/**
 * Сквозной прогон на мок-дереве + снапшоты выходных файлов — канон
 * тестирования генераторов (`kb:BASER-3`).
 */

import { describe, expect, it } from 'vitest';
import type { FrameEntry } from './declaration.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import { ALL_DOUBLES } from './strategies.fixture.js';
import { createWorkspace } from './workspace.fixture.js';

const frame: readonly FrameEntry[] = [
  { src: 'ci/build.yml', dest: '.github/workflows/build.yml', mode: 'exact' },
  { src: 'ts/tsconfig.json', dest: 'tsconfig.json', mode: 'exact' },
  { src: 'repo/gitignore', dest: '.gitignore', mode: 'merge' },
  { src: 'docs/CONTRIBUTING.md', dest: 'CONTRIBUTING.md', mode: 'seed' },
];

const SOURCES = {
  'ci/build.yml': 'name: build\non: [push]\njobs: {}\n',
  'ts/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
  'repo/gitignore': 'node_modules\ndist\n',
  'docs/CONTRIBUTING.md':
    '# как участвовать\n\nПравь декларацию, не артефакты.\n',
};

describe('материализация из декларации', () => {
  it('раскладывает объявленные артефакты (снапшоты выходных файлов)', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    applyPlan(tree, plan);

    expect(describePlan(plan)).toMatchSnapshot('план');
    for (const entry of frame) {
      expect(tree.read(entry.dest, 'utf-8')).toMatchSnapshot(entry.dest);
    }
  });

  it('файл, которым владеет продукт, маркера владения не несёт', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    expect(tree.read('CONTRIBUTING.md', 'utf-8')).toBe(
      SOURCES['docs/CONTRIBUTING.md'],
    );
  });

  it('повторный прогон ничего не делает и ничего не портит', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );
    const materialized = frame.map((entry) => tree.read(entry.dest, 'utf-8'));

    const second = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    applyPlan(tree, second);

    expect(second.empty).toBe(true);
    expect(describePlan(second)).toBe(
      'план пуст: дерево сошлось с декларацией',
    );
    expect(frame.map((entry) => tree.read(entry.dest, 'utf-8'))).toEqual(
      materialized,
    );
  });
});
