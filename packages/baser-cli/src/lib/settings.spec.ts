/**
 * ПРИЁМКА `tasker:BASER2-53` — общая папка конфигов человека.
 *
 * Значения уехали из `baser.json` в файл на инструмент:
 * `.omnifield/<поставщик>-<обвес>.yaml`, имя считается из личности обвеса
 * (`tasker:BASER2-10` §3). Дверная половина — прочитать этот файл, разрешить по
 * нему значения и родить его один раз, если его нет.
 *
 * Проверяются ПЕРЕХОДЫ, а не устойчивые состояния. Три из них здесь несущие, и
 * каждый ломается незаметно:
 *
 * **Рождение — один раз, и без единого значения.** Дверь пишет в файл ровно
 * тогда, когда его нет; дальше не пишет НИ ПРИ КАКИХ условиях. Стоит ей
 * записать посчитанный дефолт — и он заморозится молча: обвес выпустится с
 * новым, а у человека останется вчерашний, и он даже не узнает, что выбирал.
 * Инвариант `kb:BASER2-5` держится ровно этим.
 *
 * **Родившийся файл — рабочий, а не декоративный.** Раскомментированная строка
 * обязана разбираться без единой правки и давать то же значение, которое дверь
 * назвала в ответе. Проверяется буквально: комментарии снимаются, файл читается
 * дверью заново.
 *
 * **Зарезервирован ровно один ключ.** Всё вне `baser` — конфиг самого
 * инструмента; дверь его не читает, не трогает и о его полях молчит.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  sourceConfigPath,
  SOURCE_CONFIG_KEY,
} from '@omnifield/baser-contracts';
import { MANIFEST_PATH } from '@omnifield/baser-materialize';
import {
  devboxManifest,
  installDevbox,
  manifestOf,
  soleRun,
  BUMPED_RESOLVERS,
  DEVBOX_PACKAGE,
  MOVED_NODE,
  PINNED_NODE,
  type Consumer,
  type SourceSpec,
} from './devbox.fixture.js';
import { run } from './run.js';
import { renderText } from './report.js';

const DEVBOX_ID = 'omnifield/devbox';
const TUNING = sourceConfigPath(DEVBOX_ID);

const LIVE = '.devcontainer/devcontainer.json';

/** `baser.json` формы 2: ТОЛЬКО перечень поставленного. */
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

function install(options: Parameters<typeof installDevbox>[0] = {}): Consumer {
  consumer = installDevbox({ config: CONFIG, ...options });
  return consumer;
}

/** Ключ `baser` родившегося файла — глазами той же формы, что читает дверь. */
function blockOf(text: string): unknown {
  return (parse(text) as Record<string, unknown> | null)?.[SOURCE_CONFIG_KEY];
}

/**
 * Снимает комментарий с ЗНАЧЕНИЙ — как это сделал бы человек, решивший заполнить
 * всё сразу.
 *
 * Раскомментируется строка вида `<объявленная настройка>: …` и ВЕСЬ её блок;
 * пояснения остаются пояснениями. Именно так проверяется, что файл рабочий: `# `
 * стоит ПОСЛЕ структурного отступа, и снятие двух символов обязано оставить
 * валидный YAML на своём уровне вложенности.
 *
 * **Блок, а не строка** (`tasker:BASER2-116`): у карты и списка значение занимает
 * несколько строк, и человек, снявший решётку с одной первой, получил бы ключ без
 * значения. Помощник, умевший снимать её только с элементов списка, ровно это и
 * делал с картой — проба зеленела бы на `null` вместо объявленного дефолта, то
 * есть доказывала бы не то, что написано в её имени.
 *
 * Продолжение блока опознаётся ОТСТУПОМ содержимого, а не его видом: у элемента
 * списка, у ключа карты и у опции внутри него общего синтаксиса нет, а вложенность
 * есть у всех троих. У строки-пояснения содержимое начинается с буквы — она
 * блоком не считается и остаётся комментарием.
 */
function uncommentSettings(text: string, keys: readonly string[]): string {
  const out: string[] = [];
  let inValue = false;
  for (const line of text.split('\n')) {
    const head = /^( {4})# ([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (head && keys.includes(head[2])) {
      out.push(`${head[1]}${head[2]}:${head[3]}`);
      inValue = true;
      continue;
    }
    const nested = /^( {4})# ( +\S.*)$/.exec(line);
    if (inValue && nested) {
      out.push(`${nested[1]}${nested[2]}`);
      continue;
    }
    inValue = false;
    out.push(line);
  }
  return out.join('\n');
}

