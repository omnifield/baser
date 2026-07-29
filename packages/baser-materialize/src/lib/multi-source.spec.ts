/**
 * ПРИЁМКА `tasker:BASER2-7` — движок ведёт владение по каждому обвесу отдельно.
 *
 * Несколько инструментов в одном репозитории — норма по построению
 * (`kb:BASER2-4`), а прогон идёт по ОДНОЙ декларации. Манифест при этом один на
 * репозиторий, и до фикса из него следовало ровно обратное фундаменту: сиротой
 * считалась всякая запись без объявления, включая запись соседнего обвеса.
 * Поставил второй — снёсся первый, вернул первый — снёсся второй.
 *
 * Отсюда два инварианта, и оба проверяются ПЕРЕХОДАМИ, а не устойчивым
 * состоянием (в статике всё сходилось и до фикса):
 *   — прогон распоряжается только записями СВОЕГО обвеса: чужие ему не сироты;
 *   — столкновение двух обвесов на один `dest` НАЗЫВАЕТСЯ вслух и не
 *     разрешается ни порядком записей, ни порядком прогонов (`kb:BASER2-6`).
 */

import { describe, expect, it } from 'vitest';
import type { Tree } from '@nx/devkit';
import type { Declaration } from './declaration.js';
import { computePlan } from './plan.js';
import { MaterializationConflictError, applyPlan } from './apply.js';
import { MANIFEST_PATH } from './manifest.js';
import { addSource, createWorkspace, manifestOf } from './workspace.fixture.js';

const DEVBOX = 'omnifield/devbox';
const AGENTS = 'omnifield/agent-harness';

const DEVBOX_ROOT = 'node_modules/@omnifield/baser-devbox/template';
const AGENTS_ROOT = 'node_modules/@omnifield/brain-harness/template';

const DEVCONTAINER = '.devcontainer/devcontainer.json';
const HARNESS = '.omnifield/harness.yaml';
const POLICY = '.claude/agents/shared-policy.md';

const DEVCONTAINER_BODY = '{ "name": "baser-devbox" }\n';
const HARNESS_BODY = 'product: baser\n';
const POLICY_BODY = '# shared-policy\n';

interface TwoTools {
  readonly tree: Tree;
  readonly devbox: Declaration;
  readonly agents: Declaration;
}

/** Девбокс и плагин агентов в одном репозитории — живой случай `BASER2-44`. */
function twoTools(): TwoTools {
  const { tree, declaration: devbox } = createWorkspace({
    sourceId: DEVBOX,
    contentRoot: DEVBOX_ROOT,
    layout: [{ src: 'devcontainer.json', dest: DEVCONTAINER }],
    sources: { 'devcontainer.json': DEVCONTAINER_BODY },
  });

  const agents = addSource(tree, {
    id: AGENTS,
    contentRoot: AGENTS_ROOT,
    layout: [
      { src: 'harness.yaml', dest: HARNESS },
      { src: 'shared-policy.md', dest: POLICY },
    ],
    sources: { 'harness.yaml': HARNESS_BODY, 'shared-policy.md': POLICY_BODY },
  });

  return { tree, devbox, agents };
}

/** Обвес, целящийся в артефакт девбокса, — столкновение на один путь. */
function rivalOf(tree: Tree): Declaration {
  return addSource(tree, {
    id: AGENTS,
    contentRoot: AGENTS_ROOT,
    layout: [{ src: 'devcontainer.json', dest: DEVCONTAINER }],
    sources: { 'devcontainer.json': '{ "name": "не девбокс" }\n' },
  });
}

function materialize(tree: Tree, declaration: Declaration): void {
  applyPlan(tree, computePlan({ tree, declaration }));
}

