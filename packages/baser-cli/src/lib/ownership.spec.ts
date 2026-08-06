/**
 * ЗАПИСАТЬ НЕ СМОГУ — сказано ДО применения и своим голосом.
 *
 * Заход `tasker:BASER2-190`, находка архитектора мира на живом. В репозитории
 * часть файлов осталась под другим пользователем, а сессия шла от своего. Дверь
 * про это молчала: она узнавала о невозможности записи в момент записи, и
 * человек видел отказ ЧУЖОЙ механики и позже — на git-операции, — где тот
 * читался как защита ветки и как сетевая ошибка. Цену он нашёл сам, командой
 * `find .git -user root`, то есть уже догадавшись, что дело в правах.
 *
 * Здесь судится ровно то, чего не хватало:
 *
 * 1. **Проверка ДО применения** — обе команды, отказ поимённо и с причиной;
 * 2. **Паспорт укладки — свой отказ**: дверь пишет в него КАЖДЫМ применением и
 *    упирается в него первой, поэтому он спрашивается раньше всего прочего;
 * 3. **На диск не уходит ничего** — ни в один из путей, включая исправные;
 * 4. **Владение дверь не трогает** — ни `sudo`, ни тихого `chown`.
 *
 * ── ЧЕМ ВОСПРОИЗВОДИТСЯ НЕВОЗМОЖНОСТЬ ЗАПИСИ ────────────────────────────────
 *
 * **Битами прав, а не чужим владельцем, — и это названо, а не спрятано.**
 * Сделать файл чужим может только суперпользователь, а проба, зовущая `sudo`,
 * не проба: она требует прав от конвейера, ломается в контейнере без `sudo` и
 * ровно поэтому зеленела бы там, где мерить нечего.
 *
 * Механизм от этого не подменён: вердикт «смогу или нет» дверь берёт у ядра
 * (`access`), а оно отвечает одинаково и на чужое владение, и на снятый бит
 * записи — случай из мира (`-rw-r--r-- root root`) для нашего пользователя это
 * ровно то же «нет права писать». Подменена только ПРИЧИНА, а её дверь берёт из
 * `stat` и складывает чистой функцией — она и судится отдельно, с подставленным
 * чужим владельцем (последний блок файла). Так проверены обе половины: механика
 * на настоящей ФС, слова — на настоящем чужом uid.
 *
 * **Под суперпользователем биты не кусаются** — ядро пропускает его всюду,
 * поэтому измерять здесь нечего, и файловые пробы в таком прогоне пропускаются
 * явно. Слова при этом судятся всё равно: они от прав прогона не зависят.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_PATH } from '@omnifield/baser-materialize';
import {
  BUMPED_RESOLVERS,
  DEVBOX_PACKAGE,
  installDevbox,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { exitCodeOf } from './result.js';
import { renderText } from './report.js';
import { describeRefusal, whoRuns } from './writable.js';

const LIVE = '.devcontainer/devcontainer.json';
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

/** Исходники зоны целиком — сторож смотрит их, а не один каталог. */
const ZONE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sources(from: string): string[] {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
    const path = join(from, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Прогон идёт от суперпользователя — биты прав его не останавливают.
 *
 * Пропуск назван, а не молчалив: проба, зеленеющая оттого, что мерить было
 * нечем, — та же лотерея, что и красная по невезению.
 */
const SUPERUSER = process.getuid?.() === 0;

let consumer: Consumer | null = null;
/** Что вернуть в записываемое состояние, иначе временный каталог не снести. */
const restore: { path: string; mode: number }[] = [];

afterEach(() => {
  for (const entry of restore.splice(0)) {
    try {
      chmodSync(entry.path, entry.mode);
    } catch {
      // Каталога уже нет — возвращать нечего.
    }
  }
  consumer?.cleanup();
  consumer = null;
});

/** Снимает право записи и обещает вернуть его после пробы. */
function seal(box: Consumer, path: string, mode: number): void {
  const full = join(box.root, path);
  restore.unshift({ path: full, mode: statSync(full).mode & 0o777 });
  chmodSync(full, mode);
}

function install(): Consumer {
  consumer = installDevbox({ config: CONFIG });
  return consumer;
}

describe.skipIf(SUPERUSER)('артефакт, в который писать нечем', () => {
  it('отказ называет путь и причину, а на диск не уходит ничего', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });
    const before = box.read(LIVE);

    // Обвес выпустился заново — артефакт разошёлся, и его надо переписать.
    box.updateResolvers(BUMPED_RESOLVERS);
    seal(box, LIVE, 0o444);

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('refused');
    expect(exitCodeOf(result)).toBe(2);
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'path-unwritable',
    ]);
    // Поимённо: без имени файла человек ищет виноватого сам — ровно то, что
    // стоило заявителю команды `find -user root`.
    expect(result.problems[0].message).toContain(`"${LIVE}"`);
    // И причина рядом с ним, а не «отказано в доступе».
    expect(result.problems[0].message).toContain('444');
    // Починка названа, и обе: файл мог остаться от другого пользователя, а мог
    // ему законно принадлежать.
    expect(result.problems[0].message).toContain('chown');
    expect(result.problems[0].message).toContain(
      'зови консоль от того пользователя',
    );

    // На диск не ушло НИЧЕГО: применение проходит целиком либо никак.
    expect(result.writes).toEqual([]);
    expect(box.read(LIVE)).toBe(before);
  });

  it('план отвечает тем же самым — иначе правда придёт после решения', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });
    box.updateResolvers(BUMPED_RESOLVERS);
    seal(box, LIVE, 0o444);

    const planned = await run({ command: 'plan', ...box.door });

    expect(planned.status).toBe('refused');
    expect(planned.problems.map((problem) => problem.code)).toEqual([
      'path-unwritable',
    ]);
    // И план при этом никуда не делся: отказ стоит РЯДОМ с ним, а не вместо
    // него — человек читает, что бы легло, и тут же почему не ляжет.
    expect(planned.runs[0].plan?.steps.length).toBeGreaterThan(0);
    expect(renderText(planned)).toContain(LIVE);
  });

  it('исправный сосед не ложится тоже: целиком либо никак', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });
    const lock = box.read('.devcontainer/devcontainer-lock.json');

    // Оба артефакта разъедутся, а закрыт только один.
    box.updateResolvers(BUMPED_RESOLVERS);
    box.writeTemplate('devcontainer-lock.json', '{ "переехало": true }\n');
    seal(box, LIVE, 0o444);

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('refused');
    expect(box.read('.devcontainer/devcontainer-lock.json')).toBe(lock);
  });
});

