/**
 * ПРИЁМКА `tasker:BASER2-233` — движок доносит предупреждение обвеса до двери.
 *
 * Второе звено шва `tasker:BASER2-226`: форма научилась объявлять текст, который
 * обвес говорит человеку про своё применение здесь, не отказывая; движок обязан
 * донести посчитанное до ответа, из которого дверь его напечатает и агент
 * прочитает.
 *
 * Меряется СКВОЗНОЙ путь, а не своё звено. Четыре шва подряд ловили «звено есть,
 * а через него не течёт», поэтому последний блок здесь поднимает настоящую цепь:
 * объявление формы 7 → разбор контрактами → вызов резолвера портом двери →
 * вход движка → план → машинный ответ. Проба на своей половине зеленела бы и при
 * оборванной цепи.
 *
 * Инвариант, который держат сразу три пробы: **предупреждение не имеет права
 * стать отказом.** Ни при какой беде — упал резолвер, дверь подала мусор, обвес
 * сказал ничем. Прогон едет, план применим, а случившееся названо данными.
 */

import { afterAll, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SourceWarning } from '@omnifield/baser-contracts';
import {
  FORM_VERSION,
  parseSourceDeclaration,
  readSourceDeclaration,
  resolveWarning,
} from '@omnifield/baser-contracts';
import type { Declaration, LayoutEntry } from './declaration.js';
import type { Tree } from './tree.js';
import { computePlan, describePlan } from './plan.js';
import { applyPlan } from './apply.js';
import {
  SOURCE_ID,
  addSource,
  createWorkspace,
  withWarning,
} from './workspace.fixture.js';

const CI: LayoutEntry = { src: 'ci/build.yml', dest: '.github/workflows/build.yml' };
const SOURCES = { 'ci/build.yml': 'name: build\n' };

/** Живой случай шва: артефакт ляжет верно и не сработает — виновата обстановка. */
const SAID = 'артефакт ляжет, но здесь он не сработает: локация смотрит мимо';

const said: SourceWarning = { kind: 'said', text: SAID };

/** Что приезжает от формы, когда резолвер обвеса бросил (`resolver-failed`). */
const failed: SourceWarning = {
  kind: 'failed',
  problem: {
    code: 'resolver-failed',
    at: `${SOURCE_ID}.warningFrom`,
    message: 'резолвер предупреждения не отработал: нечем прочитать локацию',
  },
};

function workspace(): Declaration & { tree: ReturnType<typeof createWorkspace>['tree'] } {
  const { tree, declaration } = createWorkspace({
    layout: [CI],
    sources: SOURCES,
  });
  return { ...declaration, tree };
}

describe('предупреждение обвеса доезжает до ответа', () => {
  it('объявленное предупреждение лежит в плане дословно', () => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: withWarning(declaration, said),
    });

    expect(plan.warning).toEqual(said);
    // Текст не переписан и не обрезан: движок несёт чужую фразу как есть.
    expect(plan.warning.kind === 'said' && plan.warning.text).toBe(SAID);
  });

  it('предупреждение уезжает в МАШИННЫЙ ответ, а не только в текст', () => {
    // Ради этого оно и едет планом: пульт и агент читают `--json`, и дверь
    // отдаёт им план целиком (`kb:BASER3-33`). Проба сериализует его так же.
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: withWarning(declaration, said),
    });
    const wire = JSON.parse(JSON.stringify(plan)) as { warning?: unknown };

    expect(wire.warning).toEqual(said);
  });

  it('печатается человеку и на сошедшемся дереве', () => {
    // Предупреждение про обстановку верно и тогда, когда делать нечего: молчание
    // сошедшегося прогона его не глушит.
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });
    const declared = withWarning(declaration, said);
    applyPlan(tree, computePlan({ tree, declaration: declared }));

    const second = computePlan({ tree, declaration: declared });

    expect(second.status).toBe('converged');
    expect(describePlan(second)).toContain('план пуст');
    expect(describePlan(second)).toContain(SAID);
  });

  it('сказанное названо в телеметрии', () => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: withWarning(declaration, said),
    });

    expect(
      plan.trace.find((span) => span.name === 'plan.warning')?.detail,
    ).toEqual({ source: SOURCE_ID, kind: 'said' });
  });
});

