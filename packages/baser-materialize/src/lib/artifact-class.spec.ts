/**
 * КЛАСС АРТЕФАКТА — приёмка `tasker:BASER2-51`.
 *
 * До этого захода движок класс НЕ ЧИТАЛ ВОВСЕ: во входном контракте запись
 * раскладки была парой `src` + `dest`, и объявленный обвесом `placed-once` молча
 * терялся по дороге от формы к станку. Полдороги опаснее её отсутствия — человек
 * заполнял поле, форма его принимала, а движок перегенерировал файл поверх.
 *
 * Проверяется поэтому не «класс разбирается», а ПЕРЕХОДЫ: в устойчивом
 * состоянии оба класса выглядят одинаково, и вся разница вылезает ровно там, где
 * что-то меняется — уехал шаблон, пропала запись, пропал файл, сменился класс.
 */

import { describe, expect, it } from 'vitest';
import type { LayoutEntry } from './declaration.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import { MANIFEST_PATH, hashContent } from './manifest.js';
import {
  CONTENT_ROOT,
  SOURCE_ID,
  SOURCE_VERSION,
  createWorkspace,
  manifestOf,
  redeclare,
} from './workspace.fixture.js';

const HARNESS = '.omnifield/harness.yaml';
const IGNORE = '.gitignore';

/** Конфиг инструмента: станок кладёт болванку, дальше её пишет продукт. */
const placedOnce: LayoutEntry = {
  src: 'harness.yaml',
  dest: HARNESS,
  class: 'placed-once',
};
/** Тот же путь, но наш файл — для сверки «что было бы у regenerated». */
const regenerated: LayoutEntry = { src: 'harness.yaml', dest: HARNESS };

const SOURCES = {
  'harness.yaml': 'product: baser\nzones: {}\n',
  'gitignore': 'node_modules\n',
};

/** Заполненный человеком конфиг — то, что обязано пережить обновление. */
const FILLED = 'product: baser\nzones:\n  materialize: {}\n';

/** Дерево с уже разложенной записью — стартовое состояние всех переходов. */
function materialized(layout: readonly LayoutEntry[] = [placedOnce]) {
  const fixture = createWorkspace({ layout, sources: SOURCES });
  applyPlan(
    fixture.tree,
    computePlan({ tree: fixture.tree, declaration: fixture.declaration }),
  );
  return fixture;
}

describe('класс объявляет обвес, движок его исполняет', () => {
  it('запись без класса означает regenerated — ровно то же, что раскладка формы 1', () => {
    const { tree } = materialized([regenerated]);

    expect(manifestOf(tree)[0].class).toBe('regenerated');
  });

  it('класс, которого движок не знает, — названный отказ, а не тихое умолчание', () => {
    // Принять незнакомое слово за `regenerated` значило бы перегенерировать
    // поверх файла, который обвес мог объявить человеческим, — молча и ровно
    // один раз. Это же страховка словаря: приедет третий класс (`kb:WEBER-4`),
    // и движок скажет об этом на первом прогоне.
    const { tree, declaration } = createWorkspace({
      layout: [
        { src: 'harness.yaml', dest: HARNESS, class: 'kept-forever' },
      ] as unknown as readonly LayoutEntry[],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('blocked');
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unknown-artifact-class',
      dest: HARNESS,
      detail: { artifactClass: 'kept-forever' },
    });
    expect(plan.steps).toEqual([]);
  });

  it('отказ по классу адресный: соседняя запись планируется как обычно', () => {
    const { tree, declaration } = createWorkspace({
      layout: [
        { src: 'harness.yaml', dest: HARNESS, class: 'kept-forever' },
        { src: 'gitignore', dest: IGNORE },
      ] as unknown as readonly LayoutEntry[],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration });

    expect(plan.conflicts.map((conflict) => conflict.dest)).toEqual([HARNESS]);
    expect(plan.steps.map((step) => step.dest)).toEqual([IGNORE]);
  });
});

