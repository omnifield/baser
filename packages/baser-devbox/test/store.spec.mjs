/**
 * ТОМ PNPM-СТОРА: проверяется ФАКТ, а не наличие монтирования.
 *
 * Находка живого переезда (`tasker:BASER2-109` П2, `tasker:BASER2-111`), и она
 * измерена, а не выведена:
 *
 * ```
 * том omnifield-pnpm-store → /home/node/.local/share/pnpm/store   310M, НЕ ТРОНУТ
 * pnpm store path          → /workspaces/.pnpm-store/v11          355M, создан постсозданием
 * ```
 *
 * Причина не в нас: pnpm держит стор на файловой системе ВОРКСПЕЙСА ради хардлинков,
 * и дефолт `~/.local/share/pnpm/store` отбрасывается, когда воркспейс — отдельный том
 * («Clone Repository in Container Volume»). Настройка `pnpmStoreVolume` монтировала
 * том и на этом заканчивалась: стор уезжал ВНУТРЬ воркспейс-тома, то есть становился
 * смертным и переставал быть общим на машине, — ровно обратное тому, что обещано.
 *
 * Это наш собственный запрет: половина имитации хуже её отсутствия (`kb:BASER2-2` §5).
 * Из трёх выходов — направить pnpm · снять настройку · сказать в плане — выбран
 * первый, и поэтому проба обязана мерить то же, что мерил потребитель: КУДА
 * УКАЗЫВАЕТ `pnpm store path`. «Том смонтирован» доказывает только монтирование.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { run } from '../../baser-cli/src/index.ts';
import { containerEnv } from './env.mjs';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  tuning,
} from './packed.mjs';

const STORE_TARGET = '/home/node/.pnpm-store';

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const box of boxes) {
    // Права возвращаются перед уборкой: пробы соседства оставляют каталоги,
    // закрытые на запись, и без этого уборка спотыкается о собственную клетку.
    execFileSync('chmod', ['-R', 'u+rwX', box]);
    rmSync(box, { force: true, recursive: true });
  }
  boxes = [];
});

async function materialize(block) {
  consumer = installConsumer({
    repoName: 'baser',
    config: consumerConfig(),
    tuning: block,
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  expect(result.status, JSON.stringify(result.problems)).toBe('applied');
  return parseJsonc(consumer.read(LIVE));
}

/**
 * `pnpm store path` в чистом окружении — ровно тот вопрос, на который потребитель
 * получил неверный ответ.
 *
 * Окружение СОБИРАЕТСЯ (`env.mjs`), а не наследуется: тесты запускаются из-под
 * менеджера пакетов, а постсоздание девбокса — нет, и унаследованный контекст мерил бы
 * машину прогона. Чистка `*_config_*`, стоявшая здесь раньше, перечисляла ЧУЖОЕ и
 * потому не держала — цена названа в `env.mjs`. В собранное кладутся ИМЕННО ТЕ
 * переменные, что уедут в артефакт.
 */
function storePath(env) {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-store-'));
  boxes.push(box);
  return execFileSync('pnpm', ['store', 'path'], {
    cwd: box,
    env: containerEnv(env),
    encoding: 'utf-8',
  }).trim();
}

/** Каталог, который в контейнере был бы точкой монтирования тома. */
function fakeVolume() {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-volume-'));
  boxes.push(box);
  const target = join(box, 'store');
  mkdirSync(target, { recursive: true });
  return target;
}

