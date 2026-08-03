/**
 * ПОЛОЖЕНИЕ ИСТОЧНИКА — обе стороны, а не одна (`tasker:BASER2-150`).
 *
 * Отказ `source-outside-tree` охранял защиту «не пишу в собственный источник»:
 * она держится положением источника, и без него вырождается в молчаливое
 * «проверка ничего не нашла». Случай изменился — дверь забирает поставку в кэш
 * снаружи локации (`tasker:BASER2-146`), и источник вне дерева стал нормой по
 * построению, — но снимать защиту нельзя: она нужна ровно там, где источник
 * лежит ВНУТРИ дерева.
 *
 * Поэтому приёмка держит три положения сразу, и ни одно из них не выводится из
 * остальных:
 *   — внутри дерева — защита работает по пути, как работала;
 *   — заведомо снаружи — пересечение пусто, и это УТВЕРЖДЕНО: адрес обязан быть
 *     невыразим репо-относительным путём, иначе «снаружи» выключало бы защиту
 *     изнутри дерева;
 *   — не названо — отказ жив.
 *
 * Проба на одну сторону здесь бесполезна: «принимает внешний источник» проходит
 * и у движка, который просто перестал проверять.
 */

import { describe, expect, it } from 'vitest';
import type { LayoutEntry } from './declaration.js';
import { computePlan } from './plan.js';
import { applyPlan } from './apply.js';
import * as api from '../index.js';
import {
  CONTENT_ROOT,
  OUTSIDE_ROOT,
  SOURCE_ID,
  SOURCE_VERSION,
  createMapSource,
  createOutsideWorkspace,
  createWorkspace,
  manifestOf,
} from './workspace.fixture.js';

const WORKFLOW = '.github/workflows/build.yml';
const ciEntry: LayoutEntry = { src: 'ci/build.yml', dest: WORKFLOW };
const SOURCES = { 'ci/build.yml': 'name: build\njobs: {}\n' };

describe('источник заведомо снаружи — принимается по построению', () => {
  it('план строится, артефакт ложится: содержимое приезжает портом', () => {
    // Шаблонов в дереве нет вовсе — они лежат в кэше снаружи локации. Раньше на
    // этом входе движок отказывался ДО плана, и применение достанутого упиралось
    // в отказ, хотя доставание работало целиком.
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, source });
    applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(plan.conflicts).toEqual([]);
    expect(tree.read(WORKFLOW, 'utf-8')).toBe(SOURCES['ci/build.yml']);
    expect(manifestOf(tree)[0]).toMatchObject({
      dest: WORKFLOW,
      source: SOURCE_ID,
      version: SOURCE_VERSION,
    });
  });

  it('повторный прогон сходится — внешний источник идемпотентности не мешает', () => {
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    applyPlan(tree, computePlan({ tree, declaration, source }));
    const again = computePlan({ tree, declaration, source });

    expect(again.status).toBe('converged');
    expect(again.steps).toEqual([]);
  });

  it('dest, повторяющий хвост внешнего адреса, отказом НЕ становится', () => {
    // Адрес источника — `/var/cache/…/content`, а `dest` объявлен в `content/`
    // внутри дерева. Совпадение написания это не пересечение: одно место в кэше,
    // другое в репозитории потребителя. Сравнение положений «по хвосту пути»
    // отбивало бы законный артефакт и выглядело бы защитой.
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [{ src: 'ci/build.yml', dest: 'content/build.yml' }],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration, source });

    expect(plan.conflicts).toEqual([]);
    expect(plan.steps.map((step) => step.dest)).toEqual(['content/build.yml']);
  });
});

describe('защита от записи в собственный источник — жива там, где применима', () => {
  it('одна и та же раскладка: внутри дерева отказ, снаружи шаг', () => {
    // Пара, а не два отдельных утверждения: разница между положениями и есть
    // предмет правки. Раскладка, `src` и `dest` совпадают буква в букву —
    // меняется ТОЛЬКО положение источника.
    const inside = createWorkspace({
      layout: [{ src: 'ci/build.yml', dest: `${CONTENT_ROOT}/ci/build.yml` }],
      sources: SOURCES,
    });
    const outside = createOutsideWorkspace({
      layout: [{ src: 'ci/build.yml', dest: `${CONTENT_ROOT}/ci/build.yml` }],
      sources: SOURCES,
    });

    expect(
      computePlan({ tree: inside.tree, declaration: inside.declaration })
        .conflicts[0],
    ).toMatchObject({
      kind: 'dest-in-content-root',
      detail: { contentRoot: CONTENT_ROOT },
    });
    expect(
      computePlan({
        tree: outside.tree,
        declaration: outside.declaration,
        source: outside.source,
      }),
    ).toMatchObject({ status: 'pending', conflicts: [] });
  });

  it('«снаружи» не выключает защиту изнутри: репо-относительный адрес отвергается', () => {
    // Иначе слово «снаружи» стало бы рычагом отключения проверки: объявил
    // внешним каталог, лежащий В ДЕРЕВЕ, — и движок кладёт артефакты поверх
    // собственных шаблонов, ничего не заметив. Ровно один раз, потому что второй
    // раз читать будет уже нечего.
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [{ src: 'ci/build.yml', dest: `${CONTENT_ROOT}/ci/build.yml` }],
      sources: SOURCES,
      at: CONTENT_ROOT,
    });

    expect(() => computePlan({ tree, declaration, source })).toThrow(
      api.DeclarationError,
    );
    expect(() => computePlan({ tree, declaration, source })).toThrow(
      /репо-относительный путь/,
    );
  });

  it('пустой адрес снаружи — это «неизвестно», а не «снаружи»', () => {
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
      at: '   ',
    });

    expect(() => computePlan({ tree, declaration, source })).toThrow(
      api.DeclarationError,
    );
  });

  it('вырожденный корень внутри дерева отбивается, как отбивался', () => {
    // Проверка переехала в разбор положения, и переезд не имеет права её
    // ослабить: источником объявлено бы ВСЁ дерево, и прогон затирал бы шаблон,
    // из которого сам же читает.
    const { tree, declaration } = createWorkspace({
      contentRoot: '.',
      layout: [{ src: 'ci/build.yml', dest: WORKFLOW }],
      sources: SOURCES,
    });

    expect(() => computePlan({ tree, declaration })).toThrow(
      /корень содержимого/,
    );
  });
});

