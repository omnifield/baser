/**
 * ПРИЁМКА `tasker:BASER2-215` — объявленная программа ЗАПУСКАЕТСЯ.
 *
 * Шов «обвес объявил артефакт исполняемым» тянется через три зоны: форма
 * объявляет поле (`tasker:BASER2-213`), движок доносит его до порта отдельным
 * членом `setExecutable` (`tasker:BASER2-214`), консоль ставит бит на диск.
 * Здесь судится ПОСЛЕДНЕЕ звено, и судится оно целиком: обвес ставится в
 * настоящий репозиторий, прогон зовётся своей публичной поверхностью, файлы
 * уезжают на настоящий диск.
 *
 * **Главное утверждение — не `stat`, а ЗАПУСК.** Бит, проверенный только
 * правами, отвечает на вопрос «поменяли ли мы девять бит», а обещание обвеса
 * другое — «этот файл можно выполнить». Между этими двумя ответами и живёт
 * разница, ради которой всё затевалось (`tasker:BASER2-208`): человек упирается
 * не в неверную маску, а в `Permission denied`. Поэтому проба берёт положенный
 * файл и выполняет его — операционной системой, а не рассуждением.
 *
 * Второе утверждение — про соседей: сегодняшние артефакты бита не получили.
 * Молчание обвеса про режим и его `executable: false` — разные вещи, и первое
 * обязано оставить файл ровно таким, каким он лежал бы вчера.
 *
 * ── ВТОРОЕ ЗВЕНО: РЕЖИМ БЕЗ ЗАПИСИ (`tasker:BASER2-223`) ────────────────────
 *
 * Паспорт укладки помнит теперь и то, ЧТО BASER СДЕЛАЛ с файлом (`kb:BASER3-36`),
 * поэтому расхождение бывает только по биту — шаг `chmod`, у которого содержимого
 * нет вовсе. Пробы на него ниже, и они строят состояние, которого в этой зоне
 * само не бывает: паспорт всегда пишется тем же прогоном, который кладёт файл, и
 * расхождению взяться неоткуда. Значит зелёная зона тут не доказывает ничего —
 * каждая проба подделывает состояние руками: правит паспорт, объявление или бит.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_PATH } from '@omnifield/baser-materialize';
import {
  installDevbox,
  DEVBOX_PACKAGE,
  type Consumer,
  type InstalledSource,
  type SourceSpec,
} from './devbox.fixture.js';
import { streamsSealed } from './sealed.fixture.js';
import { run } from './run.js';
import type { DoorResult } from './result.js';

const HOOKS_PACKAGE = '@omnifield/brain-harness';
const HOOKS_ID = 'omnifield/agent-harness';

/** Артефакт-программа: шебанг есть, значит обещан ЗАПУСК напрямую. */
const HOOK = '.claude/hooks/greet.sh';
/** Сосед по обвесу, про режим которого не сказано ничего. */
const NOTE = '.claude/hooks/README.md';
/** Артефакт девбокса — сегодняшняя раскладка, про режим не говорящая. */
const DEVCONTAINER = '.devcontainer/devcontainer.json';

const GREETING = 'обвес поздоровался';

/**
 * Обвес с хуком: один артефакт объявлен программой, второй — ничем.
 *
 * Раскладка настоящая по форме — то же поле `executable`, которое читает форма
 * у живого обвеса. Ни подмен, ни обходов: проба врёт ровно настолько, насколько
 * врёт `installSource` всем остальным пробам этой зоны.
 */
const HOOKS: SourceSpec = {
  packageName: HOOKS_PACKAGE,
  id: HOOKS_ID,
  title: 'Плагин агент-харнесса',
  layout: [
    { src: 'greet.sh', dest: HOOK, render: false, executable: true },
    { src: 'README.md', dest: NOTE, render: false },
  ],
  templates: {
    'greet.sh': `#!/bin/sh\necho "${GREETING}"\n`,
    'README.md': 'просто данные\n',
  },
};

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/**
 * Репозиторий с девбоксом и обвесом хуков — оба объявлены в перечне.
 *
 * `program: false` — тот же обвес, но про режим хука он МОЛЧИТ. Нужен, чтобы
 * построить локацию, разложенную до формы 6: файл лежит, бита нет, следа в
 * паспорте нет.
 */
function withHooks(options: { program?: boolean } = {}): {
  box: Consumer;
  hooks: InstalledSource;
} {
  consumer = installDevbox({
    config: {
      formVersion: 2,
      sources: [{ use: DEVBOX_PACKAGE }, { use: HOOKS_PACKAGE }],
    },
  });
  const spec =
    options.program === false
      ? {
          ...HOOKS,
          layout: HOOKS.layout.map(({ executable: _drop, ...rest }) => rest),
        }
      : HOOKS;
  return { box: consumer, hooks: consumer.installSource(spec) };
}

