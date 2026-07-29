/**
 * ВЕРСИЯ ОБВЕСА В ПАСПОРТЕ УКЛАДКИ — приёмка `tasker:BASER2-52`, движковая часть.
 *
 * Второго места для версии не заводим (`tasker:BASER2-10` §1): в объявлении
 * обвеса поля `version` нет и не будет, версия живёт в манифесте пакета. Работа
 * движка ровно одна — принять её как часть источника, положить в запись рядом с
 * `dest`/`src`/`source`/`hash` и следить, чтобы запись утверждала СЕГОДНЯШНЮЮ.
 *
 * Дверь версию уже знает, но движку пока не передаёт — это отдельный заход в
 * зоне `cli`. Поэтому здесь же закрыт вопрос «а что, если версии нет»: молчаливой
 * пустой строки в паспорте укладки быть не должно ни на один прогон.
 */

import { describe, expect, it } from 'vitest';
import type { LayoutEntry } from './declaration.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import { MANIFEST_PATH } from './manifest.js';
import { DeclarationError } from './errors.js';
import {
  SOURCE_ID,
  SOURCE_VERSION,
  createWorkspace,
  manifestOf,
  reversion,
} from './workspace.fixture.js';

const CFG = '.devcontainer/devcontainer.json';

const entry: LayoutEntry = { src: 'devcontainer.json', dest: CFG };
const placedOnce: LayoutEntry = { ...entry, class: 'placed-once' };

const SOURCES = { 'devcontainer.json': '{ "name": "baser" }\n' };

function materialized(
  layout: readonly LayoutEntry[] = [entry],
  sourceVersion?: string | null,
) {
  const fixture = createWorkspace({
    layout,
    sources: SOURCES,
    ...(sourceVersion === undefined ? {} : { sourceVersion }),
  });
  applyPlan(
    fixture.tree,
    computePlan({ tree: fixture.tree, declaration: fixture.declaration }),
  );
  return fixture;
}

describe('запись паспорта укладки несёт версию обвеса', () => {
  it('версия названа в записи и попадает в файл', () => {
    const { tree } = materialized();

    expect(manifestOf(tree)[0]).toMatchObject({
      source: SOURCE_ID,
      version: SOURCE_VERSION,
    });
    expect(tree.read(MANIFEST_PATH, 'utf-8')).toContain(
      `"version": "${SOURCE_VERSION}"`,
    );
  });

  it('placed-once тоже несёт версию: она про то, КТО положил, а не про то, как держим', () => {
    const { tree } = materialized([placedOnce]);

    expect(manifestOf(tree)[0]).toMatchObject({
      version: SOURCE_VERSION,
      class: 'placed-once',
    });
  });
});

