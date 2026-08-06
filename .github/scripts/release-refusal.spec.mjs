import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STAGES, refusal, render, stageOf } from './release-refusal.mjs';

const SCRIPT = fileURLToPath(new URL('./release-refusal.mjs', import.meta.url));

/** Успокоительная формула — её право сказать есть ровно у одного рубежа. */
const NOTHING_LEFT = 'не уехало ничего';

/** Рубежи, на которых публикация уже могла что-то сделать в реестре. */
const AFTER_PUBLISH_STARTED = ['publishing', 'published', 'unknown'];

const text = (stage) => render(refusal(stage)).join('\n');

describe('рубеж читается из состояния шага публикации, а не из своих отметок', () => {
  it('шаг публикации не запускался — значит в реестр не уехало ничего', () => {
    expect(stageOf('')).toBe('readiness');
    expect(stageOf('skipped')).toBe('readiness');
  });

  it('шаг публикации упал — значит уехать могло что угодно', () => {
    expect(stageOf('failure')).toBe('publishing');
  });

  it('прогон СНЯЛИ посреди публикации — неопределённость та же, что при падении', () => {
    // Разница «сняли или упало» на состояние реестра не влияет, и отказ,
    // который на снятом прогоне промолчал бы, стоит дороже лишнего пункта.
    expect(stageOf('cancelled')).toBe('publishing');
  });

  it('шаг публикации прошёл — упало то, что идёт после него', () => {
    expect(stageOf('success')).toBe('published');
  });

  it('движок сказал незнакомое — рубеж НЕ опознан, а не угадан', () => {
    expect(stageOf('успех')).toBe('unknown');
    expect(stageOf('neutral')).toBe('unknown');
  });
});

describe('отказ не обещает нетронутый реестр там, где публикация уже шла', () => {
  it('на готовности — и только там — сказано, что не уехало ничего', () => {
    const readiness = refusal('readiness');
    expect(readiness.registry).toBe('untouched');
    expect(text('readiness')).toContain(NOTHING_LEFT);
  });

  it.each(AFTER_PUBLISH_STARTED)(
    'рубеж «%s» нетронутым реестр НЕ называет',
    (stage) => {
      expect(refusal(stage).registry).not.toBe('untouched');
      expect(text(stage)).not.toContain(NOTHING_LEFT);
    },
  );

  it.each(AFTER_PUBLISH_STARTED)(
    'рубеж «%s» зовёт спросить реестр',
    (stage) => {
      // Отказ, который не назвал команду сверки, оставляет человека решать на
      // догадке — а догадка здесь стоит сожжённого номера.
      expect(text(stage)).toContain('npm view');
    },
  );
});

describe('перезапуск назван безопасным ровно там, где он безопасен', () => {
  it('на готовности перезапуск с нуля безопасен', () => {
    expect(refusal('readiness').reversible).toBe(true);
    expect(text('readiness')).toContain('безопасен');
  });

  it.each(AFTER_PUBLISH_STARTED)(
    'после начала публикации перезапуск «%s» опасен',
    (stage) => {
      expect(refusal(stage).reversible).toBe(false);
      expect(text(stage)).toContain('ОПАСЕН');
    },
  );

  it('после начала публикации сказано, ПОЧЕМУ перезапуск опасен', () => {
    // Не «нельзя», а «упрётся в занятые номера»: запрет без причины
    // обходят, причину — учитывают.
    expect(text('publishing')).toContain('занятые');
    expect(text('published')).toContain('занятые');
  });

  it('уехавший номер назван невозвратным, а не «пока занятым»', () => {
    expect(text('publishing')).toContain('не переиспользуется');
  });
});

describe('отказ читается человеком в сводке прогона', () => {
  it.each(STAGES)(
    'рубеж «%s» даёт заголовок, состояние и что делать',
    (stage) => {
      const lines = render(refusal(stage));
      expect(lines[0].startsWith('## ')).toBe(true);
      expect(lines).toContain('### Что сейчас');
      expect(lines).toContain('### Что делать');
      expect(refusal(stage).state.length).toBeGreaterThan(0);
      expect(refusal(stage).next.length).toBeGreaterThan(0);
    },
  );

  it('каждый рубеж говорит своё, а не общий текст на все случаи', () => {
    const headlines = new Set(STAGES.map((stage) => refusal(stage).headline));
    expect(headlines.size).toBe(STAGES.length);
  });
});

describe('как это зовёт воркфлоу', () => {
  it('печатает отказ в stdout и выходит нулём на опознанном рубеже', () => {
    const run = spawnSync(process.execPath, [SCRIPT, 'success'], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Опубликовано ВСЁ');
  });

  it('без аргумента — рубеж «до публикации»: шаг не запускался, outcome пуст', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(NOTHING_LEFT);
  });

  it('неопознанный рубеж — отказ ПЕЧАТАЕТСЯ и код выхода не нулевой', () => {
    // Молчание вместо отказа оставило бы сводку прогона пустой ровно там,
    // где человеку и нужен ответ.
    const run = spawnSync(process.execPath, [SCRIPT, 'что-то новое'], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain('рубеж не опознан');
  });
});