describe.skipIf(SUPERUSER)('каталог, в котором файлу не появиться', () => {
  it('отказ называет КАТАЛОГ и что в нём не появится', async () => {
    const box = install();
    // Первая установка: `.devcontainer` ещё нет, и упрётся дверь в корень.
    seal(box, '.', 0o555);

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('refused');
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'path-unwritable',
    ]);
    // Спрашивается ближайшая существующая запись вверх по дереву: файла нет, и
    // отказывает тот, кто его не пустит, — каталог.
    expect(result.problems[0].message).toContain('каталог');
    expect(result.problems[0].message).toContain(LIVE);
    // Причина у пачки одна, и сказана она один раз, а не на каждый путь.
    expect(
      result.problems[0].message.split('записи не дают').length - 1,
    ).toBe(1);
    expect(box.exists(LIVE)).toBe(false);
  });
});

describe.skipIf(SUPERUSER)('паспорт укладки — отдельный случай', () => {
  it('свой отказ: в него дверь пишет КАЖДЫМ применением', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });
    const recorded = box.read(MANIFEST_PATH);

    seal(box, MANIFEST_PATH, 0o444);
    box.updateResolvers(BUMPED_RESOLVERS);

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('refused');
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'manifest-unwritable',
    ]);
    expect(result.problems[0].at).toBe(MANIFEST_PATH);
    expect(result.problems[0].message).toContain('КАЖДЫМ применением');
    expect(box.read(MANIFEST_PATH)).toBe(recorded);
  });

  it('спрашивается ДО склада и до плана — тратить нечего впустую', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });
    seal(box, MANIFEST_PATH, 0o444);

    const result = await run({ command: 'plan', ...box.door });

    // Прогонов нет ни одного: дверь не пошла ни за поставкой, ни за шаблонами.
    expect(result.runs).toEqual([]);
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'manifest-unwritable',
    ]);
  });

  it('дерево при этом цело — отказ ровно про паспорт', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });
    const live = box.read(LIVE);
    seal(box, MANIFEST_PATH, 0o444);
    box.updateResolvers(BUMPED_RESOLVERS);

    await run({ command: 'apply', ...box.door });

    expect(box.read(LIVE)).toBe(live);
  });
});

