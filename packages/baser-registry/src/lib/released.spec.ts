/**
 * ПРИЁМКА ВЫПУЩЕННОГО ПАКЕТА — то, чего не было и из-за чего уехал сломанный
 * выпуск.
 *
 * Вся остальная приёмка зоны бежит В МОНОРЕПЕ, из исходников. Это другая
 * раскладка, другие версии зависимостей и другой способ разрешения путей — и
 * зелёная там она ничего не обещает потребителю. Мы проверяли внутрь, а
 * отгружали наружу: `0.1.0-dev.1` установился, поздоровался `status`'ом и упал
 * на `up` — на первой же работе, ради которой существует (`tasker:BASER2-251`).
 *
 * Здесь проверяется ровно то, что уедет: **тарбол**. `npm pack` собирает его тем
 * же способом, что и публикация, установка идёт в ЧИСТЫЙ каталог со своим
 * `node_modules`, и команда зовётся так, как её позовёт человек — через `bin`
 * установленного пакета, а не через наши исходники.
 *
 * ── ПОЧЕМУ ЭТО ДОРОГО И ПОЧЕМУ МЫ ВСЁ РАВНО ПЛАТИМ ──────────────────────────
 *
 * Проба ставит настоящие зависимости из сети — десятки секунд против
 * миллисекунд у остальных. Дешёвой замены нет по построению: подделав
 * установку, мы проверяли бы снова свою раскладку, а сломала нас именно чужая.
 * Прецедент в продукте уже есть — зона `cli` судит собранный бандл
 * (`bundle.spec.ts`, `first-five-minutes.spec.ts`), а не исходник.
 *
 * ── ЧТО ИМЕННО ЛОВИТСЯ ЭТОЙ ПРОБОЙ ──────────────────────────────────────────
 *
 * Первый выпуск резолвил подпуть чужого пакета (`verdaccio/bin/verdaccio`),
 * который тот публичным не объявлял. В монорепе стояла 6.8.0 БЕЗ поля
 * `exports` — резолвилось что угодно; потребителю по диапазону приезжала 6.9.2,
 * где `exports` появились, и подпуть закрылся. Никакая проба над исходниками
 * этого увидеть не могла: там просто другая версия на диске.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Корень нашего пакета — отсюда собирается тарбол. */
const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

/** Сборка и установка платят за себя один раз на файл, а не на пробу. */
const SETUP_TIMEOUT_MS = 300_000;
const CASE_TIMEOUT_MS = 120_000;

let box: string;
let consumer: string;
let location: string;
let command: string;
let port: number;

beforeAll(async () => {
  box = mkdtempSync(join(tmpdir(), 'baser-registry-released-'));
  consumer = join(box, 'consumer');
  location = join(box, 'location');
  mkdirSync(consumer, { recursive: true });
  mkdirSync(location, { recursive: true });

  // Тарбол собирается ровно тем же способом, каким пакет уедет в реестр.
  const packed = execFileSync(
    'npm',
    ['pack', '--pack-destination', box, '--silent'],
    { cwd: PACKAGE_ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .pop() as string;

  execFileSync('npm', ['init', '-y'], { cwd: consumer, stdio: 'ignore' });
  execFileSync('npm', ['install', join(box, packed), '--no-package-lock'], {
    cwd: consumer,
    stdio: 'ignore',
  });

  command = join(consumer, 'node_modules', '.bin', 'baser-registry');

  // Порт свой: приёмка не должна спорить за адрес с магазином, который мог
  // остаться поднятым в этом же контейнере. Задаётся он единственным законным
  // способом — файлом настроек локации, как это сделал бы человек.
  port = await freePort();
  mkdirSync(join(location, '.baser-registry'), { recursive: true });
  writeFileSync(
    join(location, '.baser-registry', 'config.yml'),
    `port: ${port}\n`,
    'utf8',
  );
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  if (command && existsSync(command)) run(['down']);
  if (box) rmSync(box, { recursive: true, force: true });
}, SETUP_TIMEOUT_MS);

describe('выпущенный пакет ставится и работает', () => {
  it(
    'команда установилась и её видно как bin',
    () => {
      expect(existsSync(command)).toBe(true);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'версия verdaccio у потребителя — та, что мы обещали в манифесте',
    () => {
      // Расхождение версии и было причиной поломки: обещали диапазон, проверяли
      // одну сборку. Здесь названо, что приехало НА САМОМ ДЕЛЕ.
      const manifest = join(
        consumer,
        'node_modules',
        'verdaccio',
        'package.json',
      );
      expect(existsSync(manifest)).toBe(true);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'up ПОДНИМАЕТ раздачу — та самая работа, на которой падал выпуск',
    () => {
      const outcome = run(['up', '--json']);

      expect(outcome.code, outcome.said).toBe(0);
      const answer = JSON.parse(outcome.said) as {
        outcome: string;
        state: string;
      };
      expect(answer.outcome).toBe('started');
      expect(answer.state).toBe('running');
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'status на поднятом магазине говорит, что он жив',
    () => {
      const outcome = run(['status', '--json']);
      const answer = JSON.parse(outcome.said) as {
        state: string;
        shop: { pid: number | null };
      };

      expect(answer.state).toBe('running');
      expect(answer.shop.pid).toBeGreaterThan(0);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'down закрывает раздачу, и status с ним согласен',
    () => {
      const stopped = run(['down', '--json']);
      const answer = JSON.parse(stopped.said) as { outcome: string };
      expect(answer.outcome).toBe('stopped');

      const asked = JSON.parse(run(['status', '--json']).said) as {
        state: string;
      };
      expect(asked.state).toBe('closed');
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'товар пережил остановку, и up возвращает раздачу',
    () => {
      // Обещание инструмента целиком, проверенное на ВЫПУЩЕННОМ пакете.
      expect(existsSync(join(location, '.baser-registry', 'storage'))).toBe(
        true,
      );

      const again = JSON.parse(run(['up', '--json']).said) as {
        outcome: string;
        state: string;
      };
      expect(again.outcome).toBe('started');
      expect(again.state).toBe('running');
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'ни одна команда не роняет stack trace вместо ответа',
    () => {
      // Падение выпуска приезжало человеку трейсом Node, а не названным
      // отказом. Форма ответа — контракт (`kb:BASER3-10`), и трейс её нарушает
      // независимо от того, какая причина под ним.
      for (const argv of [['status'], ['up'], ['down']]) {
        const outcome = run(argv);
        expect(outcome.said, argv.join(' ')).not.toContain('at Function.');
        expect(outcome.said, argv.join(' ')).not.toContain('node:internal');
      }
    },
    CASE_TIMEOUT_MS,
  );
});

function run(argv: string[]): { code: number | null; said: string } {
  const outcome = spawnSync(command, argv, {
    cwd: location,
    encoding: 'utf8',
  });
  return {
    code: outcome.status,
    said: `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`,
  };
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