describe('обвес, которому нечего сказать', () => {
  it('поля нет вовсе — план несёт названное отсутствие', () => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration });

    // Названное отсутствие, а не пропущенный ключ: у потребителя не должно
    // заводиться второе умолчание, способное разойтись с нашим.
    expect(plan.warning).toEqual({ kind: 'none' });
    expect(JSON.parse(JSON.stringify(plan))).toHaveProperty('warning');
  });

  it('резолвер вернул пустоту — то же самое состояние', () => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: withWarning(declaration, { kind: 'none' }),
    });

    expect(plan.warning).toEqual({ kind: 'none' });
  });

  it('молчащий обвес не платит ни строкой отчёта, ни событием трейса', () => {
    // «Сказать нечего» — самый частый случай, и он обязан быть бесплатным:
    // пустое состояние это не замер, а пустой счётчик.
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({ tree, declaration });

    expect(plan.trace.map((span) => span.name)).not.toContain('plan.warning');
    expect(describePlan(plan)).not.toContain('обвес говорит');
    expect(describePlan(plan)).not.toContain('предупреждение обвеса');
  });

  it('ПЛАН НЕ МЕНЯЕТСЯ НИЧЕМ, кроме самого предупреждения', () => {
    // Соседи по перечню не должны заметить приезда поля: шаги, отказы,
    // извещения, паспорт укладки и порядок трейса — те же самые.
    const bare = workspace();
    const withText = workspace();

    const plain = computePlan({
      tree: bare.tree,
      declaration: { source: bare.source, layout: bare.layout },
    });
    const speaking = computePlan({
      tree: withText.tree,
      declaration: withWarning(
        { source: withText.source, layout: withText.layout },
        said,
      ),
    });

    const {
      warning: _plainWarning,
      trace: plainTrace,
      ...plainRest
    } = plain;
    const {
      warning: _saidWarning,
      trace: saidTrace,
      ...saidRest
    } = speaking;

    expect(saidRest).toEqual(plainRest);
    // Единственная прибавка — событие рядом с положением источника: оба про
    // источник, и оба читаются до работы. Соседние спаны не сдвинулись и не
    // переименовались.
    expect(saidTrace.map((span) => span.name)).toEqual(
      plainTrace.flatMap((span) =>
        span.name === 'plan.source' ? [span.name, 'plan.warning'] : [span.name],
      ),
    );
  });
});

describe('упавший резолвер: план ЖИВ', () => {
  it('беда предупреждения не блокирует и не пустошит план', () => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: withWarning(declaration, failed),
    });

    expect(plan.status).toBe('pending');
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps.map((step) => step.dest)).toEqual([CI.dest]);
    expect(plan.warning).toEqual(failed);
  });

  it('и артефакт всё равно ложится', () => {
    // Прогон едет как ни в чём не бывало — иначе обвес, попытавшийся сказать,
    // ронял бы локацию сильнее молчащего.
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    applyPlan(
      tree,
      computePlan({ tree, declaration: withWarning(declaration, failed) }),
    );

    expect(tree.read(CI.dest, 'utf-8')).toBe(SOURCES['ci/build.yml']);
  });

  it('беда названа данными с кодом — и в тексте, и в телеметрии', () => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: withWarning(declaration, failed),
    });

    expect(plan.warning.kind === 'failed' && plan.warning.problem.code).toBe(
      'resolver-failed',
    );
    expect(describePlan(plan)).toContain('resolver-failed');
    expect(
      plan.trace.find((span) => span.name === 'plan.warning')?.detail,
    ).toEqual({
      source: SOURCE_ID,
      kind: 'failed',
      code: 'resolver-failed',
    });
  });
});

