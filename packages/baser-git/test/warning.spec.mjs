/**
 * ПРИЁМКА `tasker:BASER2-235` — ОБВЕС ГОВОРИТ СВОЁ СЛОВО ПРО `core.hooksPath`.
 *
 * Механизм второй громкости построен тремя зонами и выпущен: форма объявила поле
 * (`baser-contracts`, `warning.ts`), движок несёт его планом, консоль печатает.
 * Пока обвес поля не объявлял, шов был декоративен — человек в живой локации не
 * слышал ничего, ровно как до всей работы.
 *
 * ## Судится ЖИВЫМ случаем, а не наличием поля
 *
 * Поле можно объявить и промолчать, текст можно напечатать и соврать. Поэтому
 * здесь настоящий `git init`, настоящий `git config core.hooksPath`, обвес из
 * ТАРБОЛА и дверь, вызванная своей argv-поверхностью, — то есть с текстом,
 * который увидит человек, и кодом, который увидит конвейер.
 *
 * Главное утверждение зоны — не строка в выводе, а то, что **строка не врёт**:
 * в той же локации красное дерево проезжает коммитом БЕЗ проверки, потому что
 * положенный хук мёртв. Это и есть предмет предупреждения, и меряется он
 * вердиктом git'а, как и вся приёмка хука (`hook.spec.mjs`).
 *
 * ## Что здесь сторожится, а не подразумевается
 *
 * 1. **Прогон остаётся успешным.** Предупреждение не отказ: код возврата 0,
 *    `problems` пуст, артефакты легли.
 * 2. **Тишина там, где сказать нечего.** Настройки нет, настройка указывает
 *    туда же, куда кладём, — ни строки лишней. Предупреждение, которое видит
 *    каждый, за неделю перестают читать.
 * 3. **Спрашивается САМ git, а не `.git/config`.** Настройка, приехавшая через
 *    `include`, в файле локации не лежит, а git её слушается — то же и с
 *    глобальной. Проба красит любую попытку заменить вопрос разбором INI.
 * 4. **Чужой `GIT_DIR` в окружении не подменяет ответ.** Случай наш
 *    собственный: положенный хук гоняет команду готовности с выставленным
 *    `GIT_DIR`, и прогон двери из-под хука спросил бы не про ту локацию.
 * 5. **Резолвер не падает и не врёт в странных условиях** — их четыре, и все
 *    нормальные: нет git, нет настройки, `.git` не репозиторий, обстановки нет
 *    вовсе.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { soleRun } from '../../baser-cli/src/index.ts';
import {
  HOOK,
  initGit,
  installConsumer,
  packedRoot,
  run,
  runCli,
  tryCommit,
} from './packed.mjs';

let consumer = null;
/** git локации, поднятой пробой: им же она и донастраивается по ходу. */
let git = null;
const strangers = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  git = null;
  for (const root of strangers.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Каталог, в который локация уводит git настройкой. Пустой: хуков там нет. */
const ELSEWHERE = '.githooks';

/** Команда готовности локации — ею и двигается вердикт коммита. */
const READINESS = 'sh ./readiness.sh';

/**
 * Локация с настоящим git, поставленным обвесом и названной готовностью.
 *
 * `hooksPath: null` — настройки нет вовсе: так локация выглядит сразу после
 * `git init`, и это тот случай, в котором обвес обязан молчать.
 */
function locality({ hooksPath = null, ready = false } = {}) {
  consumer = installConsumer({
    tuning: { settings: { verifyCommand: READINESS } },
    existing: {
      '.gitignore': 'node_modules/\n',
      'readiness.sh': `exit ${ready ? 0 : 1}\n`,
    },
  });
  git = initGit(consumer.root);
  if (hooksPath !== null) {
    git('config', 'core.hooksPath', hooksPath);
  }
  return consumer;
}

/**
 * Ещё один настоящий репозиторий РЯДОМ — тот, про который нас спросить не
 * просили.
 *
 * Нужен ровно затем, чтобы `GIT_DIR` было чем подменить: подмена окружения
 * изображается настоящим чужим репозиторием, а не выдуманным путём, иначе git
 * ответил бы отказом вместо чужой правды, и проба зеленела бы даром.
 */
function stranger(hooksPath) {
  const root = mkdtempSync(join(tmpdir(), 'baser-git-stranger-'));
  strangers.push(root);
  const git = initGit(root);
  if (hooksPath !== null) {
    git('config', 'core.hooksPath', hooksPath);
  }
  return root;
}

/** Прогон с временно подменённой переменной окружения — и она возвращается. */
async function withEnv(name, value, body) {
  const before = process.env[name];
  process.env[name] = value;
  try {
    return await body();
  } finally {
    if (before === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = before;
    }
  }
}

/** Предупреждение прогона — из машинного ответа, а не из текста. */
function warningOf(result) {
  return soleRun(result).plan?.warning;
}

/** Резолвер, загруженный ИЗ ТАРБОЛА: тот файл, который приедет потребителю. */
async function resolver() {
  return import(pathToFileURL(join(packedRoot(), 'warning.mjs')).href);
}

describe('ПРИЁМКА: локация с core.hooksPath СЛЫШИТ обвес', () => {
  it('человек видит слово обвеса, а прогон остаётся успешным', async () => {
    const box = locality({ hooksPath: ELSEWHERE });

    const outcome = await runCli(box.root, ['apply']);

    // Прогон верный: предупреждение не отказ и кода возврата не меняет.
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.kind).toBe('door');
    const door = outcome.result.door;
    expect(door.status).toBe('applied');
    expect(door.problems).toEqual([]);
    // Артефакт лёг: обвес сделал свою работу целиком, а сказал про обстановку.
    expect(box.exists(HOOK)).toBe(true);

    // Жанр — тот, где консоль говорит, чего не сделает сама, и слово названо
    // именем обвеса: чьё оно, читается из строки, а не из расстояния до
    // заголовка выше.
    expect(outcome.stdout).toContain('остаётся человеку');
    expect(outcome.stdout).toContain('говорит САМ обвес "omnifield/git"');
    // В тексте — и настройка, и её значение, и адрес, куда мы положили: без них
    // человеку некуда идти.
    expect(outcome.stdout).toContain('core.hooksPath');
    expect(outcome.stdout).toContain(`"${ELSEWHERE}"`);
    expect(outcome.stdout).toContain('.git/hooks/pre-commit');
  });

  it('и слово НЕ ВРЁТ: в этой локации красное дерево проезжает коммитом', async () => {
    const box = locality({ hooksPath: ELSEWHERE, ready: false });

    const outcome = await runCli(box.root, ['apply']);

    expect(warningOf(outcome.result.door).kind).toBe('said');
    // Вот предмет предупреждения целиком. Та же локация без настройки коммит
    // отвергает (`hook.spec.mjs`), а здесь машина мертва — и обвес про это
    // сказал, вместо того чтобы промолчать или уронить прогон.
    expect(tryCommit(box.root, 'chore: мимо мёртвого хука').committed).toBe(
      true,
    );
  });

  it('машинный ответ несёт то же — разбором, а не поиском фразы', async () => {
    const box = locality({ hooksPath: ELSEWHERE });

    const outcome = await runCli(box.root, ['plan', '--json']);

    expect(outcome.exitCode).toBe(0);
    const answer = JSON.parse(outcome.stdout);
    const warning = warningOf(answer);
    expect(warning.kind).toBe('said');
    expect(warning.text).toContain(ELSEWHERE);
    expect(warning.text).toContain('core.hooksPath');
  });

  it('называет ФАЙЛ, где настройка написана, — иначе снимать её негде', async () => {
    const box = locality({ hooksPath: ELSEWHERE });

    const result = await run({ command: 'plan', cwd: box.root });

    // Человек с ГЛОБАЛЬНОЙ настройкой пойдёт снимать её в локации, ничего не
    // добьётся и решит, что мы соврали. Поэтому в тексте стоит адрес, который
    // назвал сам git, а не догадка про `.git/config`.
    expect(warningOf(result).text).toContain('.git/config');
  });
});

