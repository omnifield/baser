/**
 * ПАСПОРТ ПОМНИТ, ЧТО МЫ СДЕЛАЛИ С ФАЙЛОМ, — и из этого следует всё остальное.
 *
 * Раскладка объявляет НАМЕРЕНИЕ («этот артефакт — программа»), паспорт укладки
 * хранит СЛЕД («бит поставили мы»). Пока следа не было, движок мог отвечать
 * только на вопрос «что сказал обвес» — и на нём же спотыкался: сошедшийся
 * артефакт объявленного сегодня режима не получал вовсе (`tasker:BASER2-214`,
 * названная граница), а симметричное правило «нет поля — значит не исполняемый»
 * молча снесло бы бит, выставленный человеком руками. Решение целиком —
 * `kb:BASER3-36`, работа — `tasker:BASER2-222`.
 *
 * Судится здесь таблица решения §2 целиком, по пробе на строку:
 *
 * | объявлено | след   | что делаем               |
 * | --------- | ------ | ------------------------ |
 * | `true`    | нет    | ставим бит               |
 * | `true`    | `false`| ставим бит               |
 * | `false`   | `true` | снимаем — он наш         |
 * | `false`   | нет    | **НЕ ТРОГАЕМ**           |
 *
 * Последняя строка и есть инвариант «baser никогда не снимает бит, которого не
 * записал, что ставил». Проверяется он не рассуждением: соседняя проба кладёт
 * бит на файл руками и требует, чтобы обновление содержимого его не тронуло.
 *
 * Пробное дерево записывает ВЫЗОВЫ ПОРТА: движок файловой системы не касается, и
 * «поставил бит» для него означает ровно одно — позвал порт. Что раннер сделает
 * с этим на диске, судит отдельный блок в конце — на настоящей файловой системе,
 * потому что звено кончается не на вызове, а на файле (урок `tasker:BASER2-215`).
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPlan } from './apply.js';
import type { Declaration, LayoutEntry } from './declaration.js';
import { DeclarationError } from './errors.js';
import { MANIFEST_PATH, MANIFEST_VERSION, hashContent } from './manifest.js';
import type { ManifestRecord } from './manifest.js';
import { computePlan, describePlan } from './plan.js';
import type { MaterializationPlan, PlanStep } from './plan.js';
import type { Tree } from './tree.js';

const CONTENT_ROOT = 'node_modules/@omnifield/git-kit/content';
const SOURCE_ID = 'omnifield/git-kit';
const SOURCE_VERSION = '1.0.0';
const HOOK = '.husky/pre-commit';
const TEMPLATE = 'hooks/pre-commit';
const SCRIPT = '#!/bin/sh\npnpm verify\n';
/** Хеш ровно того содержимого, что даёт шаблон, — иначе проба судила бы не то. */
const HASH = hashContent(SCRIPT);

/** Вызов порта, записанный пробным деревом. */
type Call =
  | { readonly method: 'write'; readonly path: string }
  | {
      readonly method: 'setExecutable';
      readonly path: string;
      readonly executable: boolean;
    };

interface ProbeTree extends Tree {
  readonly calls: readonly Call[];
}

function declarationOf(entry: LayoutEntry): Declaration {
  return {
    source: {
      id: SOURCE_ID,
      contentRoot: CONTENT_ROOT,
      version: SOURCE_VERSION,
    },
    layout: [entry],
  };
}

/**
 * Паспорт укладки, УЖЕ лежащий в дереве, — в заданной форме.
 *
 * Форма подаётся числом, а не берётся из `MANIFEST_VERSION`: смысл проб про
 * совместимость ровно в том, что на диске у потребителя лежит СТАРАЯ форма, и
 * подставить сюда сегодняшнюю значило бы проверить движок на самом себе.
 */