describe('настройка делает обещанное: pnpm ходит В ТОМ', () => {
  it('адрес стора назван в containerEnv, и это ТОЧКА МОНТИРОВАНИЯ тома', async () => {
    const json = await materialize(tuning({ presets: ['omnifield'] }));

    // Тот самый разрыв, который стоил потребителю месяца незамеченных скачиваний:
    // цель тома и адрес, по которому пойдёт pnpm, обязаны быть ОДНОЙ строкой.
    const mounted = json.mounts
      .find((mount) => mount.startsWith('source=omnifield-pnpm-store,'))
      .match(/target=([^,]+)/)[1];
    expect(mounted).toBe(STORE_TARGET);
    expect(json.containerEnv.NPM_CONFIG_STORE_DIR).toBe(mounted);
    expect(json.containerEnv.PNPM_CONFIG_STORE_DIR).toBe(mounted);
  });

  it('ФАКТ: с этими переменными `pnpm store path` указывает В ТОМ', async () => {
    const json = await materialize(tuning({ presets: ['omnifield'] }));
    const target = fakeVolume();

    // Имена берутся ИЗ АРТЕФАКТА, значение подменяется на каталог, который в
    // контейнере был бы томом: проверяется механика имён, а адрес тома проверен
    // отдельно выше. Своих имён проба не знает — иначе она доказывала бы себя.
    const names = Object.keys(json.containerEnv).filter((key) =>
      key.endsWith('_STORE_DIR'),
    );
    const path = storePath(
      Object.fromEntries(names.map((name) => [name, target])),
    );

    expect(path.startsWith(target), `стор лёг мимо тома: ${path}`).toBe(true);
  });

  it('БЕЗ них pnpm выбирает место сам — и это не том', async () => {
    // Дефект воспроизводится, а не пересказывается: то же окружение, тот же
    // каталог, разница ровно в переменных. Не будь этой пробы, «настройка
    // работает» опиралось бы на то, что мы её написали.
    const target = fakeVolume();

    const path = storePath({});

    expect(path.startsWith(target)).toBe(false);
  });

  it('имён ДВА, потому что каждая линия pnpm читает своё', async () => {
    // pnpm до 11-й читает npm-конфиг (`NPM_CONFIG_*`), с 11-й — свой
    // (`PNPM_CONFIG_*`), и чужое имя каждая игнорирует молча. Назови одно — стор
    // починится ровно половине потребителей, и снова молча. Проба не гадает,
    // какая линия стоит на машине: она требует, чтобы РОВНО ОДНО из двух имён
    // рулило этим pnpm, — то есть чтобы второе было не украшением, а страховкой.
    const json = await materialize(tuning({ presets: ['omnifield'] }));
    const target = fakeVolume();
    const names = Object.keys(json.containerEnv).filter((key) =>
      key.endsWith('_STORE_DIR'),
    );

    expect(names.sort()).toEqual([
      'NPM_CONFIG_STORE_DIR',
      'PNPM_CONFIG_STORE_DIR',
    ]);
    const steering = names.filter((name) =>
      storePath({ [name]: target }).startsWith(target),
    );
    expect(steering.length, `имена, которые рулят: ${steering}`).toBe(1);
  });

  it('тома нет — нет и переменных: пустое обещание не выдаётся за настройку', async () => {
    const json = await materialize(
      tuning({ settings: { secretsVolume: null } }),
    );

    expect(json.containerEnv).toBeUndefined();
    expect(json.mounts).toBeUndefined();
  });

  it('том назван без пресета — адрес считается от пользователя образа', async () => {
    const json = await materialize(
      tuning({
        settings: { pnpmStoreVolume: 'own-store', imageUser: 'vscode' },
      }),
    );

    expect(json.mounts).toEqual([
      'source=own-store,target=/home/vscode/.pnpm-store,type=volume',
    ]);
    expect(json.containerEnv).toEqual({
      NPM_CONFIG_STORE_DIR: '/home/vscode/.pnpm-store',
      PNPM_CONFIG_STORE_DIR: '/home/vscode/.pnpm-store',
    });
    // Права на том выставляются до установки — иначе pnpm упрётся в том, который
    // создан от root, ровно на первом же скачивании.
    expect(json.postCreateCommand).toContain(
      'sudo chown -R vscode:vscode /home/vscode/.pnpm-store',
    );
  });
});

/**
 * СОСЕДСТВО: проба смотрит не только на свой предмет, но и ВОКРУГ него.
 *
 * Главный урок регрессии `tasker:BASER2-115`, и он не про стор. Проба выше была
 * ВЕРНОЙ: она гоняла `pnpm store path` и требовала попадания в том — и всё
 * равно пропустила поломку, потому что смотрела на свой предмет. А поломка была
 * рядом: мы смонтировали том по адресу `~/.local/share/pnpm/store`, докер создал
 * цепочку каталогов до точки монтирования ОТ ROOT, постсоздание выправило права
 * только на сам том — и всякий инструмент с `~/.local/share/<имя>` получил отказ:
 *
 * ```
 * drwxr-xr-x 3 root root  /home/node/.local/share
 * $ uv run ruff check .
 * error: failed to create directory `/home/node/.local/share/uv/python`: Permission denied
 * ```
 *
 * Поэтому проба здесь утверждает не «наш том на месте», а «мы никому не
 * помешали»: после применения пользователь заводит свой каталог в
 * `~/.local/share` и не упирается в наши права.
 *
 * Механика докера воспроизводится БЕЗ докера и без root: «создано от root»
 * моделируется каталогом, в который нам нельзя писать. Модель проверяется на
 * себе (см. `assertCage`) и на СТАРОМ адресе — на нём проба обязана краснеть,
 * иначе она не поймала бы и вчерашнюю регрессию.
 */

