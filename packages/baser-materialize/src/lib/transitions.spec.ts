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
import type { LayoutEntry } from './declaration.js';
import { computePlan } from './plan.js';
import {
  applyPlan,
  MaterializationApplyError,
  MaterializationConflictError,
} from './apply.js';
import { hashContent } from './manifest.js';
import {
  SOURCE_ID,
  SOURCE_VERSION,
  createWorkspace,
  manifestOf,
  redeclare,
  snapshotTree,
  treeFailingOnWrite,
} from './workspace.fixture.js';

const CFG = 'cfg.yml';

const entry: LayoutEntry = { src: 'cfg.yml', dest: CFG };
const fromOther: LayoutEntry = { src: 'other.yml', dest: CFG };

const SOURCES = {
  'cfg.yml': 'setting: шаблон\n',
  'other.yml': 'setting: шаблон\n',
};

/** Материализует одну запись раскладки и возвращает рабочее дерево. */
function materialized(only: LayoutEntry = entry) {
  const fixture = createWorkspace({ layout: [only], sources: SOURCES });
  applyPlan(
    fixture.tree,
    computePlan({ tree: fixture.tree, declaration: fixture.declaration }),
  );
  return fixture;
}

describe('переход: запись появилась в layout', () => {
  it('артефакт лёг байт в байт, а владение записано сбоку', () => {
    const { tree } = materialized();

    // Содержимое движок не трогает вовсе: ни маркера, ни переслаивания.
    expect(tree.read(CFG, 'utf-8')).toBe(SOURCES['cfg.yml']);
    expect(manifestOf(tree)).toEqual([
      {
        dest: CFG,
        src: 'cfg.yml',
        source: SOURCE_ID,
        version: SOURCE_VERSION,
        class: 'regenerated',
        hash: hashContent(SOURCES['cfg.yml']),
      },
    ]);
  });
});