describe('предупреждение подано не в той форме', () => {
  const garbage: readonly [string, unknown][] = [
    ['строка вместо состояния', SAID],
    ['состояние без имени', { text: SAID }],
    ['незнакомое имя состояния', { kind: 'warned', text: SAID }],
    ['сказано ничем', { kind: 'said', text: '' }],
    ['сказано не текстом', { kind: 'said', text: 42 }],
    ['беда без названного отказа', { kind: 'failed' }],
    ['отказ без кода', { kind: 'failed', problem: { message: 'ой' } }],
  ];

  it.each(garbage)('%s: прогон не падает, а называет', (_case, value) => {
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });
    const broken = {
      ...declaration,
      source: { ...declaration.source, warning: value as SourceWarning },
    };

    const plan = computePlan({ tree, declaration: broken });

    // Бросок здесь был бы второй громкостью, ведущей себя как первая: движок
    // уронил бы прогон РАДИ ФРАЗЫ. Поэтому отказ данными, а план обычный.
    expect(plan.status).toBe('pending');
    expect(plan.steps).toHaveLength(1);
    expect(plan.warning.kind).toBe('failed');
    expect(plan.warning.kind === 'failed' && plan.warning.problem).toEqual({
      code: 'wrong-type',
      // Адрес свой: отказал не резолвер обвеса, а то, что подал вызывающий.
      at: `${SOURCE_ID}.warning`,
      message: expect.stringContaining('не той формы'),
    });
  });

  it('негодное предупреждение не проглатывается молча', () => {
    // Проглотить было бы хуже отказа: дверь считала бы, что её предупреждение
    // работает, а оно бы исчезало.
    const { tree, declaration } = createWorkspace({
      layout: [CI],
      sources: SOURCES,
    });

    const plan = computePlan({
      tree,
      declaration: {
        ...declaration,
        source: { ...declaration.source, warning: 'сказал строкой' as never },
      },
    });

    expect(describePlan(plan)).toContain('wrong-type');
  });
});

describe('обвесов несколько — каждое предупреждение доезжает своим', () => {
  const ALPHA = 'omnifield/alpha-kit';
  const BETA = 'omnifield/beta-kit';
  const GAMMA = 'omnifield/gamma-kit';

  const ALPHA_SAID = 'альфа: здесь артефакт не сработает';
  const GAMMA_SAID = 'гамма: пересоздай окружение, иначе не подхватит';

  it('своё — у своего, и молчащий сосед не молчит за говорящего', () => {
    // Прогон движка идёт по ОДНОЙ декларации, обвесов в репозитории сколько
    // угодно (`kb:BASER2-4`) — значит и планов столько же, и каждый несёт своё.
    const { tree, declaration: alpha } = createWorkspace({
      sourceId: ALPHA,
      contentRoot: 'node_modules/@omnifield/alpha-kit/content',
      layout: [{ src: 'a.yml', dest: '.github/workflows/a.yml' }],
      sources: { 'a.yml': 'name: a\n' },
    });
    const beta = addSource(tree, {
      id: BETA,
      contentRoot: 'node_modules/@omnifield/beta-kit/content',
      layout: [{ src: 'b.yml', dest: '.github/workflows/b.yml' }],
      sources: { 'b.yml': 'name: b\n' },
    });
    const gamma = addSource(tree, {
      id: GAMMA,
      contentRoot: 'node_modules/@omnifield/gamma-kit/content',
      layout: [{ src: 'c.yml', dest: '.github/workflows/c.yml' }],
      sources: { 'c.yml': 'name: c\n' },
    });

    const runs = [
      withWarning(alpha, { kind: 'said', text: ALPHA_SAID }),
      beta,
      withWarning(gamma, { kind: 'said', text: GAMMA_SAID }),
    ].map((declaration) => {
      const plan = computePlan({ tree, declaration });
      applyPlan(tree, plan);
      return plan;
    });

    expect(runs.map((plan) => plan.warning)).toEqual([
      { kind: 'said', text: ALPHA_SAID },
      { kind: 'none' },
      { kind: 'said', text: GAMMA_SAID },
    ]);
    // Обвес у предупреждения назван — иначе дверь, сложившая прогоны в один
    // ответ, не сказала бы, ЧЕЙ это текст.
    expect(
      runs.flatMap((plan) =>
        plan.trace
          .filter((span) => span.name === 'plan.warning')
          .map((span) => span.detail),
      ),
    ).toEqual([
      { source: ALPHA, kind: 'said' },
      { source: GAMMA, kind: 'said' },
    ]);
  });

  it('беда у одного обвеса не трогает соседей по перечню', () => {
    const { tree, declaration: alpha } = createWorkspace({
      sourceId: ALPHA,
      contentRoot: 'node_modules/@omnifield/alpha-kit/content',
      layout: [{ src: 'a.yml', dest: '.github/workflows/a.yml' }],
      sources: { 'a.yml': 'name: a\n' },
    });
    const beta = addSource(tree, {
      id: BETA,
      contentRoot: 'node_modules/@omnifield/beta-kit/content',
      layout: [{ src: 'b.yml', dest: '.github/workflows/b.yml' }],
      sources: { 'b.yml': 'name: b\n' },
    });

    const first = computePlan({ tree, declaration: withWarning(alpha, failed) });
    applyPlan(tree, first);
    const second = computePlan({ tree, declaration: beta });
    applyPlan(tree, second);

    expect(first.warning.kind).toBe('failed');
    expect(second.warning).toEqual({ kind: 'none' });
    expect(second.status).toBe('pending');
    expect(tree.read('.github/workflows/a.yml', 'utf-8')).toBe('name: a\n');
    expect(tree.read('.github/workflows/b.yml', 'utf-8')).toBe('name: b\n');
  });
});

