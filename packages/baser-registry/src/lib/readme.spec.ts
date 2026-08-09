/**
 * ДОКА СВЕРЯЕТСЯ С КОДОМ, а не живёт рядом с ним.
 *
 * README называет настройки и их дефолты. Дефолт поднимется, строку в таблице
 * никто не тронет — и дока начнёт врать ровно там, где человек ей доверяет
 * больше всего. Здесь эта пара заведена как контракт: разойдясь, они красят
 * приёмку.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECISION_DECLARATIONS, DECISIONS_PATH } from './decisions.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { USAGE } from './cli.js';

const readme = readFileSync(
  join(import.meta.dirname, '..', '..', 'README.md'),
  'utf8',
);

/**
 * Раздел доки от заголовка до следующего такого же.
 *
 * Таблиц в README теперь две — настройки участка и решения постройки, — и
 * считать строки по всему файлу значило бы мерить одну другой: добавленное
 * решение красило бы пробу про настройки, хотя настроек никто не трогал.
 */
function section(heading: string): string {
  const start = readme.indexOf(`\n## ${heading}`);
  expect(start, `в README нет раздела «${heading}»`).toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

function rows(text: string): string[] {
  return text.split('\n').filter((line) => /^\| `[a-z]+` \|/.test(line));
}

describe('README не расходится с тем, что делает код', () => {
  it('каждая настройка названа в таблице вместе со своим дефолтом', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect(readme, `настройка ${key}`).toContain(`| \`${key}\` |`);
      expect(readme, `дефолт ${key}`).toContain(`\`${String(value)}\``);
    }
  });

  it('настроек в таблице ровно столько, сколько объявлено', () => {
    // Снятая настройка обязана исчезнуть и отсюда: строка про регулировку,
    // которой больше нет, отправляет человека править то, что не читается.
    expect(rows(section('Настройки'))).toHaveLength(
      Object.keys(DEFAULT_SETTINGS).length,
    );
  });

  it('каждое решение постройки названо в доке, и их ровно столько же', () => {
    // Решения — тот же контракт с человеком, что и настройки: он заполняет их
    // руками, и незадокументированное решение он не найдёт нигде, кроме
    // исходника.
    const shipping = section('Что и куда отгружает постройка');

    for (const one of DECISION_DECLARATIONS) {
      expect(shipping, `решение ${one.key}`).toContain(`| \`${one.key}\` |`);
    }
    expect(rows(shipping)).toHaveLength(DECISION_DECLARATIONS.length);
    // Путь тоже назван: файл человек заводит руками, и искать его негде.
    expect(readme).toContain(DECISIONS_PATH);
  });

  it('дока говорит, что отсутствие файла решений — законное состояние', () => {
    // Самая дорогая половина правила: постройка, которая ничего не отгружает,
    // не обязана иметь орган продаж, и человек должен прочитать это ЗДЕСЬ, а
    // не выяснять отказом.
    expect(readme).toContain('законное состояние');
  });

  it('все команды названы и в доке, и в подсказке', () => {
    for (const command of ['up', 'down', 'status', 'publish']) {
      expect(readme).toContain(`baser-registry ${command}`);
      expect(USAGE).toContain(`baser-registry ${command}`);
    }
  });

  it('видимость названа и в доке, и в подсказке — её не ищут в исходнике', () => {
    // Человек поднимает магазин ради соседей и обязан узнать из доки, отвечает
    // ли он им (tasker:BASER2-267). Оба слова ответа названы, чтобы дока не
    // рассказывала только про удобную половину.
    for (const reach of ['network', 'self-only']) {
      expect(readme, `значение ${reach}`).toContain(reach);
    }
    expect(readme).toContain('shop.reach');
    expect(USAGE).toContain('ВИДИМОСТЬ');
  });

  it('дока не советует собирать команду публикации руками', () => {
    // Совет вместо конструкции — ровно то, от чего уходили: он не работает там,
    // где нужнее всего, и человек узнаёт об этом уже после того, как товар уехал
    // в чужой реестр.
    expect(readme).toContain('baser-registry publish');
    expect(readme).not.toContain('npm publish --');
    expect(readme).not.toContain('--@omnifield:registry');
  });

  it('разница с обвесами названа вслух — правило про ноль зависимостей не отменено', () => {
    // Требование ТЗ, и не формальное: следующий, увидев зависимость в нашем
    // пакете, должен прочитать ПОЧЕМУ здесь можно, а не решить, что правило
    // сняли.
    expect(readme).toContain('не отменено');
    expect(readme).toContain('ноль зависимостей');
  });
});