describe('ЦЕЛЬ: настройки живут в файле на инструмент, а не в baser.json', () => {
  it('заполненное в ФАЙЛЕ доезжает до артефакта', async () => {
    const box = install({
      tuning: { [DEVBOX_ID]: { settings: { imageTag: '20' } } },
    });

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    expect(box.read(LIVE)).toContain('typescript-node:20');
    // И это заполненное: подниматься ему неоткуда.
    const tag = soleRun(result).settings.find(
      (item) => item.key === 'imageTag',
    );
    expect(tag?.ours).toBe(false);
    expect(tag?.origin.kind).toBe('filled');
  });

  it('пресет выбирается ТАМ ЖЕ, и слой разворачивается', async () => {
    const box = install({
      tuning: { [DEVBOX_ID]: { presets: ['omnifield'] } },
    });

    await run({ command: 'apply', cwd: box.root });

    expect(box.read(LIVE)).toContain('--network=omnifield-gateway');
  });

  it('baser.json со значениями — отказ формы, а не тихий разбор половины', async () => {
    // Ровно то, что человек написал бы по вчерашней доке. Молчание тут значило
    // бы, что настроенный обвес разложился дефолтным и никто этого не заметил.
    const box = install({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE, settings: { imageTag: '20' } }],
      },
    });

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    expect(problem.code).toBe('consumer-settings-moved');
    // Человеку сказано КУДА уехало поле, а не «поля нет».
    expect(problem.message).toContain(sourceConfigPath('<поставщик>/<обвес>'));
  });

  it('адрес опечатки — ФАЙЛ НАСТРОЕК, а не baser.json', async () => {
    const box = install({
      tuning: { [DEVBOX_ID]: { settings: { imageTeg: '24' } } },
    });

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    const problem = result.problems.find(
      (item) => item.code === 'unknown-setting',
    );
    // Идти чинить надо в тот файл, в котором опечатка.
    expect(problem?.at).toBe(
      `${TUNING}.${SOURCE_CONFIG_KEY}.settings.imageTeg`,
    );
  });

  it('имя файла считается из ЛИЧНОСТИ обвеса, а не из имени пакета', async () => {
    const box = install();

    const result = await run({ command: 'apply', cwd: box.root });

    // omnifield/devbox → .omnifield/omnifield-devbox.yaml. Ссылки на файл в
    // baser.json нет: правило разъехаться не может, ссылка могла бы.
    expect(soleRun(result).config.path).toBe(
      '.omnifield/omnifield-devbox.yaml',
    );
    expect(box.exists('.omnifield/omnifield-devbox.yaml')).toBe(true);
    expect(box.read('baser.json')).not.toContain('.omnifield');
  });
});

