/**
 * ПРИЁМКА ИТЕРАЦИИ 1 — станок кладёт девбокс в живой репозиторий.
 *
 * Не unit и не мок: обвес девбокса ставится в `node_modules` чистого временного
 * репозитория ровно так, как его положил бы npm, дверь зовётся своей публичной
 * поверхностью, и файлы уезжают на настоящий диск. Эталон — ЖИВОЙ
 * `.devcontainer` этого репозитория (`tasker:BASER2-18`).
 *
 * Проверяются ПЕРЕХОДЫ, а не устойчивые состояния: в устойчивом состоянии всё
 * сходится с первого раза, а дефекты этого продукта трижды лежали в переходах.
 * Поэтому каждый describe ниже — это событие, а не снимок.
 *
 * ── ЧТО ИЗМЕНИЛОСЬ ─────────────────────────────────────────────────────────
 *
 * Прошлый прогон этого файла упирался в два блокера, и оба сходились в одно
 * место: служебная запись жила ВНУТРИ артефакта. Запись уехала в
 * `baser.lock.json` (`tasker:BASER2-4`), блокеры закрылись — и закрылись не
 * починкой, а тем, что механизм, который их порождал, перестал существовать.
 *
 * **С этого места приёмка идёт по НАСТОЯЩЕЙ раскладке обвеса, без обходов**:
 * `.ejs` ложится прямо в `.devcontainer/devcontainer.json`, тело артефакта
 * равно телу шаблона, владение читается из записи сбоку. Цель итерации —
 * «поставил пакет → позвал команду → `.devcontainer` лёг» — впервые
 * проверяется целиком (`tasker:BASER2-18`).
 *
 * ── ЧТО ИЗМЕНИЛОСЬ ЕЩЁ РАЗ (`tasker:BASER2-26`) ─────────────────────────────
 *
 * Под приёмкой сменились ОБА основания, и оба в одну сторону — в сторону
 * настоящего.
 *
 * 1. **Обвес.** Ставится тарбол пакета `@omnifield/baser-devbox`, а не копия
 *    примера из чужой зоны. Копия успела разъехаться с пакетом, и разъезд был
 *    невидим: обе стороны зеленели, потому что каждая проверяла свою половину.
 *
 * 2. **Эталон.** Живой `.devcontainer` этого репозитория больше НЕ написан
 *    руками — его кладёт тот же станок (догфуд, коммит «baser садится на
 *    собственный станок»). Утверждения про рукописную вторую строку здесь
 *    больше нет — не подкручено, а снято вместе со своей причиной.
 *
 * От этого сверка не ослабла, а стала сильнее: раньше она означала «совпало с
 * тем, что человек написал, кроме заранее прощённых строк», теперь — **«этот
 * репозиторий действительно живёт на своём же станке»**, и совпадение полное,
 * байт в байт, без единого исключения.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installDevbox,
  liveArtifact,
  liveTuning,
  manifestOf,
  soleRun,
  BUMPED_RESOLVERS,
  DEVBOX_PACKAGE,
  MOVED_NODE,
  PINNED_NODE,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { MANIFEST_PATH } from '@omnifield/baser-materialize';

const LOCK = '.devcontainer/devcontainer-lock.json';
/** Живой артефакт девбокса — он же настоящий `dest` обвеса, без подмен. */
const LIVE = '.devcontainer/devcontainer.json';

const DEVBOX_ID = 'omnifield/devbox';

/** `baser.json` формы 2 — ТОЛЬКО перечень поставленного. */
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

/** Выбор пресета живёт в файле на инструмент (`tasker:BASER2-10` §3). */
const TUNED = { [DEVBOX_ID]: { presets: ['omnifield'] } };

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Чистое дерево с поставленным обвесом девбокса. */
function clean(options: { existing?: Record<string, string> } = {}): Consumer {
  consumer = installDevbox({ config: CONFIG, tuning: TUNED, ...options });
  return consumer;
}

