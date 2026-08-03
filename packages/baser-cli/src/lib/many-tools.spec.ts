/**
 * ПРИЁМКА `tasker:BASER2-55` — дверь проходит по ВСЕМ инструментам.
 *
 * Живой случай `tasker:BASER2-44`: в репозиторий приезжают девбокс и плагин
 * агентов. Это два инструмента, и до этой работы дверь отказывала на втором
 * (`multiple-sources`). Отказ был верен, пока движок считал сиротами чужие
 * записи; движок это закрыл (`tasker:BASER2-7`), и отказ снимается ВМЕСТЕ С
 * ПРИЧИНОЙ — дверь читает перечень, гоняет прогон по каждому обвесу и сводит всё
 * в один ответ.
 *
 * Проверяются ПЕРЕХОДЫ, а не устойчивые состояния: в устойчивом состоянии всё
 * сходилось и до фикса — ломалось оно ровно на переходе «сел второй».
 *
 * Три инварианта, и ни один не про «работает»:
 *   — прогон по одному обвесу не трогает артефакты соседнего;
 *   — столкновение двух обвесов на один путь НАЗЫВАЕТСЯ вслух и не разрешается
 *     ни порядком записей в конфиге, ни порядком прогонов (`kb:BASER2-6`);
 *   — отказ движка `cross-source-dest` дверь ДОНОСИТ, а не проглатывает.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  installDevbox,
  manifestOf,
  DEVBOX_PACKAGE,
  type Consumer,
  type SourceSpec,
} from './devbox.fixture.js';
import { cli, type CliOutcome } from './cli.js';
import { run } from './run.js';
import { renderText } from './report.js';
import type { DoorResult, SourceRun } from './result.js';
import { MANIFEST_PATH } from '@omnifield/baser-materialize';
import { sourceConfigPath, FORM_VERSION } from '@omnifield/baser-contracts';

const DEVBOX_ID = 'omnifield/devbox';
const AGENTS_ID = 'omnifield/agent-harness';

const AGENTS_PACKAGE = '@omnifield/brain-harness';

/** Артефакты девбокса — настоящие `dest` принятого примера. */
const DEVCONTAINER = '.devcontainer/devcontainer.json';
const DEVLOCK = '.devcontainer/devcontainer-lock.json';

/** Артефакты плагина агентов. */
const HARNESS = '.omnifield/harness.yaml';
const POLICY = '.claude/agents/shared-policy.md';

const POLICY_BODY = '# shared-policy — рамка ролей\n';

/**
 * Плагин агентов: второй инструмент, ставший в тот же репозиторий.
 *
 * Один артефакт рендерится, второй едет байт в байт — оба пути двери обязаны
 * работать у ВТОРОГО обвеса так же, как у первого, а не только у того, на
 * котором их писали.
 */
const AGENTS: SourceSpec = {
  packageName: AGENTS_PACKAGE,
  id: AGENTS_ID,
  title: 'Плагин агент-харнесса',
  settings: {
    product: { title: 'Имя продукта', type: 'string', default: 'baser' },
  },
  layout: [
    { src: 'harness.yaml.ejs', dest: HARNESS },
    { src: 'shared-policy.md', dest: POLICY, render: false },
  ],
  templates: {
    'harness.yaml.ejs': 'product: <%- product %>\n',
    'shared-policy.md': POLICY_BODY,
  },
};

const SUCCESSOR_PACKAGE = '@omnifield/brain-harness-next';
const SUCCESSOR_ID = 'omnifield/agent-harness-next';

/**
 * ПРЕЕМНИК: инструмент, которому сосед ОТДАЁТ артефакт.
 *
 * Не спор: отдающий из своей раскладки этот путь уже выпилил, принимающий его
 * объявил. Форма такой набор пропускает — и правильно делает, столкновения тут
 * нет.
 */