/**
 * СКВОЗНОЙ ПУТЬ — форма → резолвер → движок → ответ.
 *
 * Здесь работает НАСТОЯЩИЙ разбор объявления и настоящий вызов резолвера, а не
 * состояние, собранное руками: цепь рвётся между зонами, и проба, поданная
 * готовым состоянием, разрыва не увидит.
 *
 * Роль двери проба играет сама — и ровно ту, что играет консоль: грузит модуль
 * обвеса портом и отдаёт форме. Своего порта у движка нет и не будет: он не
 * читает файлов и не исполняет чужого кода.
 */
describe('шов целиком: объявление обвеса → план', () => {
  const BLOCK = {
    formVersion: FORM_VERSION,
    source: {
      id: SOURCE_ID,
      title: 'Набор',
      contentRoot: 'content',
    },
    warningFrom: 'warnings.mjs#hooksElsewhere',
    settings: {},
    layout: [{ src: 'ci/build.yml', dest: CI.dest }],
  };

  /** Вход движка, собранный так, как его собирает дверь (`run.ts`). */
  function engineInput(warning: SourceWarning): Declaration {
    const parsed = parseSourceDeclaration(BLOCK);
    if (!parsed.ok) {
      throw new Error(`объявление не разобралось: ${JSON.stringify(parsed.problems)}`);
    }
    return {
      source: {
        id: parsed.value.source.id,
        contentRoot: 'node_modules/@omnifield/canon-kit/content',
        version: '1.0.0',
        warning,
      },
      layout: parsed.value.layout.map((entry) => ({
        src: entry.src,
        dest: entry.dest,
      })),
    };
  }

  it('обвес сказал — текст доезжает до ответа целым', () => {
    const parsed = parseSourceDeclaration(BLOCK);
    expect(parsed.ok).toBe(true);

    // Порт двери: нашла модуль обвеса, позвала экспорт. Форма его разбирает.
    const warning = resolveWarning(
      parsed.ok ? parsed.value : (undefined as never),
      (ref) => {
        expect(ref).toEqual({
          module: 'warnings.mjs',
          member: 'hooksElsewhere',
        });
        return SAID;
      },
    );

    const { tree } = createWorkspace({ layout: [CI], sources: SOURCES });
    const plan = computePlan({ tree, declaration: engineInput(warning) });

    expect(plan.warning).toEqual({ kind: 'said', text: SAID });
    expect(describePlan(plan)).toContain(SAID);
    expect(
      (JSON.parse(JSON.stringify(plan)) as { warning: SourceWarning }).warning,
    ).toEqual({ kind: 'said', text: SAID });
  });

  it('резолвер БРОСИЛ — прогон доезжает, беда приезжает данными', () => {
    // Та самая проба, ради которой шов заведён: у обвеса, попытавшегося
    // сказать, локация не падает. Снятая где-либо по цепи защита от броска
    // красит её броском наружу, а не тихим зелёным.
    const parsed = parseSourceDeclaration(BLOCK);
    const warning = resolveWarning(
      parsed.ok ? parsed.value : (undefined as never),
      () => {
        throw new Error('прочитать локацию нечем');
      },
    );

    const { tree } = createWorkspace({ layout: [CI], sources: SOURCES });
    const plan = computePlan({ tree, declaration: engineInput(warning) });
    const report = applyPlan(tree, plan);

    expect(plan.status).toBe('pending');
    expect(plan.warning.kind === 'failed' && plan.warning.problem.code).toBe(
      'resolver-failed',
    );
    expect(plan.warning.kind === 'failed' && plan.warning.problem.message).toContain(
      'прочитать локацию нечем',
    );
    // Локацию за обстановку не наказывают: артефакт лёг.
    expect(report.applied.map((step) => step.dest)).toContain(CI.dest);
    expect(tree.read(CI.dest, 'utf-8')).toBe(SOURCES['ci/build.yml']);
  });

  it('обвес про предупреждения не знает — цепь молчит вся целиком', () => {
    const { warningFrom: _none, ...silent } = BLOCK;
    const parsed = parseSourceDeclaration(silent);
    const warning = resolveWarning(
      parsed.ok ? parsed.value : (undefined as never),
      () => {
        throw new Error('резолвера тут быть не должно вовсе');
      },
    );

    const { tree } = createWorkspace({ layout: [CI], sources: SOURCES });
    const plan = computePlan({ tree, declaration: engineInput(warning) });

    expect(warning).toEqual({ kind: 'none' });
    expect(plan.warning).toEqual({ kind: 'none' });
    expect(plan.trace.map((span) => span.name)).not.toContain('plan.warning');
  });
});