describe('ЦЕЛЬ ИТЕРАЦИИ: поставил пакет → позвал команду → .devcontainer лёг', () => {
  it('живой devcontainer.json (JSONC) ложится — класс файла больше не условие владения', async () => {
    const box = clean();

    const result = await run({ command: 'apply', cwd: box.root });

    // Комментарии разрешены спецификацией Dev Containers, и обвес их несёт.
    // Раньше это упиралось в `unmarkable-dest`: доказать владение JSON-файлом
    // движок умел только ключом `"//"` в разобранном JSON. Теперь запись лежит
    // сбоку, содержимое движок не трогает — и файл ложится как есть.
    expect(result.status).toBe('applied');
    expect(box.exists(LIVE)).toBe(true);
    expect(box.read(LIVE)).toContain('// baser-devbox — Ф2');

    // Второй прогон сходится: артефакт с комментариями опознаётся своим.
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
  });

  it('render: false ложится БАЙТ В БАЙТ — движок содержимого не трогает', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });

    const template = readFileSync(
      join(box.sourceRoot, 'template/devcontainer-lock.json'),
      'utf-8',
    );

    // Пин toolchain по digest обязан лечь как есть. Это не поблажка, а
    // следствие переезда записи: вписывать в артефакт стало нечего.
    expect(box.read(LOCK)).toBe(template);
  });
});

describe('СВЕРКА С ЖИВЫМ РЕПОЗИТОРИЕМ: baser стоит на своём же станке', () => {
  /**
   * Тот же обвес и ТЕ ЖЕ настройки, на которых живёт этот репозиторий.
   *
   * Оба конца берутся живыми: пакет — тарболом, значения — из
   * `.omnifield/omnifield-devbox.yaml`. Пресета здесь нет намеренно: живой
   * репозиторий выбрал значения поимённо, и проба обязана повторять его выбор,
   * а не свой.
   */
  function asLive(): Consumer {
    consumer = installDevbox({
      config: CONFIG,
      tuning: { [DEVBOX_ID]: liveTuning(DEVBOX_ID) },
    });
    return consumer;
  }

  it('оба артефакта совпадают с живыми БАЙТ В БАЙТ, без единого исключения', async () => {
    const box = asLive();

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    // Ни `withoutLine`, ни списка прощённых строк: пока живой файл был
    // рукописным, исключения были честной ценой сверки. Файл кладёт станок —
    // цена исчезла вместе с причиной, и утверждение стало полным.
    expect(box.read(LIVE)).toBe(liveArtifact(LIVE));
    expect(box.read(LOCK)).toBe(liveArtifact(LOCK));
  });

  it('живой файл ВЕДЁТ станок — это сказано паспортом укладки, а не верой', async () => {
    // Байтовое совпадение само по себе не отличает «репозиторий на станке» от
    // «человек аккуратно переписал вывод руками». Отличает запись сбоку: она
    // существует в живом репозитории и называет владельца.
    const lock = JSON.parse(liveArtifact('baser.lock.json')) as {
      artifacts: { dest: string; source: string; class: string }[];
    };
    const record = lock.artifacts.find((item) => item.dest === LIVE);

    expect(record?.source).toBe(DEVBOX_ID);
    expect(record?.class).toBe('regenerated');
    // И обвес объявлен поставленным — то есть станок сюда доедет и завтра.
    expect(
      (JSON.parse(liveArtifact('baser.json')) as { sources: unknown[] })
        .sources,
    ).toContainEqual({ use: DEVBOX_PACKAGE });
  });
});

describe('переход: чистое дерево → обвес разложен', () => {
  it('артефакт лёг на ДИСК и записан в манифест', async () => {
    const box = clean();

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    expect(result.writes.map((write) => write.path).sort()).toEqual(
      [LOCK, LIVE, MANIFEST_PATH].sort(),
    );

    // Владение доказуемо — но запиской СБОКУ, а не наклейкой внутри файла.
    expect(manifestOf(box)).toContainEqual(
      expect.objectContaining({
        dest: LIVE,
        src: 'devcontainer.json.ejs',
        source: 'omnifield/devbox',
      }),
    );
  });

  it('подстановка не экранирует под HTML — кавычка осталась кавычкой', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    const landed = box.read(LIVE) ?? '';

    expect(landed).not.toContain('&#34;');
    expect(landed).toContain('"--network=omnifield-gateway"');
  });
});

describe('переход: тот же прогон второй раз', () => {
  it('сошлось — ни шага, и диск не тронут', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    const after = box.read(LIVE);

    const again = await run({ command: 'apply', cwd: box.root });

    // Операционное определение сходимости: второй прогон не порождает шагов.
    expect(again.status).toBe('converged');
    expect(soleRun(again).plan?.steps).toEqual([]);
    expect(again.writes).toEqual([]);
    expect(box.read(LIVE)).toBe(after);
  });
});