describe('переход: обвес обновился, шаблон изменился', () => {
  it('placed-once переживает обновление — станок его не трогает', () => {
    const { tree, declaration } = materialized();
    tree.write(HARNESS, FILLED); // продукт заполнил конфиг под себя
    applyPlan(tree, computePlan({ tree, declaration }));

    // Обвес выпустил новую версию шаблона.
    tree.write(`${CONTENT_ROOT}/harness.yaml`, 'product: baser\nzones: {}\nnew: 1\n');
    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(plan.status).toBe('converged');
    expect(tree.read(HARNESS, 'utf-8')).toBe(FILLED);
  });

  it('regenerated в тех же условиях перекладывается целиком, и потери названы', () => {
    const { tree, declaration } = materialized([regenerated]);
    tree.write(HARNESS, FILLED);

    tree.write(`${CONTENT_ROOT}/harness.yaml`, 'product: baser\nzones: {}\nnew: 1\n');
    const plan = computePlan({ tree, declaration });

    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      reason: 'diverged',
      previous: FILLED,
    });
  });
});

describe('переход: человек правит артефакт', () => {
  it('правка в placed-once флага не поднимает и расхождением не называется', () => {
    const { tree, declaration } = materialized();

    tree.write(HARNESS, FILLED);
    const plan = computePlan({ tree, declaration });

    expect(plan.status).toBe('converged');
    expect(plan.steps).toEqual([]);
    expect(describePlan(plan)).toContain('дерево сошлось с декларацией');
    expect(tree.read(HARNESS, 'utf-8')).toBe(FILLED);
  });

  it('в regenerated та же правка — расхождение и перекладывание', () => {
    const { tree, declaration } = materialized([regenerated]);

    tree.write(HARNESS, FILLED);
    const plan = computePlan({ tree, declaration });

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'diverged' });
  });
});

describe('переход: пропал сам артефакт', () => {
  it('placed-once кладётся ЗАНОВО: объявленное место пустое', () => {
    // Не «человек удалил, уважим»: обвес объявил, что файл в этом месте есть.
    const { tree, declaration } = materialized();
    tree.delete(HARNESS);

    const plan = computePlan({ tree, declaration });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'create', reason: 'missing' });
    expect(tree.read(HARNESS, 'utf-8')).toBe(SOURCES['harness.yaml']);
  });

  it('regenerated ведёт себя так же — развилки по классу тут нет и не должно быть', () => {
    const { tree, declaration } = materialized([regenerated]);
    tree.delete(HARNESS);

    expect(computePlan({ tree, declaration }).steps[0]).toMatchObject({
      kind: 'create',
      reason: 'missing',
    });
  });
});

