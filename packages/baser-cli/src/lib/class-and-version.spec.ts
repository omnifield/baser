/**
 * ПРИЁМКА `tasker:BASER2-68` — дверь доносит до движка КЛАСС и ВЕРСИЮ.
 *
 * Обе вчерашние работы сделаны в соседней зоне и смержены: движок класс
 * исполняет (`tasker:BASER2-51`), паспорт укладки версию хранит
 * (`tasker:BASER2-52`). Но объявленный обвесом `placed-once` приезжал к движку
 * как `regenerated`, а версия не приезжала вовсе — слово терялось на стыке, и
 * обе работы не доезжали до человека.
 *
 * **Поэтому центральная проба здесь СКВОЗНАЯ, а не юнит на маппинг.** Юнит
 * доказал бы, что дверь кладёт в структуру нужное поле; вопрос же стоит иначе —
 * «доедет ли слово обвеса до поведения движка», и ответ на него даёт только
 * прогон целиком: обвес объявил → дверь позвала → файл на диске не переложен.
 * Маппинг, проверенный сам на себе, зеленел бы и на поле, которого движок не
 * читает.
 *
 * Проверяются ПЕРЕХОДЫ: устойчивое состояние сходится и без класса — ломается
 * оно ровно на «обвес выпустил новый шаблон» и «обвес поднял версию».
 */

import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installDevbox,
  manifestOf,
  DEVBOX_PACKAGE,
  type Consumer,
  type SourceSpec,
} from './devbox.fixture.js';
import { run } from './run.js';
import { renderText } from './report.js';
import type { DoorResult, SourceRun } from './result.js';

const DEVBOX_ID = 'omnifield/devbox';
const AGENTS_ID = 'omnifield/agent-harness';
const AGENTS_PACKAGE = '@omnifield/brain-harness';

/**
 * Конфиг роль-модели продукта — живой случай `placed-once` (`tasker:BASER2-51`).
 *
 * Плагин агентов кладёт файл, который дальше заполняет ПРОДУКТ: зоны, модели,
 * адреса сервисов. В этом самом репозитории он именно такой.
 */
const HARNESS = '.omnifield/harness.yaml';
/** А этот артефакт плагина — наш и перегенерируется: класса не объявляет. */
const POLICY = '.claude/agents/shared-policy.md';

const SEED = 'product: <%- product %>\n';
const POLICY_BODY = '# shared-policy — рамка ролей\n';

const AGENTS: SourceSpec = {
  packageName: AGENTS_PACKAGE,
  id: AGENTS_ID,
  title: 'Плагин агент-харнесса',
  settings: {
    product: { title: 'Имя продукта', type: 'string', default: 'baser' },
  },
  layout: [
    { src: 'harness.yaml.ejs', dest: HARNESS, class: 'placed-once' },
    { src: 'shared-policy.md', dest: POLICY, render: false },
  ],
  templates: { 'harness.yaml.ejs': SEED, 'shared-policy.md': POLICY_BODY },
};

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

function configOf(uses: readonly string[]): unknown {
  return { formVersion: 2, sources: uses.map((use) => ({ use })) };
}

/** Репозиторий, где стоит один плагин агентов — с обоими классами в раскладке. */
function withAgents(spec: SourceSpec = AGENTS): Consumer {
  consumer = installDevbox({
    config: configOf([spec.packageName]),
    declareDependency: false,
  });
  consumer.installSource(spec);
  return consumer;
}

function runOf(result: DoorResult, id: string): SourceRun {
  const found = result.runs.find((item) => item.source.id === id);
  if (found === undefined) {
    throw new Error(`прогона обвеса "${id}" в ответе нет`);
  }
  return found;
}

function recordOf(box: Consumer, dest: string) {
  return manifestOf(box).find((record) => record.dest === dest);
}