describe('переход: пресет убран из файла настроек', () => {
  it('значение возвращается к дефолту обвеса, и артефакт догоняет', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('--network=omnifield-gateway');

    // Пресет убирается ТАМ, где человек его и выбирал, — в файле на инструмент.
    box.tune(DEVBOX_ID, { presets: [] });

    const plan = await run({ command: 'plan', cwd: box.root });
    const network = soleRun(plan).settings.find(
      (setting) => setting.key === 'network',
    );
    // Цепочка укоротилась до одного звена: движения больше нет.
    expect(network?.chain).toEqual([{ kind: 'default', value: null }]);
    expect(network?.moved).toBe(false);

    await run({ command: 'apply', cwd: box.root });
    // Артефакт перегенерирован целиком: слой пресета не развернулся вовсе.
    expect(box.read(LIVE)).not.toContain('--network=');
    expect(box.read(LIVE)).not.toContain('mounts');
  });
});

describe('переход: обвес обновился, дефолт поднялся', () => {
  it('ДЕФОЛТ ВЫПУСКА: незаполненная версия — та, что пришпилена обвесом', async () => {
    // Единственное место, где число рантайма утверждается прямо. Выпустится
    // обвес с другим пином — покраснеет эта проба и назовёт причину, а не
    // восемь чужих ожиданий, каждое из которых выглядит самостоятельным.
    const box = clean();

    const result = await run({ command: 'plan', cwd: box.root });

    const runtime = soleRun(result).settings.find(
      (setting) => setting.key === 'runtimeVersion',
    );
    expect(runtime?.value).toBe(PINNED_NODE);
    expect(runtime?.ours).toBe(true);
  });

  it('движение названо ДО применения, и артефакт догоняет эталон', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain(`typescript-node:${PINNED_NODE}`);

    box.updateResolvers(BUMPED_RESOLVERS);

    // Сначала ПЛАН: движение обязано быть названо до того, как что-то поедет.
    const plan = await run({ command: 'plan', cwd: box.root });
    const runtime = soleRun(plan).settings.find(
      (setting) => setting.key === 'runtimeVersion',
    );
    expect(runtime?.value).toBe(MOVED_NODE);
    expect(runtime?.ours).toBe(true);
    expect(soleRun(plan).plan?.steps[0].reason).toBe('diverged');
    // Названо — и не применено: команда `plan` дерева не трогает.
    expect(box.read(LIVE)).toContain(`typescript-node:${PINNED_NODE}`);

    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain(`typescript-node:${MOVED_NODE}`);
  });

  it('заполненное пользователем переживает обновление обвеса', async () => {
    consumer = installDevbox({
      config: CONFIG,
      tuning: {
        [DEVBOX_ID]: {
          presets: ['omnifield'],
          settings: { runtimeVersion: '20' },
        },
      },
    });
    await run({ command: 'apply', cwd: consumer.root });

    consumer.updateResolvers(BUMPED_RESOLVERS);
    await run({ command: 'apply', cwd: consumer.root });

    // Дефолт под ним уехал вперёд — значение осталось: подниматься неоткуда,
    // движок в конфиг пользователя не пишет.
    expect(consumer.read(LIVE)).toContain('typescript-node:20');
  });
});

describe('переход: артефакт правили руками', () => {
  it('перегенерируется целиком — правка не переживает, и это названо', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });

    const landed = box.read(LIVE) as string;
    box.write(LIVE, `${landed}\n// правка руками\n`);

    const plan = await run({ command: 'plan', cwd: box.root });
    const [step] = soleRun(plan).plan?.steps ?? [];

    expect(step.reason).toBe('diverged');
    // Потери названы ДО применения: прежнее содержимое едет в плане данными.
    expect(step.previous).toContain('правка руками');

    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toBe(landed);
  });
});

describe('переход: запись ушла из раскладки', () => {
  it('артефакт снимается с ДИСКА, а не только из виртуального дерева', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    expect(box.exists(LIVE)).toBe(true);

    box.updateSource((block) => {
      const layout = block['layout'] as { src: string }[];
      block['layout'] = layout.filter((item) => !item.src.endsWith('.ejs'));
    });

    const result = await run({ command: 'apply', cwd: box.root });

    expect(soleRun(result).plan?.steps[0].reason).toBe('orphan');
    expect(result.writes).toContainEqual({ path: LIVE, kind: 'DELETE' });
    // Сброс на ФС обязан уносить удаления так же, как записи.
    expect(box.exists(LIVE)).toBe(false);
    expect(box.exists(LOCK)).toBe(true);
    // И запись о снятом артефакте ушла вместе с ним: манифест, помнящий то,
    // чего нет, — это ровно та наклейка, которая устаревала и врала.
    expect(manifestOf(box).map((record) => record.dest)).toEqual([LOCK]);
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
  });
});

