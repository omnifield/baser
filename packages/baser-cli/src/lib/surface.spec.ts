/**
 * ПУБЛИЧНАЯ ПОВЕРХНОСТЬ — утверждение, а не внимательность.
 *
 * Раздел README «Публичная поверхность» обещает полноту самим заголовком, а
 * называл 35 имён из 61 (`tasker:BASER2-100`). Двадцать шесть неназванных
 * читаются как «внутреннее, трогать нельзя» — и человек либо изобретает обход,
 * либо лезет в `src/lib` глубоким путём. Второе уже стоило чужой зоне красноты
 * (`tasker:BASER2-59`): приёмка соседа держалась за `soleRun` глубоким путём в
 * наши тестовые файлы, и сигнала об этой зависимости у нас не было.
 *
 * Вычиткой это не держится: таблица разъезжается на первом же новом экспорте, и
 * ровно так она и разъехалась. Поэтому здесь проба — та же мысль, которой
 * проверка и выдача закрыли свой словарь (`vocabulary.spec.ts`).
 *
 * ── ЧТО СУДИТСЯ ─────────────────────────────────────────────────────────────
 *
 * 1. **Таблица равна индексу** в обе стороны: неназванного экспорта нет, и
 *    названного-но-несуществующего тоже (второе врёт не меньше первого —
 *    читатель ищет в коде то, чего там нет).
 * 2. **Публичная форма не опирается на внутренние типы.** Экспортированный
 *    интерфейс, чьё поле имеет тип из непубличного модуля, — это тот же глубокий
 *    импорт другими словами: назвать этот тип потребитель может только путём в
 *    наш `src/lib`. Ловится ровно на живом случае: `SettingMovement.placed`
 *    ссылался на `PlacedValue` из `previous.ts`, которого в индексе не было.
 *
 * Чего проба НЕ судит: состав поверхности («это должно быть публичным, а то
 * нет»). Решение о составе — зоны, и проба его не подменяет; она держит
 * согласованность между решением, кодом и докой.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = join(ROOT, 'src/index.ts');

/**
 * Нижняя граница объёма.
 *
 * «Сверено ноль» и «сверено всё» читаются одинаково — правило зоны, названное
 * ещё в `check`. Съехавший разбор индекса дал бы пустые множества и зелёную
 * пробу: сверка ничего с ничем проходит всегда.
 */
const AT_LEAST = 50;

/** Имена, уходящие из `src/index.ts`, и модуль, из которого каждое. */
function exported(): Map<string, string> {
  const source = withoutComments(readFileSync(INDEX, 'utf-8'));
  const names = new Map<string, string>();

  for (const block of source.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g,
  )) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      if (name !== '') {
        names.set(name, block[2]);
      }
    }
  }
  return names;
}

/**
 * Имена, названные таблицей README.
 *
 * Берётся ПЕРВАЯ колонка: во второй живут `baser.json` и `contentRoot` — они
 * тоже в обратных кавычках, но экспортами не являются, и сгребать их значило бы
 * заставить таблицу врать про саму себя.
 */
function documented(): Set<string> {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const section = readme
    .split('\n## Публичная поверхность\n')[1]
    ?.split('\n## ')[0];
  if (section === undefined) {
    throw new Error('в README нет раздела «Публичная поверхность»');
  }

  const names = new Set<string>();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) {
      continue;
    }
    const [, first = ''] = line.split('|');
    for (const found of first.matchAll(/`([^`]+)`/g)) {
      names.add(found[1]);
    }
  }
  return names;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('объявленная поверхность равна фактической', () => {
  it('таблица README называет КАЖДЫЙ экспорт индекса', () => {
    const named = documented();
    const missing = [...exported().keys()].filter((name) => !named.has(name));

    expect(exported().size).toBeGreaterThanOrEqual(AT_LEAST);
    // Список, а не счётчик: красная проба обязана называть, что дописать.
    expect(missing).toEqual([]);
  });

  it('таблица НЕ называет того, чего в индексе нет', () => {
    // Обратная сторона того же обещания. Имя, оставшееся в таблице после
    // переименования, отправляет читателя искать в коде то, чего там нет, — и
    // это не мягче, чем умолчать о существующем.
    const real = exported();
    const invented = [...documented()].filter((name) => !real.has(name));

    expect(invented).toEqual([]);
  });

  it('раздел ОБЕЩАЕТ полноту прямым текстом', () => {
    // Обещание держит не только проба, но и человек, читающий доку: если
    // утверждение о полноте однажды уедет, читатель вернётся к догадкам, даже
    // когда таблица останется полной.
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');

    expect(readme).toContain('Таблица полная');
  });
});

describe('публичная форма не опирается на внутренние типы', () => {
  it('экспортированный тип не ссылается на тип из непубличного модуля', () => {
    // Живой случай: `SettingMovement.placed` имел тип `PlacedValue` из
    // `previous.ts`, которого в индексе не было. Форма ответа публичная, а
    // назвать тип её поля потребитель мог только глубоким путём в наш `src/lib`
    // — то есть ровно тем движением, которое эта зона закрывает.
    const surface = exported();
    const modules = new Set(surface.values());
    const leaks: string[] = [];

    for (const module of modules) {
      const path = join(
        ROOT,
        'src',
        module.replace(/^\.\//, '').replace(/\.js$/, '.ts'),
      );
      const source = withoutComments(readFileSync(path, 'utf-8'));

      for (const imported of source.matchAll(
        /import\s+type\s+\{([^}]*)\}\s+from\s+'(\.\/[^']+)'/g,
      )) {
        if (modules.has(imported[2])) {
          continue;
        }
        for (const raw of imported[1].split(',')) {
          const name = raw.trim().replace(/^type\s+/, '');
          if (
            name !== '' &&
            !surface.has(name) &&
            usedInExported(source, name)
          ) {
            leaks.push(`${module} → ${name} (${imported[2]})`);
          }
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

/**
 * Тип назван внутри ЭКСПОРТИРУЕМОГО объявления этого модуля.
 *
 * Разбор нарочно грубый: тело объявления берётся до закрывающей скобки того же
 * уровня отступа. Ошибиться он может только в сторону лишней красноты, а
 * лечится лишняя краснота публикацией типа — то есть тем же, чем лечится
 * настоящая утечка. Полный разбор типов ради этого утверждения был бы второй
 * правдой о нашем же коде.
 */
function usedInExported(source: string, name: string): boolean {
  for (const declaration of source.matchAll(
    /export\s+(?:interface|type)\s+\w+[^{]*\{[\s\S]*?\n\}/g,
  )) {
    if (new RegExp(`\\b${name}\\b`).test(declaration[0])) {
      return true;
    }
  }
  return false;
}