describe('класс артефакта доезжает до движка', () => {
  it('СКВОЗНОЕ: объявленный placed-once не перекладывается на втором прогоне', async () => {
    const box = withAgents();
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(HARNESS)).toBe('product: baser\n');

    // Человек заполнил файл под себя — ровно то, ради чего класс и заведён.
    box.write(HARNESS, 'product: baser\nzones:\n  cli: [packages/baser-cli]\n');
    // И обвес выпустил новую версию шаблона: для `regenerated` это железный
    // повод переложить файл, для `placed-once` — не повод вовсе.
    box.installSource({
      ...AGENTS,
      templates: {
        ...AGENTS.templates,
        'harness.yaml.ejs': 'product: <%- product %>\nnew: true\n',
      },
    });

    const second = await run({ command: 'apply', cwd: box.root });

    // Главное утверждение работы: работа человека на диске цела.
    expect(box.read(HARNESS)).toContain('zones:');
    expect(box.read(HARNESS)).not.toContain('new: true');
    // И это не «шаг был, но ничего не записал»: шага нет вовсе.
    expect(
      runOf(second, AGENTS_ID).plan?.steps.map((step) => step.dest),
    ).not.toContain(HARNESS);
    // Расходящимся план его тоже не называет: файл задумывался человеческим.
    expect(
      runOf(second, AGENTS_ID).plan?.steps.find(
        (step) => step.dest === HARNESS,
      ),
    ).toBeUndefined();

    // А соседний артефакт того же обвеса — наш, и он ДОГОНЯЕТ: класс адресный,
    // а не «этот обвес мы больше не трогаем».
    expect(box.read(POLICY)).toBe(POLICY_BODY);
  });

  it('класс попадает в паспорт укладки, и хеша у placed-once нет', async () => {
    const box = withAgents();

    await run({ command: 'apply', cwd: box.root });

    expect(recordOf(box, HARNESS)?.class).toBe('placed-once');
    // Записанный и никогда не сравниваемый хеш — половина имитации.
    expect(recordOf(box, HARNESS)?.hash).toBeUndefined();
    // Умолчание доезжает тоже: не объявивший класс артефакт — наш.
    expect(recordOf(box, POLICY)?.class).toBe('regenerated');
    expect(recordOf(box, POLICY)?.hash).toBeDefined();
  });

  it('правка placed-once руками флага не поднимает — прогон сходится', async () => {
    const box = withAgents();
    await run({ command: 'apply', cwd: box.root });
    box.write(HARNESS, 'product: чужой руками\n');

    const again = await run({ command: 'plan', cwd: box.root });

    expect(again.status).toBe('converged');
  });
});

describe('версия обвеса доезжает до паспорта укладки', () => {
  it('версия из манифеста пакета ложится в запись', async () => {
    const box = withAgents({ ...AGENTS, version: '1.4.2' });

    await run({ command: 'apply', cwd: box.root });

    expect(recordOf(box, POLICY)?.version).toBe('1.4.2');
    expect(recordOf(box, HARNESS)?.version).toBe('1.4.2');
  });

  it('ПЕРЕХОД: обвес поднял версию — расхождение названо, и названо ПОЛЕМ', async () => {
    const box = withAgents({ ...AGENTS, version: '1.4.2' });
    await run({ command: 'apply', cwd: box.root });

    // Содержимое то же самое — двинулась ровно версия. Молчание здесь означало
    // бы, что паспорт продолжает называть вчерашнюю версию.
    box.installSource({ ...AGENTS, version: '2.0.0' });
    const second = await run({ command: 'plan', cwd: box.root });

    const step = runOf(second, AGENTS_ID).plan?.steps.find(
      (item) => item.dest === POLICY,
    );
    expect(step?.reason).toBe('reclaimed');
    expect(step?.restated).toEqual(['version']);

    await run({ command: 'apply', cwd: box.root });
    expect(recordOf(box, POLICY)?.version).toBe('2.0.0');
  });

  it('версия живого обвеса доезжает так же, как у собранного руками', async () => {
    // Принятый пример зоны контрактов, а не сочинённый пакет: приёмка двери
    // идёт по настоящему обвесу.
    consumer = installDevbox({ config: configOf([DEVBOX_PACKAGE]) });

    const result = await run({ command: 'apply', cwd: consumer.root });

    const version = runOf(result, DEVBOX_ID).source.packageVersion;
    expect(version).not.toBeNull();
    expect(
      manifestOf(consumer).every((record) => record.version === version),
    ).toBe(true);
  });
});