function passport(
  record: Partial<ManifestRecord> & { readonly executable?: boolean },
  version = MANIFEST_VERSION,
): string {
  return `${JSON.stringify(
    {
      version,
      artifacts: [
        {
          dest: HOOK,
          src: TEMPLATE,
          source: SOURCE_ID,
          version: SOURCE_VERSION,
          class: 'regenerated',
          hash: HASH,
          ...record,
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/**
 * Дерево, записывающее вызовы порта.
 *
 * `knowsMode: false` — раннер, написанный ДО режима: у него нет члена
 * `setExecutable`, и это законное состояние порта, а не поломка.
 */
function probeTree(
  options: {
    readonly knowsMode?: boolean;
    /** Что уже лежит в дереве потребителя, помимо шаблона. */
    readonly existing?: Readonly<Record<string, string>>;
  } = {},
): ProbeTree {
  const files = new Map<string, string>([
    [`${CONTENT_ROOT}/${TEMPLATE}`, SCRIPT],
    ...Object.entries(options.existing ?? {}),
  ]);
  const calls: Call[] = [];

  const tree = {
    calls,
    read: (path: string): string | null => files.get(path) ?? null,
    write(path: string, content: string): void {
      files.set(path, content);
      calls.push({ method: 'write', path });
    },
    exists: (path: string): boolean =>
      files.has(path) ||
      [...files.keys()].some((key) => key.startsWith(`${path}/`)),
    isFile: (path: string): boolean => files.has(path),
    children: (dir: string): string[] => [
      ...new Set(
        [...files.keys()]
          .filter((key) => key.startsWith(`${dir}/`))
          .map((key) => key.slice(dir.length + 1).split('/')[0]),
      ),
    ],
    delete: (path: string): void => {
      files.delete(path);
    },
  };

  return options.knowsMode === false
    ? tree
    : {
        ...tree,
        setExecutable(path: string, executable: boolean): void {
          calls.push({ method: 'setExecutable', path, executable });
        },
      };
}

/** Прогон одной записи раскладки на пробном дереве. */
function materialize(
  entry: LayoutEntry,
  tree: ProbeTree = probeTree(),
): { readonly tree: ProbeTree; readonly plan: MaterializationPlan } {
  const plan = computePlan({ tree, declaration: declarationOf(entry) });
  applyPlan(tree, plan);
  return { tree, plan };
}

/** Вызовы порта по самому артефакту — без записи паспорта укладки. */
function callsForHook(tree: ProbeTree): readonly Call[] {
  return tree.calls.filter((call) => call.path === HOOK);
}

function stepFor(plan: MaterializationPlan): PlanStep | undefined {
  return plan.steps.find((step) => step.dest === HOOK);
}

/** Запись паспорта, какой она станет после применения плана. */
function recordFor(plan: MaterializationPlan): ManifestRecord | undefined {
  return plan.manifest.find((record) => record.dest === HOOK);
}

describe('таблица решения: объявленное против следа', () => {
  it('объявлено true, следа нет — СТАВИМ бит и записываем след', () => {
    const { tree, plan } = materialize(
      { src: TEMPLATE, dest: HOOK, executable: true },
      probeTree({
        existing: { [HOOK]: SCRIPT, [MANIFEST_PATH]: passport({ hash: HASH }) },
      }),
    );

    // Содержимое сошлось — шаг не про него, и это видно по виду шага.
    expect(stepFor(plan)?.kind).toBe('chmod');
    expect(stepFor(plan)?.restated).toContain('executable');
    expect(callsForHook(tree)).toEqual([
      { method: 'setExecutable', path: HOOK, executable: true },
    ]);
    expect(recordFor(plan)?.executable).toBe(true);
  });

  it('объявлено true, в записи false — СТАВИМ: оба написания «не ставили» равны', () => {
    const { tree, plan } = materialize(
      { src: TEMPLATE, dest: HOOK, executable: true },
      probeTree({
        existing: {
          [HOOK]: SCRIPT,
          [MANIFEST_PATH]: passport({ hash: HASH, executable: false }),
        },
      }),
    );

    expect(stepFor(plan)?.kind).toBe('chmod');
    expect(callsForHook(tree)).toEqual([
      { method: 'setExecutable', path: HOOK, executable: true },
    ]);
  });

  it('объявлено false, след есть — СНИМАЕМ: бит наш, мы его и ставили', () => {
    const { tree, plan } = materialize(
      { src: TEMPLATE, dest: HOOK, executable: false },
      probeTree({
        existing: {
          [HOOK]: SCRIPT,
          [MANIFEST_PATH]: passport({ hash: HASH, executable: true }),
        },
      }),
    );

    expect(stepFor(plan)?.kind).toBe('chmod');
    expect(callsForHook(tree)).toEqual([
      { method: 'setExecutable', path: HOOK, executable: false },
    ]);
    // След уходит вместе с битом: следующий прогон не должен увидеть работу.
    expect(recordFor(plan)?.executable).toBeUndefined();
  });

  it('объявлено false, в записи false — сходимость, а не работа', () => {
    // Два написания одного и того же не имеют права выглядеть расхождением:
    // иначе прогон снял бы бит, которого не ставил, — и отчитался бы работой на
    // сошедшемся дереве.
    const tree = probeTree({
      existing: {
        [HOOK]: SCRIPT,
        [MANIFEST_PATH]: passport({ hash: HASH, executable: false }),
      },
    });

    const plan = computePlan({
      tree,
      declaration: declarationOf({
        src: TEMPLATE,
        dest: HOOK,
        executable: false,
      }),
    });
    applyPlan(tree, plan);

    expect(plan.status).toBe('converged');
    expect(tree.calls).toEqual([]);
  });

  it('объявлено false, следа нет — НЕ ТРОГАЕМ ВОВСЕ: шага нет, порт не зван', () => {
    const { tree, plan } = materialize(
      { src: TEMPLATE, dest: HOOK, executable: false },
      probeTree({
        existing: { [HOOK]: SCRIPT, [MANIFEST_PATH]: passport({ hash: HASH }) },
      }),
    );

    expect(plan.status).toBe('converged');
    expect(callsForHook(tree)).toEqual([]);
  });
});

describe('инвариант: чужой бит не снимается', () => {
  it('обновление содержимого не трогает бит, которого движок не ставил', () => {
    // Живой случай: файл с шебангом, которому бит выставил человек. Раскладка
    // про режим молчит (или говорит «данные» — это одно и то же), следа нет.
    // Симметричное правило «нет поля — значит не исполняемый» снесло бы бит
    // молча, и это был бы `tasker:BASER2-208` с другой стороны.
    const { tree, plan } = materialize(
      { src: TEMPLATE, dest: HOOK, executable: false },
      probeTree({
        existing: {
          [HOOK]: '#!/bin/sh\nстарое содержимое\n',
          [MANIFEST_PATH]: passport({ hash: 'sha256:старое' }),
        },
      }),
    );

    // Содержимое расходится — шаг есть, и он перекладывает файл целиком.
    expect(stepFor(plan)?.kind).toBe('update');
    // А вот режим при этом не доносится НИКАК: снимать нечего.
    expect(stepFor(plan)?.executable).toBeUndefined();
    expect(callsForHook(tree)).toEqual([{ method: 'write', path: HOOK }]);
  });

  it('и не трогает его же, когда объявления про режим нет вовсе', () => {
    const { tree } = materialize(
      { src: TEMPLATE, dest: HOOK },
      probeTree({
        existing: {
          [HOOK]: '#!/bin/sh\nстарое содержимое\n',
          [MANIFEST_PATH]: passport({ hash: 'sha256:старое' }),
        },
      }),
    );

    expect(
      tree.calls.filter((call) => call.method === 'setExecutable'),
    ).toEqual([]);
  });
});

describe('взятие во владение', () => {
  it('placed-once, объявленный программой: бит ставим, содержимое не трогаем', () => {
    // Класс говорит про СОДЕРЖИМОЕ («положено однажды, дальше не трогаем»), а
    // объявление «программа» — про то, чем файл является. Следа за нами ещё нет,
    // подтверждение дано поимённо — это первая строка таблицы решения.
    const human = '#!/bin/sh\nчеловек писал это сам\n';
    const tree = probeTree({ existing: { [HOOK]: human } });

    const plan = computePlan({
      tree,
      declaration: declarationOf({
        src: TEMPLATE,
        dest: HOOK,
        class: 'placed-once',
        executable: true,
      }),
      confirm: [HOOK],
    });
    applyPlan(tree, plan);

    expect(stepFor(plan)?.kind).toBe('chmod');
    expect(stepFor(plan)?.reason).toBe('adopted');
    expect(tree.read(HOOK, 'utf-8')).toBe(human);
    expect(callsForHook(tree)).toEqual([
      { method: 'setExecutable', path: HOOK, executable: true },
    ]);
  });

  it('он же без объявления режима остаётся шагом записи — бит не наш', () => {
    const human = '#!/bin/sh\nчеловек писал это сам\n';
    const tree = probeTree({ existing: { [HOOK]: human } });

    const plan = computePlan({
      tree,
      declaration: declarationOf({
        src: TEMPLATE,
        dest: HOOK,
        class: 'placed-once',
      }),
      confirm: [HOOK],
    });
    applyPlan(tree, plan);

    expect(stepFor(plan)?.kind).toBe('record');
    expect(callsForHook(tree)).toEqual([]);
  });
});

describe('мёртвая ветка «обвес промолчал» снята', () => {
  it('«нет поля» и «executable: false» дают ОДИН И ТОТ ЖЕ план — следа нет', () => {
    const existing = {
      [HOOK]: SCRIPT,
      [MANIFEST_PATH]: passport({ hash: HASH }),
    };

    const silent = computePlan({
      tree: probeTree({ existing }),
      declaration: declarationOf({ src: TEMPLATE, dest: HOOK }),
    });
    const said = computePlan({
      tree: probeTree({ existing }),
      declaration: declarationOf({
        src: TEMPLATE,
        dest: HOOK,
        executable: false,
      }),
    });

    expect(silent.steps).toEqual(said.steps);
    expect(silent.status).toBe(said.status);
  });

  it('и тот же самый — когда след ЕСТЬ: снимаем в обоих случаях одинаково', () => {
    const existing = {
      [HOOK]: SCRIPT,
      [MANIFEST_PATH]: passport({ hash: HASH, executable: true }),
    };

    const silent = materialize(
      { src: TEMPLATE, dest: HOOK },
      probeTree({ existing }),
    );
    const said = materialize(
      { src: TEMPLATE, dest: HOOK, executable: false },
      probeTree({ existing }),
    );

    expect(silent.plan.steps).toEqual(said.plan.steps);
    expect(callsForHook(silent.tree)).toEqual(callsForHook(said.tree));
    expect(callsForHook(silent.tree)).toEqual([
      { method: 'setExecutable', path: HOOK, executable: false },
    ]);
  });
});

describe('паспорт формы 2 читается без правки на диске', () => {
  it('артефакт, про режим которого не объявлено, не двигается вовсе', () => {
    const tree = probeTree({
      existing: {
        [HOOK]: SCRIPT,
        [MANIFEST_PATH]: passport({ hash: HASH }, 2),
      },
    });

    const plan = computePlan({
      tree,
      declaration: declarationOf({ src: TEMPLATE, dest: HOOK }),
    });
    applyPlan(tree, plan);

    // Номер формы сам по себе работой не является: паспорт переписывается, когда
    // в нём что-то меняется по делу, а не ради версии.
    expect(plan.status).toBe('converged');
    expect(tree.calls).toEqual([]);
    expect(JSON.parse(tree.read(MANIFEST_PATH, 'utf-8') as string).version).toBe(
      2,
    );
  });

  it('а объявленный исполняемым — двигается, и паспорт уезжает в форму 3', () => {
    const tree = probeTree({
      existing: {
        [HOOK]: SCRIPT,
        [MANIFEST_PATH]: passport({ hash: HASH }, 2),
      },
    });

    applyPlan(
      tree,
      computePlan({
        tree,
        declaration: declarationOf({
          src: TEMPLATE,
          dest: HOOK,
          executable: true,
        }),
      }),
    );

    const written = JSON.parse(tree.read(MANIFEST_PATH, 'utf-8') as string);
    expect(written.version).toBe(3);
    expect(written.artifacts[0].executable).toBe(true);
  });

  it('паспорт формы 1 по-прежнему отвергается — там досочинять нечего', () => {
    const tree = probeTree({
      existing: { [MANIFEST_PATH]: passport({ hash: HASH }, 1) },
    });

    expect(() =>
      computePlan({ tree, declaration: declarationOf({ src: TEMPLATE, dest: HOOK }) }),
    ).toThrow(/версия манифеста/);
  });
});

describe('контракт порта', () => {
  it('setExecutable зовётся на пути, который прогон НЕ пишет', () => {
    // Раньше режим ехал только вместе с содержимым, и раннеру хватало держать
    // его при записи. Шаг `chmod` этого не даёт: содержимое совпало, писать
    // нечего — и порт всё равно обязан привести бит.
    const { tree } = materialize(
      { src: TEMPLATE, dest: HOOK, executable: true },
      probeTree({
        existing: { [HOOK]: SCRIPT, [MANIFEST_PATH]: passport({ hash: HASH }) },
      }),
    );

    expect(
      tree.calls.filter((call) => call.method === 'write' && call.path === HOOK),
    ).toEqual([]);
    expect(callsForHook(tree)).toEqual([
      { method: 'setExecutable', path: HOOK, executable: true },
    ]);
  });

  it('строка плана говорит, что содержимое совпало, а разошёлся режим', () => {
    // Человек читает строку, а не поле: шаг, названный «обновить», отправил бы
    // его искать изменение содержимого, которого нет (`kb:BASER3-36` §3).
    const tree = probeTree({
      existing: { [HOOK]: SCRIPT, [MANIFEST_PATH]: passport({ hash: HASH }) },
    });

    const text = describePlan(
      computePlan({
        tree,
        declaration: declarationOf({
          src: TEMPLATE,
          dest: HOOK,
          executable: true,
        }),
      }),
    );

    expect(text).toContain('chmod');
    expect(text).toContain('содержимое совпало');
    expect(text).toContain('ставим бит');
    expect(text).not.toContain('update');
  });

  it('раннер, не знающий про режим, не падает — и назван в трейсе', () => {
    const tree = probeTree({
      knowsMode: false,
      existing: { [HOOK]: SCRIPT, [MANIFEST_PATH]: passport({ hash: HASH }) },
    });

    const report = applyPlan(
      tree,
      computePlan({
        tree,
        declaration: declarationOf({
          src: TEMPLATE,
          dest: HOOK,
          executable: true,
        }),
      }),
    );

    expect(
      report.trace.find((span) => span.name === 'apply.executable')?.detail,
    ).toEqual({ declared: 1, delivered: 0, port: 'blind' });
  });

  it('не-булево значение объявления — отказ по входу, а не тихая передача', () => {
    expect(() =>
      computePlan({
        tree: probeTree(),
        declaration: declarationOf({
          src: TEMPLATE,
          dest: HOOK,
          executable: 'yes' as unknown as boolean,
        }),
      }),
    ).toThrow(DeclarationError);
  });

  it('не-булевой след в паспорте — отказ: догадка сняла бы чужой бит', () => {
    const tree = probeTree({
      existing: {
        [HOOK]: SCRIPT,
        [MANIFEST_PATH]: passport({ hash: HASH, executable: 'да' as never }),
      },
    });

    expect(() =>
      computePlan({
        tree,
        declaration: declarationOf({ src: TEMPLATE, dest: HOOK }),
      }),
    ).toThrow(/executable/);
  });
});

/**
 * ЗВЕНО КОНЧАЕТСЯ НЕ НА ВЫЗОВЕ, А НА ФАЙЛЕ.
 *
 * Прошлый шов показал, чего стоит проверка «до своей границы»: поле умирало в
 * консоли при живом порте, и заметили это только пробы на другом конце
 * (`tasker:BASER2-215`). Поэтому здесь — настоящая файловая система и
 * простейший раннер поверх неё: ровно то, что обязан уметь тот, кто возьмёт
 * этот план. Дерево двери сюда не импортируется (чужая зона) — судится
 * ВОЗМОЖНОСТЬ, а не чужая реализация.
 */
describe('сквозной путь: план доводится до бита на диске', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Раннер над реальной ФС: шесть методов порта плюс режим. */
  function diskTree(): { readonly tree: Tree; readonly root: string } {
    const root = mkdtempSync(join(tmpdir(), 'baser-mode-'));
    roots.push(root);
    const full = (path: string): string => join(root, path);

    mkdirSync(dirname(full(`${CONTENT_ROOT}/${TEMPLATE}`)), { recursive: true });
    writeFileSync(full(`${CONTENT_ROOT}/${TEMPLATE}`), SCRIPT);

    const tree: Tree = {
      read: (path) =>
        existsOnDisk(full(path)) && statSync(full(path)).isFile()
          ? readFileSync(full(path), 'utf-8')
          : null,
      write: (path, content) => {
        mkdirSync(dirname(full(path)), { recursive: true });
        writeFileSync(full(path), content);
      },
      exists: (path) => existsOnDisk(full(path)),
      isFile: (path) =>
        existsOnDisk(full(path)) && statSync(full(path)).isFile(),
      children: (dir) => readdirSync(full(dir)),
      delete: (path) => rmSync(full(path), { recursive: true, force: true }),
      // Кладётся БИТ поверх сложившегося режима, а не режим целиком: объявление
      // отвечает на вопрос «программа или данные», а не «кому читать».
      setExecutable: (path, executable) => {
        const mode = statSync(full(path)).mode & 0o777;
        chmodSync(full(path), executable ? mode | 0o111 : mode & ~0o111);
      },
    };

    return { tree, root };
  }

  const executableOnDisk = (root: string, path: string): boolean =>
    (statSync(join(root, path)).mode & 0o111) !== 0;

  const run = (tree: Tree, entry: LayoutEntry): MaterializationPlan => {
    const plan = computePlan({ tree, declaration: declarationOf(entry) });
    applyPlan(tree, plan);
    return plan;
  };

  it('объявленный исполняемым ложится с битом, и второй прогон сходится', () => {
    const { tree, root } = diskTree();

    run(tree, { src: TEMPLATE, dest: HOOK, executable: true });
    expect(executableOnDisk(root, HOOK)).toBe(true);

    const again = run(tree, { src: TEMPLATE, dest: HOOK, executable: true });
    expect(again.status).toBe('converged');
    expect(executableOnDisk(root, HOOK)).toBe(true);
  });

  it('бит доезжает и до УЖЕ ЛЕЖАЩЕГО артефакта — того, ради чего всё затевалось', () => {
    const { tree, root } = diskTree();

    // Обвес сначала клал файл данными: ровно состояние живой локации из
    // `tasker:BASER2-208` — хук лежит, а машина молча не работает.
    run(tree, { src: TEMPLATE, dest: HOOK });
    expect(executableOnDisk(root, HOOK)).toBe(false);

    // Обвес объявил его программой. Содержимое не менялось ни на байт.
    const plan = run(tree, { src: TEMPLATE, dest: HOOK, executable: true });

    expect(plan.steps.map((step) => step.kind)).toEqual(['chmod']);
    expect(executableOnDisk(root, HOOK)).toBe(true);
  });

  it('снятие объявления снимает бит — он наш', () => {
    const { tree, root } = diskTree();

    run(tree, { src: TEMPLATE, dest: HOOK, executable: true });
    run(tree, { src: TEMPLATE, dest: HOOK, executable: false });

    expect(executableOnDisk(root, HOOK)).toBe(false);
    expect(
      run(tree, { src: TEMPLATE, dest: HOOK, executable: false }).status,
    ).toBe('converged');
  });

  it('бит, выставленный ЧЕЛОВЕКОМ, переживает обновление содержимого', () => {
    const { tree, root } = diskTree();

    run(tree, { src: TEMPLATE, dest: HOOK });
    chmodSync(join(root, HOOK), 0o755);
    writeFileSync(join(root, `${CONTENT_ROOT}/${TEMPLATE}`), `${SCRIPT}# ещё\n`);

    const plan = run(tree, { src: TEMPLATE, dest: HOOK });

    expect(plan.steps.map((step) => step.kind)).toEqual(['update']);
    expect(readFileSync(join(root, HOOK), 'utf-8')).toBe(`${SCRIPT}# ещё\n`);
    expect(executableOnDisk(root, HOOK)).toBe(true);
  });
});

function existsOnDisk(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
