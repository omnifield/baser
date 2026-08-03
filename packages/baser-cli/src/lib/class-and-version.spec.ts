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
    await run({ command: 'apply', ...box.door });
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

    const second = await run({ command: 'apply', ...box.door });

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

    await run({ command: 'apply', ...box.door });

    expect(recordOf(box, HARNESS)?.class).toBe('placed-once');
    // Записанный и никогда не сравниваемый хеш — половина имитации.
    expect(recordOf(box, HARNESS)?.hash).toBeUndefined();
    // Умолчание доезжает тоже: не объявивший класс артефакт — наш.
    expect(recordOf(box, POLICY)?.class).toBe('regenerated');
    expect(recordOf(box, POLICY)?.hash).toBeDefined();
  });

  it('правка placed-once руками флага не поднимает — прогон сходится', async () => {
    const box = withAgents();
    await run({ command: 'apply', ...box.door });
    box.write(HARNESS, 'product: чужой руками\n');

    const again = await run({ command: 'plan', ...box.door });

    expect(again.status).toBe('converged');
  });
});

/**
 * ЦЕНА ПОДТВЕРЖДЕНИЯ НАЗЫВАЕТСЯ ПО КЛАССУ (`tasker:BASER2-123`).
 *
 * Текст обещал перезапись на оба класса сразу, а для `placed-once`
 * подтверждение делает другое: регистрирует артефакт в паспорте, не трогая
 * содержимое. Первый чужой обвес по этому тексту готовился потерять заполненный
 * руками `harness.yaml` — снял контрольную сумму, держал наготове откат через
 * git (`tasker:BASER2-121`, Н3).
 *
 * Проба берёт ЕГО случай целиком: файл заполнен руками, записи нет, дверь
 * отказывает. Проверяется не формулировка сама по себе, а обещание вместе с его
 * исполнением — текст и байты на диске в одном прогоне. Текст, проверенный
 * отдельно от поведения, ровно так и разъезжается с ним.
 */
describe('отказ называет, что подтверждение сделает с содержимым', () => {
  /** Заполненный руками конфиг — то, что человек боится потерять. */
  const MINE = 'product: brainer\nzones:\n  cli: [packages/brainer-cli]\n';

  /** Репозиторий, где файлы уже лежат, а baser здесь никогда не был. */
  function occupied(existing: Readonly<Record<string, string>>): Consumer {
    consumer = installDevbox({ declareDependency: false, existing });
    consumer.installSource(AGENTS);
    return consumer;
  }

  function firstInstall(result: DoorResult): string {
    return (
      result.problems.find((problem) => problem.code === 'first-install')
        ?.message ?? ''
    );
  }

  it('ТОЛЬКО placed-once: обещано не трогать содержимое — и оно цело', async () => {
    const box = occupied({ [HARNESS]: MINE });

    const blocked = await run({ command: 'plan', ...box.door });
    const message = firstInstall(blocked);

    expect(blocked.status).toBe('blocked');
    // Главное, ради чего заход: обещание перезаписи снято там, где перезаписи
    // не будет. Испуг тут стоит человеку либо отката, которого не потребуется,
    // либо застревания на конфликте навсегда.
    expect(message).toContain('СОДЕРЖИМОЕ НЕ ИЗМЕНИТСЯ');
    expect(message).toContain('паспорт укладки');
    expect(message).not.toContain('заменена целиком');
    expect(message).not.toContain('СБОРКОЙ ОТ ДЕФОЛТОВ');
    // И про сборку от дефолтов не говорится тоже: собирать тут нечего, а
    // названная цена, которой нет, пугает ровно так же, как настоящая.
    expect(message).not.toContain('не попадает НИЧЕГО');

    // Обещание в тексте — такой же контракт, как код: исполняем его тем же
    // прогоном, а не верим на слово.
    const fixed = await run({
      command: 'apply',
      ...box.door,
      confirm: [HARNESS],
    });

    expect(fixed.status).toBe('applied');
    // Байт в байт: у заявителя эта проверка была контрольной суммой руками.
    expect(box.read(HARNESS)).toBe(MINE);
    // Владение при этом перешло — иначе следующий прогон отказал бы снова.
    expect(recordOf(box, HARNESS)?.class).toBe('placed-once');
    expect((await run({ command: 'plan', ...box.door })).status).toBe(
      'converged',
    );
  });

  it('ОБА класса разом: цена названа поимённо, а не средним по больнице', async () => {
    const box = occupied({ [HARNESS]: MINE, [POLICY]: '# моя рамка\n' });

    const blocked = await run({ command: 'plan', ...box.door });
    const message = firstInstall(blocked);

    // Подтверждают поимённо — значит и цена обязана быть поимённой: «часть
    // заменится, часть нет» без списка оставляет человека там же, откуда он
    // пришёл.
    expect(message).toContain(HARNESS);
    expect(message).toContain(POLICY);
    expect(message).toContain('СОДЕРЖИМОЕ НЕ ИЗМЕНИТСЯ');
    expect(message).toContain('заменена целиком');
    // И сборка от дефолтов названа адресно: она про перегенерируемые, а не про
    // всё, во что целится обвес.
    expect(message).toContain('на месте перегенерируемых');

    const fixed = await run({
      command: 'apply',
      ...box.door,
      confirm: [HARNESS, POLICY],
    });

    expect(fixed.status).toBe('applied');
    expect(box.read(HARNESS)).toBe(MINE);
    // А перегенерируемый действительно заменён — обещание работает в обе
    // стороны, и вторая тут так же важна, как первая.
    expect(box.read(POLICY)).toBe(POLICY_BODY);
  });
});

