/**
 * РАЗБОР ВЫЗОВА.
 *
 * Проверяется одно свойство: разбор ничего не решает и ничего не додумывает.
 * Незнакомое — отказ, а не «пропустим»: опечатка во флаге, которая тихо ничего
 * не делает, — то самое молчание, из-за которого человек уверен, что попросил.
 *
 * Прогона здесь нет: проверяются ветки, которые до него не доходят. Живое
 * поведение команд меряет `acceptance.spec.ts` — настоящим магазином.
 */

import { describe, expect, it } from 'vitest';
import { cli, USAGE } from './cli.js';
import { SCHEMA_VERSION } from './result.js';

describe('разбор вызова', () => {
  it('без команды — подсказка и НЕнулевой код: вызов не состоялся', async () => {
    const outcome = await cli([], process.cwd());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain(USAGE);
    // До прогона не дошло — значит ответа прогона нет, а не пустой.
    expect(outcome.result).toBeNull();
  });

  it('--help — та же подсказка, но код нулевой: спросили и получили', async () => {
    const outcome = await cli(['--help'], process.cwd());

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('baser-registry up');
    expect(outcome.stdout).toContain('baser-registry down');
    expect(outcome.stdout).toContain('baser-registry status');
  });

  it('--version отдаёт форму ответа и версию пакета — они про разное', async () => {
    const outcome = await cli(['--version'], process.cwd());
    const versions = JSON.parse(outcome.stdout) as Record<string, unknown>;

    // Форма ответа — контракт для скриптов, версия пакета — что установлено.
    // Одной здесь не обойтись.
    expect(versions['schemaVersion']).toBe(SCHEMA_VERSION);
    expect(versions['packageVersion']).toMatch(/^\d+\.\d+\.\d+/);
    expect(outcome.exitCode).toBe(0);
  });

  it('незнакомая команда — отказ КОДОМ, а не только прозой', async () => {
    const outcome = await cli(['ап'], process.cwd());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('[unknown-command]');
    expect(outcome.stdout).toContain('ап');
    expect(outcome.result).toBeNull();
  });

  it('незнакомый флаг — отказ, а не тихо проигнорированная просьба', async () => {
    const outcome = await cli(['status', '--подробно'], process.cwd());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('[unknown-flag]');
    expect(outcome.result).toBeNull();
  });
});