const SUCCESSOR: SourceSpec = {
  packageName: SUCCESSOR_PACKAGE,
  id: SUCCESSOR_ID,
  title: 'Плагин агент-харнесса, следующее поколение',
  layout: [{ src: 'shared-policy.md', dest: POLICY, render: false }],
  templates: { 'shared-policy.md': '# shared-policy — рамка ролей (v2)\n' },
};

/** Тот же плагин, но целящийся в артефакт девбокса, — спор на один путь. */
const RIVAL: SourceSpec = {
  packageName: AGENTS_PACKAGE,
  id: AGENTS_ID,
  title: 'Плагин агент-харнесса',
  layout: [{ src: 'devcontainer.json', dest: DEVCONTAINER, render: false }],
  templates: { 'devcontainer.json': '{ "name": "не девбокс" }\n' },
};

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

function configOf(uses: readonly string[]): unknown {
  return { formVersion: 2, sources: uses.map((use) => ({ use })) };
}

/** Репозиторий с двумя поставленными инструментами и конфигом в этом порядке. */
function twoTools(
  order: readonly string[] = [DEVBOX_PACKAGE, AGENTS_PACKAGE],
): Consumer {
  consumer = installDevbox({ config: configOf(order) });
  consumer.installSource(AGENTS);
  return consumer;
}

function runOf(result: DoorResult, id: string): SourceRun {
  const found = result.runs.find((item) => item.source.id === id);
  if (found === undefined) {
    throw new Error(
      `прогона обвеса "${id}" в ответе нет: ${result.runs
        .map((item) => item.source.id)
        .join(' · ')}`,
    );
  }
  return found;
}

/**
 * Извещения ОДНОГО вида у одного обвеса.
 *
 * Точный `toEqual` по всему списку сверял не своё утверждение, а весь набор
 * извещений движка: любое новое — про версию обвеса, про удержанный
 * `placed-once` — роняло эти пробы независимо от смысла, и падала бы зона
 * `cli` за чужой заход (`tasker:BASER2-52`, замечание owner-materialize).
 * Проба спрашивает про своё и остаётся точной: «ровно это извещение и никакого
 * второго такого же» здесь по-прежнему проверяется.
 */
function noticesOf(result: DoorResult, id: string, kind: string) {
  return (runOf(result, id).plan?.notices ?? []).filter(
    (notice) => notice.kind === kind,
  );
}

function door(outcome: CliOutcome): DoorResult {
  if (outcome.result?.kind !== 'door') {
    throw new Error('ответ прогона не пришёл');
  }
  return outcome.result.door;
}