describe('переход: запись пропала из раскладки', () => {
  it('regenerated уходит сиротой молча — он наш и всегда был наш', () => {
    const { tree, declaration } = materialized([regenerated]);

    const plan = computePlan({ tree, declaration: redeclare(declaration, []) });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(tree.exists(HARNESS)).toBe(false);
  });

  it('placed-once НЕ уходит: артефакт остаётся, а состояние названо вслух', () => {
    // Иначе выпиленная строка шаблона молча уносила бы файл, в котором человек
    // месяц работал, — и второго такого файла у него не будет.
    const { tree, declaration } = materialized();
    tree.write(HARNESS, FILLED);
    applyPlan(tree, computePlan({ tree, declaration }));

    const dropped = redeclare(declaration, []);
    const plan = computePlan({ tree, declaration: dropped });
    applyPlan(tree, plan);

    expect(plan.steps).toEqual([]);
    expect(plan.notices).toContainEqual(
      expect.objectContaining({
        kind: 'placed-once-retained',
        dest: HARNESS,
        detail: { artifactClass: 'placed-once', resolution: 'confirm' },
      }),
    );
    expect(tree.read(HARNESS, 'utf-8')).toBe(FILLED);
    // Запись тоже остаётся: без неё артефакт стал бы чужим при первом же
    // возврате объявления.
    expect(manifestOf(tree).map((record) => record.dest)).toEqual([HARNESS]);
  });

  it('извещение повторяется каждый прогон — это утверждение о состоянии, а не разовое', () => {
    const { tree, declaration } = materialized();
    const dropped = redeclare(declaration, []);
    applyPlan(tree, computePlan({ tree, declaration: dropped }));

    const again = computePlan({ tree, declaration: dropped });

    expect(again.notices.map((notice) => notice.kind)).toContain(
      'placed-once-retained',
    );
    expect(again.status).toBe('converged');
  });

  it('снимается поимённым подтверждением — той самой явной командой', () => {
    const { tree, declaration } = materialized();
    const dropped = redeclare(declaration, []);

    const plan = computePlan({
      tree,
      declaration: dropped,
      confirm: [HARNESS],
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'delete', reason: 'orphan' });
    expect(tree.exists(HARNESS)).toBe(false);
    // Подтверждение пригодилось — «не понадобилось» здесь было бы неправдой.
    expect(plan.notices).toEqual([]);
  });

  it('согласие не масштабируется: подтверждение соседа чужой файл не снимает', () => {
    const { tree, declaration } = materialized([
      placedOnce,
      { src: 'gitignore', dest: IGNORE, class: 'placed-once' },
    ]);

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, []),
      confirm: [IGNORE],
    });
    applyPlan(tree, plan);

    expect(plan.steps.map((step) => step.dest)).toEqual([IGNORE]);
    expect(tree.exists(HARNESS)).toBe(true);
    expect(
      plan.notices.filter((notice) => notice.kind === 'placed-once-retained'),
    ).toHaveLength(1);
  });

  it('удержанный артефакт снятым не считается: путь под ним остаётся занятым', () => {
    // Препятствие снимает только собственный шаг удаления. Удержание — не
    // снятие, и записать его в снятые значило бы спланировать состояние,
    // которое файловая система не примет.
    const { tree, declaration } = materialized();

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [
        { src: 'gitignore', dest: `${HARNESS}/inner.yml` },
      ]),
    });

    expect(plan.conflicts[0]).toMatchObject({
      kind: 'unreachable-dest',
      detail: { blockedBy: HARNESS, collision: 'existing-file' },
    });
  });
});

describe('переход: сменился класс артефакта', () => {
  it('regenerated → placed-once: хеш уходит из записи, содержимое не тронуто', () => {
    const { tree, declaration } = materialized([regenerated]);
    tree.write(HARNESS, FILLED);

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [placedOnce]),
    });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({
      kind: 'record',
      reason: 'reclaimed',
      restated: ['hash', 'class'],
    });
    expect(tree.read(HARNESS, 'utf-8')).toBe(FILLED);
    expect(manifestOf(tree)[0]).toEqual({
      dest: HARNESS,
      src: 'harness.yaml',
      source: SOURCE_ID,
      version: SOURCE_VERSION,
      class: 'placed-once',
    });
  });

  it('placed-once → regenerated: правка человека становится расхождением и названа', () => {
    const { tree, declaration } = materialized();
    tree.write(HARNESS, FILLED);
    applyPlan(tree, computePlan({ tree, declaration }));

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [regenerated]),
    });

    expect(plan.steps[0]).toMatchObject({
      kind: 'update',
      reason: 'diverged',
      previous: FILLED,
    });
  });
});

describe('паспорт укладки: хеш placed-once не пишется вовсе', () => {
  it('в записи нет ключа hash — не пустая строка и не null', () => {
    // Записанный и никогда не сравниваемый хеш это половина имитации: он
    // выглядел бы доказательством, которым не является.
    const { tree } = materialized();

    expect(manifestOf(tree)[0]).not.toHaveProperty('hash');
    expect(tree.read(MANIFEST_PATH, 'utf-8')).not.toContain('hash');
  });

  it('манифест с хешем у placed-once — отказ: движок такого не пишет', () => {
    // Запись с хешем пришла не от движка, а сверять его всё равно некому: он
    // молча изображал бы доказательство, которого у этого класса нет.
    const { tree, declaration } = createWorkspace({
      layout: [placedOnce],
      sources: SOURCES,
      manifest: [
        {
          dest: HARNESS,
          src: 'harness.yaml',
          source: SOURCE_ID,
          version: SOURCE_VERSION,
          class: 'placed-once',
          hash: hashContent(SOURCES['harness.yaml']),
        },
      ],
    });

    expect(() => computePlan({ tree, declaration })).toThrowError(
      /placed-once.*хеш/s,
    );
  });

  it('манифест без класса — отказ, а не догадка о том, чем держать артефакт', () => {
    const { tree, declaration } = createWorkspace({
      layout: [placedOnce],
      sources: SOURCES,
    });
    tree.write(
      MANIFEST_PATH,
      JSON.stringify({
        version: 2,
        artifacts: [
          {
            dest: HARNESS,
            src: 'harness.yaml',
            source: SOURCE_ID,
            version: SOURCE_VERSION,
            hash: 'sha256:0',
          },
        ],
      }),
    );

    expect(() => computePlan({ tree, declaration })).toThrowError(/class/);
  });
});