describe('проверка не кусается там, где всё в порядке', () => {
  it('штатный прогон зелёный, а вопрос мерится своей фазой', async () => {
    const box = install();

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('applied');
    expect(result.problems).toEqual([]);
    expect(result.trace.map((span) => span.name)).toContain('door.writable');
  });

  it('повторный прогон спрашивает и паспорт — данными, а не порядком', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });

    const again = await run({ command: 'plan', ...box.door });

    // Спан один по имени и два по прогону: различить их обязано ДАННЫМИ —
    // иначе телеметрия говорит «где-то в проверке прав».
    expect(
      again.trace
        .filter((span) => span.name === 'door.writable')
        .map((span) => span.detail?.subject),
    ).toEqual(['manifest', 'writes']);
  });
});

/**
 * СЛОВА ПРО ЧУЖОГО ВЛАДЕЛЬЦА — на настоящем чужом uid.
 *
 * Единственное, чего файловые пробы выше показать не могут без прав
 * суперпользователя, и потому судится здесь: причина складывается чистой
 * функцией, и подставить ей владельца можно прямо.
 */
describe('причина названа словами, а не кодом ошибки', () => {
  it('чужое владение — названо чужим, и обе стороны поимённо', () => {
    const said = describeRefusal(
      {
        at: MANIFEST_PATH,
        kind: 'file',
        owner: 0,
        mode: 0o644,
        paths: [MANIFEST_PATH],
      },
      { uid: 1000, name: 'node' },
    );

    expect(said).toContain('ПРИНАДЛЕЖИТ ДРУГОМУ ПОЛЬЗОВАТЕЛЮ');
    // Ровно тот случай, что поймал мир: `-rw-r--r-- 1 root root`.
    expect(said).toContain('uid 0, суперпользователь');
    expect(said).toContain('прогон идёт от uid 1000, node');
  });

  it('свой файл без бита записи — это ДРУГАЯ починка, и слово другое', () => {
    const said = describeRefusal(
      { at: 'baser.json', kind: 'file', owner: 1000, mode: 0o444, paths: [] },
      { uid: 1000, name: 'node' },
    );

    expect(said).toContain('файл твой');
    expect(said).not.toContain('ДРУГОМУ ПОЛЬЗОВАТЕЛЮ');
  });

  it('имя суперпользователя — единственное, что дверь называет не спросив', () => {
    // uid 0 это суперпользователь по определению POSIX. Любой другой номер
    // дверь именем не зовёт: перевод uid в имя — работа службы имён, и
    // сочинить его значило бы уверенно указать не туда.
    const said = describeRefusal(
      { at: 'baser.json', kind: 'file', owner: 4242, mode: 0o644, paths: [] },
      { uid: 1000, name: 'node' },
    );

    expect(said).toContain('uid 4242');
    expect(said).not.toContain('суперпользователь');
  });

  it('прогон под непойманным пользователем — молчим, а не выдумываем', () => {
    const said = describeRefusal(
      { at: 'baser.json', kind: 'file', owner: null, mode: 0o444, paths: [] },
      { uid: null, name: null },
    );

    expect(said).toContain('записи не даёт');
    expect(said).not.toContain('uid');
  });

  it('дверь знает, от кого идёт прогон, — и только это', () => {
    const runner = whoRuns();

    expect(runner.uid).toBe(process.getuid?.() ?? null);
  });
});

/**
 * ВЛАДЕНИЕ ДВЕРЬ НЕ МЕНЯЕТ — сторож, а не обещание в доке.
 *
 * ТЗ называет это прямо: тихая смена владельца — сюрприз хуже отказа, и `sudo`
 * дверь не зовёт. Держится это тем, что смены владельца в зоне нет вовсе:
 * появится вызов — покраснеет здесь, а не у потребителя.
 */
describe('дверь пишет файлы, а не администрирует машину', () => {
  it('смены владельца в зоне нет ни одной', () => {
    const found = sources(ZONE).filter((path) =>
      /\bchown\s*\(|\bchownSync\b|\blchown|\bfchown/.test(
        readFileSync(path, 'utf-8'),
      ),
    );

    // Сверка ничего с ничем проходит всегда: обход обязан что-то найти.
    expect(sources(ZONE).length).toBeGreaterThan(20);
    expect(found).toEqual([]);
  });
});