describe('отказ остаётся живым: положение источника не названо', () => {
  it('null отказывает там же, где { outside } проходит', () => {
    // Сузилась ОБЛАСТЬ отказа, а не сам отказ: у одной и той же раскладки
    // неназванное положение отказывает прежним кодом, а названное — работает.
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });
    const unnamed = {
      ...declaration,
      source: { ...declaration.source, contentRoot: null },
    };

    expect(() => computePlan({ tree, declaration: unnamed, source })).toThrow(
      api.SourceOutsideTreeError,
    );
    try {
      computePlan({ tree, declaration: unnamed, source });
    } catch (error) {
      expect((error as api.BaserMaterializeError).code).toBe(
        'source-outside-tree',
      );
      // Адрес события — обвес: чинится это названием положения его источника.
      expect((error as Error).message).toContain(SOURCE_ID);
    }
    expect(computePlan({ tree, declaration, source }).status).toBe('pending');
  });

  it('отсутствие поля — структура не той формы, а не неназванное положение', () => {
    // Разные события и разные адресаты: поле собирает дверь, а `null` — сказанное
    // ею состояние входа. Свести их в один отказ значило бы отправить чинить
    // раскладку обвеса того, у кого сломалась склейка.
    const { tree, declaration } = createWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });
    const source = {
      id: declaration.source.id,
      version: declaration.source.version,
    };

    expect(() =>
      computePlan({ tree, declaration: { ...declaration, source } as never }),
    ).toThrow(api.DeclarationError);
    expect(() =>
      computePlan({ tree, declaration: { ...declaration, source } as never }),
    ).toThrow(/структура не той формы/);
  });
});

describe('порт содержимого — обязателен ровно для внешнего источника', () => {
  it('внешний источник без порта — названный отказ, а не пустые шаблоны', () => {
    // Молчаливое «шаблон не найден» на каждой записи назвало бы причиной
    // раскладку обвеса, с которой всё в порядке: содержимое просто некому подать.
    const { tree, declaration } = createOutsideWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    expect(() => computePlan({ tree, declaration })).toThrow(
      api.DeclarationError,
    );
    expect(() => computePlan({ tree, declaration })).toThrow(
      /порт содержимого не подан/,
    );
  });

  it('источник внутри дерева движок читает сам — умолчание осталось', () => {
    const { tree, declaration } = createWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    expect(computePlan({ tree, declaration }).steps).toHaveLength(1);
  });

  it('поданный порт старше умолчания и внутри дерева тоже', () => {
    const { tree, declaration } = createWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration,
      source: createMapSource({ 'ci/build.yml': 'name: другое\n' }, 'порт'),
    });

    expect(plan.steps[0].content).toBe('name: другое\n');
  });
});

describe('телеметрия называет положение источника', () => {
  const positionOf = (trace: readonly api.TraceSpan[]): unknown =>
    trace.find((span) => span.name === 'plan.source')?.detail;

  it('внутри дерева — защита считается по пути', () => {
    const { tree, declaration } = createWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    expect(positionOf(computePlan({ tree, declaration }).trace)).toEqual({
      source: SOURCE_ID,
      position: 'in-tree',
      at: CONTENT_ROOT,
      guard: 'dest-in-content-root',
    });
  });

  it('снаружи — пересечение пусто, и это сказано, а не подразумевается', () => {
    // Прогон, молчащий о положении источника, выглядит одинаково в обоих
    // случаях, а случаи разные: «проверка ничего не нашла» и «проверять было
    // нечего» — это не одно и то же, и различать их обязана телеметрия.
    const { tree, declaration, source } = createOutsideWorkspace({
      layout: [ciEntry],
      sources: SOURCES,
    });

    expect(
      positionOf(computePlan({ tree, declaration, source }).trace),
    ).toEqual({
      source: SOURCE_ID,
      position: 'outside-tree',
      at: OUTSIDE_ROOT,
      guard: 'empty-intersection',
    });
  });
});