describe('трейсы называют то, чего прогон не делал', () => {
  it('plan.layout считает объявленные placed-once, plan.orphans — удержанные', () => {
    // «Почему станок ничего не сделал» отвечается этими числами, а не глазами
    // по раскладке: файлы класса `placed-once` — ровно те, которых прогон не
    // касается, и их доля обязана быть видна в телеметрии.
    const { tree, declaration } = materialized([
      placedOnce,
      { src: 'gitignore', dest: IGNORE },
    ]);

    const plan = computePlan({
      tree,
      declaration: redeclare(declaration, [{ src: 'gitignore', dest: IGNORE }]),
    });

    expect(
      plan.trace.find((span) => span.name === 'plan.layout')?.detail,
    ).toEqual({ entries: 1, placedOnce: 0, executable: 0 });
    expect(
      plan.trace.find((span) => span.name === 'plan.orphans')?.detail,
    ).toEqual({ orphans: 0, retained: 1 });
  });
});

describe('взятие во владение существующего файла', () => {
  it('placed-once поверх чужого файла — отказ, как и у regenerated', () => {
    // Класс не про право трогать чужое: владение это владение.
    const { tree, declaration } = createWorkspace({
      layout: [placedOnce],
      sources: SOURCES,
      existing: { [HARNESS]: FILLED },
    });

    expect(computePlan({ tree, declaration }).conflicts[0]).toMatchObject({
      kind: 'foreign-dest',
      detail: { resolution: 'confirm' },
    });
  });

  it('подтверждение делает файл нашим, НЕ трогая содержимое', () => {
    // Согласие давалось на владение, а не на потерю: у regenerated тем же
    // подтверждением файл перекладывается, у placed-once — нет.
    const { tree, declaration } = createWorkspace({
      layout: [placedOnce],
      sources: SOURCES,
      existing: { [HARNESS]: FILLED },
    });

    const plan = computePlan({ tree, declaration, confirm: [HARNESS] });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({
      kind: 'record',
      reason: 'adopted',
      content: null,
      previous: FILLED,
    });
    expect(tree.read(HARNESS, 'utf-8')).toBe(FILLED);
    expect(manifestOf(tree)[0].class).toBe('placed-once');
  });

  it('тот же случай у regenerated по-прежнему перекладывает файл', () => {
    const { tree, declaration } = createWorkspace({
      layout: [regenerated],
      sources: SOURCES,
      existing: { [HARNESS]: FILLED },
    });

    const plan = computePlan({ tree, declaration, confirm: [HARNESS] });
    applyPlan(tree, plan);

    expect(plan.steps[0]).toMatchObject({ kind: 'update', reason: 'adopted' });
    expect(tree.read(HARNESS, 'utf-8')).toBe(SOURCES['harness.yaml']);
  });
});

/**
 * КЛАСС В ОТКАЗЕ — приёмка `tasker:BASER2-141`.
 *
 * Живой случай: первый прогон после объявления второго обвеса отказал
 * шестнадцатью конфликтами владения, и все шестнадцать строк отличались только
 * именем файла. Вопрос потребителя был ровно один — «отдать во владение значит
 * ли потерять содержимое?», — и ответ на него зависит от класса и больше ни от
 * чего. Класс он вытащил дедукцией по счётчику `placedOnce` в трейсе: выводимо,
 * но выводится то, что движок и так знает.
 *
 * Проверяется поэтому СМЕШАННЫЙ набор: на однородном классе строка «называет
 * класс» неотличима от строки, называющей одно и то же слово всем подряд.
 */