/** Переобъявляет режим хука в установленном обвесе — «обвес обновился». */
function declareProgram(hooks: InstalledSource, executable: boolean): void {
  hooks.updateSource((block) => {
    const layout = block['layout'] as { dest: string; executable?: boolean }[];
    const entry = layout.find((item) => item.dest === HOOK);
    if (entry === undefined) {
      throw new Error(`в раскладке пробы нет записи "${HOOK}"`);
    }
    entry.executable = executable;
  });
}

/** Паспорт укладки как есть — сырым JSON, а не разобранным. */
function passportOf(box: Consumer): { version: number; artifacts: unknown[] } {
  const raw = box.read(MANIFEST_PATH);
  if (raw === null) {
    throw new Error(`паспорта укладки "${MANIFEST_PATH}" нет`);
  }
  return JSON.parse(raw) as { version: number; artifacts: unknown[] };
}

/** Права файла на диске — те самые девять бит. */
function rights(box: Consumer, path: string): number {
  return statSync(join(box.root, path)).mode & 0o777;
}

function runnable(box: Consumer, path: string): boolean {
  return (rights(box, path) & 0o111) !== 0;
}

/** Что сказал движок про режим — событие его трейса, а не наше. */
function modeEvent(result: DoorResult): Record<string, unknown> | undefined {
  const applied = result.runs.find(
    (item) => item.source.id === HOOKS_ID,
  )?.applied;
  return applied?.trace.find((span) => span.name === 'apply.executable')
    ?.detail;
}

describe('объявленный программой артефакт ЛОЖИТСЯ ПРОГРАММОЙ', () => {
  it('файл с битом — и он ЗАПУСКАЕТСЯ', async () => {
    const { box } = withHooks();

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('applied');
    expect(runnable(box, HOOK)).toBe(true);

    // ЕДИНСТВЕННАЯ проверка, которая ловит разницу между «бит выставлен» и
    // «работает»: файл выполняется операционной системой как программа.
    const ran = streamsSealed(join(box.root, HOOK), [], { cwd: box.root });
    expect(ran.status).toBe(0);
    expect(ran.stdout.trim()).toBe(GREETING);
  });

  it('движок теперь рассказывает о консоли другое: порт режим ПРИНИМАЕТ', async () => {
    const { box } = withHooks();

    const result = await run({ command: 'apply', ...box.door });

    // Член порта необязателен, и его наличие движок ВИДИТ: до этой работы он
    // говорил про консоль `blind` — объявленное до диска не доезжало.
    expect(modeEvent(result)).toEqual({
      declared: 1,
      delivered: 1,
      port: 'accepts',
    });
  });

  it('сегодняшние артефакты бита НЕ получили — ни свои, ни соседние', async () => {
    const { box } = withHooks();

    await run({ command: 'apply', ...box.door });

    // Сосед по той же раскладке: про его режим обвес не сказал ничего.
    expect(runnable(box, NOTE)).toBe(false);
    // И весь остальной сегодняшний мир — раскладка девбокса, которая про режим
    // не говорит вовсе.
    expect(runnable(box, DEVCONTAINER)).toBe(false);
  });
});

