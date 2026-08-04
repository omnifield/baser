import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { judge } from '../lib/guard.mjs';
import { breakingSince, releasedVersions } from '../lib/repo.mjs';
import { compare, parse } from '../lib/version.mjs';

/**
 * ГЕЙТ НА ВЫПУЩЕННОЙ ИСТОРИИ — на наших тегах и наших коммитах, а не на выдуманных.
 *
 * Выдуманный набор проверяет правило, но не проверяет, что правило вообще
 * встретится с действительностью: тег `<имя>@<номер>` со скоупом внутри имени,
 * коммит-сквош с номером PR в заголовке, многозонный заход. Здесь всё это живое.
 *
 * ЧТО ИМЕННО ЖИВОЕ — РАЗЛИЧЕНИЕ, КУПЛЕННОЕ КРАСНЫМ ПРОГОНОМ (`BASER2-176`,
 * 2026-08-04). Живое здесь — **выпущенная история**: теги, которые уже уехали, и
 * коммиты между ними. Это исторические факты, они больше не меняются. Рабочее
 * дерево — НЕ факт, а состояние: номера в манифестах двигаются каждым выпуском,
 * список тегов растёт каждым выпуском. Прежние пробы читали и то и другое, и
 * подъём номера красил пять из девяти — ни одна не про дефект. Проба, которая
 * падает от выпуска, не защищает, а мешает выпускать.
 *
 * Отсюда форма каждой пробы — МОМЕНТ ИСТОРИИ, закрытый с обеих сторон:
 *   - номер-кандидат называет сама проба (вход), из дерева он не читается;
 *   - теги берутся ПО СОСТОЯНИЮ НА названный выпуск — то, что уехало позже,
 *     тогда ещё не существовало;
 *   - окно коммитов закрыто сверху тегом, а не `HEAD`, — иначе завтрашний
 *     ломающий коммит перепишет вчерашний вердикт.
 *
 * Прогон требует полной истории с тегами (`fetch-depth: 0`). Нет её — сценарные
 * пробы пропускаются, а не притворяются зелёными.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IS_REPO = existsSync(join(ROOT, '.git'));

/**
 * Пакет, на котором стоят пробы: `@omnifield/baser-cli` — единственный наш, у
 * которого между тегами лежит ЖИВОЙ ломающий коммит.
 *
 * Имя, каталог и зона названы здесь, а не вычитаны из дерева: в пробах о
 * выпуске `0.1.0` должна стоять раскладка ТОГО выпуска. На всех тегах, которых
 * касаются пробы, она одна и та же (сверено `git ls-tree` 2026-08-04).
 */
const CLI = {
  name: '@omnifield/baser-cli',
  dir: 'packages/baser-cli',
  zone: 'cli',
  private: false,
};

/**
 * Зоны репозитория в этих окнах истории — нужны гейту, чтобы отличить ломающее
 * СОСЕДА от своего. Тоже названы, а не собраны с диска: сегодняшняя раскладка
 * не должна решать, как судился выпуск, который уже уехал.
 */
const ZONES = new Set([
  'check',
  'cli',
  'contracts',
  'devbox',
  'materialize',
  'pack',
  'release',
]);

/** Теги, без которых сценарным пробам не о чем судить. */
const НУЖНЫ = ['0.0.4', '0.1.0', '0.2.0-dev.1'];
const ЕСТЬ_ИСТОРИЯ = IS_REPO
  ? НУЖНЫ.every((raw) => releasedVersions(ROOT, CLI.name).includes(raw))
  : false;

/**
 * Суждение о номере в НАЗВАННЫЙ момент истории пакета.
 *
 * @param {string} version номер-кандидат — вход пробы
 * @param {object} moment
 * @param {string|null} moment.released старший номер, УЖЕ выпущенный к этому
 *   моменту; что старше — тогда ещё не уехало. `null` — не выпускался ни разу
 * @param {string} [moment.until] верх окна коммитов — тег момента
 */
function asOf(version, { released, until }) {
  const ceiling = released === null ? null : parse(released);
  const tags =
    ceiling === null
      ? []
      : releasedVersions(ROOT, CLI.name).filter((raw) => {
          const parsed = parse(raw);
          return parsed !== null && compare(parsed, ceiling) <= 0;
        });

  return judge({
    packages: [{ ...CLI, version }],
    releasedVersions: () => tags,
    breakingSince: (tag, pkg) => breakingSince(ROOT, tag, pkg, ZONES, until),
  });
}

