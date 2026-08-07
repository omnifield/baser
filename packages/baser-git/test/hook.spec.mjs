/**
 * ПРИЁМКА МАШИННОГО ХУКА — ПОПЫТКОЙ КОММИТА, а не наличием файла.
 *
 * Разница между «лежит» и «работает» — весь предмет этой работы. Хук без бита
 * исполнения git игнорирует МОЛЧА (git 2.55 роняет один `hint`, коммит при этом
 * проходит), а хук в `.git/hooks` не запускается вовсе, когда у локации задан
 * `core.hooksPath`. Проба, смотрящая на существование файла, оба случая
 * пропустила бы и зеленела бы над неработающей машиной — то есть повторила бы
 * `tasker:BASER2-195`, которую эта работа и закрывает.
 *
 * Поэтому здесь настоящий `git init`, настоящий `git commit` и настоящий
 * вердикт git'а. Красное дерево изображается КОМАНДОЙ ГОТОВНОСТИ, которую
 * локация назвала сама: так проверяется и хук, и то, что настройка доезжает до
 * него, — одним вердиктом, а не чтением строки в файле.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  HOOK,
  initGit,
  installConsumer,
  packedFiles,
  run,
  tryCommit,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Команда готовности локации — один файл, вердикт которого проба и двигает. */
const READINESS = 'sh ./readiness.sh';

/**
 * Локация с настоящим git и названной командой готовности.
 *
 * `verifyCommand: null` — файла настроек нет вовсе: так локация выглядит сразу
 * после установки, и именно на ней проверяется дефолт.
 */
function locality({ ready = true, verifyCommand = READINESS } = {}) {
  consumer = installConsumer({
    ...(verifyCommand === null
      ? {}
      : { tuning: { settings: { verifyCommand } } }),
    existing: {
      // node_modules в коммит не едет: там лежит сама поставка.
      '.gitignore': 'node_modules/\n',
      'readiness.sh': `exit ${ready ? 0 : 1}\n`,
    },
  });
  initGit(consumer.root);
  return consumer;
}

/** Готовность локации переключается между попытками коммита. */
function readiness(box, ready) {
  box.write('readiness.sh', `exit ${ready ? 0 : 1}\n`);
}

/** Права положенного файла — бит исполнения, а не весь режим. */
function executable(box, path) {
  return (statSync(join(box.root, path)).mode & 0o111) !== 0;
}

describe('ПРИЁМКА: применил обвес → машина держит коммит', () => {
  it('на КРАСНОМ дереве коммит отвергнут, на зелёном проходит', async () => {
    const box = locality({ ready: false });

    const result = await run({ command: 'apply', cwd: box.root });
    expect(result.status).toBe('applied');
    expect(result.writes.map((write) => write.path)).toContain(HOOK);

    // Вот оно, утверждение целиком: вердикт коммита зависит от готовности.
    const red = tryCommit(box.root);
    expect(red.committed).toBe(false);

    readiness(box, true);
    const green = tryCommit(box.root);
    expect(green.committed).toBe(true);
  });

  it('положенный хук ИСПОЛНЯЕМЫЙ — без бита git игнорирует его молча', async () => {
    const box = locality();

    await run({ command: 'apply', cwd: box.root });

    expect(executable(box, HOOK)).toBe(true);
  });

  it('бит, СБИТЫЙ СНАРУЖИ, возвращается применением — и машина оживает', async () => {
    const box = locality({ ready: false });
    await run({ command: 'apply', cwd: box.root });

    // Ровно живой случай `tasker:BASER2-190`: правка через чужую файловую
    // систему сносит бит, содержимое при этом не меняется.
    box.chmod(HOOK, 0o644);
    expect(executable(box, HOOK)).toBe(false);
    // Машины больше нет: красное дерево проезжает молча.
    expect(tryCommit(box.root, 'chore: мимо машины').committed).toBe(true);

    const again = await run({ command: 'apply', cwd: box.root });

    // Расхождение по режиму — работа, а не сходимость: молчать о нём нельзя.
    expect(again.status).toBe('applied');
    expect(executable(box, HOOK)).toBe(true);
    readiness(box, false);
    expect(tryCommit(box.root, 'chore: снова под машиной').committed).toBe(
      false,
    );
  });

  it('повторное применение идемпотентно — ничего не пишет, бит на месте', async () => {
    const box = locality();
    await run({ command: 'apply', cwd: box.root });
    const landed = box.read(HOOK);

    const again = await run({ command: 'apply', cwd: box.root });

    expect(again.status).toBe('converged');
    expect(again.writes).toEqual([]);
    expect(box.read(HOOK)).toBe(landed);
    expect(executable(box, HOOK)).toBe(true);
  });

  it('на дефолтах хук гоняет команду готовности монорепы, откуда обвес родом', async () => {
    const box = locality({ verifyCommand: null });

    await run({ command: 'apply', cwd: box.root });

    expect(box.read(HOOK)).toContain('exec pnpm verify');
  });

  it('в тарбол уехал шаблон хука — иначе обвес ломается у первого потребителя', () => {
    expect(packedFiles()).toContain('template/pre-commit.ejs');
  });
});
