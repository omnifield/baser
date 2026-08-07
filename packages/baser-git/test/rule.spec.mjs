/**
 * ПРАВИЛО ЗАГОЛОВКА — судится ТО, ЧТО ПРИЕХАЛО ПОТРЕБИТЕЛЮ.
 *
 * Пробы грузят положенный дверью `.github/scripts/pr-title.mjs` как модуль, а не
 * шаблон и не копию в пакете. Между шаблоном и артефактом стоит подстановка
 * значений, и ровно она — то, что настройка обещает: правило, проверенное до
 * подстановки, обещание настройки не подтверждает ничем.
 *
 * До `tasker:BASER2-208` эти пробы жили в `.github/scripts/pr-title.spec.mjs` и
 * судили файл репозитория. Файл переехал в поставку — переехали и они, потому
 * что проба обязана стоять там, где живёт правило, а не там, где оно однажды
 * лежало.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installConsumer, run } from './packed.mjs';

/**
 * Обвес, применённый на названных настройках, и его правило модулем.
 *
 * Локация заводится на каждый набор настроек своя: дверь кладёт артефакт целиком
 * и переиспользовать чужую локацию значило бы судить чужие значения.
 */
async function ruleWith(settings) {
  const box = installConsumer(
    settings === undefined ? {} : { tuning: { settings } },
  );
  await run({ command: 'apply', cwd: box.root });
  const rule = await box.rule();
  return { box, rule };
}

let opened = [];

afterEach(() => {
  for (const box of opened) box.cleanup();
  opened = [];
});

/** Заводит локацию и запоминает её для уборки. */
async function landed(settings) {
  const { box, rule } = await ruleWith(settings);
  opened.push(box);
  return rule;
}

describe('ДЕФОЛТЫ: заголовок по форме — гейт молчит', () => {
  let judge;
  let TYPES;
  let held;

  beforeAll(async () => {
    // Дефолтная кладка одна на весь блок: значения в нём не меняются, а `apply`
    // с распаковкой тарбола — самая дорогая часть пробы. Убирается она своим
    // `afterAll`, а не общим `afterEach`: тот снял бы её после первой же пробы.
    const { box, rule } = await ruleWith(undefined);
    held = box;
    ({ judge, TYPES } = rule);
  });

  afterAll(() => held?.cleanup());

  const good = (title) => judge(title).ok;
  const bad = (title) => {
    const { ok, problem } = judge(title);
    expect(ok, `ожидался красный на «${title}»`).toBe(false);
    return problem;
  };

  it('тип, зона, суть', () => {
    expect(good('feat(cli): дверь достаёт поставку по метке канала')).toBe(true);
  });

  it('ломающее с восклицательным знаком', () => {
    expect(good('feat(devbox)!: имя пресета снято')).toBe(true);
  });

  it('зона из нескольких слов через дефис', () => {
    expect(good('fix(release-guard): база сравнения — тег выпуска')).toBe(true);
  });

  it('зона с цифрой', () => {
    expect(good('docs(form5): ревизия перечня')).toBe(true);
  });

  it('каждый признанный тип годен', () => {
    for (const type of TYPES) {
      expect(good(`${type}(cli): что сделано`), type).toBe(true);
    }
  });

  it('пробелы по краям не дефект — их срезает, а не краснеет', () => {
    expect(good('  feat(cli): что сделано  ')).toBe(true);
  });

  it('заголовки, уже уехавшие в главную по форме, остаются годными', () => {
    expect(good('fix(materialize): дерево движка — свой порт (BASER2-181)')).toBe(
      true,
    );
    expect(
      good('chore(repo): цепочка уезжает целиком — форма 5 (BASER2-175)'),
    ).toBe(true);
    expect(
      good('feat(contracts): перечень называет КАНАЛ — ревизия формы 4 → 5'),
    ).toBe(true);
  });

  describe('заголовок не по форме — гейт краснеет и называет причину', () => {
    /**
     * СЛУЧАЙ, РАДИ КОТОРОГО ГЕЙТ ЗАВЕДЁН. Ровно этот заголовок уехал в главную
     * коммитом `1ce8385` при влитии PR #81: гейт покраснел, влитие не остановил
     * (`tasker:BASER2-184`). Правило судило верно — проба держит, что и будет.
     */
    it('заголовок БЕЗ типа — тот, что уехал в 1ce8385', () => {
      expect(
        bad(
          'Пробы судят факт, а репозиторий садится на свой выпуск (BASER2-182, -183)',
        ),
      ).toMatch(/форма не разобрана/);
    });

    it('имя ветки вместо заголовка — тот, что уезжал 2026-07-29', () => {
      expect(bad('Feat/form v2')).toMatch(/форма не разобрана/);
    });

    it('тип есть, зоны нет — по заголовку не видно, чьё изменение', () => {
      expect(bad('feat: новая форма перечня')).toMatch(/зона не названа/);
    });

    it('тип не из списка — считалка версий пропустит его мимо выпуска', () => {
      expect(bad('feature(cli): дверь')).toMatch(/тип «feature» не из списка/);
    });

    it('тип с большой буквы — не тот же тип', () => {
      expect(bad('Feat(cli): дверь')).toMatch(/тип «Feat» не из списка/);
    });

    it('зона пустая — скобки есть, зоны нет', () => {
      expect(bad('feat(): дверь')).toMatch(/зона .* не по форме/);
    });

    it('зона не по форме — прописные и пробелы', () => {
      expect(bad('feat(CLI Door): дверь')).toMatch(/зона «CLI Door» не по форме/);
    });

    it('нет пробела после двоеточия', () => {
      expect(bad('feat(cli):дверь')).toMatch(/форма не разобрана/);
    });

    it('нет сути — одна форма без содержания', () => {
      expect(bad('feat(cli): ')).toMatch(/форма не разобрана/);
    });

    it('пустой заголовок', () => {
      expect(bad('')).toMatch(/заголовок пуст/);
      expect(bad('   ')).toMatch(/заголовок пуст/);
    });

    it('заголовка нет вовсе — гейт не падает, а судит', () => {
      expect(bad(undefined)).toMatch(/заголовок пуст/);
      expect(bad(null)).toMatch(/заголовок пуст/);
    });
  });

  /**
   * ПОДСКАЗКА НЕ РАСХОДИТСЯ С ПРАВИЛОМ. Человек правит заголовок ПО ОБРАЗЦУ из
   * подсказки; образец, который сам не проходит гейт, отправляет его на второй
   * красный — и виноватым выглядит гейт, а не образец.
   */
  describe('подсказка и правило — одно и то же', () => {
    const examples = (rule) =>
      rule
        .hint()
        .map((line) => line.trim())
        .filter((line) => /^[a-z]+\([a-z0-9-]+\)!?: /.test(line));

    it('образцы в подсказке есть — иначе проба ниже проверяет пустоту', async () => {
      const rule = await landed(undefined);
      expect(examples(rule).length).toBeGreaterThanOrEqual(2);
    });

    it('каждый образец из подсказки проходит гейт', async () => {
      const rule = await landed(undefined);
      for (const example of examples(rule)) {
        expect(rule.judge(example).ok, example).toBe(true);
      }
    });

    it('подсказка перечисляет ровно признанные типы', async () => {
      const rule = await landed(undefined);
      const listed = rule.hint().find((line) => line.startsWith('Типы: '));
      expect(listed).toBe(`Типы: ${rule.TYPES.join(' · ')}`);
    });
  });
});