describe('ЦЕЛЬ: два инструмента ставятся ОДНОЙ командой', () => {
  it('оба обвеса легли, и каждый артефакт подписан своим', async () => {
    const box = twoTools();

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('applied');
    expect(box.read(DEVCONTAINER)).toContain('baser-devbox');
    expect(box.read(HARNESS)).toBe('product: baser\n');
    expect(box.read(POLICY)).toBe(POLICY_BODY);

    // Владение ведётся по каждому обвесу отдельно — это видно из записи.
    expect(
      manifestOf(box)
        .map((record) => [record.dest, record.source])
        .sort(),
    ).toEqual(
      [
        [DEVCONTAINER, DEVBOX_ID],
        [DEVLOCK, DEVBOX_ID],
        [HARNESS, AGENTS_ID],
        [POLICY, AGENTS_ID],
      ].sort(),
    );
  });

  it('отказ multiple-sources на легальном случае больше не воспроизводится', async () => {
    const box = twoTools();

    const outcome = await cli(['apply', '--cwd', box.root, ...box.doorArgs()], process.cwd());

    expect(door(outcome).problems).toEqual([]);
    expect(door(outcome).status).toBe('applied');
    // Кода нет ни в ответе, ни в природе: он снят вместе с причиной.
    expect(door(outcome).problems.map((problem) => problem.code)).not.toContain(
      'multiple-sources',
    );
    expect(outcome.exitCode).toBe(0);
  });

  it('прогон у каждого обвеса СВОЙ, а план не сведён в общий котёл', async () => {
    const box = twoTools();

    const result = await run({ command: 'plan', ...box.door });

    expect(result.runs.map((item) => item.source.id)).toEqual([
      DEVBOX_ID,
      AGENTS_ID,
    ]);
    // Шаги лежат под своим обвесом: приписать их не тому здесь физически нечем.
    expect(
      runOf(result, DEVBOX_ID).plan?.steps.map((step) => step.dest),
    ).toEqual([DEVLOCK, DEVCONTAINER]);
    expect(
      runOf(result, AGENTS_ID).plan?.steps.map((step) => step.dest),
    ).toEqual([POLICY, HARNESS]);
    // Значения тоже свои: настройки соседа в чужом рассказе не появляются.
    expect(runOf(result, AGENTS_ID).settings.map((item) => item.key)).toEqual([
      'product',
    ]);
  });

  it('засев конфига берёт ВСЕ поставленные обвесы, а не первый попавшийся', async () => {
    // Конфига нет вовсе: дверь рождает его по объявленным зависимостям.
    consumer = installDevbox();
    consumer.installSource(AGENTS);

    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('applied');
    expect(
      JSON.parse(consumer.read('baser.json') ?? '{}') as {
        sources: { use: string }[];
      },
    ).toEqual({
      // Числом здесь было `2`, и оно устарело молча: версию в засеянный конфиг
      // ставит дверь, а не проба. Утверждается ФАКТ — «дверь проштамповала свою
      // форму», — и следующий её подъём эту пробу не тронет.
      formVersion: FORM_VERSION,
      sources: [{ use: DEVBOX_PACKAGE }, { use: AGENTS_PACKAGE }],
    });
    expect(consumer.exists(DEVCONTAINER)).toBe(true);
    expect(consumer.exists(HARNESS)).toBe(true);
  });

  it('сброс на диск ОДИН на оба обвеса, и записи в нём общие', async () => {
    const box = twoTools();

    const result = await run({ command: 'apply', ...box.door });

    expect(result.writes.map((write) => write.path).sort()).toEqual(
      [
        DEVCONTAINER,
        DEVLOCK,
        HARNESS,
        POLICY,
        MANIFEST_PATH,
        // Файлы настроек родились ОБА и уехали тем же сбросом. В паспорте
        // укладки их при этом нет — они не записи раскладки.
        sourceConfigPath(DEVBOX_ID),
        sourceConfigPath(AGENTS_ID),
      ].sort(),
    );
    expect(manifestOf(box).map((record) => record.dest)).not.toContain(
      sourceConfigPath(DEVBOX_ID),
    );
    // Спан сброса ровно один: два прогона — не два похода на диск.
    expect(
      result.trace.filter((span) => span.name === 'door.flush').length,
    ).toBe(1);
  });
});

