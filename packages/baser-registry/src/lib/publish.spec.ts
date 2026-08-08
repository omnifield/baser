/**
 * ПУБЛИКАЦИЯ КОМАНДОЙ ИНСТРУМЕНТА — живьём, обоими менеджерами.
 *
 * Проверяется главное обещание: **человеку не нужно знать про `npmrc`, флаги
 * скоупа и разницу менеджеров, чтобы положить товар на свой склад.** Поэтому
 * пробы зовут ровно то, что зовёт человек, — одну команду, — и не помогают ей
 * ничем: ни конфигом, ни адресом, ни выбором менеджера.
 *
 * Негативный контроль обязателен и стоит рядом с каждым позитивным: в этом
 * девбоксе скоуп `@omnifield` настроен на GitHub Packages, поэтому «уехало
 * куда надо» без него не значит ничего (`kb:BASER3-39`).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { HOME_VARIABLE } from './location.js';
import { ShopProblemLog } from './problems.js';
import { chooseManager, npmrcFor, onShelf, readManifest } from './publish.js';
import { exitCodeOf } from './result.js';
import { down, publish, up } from './shop.js';

let root: string;
let shopRoot: string;
let address: string;
let port: number;

/** Магазин пробы живёт в своём месте: чужой ~/.local/share не трогаем. */
let options: {
  environment: NodeJS.ProcessEnv;
  scopes: () => Promise<never[]>;
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'baser-registry-publish-'));
  shopRoot = mkdtempSync(join(tmpdir(), 'baser-registry-publish-shop-'));
  options = {
    environment: { [HOME_VARIABLE]: shopRoot },
    scopes: async () => [],
  };
  port = await freePort();

  const config = shopLayout(options.environment).config;
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, `port: ${port}\n`, 'utf8');

  address = `http://127.0.0.1:${port}`;
  await up({ cwd: root, ...options });
}, 120_000);

afterAll(async () => {
  if (root) {
    await down({ cwd: root, ...options });
    rmSync(root, { recursive: true, force: true });
    rmSync(shopRoot, { recursive: true, force: true });
  }
}, 120_000);

