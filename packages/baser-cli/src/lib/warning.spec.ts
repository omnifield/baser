/**
 * ПРИЁМКА `tasker:BASER2-234` — КОНСОЛЬ ПЕЧАТАЕТ ПРЕДУПРЕЖДЕНИЕ ОБВЕСА.
 *
 * Последнее звено шва `tasker:BASER2-226`: форма объявила поле и разбирает
 * ответ резолвера (`baser-contracts`, `warning.ts`), движок несёт посчитанное
 * планом (`baser-materialize`, `warning.ts`), консоль ГРУЗИТ резолвер, зовёт его
 * и печатает. После него шов закрыт.
 *
 * Судится он целиком и снаружи: настоящий пакет обвеса на настоящем диске,
 * настоящий `import()` его модуля, прогон зовётся публичной поверхностью
 * (`cli` / `run`), файлы уезжают на настоящую ФС. Проба, подменившая хоть одно
 * из трёх, проверяла бы не консоль.
 *
 * ## Три вещи, которые здесь сторожатся, а не подразумеваются
 *
 * 1. **Прогон остаётся успешным.** Предупреждение не меняет кода возврата — ни
 *    одно, ни два, ни упавшее. Судится это КОДОМ ПРОЦЕССА, а не статусом:
 *    статус читает гейт, а человек и конвейер видят число.
 * 2. **Упавший резолвер не роняет прогон** — приезжает данными (`failed`) и
 *    печатается бедой обстановки. Проглотить его нельзя тем более: автор обвеса
 *    считал бы, что предупреждение работает, а оно молчит.
 * 3. **`--json` несёт то же самое** (`kb:BASER3-33`): способность обязана быть
 *    видима обоим читателям, человеку и агенту. Судится РАЗБОРОМ ответа, а не
 *    поиском фразы в тексте.
 *
 * ## Живой случай мерится ЖИВЫМ, а не изображается
 *
 * Ради него всё и затевалось (`tasker:BASER2-208`): локация с заданным
 * `core.hooksPath` получает хук в `.git/hooks` — он ляжет верно и не сработает,
 * потому что git смотрит в другой каталог. Поэтому в блоке ниже настоящий
 * `git init`, настоящий `git config`, а резолвер обвеса читает то, что тот
 * записал в репозиторий. Тот же резолвер в локации без настройки молчит: это и
 * есть доказательство, что предупреждение смотрит на посадочное место, а не
 * печатает заготовку.
 *
 * ## Обвес здесь свой — и уже не потому, что живому нечего сказать
 *
 * Поле живой `@omnifield/baser-git` объявляет с `tasker:BASER2-235` (форма 7,
 * `warningFrom`), и живой случай целиком судит ЕГО собственная проба
 * (`packages/baser-git`, `test/warning.spec.mjs`) — через ту же argv-поверхность
 * консоли, что и здесь.
 *
 * Предмет тут другой: судится КОНСОЛЬ, а ей нужен обвес, которым распоряжается
 * проба, — молчащий, говорящий, бросающий, с пропавшим модулем и второй такой же
 * рядом. Живой резолвер один и отвечает по обстановке: половины этих случаев он
 * не изобразит вовсе, зато принесёт своё — вторую сборку тарбола в каждый прогон
 * зоны (`packed.setup.ts`) и красное ЗДЕСЬ на каждом выпуске чужой зоны, где
 * консоль не менялась. Поэтому проба повторяет его ФИГУРУ (хук в `.git/hooks`,
 * `executable: true`), а не подделывает его личность.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installDevbox,
  type Consumer,
  type InstalledSource,
} from './devbox.fixture.js';
import { gitSealed } from './sealed.fixture.js';
import { cli } from './cli.js';
import { run } from './run.js';
import { soleRun, type DoorResult, type SourceRun } from './result.js';

const HOOKS_PACKAGE = '@omnifield/probe-git';
const HOOKS_ID = 'probe/git';
const AGENTS_PACKAGE = '@omnifield/probe-agents';
const AGENTS_ID = 'probe/agents';

/** Хук ложится туда же, куда его кладёт настоящий git-обвес. */
const HOOK = '.git/hooks/pre-commit';

const SAID = 'хук ляжет, но не сработает — проверь настройку';