describe('бит переживает повторные прогоны', () => {
  it('второй прогон сошёлся, а файл остался программой', async () => {
    const { box } = withHooks();
    await run({ command: 'apply', ...box.door });

    const again = await run({ command: 'apply', ...box.door });

    // Сошлось ЦЕЛИКОМ: и содержимое, и режим — работы нет.
    expect(again.status).toBe('converged');
    expect(runnable(box, HOOK)).toBe(true);
  });

  it('объявлено данными, бит НАШ по паспорту — снят, и файл не переписан', async () => {
    const { box, hooks } = withHooks();
    await run({ command: 'apply', ...box.door });
    expect(runnable(box, HOOK)).toBe(true);
    const before = statSync(join(box.root, HOOK)).mtimeMs;

    // Обвес передумал: тот же артефакт объявлен данными. Бит наш — снимаем.
    declareProgram(hooks, false);

    const again = await run({ command: 'apply', ...box.door });

    expect(again.status).toBe('applied');
    expect(
      again.writes.some(
        (write) => write.path === HOOK && write.kind === 'CHMOD',
      ),
    ).toBe(true);
    expect(runnable(box, HOOK)).toBe(false);
    // Содержимое не менялось — и не переписано: у шага `chmod` содержимого нет.
    expect(statSync(join(box.root, HOOK)).mtimeMs).toBe(before);

    // Починенное сходится: лишнего шага следующий прогон не делает.
    expect((await run({ command: 'apply', ...box.door })).status).toBe(
      'converged',
    );
  });

  /**
   * ЗАМЕР, А НЕ ОБЕЩАНИЕ: бит, сбитый на ДИСКЕ, прогон не возвращает.
   *
   * Расхождение движок считает парой «объявлено × след в паспорте», и режим
   * лежащего файла в эту пару не входит — прочитать его портом нечем
   * (`packages/baser-materialize/src/lib/tree.ts`: шесть методов плюс
   * `setExecutable`, читающего режим члена нет). Значит на сбитом бите план
   * пуст, шага `chmod` не рождается, и консоли нечего исполнять: своего мнения
   * о том, каким должен быть режим, у неё нет и быть не должно.
   *
   * Это ВТОРАЯ половина `tasker:BASER2-221` («артефакт, у которого бит сбился,
   * восстановлен не будет»), и она открыта: `tasker:BASER2-222` закрыл первую —
   * расхождение объявления с паспортом. Живой прецедент у второй свой и тот же:
   * правка через `\\wsl.localhost` сбивала бит отслеживаемым `.sh`
   * (`tasker:BASER2-190`).
   *
   * Проба стоит здесь СТОРОЖЕМ, а не одобрением: закроется шов — она покраснеет
   * и потребует переписать себя вместе с ограничением в `README.md`.
   */
  it('ОГРАНИЧЕНИЕ: сбитый на диске бит не возвращается — движку он не виден', async () => {
    const { box } = withHooks();
    await run({ command: 'apply', ...box.door });

    // Ровно то состояние, ради которого шов затевался, — и единственное, до
    // которого он пока не достаёт.
    chmodSync(join(box.root, HOOK), 0o644);

    const again = await run({ command: 'apply', ...box.door });

    expect(again.status).toBe('converged');
    expect(runnable(box, HOOK)).toBe(false);
  });

  it('объявлено данными, СЛЕДА НЕТ — чужой бит не тронут вовсе', async () => {
    // Инвариант `kb:BASER3-36` §2: baser никогда не снимает бит, которого не
    // записал, что ставил. Живой случай — файл с шебангом, которому бит выставил
    // человек руками; симметричное правило снесло бы его молча.
    const { box } = withHooks();
    await run({ command: 'apply', ...box.door });

    chmodSync(join(box.root, NOTE), 0o755);

    const again = await run({ command: 'apply', ...box.door });

    expect(again.status).toBe('converged');
    expect(runnable(box, NOTE)).toBe(true);
  });

  it('ЖИВОЙ СЛУЧАЙ: паспорт формы 2 + обвес объявил программу — бит появляется', async () => {
    // Локация, разложенная до формы 6: файл лежит, бита нет, поля в паспорте
    // нет. Ровно она и роняла прогон — движок рождал шаг, которого дерево не
    // знало.
    const { box, hooks } = withHooks({ program: false });
    await run({ command: 'apply', ...box.door });
    expect(runnable(box, HOOK)).toBe(false);

    const passport = passportOf(box);
    expect(passport.version).toBe(3);
    box.write(
      MANIFEST_PATH,
      `${JSON.stringify({ ...passport, version: 2 }, null, 2)}\n`,
    );

    // Обвес обновился и объявил хук программой. Содержимое при этом то же.
    declareProgram(hooks, true);
    const before = statSync(join(box.root, HOOK)).mtimeMs;

    const again = await run({ command: 'apply', ...box.door });

    expect(again.status).toBe('applied');
    expect(
      again.writes.some(
        (write) => write.path === HOOK && write.kind === 'CHMOD',
      ),
    ).toBe(true);
    expect(runnable(box, HOOK)).toBe(true);
    // Содержимое не переписано: сошлось, переписывать нечего.
    expect(statSync(join(box.root, HOOK)).mtimeMs).toBe(before);
    // И файл ЗАПУСКАЕТСЯ — предмет починки, а не девять бит.
    expect(
      streamsSealed(join(box.root, HOOK), [], { cwd: box.root }).stdout.trim(),
    ).toBe(GREETING);

    // Второй прогон сходится: приведение бита разовое, а не на каждый запуск.
    expect((await run({ command: 'apply', ...box.door })).status).toBe(
      'converged',
    );
  });

  it('перекладка по новому шаблону бит не теряет', async () => {
    const { box, hooks } = withHooks();
    await run({ command: 'apply', ...box.door });

    // Обвес обновился: тело хука другое. Перегенерация кладёт новое содержимое —
    // и обязана положить его такой же программой, а не обычным файлом.
    hooks.writeTemplate('greet.sh', `#!/bin/sh\necho "${GREETING} снова"\n`);

    const again = await run({ command: 'apply', ...box.door });

    expect(again.status).toBe('applied');
    expect(runnable(box, HOOK)).toBe(true);
    expect(
      streamsSealed(join(box.root, HOOK), [], { cwd: box.root }).stdout.trim(),
    ).toBe(`${GREETING} снова`);
  });
});