describe('переход: повторные прогоны в ЛЮБОМ порядке', () => {
  it('второй прогон сходится, и диск не тронут', async () => {
    const box = twoTools();
    await run({ command: 'apply', ...box.door });
    const landed = box.read(DEVCONTAINER);

    const again = await run({ command: 'apply', ...box.door });

    expect(again.status).toBe('converged');
    expect(again.writes).toEqual([]);
    expect(again.runs.every((item) => item.plan?.steps.length === 0)).toBe(
      true,
    );
    expect(box.read(DEVCONTAINER)).toBe(landed);
    expect(box.read(HARNESS)).toBe('product: baser\n');
  });

  it('обвесы переставлены в конфиге — ничего не снимается и не кладётся заново', async () => {
    const box = twoTools([DEVBOX_PACKAGE, AGENTS_PACKAGE]);
    await run({ command: 'apply', ...box.door });
    const before = manifestOf(box);

    // Тот же набор, другая очередь. Владение не имеет права быть функцией
    // порядка записей: иначе перестановка строк в конфиге сносила бы файлы.
    box.write(
      'baser.json',
      `${JSON.stringify(configOf([AGENTS_PACKAGE, DEVBOX_PACKAGE]), null, 2)}\n`,
    );

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('converged');
    expect(result.writes).toEqual([]);
    expect(box.exists(DEVCONTAINER)).toBe(true);
    expect(box.exists(HARNESS)).toBe(true);
    expect(manifestOf(box)).toEqual(before);
  });

  it('порядок первой установки на итог не влияет: дерево и владение те же', async () => {
    const first = twoTools([DEVBOX_PACKAGE, AGENTS_PACKAGE]);
    await run({ command: 'apply', ...first.door });
    const forward = {
      devcontainer: first.read(DEVCONTAINER),
      harness: first.read(HARNESS),
      manifest: manifestOf(first),
    };
    first.cleanup();

    const second = twoTools([AGENTS_PACKAGE, DEVBOX_PACKAGE]);
    const result = await run({ command: 'apply', ...second.door });

    expect(result.status).toBe('applied');
    // Сверка «оба одинаковы» без этого была бы верна и на двух пустых деревьях.
    expect(second.read(DEVCONTAINER)).toContain('baser-devbox');
    expect(second.read(DEVCONTAINER)).toBe(forward.devcontainer);
    expect(second.read(HARNESS)).toBe(forward.harness);
    expect(manifestOf(second)).toHaveLength(4);
    expect(manifestOf(second)).toEqual(forward.manifest);
  });

  it('прогон только одного обвеса не считает сиротами артефакты второго', async () => {
    // Тот самый переход, на котором ломалось: конфиг сузили до одного обвеса,
    // и до фикса движка второй прогон снёс бы чужие файлы как потерявшие
    // объявление. Теперь чужая запись — чужое хозяйство: она остаётся, а
    // артефакт на диске не трогают.
    const box = twoTools();
    await run({ command: 'apply', ...box.door });

    box.write(
      'baser.json',
      `${JSON.stringify(configOf([DEVBOX_PACKAGE]), null, 2)}\n`,
    );
    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('converged');
    expect(box.read(HARNESS)).toBe('product: baser\n');
    expect(box.read(POLICY)).toBe(POLICY_BODY);
    expect(
      manifestOf(box)
        .map((record) => record.dest)
        .sort(),
    ).toEqual([DEVCONTAINER, DEVLOCK, HARNESS, POLICY].sort());
  });
});

describe('переход: обвес снят с репозитория', () => {
  it('выпиленная запись убирает СВОЙ артефакт и только его', async () => {
    const box = twoTools();
    await run({ command: 'apply', ...box.door });

    // Обвес выпустился заново и перестал класть один из своих файлов.
    box.installSource({
      ...AGENTS,
      layout: AGENTS.layout.filter((entry) => entry.dest !== POLICY),
    });

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('applied');
    expect(box.exists(POLICY)).toBe(false);
    expect(result.writes).toContainEqual({ path: POLICY, kind: 'DELETE' });
    // Сосед цел целиком — ни файла, ни записи он не потерял.
    expect(box.read(DEVCONTAINER)).toContain('baser-devbox');
    expect(box.read(HARNESS)).toBe('product: baser\n');
    expect(
      manifestOf(box)
        .map((record) => [record.dest, record.source])
        .sort(),
    ).toEqual(
      [
        [DEVCONTAINER, DEVBOX_ID],
        [DEVLOCK, DEVBOX_ID],
        [HARNESS, AGENTS_ID],
      ].sort(),
    );
    expect((await run({ command: 'apply', ...box.door })).status).toBe(
      'converged',
    );
  });
});