describe('отказ владения называет класс спорного артефакта', () => {
  const README = 'README.md';

  /** Часть путей держится человеческими, часть — нашими, и все они спорные. */
  function mixed() {
    return createWorkspace({
      layout: [
        placedOnce,
        // Класс не назван — умолчание; ровно так объявлено большинство раскладок.
        { src: 'gitignore', dest: IGNORE },
        { src: 'readme.md', dest: README, class: 'regenerated' },
      ],
      sources: { ...SOURCES, 'readme.md': '# канон\n' },
      existing: { [HARNESS]: FILLED, [IGNORE]: 'dist\n', [README]: '# моё\n' },
    });
  }

  it('класс назван в машинном ответе — по каждому спорному пути свой', () => {
    const { tree, declaration } = mixed();

    const plan = computePlan({ tree, declaration });

    expect(
      Object.fromEntries(
        plan.conflicts.map((conflict) => [conflict.dest, conflict.class]),
      ),
    ).toEqual({
      [HARNESS]: 'placed-once',
      [IGNORE]: 'regenerated',
      [README]: 'regenerated',
    });
  });

  it('класс назван и в строке — вместе с тем, что сделает подтверждение', () => {
    const { tree, declaration } = mixed();

    const text = describePlan(computePlan({ tree, declaration }));

    expect(text).toContain('Класс артефакта — "placed-once"');
    expect(text).toContain('содержимого не трогая');
    expect(text).toContain('Класс артефакта — "regenerated"');
    expect(text).toContain('перекладывает содержимое из шаблона целиком');
  });

  it('обещание держится ИНВАРИАНТОМ: класс назван у каждого отказа, просящего подтверждения', () => {
    // Вычитка двух строк доказывает две строки. Справка обещает класс у всякого
    // отказа, который просит подтверждения, — это и проверяется.
    const { tree, declaration } = mixed();

    const asking = computePlan({ tree, declaration }).conflicts.filter(
      (conflict) => conflict.detail.resolution === 'confirm',
    );

    expect(asking).toHaveLength(3);
    for (const conflict of asking) {
      expect(conflict.class).toBeDefined();
      expect(conflict.message).toContain(conflict.class as string);
    }
  });

  it('класс не выдумывается там, где движок его НЕ знает', () => {
    // `unknown-artifact-class` — отказ ровно про то, что слово незнакомо: оно
    // лежит строкой в `detail.artifactClass`, а поля `class` у отказа нет.
    // Проставить сюда умолчание значило бы отчитаться о классе, которого никто
    // не объявлял.
    const { tree, declaration } = createWorkspace({
      layout: [
        { src: 'harness.yaml', dest: HARNESS, class: 'kept-forever' },
      ] as unknown as readonly LayoutEntry[],
      sources: SOURCES,
      existing: { [HARNESS]: FILLED },
    });

    const conflict = computePlan({ tree, declaration }).conflicts[0];

    expect(conflict.kind).toBe('unknown-artifact-class');
    expect(conflict.class).toBeUndefined();
  });

  it('подтверждение делает ровно то, что назвал отказ — на обоих классах сразу', () => {
    // Обещание строки и факт применения сверяются одним прогоном: иначе текст
    // остаётся обещанием, проверенным глазами.
    const { tree, declaration } = mixed();

    const plan = computePlan({
      tree,
      declaration,
      confirm: [HARNESS, IGNORE, README],
    });
    applyPlan(tree, plan);

    // "placed-once": содержимого не трогая.
    expect(tree.read(HARNESS, 'utf-8')).toBe(FILLED);
    // "regenerated": перекладывает содержимое из шаблона целиком.
    expect(tree.read(IGNORE, 'utf-8')).toBe(SOURCES.gitignore);
    expect(tree.read(README, 'utf-8')).toBe('# канон\n');
  });
});
