/**
 * СЛОВАРЬ ЗОНЫ — проба, а не памятка.
 *
 * Здесь она заведена не по отменённой паре слов, а по **пустому месту**: у пакета
 * формы не было `description` вовсе (`tasker:BASER2-102`). Описание пакета —
 * первое и единственное, что посторонний видит ДО установки, а следом за этим
 * заходом обвес едет к первому чужому потребителю.
 *
 * Почему это не поймала вычитка: пустое поле словарь не нарушает, с кодом не
 * расходится и доке не противоречит — **оно просто не работает**. Нашлось пробой
 * у двери (`tasker:BASER2-100`), которая требует НАЛИЧИЯ, а не правильности; эта
 * проба требует и того, и другого.
 *
 * ── ЧТО СУДИТСЯ ─────────────────────────────────────────────────────────────
 *
 * Описание пакета для npm, заголовок README и каждый модуль, попадающий в `dist`
 * (`*.spec.ts` и `*.fixture.ts` исключены той же строкой, что и в
 * `tsconfig.lib.json`, — они не уезжают). Граница взята по тому, что уезжает
 * ПОЛУЧАТЕЛЮ, и взята такой же, как у двери, проверки и выдачи
 * (`vocabulary.spec.ts` у каждой): одна граница на четыре зоны, а не четыре
 * разных. Человек видит эти описания подряд, списком в реестре.
 *
 * README судится по заголовку: тело намеренно говорит «инструмент в патроне» и
 * «патрон не знает про фрезу» — это канон (`kb:BASER2-4`), а не отменённая пара.
 * Отменено «**деталь** подходит **патрону**»: деталь — то, что станок ПРОИЗВОДИТ,
 * то есть сам продукт, а обвес подходит ПОСАДОЧНОМУ МЕСТУ, из которых патрон лишь
 * одно (`kb:BASER2-9`, поправлен 2026-07-29).
 *
 * В уезжающих модулях корень запрещён целиком — как у соседей. Ищется по корню
 * потому, что склонения иначе протекают, а цена ровно та, что видно в этом же
 * коммите: два места говорили «деталь» в обычном смысле, и у обоих нашлось слово
 * точнее («новый файл в шаблоне», «а не подробность примера»). Объяснение самого
 * отменённого словаря живёт в README, а не в уезжающем модуле.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Отменённая пара слов. Ищется по корню — «детали» и «патрона» тоже. */
const CANCELLED = /детал|патрон/i;

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
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf-8'),
    ) as { description?: string };

    // Наличие — отдельным утверждением и первым: отсутствие поля не ловится ни
    // словарём, ни сверкой с кодом, потому что оно ничего не обещает.
    expect(manifest.description).toBeDefined();
    expect(manifest.description).not.toBe('');
  });

  it('описание пакета для npm говорит канонично', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf-8'),
    ) as { description?: string };

    // Зона называет себя своим словом канона и говорит, чья это форма: получатель
    // читает описания зон подряд и по ним выбирает, какое ему нужно.
    expect(manifest.description).toContain('Хвостовик');
    expect(manifest.description).toContain('обвес объявляет себя станку');
    expect(manifest.description).not.toMatch(CANCELLED);
  });

  it('заголовок README говорит канонично', () => {
    const [title] = readFileSync(join(ROOT, 'README.md'), 'utf-8').split('\n');

    expect(title).toContain('хвостовик');
    expect(title).not.toMatch(CANCELLED);
  });

  it('отменённого словаря нет ни в одном уезжающем модуле', () => {
    const modules = shippedModules(join(ROOT, 'src'));

    // Пустой список прошёл бы эту пробу молча — «сверено ноль» и «сверено всё»
    // читаются одинаково, и это в зоне уже названо отдельным правилом.
    expect(modules.length).toBeGreaterThanOrEqual(10);
    for (const path of modules) {
      expect([path, readFileSync(path, 'utf-8').match(CANCELLED)]).toEqual([
        path,
        null,
      ]);
    }
  });
});
