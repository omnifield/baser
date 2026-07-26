/**
 * МАТРИЦА ПЕРЕХОДОВ — приёмка зоны.
 *
 * Дефекты обоих ревью лежали не в том, что движок делает с файлом, а в том, что
 * происходит при СМЕНЕ объявления: в устойчивом состоянии всё сходилось с
 * первого раза. Поэтому здесь проверяется каждый переход матрицы — по одному
 * describe на строку, — а не статические кейсы.
 *
 * Матрица v2 короче прежней ровно настолько, насколько её сократил выпил
 * (`tasker:BASER2-3`): переходов между классами владения и версиями канона
 * больше нет — нет ни классов, ни хранимой версии.
 */

import { describe, expect, it } from 'vitest';
import type { FrameEntry } from './declaration.js';
import { computePlan } from './plan.js';
import {
  applyPlan,
  MaterializationApplyError,
  MaterializationConflictError,
} from './apply.js';
import { readOwnership } from './ownership.js';
import {
  createWorkspace,
  redeclare,
  snapshotTree,
  treeFailingOnWrite,
} from './workspace.fixture.js';

const CFG = 'cfg.yml';

const entry: FrameEntry = { src: 'cfg.yml', dest: CFG };
const fromOther: FrameEntry = { src: 'other.yml', dest: CFG };

const SOURCES = {
  'cfg.yml': 'setting: шаблон\n',
  'other.yml': 'setting: шаблон\n',
};

/** Материализует один `frame` и возвращает рабочее дерево. */
function materialized(frameEntry: FrameEntry = entry) {
  const fixture = createWorkspace({ frame: [frameEntry], sources: SOURCES });
  applyPlan(
    fixture.tree,
    computePlan({ tree: fixture.tree, declaration: fixture.declaration }),
  );
  return fixture;
}

describe('переход: запись появилась в frame', () => {
  it('артефакт материализован и помечен как наш', () => {
    const { tree } = materialized();

    expect(tree.read(CFG, 'utf-8')).toContain('setting: шаблон');
    expect(readOwnership(tree, CFG)).toEqual({ src: 'cfg.yml' });
  });
});

describe('переход: запись убрана из frame', () => {
  it('артефакт снимается — других исходов у выпиленной записи нет', () => {
    const { tree } = materialized();

    const plan = computePlan({ tree, declaration: redeclare(tree, []) });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(tree.exists(CFG)).toBe(false);
  });

  it('правка руками не спасает артефакт от снятия, но названа в previous', () => {
    // Правка — флаг, а не переход владения (`kb:BASER2-2`): файл остаётся
    // нашим, снятие записи его убирает, и план говорит это ДО применения.
    const { tree } = materialized();
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка: моя\n`);

    const plan = computePlan({ tree, declaration: redeclare(tree, []) });

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(plan.steps[0].previous).toContain('правка: моя');

    applyPlan(tree, plan);
    expect(tree.exists(CFG)).toBe(false);
  });
});

describe('переход: сменился объявленный src', () => {
  it('претензия приводится к декларации, даже когда тело совпало', () => {
    const { tree } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [fromOther]),
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'reclaimed' });
    expect(readOwnership(tree, CFG)).toEqual({ src: 'other.yml' });
  });

  it('смена src поверх расхождения тела остаётся reclaimed — причина не врёт', () => {
    const { tree } = materialized();
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка руками\n`);

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [fromOther]),
    });

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'reclaimed' });
    expect(plan.steps[0].previous).toContain('правка руками');
  });
});

describe('переход: шаблон уехал вперёд', () => {
  it('артефакт перегенерируется целиком с причиной diverged', () => {
    const { tree, declaration } = materialized();
    tree.write(
      `${declaration.contentRoot}/cfg.yml`,
      'setting: шаблон следующей версии\n',
    );

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(tree.read(CFG, 'utf-8')).toContain('следующей версии');
  });

  it('разошёлся один артефакт — в плане ровно он, а не всё дерево', () => {
    const { tree, declaration } = createWorkspace({
      frame: [entry, { src: 'other.yml', dest: 'other.yml' }],
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));
    tree.write(`${declaration.contentRoot}/cfg.yml`, 'setting: новое\n');

    const plan = computePlan({ tree, declaration });

    expect(plan.steps.map((step) => step.dest)).toEqual([CFG]);
  });
});

/**
 * ЦЕНТРАЛЬНЫЙ ПЕРЕХОД v2: артефакт правили руками.
 *
 * Правка нашего файла НЕ делает файл пользовательским и НЕ сводится с шаблоном:
 * следующий прогон перегенерирует артефакт целиком (`kb:BASER2-2`). Названо это
 * должно быть заранее — план несёт прежнее содержимое в `previous`.
 */