describe('рождение: один раз, если файла нет', () => {
  it('apply РОЖДАЕТ файл, plan только называет', async () => {
    const box = install();

    const planned = await run({ command: 'plan', cwd: box.root });

    expect(soleRun(planned).config).toEqual({
      path: TUNING,
      existed: false,
      creates: true,
    });
    // `plan` не пишет ничего — включая файл, который он назвал.
    expect(box.exists(TUNING)).toBe(false);
    expect(planned.writes).toEqual([]);
    expect(planned.status).toBe('pending');

    const applied = await run({ command: 'apply', cwd: box.root });

    expect(box.exists(TUNING)).toBe(true);
    expect(applied.writes.map((write) => write.path)).toContain(TUNING);
  });

  it('в родившемся файле НЕТ НИ ОДНОГО значения', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    const block = blockOf(box.read(TUNING) as string);

    // Ни выбранного пресета, ни заполненной настройки: выбрать за человека
    // значило бы заморозить дефолт молча.
    expect(block === null || block === undefined).toBe(false);
    expect(block).toEqual({ settings: null });

    // И прогон следом видит ровно «ничего не выбрано»: значения по-прежнему наши.
    const again = await run({ command: 'plan', cwd: box.root });
    expect(soleRun(again).settings.every((item) => item.ours)).toBe(true);
    expect(
      soleRun(again).settings.every((item) => item.chain.length === 1),
    ).toBe(true);
  });

  it('файл несёт title, description и дефолт КАЖДОЙ объявленной настройки', async () => {
    const box = install();
    const result = await run({ command: 'apply', cwd: box.root });
    const text = box.read(TUNING) as string;

    // Человеку есть что читать в файле, который он открывает, — а не в доке,
    // которую он не открывает.
    for (const setting of soleRun(result).settings) {
      expect(text).toContain(`# ${setting.title}`);
      expect(text).toContain(`# ${setting.key}:`);
    }

    // И описание доезжает СЛОВО В СЛОВО из объявления обвеса. Пересказ его
    // куском в пробе означал бы, что проверяется память автора пробы, а не
    // доставка: обвес выпускается заново — текст расходится молча.
    const declared = devboxManifest().baser.settings as Record<
      string,
      { description?: string }
    >;
    const described = Object.values(declared).filter(
      (spec) => typeof spec.description === 'string',
    );
    expect(described.length).toBeGreaterThan(0);
    for (const spec of described) {
      const first = (spec.description as string)
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '') as string;
      expect(text).toContain(`# ${first}`);
    }
    // Вычисляемый дефолт назван вычисляемым: значение, «взявшееся само», иначе
    // выглядит случайным, и его заполняют «чтобы зафиксировать».
    expect(text).toContain(
      'Дефолт считает сам обвес (defaults.mjs#devboxName)',
    );
  });

  it('объявленные пресеты перечислены, но НИ ОДИН не выбран', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    const text = box.read(TUNING) as string;

    expect(text).toContain(
      '#   omnifield — Раскладка omnifield: общая сеть, общие тома, ассистент внутри',
    );
    expect(text).toContain('# presets:');
    expect(blockOf(text)).toEqual({ settings: null });
  });

  it('РАСКОММЕНТИРОВАННЫЙ дефолт разбирается и даёт то же значение', async () => {
    // Родившийся файл обязан быть рабочим, а не декоративным: значение пишется
    // разборщиком YAML, поэтому кавычки, списки и null — его работа.
    const box = install();
    const result = await run({ command: 'apply', cwd: box.root });
    const named = new Map(
      soleRun(result).settings.map((item) => [item.key, item.value]),
    );
    const born = box.read(TUNING) as string;

    // ПРЕДУСЛОВИЕ пробы: в файле есть МНОГОСТРОЧНОЕ значение — вложенная строка
    // под своим ключом. Без него обещание про блок доказывалось бы на одних
    // скалярах, то есть ровно там, где оно и не ломалось.
    expect(/^ {4}# {3}\S/m.test(born)).toBe(true);
    // И снимается решётка блоком не потому, что так удобнее пробе, а потому что
    // блоком велит сам файл: помощник делает то, что человеку обещано текстом.
    expect(born).toContain('снимается блоком целиком');

    box.write(TUNING, uncommentSettings(born, [...named.keys()]));

    const filled = await run({ command: 'plan', cwd: box.root });

    expect(filled.problems).toEqual([]);
    for (const setting of soleRun(filled).settings) {
      expect(setting.value).toEqual(named.get(setting.key));
      // И теперь это ЗАПОЛНЕННОЕ: человек снял комментарий — значение встало.
      expect(setting.origin.kind).toBe('filled');
    }
    // Дерево при этом сошлось: значения те же, артефакт тот же.
    expect(soleRun(filled).plan?.steps).toEqual([]);
  });

  it('обвес без настроек и пресетов рождает файл, который тоже разбирается', async () => {
    const empty: SourceSpec = {
      packageName: '@omnifield/brain-harness',
      id: 'omnifield/agent-harness',
      title: 'Плагин агент-харнесса',
      layout: [{ src: 'policy.md', dest: '.claude/policy.md', render: false }],
      templates: { 'policy.md': '# policy\n' },
    };
    const box = install({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: empty.packageName }],
      },
    });
    box.installSource(empty);

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    const text = box.read(sourceConfigPath(empty.id)) as string;
    expect(text).toContain('# Пресетов обвес не объявлял.');
    expect(text).toContain('# Настроек обвес не объявлял');
    // Вырожденный файл — всё ещё файл: разбирается и означает «ничего не выбрано».
    expect(parse(text)).toEqual({ [SOURCE_CONFIG_KEY]: null });
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
  });

  it('отказавший прогон файла не оставляет: рождение едет тем же сбросом', async () => {
    const box = install({
      existing: { [LIVE]: '{\n  "name": "мой старый девбокс"\n}\n' },
    });

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('blocked');
    // Применение целиком либо никак — файл настроек не исключение.
    expect(box.exists(TUNING)).toBe(false);
    expect(soleRun(result).config.creates).toBe(true);
  });

  it('файл настроек НЕ запись раскладки: в паспорте укладки его нет', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    // Файл на диске ЕСТЬ — иначе «его нет в паспорте» было бы верно и на пустом
    // месте, то есть не проверяло бы ничего.
    expect(box.exists(TUNING)).toBe(true);
    expect(box.exists(MANIFEST_PATH)).toBe(true);
    expect(manifestOf(box).map((record) => record.dest)).not.toContain(TUNING);
    // И сиротой он не станет: движок о нём не знает вовсе.
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
  });
});