describe('одна команда кладёт товар на склад — без npm-грамоты', () => {
  it('обычный пакет уезжает на свой склад, и это НЕ чужой реестр', async () => {
    // Негативный контроль встроен в сам случай: скоуп @omnifield в этом
    // девбоксе настроен на GitHub Packages, и без нашей защиты пакет уехал бы
    // туда — молча, с нулевым кодом возврата.
    const where = makePackage('@omnifield/publish-plain', '0.1.0');

    const answer = await publish({ cwd: root, directory: where, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.published?.manager).toBe('npm');
    expect(answer.published?.destination).toBe(address);
    expect(await onShelfHere('@omnifield/publish-plain')).toBe(true);
  }, 120_000);

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: чужой СКОУП в окружении не уводит товар', async () => {
    // ЯД ВЫБРАН ЗАМЕРОМ, а не наугад — и первые две попытки были мимо.
    //
    // Приоритет источников у менеджеров РАЗНЫЙ (замер 2026-08-08):
    //
    //   npm   — переменная окружения бьёт и `.npmrc` проекта, И флаг `--registry`
    //   pnpm  — `.npmrc` проекта бьёт переменную окружения
    //
    // Отсюда: единственное место, где чистка окружения реально решает, — это
    // npm-путь, и травить надо СКОУПНОЙ переменной. Общая (`npm_config_registry`)
    // на пакет со скоупом не влияет вовсе, а на pnpm-пути яд бессилен по
    // построению — файл сильнее.
    //
    // Проверено на способность краснеть: со снятой чисткой окружения эта проба
    // падает, а прежние её версии — нет.
    const key = 'npm_config_@omnifield:registry';
    const was = process.env[key];
    process.env[key] = 'https://npm.pkg.github.com';
    const where = makePackage('@omnifield/publish-poisoned', '0.1.0');

    try {
      const answer = await publish({ cwd: root, directory: where, ...options });

      expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
      expect(answer.published?.manager).toBe('npm');
      expect(answer.published?.destination).toBe(address);
    } finally {
      if (was === undefined) delete process.env[key];
      else process.env[key] = was;
    }
  }, 120_000);

  it('пакет с workspace: публикуется pnpm и приезжает С ВЕРСИЕЙ', async () => {
    // npm опубликовал бы его УСПЕШНО и сломанным: `workspace:*` в манифесте не
    // ставится нигде. Выбор менеджера — работа инструмента, а не человека.
    const app = makeWorkspace('plain', '5.6.7');

    const answer = await publish({ cwd: root, directory: app, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.published?.manager).toBe('pnpm');
    expect(answer.published?.needsWorkspace).toBe(true);

    const manifest = await fromShelf('@omnifield/publish-app-plain', '0.2.0');
    expect(manifest.dependencies).toEqual({
      '@omnifield/publish-lib-plain': '5.6.7',
    });
  }, 180_000);

  it('ПОВТОР спокоен: «уже на складе», а не «сломалось»', async () => {
    // `up` и `down` в этой зоне идемпотентны, `publish` из ряда выпадал: восемь
    // отказов подряд на исправном складе, и человек шёл чинить то, что не
    // сломано (`tasker:BASER2-257`).
    const where = makePackage('@omnifield/publish-twice', '0.1.0');

    const first = await publish({ cwd: root, directory: where, ...options });
    expect(first.outcome, JSON.stringify(first.problems)).toBe('published');

    const again = await publish({ cwd: root, directory: where, ...options });

    expect(again.outcome).toBe('already-published');
    // Успех, а не отказ: конвейер, публикующий десять пакетов, не должен
    // падать на том, что три из них уже там.
    expect(exitCodeOf(again)).toBe(0);
    expect(again.problems).toEqual([]);
    // И товар при этом назван — человеку видно, о чём речь.
    expect(again.published?.name).toBe('@omnifield/publish-twice');
    expect(again.published?.version).toBe('0.1.0');
  }, 180_000);

  it('и склад повтором НЕ меняется — то же состояние, а не перезапись', async () => {
    const where = makePackage('@omnifield/publish-untouched', '0.2.0');
    await publish({ cwd: root, directory: where, ...options });

    const before = await shelfEntry('@omnifield/publish-untouched');
    await publish({ cwd: root, directory: where, ...options });
    const after = await shelfEntry('@omnifield/publish-untouched');

    expect(Object.keys(after.versions)).toEqual(Object.keys(before.versions));
    expect(after.versions['0.2.0']?.dist?.shasum).toBe(
      before.versions['0.2.0']?.dist?.shasum,
    );
  }, 180_000);

  it('ДРУГАЯ версия того же пакета публикуется как обычно', async () => {
    // «Пакет есть» и «эта версия есть» — разные утверждения; спутать их значило
    // бы молча не публиковать новое.
    const first = makePackage('@omnifield/publish-next', '0.1.0');
    await publish({ cwd: root, directory: first, ...options });

    const second = makePackage('@omnifield/publish-next', '0.2.0');
    const answer = await publish({ cwd: root, directory: second, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    const shelf = await shelfEntry('@omnifield/publish-next');
    expect(Object.keys(shelf.versions).sort()).toEqual(['0.1.0', '0.2.0']);
  }, 180_000);

  it('чужой .npmrc возвращается на место — и содержимым, и отсутствием', async () => {
    // Правка в дереве человека обязана быть возвратной по построению.
    const where = makePackage('@omnifield/publish-keeps-npmrc', '0.1.0');
    const mine = join(where, '.npmrc');
    writeFileSync(mine, '# моё, не трогать\n', 'utf8');

    await publish({ cwd: root, directory: where, ...options });

    expect(readFileSync(mine, 'utf8')).toBe('# моё, не трогать\n');

    const clean = makePackage('@omnifield/publish-no-npmrc', '0.1.0');
    await publish({ cwd: root, directory: clean, ...options });

    expect(existsSync(join(clean, '.npmrc'))).toBe(false);
  }, 120_000);
});

describe('отказы называются, а не случаются', () => {
  it('нет package.json — отказ с кодом и каталогом', async () => {
    const empty = mkdtempSync(join(root, 'пусто-'));

    const answer = await publish({ cwd: root, directory: empty, ...options });

    expect(answer.outcome).toBe('refused');
    expect(answer.problems.map((one) => one.code)).toContain('manifest-missing');
  }, 60_000);

  it('НАСТОЯЩАЯ беда остаётся отказом, а не «уже на складе»', async () => {
    // Спокойный исход добавлен только для «состояние достигнуто». Пакет,
    // который менеджер отказался публиковать, на складе не появился — и
    // называть это «делать нечего» значило бы вернуть ту же склейку исходов,
    // только с другой стороны.
    const where = mkdtempSync(join(root, 'битый-'));
    writeFileSync(
      join(where, 'package.json'),
      JSON.stringify({ name: '@omnifield/ПЛОХОЕ-ИМЯ', version: '0.1.0' }),
      'utf8',
    );

    const answer = await publish({ cwd: root, directory: where, ...options });

    expect(answer.outcome).toBe('failed');
    expect(answer.problems.map((one) => one.code)).toContain('publish-failed');
  }, 120_000);

  it('магазин закрыт — класть некуда, и это сказано до правки чужих файлов', async () => {
    const closed = mkdtempSync(join(tmpdir(), 'baser-registry-closed-'));
    const closedShop = mkdtempSync(join(tmpdir(), 'baser-registry-closed-shop-'));
    const closedEnv = { [HOME_VARIABLE]: closedShop };
    const config = shopLayout(closedEnv).config;
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, `port: ${await freePort()}\n`, 'utf8');
    const where = makePackage('@omnifield/publish-nowhere', '0.1.0', closed);

    try {
      const answer = await publish({
        cwd: closed,
        directory: where,
        environment: closedEnv,
        scopes: async () => [],
      });

      expect(answer.outcome).toBe('refused');
      expect(answer.problems.map((one) => one.code)).toContain('shop-closed');
      // До чужого каталога дело не дошло: отказ не оставляет следов.
      expect(existsSync(join(where, '.npmrc'))).toBe(false);
    } finally {
      rmSync(closed, { recursive: true, force: true });
      rmSync(closedShop, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('менеджер выбирается по манифесту, а не по вкусу', () => {
  it('workspace: в любом наборе зависимостей требует pnpm', () => {
    const problems = new ShopProblemLog();
    for (const set of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const where = mkdtempSync(join(root, 'манифест-'));
      writeFileSync(
        join(where, 'package.json'),
        JSON.stringify({
          name: 'сосед',
          version: '1.0.0',
          [set]: { 'что-то': 'workspace:*' },
        }),
        'utf8',
      );

      const manifest = readManifest(where, problems);

      expect(manifest?.needsWorkspace, set).toBe(true);
      expect(chooseManager(manifest?.needsWorkspace ?? false)).toBe('pnpm');
    }
  });

  it('без workspace: хватает npm', () => {
    expect(chooseManager(false)).toBe('npm');
  });
});

describe('вопрос складу отвечает фактом, а не догадкой', () => {
  it('нет такой версии — значит нет, и это не отказ', async () => {
    expect(await onShelf(address, '@omnifield/publish-plain', '9.9.9')).toBe(
      false,
    );
  });

  it('пакета нет вовсе — тоже спокойное «нет»', async () => {
    expect(await onShelf(address, '@omnifield/никогда-не-был', '1.0.0')).toBe(
      false,
    );
  });

  it('склад не отвечает — утверждать нечего, отвечаем «нет»', async () => {
    // Иначе недоступный склад читался бы как «всё уже опубликовано».
    expect(
      await onShelf('http://127.0.0.1:1', '@omnifield/что-угодно', '1.0.0'),
    ).toBe(false);
  }, 30_000);
});

describe('строки конфига называют адрес И на скоуп', () => {
  it('у пакета со скоупом строк три: общая, скоупная и токен', () => {
    // Скоуп-настройка бьёт общий адрес; без своей строки пакет уедет туда,
    // куда указывает чужой конфиг.
    const lines = npmrcFor('http://127.0.0.1:4873', '@omnifield/что-то')
      .trim()
      .split('\n');

    expect(lines).toEqual([
      'registry=http://127.0.0.1:4873',
      '@omnifield:registry=http://127.0.0.1:4873',
      '//127.0.0.1:4873/:_authToken=baser-registry',
    ]);
  });

  it('у пакета без скоупа скоупной строки нет — выдумывать нечего', () => {
    const lines = npmrcFor('http://127.0.0.1:4873', 'простой')
      .trim()
      .split('\n');

    expect(lines).toHaveLength(2);
  });
});

function makePackage(name: string, version: string, where = root): string {
  const directory = mkdtempSync(join(where, 'товар-'));
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name, version, license: 'MIT' }),
    'utf8',
  );
  return directory;
}

/** Мини-монорепа: пакет с зависимостью на соседа через `workspace:*`. */
function makeWorkspace(tag: string, libVersion: string): string {
  const where = mkdtempSync(join(root, 'монорепа-'));
  mkdirSync(join(where, 'packages', 'lib'), { recursive: true });
  mkdirSync(join(where, 'packages', 'app'), { recursive: true });

  writeFileSync(
    join(where, 'pnpm-workspace.yaml'),
    'packages:\n  - "packages/*"\n',
    'utf8',
  );
  writeFileSync(
    join(where, 'package.json'),
    JSON.stringify({ name: 'корень', private: true }),
    'utf8',
  );
  writeFileSync(
    join(where, 'packages', 'lib', 'package.json'),
    JSON.stringify({
      name: `@omnifield/publish-lib-${tag}`,
      version: libVersion,
      license: 'MIT',
    }),
    'utf8',
  );
  writeFileSync(
    join(where, 'packages', 'app', 'package.json'),
    JSON.stringify({
      name: `@omnifield/publish-app-${tag}`,
      version: '0.2.0',
      license: 'MIT',
      dependencies: { [`@omnifield/publish-lib-${tag}`]: 'workspace:*' },
    }),
    'utf8',
  );

  execFileSync('pnpm', ['install', '--silent', '--ignore-scripts'], {
    cwd: where,
    stdio: 'ignore',
  });

  return join(where, 'packages', 'app');
}

async function shelfEntry(name: string): Promise<{
  versions: Record<string, { dist?: { shasum?: string } }>;
}> {
  const response = await fetch(`${address}/${encodeURIComponent(name)}`);
  return (await response.json()) as {
    versions: Record<string, { dist?: { shasum?: string } }>;
  };
}

async function onShelfHere(name: string): Promise<boolean> {
  const response = await fetch(`${address}/${encodeURIComponent(name)}`);
  return response.ok;
}

async function fromShelf(
  name: string,
  version: string,
): Promise<{ dependencies?: Record<string, string> }> {
  const response = await fetch(`${address}/${encodeURIComponent(name)}`);
  const body = (await response.json()) as {
    versions: Record<string, { dependencies?: Record<string, string> }>;
  };
  return body.versions[version];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const found = (server.address() as AddressInfo).port;
      server.close(() => resolve(found));
    });
  });
}
