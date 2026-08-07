/**
 * РЕЖИМ АРТЕФАКТА ДОЕЗЖАЕТ ДО ПОРТА — и различает ТРИ состояния, а не два.
 *
 * Раскладка научилась объявлять исполняемость (`layout[].executable`, форма 6,
 * `tasker:BASER2-213`), но объявление, которое некуда донести, ничего не меняет:
 * обвес git кладёт хук `pre-commit`, файл ложится обычным, и коммит в такой
 * локации проходит БЕЗ ПРОВЕРКИ — молча (`tasker:BASER2-208`). Здесь судится
 * шов между объявлением и тем, кто пишет.
 *
 * Пробное дерево записывает ВЫЗОВЫ, а не результат: движок файловой системы не
 * касается вовсе, и «положил исполняемым» для него означает ровно одно — позвал
 * порт и передал ему то, что объявил обвес. Что раннер сделает с этим на диске
 * (chmod, бит индекса git, ничего на Windows) — его обязательство, и судить его
 * здесь значило бы судить чужую зону.
 *
 * Три состояния, из-за которых проба вообще нужна:
 *   — обвес сказал `true` — порт зовётся с `true`;
 *   — обвес сказал `false` — порт зовётся с `false`: это утверждение «не
 *     программа», а не молчание;
 *   — обвес не сказал ничего — порт НЕ зовётся вовсе, и раннер оставляет файлу
 *     тот режим, который у него был. Умолчание вместо этого превратило бы
 *     молчание обвеса в его утверждение.
 */

import { describe, expect, it } from 'vitest';
import { applyPlan } from './apply.js';
import type { Declaration, LayoutEntry } from './declaration.js';
import { DeclarationError } from './errors.js';
import { computePlan } from './plan.js';
import type { Tree } from './tree.js';

const CONTENT_ROOT = 'node_modules/@omnifield/git-kit/content';
const SOURCE_ID = 'omnifield/git-kit';
const HOOK = '.husky/pre-commit';
const TEMPLATE = 'hooks/pre-commit';
const SCRIPT = '#!/bin/sh\npnpm verify\n';

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
    source: { id: SOURCE_ID, contentRoot: CONTENT_ROOT, version: '1.0.0' },
    layout: [entry],
  };
}

/**
 * Дерево, записывающее вызовы порта.
 *
 * `knowsMode: false` — раннер, написанный ДО режима: у него нет члена
 * `setExecutable`, и это законное состояние порта, а не поломка.
 */