/**
 * ТРЕТЬЕ СОСТОЯНИЕ: ЗАПИСЬ ЕСТЬ, А ЭТИХ ПУТЕЙ В НЕЙ НЕТ (`tasker:BASER2-134`).
 *
 * Живой случай weber (`tasker:BASER2-133`): девбокс стоит и раскладывает давно,
 * запись на месте и верна, а ВТОРОЙ обвес целится в файлы, заполненные руками.
 * Отказы движка пришли, отказа двери не было ни одного — и класс спорных
 * артефактов человек вытащил ДЕДУКЦИЕЙ по счётчику в трейсе, хотя справка
 * обещает, что его назовёт отказ.
 *
 * Оба прежних кода тут молчали по построению: они привязаны к РЕПОЗИТОРИЮ
 * («ни конфига, ни записи» · «конфиг есть, записи нет»), а это состояние про
 * ПУТИ. Перенастроить `first-install` было нельзя — он выпущен со смыслом
 * «репозиторий девственный», и смена смысла выпущенного слова обманула бы его
 * читателя молча.
 *
 * Проба берёт случай целиком и на СМЕШАННОМ наборе: часть путей `placed-once`,
 * часть `regenerated`. Иначе не видно главного — что класс берётся из объявления
 * целящегося обвеса, а не из своей карты.
 */
