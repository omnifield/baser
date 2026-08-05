/**
 * ПОРТ ДЕРЕВА СУДИТСЯ С ДВУХ СТОРОН — что поставка не тянет и что порт подходит.
 *
 * Заведена по факту, увиденному установкой из реестра, а не сборкой в дереве
 * (`tasker:BASER2-181`): движок объявлял `@nx/devkit` в `peerDependencies`, и
 * потребитель двери получал `nx` — 135 пакетов, 45 МБ и платформенные нативные
 * модули. В самом коде обращений в рантайме не было ни одного: тип уезжал в
 * `.d.ts`, а требование иметь пакет — в манифест поставки.
 *
 * Сборка в дереве монорепы этого поймать не могла и не сможет: `@nx/devkit`
 * здесь есть у всех и всегда. Поэтому проба судит не «собирается ли», а ДВА
 * утверждения о поставке и её форме:
 *
 * 1. **Поставка не требует `@nx/devkit` ни в каком виде** — ни зависимостью, ни
 *    peer (пакетные менеджеры ставят peer сами), ни упоминанием в уезжающем
 *    модуле. Возврат прежней формы записи в манифесте — правка одной строки, и
 *    без пробы она снова уехала бы молча.
 * 2. **Порт остаётся тем же деревом, что и у Nx.** Свой тип на шести методах
 *    ценен ровно до тех пор, пока настоящее дерево devkit ему подходит:
 *    разъехавшаяся сигнатура иначе всплыла бы у потребителя, который подаёт
 *    движку `FsTree`, а не здесь. `@nx/devkit` для этого остаётся в
 *    `devDependencies` — проба им пользуется, поставка его не видит.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it } from 'vitest';
import { applyPlan } from './apply.js';
import { computePlan } from './plan.js';
import type { Tree } from './tree.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Пакет, которого в поставке движка быть не должно. */
const FORBIDDEN = '@nx/devkit';

/**
 * Обращение к пакету из модуля — импорт, а не упоминание.
 *
 * Судится форма `from '@nx/devkit…'` и `import('@nx/devkit…')`, потому что
 * потребителю достаётся ровно она: `import type` из уезжающего модуля уедет в
 * `.d.ts` и потребует пакета, а имя в комментарии — не потребует ничего. Запрет
 * на упоминание запретил бы этой зоне объяснять, откуда взялся её собственный
 * порт, — а объяснение и есть то, что удерживает решение (`tree.ts`).
 */
const IMPORTS_FORBIDDEN = /(?:from|import\()\s*'@nx\/devkit/;

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

function manifest(): PackageManifest {
  return JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf-8'),
  ) as PackageManifest;
}

/** Модули, уезжающие в `dist`: те же исключения, что в `tsconfig.lib.json`. */
function shippedModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return shippedModules(path);
    }
    if (!entry.name.endsWith('.ts')) {
      return [];
    }
    return entry.name.endsWith('.spec.ts') || entry.name.endsWith('.fixture.ts')
      ? []
      : [path];
  });
}

describe('поставка движка не тянет потребителю nx', () => {
  it('манифест не требует @nx/devkit НИ В КАКОМ РАЗДЕЛЕ установки', () => {
    // Разделы перечислены поимённо, а не «нет в dependencies»: цена дефекта
    // была ровно в том, что запись стояла в `peerDependencies`, и оттуда npm
    // ставит её сам. `optionalDependencies` названа по той же причине — она
    // тоже ставится, просто прощает провал.
    const { dependencies, peerDependencies, optionalDependencies } = manifest();

    expect(Object.keys(dependencies ?? {})).not.toContain(FORBIDDEN);
    expect(Object.keys(peerDependencies ?? {})).not.toContain(FORBIDDEN);
    expect(Object.keys(optionalDependencies ?? {})).not.toContain(FORBIDDEN);
  });

  it('ни один уезжающий модуль не импортирует @nx/devkit', () => {
    // Манифеста мало: тип, притянутый `import type` в уезжающем модуле, уедет в
    // `.d.ts` и станет требованием к потребителю-разработчику — без единой
    // строки в манифесте и без единого байта в рантайме.
    const modules = shippedModules(join(ROOT, 'src'));

    // Пустой список прошёл бы пробу молча: «сверено ноль» и «сверено всё»
    // читаются одинаково.
    expect(modules.length).toBeGreaterThanOrEqual(11);
    for (const path of modules) {
      expect([
        path,
        readFileSync(path, 'utf-8').match(IMPORTS_FORBIDDEN),
      ]).toEqual([path, null]);
    }
  });

  it('@nx/devkit остаётся ТОЛЬКО инструментом проб', () => {
    // Не украшение: без него следующая проба судила бы порт по самому себе.
    expect(Object.keys(manifest().devDependencies ?? {})).toContain(FORBIDDEN);
  });
});

describe('порт дерева — то же дерево, что у devkit', () => {
  it('настоящее дерево Nx подходит порту и движок на нём работает', () => {
    // Присваивание к типу порта — половина утверждения (её судит `typecheck`);
    // вторая половина — прогон движка через эту переменную: подходящий по типам
    // порт, на котором ничего не раскладывается, доказывал бы только форму.
    const tree: Tree = createTreeWithEmptyWorkspace();
    tree.write('canon/tsconfig.json', '{ "compilerOptions": {} }\n');

    const plan = computePlan({
      tree,
      declaration: {
        source: {
          id: 'omnifield/canon-kit',
          contentRoot: 'canon',
          version: '1.0.0',
        },
        layout: [{ src: 'tsconfig.json', dest: 'tsconfig.json' }],
      },
    });
    applyPlan(tree, plan);

    expect(tree.read('tsconfig.json', 'utf-8')).toBe(
      '{ "compilerOptions": {} }\n',
    );
    expect(tree.exists('baser.lock.json')).toBe(true);
  });
});
