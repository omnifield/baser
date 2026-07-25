/**
 * МАТРИЦА ПЕРЕХОДОВ — приёмка зоны по `kb:BASER-5`, раздел «Контракт
 * проверяется ПЕРЕХОДАМИ, а не устойчивыми состояниями».
 *
 * Оба дефекта второго ревью лежали не в том, что движок делает с файлом, а в
 * том, что происходит при СМЕНЕ объявления или версии: в устойчивом состоянии
 * всё сходилось с первого раза. Поэтому здесь проверяется каждый переход из
 * матрицы контракта — по одному describe на строку, — а не статические кейсы.
 */

import { describe, expect, it } from 'vitest';
import type { FrameEntry } from './declaration.js';
import { computePlan } from './plan.js';
import {
  applyPlan,
  MaterializationApplyError,
  MaterializationConflictError,
} from './apply.js';
import { createTreeSource } from './source.js';
import { readOwnership } from './ownership.js';
import { ALL_DOUBLES } from './strategies.fixture.js';
import {
  createWorkspace,
  redeclare,
  snapshotTree,
  treeFailingOnWrite,
} from './workspace.fixture.js';

const CFG = 'cfg.yml';

const asExact: FrameEntry = { src: 'cfg.yml', dest: CFG, mode: 'exact' };
const asSeed: FrameEntry = { src: 'cfg.yml', dest: CFG, mode: 'seed' };
const asMerge: FrameEntry = { src: 'cfg.yml', dest: CFG, mode: 'merge' };

const SOURCES = {
  'cfg.yml': 'setting: канон\n',
  'other.yml': 'setting: канон\n',
};

/** Материализует один `frame` и возвращает рабочее дерево. */
function materialized(entry: FrameEntry, version?: string) {
  const fixture = createWorkspace({ frame: [entry], sources: SOURCES });
  const { tree, declaration } = fixture;
  applyPlan(
    tree,
    computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source: createTreeSource(tree, declaration.contentRoot, version ?? null),
    }),
  );
  return fixture;
}

describe('переход: запись появилась в frame', () => {
  it('артефакт материализован и помечен объявленным классом владения', () => {
    const { tree } = materialized(asExact);

    expect(tree.read(CFG, 'utf-8')).toContain('setting: канон');
    expect(readOwnership(tree, CFG)).toMatchObject({ own: 'engine' });
  });
});

describe('переход: запись убрана из frame', () => {
  it.each([
    ['exact', asExact, 'delete', false],
    ['merge', asMerge, 'release', true],
  ] as const)(
    'владение отпускается по классу (%s)',
    (_mode, entry, kind, survives) => {
      const { tree } = materialized(entry);

      const plan = computePlan({
        tree,
        declaration: redeclare(tree, []),
        strategies: ALL_DOUBLES,
      });
      applyPlan(tree, plan);

      expect(plan.steps[0]).toMatchObject({ kind, reason: 'orphan' });
      expect(tree.exists(CFG)).toBe(survives);
    },
  );

  it('файл продукта не трогается: маркера нет — сироты нет', () => {
    const { tree } = materialized(asSeed);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, []),
      strategies: ALL_DOUBLES,
    });

    expect(plan.status).toBe('converged');
    expect(tree.exists(CFG)).toBe(true);
  });
});

