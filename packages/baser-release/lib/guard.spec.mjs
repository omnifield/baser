import { describe, expect, it } from 'vitest';

import { judge } from './guard.mjs';

/**
 * Суждение на подставленных фактах: пакеты, выпущенные теги, ломающие коммиты.
 * Ни диска, ни git — только те номера, которые проверяются.
 */
function verdictOf({ pkg, tags = [], breaking = {} }) {
  return judge({
    packages: [{ dir: 'packages/baser-cli', zone: 'cli', ...pkg }],
    releasedVersions: () => tags,
    breakingSince: (tag) => breaking[tag] ?? [],
  });
}

const BREAKING = [{ hash: 'abc1234', subject: 'feat(cli)!: имя снято' }];

/**
 * ПОВЕДЕНИЕ НА ОБЫЧНЫХ НОМЕРАХ — регрессия. Всё, что гейт говорил про тройки до
 * переезда и до обучения предвыпускному номеру, он обязан говорить и после.
 * Каждый случай здесь — это ветка прежнего скрипта, снятая с него один в один.
 */
describe('обычные номера — то же, что и раньше', () => {
  it('пакет без тегов не судится: сравнивать не с чем', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.1.0' },
      tags: [],
    });
    expect(problems).toEqual([]);
    expect(said).toEqual([
      'p: тегов выпуска нет — пакет не выпускался, сравнивать не с чем',
    ]);
  });

  it('версия совпала с последним тегом — выпуска нет, гейт молчит', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.1.0' },
      tags: ['0.0.4', '0.1.0'],
    });
    expect(problems).toEqual([]);
    expect(said).toEqual([]);
  });

  it('невыпускаемый пакет пропускается целиком', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.0.1', private: true },
      tags: [],
    });
    expect(problems).toEqual([]);
    expect(said).toEqual([]);
  });

  it('номер, который не разбирается, — отказ с названной формой', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: 'следующая' },
      tags: ['0.1.0'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('не разбирается');
  });

  it('выпуск назад не идёт', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.0.9' },
      tags: ['0.0.4', '0.1.0'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('не старше выпущенной 0.1.0');
  });

  it('ломающего нет — подъём любой', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.1.1' },
      tags: ['0.1.0'],
    });
    expect(problems).toEqual([]);
    expect(said).toEqual([
      'p: 0.1.0 → 0.1.1, ломающего с прошлого выпуска нет',
    ]);
  });

  it('ломающее на нулевом мажоре патчем не уедет', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.1.1' },
      tags: ['0.1.0'],
      breaking: { 'p@0.1.0': BREAKING },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ЭТОГО МАЛО');
    expect(problems[0]).toContain('поднять минор');
    expect(problems[0]).toContain('abc1234 feat(cli)!: имя снято');
  });

  it('ломающее на нулевом мажоре берёт минор', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.2.0' },
      tags: ['0.1.0'],
      breaking: { 'p@0.1.0': BREAKING },
    });
    expect(problems).toEqual([]);
    expect(said[0]).toContain(
      '0.1.0 → 0.2.0, ломающих коммитов 1 — минор набран',
    );
  });

  it('после 1.0.0 ломающее требует мажора, а минора мало', () => {
    const minor = verdictOf({
      pkg: { name: 'p', version: '1.1.0' },
      tags: ['1.0.0'],
      breaking: { 'p@1.0.0': BREAKING },
    });
    expect(minor.problems[0]).toContain('поднять мажор');

    const major = verdictOf({
      pkg: { name: 'p', version: '2.0.0' },
      tags: ['1.0.0'],
      breaking: { 'p@1.0.0': BREAKING },
    });
    expect(major.problems).toEqual([]);
    expect(major.said[0]).toContain('мажор набран');
  });
});

/**
 * ПРЕДВЫПУСКНОЙ НОМЕР — три правила из `kb:BASER3-20` и `tasker:BASER2-158`.
 * До этой работы такой номер гейт не разбирал вовсе и отвечал «версия не
 * разбирается» (поймано живьём 2026-08-03 на `0.3.0-dev.1`).
 */
