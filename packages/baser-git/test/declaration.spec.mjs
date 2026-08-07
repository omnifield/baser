/**
 * ОБВЕС ОБЪЯВЛЯЕТ РОВНО ТО, ЧТО РЕАЛЬНО ЛЕЖИТ В ПАКЕТЕ.
 *
 * Пока обвес живёт каталогом в монорепе, «объявил» и «лежит» — один и тот же
 * факт. Как только он стал ПАКЕТОМ, между ними встал `files`, и разойтись они
 * получили право молча: `contentRoot` или `src`, не уехавший в тарбол, ломает
 * ПОТРЕБИТЕЛЯ отказом `missing-source`, а у нас зеленеет всё.
 *
 * Поэтому здесь всё меряется по РАСПАКОВАННОМУ ТАРБОЛУ, а разбор берётся
 * настоящий — тот же, которым форму читает дверь. Свой разбор объявления был бы
 * второй правдой о форме.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  checkTemplate,
  describeProblems,
  FORM_VERSION,
  MIN_FORM_VERSION,
  readSourceDeclaration,
} from '../../baser-contracts/src/index.ts';
import {
  GIT_PACKAGE,
  HOOK,
  packedFiles,
  packedManifest,
  packedRoot,
  RULE,
  WORKFLOW,
} from './packed.mjs';
import { readFileSync } from 'node:fs';

/** Объявление, прочитанное из ОПУБЛИКОВАННОГО манифеста настоящим разбором. */
function declaration() {
  const parsed = readSourceDeclaration(
    packedManifest(),
    `${GIT_PACKAGE}/package.json`,
  );
  if (!parsed.ok) {
    throw new Error(
      `объявление обвеса непригодно:\n${describeProblems(parsed.problems)}`,
    );
  }
  return parsed.value;
}

describe('объявление пригодно по форме', () => {
  it('разбирается настоящим разбором контрактов и называет себя', () => {
    const decl = declaration();

    expect(decl.formVersion).toBeGreaterThanOrEqual(MIN_FORM_VERSION);
    expect(decl.formVersion).toBeLessThanOrEqual(FORM_VERSION);
    // Личность обвеса — не косметика: из неё считается имя файла настроек у
    // потребителя (`omnifield/git` → `.omnifield/omnifield-git.yaml`). Сменив
    // её, выпуск обвеса потерял бы заполненные человеком настройки молча.
    expect(decl.source.id).toBe('omnifield/git');
  });

  it('кладёт ровно три артефакта, и все — в обвязку репозитория', () => {
    const decl = declaration();

    expect(decl.layout.map((entry) => entry.dest).sort()).toEqual(
      [RULE, WORKFLOW, HOOK].sort(),
    );
    // Все артефакты наши целиком: их содержимое — правило гейта, и переживать
    // выпуск обвеса правке руками здесь нечего.
    for (const entry of decl.layout) {
      expect(entry.class, entry.dest).toBe('regenerated');
      expect(entry.render, entry.dest).toBe(true);
    }
  });

  it('хук объявлен ИСПОЛНЯЕМЫМ, а остальные артефакты — нет', () => {
    const decl = declaration();

    // Объявление намерения и есть всё, чем обвес располагает: как бит ляжет на
    // диск — обязательство порта, который пишет (`kb:BASER3-36`). Соврать здесь
    // в другую сторону тоже нельзя: правило и поток — данные, а не программы, и
    // лишний бит на них был бы правом, которого никто не просил.
    const byDest = Object.fromEntries(
      decl.layout.map((entry) => [entry.dest, entry.executable]),
    );
    expect(byDest[HOOK]).toBe(true);
    expect(byDest[RULE]).toBe(false);
    expect(byDest[WORKFLOW]).toBe(false);
  });

  it('каждый объявленный источник ЛЕЖИТ в тарболе', () => {
    const decl = declaration();

    for (const entry of decl.layout) {
      const file = join(packedRoot(), decl.source.contentRoot, entry.src);
      expect(existsSync(file), `${entry.src} не уехал в тарбол`).toBe(true);
    }
  });

  it('шаблоны на языке формы — проверены тем же разбором, что у двери', () => {
    const decl = declaration();

    for (const entry of decl.layout) {
      const text = readFileSync(
        join(packedRoot(), decl.source.contentRoot, entry.src),
        'utf-8',
      );
      const problems = checkTemplate(text, entry.src);
      expect(problems.length, describeProblems(problems)).toBe(0);
    }
  });
});

/**
 * ОБВЕС ОПИСЫВАЕТ СЕБЯ САМ — и это единственное, из чего пульт рисует его форму
 * настройки (`kb:BASER3-34`). Настройка без имени и объяснения показать себя не
 * может: интерфейсу пришлось бы знать про НАШ обвес отдельно, а он не знает.
 */
describe('настройки описаны так, чтобы их можно было показать, не зная обвеса', () => {
  it('у каждой есть имя, объяснение и тип', () => {
    const { settings } = declaration();

    expect(Object.keys(settings).length).toBeGreaterThan(0);
    for (const [name, spec] of Object.entries(settings)) {
      expect(spec.title, `${name}: нет имени`).toBeTruthy();
      expect(spec.description, `${name}: нет объяснения`).toBeTruthy();
      expect(spec.type, `${name}: нет типа`).toBeTruthy();
      // Объяснение обязано говорить, ЧТО БУДЕТ при значении, а не пересказывать
      // имя настройки: короткая строка это пересказ и есть.
      expect(String(spec.description).length, `${name}: объяснение короче`)
        .toBeGreaterThan(80);
    }
  });

  it('всё, что объявлено, ДОХОДИТ до шаблонов — иначе это мёртвая настройка', () => {
    const decl = declaration();
    const templates = decl.layout
      .map((entry) =>
        readFileSync(
          join(packedRoot(), decl.source.contentRoot, entry.src),
          'utf-8',
        ),
      )
      .join('\n');

    for (const name of Object.keys(decl.settings)) {
      expect(templates.includes(name), `${name} не встречается ни в одном шаблоне`).toBe(
        true,
      );
    }
  });
});

describe('в тарбол уехало содержимое, а не наш способ его проверять', () => {
  it('манифест и шаблоны — есть; пробы и README — нет', () => {
    const files = packedFiles();

    expect(files).toContain('package.json');
    expect(files.some((path) => path.startsWith('template/'))).toBe(true);
    expect(files.filter((path) => path.startsWith('test/'))).toEqual([]);
    expect(files).not.toContain('vitest.config.mts');
  });
});
