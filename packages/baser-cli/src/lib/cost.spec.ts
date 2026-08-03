/**
 * ЦЕНА ДВИЖЕНИЯ — то, что останется человеку, названо ПЛАНОМ.
 *
 * Три находки, и они про одно: план обязан называть не только то, что он
 * сделает, но и то, что после него останется человеку.
 *
 * **`tasker:BASER2-98`** — план говорит `imageUser "node" → "vscode"` и молчит,
 * что вместе с настройкой переедут тома `omnifield-secrets` и
 * `omnifield-pnpm-store` с `/home/node/…` на `/home/vscode/…`. Значение человек
 * выбрал сам, а адрес тома от него только СЧИТАЕТСЯ — и в томе лежит то, что он
 * клал руками: креды, стор.
 *
 * **`tasker:BASER2-99`** — «план применим — примени его» читается как «дальше
 * ничего не нужно», хотя контейнер надо пересоздать, а соседей поправить. Дверь
 * контейнерами не управляет и не начнёт: это про ТЕКСТ, а не про механику.
 *
 * **`tasker:BASER2-112`** — план печатает свои значения и молчит о том, что было
 * у человека и не воспроизведётся. Оба конца у двери в руках: существующий файл
 * и тот, который она положит.
 *
 * ── ЧТО ЗДЕСЬ СУДИТСЯ ───────────────────────────────────────────────────────
 *
 * Обещание в тексте — такой же контракт, как код (`tasker:BASER2-71`), поэтому
 * пробы утверждают НАЛИЧИЕ нужного текста, а не его отсутствие. Отсутствие
 * судится ровно в одном месте — там, где предмет обещания не наступил: блок,
 * который печатается каждому и всегда, за неделю перестаёт читаться.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installDevbox,
  soleRun,
  DEVBOX_PACKAGE,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { renderText } from './report.js';

const DEVBOX_ID = 'omnifield/devbox';
const LIVE = '.devcontainer/devcontainer.json';
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };
const OMNIFIELD = { presets: ['omnifield'] };

/** Чужой `.devcontainer` — как у weber: своё имя, свои фичи, свои порты. */
const THEIRS = `{
  "name": "мой старый девбокс",
  "features": {
    "ghcr.io/devcontainers/features/python:1": {}
  },
  "forwardPorts": [3000, 4873],
  "containerEnv": { "MY": "value" }
}
`;

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Девбокс, разложенный раскладкой omnifield: тома на месте, файл лежит. */
async function placed(): Promise<Consumer> {
  consumer = installDevbox({
    config: CONFIG,
    tuning: { [DEVBOX_ID]: OMNIFIELD },
  });
  await run({ command: 'apply', ...consumer.door });
  return consumer;
}

/** Человек заполнил пользователя образа на УЖЕ СТОЯЩЕМ девбоксе. */
async function movedUser(): Promise<Consumer> {
  const box = await placed();
  box.tune(DEVBOX_ID, { ...OMNIFIELD, settings: { imageUser: 'vscode' } });
  return box;
}

/**
 * Обвес выпустился заново: шаблон другой, значения ТЕ ЖЕ.
 *
 * Ровно живой случай weber (`tasker:BASER2-135`): артефакт разошёлся, а не
 * переехало ни одно значение — ни `name`, ни `networkAlias`, ни `imageUser`.
 */
async function bumpedTemplate(): Promise<Consumer> {
  const box = await placed();
  box.writeTemplate(
    'devcontainer.json.ejs',
    `// строка, которой в прошлом выпуске не было\n${readFileSync(
      join(box.sourceRoot, 'template/devcontainer.json.ejs'),
      'utf-8',
    )}`,
  );
  return box;
}