function probeTree(options: { readonly knowsMode: boolean }): ProbeTree {
  const files = new Map<string, string>([
    [`${CONTENT_ROOT}/${TEMPLATE}`, SCRIPT],
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
      files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`)),
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

  return options.knowsMode
    ? {
        ...tree,
        setExecutable(path: string, executable: boolean): void {
          calls.push({ method: 'setExecutable', path, executable });
        },
      }
    : tree;
}

/** Прогон одной записи раскладки на пробном дереве. */
function materialize(
  entry: LayoutEntry,
  options: { readonly knowsMode: boolean } = { knowsMode: true },
): ProbeTree {
  const tree = probeTree(options);
  applyPlan(tree, computePlan({ tree, declaration: declarationOf(entry) }));
  return tree;
}

describe('объявленный режим доезжает до порта', () => {
  it('объявленный исполняемым доносит признак — и ПОСЛЕ содержимого', () => {
    const tree = materialize({ src: TEMPLATE, dest: HOOK, executable: true });

    // Порядок — часть утверждения: раннер держит режим при записи (дерево двери
    // так и устроено), и объявить режим файла, которого он ещё не видел, нечему.
    expect(tree.calls.filter((call) => call.path === HOOK)).toEqual([
      { method: 'write', path: HOOK },
      { method: 'setExecutable', path: HOOK, executable: true },
    ]);
    // Паспорт укладки движок кладёт той же записью и БЕЗ режима: он служебная
    // запись, а не артефакт, и объявлять про него обвесу нечего.
    expect(tree.calls.filter((call) => call.method === 'setExecutable')).toEqual(
      [{ method: 'setExecutable', path: HOOK, executable: true }],
    );
  });

  it('объявленный НЕисполняемым доносит false — это утверждение, а не молчание', () => {
    const tree = materialize({ src: TEMPLATE, dest: HOOK, executable: false });

    expect(tree.calls).toContainEqual({
      method: 'setExecutable',
      path: HOOK,
      executable: false,
    });
  });

  it('необъявленный не доносит НИЧЕГО — умолчания движок не подставляет', () => {
    const tree = materialize({ src: TEMPLATE, dest: HOOK });

    // Именно «ни одного вызова», а не «вызов с false»: раннер обязан отличать
    // «обвес молчит» от «обвес сказал, что это данные», и отличает он их по
    // факту вызова.
    expect(tree.calls.filter((call) => call.path === HOOK)).toEqual([
      { method: 'write', path: HOOK },
    ]);
  });

  it('шаг плана несёт объявленное — и не несёт неназванного', () => {
    const tree = probeTree({ knowsMode: true });

    const declared = computePlan({
      tree,
      declaration: declarationOf({ src: TEMPLATE, dest: HOOK, executable: true }),
    });
    const silent = computePlan({
      tree,
      declaration: declarationOf({ src: TEMPLATE, dest: HOOK }),
    });

    expect(declared.steps[0].executable).toBe(true);
    // Поля НЕТ, а не `undefined` значением: план — данные, и «не объявлено»
    // обязано читаться отсутствием ключа в сериализованном виде тоже.
    expect('executable' in silent.steps[0]).toBe(false);
  });

  it('не-булево значение — отказ по входу, а не тихая передача в порт', () => {
    const tree = probeTree({ knowsMode: true });

    expect(() =>
      computePlan({
        tree,
        declaration: declarationOf({
          src: TEMPLATE,
          dest: HOOK,
          executable: 'yes' as unknown as boolean,
        }),
      }),
    ).toThrow(DeclarationError);
  });
});

describe('раннер, не знающий про режим', () => {
  it('работает как работал — объявленный режим применение не роняет', () => {
    const tree = materialize(
      { src: TEMPLATE, dest: HOOK, executable: true },
      { knowsMode: false },
    );

    expect(tree.read(HOOK, 'utf-8')).toBe(SCRIPT);
    expect(tree.calls.filter((call) => call.path === HOOK)).toEqual([
      { method: 'write', path: HOOK },
    ]);
  });

  it('назван в трейсе: объявлено — да, донесено — нет', () => {
    const tree = probeTree({ knowsMode: false });

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

    // Молчание здесь было бы тем же расхождением «объявлено» и «лежит», из-за
    // которого форма 6 и появилась: разница `declared` и `delivered` — весь
    // ответ на «почему хук не работает».
    expect(
      report.trace.find((span) => span.name === 'apply.executable')?.detail,
    ).toEqual({ declared: 1, delivered: 0, port: 'blind' });
  });

  it('дерево, принявшее режим, отчитывается доставленным', () => {
    const tree = probeTree({ knowsMode: true });

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
    ).toEqual({ declared: 1, delivered: 1, port: 'accepts' });
  });

  it('прогон без объявленного режима события не носит вовсе', () => {
    const tree = probeTree({ knowsMode: true });

    const report = applyPlan(
      tree,
      computePlan({
        tree,
        declaration: declarationOf({ src: TEMPLATE, dest: HOOK }),
      }),
    );

    expect(report.trace.map((span) => span.name)).not.toContain(
      'apply.executable',
    );
  });
});

describe('граница шва — режим едет вместе с содержимым', () => {
  it('сошедшийся артефакт режима не доносит: шага нет, доносить нечем', () => {
    // ЗАФИКСИРОВАНО КАК ЕСТЬ, а не как хотелось бы. Обвес, дописавший
    // `executable: true` к уже лежащему артефакту, до порта не доедет: паспорт
    // укладки режима не помнит, значит смена объявленного режима расхождением
    // не считается и шага не порождает. Причина — форма паспорта, и чинится она
    // там (заявлено architect'у по `tasker:BASER2-214`); залатать это проверкой
    // в шаге значило бы лечить следствие: сошедшийся артефакт шага не имеет
    // вовсе, и латать было бы нечего.
    const tree = probeTree({ knowsMode: true });
    applyPlan(
      tree,
      computePlan({
        tree,
        declaration: declarationOf({ src: TEMPLATE, dest: HOOK }),
      }),
    );
    const calls = tree.calls.length;

    const plan = computePlan({
      tree,
      declaration: declarationOf({ src: TEMPLATE, dest: HOOK, executable: true }),
    });

    expect(plan.status).toBe('converged');
    expect(tree.calls).toHaveLength(calls);
  });

  it('раскладка объявляет программы — видно в телеметрии плана', () => {
    const tree = probeTree({ knowsMode: true });

    const plan = computePlan({
      tree,
      declaration: declarationOf({ src: TEMPLATE, dest: HOOK, executable: true }),
    });

    expect(
      plan.trace.find((span) => span.name === 'plan.layout')?.detail,
    ).toEqual({ entries: 1, placedOnce: 0, executable: 1 });
  });
});