describe('два инструмента ложатся в один репозиторий', () => {
  it('второй обвес садится, не снимая артефактов первого', () => {
    const { tree, devbox, agents } = twoTools();

    materialize(tree, devbox);
    materialize(tree, agents);

    expect(tree.read(DEVCONTAINER, 'utf-8')).toBe(DEVCONTAINER_BODY);
    expect(tree.read(HARNESS, 'utf-8')).toBe(HARNESS_BODY);
    expect(tree.read(POLICY, 'utf-8')).toBe(POLICY_BODY);
  });

  it('в паспорте укладки у каждой записи назван СВОЙ обвес', () => {
    const { tree, devbox, agents } = twoTools();

    materialize(tree, devbox);
    materialize(tree, agents);

    expect(
      manifestOf(tree).map((record) => [record.dest, record.source]),
    ).toEqual([
      [POLICY, AGENTS],
      [DEVCONTAINER, DEVBOX],
      [HARNESS, AGENTS],
    ]);
  });

  it('записи соседнего обвеса сиротами не считаются — их в плане нет вовсе', () => {
    const { tree, devbox, agents } = twoTools();
    materialize(tree, devbox);

    const plan = computePlan({ tree, declaration: agents });

    // Ни одного шага по чужому артефакту: ни снятия, ни приведения записи.
    expect(plan.steps.map((step) => [step.kind, step.dest])).toEqual([
      ['create', POLICY],
      ['create', HARNESS],
    ]);
    expect(plan.status).toBe('pending');
  });

  it('прогон второго обвеса не трогает файл первого на диске', () => {
    const { tree, devbox, agents } = twoTools();
    materialize(tree, devbox);
    const landed = tree.read(DEVCONTAINER, 'utf-8');

    materialize(tree, agents);

    expect(tree.exists(DEVCONTAINER)).toBe(true);
    expect(tree.read(DEVCONTAINER, 'utf-8')).toBe(landed);
  });
});

describe('повторные прогоны переживаются в любом порядке', () => {
  const ORDERS: ReadonlyArray<
    readonly ['devbox' | 'agents', ...('devbox' | 'agents')[]]
  > = [
    ['devbox', 'agents', 'devbox', 'agents'],
    ['agents', 'devbox', 'agents', 'devbox'],
    ['devbox', 'agents', 'agents', 'devbox'],
    ['agents', 'agents', 'devbox', 'devbox'],
    ['devbox', 'devbox', 'agents', 'devbox', 'agents'],
  ];

  it.each(ORDERS.map((order) => [order.join(' → '), order] as const))(
    'порядок %s: дерево и владение те же',
    (_name, order) => {
      const { tree, devbox, agents } = twoTools();

      for (const turn of order) {
        materialize(tree, turn === 'devbox' ? devbox : agents);
      }

      expect(tree.read(DEVCONTAINER, 'utf-8')).toBe(DEVCONTAINER_BODY);
      expect(tree.read(HARNESS, 'utf-8')).toBe(HARNESS_BODY);
      expect(tree.read(POLICY, 'utf-8')).toBe(POLICY_BODY);
      expect(manifestOf(tree).map((record) => record.source)).toEqual([
        AGENTS,
        DEVBOX,
        AGENTS,
      ]);
    },
  );

  it('оба обвеса сошлись одновременно — сходимость не по очереди', () => {
    const { tree, devbox, agents } = twoTools();

    materialize(tree, devbox);
    materialize(tree, agents);

    expect(computePlan({ tree, declaration: devbox }).status).toBe('converged');
    expect(computePlan({ tree, declaration: agents }).status).toBe('converged');
  });
});

describe('снятие обвеса не задевает соседа', () => {
  it('выпиленная раскладка убирает СВОИ артефакты и только их', () => {
    const { tree, devbox, agents } = twoTools();
    materialize(tree, devbox);
    materialize(tree, agents);

    materialize(tree, { ...devbox, layout: [] });

    expect(tree.exists(DEVCONTAINER)).toBe(false);
    expect(tree.read(HARNESS, 'utf-8')).toBe(HARNESS_BODY);
    expect(tree.read(POLICY, 'utf-8')).toBe(POLICY_BODY);
    expect(manifestOf(tree).map((record) => record.dest)).toEqual([
      POLICY,
      HARNESS,
    ]);
    expect(computePlan({ tree, declaration: agents }).status).toBe('converged');
  });

  it('манифест остаётся файлом, пока в нём жив хоть один обвес', () => {
    const { tree, devbox, agents } = twoTools();
    materialize(tree, devbox);
    materialize(tree, agents);

    materialize(tree, { ...agents, layout: [] });

    expect(tree.exists(MANIFEST_PATH)).toBe(true);
    expect(manifestOf(tree)).toEqual([
      expect.objectContaining({ dest: DEVCONTAINER, source: DEVBOX }),
    ]);
  });
});