describe('переход: запись разошлась с объявлением, а содержимое то же', () => {
  it('приведение записи — ШАГ, а не тихая правка на применении', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    const landed = box.read(LIVE);

    // Тот же шаблон под другим именем: артефакт выйдет байт в байт тем же, а
    // запись начнёт утверждать не то, что объявлено сейчас.
    box.writeTemplate(
      'renamed.ejs',
      readFileSync(
        join(box.sourceRoot, 'template/devcontainer.json.ejs'),
        'utf-8',
      ),
    );
    box.updateSource((block) => {
      const layout = block['layout'] as { src: string }[];
      const entry = layout.find((item) => item.src.endsWith('.json.ejs'));
      if (entry) {
        entry.src = 'renamed.ejs';
      }
    });

    const plan = await run({ command: 'plan', cwd: box.root });

    // Совпадение содержимого — НЕ повод промолчать: план, скрывший работу,
    // которую всё равно сделает, рапортует сходимость там, где её нет (Д10).
    expect(
      soleRun(plan).plan?.steps.map((step) => `${step.kind}/${step.reason}`),
    ).toEqual(['record/reclaimed']);
    expect(plan.status).toBe('pending');

    const applied = await run({ command: 'apply', cwd: box.root });

    // Тронута ТОЛЬКО служебная запись: содержимое артефакта уже целевое.
    expect(applied.writes).toEqual([{ path: MANIFEST_PATH, kind: 'UPDATE' }]);
    expect(box.read(LIVE)).toBe(landed);
    expect(manifestOf(box)).toContainEqual(
      expect.objectContaining({ dest: LIVE, src: 'renamed.ejs' }),
    );
    // И сходится со второго прогона, а не колеблется вечно.
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
  });
});

describe('переход: на месте артефакта лежит чужой файл', () => {
  it('отказ вместо тихой перезаписи — и на диске остаётся чужое', async () => {
    const box = clean();
    box.write(LIVE, '// чужой файл\n{"name":"не наш"}\n');

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('blocked');
    expect(soleRun(result).plan?.conflicts[0].kind).toBe('foreign-dest');
    expect(box.read(LIVE)).toContain('не наш');
    // Применение целиком либо никак: соседний артефакт тоже не лёг.
    expect(box.exists(LOCK)).toBe(false);
  });

  it('подтверждение снимает отказ ПОИМЁННО и не масштабируется само', async () => {
    const box = clean();
    box.write(LIVE, '// чужой файл\n{"name":"не наш"}\n');
    box.write(LOCK, '{"features":{}}\n');

    // Подтверждаем ОДИН артефакт из двух чужих.
    const result = await run({
      command: 'apply',
      cwd: box.root,
      confirm: [LIVE],
    });

    // Согласие на один не стало согласием на соседний — план всё ещё блокирован.
    expect(result.status).toBe('blocked');
    expect(soleRun(result).plan?.conflicts.map((item) => item.dest)).toEqual([
      LOCK,
    ]);
    expect(box.read(LIVE)).toContain('не наш');

    // Подтверждаем оба — и оба берутся во владение как усыновлённые.
    const both = await run({
      command: 'apply',
      cwd: box.root,
      confirm: [LIVE, LOCK],
    });
    expect(both.status).toBe('applied');
    expect(
      soleRun(both).plan?.steps.every((step) => step.reason === 'adopted'),
    ).toBe(true);
    // Усыновление доказано записью сбоку — заглядывать внутрь файла незачем.
    expect(
      manifestOf(box)
        .map((record) => record.dest)
        .sort(),
    ).toEqual([LIVE, LOCK].sort());
  });
});