describe('тишина там, где сказать нечего', () => {
  it('настройки нет — ни строки лишней', async () => {
    const box = locality();

    const outcome = await runCli(box.root, ['apply']);

    expect(warningOf(outcome.result.door)).toEqual({ kind: 'none' });
    expect(outcome.stdout).not.toContain('core.hooksPath');
    expect(outcome.stdout).not.toContain('говорит САМ обвес');
  });

  it('настройка указывает ТУДА ЖЕ, куда кладём, — молчим', async () => {
    const box = locality({ hooksPath: '.git/hooks' });

    const result = await run({ command: 'plan', cwd: box.root });

    // Названный явно наш же каталог ничего не ломает: git смотрит туда, куда и
    // смотрел бы сам.
    expect(warningOf(result)).toEqual({ kind: 'none' });
  });

  it('тот же каталог АБСОЛЮТНЫМ путём — тоже молчим', async () => {
    const box = locality();
    git('config', 'core.hooksPath', join(box.root, '.git', 'hooks'));

    const result = await run({ command: 'plan', cwd: box.root });

    // Сравниваются КАТАЛОГИ, а не строки: иначе человек, написавший тот же путь
    // иначе, получал бы предупреждение про несуществующее расхождение.
    expect(warningOf(result)).toEqual({ kind: 'none' });
  });
});