describe('второй обвес при живой записи: отказ есть, и он называет класс', () => {
  const MINE = 'product: weber\nzones:\n  cli: [packages/weber-cli]\n';
  const THEIR_POLICY = '# моя рамка\n';

  /** Девбокс разложен и запись на месте; вторым объявлен плагин агентов. */
  async function second(): Promise<Consumer> {
    consumer = installDevbox({ config: configOf([DEVBOX_PACKAGE]) });
    await run({ command: 'apply', ...consumer.door });

    // Файлы, заполненные руками, — ровно те, про которые стоял вопрос.
    consumer.write(HARNESS, MINE);
    consumer.write(POLICY, THEIR_POLICY);
    consumer.installSource(AGENTS);
    consumer.write(
      'baser.json',
      `${JSON.stringify(configOf([DEVBOX_PACKAGE, AGENTS_PACKAGE]), null, 2)}\n`,
    );
    return consumer;
  }

  function unrecorded(result: DoorResult): string {
    return (
      result.problems.find((problem) => problem.code === 'unrecorded-dest')
        ?.message ?? ''
    );
  }

  it('КЛАСС ЧИТАЕТСЯ, а не выводится по косвенным признакам', async () => {
    const box = await second();

    const blocked = await run({ command: 'plan', ...box.door });
    const message = unrecorded(blocked);

    expect(blocked.status).toBe('blocked');
    // Вопрос заявителя был ровно один: «отдать во владение — значит ли потерять
    // содержимое?». Ответ на него теперь в тексте, и он поимённый.
    expect(message).toContain(HARNESS);
    expect(message).toContain('СОДЕРЖИМОЕ НЕ ИЗМЕНИТСЯ');
    expect(message).toContain(POLICY);
    expect(message).toContain('заменена целиком');
    // Смешанный набор называется врозь, а не средним по больнице.
    expect(message).toContain('классы у них разные');
    expect(message).toContain('на месте перегенерируемых');
  });

  it('не посылает восстанавливать запись — она на месте и верна', async () => {
    // Разница между этим кодом и `manifest-missing` вся тут: там верное
    // действие «восстанови из истории», здесь восстанавливать нечего. Уверенный
    // указатель не туда хуже отсутствующего (`tasker:BASER2-28`).
    const box = await second();

    const blocked = await run({ command: 'plan', ...box.door });

    expect(blocked.problems.map((problem) => problem.code)).toEqual([
      'unrecorded-dest',
    ]);
    expect(unrecorded(blocked)).toContain('восстанавливать нечего');
    expect(unrecorded(blocked)).not.toContain('из истории');
    // И это не первая установка: baser в этом репозитории раскладывает давно.
    expect(unrecorded(blocked)).not.toContain('первая установка');
  });

  it('называет, КТО целится: «сними обвес» без имени — снимать наугад', async () => {
    const box = await second();

    const message = unrecorded(await run({ command: 'plan', ...box.door }));

    expect(message).toContain(`"${AGENTS_ID}"`);
    // Соседа, который тут раскладывает законно, отказ не приплетает.
    expect(message).not.toContain(DEVBOX_ID);
  });

  it('обещание исполняется тем же прогоном: подтвердили — и байты целы', async () => {
    // Обещание в тексте такой же контракт, как код. Текст, проверенный отдельно
    // от поведения, ровно так с ним и разъезжается.
    const box = await second();

    const fixed = await run({
      command: 'apply',
      ...box.door,
      confirm: [HARNESS, POLICY],
    });

    expect(fixed.status).toBe('applied');
    expect(box.read(HARNESS)).toBe(MINE);
    expect(box.read(POLICY)).toBe(POLICY_BODY);
    // Владение перешло — следующий прогон сходится, а не отказывает снова.
    expect((await run({ command: 'plan', ...box.door })).status).toBe(
      'converged',
    );
  });

  it('спорных путей нет — отказа нет: он не заготовка на каждый прогон', async () => {
    // Узость обещания. Тот же репозиторий с двумя обвесами, но пути свободны:
    // сообщение, которое видит каждый, за неделю перестаёт читаться.
    consumer = installDevbox({ config: configOf([DEVBOX_PACKAGE]) });
    await run({ command: 'apply', ...consumer.door });
    consumer.installSource(AGENTS);
    consumer.write(
      'baser.json',
      `${JSON.stringify(configOf([DEVBOX_PACKAGE, AGENTS_PACKAGE]), null, 2)}\n`,
    );

    const result = await run({ command: 'plan', ...consumer.door });

    expect(
      result.problems.some((problem) => problem.code === 'unrecorded-dest'),
    ).toBe(false);
  });
});

/**
 * У КЛАССА ОДИН ИСТОЧНИК ТАМ, ГДЕ ДВИЖОК ЕГО СКАЗАЛ (`tasker:BASER2-143`).
 *
 * Движок называет класс полем записи конфликта (`tasker:BASER2-141`) — он его
 * исполняет, значит он его и знает. Дверь до этой правки считала его сама,
 * пересечением раскладок с путями отказов: два источника одной истины, которые
 * сегодня отвечают одинаково и разойдутся молча.
 *
 * **Чего эта проба НЕ может и что вместо этого делает.** Развести ответы
 * поведением сегодня нечем: класс в конфликте движок выводит из той же записи
 * раскладки, которую читала дверь, — прогон, где они расходятся, не собирается.
 * Поэтому проба берёт источником истины ОТВЕТ ДВИЖКА и пинует ОТНОШЕНИЕ: пути,
 * названные в тексте положенными однажды, обязаны быть ровно теми, которые
 * назвал полем `class` он. Дверь, вернувшаяся к собственному счёту, покраснеет
 * в тот день, когда счёты разойдутся, — а не промолчит.
 *
 * Оба конца границы закрыты врозь, потому что и правило двустороннее: есть
 * отказ — класс из него; отказа нет — дверь считает сама, спросить некого.
 */