describe('после рождения дверь в файл НЕ ПИШЕТ', () => {
  it('второй прогон не трогает файл ни на байт', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    const born = box.read(TUNING);

    const again = await run({ command: 'apply', cwd: box.root });

    expect(again.status).toBe('converged');
    expect(again.writes).toEqual([]);
    expect(box.read(TUNING)).toBe(born);
    expect(soleRun(again).config).toEqual({
      path: TUNING,
      existed: true,
      creates: false,
    });
  });

  it('дефолт обвеса уехал — значение поднялось, а файл остался прежним', async () => {
    // Тот самый инвариант `kb:BASER2-5`: незаполненное едет за выпуском обвеса
    // ИМЕННО ПОТОМУ, что писать его некуда. Запиши дверь дефолт в файл при
    // рождении — здесь бы осталась вчерашняя версия, и молча.
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    const born = box.read(TUNING) as string;
    expect(box.read(LIVE)).toContain(`typescript-node:${PINNED_NODE}`);
    expect(born).toContain(`# imageTag: "${PINNED_NODE}"`);

    box.updateResolvers(BUMPED_RESOLVERS);
    const result = await run({ command: 'apply', cwd: box.root });

    expect(box.read(LIVE)).toContain(`typescript-node:${MOVED_NODE}`);
    // Файл не тронут — включая закомментированный дефолт, который устарел.
    // Он рассказ о том, что было при рождении, а не вторая правда о значении:
    // живое значение дверь называет в ответе и печатает в тексте.
    expect(box.read(TUNING)).toBe(born);
    expect(result.writes.map((write) => write.path)).not.toContain(TUNING);
    expect(
      soleRun(result).settings.find((item) => item.key === 'imageTag')
        ?.value,
    ).toBe(MOVED_NODE);
  });

  it('заполненное человеком не переписывается и не «фиксируется»', async () => {
    const box = install({
      tuning: { [DEVBOX_ID]: { settings: { imageTag: '20' } } },
    });
    const mine = box.read(TUNING);

    box.updateResolvers(BUMPED_RESOLVERS);
    await run({ command: 'apply', cwd: box.root });

    expect(box.read(TUNING)).toBe(mine);
    expect(box.read(LIVE)).toContain('typescript-node:20');
  });
});

describe('зарезервирован ровно один ключ — baser', () => {
  it('всё вне него дверь не читает и не трогает', async () => {
    // Живой случай: у плагина агентов в том же файле лежат зоны и адреса
    // сервисов. Один файл, два читателя — конфликта нет, пишет в него человек.
    const box = install();
    box.write(
      TUNING,
      [
        'baser:',
        '  settings:',
        "    imageTag: '20'",
        '',
        'services:',
        '  tasker: http://10.8.1.1:8080/api/tasker',
        'zones:',
        '  - cli',
        '',
      ].join('\n'),
    );

    const result = await run({ command: 'apply', cwd: box.root });

    // Ни отказа про незнакомые поля, ни правки чужого куска.
    expect(result.status).toBe('applied');
    expect(result.problems).toEqual([]);
    expect(box.read(TUNING)).toContain(
      'tasker: http://10.8.1.1:8080/api/tasker',
    );
    expect(box.read(LIVE)).toContain('typescript-node:20');
  });

  it('опечатка ВНУТРИ baser названа вслух — иначе ловить их было бы нечем', async () => {
    const box = install();
    box.write(TUNING, 'baser:\n  setings:\n    imageTag: "20"\n');

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('unknown-field');
    expect(result.problems[0].at).toBe(`${TUNING}.baser.setings`);
  });
});