describe('спрашивается сам git, а не файл локации', () => {
  it('настройка из ВКЛЮЧАЕМОГО файла слышна — её нет в .git/config', async () => {
    const box = locality();
    box.write('extra.cfg', `[core]\n\thooksPath = ${ELSEWHERE}\n`);
    git('config', 'include.path', '../extra.cfg');

    const result = await run({ command: 'plan', cwd: box.root });

    // Своего разбора INI хватило бы ровно до этой пробы — и промолчало бы. То же
    // молчание даёт глобальная и системная настройка, которым git подчиняется
    // так же; правда о конфиге одна, и она у git'а.
    expect(existsSync(join(box.root, '.git', 'config'))).toBe(true);
    expect(box.read('.git/config')).not.toContain('hooksPath');
    expect(warningOf(result).kind).toBe('said');
  });

  it('чужой GIT_DIR в окружении не превращается в ответ про чужой репозиторий', async () => {
    const box = locality();
    const alien = stranger(ELSEWHERE);

    const result = await withEnv(
      'GIT_DIR',
      join(alien, '.git'),
      async () => await run({ command: 'plan', cwd: box.root }),
    );

    // Живой случай: положенный этим обвесом хук гоняет команду готовности с
    // выставленным git'ом `GIT_DIR`. Резолвер, унаследовавший окружение, сказал
    // бы про ЧУЖУЮ локацию и не признался бы в этом.
    expect(warningOf(result)).toEqual({ kind: 'none' });
  });

  it('и не глушит СВОЁ предупреждение, когда чужой репозиторий чист', async () => {
    const box = locality({ hooksPath: ELSEWHERE });
    const alien = stranger(null);

    const result = await withEnv(
      'GIT_DIR',
      join(alien, '.git'),
      async () => await run({ command: 'plan', cwd: box.root }),
    );

    // Обратная сторона той же чистки: подмена не только не подсовывает чужое,
    // но и не отнимает своё.
    expect(warningOf(result).kind).toBe('said');
  });
});

describe('резолвер в странных условиях не падает и не врёт', () => {
  it('локация без git — молчит, и не спрашивает никого', async () => {
    consumer = installConsumer();

    const result = await run({ command: 'plan', cwd: consumer.root });

    // Глобальная настройка есть у половины машин, а хука, который она гасит,
    // здесь нет вовсе: говорить о ней значило бы пугать человека тем, что его
    // не касается.
    expect(warningOf(result)).toEqual({ kind: 'none' });
  });

  it('обстановка без корня и `.git`, который не репозиторий, — пустота', async () => {
    const { hooksPath } = await resolver();
    const broken = mkdtempSync(join(tmpdir(), 'baser-git-broken-'));
    strangers.push(broken);
    writeFileSync(join(broken, '.git'), 'gitdir: /этого-каталога-нет\n');

    // Всё это — обстановка, а не беда: судится ЗДЕСЬ, а не прогоном двери,
    // потому что в такую локацию не лёг бы и сам артефакт, и проба мерила бы
    // укладку вместо слова.
    expect(hooksPath({ repo: { root: broken } })).toBeNull();
    expect(hooksPath({ repo: { root: '' } })).toBeNull();
    expect(hooksPath({ repo: {} })).toBeNull();
    expect(hooksPath({})).toBeNull();
    expect(
      hooksPath({ repo: { root: join(tmpdir(), 'нет-такого-каталога') } }),
    ).toBeNull();
  });

  it('ответ СИНХРОННЫЙ — обещание дверь ждать нечем', async () => {
    const { hooksPath } = await resolver();
    const box = locality({ hooksPath: ELSEWHERE });

    const said = hooksPath({ repo: { root: box.root } });

    // Форма требует синхронности прямо: предупреждение считается вместе с
    // планом, до применения. Обещание здесь стало бы отказом `resolver-async`.
    expect(typeof said).toBe('string');
    expect(said).not.toBeInstanceOf(Promise);
  });

  it('адрес хука в тексте — тот же, что в раскладке объявления', async () => {
    const { HOOK_DEST } = await resolver();

    // Два места для одного факта держит эта проба: назвать в тексте не тот
    // файл, который кладём, — соврать человеку адресом, и соврать молча.
    expect(HOOK_DEST).toBe(HOOK);
  });
});
