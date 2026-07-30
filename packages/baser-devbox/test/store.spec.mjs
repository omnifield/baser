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
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../baser-cli/src/index.ts';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  tuning,
} from './packed.mjs';

const STORE_TARGET = '/home/node/.local/share/pnpm/store';

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const box of boxes) rmSync(box, { force: true, recursive: true });
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
 * Окружение чистится от всех `*_config_*`, которыми располагает прогон: тесты
 * запускаются из-под менеджера пакетов, а постсоздание девбокса — нет, и
 * унаследованный контекст мерил бы не то. Дальше в него кладутся ИМЕННО ТЕ
 * переменные, что уедут в артефакт.
 */
function storePath(env) {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-store-'));
  boxes.push(box);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(npm_config|pnpm_config)/i.test(key),
    ),
  );
  return execFileSync('pnpm', ['store', 'path'], {
    cwd: box,
    env: { ...clean, ...env },
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
      'source=own-store,target=/home/vscode/.local/share/pnpm/store,type=volume',
    ]);
    expect(json.containerEnv).toEqual({
      NPM_CONFIG_STORE_DIR: '/home/vscode/.local/share/pnpm/store',
      PNPM_CONFIG_STORE_DIR: '/home/vscode/.local/share/pnpm/store',
    });
    // Права на том выставляются до установки — иначе pnpm упрётся в том, который
    // создан от root, ровно на первом же скачивании.
    expect(json.postCreateCommand).toContain(
      'sudo chown -R vscode:vscode /home/vscode/.local/share/pnpm/store',
    );
  });
});
