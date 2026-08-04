import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { judge } from '../lib/guard.mjs';
import { factsOf, readPackages, releasedVersions } from '../lib/repo.mjs';
import { compare, parse } from '../lib/version.mjs';

/**
 * ГЕЙТ НА ЖИВОМ РЕПОЗИТОРИИ — на наших номерах и наших тегах, а не на выдуманных.
 *
 * Выдуманный набор проверяет правило, но не проверяет, что правило вообще
 * встретится с действительностью: тег `<имя>@<номер>` со скоупом внутри имени,
 * коммит-сквош с номером PR в заголовке, многозонный заход. Здесь всё это живое.
 *
 * Прогон требует полной истории с тегами (`fetch-depth: 0`). Нет её — сценарные
 * пробы пропускаются, а не притворяются зелёными.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IS_REPO = existsSync(join(ROOT, '.git'));

const packages = IS_REPO ? readPackages(ROOT) : [];
const tags = new Map(
  packages.map((pkg) => [
    pkg.name,
    IS_REPO ? releasedVersions(ROOT, pkg.name) : [],
  ]),
);
const HAS_TAGS = [...tags.values()].some((list) => list.length > 0);

/**
 * Живые факты репозитория с одной подменой — «а если бы выпускали вот так».
 * Номер пакета задаётся, часть тегов при надобности снимается: так
 * воспроизводится момент ПЕРЕД выпуском, который уже состоялся.
 *
 * @param {string} name
 * @param {string} version
 * @param {readonly string[]} [without] номера, тегов которых «ещё нет»
 */
function asIf(name, version, without = []) {
  const facts = factsOf(ROOT);
  return judge({
    ...facts,
    packages: facts.packages.map((pkg) =>
      pkg.name === name ? { ...pkg, version } : pkg,
    ),
    releasedVersions: (each) =>
      each === name
        ? facts.releasedVersions(each).filter((raw) => !without.includes(raw))
        : facts.releasedVersions(each),
  });
}

describe.runIf(IS_REPO)('текущее дерево', () => {
  it('гейт зелёный — ни одной проблемы', () => {
    const { problems } = judge(factsOf(ROOT));
    expect(problems).toEqual([]);
  });

  it('пакеты, чей номер равен старшему тегу, молчат — выпуска нет', () => {
    const { said } = judge(factsOf(ROOT));

    for (const pkg of packages) {
      const released = (tags.get(pkg.name) ?? []).map(parse).sort(compare);
      if (pkg.private || released.length === 0) continue;
      if (released.at(-1).raw !== pkg.version) continue;
      expect(said.some((line) => line.startsWith(`${pkg.name}:`))).toBe(false);
    }
  });

  it('невыпускавшийся пакет назван, а не пропущен молча', () => {
    const { said } = judge(factsOf(ROOT));

    for (const pkg of packages) {
      if (pkg.private || (tags.get(pkg.name) ?? []).length > 0) continue;
      expect(said).toContain(
        `${pkg.name}: тегов выпуска нет — пакет не выпускался, сравнивать не с чем`,
      );
    }
  });
});

/**
 * `@omnifield/baser-cli` — единственный наш пакет, у которого между тегами лежит
 * ЖИВОЙ ломающий коммит: `feat(cli)!: дверь зовёт резолв контрактов …` с тега
 * `0.0.4`. За него и был взят минор `0.1.0`. Снимаем тег `0.1.0` — и получаем
 * ровно тот PR, каким он приезжал на гейт; на нём же проверяется, что
 * предвыпускной номер судится по той же цене.
 */
describe.runIf(IS_REPO && HAS_TAGS)('живой ломающий коммит cli', () => {
  const CLI = '@omnifield/baser-cli';
  const ДО_МИНОРА = ['0.1.0'];

  it('патч поверх 0.0.4 ломающее не покрывает', () => {
    const { problems } = asIf(CLI, '0.0.5', ДО_МИНОРА);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ЭТОГО МАЛО');
    expect(problems[0]).toContain('feat(cli)!:');
  });

  it('минор 0.1.0 покрывает — так и было выпущено', () => {
    const { problems, said } = asIf(CLI, '0.1.0', ДО_МИНОРА);
    expect(problems).toEqual([]);
    expect(
      said.some((line) =>
        line.includes('0.0.4 → 0.1.0, ломающих коммитов 1 — минор набран'),
      ),
    ).toBe(true);
  });

  it('предвыпускной 0.0.5-dev.1 не покрывает — как и обычный патч', () => {
    const { problems } = asIf(CLI, '0.0.5-dev.1', ДО_МИНОРА);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('судится тройка перед суффиксом (0.0.5)');
  });

  it('предвыпускной 0.1.0-dev.1 покрывает — база 0.1.0 берёт минор', () => {
    const { problems, said } = asIf(CLI, '0.1.0-dev.1', ДО_МИНОРА);
    expect(problems).toEqual([]);
    expect(
      said.some((line) =>
        line.includes('0.0.4 → 0.1.0-dev.1 (предвыпускной, база 0.1.0)'),
      ),
    ).toBe(true);
    expect(said.some((line) => line.includes('минор набран'))).toBe(true);
  });

  it('дев-сборка поверх выпущенного минора судится с него же', () => {
    const { problems, said } = asIf(CLI, '0.2.0-dev.1');
    expect(problems).toEqual([]);
    expect(
      said.some((line) =>
        line.includes('0.1.0 → 0.2.0-dev.1 (предвыпускной, база 0.2.0)'),
      ),
    ).toBe(true);
  });

  it('уже выпущенный номер не переиспользуется', () => {
    const { problems } = asIf(CLI, '0.0.4');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`уже выпущен тегом ${CLI}@0.0.4`);
  });
});
