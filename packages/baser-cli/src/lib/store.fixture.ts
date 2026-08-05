/**
 * СКЛАД ДЛЯ ПРОБЫ — настоящий, поднятый тут же, без сети.
 *
 * Главная проба этого захода спрашивает то, чего не спрашивает ни одна другая:
 * достаёт ли дверь поставку САМА (`tasker:BASER2-146`). Ответить на это можно
 * только настоящим доставанием — тем самым пакетным менеджером, из настоящего
 * склада, с настоящей распаковкой тарбола. Мок пакетного менеджера проверял бы
 * наши представления о нём, а мы их и так знаем; ломается же ровно то, чего мы
 * про него не знаем.
 *
 * Поэтому здесь поднимается склад: `http`-сервер, отвечающий тем, чем отвечает
 * реестр, — опись пакета (`GET /<имя>`) и тарбол (`GET /<имя>/-/<файл>.tgz`).
 * Пакетный менеджер разговаривает с ним как с любым другим, а проба получает то,
 * чего у настоящего склада не получишь:
 *
 *   · **счётчик обращений** — «повторный прогон берёт из кэша» это утверждение
 *     ПРО СКЛАД, и проверяется оно тем, что склад никто не спросил;
 *   · **выключатель** — недоступность склада воспроизводится погашенным складом,
 *     а не ожиданием, когда у нас упадёт интернет;
 *   · **детерминизм** — версии выкладывает проба, и «последняя доступная» здесь
 *     то, что она выложила последним.
 *
 * ── ПОЧЕМУ СКЛАД — ОТДЕЛЬНЫЙ ПРОЦЕСС ────────────────────────────────────────
 *
 * Не ради чистоты: иначе он молчит. Дверь зовёт пакетный менеджер СИНХРОННО, и
 * склад, поднятый в том же процессе, не получит управления до конца этого
 * вызова — то есть никогда. Первая версия этой фикстуры так и висела, и висела
 * она правильно: в жизни склад тоже отдельный процесс, и проба, у которой он не
 * отдельный, проверяла бы раскладку, которой не бывает.
 *
 * Общение с ним идёт через диск, а не через свой протокол: выложенное — файлы в
 * каталоге, обращения — строки в журнале. Свой протокол пришлось бы обслуживать
 * ровно там, где событийный цикл занят.
 *
 * Адрес отдаётся менеджеру через его же окружение (`npm_config_registry`):
 * настраивают склад именно так, и подменять ради пробы наш вызов значило бы
 * проверять дверь на пути, которым она не ходит.
 *
 * ── КЭШ МЕНЕДЖЕРА ТОЖЕ СВОЙ, И ЭТО НЕ АККУРАТНОСТЬ ──────────────────────────
 *
 * Тем же окружением задаётся `npm_config_cache` — починка настоящего флейка
 * (`tasker:BASER2-156`), а не наведение чистоты. Менеджер кэширует ответы
 * склада по URL ЦЕЛИКОМ, то есть по `127.0.0.1:<порт>`, а порт здесь выдаёт
 * ядро (`listen(0)`). При сетевой ошибке менеджер не падает, а отдаёт
 * устаревшую запись — вот его собственный лог из пойманного падения:
 *
 *     http fetch GET http://127.0.0.1:33567/… attempt 1 failed with ECONNREFUSED
 *     http fetch GET 200 http://127.0.0.1:33567/… 13ms (cache stale)
 *
 * Значит ПОГАШЕННЫЙ склад отвечает `200`, стоит его порту оказаться в общем
 * кэше машины с любого прошлого прогона, — и проба «склад не отвечает» видит
 * `applied` вместо `refused`. Замерено: 2 падения из 12 прогонов под нагрузкой,
 * причём вероятность росла сама собой — каждый прогон проб клал в кэш ЧЕЛОВЕКА
 * ~30 новых адресов складов, которых давно нет.
 *
 * Лечится это не сроком и не повтором: ждать тут нечего, ожидания в пробе нет
 * вовсе. Лечится тем, что общего ресурса не остаётся — кэш живёт внутри `box`
 * и умирает вместе со складом, поэтому чужой порт попасть в него не может ПО
 * ПОСТРОЕНИЮ, а не «маловероятно». Кэш человека заодно перестаёт засоряться.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FORM_VERSION } from '@omnifield/baser-contracts';
import {
  runSealed,
  spawnSealed,
  type ChildProcess,
} from './sealed.fixture.js';

/** Что выкладывается на склад: обвес как пакет. */
export interface StoreSupply {
  readonly packageName: string;
  readonly version: string;
  /** Личность обвеса — то, чем подписаны его записи в паспорте укладки. */
  readonly id: string;
  readonly title?: string;
  /** Раскладка: что и куда кладёт этот обвес. */
  readonly layout: readonly {
    readonly src: string;
    readonly dest: string;
    readonly render?: boolean;
    readonly class?: 'regenerated' | 'placed-once';
  }[];
  /** Файлы каталога шаблонов: имя → содержимое. */
  readonly templates: Readonly<Record<string, string>>;
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface FakeStore {
  /** Адрес склада — тот же, что увидит человек в отказе. */
  readonly url: string;
  /** Сколько раз склад спросили с прошлого обнуления. */
  requests(): number;
  forgetRequests(): void;
  /** Выкладывает версию поставки; возвращает каталог, из которого её собрали. */
  publish(supply: StoreSupply): string;
  /**
   * Ставит МЕТКУ КАНАЛА на версию — тот самый движущийся указатель.
   *
   * Отдельным действием от выкладки, потому что в жизни это и есть отдельное
   * действие (`npm dist-tag add`): выпуск в канал двигает метку, а не рождает
   * её вместе с версией. Проба, у которой метка приезжала бы с публикацией, не
   * смогла бы показать главного — что метка ПЕРЕЕХАЛА на новую сборку, пока
   * перечень локации не изменился ни на символ.
   */
  tag(packageName: string, channel: string, version: string): void;
  /** Гасит склад, не убирая выложенного: так выглядит «склад недоступен». */
  shutdown(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Сам склад — отдельным файлом, потому что запускается отдельным процессом.
 *
 * Логика вся здесь и вся короткая: опись собирается из того, что лежит в
 * каталоге, тарболы отдаются как есть, каждое обращение уходит строкой в журнал.
 */
const SERVER = `
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, journal] = process.argv.slice(2);
const flat = (name) => name.replace(/^@/, '').replace(/\\//g, '-');

const server = createServer((request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
  appendFileSync(journal, path + '\\n');

  const tarball = /^\\/(.+)\\/-\\/([^/]+\\.tgz)$/.exec(path);
  if (tarball !== null) {
    const file = join(dir, tarball[2]);
    if (!existsSync(file)) {
      response.writeHead(404).end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(readFileSync(file));
    return;
  }

  const name = path.slice(1);
  const number = (value) => value.split(/[.\\-+]/).map((part) => parseInt(part, 10) || 0);
  const tagged = existsSync(join(dir, flat(name) + '.tags.json'))
    ? JSON.parse(readFileSync(join(dir, flat(name) + '.tags.json'), 'utf-8'))
    : {};
  const versions = readdirSync(dir)
    .filter((file) => file.startsWith(flat(name) + '@') && file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf-8')))
    .sort((left, right) => {
      const a = number(left.version);
      const b = number(right.version);
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
      }
      return 0;
    });
  if (versions.length === 0) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      _id: name,
      name,
      'dist-tags': { latest: versions[versions.length - 1].version, ...tagged },
      versions: Object.fromEntries(versions.map((item) => [item.version, item])),
    }),
  );
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write('готов ' + server.address().port + '\\n');
});
`;

/**
 * Поднимает склад, делает его адресом по умолчанию для пакетного менеджера и
 * выдаёт менеджеру свой кэш — на время жизни этого склада.
 *
 * Окружение правится на время пробы и возвращается в `close`: процесс проб
 * общий, и склад, оставшийся адресом по умолчанию, увёл бы туда соседние пробы.
 */
export async function startStore(): Promise<FakeStore> {
  const box = mkdtempSync(join(tmpdir(), 'baser-store-'));
  const shelf = join(box, 'shelf');
  const journal = join(box, 'requests.log');
  mkdirSync(shelf, { recursive: true });
  writeFileSync(journal, '');

  const script = join(box, 'store.mjs');
  writeFileSync(script, SERVER);

  const process_: ChildProcess = spawnSealed('node', [script, shelf, journal], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const port = await new Promise<string>((ready, failed) => {
    let said = '';
    process_.stdout?.on('data', (chunk: Buffer) => {
      said += chunk.toString('utf-8');
      const line = /готов (\d+)/.exec(said);
      if (line !== null) {
        ready(line[1]);
      }
    });
    process_.on('exit', (code) =>
      failed(new Error(`склад пробы не поднялся (код ${code})`)),
    );
  });

  const url = `http://127.0.0.1:${port}/`;
  const restoreEnv = takeOver({
    npm_config_registry: url,
    npm_config_cache: join(box, 'npm-cache'),
  });

  /** Строк в журнале — столько раз склад и спросили. */
  let forgotten = 0;
  const asked = (): number =>
    readFileSync(journal, 'utf-8').split('\n').filter(Boolean).length;

  let alive = true;

  const store: FakeStore = {
    url,
    requests: () => asked() - forgotten,
    forgetRequests: () => {
      forgotten = asked();
    },
    publish(supply) {
      const source = join(box, `${flat(supply.packageName)}-${supply.version}`);
      writeSupply(source, supply);

      const packed = mkdtempSync(join(box, 'pack-'));
      runSealed(
        'npm',
        ['pack', '--ignore-scripts', '--pack-destination', packed, source],
        { cwd: source, stdio: 'pipe' },
      );
      const file = readdirSync(packed).find((name) => name.endsWith('.tgz'));
      if (file === undefined) {
        throw new Error(`npm pack не оставил тарбол в ${packed}`);
      }
      const bytes = readFileSync(join(packed, file));

      const tarball = `${flat(supply.packageName)}-${supply.version}.tgz`;
      writeFileSync(join(shelf, tarball), bytes);

      const manifest = JSON.parse(
        readFileSync(join(source, 'package.json'), 'utf-8'),
      ) as Record<string, unknown>;
      writeFileSync(
        join(shelf, `${flat(supply.packageName)}@${supply.version}.json`),
        `${JSON.stringify({
          ...manifest,
          _id: `${supply.packageName}@${supply.version}`,
          dist: {
            tarball: `${url}${supply.packageName}/-/${tarball}`,
            shasum: createHash('sha1').update(bytes).digest('hex'),
            integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          },
        })}\n`,
      );
      return source;
    },
    tag(packageName, channel, version) {
      const file = join(shelf, `${flat(packageName)}.tags.json`);
      const tags = existsSync(file)
        ? (JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>)
        : {};
      writeFileSync(
        file,
        `${JSON.stringify({ ...tags, [channel]: version }, null, 2)}\n`,
      );
    },
    async shutdown() {
      if (!alive) {
        return;
      }
      alive = false;
      await new Promise<void>((done) => {
        process_.on('exit', () => done());
        process_.kill('SIGKILL');
      });
    },
    async close() {
      await store.shutdown();
      restoreEnv();
      rmSync(box, { force: true, recursive: true });
    },
  };

  return store;
}

/**
 * Ставит переменные окружения менеджера и отдаёт возврат их как было.
 *
 * Возвратом заведует одно место, а не каждая переменная по отдельности: пока
 * их было одна, ручной возврат в `close` читался, а на второй такой возврат
 * забывают — и переменная переживает свой склад, уводя соседние пробы на
 * адрес, которого больше нет, или в кэш, которого больше нет.
 */
function takeOver(values: Readonly<Record<string, string>>): () => void {
  const before = Object.entries(values).map(([name, value]) => {
    const was = process.env[name];
    process.env[name] = value;
    return [name, was] as const;
  });

  return () => {
    for (const [name, was] of before) {
      if (was === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = was;
      }
    }
  };
}

/** Скоуп в имени файла живёт дефисом: `@a/b` → `a-b`. */
function flat(packageName: string): string {
  return packageName.replace(/^@/, '').replace(/\//g, '-');
}

/** Раскладывает каталог обвеса: манифест с объявлением плюс шаблоны. */
function writeSupply(root: string, supply: StoreSupply): void {
  mkdirSync(join(root, 'template'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: supply.packageName,
        version: supply.version,
        files: ['template'],
        baser: {
          // Форма НЫНЕШНЯЯ, а не число: выложенный обвес изображает живой
          // инструмент, а не выпущенный вчера.
          formVersion: FORM_VERSION,
          source: {
            id: supply.id,
            title: supply.title ?? supply.id,
            contentRoot: 'template',
          },
          settings: supply.settings ?? {},
          presets: {},
          layout: supply.layout,
        },
      },
      null,
      2,
    )}\n`,
  );
  for (const [name, content] of Object.entries(supply.templates)) {
    const file = join(root, 'template', name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}