describe('столкновение двух обвесов на один путь называется вслух', () => {
  it('оба ОБЪЯВИЛИ один dest — отказ до всякого прогона', async () => {
    consumer = installDevbox({
      config: configOf([DEVBOX_PACKAGE, AGENTS_PACKAGE]),
    });
    consumer.installSource(RIVAL);

    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    // Код КОНТРАКТОВ: столкновение — свойство набора объявлений, и называет его
    // тот, кто держит форму, а не дверь вторым языком поверх.
    expect(problem.code).toBe('artifact-shared');
    expect(problem.message).toContain(DEVCONTAINER);
    // До движка не дошли вовсе — и на диск не ушло ничего.
    expect(result.runs.every((item) => item.plan === null)).toBe(true);
    expect(consumer.exists(DEVCONTAINER)).toBe(false);
    expect(consumer.exists('baser.lock.json')).toBe(false);
  });

  it('порядком записей в конфиге спор не решается — отказ в обе стороны', async () => {
    consumer = installDevbox({
      config: configOf([AGENTS_PACKAGE, DEVBOX_PACKAGE]),
    });
    consumer.installSource(RIVAL);

    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('artifact-shared');
    expect(consumer.exists(DEVCONTAINER)).toBe(false);
  });

  it('отказ движка cross-source-dest дверь ДОНОСИТ, а не проглатывает', async () => {
    // Спор, до которого форма не дотягивается: девбокс уже лёг и записан в
    // паспорте укладки, а потом из конфига ушёл — объявления его больше нет,
    // запись есть. Пришедший на его путь плагин перехватить артефакт не может.
    const box = twoTools();
    await run({ command: 'apply', ...box.door });

    box.removeSource(AGENTS_PACKAGE);
    box.installSource(RIVAL);
    box.write(
      'baser.json',
      `${JSON.stringify(configOf([AGENTS_PACKAGE]), null, 2)}\n`,
    );

    const outcome = await cli(['apply', '--cwd', box.root, ...box.doorArgs()], process.cwd());
    const result = door(outcome);

    expect(result.status).toBe('blocked');
    expect(runOf(result, AGENTS_ID).plan?.conflicts).toEqual([
      expect.objectContaining({
        kind: 'cross-source-dest',
        dest: DEVCONTAINER,
        detail: { ownedBy: DEVBOX_ID, resolution: 'drop-layout-entry' },
      }),
    ]);
    // Код возврата — конфликт владения, а не отказ входа.
    expect(outcome.exitCode).toBe(1);
    // Спорный артефакт не тронут, и владение осталось у девбокса.
    expect(box.read(DEVCONTAINER)).toContain('baser-devbox');
    expect(
      manifestOf(box).find((record) => record.dest === DEVCONTAINER)?.source,
    ).toBe(DEVBOX_ID);
  });

  it('подтверждением этот отказ не снимается, и это названо извещением', async () => {
    const box = twoTools();
    await run({ command: 'apply', ...box.door });

    box.removeSource(AGENTS_PACKAGE);
    box.installSource(RIVAL);
    box.write(
      'baser.json',
      `${JSON.stringify(configOf([AGENTS_PACKAGE]), null, 2)}\n`,
    );

    const result = await run({
      command: 'apply',
      ...box.door,
      confirm: [DEVCONTAINER],
    });

    // Перехват по подтверждению сделал бы владение функцией порядка прогонов.
    expect(result.status).toBe('blocked');
    expect(noticesOf(result, AGENTS_ID, 'confirmation-unused')).toEqual([
      expect.objectContaining({
        kind: 'confirmation-unused',
        dest: DEVCONTAINER,
        detail: { confirmation: 'not-applicable' },
      }),
    ]);
    expect(box.read(DEVCONTAINER)).toContain('baser-devbox');
  });
});

