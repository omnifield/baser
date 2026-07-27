/**
 * Сквозной прогон на мок-дереве + снапшоты выходных файлов — канон
 * тестирования генераторов (`kb:BASER-3`).
 */

import { describe, expect, it } from 'vitest';
import type { LayoutEntry } from './declaration.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import { createWorkspace, manifestOf } from './workspace.fixture.js';

const LAYOUT: readonly LayoutEntry[] = [
  { src: 'ci/build.yml', dest: '.github/workflows/build.yml' },
  { src: 'ts/tsconfig.json', dest: 'tsconfig.json' },
  { src: 'repo/gitignore', dest: '.gitignore' },
  { src: 'docs/CONTRIBUTING.md', dest: 'CONTRIBUTING.md' },
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
    const { tree, declaration } = createWorkspace({ layout: LAYOUT, sources: SOURCES });

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(describePlan(plan)).toMatchSnapshot('план');
    for (const entry of LAYOUT) {
      expect(tree.read(entry.dest, 'utf-8')).toMatchSnapshot(entry.dest);
    }
  });

  it('каждый артефакт лёг байт в байт, а владение записано сбоку', () => {
    // Объявил — значит наш; но доказывается это записью в манифесте, а не
    // наклейкой внутри файла. Содержимое движок не трогает вовсе.
    const { tree, declaration } = createWorkspace({
      layout: LAYOUT,
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));

    for (const entry of LAYOUT) {
      expect(tree.read(entry.dest, 'utf-8')).toBe(
        SOURCES[entry.src as keyof typeof SOURCES],
      );
    }
    expect(manifestOf(tree).map((record) => record.dest)).toEqual(
      [...LAYOUT].map((entry) => entry.dest).sort(),
    );
  });

  it('повторный прогон ничего не делает и ничего не портит', () => {
    const { tree, declaration } = createWorkspace({ layout: LAYOUT, sources: SOURCES });
    applyPlan(tree, computePlan({ tree, declaration }));
    const materialized = LAYOUT.map((entry) => tree.read(entry.dest, 'utf-8'));

    const second = computePlan({ tree, declaration });
    applyPlan(tree, second);

    expect(second.status).toBe('converged');
    expect(second.steps).toEqual([]);
    expect(LAYOUT.map((entry) => tree.read(entry.dest, 'utf-8'))).toEqual(
      materialized,
    );
  });

  it('подтверждение, которое не понадобилось, названо и на сошедшемся дереве', () => {
    // Сходимость не глушит названные состояния: «подтвердил, а ничего не
    // изменилось» — это не молчание движка.
    const { tree, declaration } = createWorkspace({
      layout: LAYOUT,
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));

    const second = computePlan({
      tree,
      declaration,
      confirm: ['.gitignore'],
    });

    expect(second.status).toBe('converged');
    expect(second.notices.map((notice) => notice.kind)).toEqual([
      'confirmation-unused',
    ]);
    expect(describePlan(second)).toContain('план пуст');
    expect(describePlan(second)).toContain('confirmation-unused');
  });
});