describe('переход: подняли версию обвеса', () => {
  it('повторный прогон видит расхождение и НАЗЫВАЕТ, чем именно', () => {
    // Содержимое то же самое — и без сверки версии прогон прошёл бы молча,
    // а паспорт укладки продолжал бы называть вчерашнюю версию.
    const { tree, declaration } = materialized();

    const plan = computePlan({
      tree,
      declaration: reversion(declaration, '2.0.0'),
    });

    expect(plan.status).toBe('pending');
    expect(plan.steps[0]).toMatchObject({
      kind: 'record',
      dest: CFG,
      reason: 'reclaimed',
      restated: ['version'],
      content: null,
    });
    expect(describePlan(plan)).toContain('reclaimed: version');
  });

  it('после применения запись называет новую версию, а прогон сходится', () => {
    const { tree, declaration } = materialized();
    const next = reversion(declaration, '2.0.0');

    applyPlan(tree, computePlan({ tree, declaration: next }));

    expect(manifestOf(tree)[0].version).toBe('2.0.0');
    expect(computePlan({ tree, declaration: next }).status).toBe('converged');
  });

  it('содержимое артефакта при этом не трогается вовсе', () => {
    const { tree, declaration } = materialized();
    const before = tree.read(CFG, 'utf-8');

    const plan = computePlan({
      tree,
      declaration: reversion(declaration, '2.0.0'),
    });
    applyPlan(tree, plan);

    // Ровно один шаг, и он про запись: подъём версии файла не касается.
    expect(plan.steps.map((step) => step.kind)).toEqual(['record']);
    expect(tree.read(CFG, 'utf-8')).toBe(before);
  });

  it('у placed-once подъём версии тоже приводит запись, содержимого не касаясь', () => {
    const { tree, declaration } = materialized([placedOnce]);
    tree.write(CFG, '{ "name": "правил человек" }\n');
    applyPlan(tree, computePlan({ tree, declaration }));

    const plan = computePlan({
      tree,
      declaration: reversion(declaration, '2.0.0'),
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({
      kind: 'record',
      reason: 'reclaimed',
      restated: ['version'],
    });
    expect(tree.read(CFG, 'utf-8')).toBe('{ "name": "правил человек" }\n');
    expect(manifestOf(tree)[0].version).toBe('2.0.0');
  });

  it('версия и шаблон, уехавшие разом, названы оба', () => {
    const { tree, declaration } = materialized();
    const next = reversion(declaration, '2.0.0');
    // Шаблон переехал в другой файл, содержимое прежнее.
    tree.write(
      `${declaration.source.contentRoot}/devcontainer-2.json`,
      SOURCES['devcontainer.json'],
    );

    const plan = computePlan({
      tree,
      declaration: {
        ...next,
        layout: [{ src: 'devcontainer-2.json', dest: CFG }],
      },
    });

    expect(plan.steps[0]).toMatchObject({
      reason: 'reclaimed',
      restated: ['src', 'version'],
    });
  });
});

describe('версии нет — отсутствие НАЗВАНО, а не пропущено', () => {
  it('в записи стоит null, и ключ в файле есть', () => {
    // `null` — слово «неизвестно». Пропуск ключа читался бы как «форма такого
    // не знает», а пустая строка притворялась бы версией.
    const { tree, declaration } = createWorkspace({
      layout: [entry],
      sources: SOURCES,
      sourceVersion: null,
    });

    applyPlan(tree, computePlan({ tree, declaration }));

    expect(manifestOf(tree)[0].version).toBeNull();
    expect(tree.read(MANIFEST_PATH, 'utf-8')).toContain('"version": null');
  });

  it('трейс называет версию прогона — в том числе её отсутствие', () => {
    // «Каким обвесом и какой версии шёл прогон» — первое, что спрашивают, когда
    // у потребителя что-то поехало.
    const { tree, declaration } = materialized([entry], null);

    expect(
      computePlan({ tree, declaration }).trace.find(
        (span) => span.name === 'plan.owned',
      )?.detail,
    ).toMatchObject({ source: SOURCE_ID, version: null });
  });

  it('отдельного извещения на прогон нет: план молчит о том, чего не делает', () => {
    // Оно было бы верно по сути, но встало бы на каждый прогон каждого
    // потребителя, пока версию не начнёт подавать дверь, — то есть отчитывалось
    // бы о незакрытом заходе в соседней зоне, а не о состоянии репозитория.
    const { tree, declaration } = materialized([entry], null);

    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('converged');
    expect(plan.notices).toEqual([]);
  });

  it('версия приехала — запись приводится к правде', () => {
    const { tree, declaration } = materialized([entry], null);

    const plan = computePlan({
      tree,
      declaration: reversion(declaration, '1.0.0'),
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({
      reason: 'reclaimed',
      restated: ['version'],
    });
    expect(manifestOf(tree)[0].version).toBe('1.0.0');
  });

  it('пустая строка вместо версии — отказ: молчаливой пустоты в паспорте не будет', () => {
    const { tree, declaration } = createWorkspace({
      layout: [entry],
      sources: SOURCES,
      sourceVersion: '   ',
    });

    expect(() => computePlan({ tree, declaration })).toThrowError(
      DeclarationError,
    );
    expect(() => computePlan({ tree, declaration })).toThrowError(/null/);
  });

  it('версия не строкой — отказ формы входа', () => {
    const { tree, declaration } = createWorkspace({
      layout: [entry],
      sources: SOURCES,
    });

    expect(() =>
      computePlan({
        tree,
        declaration: {
          ...declaration,
          source: { ...declaration.source, version: 2 },
        } as never,
      }),
    ).toThrowError(DeclarationError);
  });
});

describe('манифест прошлой формы не досочиняется', () => {
  it('форма 1 — названный отказ: версию, которой файлы положены, взять неоткуда', () => {
    const { tree, declaration } = createWorkspace({
      layout: [entry],
      sources: SOURCES,
    });
    tree.write(
      MANIFEST_PATH,
      JSON.stringify({
        version: 1,
        artifacts: [
          { dest: CFG, src: 'devcontainer.json', source: SOURCE_ID, hash: 'sha256:0' },
        ],
      }),
    );

    expect(() => computePlan({ tree, declaration })).toThrowError(
      /версия манифеста 1.*"class".*"version"/s,
    );
  });

  it('запись без версии — отказ, а не подстановка сегодняшней', () => {
    // Подставить сюда текущую версию значило бы записать в паспорт неправду и
    // на ней же строить «между твоей версией и новой было ломающее изменение».
    const { tree, declaration } = createWorkspace({
      layout: [entry],
      sources: SOURCES,
    });
    tree.write(
      MANIFEST_PATH,
      JSON.stringify({
        version: 2,
        artifacts: [
          {
            dest: CFG,
            src: 'devcontainer.json',
            source: SOURCE_ID,
            class: 'regenerated',
            hash: 'sha256:0',
          },
        ],
      }),
    );

    expect(() => computePlan({ tree, declaration })).toThrowError(/version/);
  });
});