describe('ПЕРЕДАЧА АРТЕФАКТА от обвеса к обвесу за один прогон', () => {
  /**
   * Сосед выпустился и перестал класть файл, а второй начал его класть.
   *
   * До `tasker:BASER2-58` исход зависел от ОЧЕРЕДИ ЗАПИСЕЙ В КОНФИГЕ: отдающий
   * раньше — всё сходилось; отдающий позже — принимающий видел в паспорте чужую
   * запись и упирался в `cross-source-dest`, и повторный прогон это не
   * расшивал. Отказ был безопасен, тихой потери не было — но результат одного и
   * того же репозитория зависел от порядка строк в файле.
   */
  /** Раскладывает исходное состояние и переводит артефакт «в дороге». */
  async function inTransit(order: readonly string[]): Promise<Consumer> {
    const box = twoTools([DEVBOX_PACKAGE, AGENTS_PACKAGE]);
    await run({ command: 'apply', ...box.door });

    // Отдающий выпустился без этого артефакта, принимающий — с ним.
    box.installSource({
      ...AGENTS,
      layout: AGENTS.layout.filter((entry) => entry.dest !== POLICY),
    });
    box.installSource(SUCCESSOR);
    box.write('baser.json', `${JSON.stringify(configOf(order), null, 2)}\n`);
    return box;
  }

  const FORWARD = [DEVBOX_PACKAGE, AGENTS_PACKAGE, SUCCESSOR_PACKAGE];
  const BACKWARD = [DEVBOX_PACKAGE, SUCCESSOR_PACKAGE, AGENTS_PACKAGE];

  it('ОТДАЮЩИЙ ПОЗЖЕ В КОНФИГЕ: передача всё равно проходит', async () => {
    // Ровно тот порядок, на котором дверь упиралась. Освобождение обязано
    // считаться раньше захвата — при любой записи в конфиге.
    consumer = await inTransit(BACKWARD);

    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('applied');
    expect(consumer.read(POLICY)).toBe('# shared-policy — рамка ролей (v2)\n');
    expect(
      manifestOf(consumer).find((record) => record.dest === POLICY)?.source,
    ).toBe(SUCCESSOR_ID);
    // И сходится со второго прогона, а не колеблется вечно.
    expect((await run({ command: 'apply', ...consumer.door })).status).toBe(
      'converged',
    );
  });

  it('исход ОДИНАКОВ в обе стороны — порядок записей больше ничего не решает', async () => {
    const forward = await inTransit(FORWARD);
    await run({ command: 'apply', ...forward.door });
    const expected = {
      policy: forward.read(POLICY),
      manifest: manifestOf(forward)
        .map((record) => [record.dest, record.source])
        .sort(),
    };
    forward.cleanup();

    consumer = await inTransit(BACKWARD);
    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('applied');
    expect(consumer.read(POLICY)).toBe(expected.policy);
    expect(
      manifestOf(consumer)
        .map((record) => [record.dest, record.source])
        .sort(),
    ).toEqual(expected.manifest);
  });

  it('порядок ПРОГОНОВ назван в ответе: отдающий идёт первым', async () => {
    // Не косметика: по этому списку читается, ПОЧЕМУ прогон прошёл. Владение
    // при этом никому не достаётся «за то, что прогнался первым» — очередь
    // считается из объявлений и паспорта укладки, а не из удачи.
    consumer = await inTransit(BACKWARD);

    const result = await run({ command: 'plan', ...consumer.door });

    const order = result.runs.map((item) => item.source.id);
    expect(order.indexOf(AGENTS_ID)).toBeLessThan(order.indexOf(SUCCESSOR_ID));
  });

  it('НИЧЕГО НЕ ПЕРЕДАЁТСЯ — порядок остаётся тем, что в конфиге', async () => {
    // Перестановка не должна случаться сама по себе: рассказ о прогонах читает
    // человек, и менять его порядок без причины значит путать без причины.
    const box = twoTools([AGENTS_PACKAGE, DEVBOX_PACKAGE]);

    const result = await run({ command: 'plan', ...box.door });

    expect(result.runs.map((item) => item.source.id)).toEqual([
      AGENTS_ID,
      DEVBOX_ID,
    ]);
  });

  it('ВЗАИМНАЯ передача: отказ — но ОДИНАКОВЫЙ в обе стороны', async () => {
    // Два обвеса меняются артефактами. Очередью это не разрешается вовсе: кто
    // бы ни пошёл первым, он захватывает путь, ещё числящийся за соседом.
    // Дверь на этом останавливается — и останавливается ОДИНАКОВО, а это и был
    // предмет задачи: исход перестал зависеть от порядка записей.
    async function swapped(order: readonly string[]): Promise<Consumer> {
      const box = installDevbox({ config: configOf(order) });
      box.installSource({ ...AGENTS, layout: [AGENTS.layout[1]] });
      box.installSource({
        ...SUCCESSOR,
        layout: [{ src: 'harness.yaml', dest: HARNESS, render: false }],
        templates: { 'harness.yaml': 'product: baser\n' },
      });
      await run({ command: 'apply', ...box.door });

      // Обмен: каждый объявил то, что лежит за соседом.
      box.installSource({
        ...AGENTS,
        layout: [{ src: 'harness.yaml.ejs', dest: HARNESS }],
      });
      box.installSource(SUCCESSOR);
      return box;
    }

    const first = await swapped([AGENTS_PACKAGE, SUCCESSOR_PACKAGE]);
    const forward = await run({ command: 'apply', ...first.door });
    first.cleanup();

    consumer = await swapped([SUCCESSOR_PACKAGE, AGENTS_PACKAGE]);
    const backward = await run({ command: 'apply', ...consumer.door });

    expect(forward.status).toBe('blocked');
    expect(backward.status).toBe('blocked');
    // На диск не ушло ничего — отказ безопасен, как и был.
    expect(consumer.read(POLICY)).toBe(POLICY_BODY);
  });
});