describe('столкновение двух обвесов на один путь называется вслух', () => {
  it('отказ cross-source-dest вместо перехвата артефакта', () => {
    const { tree, devbox } = twoTools();
    materialize(tree, devbox);
    const rival = rivalOf(tree);

    const plan = computePlan({ tree, declaration: rival });

    expect(plan.status).toBe('blocked');
    expect(plan.steps).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        kind: 'cross-source-dest',
        dest: DEVCONTAINER,
        src: 'devcontainer.json',
        detail: { ownedBy: DEVBOX, resolution: 'drop-layout-entry' },
      }),
    ]);
    // Причина доступна данными, а текст лишь называет обе стороны.
    expect(plan.conflicts[0].message).toContain(DEVBOX);
    expect(plan.conflicts[0].message).toContain(AGENTS);
  });

  it('спорный артефакт не тронут, а применение отклонено целиком', () => {
    const { tree, devbox } = twoTools();
    materialize(tree, devbox);
    const rival = rivalOf(tree);

    const plan = computePlan({ tree, declaration: rival });

    expect(() => applyPlan(tree, plan)).toThrow(MaterializationConflictError);
    expect(tree.read(DEVCONTAINER, 'utf-8')).toBe(DEVCONTAINER_BODY);
    expect(manifestOf(tree)).toEqual([
      expect.objectContaining({ dest: DEVCONTAINER, source: DEVBOX }),
    ]);
  });

  it('порядок прогонов столкновение не решает — отказ в обе стороны', () => {
    // Тот же спор, разыгранный с другого конца: первым лёг плагин агентов.
    const { tree, devbox } = twoTools();
    const rival = rivalOf(tree);
    materialize(tree, rival);

    const plan = computePlan({ tree, declaration: devbox });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'cross-source-dest',
      dest: DEVCONTAINER,
      detail: { ownedBy: AGENTS },
    });
  });

  it('подтверждение столкновение не снимает и названо неприменимым', () => {
    const { tree, devbox } = twoTools();
    materialize(tree, devbox);
    const rival = rivalOf(tree);

    const plan = computePlan({
      tree,
      declaration: rival,
      confirm: [DEVCONTAINER],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0].kind).toBe('cross-source-dest');
    expect(plan.steps).toEqual([]);
    expect(plan.notices).toEqual([
      expect.objectContaining({
        kind: 'confirmation-unused',
        dest: DEVCONTAINER,
        detail: { confirmation: 'not-applicable' },
      }),
    ]);
  });

  it('снесённый руками файл столкновения не отменяет: спорит запись, а не диск', () => {
    const { tree, devbox } = twoTools();
    materialize(tree, devbox);
    const rival = rivalOf(tree);
    tree.delete(DEVCONTAINER);

    const plan = computePlan({ tree, declaration: rival });

    // Иначе сосед забирал бы артефакт себе «созданием впервые», и владение
    // решалось бы тем, кто успел снести файл.
    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'cross-source-dest',
      detail: { ownedBy: DEVBOX },
    });
    expect(plan.steps).toEqual([]);
  });

  it('артефакт соседа на пути мешает законно, а не снимается как сирота', () => {
    const { tree, devbox } = twoTools();
    materialize(tree, devbox);
    const nested = addSource(tree, {
      id: AGENTS,
      contentRoot: AGENTS_ROOT,
      layout: [{ src: 'nested.json', dest: `${DEVCONTAINER}/nested.json` }],
      sources: { 'nested.json': '{}\n' },
    });

    const plan = computePlan({ tree, declaration: nested });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      detail: { blockedBy: DEVCONTAINER, collision: 'existing-file' },
    });
    expect(tree.exists(DEVCONTAINER)).toBe(true);
  });
});

describe('трейс называет долю обвеса в общем паспорте', () => {
  it('plan.owned отделяет свои записи от всех, а plan.orphans считает сирот', () => {
    const { tree, devbox, agents } = twoTools();
    materialize(tree, devbox);

    const plan = computePlan({ tree, declaration: agents });

    expect(
      plan.trace.find((span) => span.name === 'plan.owned')?.detail,
    ).toEqual({ source: AGENTS, records: 1, own: 0 });
    expect(
      plan.trace.find((span) => span.name === 'plan.orphans')?.detail,
    ).toEqual({ orphans: 0 });
  });
});