/**
 * НАСТРОЙКИ МЕНЯЮТ ПРАВИЛО, А НЕ ТОЛЬКО ТЕКСТ.
 *
 * Настройка, которая доехала до комментария, но не до суждения, — половина
 * настройки, и заметно это становится у потребителя. Поэтому каждая проверяется
 * ЗАГОЛОВКОМ, чей вердикт от неё зависит.
 */
describe('НАСТРОЙКИ: правило приезжает таким, каким его заказали', () => {
  it('свой набор типов ЗАМЕНЯЕТ дефолт целиком', async () => {
    const rule = await landed({ titleTypes: ['feat', 'fix'] });

    expect(rule.TYPES).toEqual(['feat', 'fix']);
    expect(rule.judge('feat(core): что сделано').ok).toBe(true);
    // Тип из дефолтного набора, которого в заказанном нет, — теперь красный.
    expect(rule.judge('chore(core): что сделано').problem).toMatch(
      /тип «chore» не из списка \(feat · fix\)/,
    );
  });

  it('зона необязательна — заголовок без скобок годен', async () => {
    const rule = await landed({ titleScopeRequired: false });

    expect(rule.judge('feat: новая форма перечня').ok).toBe(true);
    // Названная зона по-прежнему судится по форме: необязательная ≠ любая.
    expect(rule.judge('feat(CLI Door): дверь').problem).toMatch(/не по форме/);
  });

  it('закрытый перечень зон — чужая зона красная, и перечень назван', async () => {
    const rule = await landed({ titleScopes: ['cli', 'engine'] });

    expect(rule.SCOPES).toEqual(['cli', 'engine']);
    expect(rule.judge('feat(cli): что сделано').ok).toBe(true);
    expect(rule.judge('feat(store): что сделано').problem).toMatch(
      /зоны «store» нет среди зон локации \(cli · engine\)/,
    );
    // Перечень зон человеку показан — иначе он угадывает, что писать.
    expect(rule.hint()).toContain('Зоны: cli · engine');
  });

  it('на закрытом перечне образцы подсказки взяты ИЗ НЕГО и проходят гейт', async () => {
    const rule = await landed({ titleScopes: ['cli', 'engine'] });

    const examples = rule
      .hint()
      .map((line) => line.trim())
      .filter((line) => /^[a-z]+\([a-z0-9-]+\)!?: /.test(line));

    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) {
      expect(rule.judge(example).ok, example).toBe(true);
      expect(example).toMatch(/\((cli|engine)\)/);
    }
  });

  it('перечень открыт — гейт зон не выдумывает', async () => {
    const rule = await landed(undefined);

    expect(rule.SCOPES).toBe(null);
    // Любая зона по форме годна: локация, у которой зоны не устоялись, не
    // получает выдуманного списка.
    expect(rule.judge('feat(store7): что сделано').ok).toBe(true);
    expect(rule.hint().some((line) => line.startsWith('Зоны: '))).toBe(false);
  });
});