describe('подтверждение адресуется своему обвесу', () => {
  it('согласие по чужому артефакту не читается соседом как опечатка', async () => {
    // Оба артефакта на месте чужими, подтверждён один — девбоксов.
    consumer = installDevbox({
      config: configOf([DEVBOX_PACKAGE, AGENTS_PACKAGE]),
      existing: {
        [DEVCONTAINER]: '{ "name": "мой старый девбокс" }\n',
        [HARNESS]: 'product: чужой\n',
      },
    });
    consumer.installSource(AGENTS);

    const result = await run({
      command: 'plan',
      ...consumer.door,
      confirm: [DEVCONTAINER],
    });

    // Плагин агентов про `.devcontainer` не знает ничего — и молчит про него.
    // «В моей раскладке такого нет» было бы верно по его плану и неверно по
    // набору: артефакт объявлен, просто не им.
    expect(noticesOf(result, AGENTS_ID, 'confirmation-unused')).toEqual([]);
    // А у девбокса подтверждение сработало: чужой файл усыновляется.
    expect(
      runOf(result, DEVBOX_ID).plan?.steps.find(
        (step) => step.dest === DEVCONTAINER,
      )?.reason,
    ).toBe('adopted');
  });

  it('подтверждён путь, которого не кладёт НИКТО — опечатка названа', async () => {
    const box = twoTools();

    const result = await run({
      command: 'plan',
      ...box.door,
      confirm: ['.devcontainre/devcontainer.json'],
    });

    // Молчание тут было бы дефектом: человек уверен, что согласился, а согласие
    // ушло в пустоту. Называет это движок своим извещением, а не дверь.
    expect(
      result.runs.flatMap((item) => item.plan?.notices ?? []),
    ).toContainEqual(
      expect.objectContaining({
        kind: 'confirmation-unused',
        dest: '.devcontainre/devcontainer.json',
        detail: { confirmation: 'not-declared' },
      }),
    );
  });
});

