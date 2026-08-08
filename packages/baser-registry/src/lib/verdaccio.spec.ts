import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { shopEntry, verdaccioConfig } from './verdaccio.js';

const layout = shopLayout('/локация');

function built(settings = DEFAULT_SETTINGS) {
  const text = verdaccioConfig(settings, layout, '/локация/лог.log');
  return { text, config: parse(text) as Record<string, never> };
}

describe('конфиг раздачи собирается целиком из настроек', () => {
  it('склад — абсолютный путь: процесс стартует с чужим рабочим каталогом', () => {
    // Относительный путь означал бы товар, разложенный там, откуда позвали
    // команду, — а зовут её откуда угодно.
    expect(built().config['storage']).toBe(layout.storage);
    expect(built().config['log']).toMatchObject({ path: '/локация/лог.log' });
  });

  it('апстрим берётся из настроек человека и кэшируется', () => {
    const { config } = built({ ...DEFAULT_SETTINGS, uplink: 'https://свой/' });

    expect(config['uplinks']).toEqual({
      upstream: { url: 'https://свой/', cache: true },
    });
  });

  it('наш скоуп назван отдельным правилом — и раньше общего', () => {
    // Общее правило его и так покрывает; правило читается человеком, и «наши
    // пакеты ходят через свой магазин» должно быть видно, а не выводиться из
    // порядка масок.
    const names = Object.keys(built().config['packages']);

    expect(names).toEqual(['@omnifield/*', '**']);
  });

  it('всё идёт через апстрим — прокси, а не второй реестр рядом', () => {
    const packages = built().config['packages'] as Record<
      string,
      { proxy: string }
    >;

    for (const rule of Object.values(packages)) {
      expect(rule.proxy).toBe('upstream');
    }
  });

  it('публикация работает и без связи с миром', () => {
    expect(built().config['publish']).toMatchObject({ allow_offline: true });
  });

  it('файл говорит, что он наш и что правки в нём исчезнут', () => {
    // Артефакт перезаписывается на каждом `up`. Человек, открывший его, обязан
    // узнать об этом из файла, а не из пропавшей правки.
    const { text } = built();

    expect(text).toContain('СОБРАН МАГАЗИНОМ');
    expect(text).toContain('.baser-registry/config.yml');
  });

  it('две сборки одних настроек дают один байт в байт файл', () => {
    // Иначе «перезаписывается целиком» превратилось бы в бесконечную правку.
    expect(built().text).toBe(built().text);
  });
});

describe('запускатель раздачи судится ЗАПУСКОМ, а не видом строки', () => {
  it('файл существует на диске', () => {
    // Прежняя проба здесь была `expect(verdaccioBin()).toMatch(/verdaccio/)` —
    // она проверяла, что СТРОКА содержит слово. Такая проба зеленеет и на пути,
    // который никуда не ведёт, и ровно это она и сделала: выпущенный пакет падал
    // на `up`, а приёмка была зелёной (`tasker:BASER2-251`).
    expect(existsSync(shopEntry())).toBe(true);
  });

  it('и РЕАЛЬНО поднимает раздачу, которая отвечает', async () => {
    // Доказательство — ответивший сервер. Ни путь, ни его вид доказательством
    // не являются: чужой пакет вправе закрыть подпуть в любом миноре, и узнать
    // об этом мы должны здесь, а не от человека, у которого не поднялся магазин.
    const root = mkdtempSync(join(tmpdir(), 'baser-registry-entry-'));
    const port = await freePort();
    const home = join(root, '.baser-registry');
    const storage = join(home, 'storage');
    mkdirSync(storage, { recursive: true });

    const configPath = join(home, 'verdaccio.yaml');
    writeFileSync(
      configPath,
      verdaccioConfig(
        { ...DEFAULT_SETTINGS, port },
        shopLayout(root),
        join(home, 'shop.log'),
      ),
      'utf8',
    );

    const child = spawn(
      process.execPath,
      [shopEntry(), configPath, '127.0.0.1', String(port)],
      { stdio: 'ignore', detached: true },
    );

    try {
      expect(await answered(`http://127.0.0.1:${port}`)).toBe(true);
    } finally {
      child.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** Ждёт, пока раздача ответит на `/-/ping`. */
async function answered(address: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${address}/-/ping`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return true;
    } catch {
      // Ещё не поднялся — это ожидаемо, ждём дальше.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