describe('переход: артефакт правили руками', () => {
  it.each([
    ['дописал строку', 'setting: шаблон\nмоя строка\n'],
    ['переписал целиком', 'совсем другое\n'],
    ['стёр содержимое', ''],
  ])('%s → правка не выживает, сходимость перегенерацией', (_case, edit) => {
    const { tree, declaration } = materialized();
    const format = tree.read(CFG, 'utf-8') as string;
    tree.write(CFG, `${format.split('\n')[0]}\n${edit}`);

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(tree.read(CFG, 'utf-8')).toBe(format);
    expect(computePlan({ tree, declaration }).status).toBe('converged');
  });

  it('правка вместе со снятым маркером — файл чужой, отказ вместо перезаписи', () => {
    // Снял маркер — движок больше не может ДОКАЗАТЬ владение и не трогает файл
    // молча: это тот же отказ, что и на изначально чужом файле.
    const { tree, declaration } = materialized();
    tree.write(CFG, 'setting: теперь моё\n');

    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({ kind: 'foreign-dest' });
    expect(tree.read(CFG, 'utf-8')).toBe('setting: теперь моё\n');
  });
});

describe('переход: dest существует, маркера нет', () => {
  it('отказ, снимается только поимённым подтверждением', () => {
    const { tree, declaration } = createWorkspace({
      frame: [entry],
      sources: SOURCES,
      existing: { [CFG]: 'setting: руками\n' },
    });

    expect(computePlan({ tree, declaration }).status).toBe('blocked');
    expect(
      computePlan({ tree, declaration, confirm: [CFG] }).steps[0],
    ).toMatchObject({ reason: 'adopted' });
  });

  it('подтверждённое усыновление перегенерирует файл, а не сводит его', () => {
    const { tree, declaration } = createWorkspace({
      frame: [entry],
      sources: SOURCES,
      existing: { [CFG]: 'setting: руками\nещё: моё\n' },
    });

    applyPlan(tree, computePlan({ tree, declaration, confirm: [CFG] }));

    expect(tree.read(CFG, 'utf-8')).not.toContain('ещё: моё');
    expect(tree.read(CFG, 'utf-8')).toContain('setting: шаблон');
  });
});

/**
 * Оптимизация скана не имеет права создавать зону, где движок не видит
 * СОБСТВЕННЫХ артефактов: иначе снятая запись оставляет вечную сироту, а план
 * при этом рапортует сходимость. Тихий сирота хуже громкого конфликта.
 */