describe('ПЕРЕЕЗД ПОСЧИТАННОГО: настройка сменилась — уехали адреса томов', () => {
  it('план называет ОБА конца адреса тома, а не только настройку', async () => {
    // Ровно находка `tasker:BASER2-98`: `imageUser "node" → "vscode"` дверь
    // говорила и до этой работы. Чего не было — того, что в томе, который
    // человек наполнял руками, лежит теперь не по тому адресу.
    const box = await movedUser();

    const text = renderText(await run({ command: 'plan', ...box.door }));

    expect(text).toContain('/home/node/.secrets');
    expect(text).toContain('/home/vscode/.secrets');
    // Том назван ИМЕНЕМ вместе с обоими адресами — то есть человек читает
    // строку про свой `omnifield-secrets`, а не про абстрактный переезд.
    expect(text).toContain(
      'source=omnifield-secrets,target=/home/node/.secrets,type=volume → ' +
        'source=omnifield-secrets,target=/home/vscode/.secrets,type=volume',
    );
    expect(text).toContain('/home/node/.pnpm-store');
  });

  it('названо ДО плана: человек читает цену раньше решения', async () => {
    const box = await movedUser();

    const text = renderText(await run({ command: 'plan', ...box.door }));

    expect(text.indexOf('ПОСЧИТАННОЕ')).toBeGreaterThan(-1);
    expect(text.indexOf('ПОСЧИТАННОЕ')).toBeLessThan(text.indexOf('шагов:'));
  });

  it('дверь называет СЛОВО и его доказательство, а не смысл', async () => {
    // Про тома дверь не знает и знать не должна: что такое `target=`, знает
    // обвес. Она держит оба конца артефакта и называет слово, которое из него
    // исчезнет, — и настройку, от которой оно посчитано.
    const box = await movedUser();

    const { derived } = soleRun(await run({ command: 'plan', ...box.door }));

    expect(derived.length).toBeGreaterThan(0);
    expect(new Set(derived.map((move) => move.key))).toEqual(
      new Set(['imageUser']),
    );
    expect(new Set(derived.map((move) => move.dest))).toEqual(new Set([LIVE]));
    expect(
      derived.some((move) => move.placed.includes('source=omnifield-secrets')),
    ).toBe(true);
  });

  it('НИ ОДНОГО НЕДОКАЗАННОГО СЛОВА: `typescript-node` не переезжает', async () => {
    // Имя образа содержит `node` — и не имеет к пользователю образа никакого
    // отношения. Дверь этого не знает; её спасает не знание, а доказательство:
    // подстановка дала бы `typescript-vscode`, а такого слова в новом артефакте
    // нет, значит и говорить нечего.
    const box = await movedUser();

    const { derived } = soleRun(await run({ command: 'plan', ...box.door }));

    expect(derived.some((move) => move.placed.includes('typescript'))).toBe(
      false,
    );
  });

  it('значение ДРУГОЙ настройки не приписывается соседней', async () => {
    // Живой случай `tasker:BASER2-32`: обвес сменил резолвер, и поехали ОБА —
    // имя девбокса (`baser-devbox`) и сетевой алиас (`baser`). Одно значение
    // тут подстрока другого, и слово `baser-devbox` содержит `baser` целиком.
    //
    // Приписать его алиасу значило бы соврать про то, от чего оно посчитано, —
    // и повторить движение имени, которое план уже назвал строкой выше. Это же
    // утверждение закрывает и второе чтение того же правила: САМО значение в
    // блок не попадает — `baser-devbox` здесь и есть значение настройки `name`.
    const box = await placed();
    box.updateResolvers(`
export function repoName() { return 'weber'; }
export function devboxName() { return 'weber-devbox'; }
export function latestStableNode() { return '24'; }
`);

    const { derived } = soleRun(await run({ command: 'plan', ...box.door }));

    expect(derived.some((move) => move.placed === 'baser-devbox')).toBe(false);
    // Алиас при этом переезжает по-настоящему, и посчитанное от него названо:
    // в артефакте он стоит аргументом докера, а не отдельным словом.
    expect(
      derived.some(
        (move) =>
          move.key === 'networkAlias' &&
          move.placed === '--network-alias=baser',
      ),
    ).toBe(true);
  });

  it('первая укладка: переезжать нечему, и блока нет', async () => {
    // Узость обещания. Здесь судится отсутствие — но не отсутствие текста, а
    // отсутствие ПРЕДМЕТА: класть ещё нечего, и переезда нет ни у чего.
    consumer = installDevbox({
      config: CONFIG,
      tuning: { [DEVBOX_ID]: OMNIFIELD },
    });

    const result = await run({ command: 'plan', ...consumer.door });

    expect(soleRun(result).derived).toEqual([]);
    expect(renderText(result)).not.toContain('ПОСЧИТАННОЕ');
  });
});