describe('обвес версию НЕ назвал', () => {
  it('в паспорт ложится null, а не сочинённая версия', async () => {
    const box = withAgents({ ...AGENTS, version: null });

    await run({ command: 'apply', cwd: box.root });

    // `0.0.0` было бы утверждением о версии, которого обвес не делал, — и
    // именно на нём потом строилось бы «между твоей версией и новой было
    // ломающее изменение».
    expect(recordOf(box, POLICY)?.version).toBeNull();
  });

  it('дверь называет это вслух, а не показывает пустое место', async () => {
    const box = withAgents({ ...AGENTS, version: null });

    const result = await run({ command: 'plan', cwd: box.root });

    // Данными — читается гейтом.
    expect(runOf(result, AGENTS_ID).source.packageVersion).toBeNull();
    // Текстом — читается человеком. Молчаливый `@undefined` в строке пакета
    // отправлял бы искать поломку двери там, где её нет.
    const text = renderText(result);
    expect(text).toContain(`пакет ${AGENTS_PACKAGE}`);
    expect(text).not.toContain('@undefined');
    expect(text).not.toContain('@0.0.0');
    expect(text).toMatch(/версия не названа/);
  });

  it('трейс несёт версию каждого обвеса — телеметрия отвечает на «чем шёл прогон»', async () => {
    const box = withAgents({ ...AGENTS, version: '1.4.2' });

    const result = await run({ command: 'plan', cwd: box.root });

    // Спаны движка сюда не сведены и не будут: `plan.owned` мерит его работу, а
    // это — то, с чем дверь его позвала.
    const sources = result.trace.find((span) => span.name === 'door.sources');
    expect(sources?.detail?.['sources']).toEqual([
      { id: AGENTS_ID, version: '1.4.2', artifacts: 2, placedOnce: 1 },
    ]);
  });

  it('резолверу обвеса версия тоже не сочиняется', async () => {
    const box = withAgents({
      ...AGENTS,
      version: null,
      settings: {
        stamp: {
          title: 'Штамп версии',
          type: 'string',
          defaultFrom: './defaults.mjs#stamp',
        },
      },
      layout: [{ src: 'stamp.ejs', dest: '.omnifield/stamp.txt' }],
      templates: { 'stamp.ejs': '<%- stamp %>\n' },
    });
    // Резолвер, который смотрит на версию обвеса, — законный случай: из неё
    // считают теги образов и пины.
    writeFileSync(
      join(box.root, 'node_modules', AGENTS_PACKAGE, 'defaults.mjs'),
      'export const stamp = (ctx) => `[${ctx.source.version}]`;\n',
    );

    await run({ command: 'apply', cwd: box.root });

    // Пустое место видно и человеку, и глазом в диффе. `[0.0.0]` выглядело бы
    // настоящей версией — и уехало бы в артефакт правдоподобной неправдой.
    expect(box.read('.omnifield/stamp.txt')).toBe('[]\n');
  });

  it('трейс не сочиняет версию там, где её нет', async () => {
    const box = withAgents({ ...AGENTS, version: null });

    const result = await run({ command: 'plan', cwd: box.root });

    const sources = result.trace.find((span) => span.name === 'door.sources');
    expect(
      (sources?.detail?.['sources'] as { version: unknown }[])[0].version,
    ).toBeNull();
  });
});