describe('переход: сменился объявленный класс владения', () => {
  it('переход в product — это шаг release, а не молчание', () => {
    const { tree } = materialized(asExact);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [asSeed]),
      strategies: ALL_DOUBLES,
    });

    // Расхождение маркера с декларацией — НЕ сходимость.
    expect(plan.status).toBe('pending');
    expect(plan.steps[0]).toMatchObject({
      kind: 'release',
      dest: CFG,
      reason: 'reclaimed',
      ownership: 'product',
    });
    expect(plan.notices).toEqual([]);

    applyPlan(tree, plan);
    expect(readOwnership(tree, CFG)).toBeNull();
    expect(tree.read(CFG, 'utf-8')).toBe('setting: канон\n');
  });

  it('после снятия претензии файл остаётся продукту, а движок молчит извещением', () => {
    const { tree } = materialized(asExact);
    const declaration = redeclare(tree, [asSeed]);
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('converged');
    expect(plan.notices[0]).toMatchObject({ kind: 'product-owned', dest: CFG });
  });

  it('переход между классами движка приводит маркер к новому классу', () => {
    const { tree } = materialized(asExact);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [asMerge]),
      strategies: ALL_DOUBLES,
    });
    applyPlan(tree, plan);

    // Тело не менялось — событие именно в смене объявленного владения.
    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      reason: 'reclaimed',
      ownership: 'shared',
    });
    expect(readOwnership(tree, CFG)).toMatchObject({
      mode: 'merge',
      own: 'shared',
    });
  });

  it('смена класса поверх расхождения тела остаётся reclaimed — причина не врёт', () => {
    const { tree } = materialized(asExact);
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка руками\n`);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [asMerge]),
      strategies: ALL_DOUBLES,
    });

    // Тело действительно разошлось, но причина шага — смена объявленного
    // владения, а не дрейф: она первична.
    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      reason: 'reclaimed',
      ownership: 'shared',
    });
    expect(plan.steps[0].previous).toContain('правка руками');
  });

  it('смена src при том же dest тоже обновляет претензию', () => {
    const { tree } = materialized(asExact);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [{ ...asExact, src: 'other.yml' }]),
      strategies: ALL_DOUBLES,
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ reason: 'reclaimed' });
    expect(readOwnership(tree, CFG)).toMatchObject({ src: 'other.yml' });
  });
});

/**
 * Подтверждения требует ЛЮБОЕ действие, отнимающее у продукта права или
 * содержимое, и никогда — действие, права возвращающее (`kb:BASER-5`, «Сужение
 * владения до единоличного требует явного подтверждения»). Гейт строгости стоит
 * на стороне потребителя, а не на стороне удобства фундамента.
 */
describe('переход: сужение владения shared → engine', () => {
  it('без подтверждения — конфликт, а не шаг: у продукта отнимают право на вклад', () => {
    const { tree } = materialized(asMerge);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [asExact]),
      strategies: ALL_DOUBLES,
    });

    expect(plan.status).toBe('blocked');
    expect(plan.steps).toEqual([]);
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'ownership-narrowing',
      dest: CFG,
      ownership: 'engine',
      detail: {
        resolution: 'confirm',
        fromOwnership: 'shared',
        toOwnership: 'engine',
      },
    });
  });

  it('под поимённым подтверждением — проходит и забирает владение', () => {
    const { tree } = materialized(asMerge);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [asExact]),
      strategies: ALL_DOUBLES,
      confirm: [CFG],
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      reason: 'reclaimed',
      ownership: 'engine',
    });
    expect(readOwnership(tree, CFG)).toMatchObject({ own: 'engine' });
  });

  it('обратное направление подтверждения не требует — движок отдаёт права', () => {
    const { tree } = materialized(asExact);

    const widening = computePlan({
      tree,
      declaration: redeclare(tree, [asMerge]),
      strategies: ALL_DOUBLES,
    });
    applyPlan(tree, widening);
    const releasing = computePlan({
      tree,
      declaration: redeclare(tree, [asSeed]),
      strategies: ALL_DOUBLES,
    });

    expect(widening.status).toBe('pending');
    expect(widening.conflicts).toEqual([]);
    expect(releasing.conflicts).toEqual([]);
    expect(releasing.steps[0]).toMatchObject({ kind: 'release' });
  });
});

/**
 * ЦЕПОЧКА из ревью №3: `merge` → вклад продукта → `exact`. Вклад продукта
 * законен — это и есть смысл `shared`, — поэтому отнять его молча нельзя.
 */
describe('цепочка merge → вклад продукта → exact', () => {
  it('без подтверждения вклад цел, план заблокирован; под подтверждением уходит осознанно', () => {
    const { tree } = materialized(asMerge);
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}вклад продукта\n`);

    const declaration = redeclare(tree, [asExact]);
    const blocked = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(blocked.status).toBe('blocked');
    expect(() => applyPlan(tree, blocked)).toThrow(
      MaterializationConflictError,
    );
    expect(tree.read(CFG, 'utf-8')).toContain('вклад продукта');

    const forced = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: [CFG],
    });
    applyPlan(tree, forced);

    expect(tree.read(CFG, 'utf-8')).not.toContain('вклад продукта');
    expect(
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }).status,
    ).toBe('converged');
  });
});

