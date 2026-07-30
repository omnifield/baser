/**
 * СЛОВАРЬ ЗОНЫ — проба, а не памятка.
 *
 * Отменённая пара слов («деталь подходит патрону») уехала отсюда наружу, и
 * уехала ШИРЕ, чем у соседней проверки: кроме `description` пакета здесь есть
 * доккомментарии публичных типов описи (`PayloadManifest`, `PayloadArtifact`),
 * а они попадают в `.d.ts` — то есть их читает не наш овнер, а посторонний
 * получатель нагрузки. Вычистить это руками можно ровно до следующей правки
 * руками, поэтому граница названа пробой.
 *
 * Судится всё, что уезжает получателю: описание пакета, заголовок README и
 * модули, попадающие в `dist` (`*.spec.ts` и `*.fixture.ts` исключены той же
 * строкой, что и в `tsconfig.lib.json`, — они не уезжают).
 *
 * Пояснение про сам отменённый словарь живёт в README и эти слова называет
 * НАМЕРЕННО: оно объясняет замену. Поэтому README судится по заголовку, а не
 * целиком — иначе проба запрещала бы объяснять собственную причину.
 *
 * Словарь канона (`kb:BASER2-4`, `kb:BASER2-9` поправлен 2026-07-29): деталь —
 * то, что станок ПРОИЗВОДИТ, то есть сам продукт; обвес подходит ПОСАДОЧНОМУ
 * МЕСТУ, из которых патрон лишь одно. Ту же пару слов сняли у себя дверь
 * (`packages/baser-cli`) и проверка (`packages/baser-check`), и человек видит
 * эти тексты подряд.
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
  it('описание пакета для npm говорит канонично', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf-8'),
    ) as { description?: string };

    expect(manifest.description).toContain('обвес подходит посадочному месту');
    expect(manifest.description).not.toMatch(CANCELLED);
  });

  it('заголовок README говорит канонично', () => {
    const [title] = readFileSync(join(ROOT, 'README.md'), 'utf-8').split('\n');

    expect(title).toContain('проверенный обвес');
    expect(title).not.toMatch(CANCELLED);
  });

  it('отменённого словаря нет ни в одном уезжающем модуле', () => {
    const modules = shippedModules(join(ROOT, 'src'));

    // Пустой список прошёл бы эту пробу молча — «сверено ноль» и «сверено всё»
    // читаются одинаково, и это в зоне уже названо отдельным правилом.
    expect(modules.length).toBeGreaterThanOrEqual(6);
    for (const path of modules) {
      expect([path, readFileSync(path, 'utf-8').match(CANCELLED)]).toEqual([
        path,
        null,
      ]);
    }
  });

  /**
   * Опись уезжает ДВАЖДЫ: типом в `.d.ts` и файлом рядом с нагрузкой.
   *
   * Первое покрыто пробой выше вместе с остальными модулями. Второе — нет:
   * доккомментарии публичных типов описи это отдельный текст, который читает
   * посторонний, и назван он здесь поимённо, чтобы переезд типа в другой модуль
   * не унёс проверку молча.
   */
  it('публичные типы описи говорят канонично — их читает получатель', () => {
    const manifest = readFileSync(join(ROOT, 'src/lib/manifest.ts'), 'utf-8');

    expect(manifest).toMatch(/export interface PayloadManifest\b/);
    expect(manifest).toMatch(/export interface PayloadArtifact\b/);
    expect(manifest).not.toMatch(CANCELLED);
  });
});