describe('класс у отказов двери — слово движка, а не свой счёт', () => {
  const MINE = 'product: weber\nzones:\n  cli: [packages/weber-cli]\n';

  /** Смешанный набор: `placed-once` и `regenerated` в одном отказе. */
  async function contested(): Promise<Consumer> {
    consumer = installDevbox({ declareDependency: false, existing: {} });
    consumer.installSource(AGENTS);
    consumer.write(HARNESS, MINE);
    consumer.write(POLICY, '# моя рамка\n');
    return consumer;
  }

  it('КОНЕЦ ПЕРВЫЙ: движок класс назвал — текст говорит ровно его слово', async () => {
    const box = await contested();

    const blocked = await run({ command: 'plan', ...box.door });
    const conflicts = (
      runOf(blocked, AGENTS_ID).plan?.conflicts ?? []
    ).filter((conflict) => conflict.kind === 'foreign-dest');

    // Вход двери существует: без него разговора нет вовсе, и молчаливое
    // «поля не оказалось» вернуло бы дверь к собственному счёту незаметно.
    expect(conflicts.length).toBeGreaterThan(0);
    for (const conflict of conflicts) {
      expect(conflict.class).toBeDefined();
    }

    // Ожидание строится ИЗ ОТВЕТА ДВИЖКА, а не из объявления обвеса: иначе
    // проба сверяла бы дверь с тем же материалом, от которого она уходит.
    const once = conflicts
      .filter((conflict) => conflict.class === 'placed-once')
      .map((conflict) => conflict.dest);
    const regenerated = conflicts
      .filter((conflict) => conflict.class !== 'placed-once')
      .map((conflict) => conflict.dest);
    expect(once).toEqual([HARNESS]);
    expect(regenerated).toEqual([POLICY]);

    const message =
      blocked.problems.find((problem) => problem.code === 'first-install')
        ?.message ?? '';

    // Цена названа врозь и поимённо — и стороны совпадают со словом движка.
    expect(message).toContain(`Положенные однажды (${once.join(' · ')})`);
    expect(message).toContain(`Перегенерируемые (${regenerated.join(' · ')})`);
    expect(message).toContain('СОДЕРЖИМОЕ НЕ ИЗМЕНИТСЯ');

    // И второй читатель того же слова — блок расхождения: `placed-once` в него
    // не попадает вовсе, потому что содержимое такого артефакта не трогают.
    const differences = runOf(blocked, AGENTS_ID).differences.map(
      (item) => item.dest,
    );
    expect(differences).toEqual(regenerated);
  });

  it('КОНЕЦ ВТОРОЙ: отказа нет — дверь считает класс сама, спросить некого', async () => {
    // Телеметрия «чем шёл прогон» пишется ДО всякого плана: конфликтов не
    // существует, а ответ нужен. Собственное вычисление здесь не остаток и не
    // дубль — снести его как повтор значит унести счётчик насовсем.
    const box = withAgents();

    const result = await run({ command: 'apply', ...box.door });

    expect(
      runOf(result, AGENTS_ID).plan?.conflicts.filter(
        (conflict) => conflict.kind === 'foreign-dest',
      ),
    ).toEqual([]);
    const sources = result.trace.find((span) => span.name === 'door.sources');
    expect(
      (sources?.detail?.['sources'] as { placedOnce: number }[])[0].placedOnce,
    ).toBe(1);
  });
});