describe('переход: служебная запись потеряна или битая', () => {
  it('ПОТЕРЯНА: движок объявляет артефакты чужими, а причину называет дверь', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    expect(box.exists(MANIFEST_PATH)).toBe(true);

    // Файл обязан коммититься. Убрали — и владение стало недоказуемым.
    box.remove(MANIFEST_PATH);

    const result = await run({ command: 'apply', cwd: box.root });

    // Движок прав: без записи артефакты чужие, перезаписывать их молча нельзя.
    expect(result.status).toBe('blocked');
    expect(
      soleRun(result).plan?.conflicts.every(
        (conflict) => conflict.kind === 'foreign-dest',
      ),
    ).toBe(true);
    expect(box.read(LIVE)).toContain('baser-devbox');

    // Но пачка «файл уже существует» без причины — это молчание. Для движка
    // «записи нет» и «мы тут ничего не клали» одно состояние; отличить их
    // может только дверь, и она обязана это сказать.
    const named = result.problems.find(
      (problem) => problem.code === 'manifest-missing',
    );
    expect(named?.at).toBe(MANIFEST_PATH);
    // Сообщение начинается с НАБЛЮДЕНИЯ, а не с указания: конфиг есть, записи
    // нет — вот из чего вывод, что мы тут уже были.
    expect(named?.message).toContain('раскладка здесь уже была');
    expect(named?.message).toContain('обязана коммититься');
    expect(named?.message).toContain('Восстанови запись из истории');
    // Признак не абсолютен — конфиг можно написать и руками. Дверь этого не
    // скрывает и отдаёт человеку дешёвую проверку вместо второй догадки:
    // уверенный указатель не туда хуже отсутствующего.
    expect(named?.message).toContain('если в истории её нет');
    expect(named?.message).toContain('--confirm');
  });

  it('путь восстановления, который дверь ОБЕЩАЕТ в этом сообщении, работает', async () => {
    // Обещание в тексте отказа — такой же контракт, как код: непроверенное,
    // оно тихо протухнет, и человек пойдёт по нему в тупик.
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    box.remove(MANIFEST_PATH);

    const blocked = await run({ command: 'apply', cwd: box.root });
    const dests =
      soleRun(blocked).plan?.conflicts.map((conflict) => conflict.dest) ?? [];

    const fixed = await run({
      command: 'apply',
      cwd: box.root,
      confirm: dests,
    });

    expect(fixed.status).toBe('applied');
    expect(box.exists(MANIFEST_PATH)).toBe(true);
    // Запись родилась заново, и прогон следом сходится — владение вернулось.
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
    // Содержимое при этом не пострадало: усыновление, а не перезапись вслепую.
    expect(box.read(LIVE)).toContain('baser-devbox');
  });

  it('второй выход из того же сообщения работает: конфиг написан руками', async () => {
    // Остаточный случай признака: конфиг есть, но раскладки не было — его
    // написали руками, а файл на месте артефакта чужой. Дверь этого не
    // различает и не притворяется, что различает: она называет второй исход
    // прямо в сообщении, и он обязан работать так же буквально, как первый.
    consumer = installDevbox({
      config: CONFIG,
      tuning: TUNED,
      existing: { [LIVE]: '{\n  "name": "свой, руками"\n}\n' },
    });

    const blocked = await run({ command: 'plan', cwd: consumer.root });
    expect(
      blocked.problems.find((problem) => problem.code === 'manifest-missing')
        ?.message,
    ).toContain('файлы на этих местах не наши');

    const fixed = await run({
      command: 'apply',
      cwd: consumer.root,
      confirm: [LIVE],
    });

    expect(fixed.status).toBe('applied');
    expect(consumer.read(LIVE)).not.toContain('свой, руками');
    expect(manifestOf(consumer)).toContainEqual(
      expect.objectContaining({ dest: LIVE }),
    );
  });

  it('ПЕРВЫЙ ПРОГОН молчит: записи нет и там, а кричать не о чем', async () => {
    // То же отсутствие манифеста, но артефактов на диске нет — это норма, а не
    // потеря. Условие обязано их различать, иначе сообщение кричит каждому.
    const result = await run({ command: 'plan', cwd: clean().root });

    expect(result.problems).toEqual([]);
    expect(result.status).toBe('pending');
  });

  it('ПУСТОЙ РЕПОЗИТОРИЙ БЕЗ КОНФИГА молчит тоже', async () => {
    // Ветка «первой установки» не имеет права срабатывать там, где чужих файлов
    // нет: предупреждение, которое видит каждый новый потребитель, за неделю
    // перестаёт читаться.
    consumer = installDevbox();

    const result = await run({ command: 'plan', cwd: consumer.root });

    expect(result.config.existed).toBe(false);
    expect(result.problems).toEqual([]);
    expect(result.status).toBe('pending');
  });

  it('БИТАЯ: отказ движка приходит СВОИМ кодом, а не «что-то не так»', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });

    box.write(MANIFEST_PATH, '{ это не JSON\n');

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    // Код движка проброшен как есть: чинить это идут не туда, куда чинят
    // непригодную декларацию, поэтому один общий код был бы «ничего».
    expect(problem.code).toBe('manifest-unreadable');
    expect(problem.message).toContain('Восстанови файл из истории');
    // Адрес — куда идти чинить. Это сам файл, а не обвес: с объявлением всё в
    // порядке, и отправлять человека править его было бы ложным следом.
    expect(problem.at).toBe(MANIFEST_PATH);
    // И на диск не ушло ничего.
    expect(box.read(MANIFEST_PATH)).toBe('{ это не JSON\n');
  });
});

