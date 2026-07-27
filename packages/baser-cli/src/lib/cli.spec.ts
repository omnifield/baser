/**
 * РАЗБОР ВЫЗОВА.
 *
 * Проверяется ровно одно свойство: разбор ничего не решает и ничего не
 * додумывает. Незнакомое — отказ, а не «пропустим»: опечатка в флаге, которая
 * тихо ничего не делает, это то самое молчание, из-за которого затирание
 * становилось дефектом.
 */

import { describe, expect, it } from 'vitest';
import { cli, USAGE } from './cli.js';
import { DOOR_SCHEMA_VERSION } from './schema.js';

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
    expect(outcome.stdout).toContain('baser plan');
    expect(outcome.stdout).toContain('baser apply');
  });

  it('--version отдаёт версии ВСЕХ ТРЁХ схем, а не одну свою', async () => {
    const outcome = await cli(['--version'], process.cwd());
    const versions = JSON.parse(outcome.stdout) as Record<string, number>;

    // Зоны выпускаются порознь, поэтому номер у каждой свой. Потребитель
    // обязан видеть, по какой версии каждой зоны собран ЭТОТ ответ.
    expect(versions['doorSchemaVersion']).toBe(DOOR_SCHEMA_VERSION);
    expect(versions['formVersion']).toBeGreaterThan(0);
    expect(versions['outputSchemaVersion']).toBeGreaterThan(0);
    expect(outcome.exitCode).toBe(0);
  });

  it('неизвестная команда названа вслух', async () => {
    const outcome = await cli(['materialize'], process.cwd());
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('неизвестная команда "materialize"');
  });

  it('НЕЗНАКОМЫЙ ФЛАГ — отказ, а не молчание', async () => {
    const outcome = await cli(['plan', '--confrim', 'a.json'], process.cwd());
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('неизвестный флаг "--confrim"');
  });

  it('флаг без значения не съедает следующий флаг', async () => {
    const outcome = await cli(['plan', '--cwd', '--json'], process.cwd());
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('флаг "--cwd" ждёт значения');
  });
});