describe('версия обвеса доезжает до паспорта укладки', () => {
  it('версия из манифеста пакета ложится в запись', async () => {
    const box = withAgents({ ...AGENTS, version: '1.4.2' });

    await run({ command: 'apply', ...box.door });

    expect(recordOf(box, POLICY)?.version).toBe('1.4.2');
    expect(recordOf(box, HARNESS)?.version).toBe('1.4.2');
  });

  it('ПЕРЕХОД: обвес поднял версию — расхождение названо, и названо ПОЛЕМ', async () => {
    const box = withAgents({ ...AGENTS, version: '1.4.2' });
    await run({ command: 'apply', ...box.door });

    // Содержимое то же самое — двинулась ровно версия. Молчание здесь означало
    // бы, что паспорт продолжает называть вчерашнюю версию.
    box.installSource({ ...AGENTS, version: '2.0.0' });
    const second = await run({ command: 'plan', ...box.door });

    const step = runOf(second, AGENTS_ID).plan?.steps.find(
      (item) => item.dest === POLICY,
    );
    expect(step?.reason).toBe('reclaimed');
    expect(step?.restated).toEqual(['version']);

    await run({ command: 'apply', ...box.door });
    expect(recordOf(box, POLICY)?.version).toBe('2.0.0');
  });

  it('версия живого обвеса доезжает так же, как у собранного руками', async () => {
    // Принятый пример зоны контрактов, а не сочинённый пакет: приёмка двери
    // идёт по настоящему обвесу.
    consumer = installDevbox({ config: configOf([DEVBOX_PACKAGE]) });

    const result = await run({ command: 'apply', ...consumer.door });

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

    await run({ command: 'apply', ...box.door });

    // `0.0.0` было бы утверждением о версии, которого обвес не делал, — и
    // именно на нём потом строилось бы «между твоей версией и новой было
    // ломающее изменение».
    expect(recordOf(box, POLICY)?.version).toBeNull();
  });

  it('дверь называет это вслух, а не показывает пустое место', async () => {
    const box = withAgents({ ...AGENTS, version: null });

    const result = await run({ command: 'plan', ...box.door });

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

    const result = await run({ command: 'plan', ...box.door });

    // Спаны движка сюда не сведены и не будут: `plan.owned` мерит его работу, а
    // это — то, с чем дверь его позвала.
    const sources = result.trace.find((span) => span.name === 'door.sources');
    expect(sources?.detail?.['sources']).toEqual([
      {
        id: AGENTS_ID,
        version: '1.4.2',
        // Откуда поставка и ходили ли за ней на склад — первое, что спрашивают,
        // когда «у меня разложилось иначе, чем у него» (`tasker:BASER2-146`).
        origin: 'local',
        fetched: false,
        artifacts: 2,
        placedOnce: 1,
      },
    ]);
  });

  it('резолверу приезжает null, а не пустая строка, изображавшая его', async () => {
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
    // считают теги образов и пины. И различить «версии нет» он обязан ПРОВЕРКОЙ,
    // а не угадыванием по пустоте.
    writeFileSync(
      join(box.root, 'node_modules', AGENTS_PACKAGE, 'defaults.mjs'),
      'export const stamp = (ctx) =>\n' +
        "  ctx.source.version === null ? 'версия не названа' : ctx.source.version;\n",
    );

    await run({ command: 'apply', ...box.door });

    // Обход снят: пока `ResolverContext.source.version` был обязательной
    // строкой, дверь изображала отсутствие пустой строкой — и резолвер не мог
    // отличить «не назвали» от «назвали пустым». Форма догнала
    // (`tasker:BASER2-69`), у одного факта одна форма во всех трёх зонах.
    //
    // Проба утверждает ПОВЕДЕНИЕ, а не тип: `''` присваивается в `string | null`
    // молча, и типы на возврат обхода не покраснели бы.
    expect(box.read('.omnifield/stamp.txt')).toBe('версия не названа\n');
  });

  it('трейс не сочиняет версию там, где её нет', async () => {
    const box = withAgents({ ...AGENTS, version: null });

    const result = await run({ command: 'plan', ...box.door });

    const sources = result.trace.find((span) => span.name === 'door.sources');
    expect(
      (sources?.detail?.['sources'] as { version: unknown }[])[0].version,
    ).toBeNull();
  });
});