/** Точки монтирования и то, что постсоздание забирает себе — оба из АРТЕФАКТА. */
function mountsAndChown(json) {
  const targets = (json.mounts ?? []).map(
    (mount) => mount.match(/target=([^,]+)/)[1],
  );
  const chown = /sudo chown -R [^ ]+ ([^&]+?)(?: &&|$)/.exec(
    json.postCreateCommand,
  );
  return { targets, chowned: chown === null ? [] : chown[1].trim().split(' ') };
}

/**
 * Клетка обязана быть клеткой: под root каталог без права записи не остановит
 * ничего, и проба зеленела бы, ничего не проверив.
 */
function assertCage(box) {
  const cage = join(box, '.cage');
  mkdirSync(cage);
  chmodSync(cage, 0o555);
  let blocked = false;
  try {
    writeFileSync(join(cage, 'probe'), '');
  } catch {
    blocked = true;
  }
  chmodSync(cage, 0o755);
  expect(
    blocked,
    'проба идёт под root: каталог без права записи ничего не запрещает, и она ничего не доказывает',
  ).toBe(true);
}

/**
 * Дом после старта контейнера: докер создал цепочку до каждой точки
 * монтирования (от root), постсоздание выправило права на сами точки.
 */
function homeAfterStart({ targets, chowned }, home) {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-home-'));
  boxes.push(box);
  assertCage(box);

  const created = [];
  for (const target of targets) {
    const parts = relative(home, target).split('/');
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const path = join(box, ...parts.slice(0, depth));
      if (!existsSync(path)) {
        mkdirSync(path);
        created.push({
          path,
          mine: chowned.includes(join(home, ...parts.slice(0, depth))),
        });
      }
    }
  }
  // Права выставляются от глубоких к мелким: закрытый родитель не помешает
  // закрыть ребёнка, а порядок обхода тут ни при чём.
  for (const { path, mine } of [...created].reverse()) {
    chmodSync(path, mine ? 0o755 : 0o555);
  }
  return box;
}

describe('соседство: мы никому не помешали', () => {
  it('ФАКТ: после применения пользователь заводит свой каталог в ~/.local/share', async () => {
    const json = await materialize(tuning({ presets: ['omnifield'] }));

    const home = homeAfterStart(mountsAndChown(json), '/home/node');

    // Ровно то, что упало у потребителя, — и ровно тем же способом.
    expect(() =>
      mkdirSync(join(home, '.local/share/uv/python'), { recursive: true }),
    ).not.toThrow();
  });

  it('СТАРЫЙ адрес эту пробу роняет — значит она ловит, а не украшает', async () => {
    // Проверка, которую нельзя провалить, ничего не проверяет. Здесь провал
    // воспроизводится буквально: вчерашняя цель монтирования, вчерашний chown.
    const yesterday = {
      targets: ['/home/node/.secrets', '/home/node/.local/share/pnpm/store'],
      chowned: ['/home/node/.secrets', '/home/node/.local/share/pnpm/store'],
    };

    const home = homeAfterStart(yesterday, '/home/node');

    expect(() =>
      mkdirSync(join(home, '.local/share/uv/python'), { recursive: true }),
    ).toThrow(/EACCES|permission denied/i);
  });

  it('ПРАВИЛО, а не случай: между домом и точкой монтирования никого нет', async () => {
    // Утверждение сильнее пробы про uv: не «этот инструмент не пострадал», а «мы
    // не въехали ни в один каталог, который нам не принадлежит». Появится третий
    // том — он попадёт под то же правило, даже если пробу под него не написали.
    const json = await materialize(tuning({ presets: ['omnifield'] }));

    const { targets, chowned } = mountsAndChown(json);
    expect(targets.length).toBeGreaterThan(1);
    for (const target of targets) {
      expect(
        dirname(target),
        `${target} монтируется вглубь чужого каталога`,
      ).toBe('/home/node');
      // И каждый каталог, который докер создаст, обвес забирает себе: между
      // «не въехали вглубь» и «права выставлены» зазора быть не должно.
      expect(chowned).toContain(target);
    }
  });
});