/** Резолвер, которому есть что сказать всегда: обстановку он не спрашивает. */
const SAYS = (text: string): string => `
export function hooks() { return ${JSON.stringify(text)}; }
`;

/** Резолвер, у которого не выходит: бросок — законный конец чужого кода. */
const THROWS = `
export function hooks() { throw new Error('git не нашёлся'); }
`;

/**
 * Резолвер ЖИВОГО случая: читает НАСТОЯЩУЮ запись настоящего репозитория.
 *
 * Синхронный и без сети — ровно то, чего форма требует от резолвера. Смотреть
 * на посадочное место ему не только можно, но и НУЖНО: ради этого поле и
 * заведено (`baser-contracts`, `warning.ts`).
 *
 * **Настройку кладёт настоящий `git config`** (см. `gitLocation` ниже), а
 * резолвер читает то, что тот записал. Своего `git` он при этом не запускает — в
 * отличие от живого обвеса, который спрашивает именно `git config` и ради этого
 * снимает из окружения весь префикс `GIT_` (`baser-git`, `warning.mjs`).
 * Повторять его чистку здесь незачем: верна она или нет — свойство ТОГО
 * резолвера, и судит его его зона. А обойтись без неё нельзя: резолвер
 * исполняется ВНУТРИ процесса прогона, то есть унаследовал бы окружение пробы
 * целиком, и вложенный `git` ушёл бы по адресу из `GIT_DIR` в НАШ репозиторий —
 * ровно тот случай, из-за которого у этой зоны нет своего входа к процессам
 * (`sealed.fixture.ts`, `tasker:BASER2-179`).
 */