describe('переход: запись убрана из layout', () => {
  it('артефакт снимается — других исходов у выпиленной записи нет', () => {
    const { tree, declaration } = materialized();

    const plan = computePlan({ tree, declaration: redeclare(declaration, []) });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(tree.exists(CFG)).toBe(false);
  });

  it('правка руками не спасает артефакт от снятия, но названа в previous', () => {
    // Правка — флаг, а не переход владения (`kb:BASER2-2`): файл остаётся
    // нашим, снятие записи его убирает, и план говорит это ДО применения.
    const { tree, declaration } = materialized();
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка: моя\n`);

    const plan = computePlan({ tree, declaration: redeclare(declaration, []) });

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(plan.steps[0].previous).toContain('правка: моя');

    applyPlan(tree, plan);
    expect(tree.exists(CFG)).toBe(false);
  });
});

describe('переход: сменился объявленный src', () => {
  it('претензия приводится к декларации, даже когда тело совпало', () => {
    const { tree, declaration } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [fromOther]),
    });
    applyPlan(tree, plan);

    // Содержимое ТО ЖЕ — шаг про запись, а не про файл: `record` не трогает
    // артефакт вовсе, но молчать про приведение записи нельзя (Д10).
    expect(plan.steps[0]).toMatchObject({
      kind: 'record',
      reason: 'reclaimed',
      content: null,
    });
    expect(manifestOf(tree)[0].src).toBe('other.yml');
  });

  it('смена src поверх ПРАВКИ руками называется потерями, а не сменой записи', () => {
    // Порядок причин: пользователю первично «твои правки будут затёрты» —
    // это `diverged` с прежним содержимым в `previous`. Смена записи при этом
    // происходит тем же шагом, отдельного события не требуя.
    const { tree, declaration } = materialized();
    tree.write(CFG, `${tree.read(CFG, 'utf-8') as string}правка руками\n`);

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [fromOther]),
    });

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(plan.steps[0].previous).toContain('правка руками');
  });
});

describe('переход: шаблон уехал вперёд', () => {
  it('артефакт перегенерируется целиком с причиной diverged', () => {
    const { tree, declaration } = materialized();
    tree.write(
      `${declaration.source.contentRoot}/cfg.yml`,
      'setting: шаблон следующей версии\n',
    );

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(tree.read(CFG, 'utf-8')).toContain('следующей версии');
  });

  it('разошёлся один артефакт — в плане ровно он, а не всё дерево', () => {
    const { tree, declaration } = createWorkspace({
      layout: [entry, { src: 'other.yml', dest: 'other.yml' }],
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));
    tree.write(`${declaration.source.contentRoot}/cfg.yml`, 'setting: новое\n');

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
    const template = tree.read(CFG, 'utf-8') as string;
    tree.write(CFG, edit);

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(tree.read(CFG, 'utf-8')).toBe(template);
    expect(computePlan({ tree, declaration }).status).toBe('converged');
  });

  it('переписанный до неузнаваемости артефакт остаётся НАШИМ', () => {
    // При наклейке внутри файла правка шапки делала артефакт неопознаваемым:
    // движок терял владение и брал отказ как на чужом файле — а следом не
    // находил его сиротой, когда запись уходила из раскладки. Запись сбоку от
    // содержимого не зависит вовсе: правка это флаг, а не переход владения.
    const { tree, declaration } = materialized();
    tree.write(CFG, 'ни строчки от шаблона\n');

    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('pending');
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
    expect(plan.steps[0].previous).toBe('ни строчки от шаблона\n');
  });

  it('переписанный артефакт всё ещё находится сиротой, когда запись ушла', () => {
    const { tree, declaration } = materialized();
    tree.write(CFG, 'ни строчки от шаблона\n');

    const plan = computePlan({ tree, declaration: redeclare(declaration, []) });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(tree.exists(CFG)).toBe(false);
  });
});

describe('переход: dest существует, маркера нет', () => {
  it('отказ, снимается только поимённым подтверждением', () => {
    const { tree, declaration } = createWorkspace({
      layout: [entry],
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
      layout: [entry],
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
  const inDist: LayoutEntry = { src: 'cfg.yml', dest: 'dist/x.yml' };

  it('сирота в каталоге сборки обнаружена, а не потеряна навсегда', () => {
    const { tree, declaration } = materialized(inDist);

    const plan = computePlan({ tree, declaration: redeclare(declaration, []) });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(plan.steps[0]).toMatchObject({
      kind: 'delete',
      dest: 'dist/x.yml',
      reason: 'orphan',
    });
    expect(tree.exists('dist/x.yml')).toBe(false);
  });

  it('артефакт в служебном каталоге снимается так же: у записей нет слепых зон', () => {
    const kept: LayoutEntry = { src: 'cfg.yml', dest: 'node_modules/kept.yml' };
    const dropped: LayoutEntry = {
      src: 'cfg.yml',
      dest: 'node_modules/dropped.yml',
    };
    const { tree, declaration } = createWorkspace({
      layout: [kept, dropped],
      sources: SOURCES,
    });
    applyPlan(tree, computePlan({ tree, declaration }));

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [kept]),
    });

    // Раньше сюда не заглядывал скан, и артефакт оставался вечной сиротой.
    // Запись сбоку про каталоги ничего не знает — и знать не должна.
    expect(plan.steps).toEqual([
      expect.objectContaining({
        dest: 'node_modules/dropped.yml',
        kind: 'delete',
      }),
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
      layout: [
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
    const { tree, declaration } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [
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
    const { tree, declaration } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [
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
    const { tree, declaration } = materialized();
    const next = redeclare(declaration, [
      { src: 'other.yml', dest: `${CFG}/inner.yml` },
    ]);

    applyPlan(tree, computePlan({ tree, declaration: next }));

    expect(tree.isFile(`${CFG}/inner.yml`)).toBe(true);
    expect(computePlan({ tree, declaration: next }).status).toBe('converged');
  });

  it('обратный переход каталог → файл того же класса', () => {
    const { tree, declaration } = materialized({ src: 'cfg.yml', dest: `${CFG}/inner.yml` });

    const next = redeclare(declaration, [{ src: 'other.yml', dest: CFG }]);
    const plan = computePlan({ tree, declaration: next });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(tree.isFile(CFG)).toBe(true);
    expect(computePlan({ tree, declaration: next }).status).toBe('converged');
  });

  it('ЧУЖОЙ файл на пути продолжает мешать: послабление только для своего шага удаления', () => {
    const { tree, declaration } = createWorkspace({
      layout: [{ src: 'cfg.yml', dest: `${CFG}/inner.yml` }],
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
    const { tree, declaration } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [
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
      layout: [entry, { src: 'other.yml', dest: 'other.yml' }],
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
