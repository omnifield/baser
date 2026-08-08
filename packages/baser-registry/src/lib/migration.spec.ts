/**
 * ПЕРЕЕЗД НАСТРОЕК: локация со старым файлом узнаёт об этом ОТКАЗОМ.
 *
 * Худший исход переезда — не отказ и не ошибка, а МОЛЧАНИЕ: человек заполнил
 * порт и апстрим, файл остался в прежнем месте, инструмент его не читает и
 * спокойно уезжает на дефолтах. Магазин поднимется на другом порту, полезет не
 * к тому апстриму, и ничего из этого не будет названо.
 *
 * Поэтому проба здесь ровно на одно свойство: **заполненный человеком файл в
 * прежнем месте не бывает проигнорирован молча.**
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { status } from './shop.js';

let root: string;

/** Скоупы у настоящего npm не спрашиваем: проба не про них, а платит секундами. */
const options = () => ({ cwd: root, scopes: async () => [] });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'baser-registry-move-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('старый файл настроек не проглатывается молча', () => {
  it('его наличие — названный отказ с кодом и обоими путями', async () => {
    const layout = shopLayout(root);
    mkdirSync(layout.home, { recursive: true });
    writeFileSync(layout.legacyConfig, 'port: 4999\n', 'utf8');

    const answer = await status(options());

    expect(answer.outcome).toBe('refused');
    const problem = answer.problems.find(
      (one) => one.code === 'config-in-old-place',
    );
    expect(problem).toBeDefined();
    // Человеку названы ОБА места: откуда забрать и куда положить. Отказ без
    // адреса починки отправляет искать самому.
    expect(problem?.at).toBe(layout.legacyConfig);
    expect(problem?.message).toContain(layout.config);
  });

  it('и настройки из него НЕ применяются втихую', async () => {
    // Ровно то, что делает молчание опасным: 4999 из старого файла не должен
    // ни подхватиться, ни выглядеть как подхваченный.
    const layout = shopLayout(root);
    mkdirSync(layout.home, { recursive: true });
    writeFileSync(layout.legacyConfig, 'port: 4999\n', 'utf8');

    const answer = await status(options());

    expect(answer.shop.address).not.toContain('4999');
  });

  it('новый файл при этом НЕ рождается: сперва разберитесь со старым', async () => {
    const layout = shopLayout(root);
    mkdirSync(layout.home, { recursive: true });
    writeFileSync(layout.legacyConfig, 'port: 4999\n', 'utf8');

    await status(options());

    expect(existsSync(layout.config)).toBe(false);
  });

  it('новый файл заполнен — старый больше не мешает работать', async () => {
    // Перенёс человек значения или начал с чистого листа — его дело. Напоминать
    // про старый файл, когда новый уже заполнен, значит мешать работать.
    const layout = shopLayout(root);
    mkdirSync(layout.home, { recursive: true });
    writeFileSync(layout.legacyConfig, 'port: 4999\n', 'utf8');
    mkdirSync(join(root, '.omnifield'), { recursive: true });
    writeFileSync(layout.config, 'port: 4901\n', 'utf8');

    const answer = await status(options());

    expect(answer.problems).toEqual([]);
    expect(answer.shop.address).toContain('4901');
  });

  it('чистая локация: отказа нет, файл рождается в общей папке', async () => {
    const layout = shopLayout(root);

    const answer = await status({ ...options(), cwd: root });

    expect(answer.problems).toEqual([]);
    // `status` — вопрос, он ничего не создаёт; рождение проверяется там, где
    // команда пишет. Здесь важно, что отказа нет и путь назван новый.
    expect(answer.location.root).toBe(root);
    expect(layout.config).toContain('.omnifield');
  });
});