/**
 * Момент перед выпуском минора: выпущен `0.0.4`, а в дереве уже лежит ломающий
 * `feat(cli)!: дверь зовёт резолв контрактов …`. Ровно тот PR, каким он приезжал
 * на гейт; за него и был взят `0.1.0`. На нём же проверяется, что предвыпускной
 * номер судится по той же цене.
 */
const ПЕРЕД_МИНОРОМ = {
  released: '0.0.4',
  until: '@omnifield/baser-cli@0.1.0',
};

/** Момент после выпуска минора: выпущены `0.0.4` и `0.1.0`, ломающего с них нет. */
const ПОСЛЕ_МИНОРА = {
  released: '0.1.0',
  until: '@omnifield/baser-cli@0.2.0-dev.1',
};

/** Момент после первой дев-сборки: старший выпущенный — предвыпускной. */
const ПОСЛЕ_ДЕВ_СБОРКИ = {
  released: '0.2.0-dev.1',
  until: '@omnifield/baser-cli@0.2.0-dev.1',
};

describe.runIf(IS_REPO && ЕСТЬ_ИСТОРИЯ)('живой ломающий коммит cli', () => {
  it('патч поверх 0.0.4 ломающее не покрывает', () => {
    const { problems } = asOf('0.0.5', ПЕРЕД_МИНОРОМ);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ЭТОГО МАЛО');
    expect(problems[0]).toContain('feat(cli)!:');
  });

  it('минор 0.1.0 покрывает — так и было выпущено', () => {
    const { problems, said } = asOf('0.1.0', ПЕРЕД_МИНОРОМ);
    expect(problems).toEqual([]);
    expect(said).toContain(
      `${CLI.name}: 0.0.4 → 0.1.0, ломающих коммитов 1 — минор набран`,
    );
  });

  it('предвыпускной 0.0.5-dev.1 не покрывает — как и обычный патч', () => {
    const { problems } = asOf('0.0.5-dev.1', ПЕРЕД_МИНОРОМ);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('судится тройка перед суффиксом (0.0.5)');
  });

  it('предвыпускной 0.1.0-dev.1 покрывает — база 0.1.0 берёт минор', () => {
    const { problems, said } = asOf('0.1.0-dev.1', ПЕРЕД_МИНОРОМ);
    expect(problems).toEqual([]);
    expect(said).toContain(
      `${CLI.name}: 0.0.4 → 0.1.0-dev.1 (предвыпускной, база 0.1.0), ломающих коммитов 1 — минор набран`,
    );
  });
});

describe.runIf(IS_REPO && ЕСТЬ_ИСТОРИЯ)('живые теги cli', () => {
  it('номер равен старшему выпущенному — гейту сказать нечего', () => {
    const { problems, said } = asOf('0.1.0', ПОСЛЕ_МИНОРА);
    expect(problems).toEqual([]);
    expect(said).toEqual([]);
  });

  it('уже выпущенный номер не переиспользуется', () => {
    const { problems } = asOf('0.0.4', ПОСЛЕ_МИНОРА);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`уже выпущен тегом ${CLI.name}@0.0.4`);
  });

  it('дев-сборка поверх выпущенного минора судится с него же', () => {
    const { problems, said } = asOf('0.2.0-dev.1', ПОСЛЕ_МИНОРА);
    expect(problems).toEqual([]);
    expect(said).toContain(
      `${CLI.name}: 0.1.0 → 0.2.0-dev.1 (предвыпускной, база 0.2.0), ломающего с прошлого выпуска нет`,
    );
  });

  it('следующая дев-сборка мерится со СТАБИЛЬНОГО, а не с предыдущей', () => {
    const { problems, said } = asOf('0.2.0-dev.2', ПОСЛЕ_ДЕВ_СБОРКИ);
    expect(problems).toEqual([]);
    expect(said).toContain(
      `${CLI.name}: 0.1.0 → 0.2.0-dev.2 (предвыпускной, база 0.2.0), ломающего с прошлого выпуска нет`,
    );
    // Мерили бы против черновика — в строке стояло бы `0.2.0-dev.1 →`, и каждая
    // итерация той же работы сжигала бы ещё один минор.
    expect(said.some((line) => line.includes('0.2.0-dev.1 →'))).toBe(false);
  });
});

describe.runIf(IS_REPO)('пакет до первого выпуска', () => {
  it('невыпускавшийся назван, а не пропущен молча', () => {
    const { problems, said } = asOf('0.0.1', { released: null });
    expect(problems).toEqual([]);
    expect(said).toContain(
      `${CLI.name}: тегов выпуска нет — пакет не выпускался, сравнивать не с чем`,
    );
  });
});