describe('предвыпускной номер судится, а не отвергается', () => {
  it('база сравнения — тройка перед суффиксом: минор за ломающее набран', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.1' },
      tags: ['0.2.0'],
      breaking: { 'p@0.2.0': BREAKING },
    });
    expect(problems).toEqual([]);
    expect(said[0]).toContain(
      '0.2.0 → 0.3.0-dev.1 (предвыпускной, база 0.3.0)',
    );
    expect(said[0]).toContain('минор набран');
  });

  it('патч-база предвыпускного номера ломающее не покрывает', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.2.1-dev.1' },
      tags: ['0.2.0'],
      breaking: { 'p@0.2.0': BREAKING },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ЭТОГО МАЛО');
    expect(problems[0]).toContain('судится тройка перед суффиксом (0.2.1)');
  });

  it('предвыпускной младше выпущенного с той же тройкой — назад не идёт', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.1' },
      tags: ['0.2.0', '0.3.0'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('не старше выпущенной 0.3.0');
  });

  it('счётчик дев-серии назад тоже не идёт', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.1' },
      tags: ['0.2.0', '0.3.0-dev.2'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('не старше выпущенной 0.3.0-dev.2');
  });

  it('занятый номер не переиспользуется — и причина называется своя', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.1' },
      tags: ['0.2.0', '0.3.0-dev.1', '0.3.0-dev.2'],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('уже выпущен тегом p@0.3.0-dev.1');
    expect(problems[0]).toContain('адрес содержимого');
  });

  it('занятый номер ловится и на обычной тройке', () => {
    const { problems } = verdictOf({
      pkg: { name: 'p', version: '0.2.0' },
      tags: ['0.2.0', '0.3.0'],
    });
    expect(problems[0]).toContain('уже выпущен тегом p@0.2.0');
  });

  it('следующая дев-сборка мерится не с предыдущей, а с выпущенным релизом', () => {
    // Минор за ломающее поднят один раз — при переходе 0.2.0 → 0.3.0-dev.1.
    // Вторая итерация той же работы не обязана сжигать ещё один минор.
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.2' },
      tags: ['0.2.0', '0.3.0-dev.1'],
      breaking: { 'p@0.2.0': BREAKING },
    });
    expect(problems).toEqual([]);
    expect(said[0]).toContain(
      '0.2.0 → 0.3.0-dev.2 (предвыпускной, база 0.3.0)',
    );
  });

  it('дев-сборка, совпавшая со старшим тегом, — выпуска нет', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.2' },
      tags: ['0.2.0', '0.3.0-dev.1', '0.3.0-dev.2'],
    });
    expect(problems).toEqual([]);
    expect(said).toEqual([]);
  });

  it('пакет без единого стабильного выпуска: цену мерить не с чем, и это сказано', () => {
    const { said, problems } = verdictOf({
      pkg: { name: 'p', version: '0.3.0-dev.2' },
      tags: ['0.3.0-dev.1'],
      breaking: { 'p@0.3.0-dev.1': BREAKING },
    });
    expect(problems).toEqual([]);
    expect(said).toEqual([
      'p: выпускался только предвыпускными номерами — цену изменения мерить не с чем',
    ]);
  });
});

describe('набор пакетов', () => {
  it('судится каждый, а вердикты не смешиваются', () => {
    const { said, problems } = judge({
      packages: [
        { name: 'a', version: '0.2.0', dir: 'packages/baser-a', zone: 'a' },
        { name: 'b', version: '0.1.1', dir: 'packages/baser-b', zone: 'b' },
        {
          name: 'c',
          version: '0.0.1',
          dir: 'packages/baser-c',
          zone: 'c',
          private: true,
        },
      ],
      releasedVersions: (name) =>
        name === 'a' ? ['0.1.0'] : name === 'b' ? ['0.1.0'] : [],
      breakingSince: (tag) => (tag === 'b@0.1.0' ? BREAKING : []),
    });

    expect(said).toEqual([
      'a: 0.1.0 → 0.2.0, ломающего с прошлого выпуска нет',
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('b: 0.1.0 → 0.1.1 — ЭТОГО МАЛО');
  });
});

describe('трейсы', () => {
  it('называют вердикт на каждый пакет — зелёный прогон перестаёт быть немым', () => {
    const spans = [];
    const trace = {
      event: (name, detail) => spans.push({ name, detail }),
      span: (name, run, detail) => {
        spans.push({ name, detail });
        return run();
      },
    };

    judge({
      packages: [
        { name: 'a', version: '0.2.0', dir: 'packages/baser-a', zone: 'a' },
        {
          name: 'c',
          version: '0.0.1',
          dir: 'packages/baser-c',
          zone: 'c',
          private: true,
        },
      ],
      releasedVersions: () => ['0.1.0'],
      breakingSince: () => [],
      trace,
    });

    expect(spans).toContainEqual({
      name: 'release.verdict',
      detail: { package: 'a', version: '0.2.0', kind: 'said' },
    });
    expect(spans).toContainEqual({
      name: 'release.skipped',
      detail: { package: 'c', private: true },
    });
    expect(spans.some((span) => span.name === 'release.breaking-scan')).toBe(
      true,
    );
  });
});