/**
 * ЦЕПОЧКА из ревью: `exact` → `seed` → правка продукта → снятие записи.
 * Файл продукта обязан пережить её целиком — именно здесь оставленный маркер
 * приводил к молчаливому удалению чужих правок.
 */
describe('цепочка exact → seed → правка → снятие записи', () => {
  it('файл продукта переживает всю цепочку вместе с правками', () => {
    const { tree } = materialized(asExact);

    const asProduct = redeclare(tree, [asSeed]);
    applyPlan(
      tree,
      computePlan({ tree, declaration: asProduct, strategies: ALL_DOUBLES }),
    );

    // Правим файл, НЕ трогая шапку: продукт не обязан замечать служебную
    // строку. Именно так оставленный маркер и приводил к потере правок.
    tree.write(
      CFG,
      `${tree.read(CFG, 'utf-8') as string}правка продукта: да\n`,
    );

    const dropped = computePlan({
      tree,
      declaration: redeclare(tree, []),
      strategies: ALL_DOUBLES,
    });
    applyPlan(tree, dropped);

    expect(dropped.status).toBe('converged');
    expect(tree.exists(CFG)).toBe(true);
    expect(tree.read(CFG, 'utf-8')).toContain('правка продукта: да');
    expect(readOwnership(tree, CFG)).toBeNull();
  });
});

describe('переход: сменилась версия канона', () => {
  it('тело то же — шага нет: версия это провенанс, а не основание', () => {
    const { tree, declaration } = materialized(asExact, '1.0.0');

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source: createTreeSource(tree, declaration.contentRoot, '1.1.0'),
    });

    expect(plan.status).toBe('converged');
    expect(plan.steps).toEqual([]);
    expect(readOwnership(tree, CFG)).toMatchObject({ version: '1.0.0' });
  });

  it('тело другое — шаг с честной причиной, версия обновляется вместе с телом', () => {
    const { tree, declaration } = materialized(asExact, '1.0.0');
    tree.write(
      `${declaration.contentRoot}/cfg.yml`,
      'setting: канон следующей версии\n',
    );

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source: createTreeSource(tree, declaration.contentRoot, '1.1.0'),
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(readOwnership(tree, CFG)).toMatchObject({ version: '1.1.0' });
  });

  it('бамп версии не поднимает шума у соседних артефактов', () => {
    const { tree, declaration } = createWorkspace({
      frame: [asExact, { src: 'other.yml', dest: 'other.yml', mode: 'exact' }],
      sources: SOURCES,
    });
    const at = (version: string) =>
      createTreeSource(tree, declaration.contentRoot, version);
    applyPlan(
      tree,
      computePlan({
        tree,
        declaration,
        strategies: ALL_DOUBLES,
        source: at('1.0.0'),
      }),
    );
    tree.write(`${declaration.contentRoot}/cfg.yml`, 'setting: новое\n');

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source: at('2.0.0'),
    });

    // Разошёлся один артефакт — в плане ровно он, а не всё дерево.
    expect(plan.steps.map((step) => step.dest)).toEqual([CFG]);
  });
});

describe('переход: dest существует, маркера нет', () => {
  it('engine — отказ, снимается только поимённым подтверждением', () => {
    const { tree, declaration } = createWorkspace({
      frame: [asExact],
      sources: SOURCES,
      existing: { [CFG]: 'setting: руками\n' },
    });

    expect(
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }).status,
    ).toBe('blocked');
    expect(
      computePlan({
        tree,
        declaration,
        strategies: ALL_DOUBLES,
        confirm: [CFG],
      }).steps[0],
    ).toMatchObject({ reason: 'adopted' });
  });

  it('shared — взятие во владение с причиной adopted', () => {
    const { tree, declaration } = createWorkspace({
      frame: [asMerge],
      sources: SOURCES,
      existing: { [CFG]: 'setting: руками\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.steps[0]).toMatchObject({ reason: 'adopted' });
  });

  it('product — файл не трогается вовсе', () => {
    const { tree, declaration } = createWorkspace({
      frame: [asSeed],
      sources: SOURCES,
      existing: { [CFG]: 'setting: руками\n' },
    });

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('converged');
    expect(tree.read(CFG, 'utf-8')).toBe('setting: руками\n');
  });
});

describe('переход: артефакт правили руками', () => {
  it('engine — правка не сохраняется, сходимость перегенерацией', () => {
    const { tree, declaration } = materialized(asExact);
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка: да\n`);

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ reason: 'diverged' });
    expect(tree.read(CFG, 'utf-8')).not.toContain('правка: да');
  });

  it('shared — вклад продукта переживает сходимость', () => {
    const { tree, declaration } = materialized(asMerge);
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка: да\n`);

    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    expect(tree.read(CFG, 'utf-8')).toContain('правка: да');
    expect(tree.read(CFG, 'utf-8')).toContain('setting: канон');
  });

  it('product — правка не трогается', () => {
    const { tree, declaration } = materialized(asSeed);
    tree.write(CFG, 'setting: моё\n');

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('converged');
    expect(tree.read(CFG, 'utf-8')).toBe('setting: моё\n');
  });
});