describe('ЧТО ОСТАЁТСЯ ЧЕЛОВЕКУ: дверь переписывает файл, а не запущенное', () => {
  it('план говорит, что применением работа НЕ КОНЧИТСЯ', async () => {
    const box = await movedUser();

    const text = renderText(await run({ command: 'plan', ...box.door }));

    expect(text).toContain('остаётся человеку');
    // Три утверждения, и каждое отвечает на свой конец находки: контейнер надо
    // пересоздать, соседей поправить, а докер дверь не зовёт и не начнёт.
    expect(text).toContain('пока ты сам его не пересоздашь');
    expect(text).toContain('обещание соседям');
    expect(text).toContain('докер дверь не зовёт и контейнерами не управляет');
    // И итоговая строка больше не читается как «дальше ничего не нужно».
    expect(text).toContain('Применением работа не кончится');
  });

  it('после apply итог называет границу: на диск — и только', async () => {
    // Тот же долг с другого конца. `apply` прошёл, файл переписан — и ровно в
    // этот момент человек обязан прочитать, что контейнер живёт по-старому.
    const box = await movedUser();

    const text = renderText(await run({ command: 'apply', ...box.door }));

    expect(text).toContain('применено и записано на диск — и только на диск');
    expect(text).toContain('остаётся человеку');
  });

  it('первая укладка: пересоздавать нечего, и блока нет', async () => {
    // Предупреждение, которое видит каждый новый потребитель, за неделю
    // перестаёт читаться. Предмет наступает там, где файл УЖЕ ЛЕЖАЛ.
    consumer = installDevbox({
      config: CONFIG,
      tuning: { [DEVBOX_ID]: OMNIFIELD },
    });

    const text = renderText(
      await run({ command: 'apply', ...consumer.door }),
    );

    expect(text).not.toContain('остаётся человеку');
    expect(text).toContain('применено и записано на диск');
  });

  it('движений нет — блок СЖИМАЕТСЯ до пересоздания (`tasker:BASER2-135`)', async () => {
    // Живой прогон weber: обвес выпустился, файл разошёлся, а снаружи не поехало
    // ничего. Абзац про обещание соседям приходил целиком и читался как
    // заготовка — то есть обесценивал предупреждение ровно там, где оно должно
    // работать. Пересоздание при этом остаётся человеку ВСЕГДА.
    const box = await bumpedTemplate();

    const result = await run({ command: 'plan', ...box.door });
    const text = renderText(result);

    // Предмет наступил: файл, который уже лежал, будет переписан.
    expect(
      soleRun(result).plan?.steps.some((step) => step.reason === 'diverged'),
    ).toBe(true);
    // Ни одного названного движения — ни прежнего конца, ни посчитанного от него.
    expect(
      soleRun(result).settings.every((setting) => setting.placed === undefined),
    ).toBe(true);
    expect(soleRun(result).derived).toEqual([]);

    expect(text).toContain('остаётся человеку');
    expect(text).toContain('докер дверь не зовёт и контейнерами не управляет');
    expect(text).toContain('Переезжающих значений этот прогон не назвал');
    // Адресата у обещания соседям нет — и абзаца тоже.
    expect(text).not.toContain('обещание соседям');
    // Итоговая строка при этом по-прежнему не обещает завершённости: работа
    // остаётся, просто её меньше.
    expect(text).toContain('Применением работа не кончится');
  });
});