describe('ПЕРВАЯ УСТАНОВКА В НЕПУСТОЙ РЕПОЗИТОРИЙ', () => {
  /** Чужой `.devcontainer` от старого девбокса — как у weber. */
  const THEIRS = '{\n  "name": "мой старый девбокс"\n}\n';

  /** Живой репозиторий: свой файл лежит, baser здесь никогда не был. */
  function occupied(): Consumer {
    consumer = installDevbox({ existing: { [LIVE]: THEIRS } });
    return consumer;
  }

  it('это НЕ потеря: человека не посылают искать то, чего не было', async () => {
    const box = occupied();

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('blocked');
    const named = result.problems.find(
      (problem) => problem.code === 'first-install',
    );

    // Ровно тот дефект, который нашли на weber: тут раньше говорили
    // «восстанови из истории» про запись, которой никогда не существовало.
    expect(named).toBeDefined();
    expect(named?.message).not.toContain('из истории');
    expect(named?.message).not.toContain('пропала');
    expect(
      result.problems.some((problem) => problem.code === 'manifest-missing'),
    ).toBe(false);

    // Человек узнаёт главное: его файл цел и мы к нему не притронулись.
    expect(named?.message).toContain('НЕ ТРОНУЛИ');
    expect(named?.message).toContain('не поломка');
    expect(box.read(LIVE)).toBe(THEIRS);
  });

  it('оба выхода названы, и цена согласия названа вместе с ним', async () => {
    const result = await run({ command: 'plan', cwd: occupied().root });
    const message =
      result.problems.find((problem) => problem.code === 'first-install')
        ?.message ?? '';

    // Не «жми сюда, чтобы затереть своё»: оба пути стоят рядом, и у согласия
    // прямо названа цена — файл станет нашим и правки в нём не переживут.
    expect(message).toContain('решаешь ты');
    expect(message).toContain('--confirm');
    expect(message).toContain('правки руками в ней не переживут');
    expect(message).toContain('сними обвес');
  });

  it('ОБЕЩАНИЕ 1: согласился — файл стал нашим, и это видно', async () => {
    const box = occupied();

    const fixed = await run({
      command: 'apply',
      cwd: box.root,
      confirm: [LIVE],
    });

    expect(fixed.status).toBe('applied');
    // Обещали замену целиком — она и произошла, а не мердж с чужим файлом.
    expect(box.read(LIVE)).not.toContain('мой старый девбокс');
    expect(box.read(LIVE)).toContain('baser-devbox');
    // И обещали, что дальше файл ведёт обвес: запись это подтверждает.
    expect(manifestOf(box)).toContainEqual(
      expect.objectContaining({ dest: LIVE, source: 'omnifield/devbox' }),
    );
    expect((await run({ command: 'apply', cwd: box.root })).status).toBe(
      'converged',
    );
  });

  it('ОБЕЩАНИЕ 2: снял обвес — baser сюда больше не целится', async () => {
    const box = occupied();
    await run({ command: 'plan', cwd: box.root });

    // Второй выход из сообщения. Он должен работать так же буквально, как
    // первый, иначе выбор был бы предложен нечестно.
    box.remove('node_modules/@omnifield/baser-devbox');

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('no-sources');
    expect(result.problems).toEqual([]);
    expect(box.read(LIVE)).toBe(THEIRS);
    // И конфига после себя дверь не оставила: раскладывать было нечего.
    expect(box.exists('baser.json')).toBe(false);
  });
});