/**
 * Оптимизация скана не имеет права создавать зону, где движок не видит
 * СОБСТВЕННЫХ артефактов (`kb:BASER-5`, «У скана нет слепых зон над
 * собственными артефактами»): иначе снятая запись оставляет вечную сироту,
 * а план при этом рапортует сходимость. Тихий сирота хуже громкого конфликта.
 */
describe('переход: артефакт объявлен в каталоге сборки', () => {
  const inDist: FrameEntry = {
    src: 'cfg.yml',
    dest: 'dist/x.yml',
    mode: 'exact',
  };

  it('сирота в каталоге сборки обнаружена, а не потеряна навсегда', () => {
    const { tree } = materialized(inDist);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, []),
      strategies: ALL_DOUBLES,
    });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(plan.steps[0]).toMatchObject({
      kind: 'delete',
      dest: 'dist/x.yml',
      reason: 'orphan',
    });
    expect(tree.exists('dist/x.yml')).toBe(false);
  });

  it('объявленный каталог сканируется даже под явным пропуском', () => {
    const kept: FrameEntry = {
      src: 'cfg.yml',
      dest: 'vendor/kept.yml',
      mode: 'exact',
    };
    const dropped: FrameEntry = {
      src: 'cfg.yml',
      dest: 'vendor/dropped.yml',
      mode: 'exact',
    };
    const { tree, declaration } = createWorkspace({
      frame: [kept, dropped],
      sources: SOURCES,
    });
    const scan = { ignore: ['vendor'] };
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES, scan }),
    );

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [kept]),
      strategies: ALL_DOUBLES,
      scan,
    });

    // `vendor` пропускается по просьбе раннера, но движок туда материализует —
    // значит слепой зоны над своими артефактами там быть не может.
    expect(plan.steps).toEqual([
      expect.objectContaining({ dest: 'vendor/dropped.yml', kind: 'delete' }),
    ]);
  });
});

/**
 * Согласие не масштабируется само (`kb:BASER-5`, «Подтверждение адресно, а не
 * глобально»): подтверждение одного действия никогда не подтверждает соседнее,
 * даже однотипное. Зонд ревью: подтверждение ради `b.yml` не должно усыновлять
 * чужие `a.yml` и `c.yml`.
 */