describe('ЧТО ИЗ ЧУЖОГО ФАЙЛА НЕ ВОСПРОИЗВЕДЁТСЯ — построчно', () => {
  /** Живой репозиторий: свой файл лежит, baser здесь никогда не был. */
  function occupied(existing: string = THEIRS): Consumer {
    consumer = installDevbox({ existing: { [LIVE]: existing } });
    return consumer;
  }

  it('первая установка: потеря названа поимённо и ДО подтверждения', async () => {
    // `tasker:BASER2-106` научил отказ говорить, что твой файл не прочитан. Это
    // половина правды: человек знал, что подстановки не будет, и не знал, ЧЕГО
    // именно лишится. Теперь знает — и узнаёт это раньше `--confirm`.
    const box = occupied();

    const result = await run({ command: 'plan', ...box.door });
    const text = renderText(result);
    const [difference] = soleRun(result).differences;

    expect(text).toContain('чужое не воспроизведётся');
    expect(difference.dest).toBe(LIVE);
    expect(difference.measured).toBe(true);
    expect(difference.gone).toContain('  "forwardPorts": [3000, 4873],');
    expect(difference.gone).toContain('  "containerEnv": { "MY": "value" }');
    expect(text).toContain('"forwardPorts": [3000, 4873],');
    // Отказ ведёт к блоку, а не оставляет человека сверять глазами.
    expect(
      result.problems.find((problem) => problem.code === 'first-install')
        ?.message,
    ).toContain('чужое не воспроизведётся');
    // И сверка стоит ДО подтверждения — в прямом смысле, по тексту.
    expect(text.indexOf('чужое не воспроизведётся')).toBeLessThan(
      text.indexOf('--confirm'),
    );
  });

  it('ФОРМАТ НЕ РАЗБИРАЕТСЯ: файл на чужом языке сверяется так же', async () => {
    // Артефакт бывает любым файлом. Дверь не знает, JSON перед ней или нет, и
    // именно поэтому механизм работает для любого: она сверяет строки.
    const box = occupied('# мой файл\nэто вообще не JSON\nи вторая строка\n');

    const result = await run({ command: 'plan', ...box.door });
    const [difference] = soleRun(result).differences;

    expect(difference.gone).toEqual([
      '# мой файл',
      'это вообще не JSON',
      'и вторая строка',
    ]);
    expect(renderText(result)).toContain('это вообще не JSON');
  });

  it('УСЕЧЕНИЕ названо счётчиком, и снимается флагом', async () => {
    // Дифф бывает длинным, и вывалить чужой файл целиком в лицо каждому,
    // кто ставит обвес в живой репозиторий, значило бы сделать вывод
    // нечитаемым. Но молча обрезанный список читается как полный.
    const lines = Array.from({ length: 40 }, (_, index) => `строка ${index}`);
    const box = occupied(`${lines.join('\n')}\n`);

    const short = await run({ command: 'plan', ...box.door });
    const [cut] = soleRun(short).differences;

    expect(cut.goneCount).toBe(40);
    expect(cut.gone.length).toBeLessThan(40);
    expect(renderText(short)).toContain('… ещё 28');
    expect(renderText(short)).toContain('--difference');

    const whole = await run({
      command: 'plan',
      ...box.door,
      difference: true,
    });
    const [full] = soleRun(whole).differences;

    expect(full.gone.length).toBe(40);
    expect(renderText(whole)).toContain('строка 39');
  });

  it('потерянная служебная запись ведёт к тому же блоку', async () => {
    // Оба входа ведут к одной потере, значит и назван он обязан быть на обоих:
    // починить один вход и оставить открытым соседний — это не починка.
    consumer = installDevbox({ config: CONFIG, existing: { [LIVE]: THEIRS } });

    const result = await run({ command: 'plan', ...consumer.door });

    expect(soleRun(result).differences[0]?.gone).toContain(
      '  "forwardPorts": [3000, 4873],',
    );
    expect(
      result.problems.find((problem) => problem.code === 'manifest-missing')
        ?.message,
    ).toContain('чужое не воспроизведётся');
  });

  it('подтверждение уже дано — расхождение всё равно названо', async () => {
    // `plan --confirm` это последний взгляд перед `apply`. Отказа на этом
    // прогоне уже нет, а потеря никуда не делась.
    const box = occupied();

    const result = await run({
      command: 'plan',
      ...box.door,
      confirm: [LIVE],
    });

    expect(
      soleRun(result).plan?.steps.find((step) => step.dest === LIVE)?.reason,
    ).toBe('adopted');
    expect(soleRun(result).differences[0]?.gone).toContain(
      '  "forwardPorts": [3000, 4873],',
    );
  });

  it('`placed-once`: терять нечего — и расхождения нет', async () => {
    // Подтверждение такого артефакта содержимое НЕ ТРОГАЕТ
    // (`tasker:BASER2-123`). Показать человеку «вот чего ты лишишься» значило
    // бы пугать ценой, которой нет, — и это хуже молчания.
    consumer = installDevbox({
      existing: { 'harness.yaml': 'моё: значение\n' },
    });
    consumer.installSource({
      packageName: '@omnifield/agents',
      id: 'omnifield/agents',
      layout: [
        { src: 'harness.yaml', dest: 'harness.yaml', class: 'placed-once' },
      ],
      templates: { 'harness.yaml': 'обвес: <%- "мой" %>\n' },
    });

    const result = await run({ command: 'plan', ...consumer.door });
    const agents = result.runs.find(
      (item) => item.source.id === 'omnifield/agents',
    );

    expect(
      agents?.plan?.conflicts.some(
        (conflict) => conflict.kind === 'foreign-dest',
      ),
    ).toBe(true);
    expect(agents?.differences).toEqual([]);
    expect(renderText(result)).not.toContain('чужое не воспроизведётся');
  });

  it('«ЧУЖОЙ» ОПРЕДЕЛЁН в самом блоке, а не только в справке', async () => {
    // Слово несущее: «что из твоего файла не воспроизведётся» читается как «файл
    // в твоём репозитории», а речь про файл, которым обвес НЕ ВЛАДЕЕТ. Пока
    // определение жило в `--help`, план отвечал только тому, кто туда сходил
    // (`tasker:BASER2-135`).
    const box = occupied();

    const text = renderText(await run({ command: 'plan', ...box.door }));

    expect(text).toContain('чужой здесь тот файл, которым обвес НЕ владеет');
  });

  it('`--difference` без чужого файла ОТВЕЧАЕТ, а не молчит', async () => {
    // Живой прогон weber: их `devcontainer.json` с прошлой итерации уже во
    // владении обвеса, блока для него нет ПО ПОСТРОЕНИЮ — и прогон с флагом
    // напечатался байт в байт как без флага. Секунду это читается как
    // невыполненное обещание, а ответ лежал в справке.
    const box = await placed();

    const silent = await run({ command: 'plan', ...box.door });
    const asked = await run({
      command: 'plan',
      ...box.door,
      difference: true,
    });

    // Предмет тот самый: чужого нет, показывать нечего — и до фикса оба вывода
    // совпадали.
    expect(soleRun(asked).differences).toEqual([]);
    expect(renderText(silent)).not.toContain('--difference:');

    const text = renderText(asked);
    expect(text).toContain('--difference: показывать нечего');
    expect(text).toContain('только для ЧУЖОГО файла');
    expect(text).toContain('которым обвес НЕ владеет');
  });

  it('вопрос живёт В ОТВЕТЕ: `difference` читается гейтом', async () => {
    // `renderText` не видит ничего, кроме `DoorResult`, — значит и ответить на
    // флаг она может только тем, что в ответе есть. Тот же факт нужен гейту:
    // счётчики говорят, сколько строк ВСЕГО, но усечение от полноты ими не
    // отличается.
    const box = occupied(
      `${Array.from({ length: 40 }, (_, index) => `строка ${index}`).join('\n')}\n`,
    );

    const short = await run({ command: 'plan', ...box.door });
    const whole = await run({
      command: 'plan',
      ...box.door,
      difference: true,
    });

    expect(short.difference).toBe(false);
    expect(whole.difference).toBe(true);
    expect(soleRun(short).differences[0].gone.length).toBeLessThan(40);
    expect(soleRun(whole).differences[0].gone.length).toBe(40);
  });
});