describe('первая установка в непустой репозиторий: причина названа ОДИН раз', () => {
  it('пачка чужих файлов от двух обвесов — одно сообщение, а не два', async () => {
    // Ни конфига, ни служебной записи: baser здесь ещё не раскладывал, а файлы
    // на местах обоих обвесов уже лежат.
    consumer = installDevbox({
      existing: {
        [DEVCONTAINER]: '{ "name": "мой старый девбокс" }\n',
        [HARNESS]: 'product: чужой\n',
      },
    });
    consumer.installSource(AGENTS);

    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('blocked');
    // Причина у пачки общая — записи нет на весь репозиторий. Повторить её на
    // каждый обвес значило бы сказать одно и то же столько раз, сколько
    // инструментов поставлено.
    expect(
      result.problems.filter((problem) => problem.code === 'first-install'),
    ).toHaveLength(1);
    // И отказы движка при этом пришли от ОБОИХ: пачка не схлопнута до одного.
    expect(
      result.runs
        .flatMap((item) => item.plan?.conflicts ?? [])
        .map((c) => c.dest),
    ).toEqual(expect.arrayContaining([DEVCONTAINER, HARNESS]));
  });

  it('признак не сбивается соседом, легшим раньше в том же прогоне', async () => {
    // Девбокс ложится и кладёт служебную запись в дерево — а плагин агентов
    // после него упирается в чужой файл. Если признак смотреть на дерево, а не
    // на снимок до прогона, причина замолчала бы ровно здесь.
    consumer = installDevbox({ existing: { [HARNESS]: 'product: чужой\n' } });
    consumer.installSource(AGENTS);

    const result = await run({ command: 'apply', ...consumer.door });

    expect(result.status).toBe('blocked');
    expect(
      result.problems.find((problem) => problem.code === 'first-install'),
    ).toBeDefined();
    // Применение целиком либо никак: артефакты девбокса на диск не ушли.
    expect(consumer.exists(DEVCONTAINER)).toBe(false);
    expect(consumer.exists(MANIFEST_PATH)).toBe(false);
  });
});

describe('ответ один на все обвесы', () => {
  it('текст печатает КАЖДЫЙ обвес со своим движением и своим планом', async () => {
    const box = twoTools();

    const text = renderText(await run({ command: 'plan', ...box.door }));

    expect(text).toContain('обвесов: 2');
    expect(text).toContain(`обвес: ${DEVBOX_ID}`);
    expect(text).toContain(`обвес: ${AGENTS_ID}`);
    // Движение обоих обвесов на месте, и каждое стоит выше СВОЕГО плана.
    const agents = text.indexOf(`обвес: ${AGENTS_ID}`);
    expect(text.indexOf('product', agents)).toBeGreaterThan(agents);
    expect(text.indexOf('шагов:', agents)).toBeGreaterThan(
      text.indexOf('значения:', agents),
    );
    // Итог у прогона один, сколько бы инструментов ни стояло.
    expect(text.split('план применим').length - 1).toBe(1);
  });

  it('счётчик обвесов не печатается, когда обвес один', async () => {
    consumer = installDevbox({ config: configOf([DEVBOX_PACKAGE]) });

    const text = renderText(await run({ command: 'plan', ...consumer.door }));

    // «обвесов: 1» ничего не сообщает — строка, которая всегда одна и та же,
    // читается как шум и через неделю перестаёт читаться вовсе.
    expect(text).not.toContain('обвесов:');
    expect(text).toContain(`обвес: ${DEVBOX_ID}`);
  });

  it('plan не пишет НИЧЕГО, сколько бы обвесов ни стояло', async () => {
    const box = twoTools();

    const result = await run({ command: 'plan', ...box.door });

    expect(result.status).toBe('pending');
    expect(result.writes).toEqual([]);
    // Виртуальное дерево команда доводит до конца — на диск не уходит ничего, и
    // отчёта применения у неё нет вовсе.
    expect(result.runs.every((item) => item.applied === null)).toBe(true);
    expect(box.exists(DEVCONTAINER)).toBe(false);
    expect(box.exists(HARNESS)).toBe(false);
    expect(box.exists('baser.json')).toBe(true);
  });

  it('трейс двери называет обвес у каждой своей фазы', async () => {
    const box = twoTools();

    const result = await run({ command: 'plan', ...box.door });
    const rendered = result.trace.filter((span) => span.name === 'door.render');

    // Фазы повторяются по разу на обвес, и различить их можно данными, а не
    // порядком: медленный прогон обязан указывать на конкретный инструмент.
    expect(rendered.map((span) => span.detail?.['source'])).toEqual([
      DEVBOX_ID,
      AGENTS_ID,
    ]);
    expect(
      result.trace.find((span) => span.name === 'door.declarations')?.detail,
    ).toEqual({ sources: 2 });
  });
});