describe('переход: подтверждение дано ради одного артефакта', () => {
  const tighten = () => {
    const { tree, declaration } = createWorkspace({
      frame: [{ src: 'cfg.yml', dest: 'b.yml', mode: 'merge' }],
      sources: SOURCES,
      existing: { 'a.yml': 'моё: a\n', 'c.yml': 'моё: c\n' },
    });
    applyPlan(
      tree,
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }),
    );

    return {
      tree,
      declaration: redeclare(tree, [
        { src: 'cfg.yml', dest: 'a.yml', mode: 'exact' },
        { src: 'cfg.yml', dest: 'b.yml', mode: 'exact' },
        { src: 'cfg.yml', dest: 'c.yml', mode: 'exact' },
      ]),
    };
  };

  it('без подтверждения — три отказа, ни одного шага', () => {
    const { tree, declaration } = tighten();

    const plan = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(plan.status).toBe('blocked');
    expect(
      plan.conflicts.map((conflict) => [conflict.dest, conflict.kind]),
    ).toEqual([
      ['a.yml', 'foreign-dest'],
      ['b.yml', 'ownership-narrowing'],
      ['c.yml', 'foreign-dest'],
    ]);
  });

  it('подтверждение по одному dest НЕ снимает отказ с соседних однотипных', () => {
    const { tree, declaration } = tighten();

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: ['b.yml'],
    });

    expect(plan.steps.map((step) => step.dest)).toEqual(['b.yml']);
    expect(plan.conflicts.map((conflict) => conflict.dest)).toEqual([
      'a.yml',
      'c.yml',
    ]);
    expect(plan.status).toBe('blocked');

    // План неприменим целиком — файлы продукта не трогаются даже за компанию.
    expect(() => applyPlan(tree, plan)).toThrow(MaterializationConflictError);
    expect(tree.read('a.yml', 'utf-8')).toBe('моё: a\n');
    expect(tree.read('c.yml', 'utf-8')).toBe('моё: c\n');
  });

  it('перечислив все три, потребитель получает ровно то, на что согласился', () => {
    const { tree, declaration } = tighten();

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: ['a.yml', 'b.yml', 'c.yml'],
    });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(plan.steps.map((step) => [step.dest, step.reason])).toEqual([
      ['a.yml', 'adopted'],
      ['b.yml', 'reclaimed'],
      ['c.yml', 'adopted'],
    ]);
  });

  it('лишнее подтверждение названо извещением, а не проглочено', () => {
    const { tree, declaration } = tighten();

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: ['b.yml', 'zzz.yml'],
    });

    expect(plan.notices).toEqual([
      expect.objectContaining({
        kind: 'confirmation-unused',
        dest: 'zzz.yml',
        detail: { confirmation: 'not-declared' },
      }),
    ]);
  });

  it('подтверждение там, где отказа нет, тоже названо', () => {
    const { tree, declaration } = materialized(asExact);

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      confirm: [CFG],
    });

    expect(plan.status).toBe('converged');
    expect(plan.notices[0]).toMatchObject({
      kind: 'confirmation-unused',
      dest: CFG,
      detail: { confirmation: 'not-required' },
    });
  });
});

/**
 * Атомарность кончается на границе дерева: сброс на диск делает раннер, и его
 * сбой — уже вне журнала отката. Состояние, которого не бывает на реальной ФС,
 * обязано ловиться ПЛАНОМ (`kb:BASER-5`).
 */
describe('переход: декларация добавляет dest внутрь пути другого dest', () => {
  it('план блокируется, а не рапортует сходимость несуществующему состоянию', () => {
    const { tree } = materialized(asExact);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [
        asExact,
        { src: 'cfg.yml', dest: `${CFG}/inner.yml`, mode: 'exact' },
      ]),
      strategies: ALL_DOUBLES,
    });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      dest: `${CFG}/inner.yml`,
      detail: { blockedBy: CFG, collision: 'declared-dest' },
    });
    expect(() => applyPlan(tree, plan)).toThrow(MaterializationConflictError);
  });
});

describe('переход: прогон повторён', () => {
  it('план без шагов — идемпотентность', () => {
    const { tree, declaration } = materialized(asExact, '1.0.0');

    const plan = computePlan({
      tree,
      declaration,
      strategies: ALL_DOUBLES,
      source: createTreeSource(tree, declaration.contentRoot, '1.0.0'),
    });

    expect(plan.status).toBe('converged');
  });

  it('после сбоя дерево в исходном состоянии, а план тот же', () => {
    const { tree, declaration } = createWorkspace({
      frame: [asExact, { src: 'other.yml', dest: 'other.yml', mode: 'exact' }],
      sources: SOURCES,
    });
    const before = snapshotTree(tree);

    const first = computePlan({ tree, declaration, strategies: ALL_DOUBLES });
    expect(() => applyPlan(treeFailingOnWrite(tree, 2), first)).toThrow(
      MaterializationApplyError,
    );

    const retry = computePlan({ tree, declaration, strategies: ALL_DOUBLES });

    expect(snapshotTree(tree)).toEqual(before);
    expect(retry.steps).toEqual(first.steps);

    applyPlan(tree, retry);
    expect(
      computePlan({ tree, declaration, strategies: ALL_DOUBLES }).status,
    ).toBe('converged');
  });
});