describe('переход: артефакт объявлен в каталоге сборки', () => {
  const inDist: FrameEntry = { src: 'cfg.yml', dest: 'dist/x.yml' };

  it('сирота в каталоге сборки обнаружена, а не потеряна навсегда', () => {
    const { tree } = materialized(inDist);

    const plan = computePlan({ tree, declaration: redeclare(tree, []) });
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
    const kept: FrameEntry = { src: 'cfg.yml', dest: 'vendor/kept.yml' };
    const dropped: FrameEntry = { src: 'cfg.yml', dest: 'vendor/dropped.yml' };
    const { tree, declaration } = createWorkspace({
      frame: [kept, dropped],
      sources: SOURCES,
    });
    const scan = { ignore: ['vendor'] };
    applyPlan(tree, computePlan({ tree, declaration, scan }));

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [kept]),
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
 * Согласие не масштабируется само: подтверждение одного действия никогда не
 * подтверждает соседнее, даже однотипное.
 */
describe('переход: подтверждение дано ради одного артефакта', () => {
  const claimForeign = () => {
    const fixture = createWorkspace({
      frame: [
        { src: 'cfg.yml', dest: 'a.yml' },
        { src: 'cfg.yml', dest: 'b.yml' },
        { src: 'cfg.yml', dest: 'c.yml' },
      ],
      sources: SOURCES,
      existing: {
        'a.yml': 'моё: a\n',
        'b.yml': 'моё: b\n',
        'c.yml': 'моё: c\n',
      },
    });
    return fixture;
  };

  it('без подтверждения — три отказа, ни одного шага', () => {
    const { tree, declaration } = claimForeign();

    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('blocked');
    expect(
      plan.conflicts.map((conflict) => [conflict.dest, conflict.kind]),
    ).toEqual([
      ['a.yml', 'foreign-dest'],
      ['b.yml', 'foreign-dest'],
      ['c.yml', 'foreign-dest'],
    ]);
  });

  it('подтверждение по одному dest НЕ снимает отказ с соседних однотипных', () => {
    const { tree, declaration } = claimForeign();

    const plan = computePlan({ tree, declaration, confirm: ['b.yml'] });

    expect(plan.steps.map((step) => step.dest)).toEqual(['b.yml']);
    expect(plan.conflicts.map((conflict) => conflict.dest)).toEqual([
      'a.yml',
      'c.yml',
    ]);
    expect(plan.status).toBe('blocked');

    // План неприменим целиком — соседние файлы не трогаются даже за компанию.
    expect(() => applyPlan(tree, plan)).toThrow(MaterializationConflictError);
    expect(tree.read('a.yml', 'utf-8')).toBe('моё: a\n');
    expect(tree.read('c.yml', 'utf-8')).toBe('моё: c\n');
  });

  it('перечислив все три, потребитель получает ровно то, на что согласился', () => {
    const { tree, declaration } = claimForeign();

    const plan = computePlan({
      tree,
      declaration,
      confirm: ['a.yml', 'b.yml', 'c.yml'],
    });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(plan.steps.map((step) => [step.dest, step.reason])).toEqual([
      ['a.yml', 'adopted'],
      ['b.yml', 'adopted'],
      ['c.yml', 'adopted'],
    ]);
  });

  it('лишнее подтверждение названо извещением, а не проглочено', () => {
    const { tree, declaration } = claimForeign();

    const plan = computePlan({
      tree,
      declaration,
      confirm: ['a.yml', 'b.yml', 'c.yml', 'zzz.yml'],
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
    const { tree, declaration } = materialized();

    const plan = computePlan({ tree, declaration, confirm: [CFG] });

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
 * обязано ловиться ПЛАНОМ.
 */
describe('переход: декларация добавляет dest внутрь пути другого dest', () => {
  it('план блокируется, а не рапортует сходимость несуществующему состоянию', () => {
    const { tree } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [
        entry,
        { src: 'cfg.yml', dest: `${CFG}/inner.yml` },
      ]),
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

/**
 * Д11 (`tasker:BASER2-16`). План СОДЕРЖАЛ снятие мешающего файла и одновременно
 * объявлял состояние недостижимым: применение отклонялось целиком, дерево не
 * менялось, следующий прогон давал то же самое. Дедлок на штатной миграции,
 * снимаемый только руками по файловой системе.
 *
 * Правило узкое: препятствие снимает ТОЛЬКО шаг удаления в этом же плане.
 * Файл, который остаётся лежать законно, продолжает мешать законно.
 */
describe('переход: артефакт переобъявлен из файла в каталог', () => {
  it('снятие мешающего артефакта и создание нового идут одним планом', () => {
    const { tree } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [
        { src: 'other.yml', dest: `${CFG}/inner.yml` },
      ]),
    });

    expect(plan.status).toBe('pending');
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps.map((step) => [step.kind, step.dest])).toEqual([
      ['delete', CFG],
      ['create', `${CFG}/inner.yml`],
    ]);
  });

  it('после применения дерево сходится, а не встаёт в дедлок', () => {
    const { tree } = materialized();
    const next = redeclare(tree, [
      { src: 'other.yml', dest: `${CFG}/inner.yml` },
    ]);

    applyPlan(tree, computePlan({ tree, declaration: next }));

    expect(tree.isFile(`${CFG}/inner.yml`)).toBe(true);
    expect(computePlan({ tree, declaration: next }).status).toBe('converged');
  });

  it('обратный переход каталог → файл того же класса', () => {
    const { tree } = materialized({ src: 'cfg.yml', dest: `${CFG}/inner.yml` });

    const next = redeclare(tree, [{ src: 'other.yml', dest: CFG }]);
    const plan = computePlan({ tree, declaration: next });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(tree.isFile(CFG)).toBe(true);
    expect(computePlan({ tree, declaration: next }).status).toBe('converged');
  });

  it('ЧУЖОЙ файл на пути продолжает мешать: послабление только для своего шага удаления', () => {
    const { tree, declaration } = createWorkspace({
      frame: [{ src: 'cfg.yml', dest: `${CFG}/inner.yml` }],
      sources: SOURCES,
      existing: { [CFG]: 'настройка: продукта\n' },
    });

    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      detail: { blockedBy: CFG, collision: 'existing-file' },
    });
    expect(tree.read(CFG, 'utf-8')).toBe('настройка: продукта\n');
  });

  it('наш артефакт, ОСТАВШИЙСЯ объявленным, мешает так же законно', () => {
    const { tree } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(tree, [
        entry,
        { src: 'other.yml', dest: `${CFG}/inner.yml` },
      ]),
    });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      detail: { blockedBy: CFG, collision: 'declared-dest' },
    });
  });
});

describe('переход: прогон повторён', () => {
  it('план без шагов — идемпотентность', () => {
    const { tree, declaration } = materialized();

    expect(computePlan({ tree, declaration }).status).toBe('converged');
  });

  it('после сбоя дерево в исходном состоянии, а план тот же', () => {
    const { tree, declaration } = createWorkspace({
      frame: [entry, { src: 'other.yml', dest: 'other.yml' }],
      sources: SOURCES,
    });
    const before = snapshotTree(tree);

    const first = computePlan({ tree, declaration });
    expect(() => applyPlan(treeFailingOnWrite(tree, 2), first)).toThrow(
      MaterializationApplyError,
    );

    const retry = computePlan({ tree, declaration });

    expect(snapshotTree(tree)).toEqual(before);
    expect(retry.steps).toEqual(first.steps);

    applyPlan(tree, retry);
    expect(computePlan({ tree, declaration }).status).toBe('converged');
  });
});
