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
import { DEFAULT_SETTINGS } from './settings.js';
import { USAGE } from './cli.js';

const readme = readFileSync(
  join(import.meta.dirname, '..', '..', 'README.md'),
  'utf8',
);

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
    const rows = readme
      .split('\n')
      .filter((line) => /^\| `[a-z]+` \|/.test(line));

    expect(rows).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
  });

  it('все три команды названы и в доке, и в подсказке', () => {
    for (const command of ['up', 'down', 'status']) {
      expect(readme).toContain(`baser-registry ${command}`);
      expect(USAGE).toContain(`baser-registry ${command}`);
    }
  });

  it('разница с обвесами названа вслух — правило про ноль зависимостей не отменено', () => {
    // Требование ТЗ, и не формальное: следующий, увидев зависимость в нашем
    // пакете, должен прочитать ПОЧЕМУ здесь можно, а не решить, что правило
    // сняли.
    expect(readme).toContain('не отменено');
    expect(readme).toContain('ноль зависимостей');
  });
});
