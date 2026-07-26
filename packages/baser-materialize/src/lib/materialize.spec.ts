/**
 * Сквозной прогон на мок-дереве + снапшоты выходных файлов — канон
 * тестирования генераторов (`kb:BASER-3`).
 */

import { describe, expect, it } from 'vitest';
import type { FrameEntry } from './declaration.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import { createWorkspace } from './workspace.fixture.js';

const frame: readonly FrameEntry[] = [
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
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(describePlan(plan)).toMatchSnapshot('план');
    for (const entry of frame) {
      expect(tree.read(entry.dest, 'utf-8')).toMatchSnapshot(entry.dest);
    }
  });

  it('каждый объявленный артефакт несёт маркер материализации', () => {
    // Пользовательских артефактов у движка больше нет: объявил — значит наш,
    // значит перегенерируется целиком (`kb:BASER2-2`). Файл без маркера был бы
    // артефактом, владение которым движок доказать не может.
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    applyPlan(tree, computePlan({ tree, declaration }));

    for (const entry of frame) {
      expect(tree.read(entry.dest, 'utf-8')).toContain('baser-materialize');
    }
  });

  it('повторный прогон ничего не делает и ничего не портит', () => {
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    applyPlan(tree, computePlan({ tree, declaration }));
    const materialized = frame.map((entry) => tree.read(entry.dest, 'utf-8'));

    const second = computePlan({ tree, declaration });
    applyPlan(tree, second);

    expect(second.status).toBe('converged');
    expect(second.steps).toEqual([]);
    expect(frame.map((entry) => tree.read(entry.dest, 'utf-8'))).toEqual(
      materialized,
    );
  });

  it('сходимость не глушит названные состояния (извещения остаются)', () => {
    // Сошлись — но раннер сузил охват скана. Состояние обязано быть НАЗВАНО,
    // а не растворяться в «плане нет шагов».
    const { tree, declaration } = createWorkspace({ frame, sources: SOURCES });
    applyPlan(tree, computePlan({ tree, declaration }));

    const second = computePlan({
      tree,
      declaration,
      scan: { ignore: ['node_modules', 'vendor'] },
    });

    expect(second.status).toBe('converged');
    expect(second.notices.map((notice) => notice.kind)).toEqual([
      'scan-scope-narrowed',
    ]);
    expect(describePlan(second)).toContain('план пуст');
    expect(describePlan(second)).toContain('scan-scope-narrowed');
  });
});