describe('файл есть, но непригоден', () => {
  it('битый YAML — код ДВЕРИ, и она не делает вид, что ничего не выбрано', async () => {
    const box = install();
    box.write(
      TUNING,
      'baser:\n  settings:\n   imageTag: "20"\n  \tтаб\n',
    );

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    const problem = result.problems.find(
      (item) => item.code === 'source-config-unreadable',
    );
    // YAML читает дверь — значит и про сломанный отступ говорит она: контракты
    // о существовании файла не знают.
    expect(problem?.at).toBe(TUNING);
    // Молчаливое «работаем по дефолтам» превратило бы настроенный обвес в
    // дефолтный ровно тогда, когда человек ошибся в своём же файле.
    expect(soleRun(result).plan).toBeNull();
    expect(box.exists(LIVE)).toBe(false);
  });

  it('отказ не обнуляет рассказ: адрес файла в ответе остаётся', async () => {
    const box = install();
    box.write(TUNING, 'baser: [это не объект]\n');

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    expect(soleRun(result).config).toEqual({
      path: TUNING,
      existed: true,
      creates: false,
    });
  });
});

describe('файл на КАЖДЫЙ инструмент свой', () => {
  const AGENTS: SourceSpec = {
    packageName: '@omnifield/brain-harness',
    id: 'omnifield/agent-harness',
    title: 'Плагин агент-харнесса',
    settings: {
      product: { title: 'Имя продукта', type: 'string', default: 'baser' },
    },
    layout: [{ src: 'harness.yaml.ejs', dest: '.omnifield/harness.yaml' }],
    templates: { 'harness.yaml.ejs': 'product: <%- product %>\n' },
  };

  it('два обвеса — два файла, и значения не перепутаны', async () => {
    const box = install({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: AGENTS.packageName }],
      },
      tuning: {
        [DEVBOX_ID]: { settings: { imageTag: '20' } },
        [AGENTS.id]: { settings: { product: 'weber' } },
      },
    });
    box.installSource(AGENTS);

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    expect(box.read(LIVE)).toContain('typescript-node:20');
    expect(box.read('.omnifield/harness.yaml')).toBe('product: weber\n');
    expect(result.runs.map((item) => item.config.path)).toEqual([
      '.omnifield/omnifield-devbox.yaml',
      '.omnifield/omnifield-agent-harness.yaml',
    ]);
  });

  it('свой артефакт и свой файл настроек лежат в одной папке и не мешают', async () => {
    // `.omnifield/harness.yaml` — артефакт обвеса (его кладёт раскладка),
    // `.omnifield/omnifield-agent-harness.yaml` — настройки человека. Соседство
    // в одной папке законно: у них разные имена и разные хозяева.
    const box = install({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: AGENTS.packageName }],
      },
    });
    box.installSource(AGENTS);

    await run({ command: 'apply', cwd: box.root });

    expect(box.exists('.omnifield/harness.yaml')).toBe(true);
    expect(box.exists('.omnifield/omnifield-agent-harness.yaml')).toBe(true);
    expect(manifestOf(box).map((record) => record.dest)).toContain(
      '.omnifield/harness.yaml',
    );
    expect(manifestOf(box).map((record) => record.dest)).not.toContain(
      '.omnifield/omnifield-agent-harness.yaml',
    );
  });
});

describe('ответ и текст называют файл настроек', () => {
  it('адрес печатается ВСЕГДА, а рождение — отдельной пометкой', async () => {
    const box = install();

    const planned = renderText(await run({ command: 'plan', cwd: box.root }));
    expect(planned).toContain(`настройки ${TUNING} — будет создан`);
    expect(planned).toContain('значений в нём нет');

    await run({ command: 'apply', cwd: box.root });
    const after = renderText(await run({ command: 'plan', cwd: box.root }));

    // Файл уже есть — пометки о рождении нет, а адрес остался: человек, которому
    // надо что-то подкрутить, узнаёт его из вывода, а не из доки.
    expect(after).toContain(`настройки ${TUNING}`);
    expect(after).not.toContain('будет создан');
  });

  it('трейс: чтение мерится всегда, рождение — только когда оно было', async () => {
    const box = install();

    const born = await run({ command: 'apply', cwd: box.root });
    expect(
      born.trace.find((span) => span.name === 'door.settings')?.detail,
    ).toEqual({ source: DEVBOX_ID });
    expect(
      born.trace.find((span) => span.name === 'door.born')?.detail,
    ).toEqual({ source: DEVBOX_ID, path: TUNING });

    const again = await run({ command: 'plan', cwd: box.root });
    expect(again.trace.some((span) => span.name === 'door.settings')).toBe(
      true,
    );
    expect(again.trace.some((span) => span.name === 'door.born')).toBe(false);
  });
});