const ASKS_GIT = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function hooks(ctx) {
  let config = '';
  try {
    config = readFileSync(join(ctx.repo.root, '.git', 'config'), 'utf-8');
  } catch {
    return null;
  }

  const found = /^\\s*hooksPath\\s*=\\s*(.+)$/m.exec(config);
  if (found === null) {
    return null;
  }

  return (
    'хук лёг в ".git/hooks", а git этой локации смотрит в "' + found[1].trim() +
    '" (core.hooksPath) — сработать он не сможет.\\n' +
    'Перенеси его туда либо сними настройку: "git config --unset core.hooksPath".'
  );
}
`;

const boxes: Consumer[] = [];

afterEach(() => {
  for (const box of boxes.splice(0)) {
    box.cleanup();
  }
});

/** Локация с девбоксом; девбокс про предупреждение молчит и молчать обязан. */
function consumer(): Consumer {
  const box = installDevbox();
  boxes.push(box);
  return box;
}

/** Ставит обвес фигуры git-обвязки: хук-программа плюс, если дано, слово про неё. */
function installHooks(
  box: Consumer,
  options: {
    readonly packageName?: string;
    readonly id?: string;
    readonly resolver?: string;
    readonly dest?: string;
  } = {},
): InstalledSource {
  const source = box.installSource({
    packageName: options.packageName ?? HOOKS_PACKAGE,
    id: options.id ?? HOOKS_ID,
    title: 'Машинный pre-commit локации',
    layout: [
      {
        src: 'pre-commit.sh',
        dest: options.dest ?? HOOK,
        executable: true,
        // Подставлять в хук нечего: настроек обвес не объявляет, и запись про
        // это сказано прямо — иначе форма справедливо отвергнет шаблон без
        // единого тега.
        render: false,
      },
    ],
    templates: { 'pre-commit.sh': '#!/bin/sh\nexit 0\n' },
  });

  if (options.resolver !== undefined) {
    // Модуль кладётся в САМ пакет обвеса и грузится обычным `import()` — как у
    // резолверов дефолтов. Имя своё, а не `defaults.mjs`: обещания разные, и
    // складывать их в один файл значило бы стирать различение прямо в фикстуре.
    writeFileSync(join(source.root, 'warnings.mjs'), options.resolver);
    source.updateSource((block) => {
      block['warningFrom'] = './warnings.mjs#hooks';
    });
  }

  return source;
}

/** Прогон публичной поверхностью — с кодом возврата, который увидит конвейер. */
async function apply(
  box: Consumer,
  ...flags: readonly string[]
): Promise<{ stdout: string; exitCode: number; door: DoorResult }> {
  const outcome = await cli(
    ['apply', '--cwd', box.root, ...box.doorArgs(), ...flags],
    process.cwd(),
  );
  if (outcome.result?.kind !== 'door') {
    throw new Error(`ожидался прогон двери, а пришло ${outcome.result?.kind}`);
  }
  return {
    stdout: outcome.stdout,
    exitCode: outcome.exitCode,
    door: outcome.result.door,
  };
}

function runOf(door: DoorResult, id: string): SourceRun {
  const found = door.runs.find((item) => item.source.id === id);
  if (found === undefined) {
    throw new Error(
      `прогона обвеса "${id}" в ответе нет: ${door.runs
        .map((item) => item.source.id)
        .join(' · ')}`,
    );
  }
  return found;
}

describe('обвесу есть что сказать', () => {
  it('печатает его слово и оставляет прогон успешным', async () => {
    const box = consumer();
    installHooks(box, { resolver: SAYS(SAID) });

    const { stdout, exitCode, door } = await apply(box);

    // ГЛАВНОЕ УТВЕРЖДЕНИЕ ЗДЕСЬ — код возврата, а не наличие строки. Прогон
    // верный: обвес сказал человеку, а не отказал локации.
    expect(exitCode).toBe(0);
    expect(door.status).toBe('applied');
    expect(door.problems).toEqual([]);

    // Жанр прежний — тот, где консоль говорит, чего не сделает сама.
    expect(stdout).toContain('остаётся человеку');
    // Слово обвеса приезжает ДОСЛОВНО и названо его именем: чьё оно, читается
    // из самой строки, а не из расстояния до заголовка выше.
    expect(stdout).toContain(`говорит САМ обвес "${HOOKS_ID}"`);
    expect(stdout).toContain(SAID);

    // Итоговая строка ссылается на блок ровно тогда, когда блок ЕСТЬ. Прежде
    // условие у неё было уже — только переписывание лежащего артефакта, — и
    // ссылка на несуществующий блок отправила бы человека искать выше то, чего
    // там нет.
    expect(stdout.trimEnd().endsWith('названо выше — "остаётся человеку"')).toBe(
      true,
    );
  });

  it('несёт его и в машинный ответ — тем же прогоном', async () => {
    const box = consumer();
    installHooks(box, { resolver: SAYS(SAID) });

    const outcome = await cli(
      ['plan', '--cwd', box.root, ...box.doorArgs(), '--json'],
      process.cwd(),
    );

    // Судится РАЗБОРОМ, а не подстрокой: пульт и агент читают поле, а не текст.
    const answer = JSON.parse(outcome.stdout) as DoorResult;
    const hooks = runOf(answer, HOOKS_ID);
    expect(hooks.plan?.warning).toEqual({ kind: 'said', text: SAID });
    expect(outcome.exitCode).toBe(0);
  });

  it('на первой укладке тоже — предмет есть, хотя переписывать нечего', async () => {
    const box = consumer();
    installHooks(box, { resolver: SAYS(SAID) });

    const { stdout, door } = await apply(box);

    // Ни одного шага `diverged`: это первая укладка, и прежняя половина блока
    // («пересоздай контейнер») молчит по построению. Слово обвеса при этом
    // напечатано — условия у половин свои.
    expect(
      runOf(door, HOOKS_ID).plan?.steps.every(
        (step) => step.reason !== 'diverged',
      ),
    ).toBe(true);
    expect(stdout).toContain(SAID);
    expect(stdout).not.toContain('пересоздаёшь ты');
  });
});

describe('обвес молчит', () => {
  it('не добавляет ни строки — и говорит это состоянием, а не пустотой', async () => {
    const box = consumer();
    installHooks(box);

    const { stdout, exitCode, door } = await apply(box);

    expect(exitCode).toBe(0);
    // Названное отсутствие: потребитель ответа не обязан отличать пропущенное
    // поле от молчащего обвеса.
    expect(runOf(door, HOOKS_ID).plan?.warning).toEqual({ kind: 'none' });
    expect(stdout).not.toContain('остаётся человеку');
    expect(stdout).not.toContain('говорит САМ обвес');
  });
});

describe('сказать не вышло', () => {
  it('печатает беду обстановки, а прогон остаётся успешным', async () => {
    const box = consumer();
    installHooks(box, { resolver: THROWS });

    const { stdout, exitCode, door } = await apply(box);

    // Вторая громкость не ведёт себя как первая: упавший резолвер не
    // отказывает — ни кодом возврата, ни статусом, ни списком отказов.
    expect(exitCode).toBe(0);
    expect(door.status).toBe('applied');
    expect(door.problems).toEqual([]);

    const warning = runOf(door, HOOKS_ID).plan?.warning;
    expect(warning?.kind).toBe('failed');
    expect(stdout).toContain('Это беда ОБСТАНОВКИ, а не');
    // Адрес и код печатаются контрактным рендером — второй правды о чужом
    // событии консоль не заводит.
    expect(stdout).toContain(`${HOOKS_ID}.warningFrom`);
    expect(stdout).toContain('[resolver-failed]');
    // И артефакт при этом лёг: беда была у фразы, а не у работы.
    expect(box.exists(HOOK)).toBe(true);
  });

  it('модуля нет вовсе — то же состояние, а не срыв консоли', async () => {
    const box = consumer();
    const source = installHooks(box, { resolver: SAYS(SAID) });
    source.updateSource((block) => {
      block['warningFrom'] = './нет-такого.mjs#hooks';
    });

    const { exitCode, door } = await apply(box);

    expect(exitCode).toBe(0);
    expect(runOf(door, HOOKS_ID).plan?.warning).toMatchObject({
      kind: 'failed',
      problem: { code: 'resolver-failed' },
    });
  });
});

describe('обвесов несколько', () => {
  it('у каждого своё слово, и видно чьё', async () => {
    const box = consumer();
    installHooks(box, { resolver: SAYS('хук про гейт') });
    installHooks(box, {
      packageName: AGENTS_PACKAGE,
      id: AGENTS_ID,
      dest: '.claude/hooks/pre-commit',
      resolver: SAYS('агентам нужна перезагрузка пульта'),
    });

    const { stdout, exitCode, door } = await apply(box);

    expect(exitCode).toBe(0);
    expect(runOf(door, HOOKS_ID).plan?.warning).toEqual({
      kind: 'said',
      text: 'хук про гейт',
    });
    expect(runOf(door, AGENTS_ID).plan?.warning).toEqual({
      kind: 'said',
      text: 'агентам нужна перезагрузка пульта',
    });

    // Считается ЗАГОЛОВОК БЛОКА, а не фраза: то же слово стоит в итоговой
    // строке, которая на блок ссылается, и по нему блоков насчиталось бы больше,
    // чем их есть. Третий обвес — девбокс — молчит, и блока у него нет вовсе.
    expect(stdout.match(/остаётся человеку — консоль/g)).toHaveLength(2);

    // ЧЬЁ ЭТО — судится МЕСТОМ, а не тем, что обе фразы где-то есть: слово
    // обвеса обязано стоять внутри ЕГО прогона, и внутри соседнего его быть не
    // должно. Порядок прогонов при этом не закрепляется — его решает очередь
    // передачи артефактов, а не эта проба.
    const sections = stdout.split(/^обвес: /m).slice(1);
    const sectionOf = (id: string): string => {
      const found = sections.find((section) => section.startsWith(id));
      if (found === undefined) {
        throw new Error(`блока обвеса "${id}" в выводе нет`);
      }
      return found;
    };

    expect(sectionOf(HOOKS_ID)).toContain('хук про гейт');
    expect(sectionOf(HOOKS_ID)).not.toContain('агентам нужна');
    expect(sectionOf(AGENTS_ID)).toContain('агентам нужна перезагрузка пульта');
    expect(sectionOf(AGENTS_ID)).not.toContain('хук про гейт');
    // И каждая строка называет своего обвеса поимённо.
    expect(sectionOf(HOOKS_ID)).toContain(`говорит САМ обвес "${HOOKS_ID}"`);
    expect(sectionOf(AGENTS_ID)).toContain(`говорит САМ обвес "${AGENTS_ID}"`);
  });
});

/**
 * ЖИВОЙ СЛУЧАЙ ЦЕЛИКОМ — тот, ради которого затевался весь шов.
 *
 * Настоящий репозиторий, настоящая настройка, настоящий вопрос к git из
 * резолвера обвеса. Изобразить его подстановкой значило бы проверить нашу
 * догадку о том, что скажет git, — а ломается ровно то, чего мы про него не
 * знаем.
 */
describe('локация с core.hooksPath', () => {
  function gitLocation(hooksPath: string | null): Consumer {
    const box = consumer();
    // Репозиторий и настройка — НАСТОЯЩИЕ, и кладёт их настоящий git. Через
    // фикстуру, а не своим вызовом: у проб этой зоны нет своего входа к
    // процессам, иначе вложенный git уходит работать в наш репозиторий
    // (`tasker:BASER2-179`).
    gitSealed(box.root, 'init', '--quiet');
    if (hooksPath !== null) {
      gitSealed(box.root, 'config', 'core.hooksPath', hooksPath);
    }
    return box;
  }

  it('человек слышит обвес, а хук при этом ложится и прогон верен', async () => {
    const box = gitLocation('.githooks');
    installHooks(box, { resolver: ASKS_GIT });

    const { stdout, exitCode } = await apply(box);

    // Отказывать не за что: работа сделана верно и целиком.
    expect(exitCode).toBe(0);
    expect(box.exists(HOOK)).toBe(true);

    // И человек услышал — с названной причиной и названным адресом, которые
    // знает только обвес.
    expect(stdout).toContain('остаётся человеку');
    expect(stdout).toContain('.githooks');
    expect(stdout).toContain('core.hooksPath');
  });

  it('та же локация без настройки — тот же обвес молчит', async () => {
    const box = gitLocation(null);
    installHooks(box, { resolver: ASKS_GIT });

    const { stdout, exitCode, door } = await apply(box);

    // Резолвер тот же, обвес тот же, изменилась ОБСТАНОВКА — и предупреждения
    // нет. Это и есть доказательство, что оно вычисляется, а не печатается
    // заготовкой всякому, кто поставил обвес.
    expect(exitCode).toBe(0);
    expect(runOf(door, HOOKS_ID).plan?.warning).toEqual({ kind: 'none' });
    expect(stdout).not.toContain('core.hooksPath');
    expect(box.exists(HOOK)).toBe(true);
  });

  it('прогон второй раз — слово обвеса стоит рядом с пересозданием', async () => {
    const box = gitLocation('.githooks');
    const source = installHooks(box, { resolver: ASKS_GIT });

    await apply(box);
    // Обвес выпустился заново: артефакт разойдётся с лежащим, и появится
    // вторая половина блока.
    source.writeTemplate('pre-commit.sh', '#!/bin/sh\necho "новый"\nexit 0\n');

    const { stdout, exitCode } = await apply(box);

    expect(exitCode).toBe(0);
    const lines = stdout.split('\n');
    const at = (needle: string): number =>
      lines.findIndex((line) => line.includes(needle));
    // Заголовок ОДИН на обе половины: событие одного рода.
    expect(stdout.match(/остаётся человеку — консоль/g)).toHaveLength(1);
    // Частное впереди общего: слово про эту локацию раньше стоячего правила.
    expect(at('core.hooksPath')).toBeLessThan(at('пересоздаёшь ты'));
    // И итоговая строка ссылается на блок, который в этом прогоне есть.
    expect(stdout).toContain('"остаётся человеку"');
  });
});

describe('предупреждение считается не только через argv', () => {
  it('публичный прогон отдаёт его в ответе так же', async () => {
    const box = consumer();
    installHooks(box, { resolver: SAYS(SAID) });

    const result = await run({ command: 'plan', ...box.door });
    const hooks = runOf(result, HOOKS_ID);

    expect(hooks.plan?.warning).toEqual({ kind: 'said', text: SAID });
    // Трейс называет случившееся: телеметрия видит и молчание, и слово.
    expect(
      result.trace.some(
        (span) =>
          span.name === 'door.warning' && span.detail?.['kind'] === 'said',
      ),
    ).toBe(true);
  });

  it('один обвес в локации — соседний прогон про предупреждение молчит', async () => {
    const box = consumer();

    const result = await run({ command: 'plan', ...box.door });

    // Девбокс поля не объявляет вовсе: молчание доезжает названным состоянием.
    expect(soleRun(result).plan?.warning).toEqual({ kind: 'none' });
  });
});
