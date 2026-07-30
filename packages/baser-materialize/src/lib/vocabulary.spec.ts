/**
 * СЛОВАРЬ ЗОНЫ — проба, а не памятка.
 *
 * Заведена по ПУСТОМУ МЕСТУ: у пакета движка не было `description` вовсе
 * (`tasker:BASER2-102`). Описание пакета — первое и единственное, что посторонний
 * видит ДО установки, а следом за этой веткой обвес едет к первому чужому
 * потребителю.
 *
 * Почему это не поймала вычитка: пустое поле словарь не нарушает, с кодом не
 * расходится и доке не противоречит — **оно просто не работает**. Нашлось пробой
 * у двери (`tasker:BASER2-100`), которая требует НАЛИЧИЯ, а не правильности; эта
 * требует и того, и другого.
 *
 * ── ЧТО СУДИТСЯ ─────────────────────────────────────────────────────────────
 *
 * Описание пакета для npm, заголовок README и каждый модуль, попадающий в `dist`
 * (`*.spec.ts` и `*.fixture.ts` исключены той же строкой, что и в
 * `tsconfig.lib.json`, — они не уезжают). Граница взята по тому, что уезжает
 * ПОЛУЧАТЕЛЮ, и взята такой же, как у двери, проверки, выдачи и формы: одна
 * граница на пять зон, а не пять разных. Человек видит эти описания подряд,
 * списком в реестре, — поэтому разнобой в словаре виден сразу, а формулировка
 * согласована с соседями по форме «роль зоны: что внутри».
 *
 * Роль этой зоны словарём канона (`kb:BASER2-4`) — **движок**: рама и мотор
 * станка, который «разложил и держит объявленное состояние». Деталь — то, что
 * станок ПРОИЗВОДИТ, то есть сам продукт; обвес подходит ПОСАДОЧНОМУ МЕСТУ, из
 * которых патрон лишь одно (`kb:BASER2-9`, поправлен 2026-07-29). Эта пара слов
 * отменена, и в уезжающих модулях корень запрещён целиком — как у соседей.
 *
 * Ищется по корню потому, что склонения иначе протекают, а цена ровно та, что
 * видно в этом же коммите: `trace.ts` говорил «произвольные детали» в обычном
 * смысле, и у зоны нашлось своё слово точнее — «атрибуты», которым README §Трейсы
 * называет их с самого начала. README судится по ЗАГОЛОВКУ: тело говорит «не
 * деталь реализации» в обычном смысле, и запрещать зоне объяснять свои решения
 * проба не должна.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Отменённая пара слов. Ищется по корню — «детали» и «патрона» тоже. */
const CANCELLED = /детал|патрон/i;

function manifest(): { description?: string } {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
    description?: string;
  };
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

describe('словарь зоны', () => {
  it('ОПИСАНИЕ ПАКЕТА ЕСТЬ — иначе чужого встречает пустое место', () => {
    // Наличие — отдельным утверждением и первым: отсутствие поля не ловится ни
    // словарём, ни сверкой с кодом, потому что оно ничего не обещает. Пустая
    // строка проверяется рядом — она проходит `toBeDefined` и не работает так же.
    const { description } = manifest();

    expect(description).toBeDefined();
    expect(description).not.toBe('');
  });

  it('описание пакета для npm говорит канонично', () => {
    const { description } = manifest();

    // Зона называет себя своим словом канона и говорит, что внутри: получатель
    // читает описания зон подряд и по ним выбирает, какое ему нужно.
    expect(description).toContain('Движок');
    expect(description).toContain('владение паспортом укладки');
    expect(description).not.toMatch(CANCELLED);
  });

  it('заголовок README говорит канонично', () => {
    const [title] = readFileSync(join(ROOT, 'README.md'), 'utf-8').split('\n');

    expect(title).toContain('движок');
    expect(title).not.toMatch(CANCELLED);
  });

  it('отменённого словаря нет ни в одном уезжающем модуле', () => {
    const modules = shippedModules(join(ROOT, 'src'));

    // Пустой список прошёл бы эту пробу молча — «сверено ноль» и «сверено всё»
    // читаются одинаково, и это в зоне уже названо отдельным правилом.
    expect(modules.length).toBeGreaterThanOrEqual(11);
    for (const path of modules) {
      expect([path, readFileSync(path, 'utf-8').match(CANCELLED)]).toEqual([
        path,
        null,
      ]);
    }
  });
});
