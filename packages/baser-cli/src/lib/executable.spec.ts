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
 */

import { afterEach, describe, expect, it } from 'vitest';
import { statSync } from 'node:fs';
import { join } from 'node:path';
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

/** Репозиторий с девбоксом и обвесом хуков — оба объявлены в перечне. */
function withHooks(): { box: Consumer; hooks: InstalledSource } {
  consumer = installDevbox({
    config: {
      formVersion: 2,
      sources: [{ use: DEVBOX_PACKAGE }, { use: HOOKS_PACKAGE }],
    },
  });
  return { box: consumer, hooks: consumer.installSource(HOOKS) };
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