/**
 * ШОВ НА НАСТОЯЩЕМ — реальный каталог, реальный модуль обвеса, реальный диск.
 *
 * Четыре шва подряд «звено есть, а через него не течёт» находил тот, кто
 * поднимал настоящее, а не мок. Здесь настоящего три: каталог локации на диске,
 * пакет обвеса с его `package.json` и `warnings.mjs`, загруженный обычным
 * `import()`, и дерево движка поверх файловой системы вместо мок-дерева.
 *
 * Обстановку резолвер тоже читает НАСТОЯЩУЮ — файл в локации, а не подсунутое
 * значение: предупреждение существует ровно потому, что зависит от того, как
 * локация настроена, и проба, подсунувшая ответ, проверяла бы не то.
 *
 * Роль двери проба играет сама: грузит модуль, зовёт форму, собирает вход
 * движка. Своего порта у движка нет и не будет.
 */
describe('шов на настоящем каталоге', () => {
  const boxes: string[] = [];

  afterAll(() => {
    for (const box of boxes) {
      rmSync(box, { recursive: true, force: true });
    }
  });

  /** Порт движка поверх файловой системы — шесть методов и пара про режим. */
  function diskTree(root: string): Tree {
    const at = (path: string): string => resolve(root, path);
    return {
      read: (path) =>
        existsSync(at(path)) && statSync(at(path)).isFile()
          ? readFileSync(at(path), 'utf-8')
          : null,
      write: (path, content) => {
        mkdirSync(dirname(at(path)), { recursive: true });
        writeFileSync(at(path), content);
      },
      exists: (path) => existsSync(at(path)),
      isFile: (path) => existsSync(at(path)) && statSync(at(path)).isFile(),
      children: (path) =>
        existsSync(at(path)) && statSync(at(path)).isDirectory()
          ? readdirSync(at(path))
          : [],
      delete: (path) => {
        if (existsSync(at(path))) {
          unlinkSync(at(path));
        }
      },
    };
  }

  /** Локация с настоящим пакетом обвеса внутри. */
  function locale(options: {
    readonly id: string;
    readonly pkg: string;
    readonly warningFrom?: string;
    readonly resolver?: string;
    readonly hooksAt?: string;
  }): { readonly root: string; readonly home: string; readonly manifest: unknown } {
    const root = mkdtempSync(join(tmpdir(), 'baser-warning-'));
    boxes.push(root);

    // Обстановка локации — настоящий файл на диске: её и читает резолвер.
    if (options.hooksAt !== undefined) {
      writeFileSync(join(root, 'locale.conf'), `hooks=${options.hooksAt}\n`);
    }

    const home = join(root, 'node_modules', options.pkg);
    mkdirSync(join(home, 'content'), { recursive: true });
    writeFileSync(join(home, 'content', 'pre-commit'), '#!/bin/sh\necho hi\n');
    const manifest = {
      name: options.pkg,
      version: '1.2.3',
      baser: {
        formVersion: FORM_VERSION,
        source: { id: options.id, title: options.id, contentRoot: 'content' },
        ...(options.warningFrom ? { warningFrom: options.warningFrom } : {}),
        settings: {},
        layout: [{ src: 'pre-commit', dest: 'hooks/pre-commit' }],
      },
    };
    writeFileSync(join(home, 'package.json'), JSON.stringify(manifest, null, 2));
    if (options.resolver !== undefined) {
      writeFileSync(join(home, 'warnings.mjs'), options.resolver);
    }
    return { root, home, manifest };
  }

  /** То, что делает дверь: разбор формы, загрузка модуля, вызов порта. */
  async function doorRun(box: {
    readonly root: string;
    readonly home: string;
    readonly manifest: unknown;
  }): Promise<{ readonly plan: ReturnType<typeof computePlan>; readonly tree: Tree }> {
    const parsed = readSourceDeclaration(box.manifest, 'package.json');
    if (!parsed.ok) {
      throw new Error(`объявление не разобралось: ${JSON.stringify(parsed.problems)}`);
    }
    const declared = parsed.value;

    const loaded =
      declared.warningFrom === undefined
        ? null
        : ((await import(
            pathToFileURL(join(box.home, declared.warningFrom.module)).href
          )) as Record<string, (context: { root: string }) => unknown>);

    const warning = resolveWarning(declared, (ref) =>
      (loaded as Record<string, (context: { root: string }) => unknown>)[ref.member]({
        root: box.root,
      }),
    );

    const tree = diskTree(box.root);
    const plan = computePlan({
      tree,
      declaration: {
        source: {
          id: declared.source.id,
          contentRoot: relative(box.root, join(box.home, declared.source.contentRoot)),
          version: '1.2.3',
          warning,
        },
        layout: declared.layout.map((entry) => ({
          src: entry.src,
          dest: entry.dest,
        })),
      },
    });
    applyPlan(tree, plan);
    return { plan, tree };
  }

  it('обвес прочитал ОБСТАНОВКУ и его текст доехал до ответа', async () => {
    const box = locale({
      id: 'omnifield/canon-kit',
      pkg: '@omnifield/canon-kit',
      warningFrom: 'warnings.mjs#hooksElsewhere',
      hooksAt: 'hooks-elsewhere',
      resolver: `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function hooksElsewhere(context) {
  const at = readFileSync(join(context.root, 'locale.conf'), 'utf-8').trim().split('=')[1];
  return at === 'hooks' ? null : 'локация смотрит в "' + at + '": артефакт ляжет и не сработает';
}
`,
    });

    const { plan, tree } = await doorRun(box);

    expect(plan.warning).toEqual({
      kind: 'said',
      text: 'локация смотрит в "hooks-elsewhere": артефакт ляжет и не сработает',
    });
    // Прогон при этом ВЕРНЫЙ, и артефакт лежит на настоящем диске.
    expect(plan.status).toBe('pending');
    expect(tree.read('hooks/pre-commit', 'utf-8')).toBe('#!/bin/sh\necho hi\n');
    expect(
      readFileSync(join(box.root, 'hooks/pre-commit'), 'utf-8'),
    ).toBe('#!/bin/sh\necho hi\n');
    expect(describePlan(plan)).toContain('hooks-elsewhere');
  });

  it('обстановка в порядке — обвес молчит, и молчание доезжает тоже', async () => {
    const box = locale({
      id: 'omnifield/canon-kit',
      pkg: '@omnifield/canon-kit',
      warningFrom: 'warnings.mjs#hooksElsewhere',
      hooksAt: 'hooks',
      resolver: `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function hooksElsewhere(context) {
  const at = readFileSync(join(context.root, 'locale.conf'), 'utf-8').trim().split('=')[1];
  return at === 'hooks' ? null : 'локация смотрит мимо';
}
`,
    });

    const { plan } = await doorRun(box);

    expect(plan.warning).toEqual({ kind: 'none' });
    expect(plan.status).toBe('pending');
  });

  it('резолвер БРОСИЛ на настоящем модуле — локация всё равно оснащена', async () => {
    const box = locale({
      id: 'omnifield/broken-kit',
      pkg: '@omnifield/broken-kit',
      warningFrom: 'warnings.mjs#brokenWarning',
      resolver: `export function brokenWarning(context) {
  throw new Error('прочитать обстановку нечем: ' + context.root);
}
`,
    });

    const { plan } = await doorRun(box);

    expect(plan.status).toBe('pending');
    expect(plan.warning.kind === 'failed' && plan.warning.problem.code).toBe(
      'resolver-failed',
    );
    // Локацию за обстановку не наказывают: файл на диске.
    expect(existsSync(join(box.root, 'hooks/pre-commit'))).toBe(true);
    // И машинный ответ несёт беду целиком — пульт увидит то же, что человек.
    expect(
      (JSON.parse(JSON.stringify(plan)) as { warning: SourceWarning }).warning,
    ).toEqual(plan.warning);
  });
});
