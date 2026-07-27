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
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installDevbox,
  liveArtifact,
  manifestOf,
  DEVBOX_PACKAGE,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { MANIFEST_PATH } from '@omnifield/baser-materialize';

const LOCK = '.devcontainer/devcontainer-lock.json';
/** Живой артефакт девбокса — он же настоящий `dest` обвеса, без подмен. */
const LIVE = '.devcontainer/devcontainer.json';

const CONFIG = {
  formVersion: 1,
  sources: [{ use: DEVBOX_PACKAGE, presets: ['omnifield'] }],
};

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Чистое дерево с поставленным обвесом девбокса. */
function clean(options: { existing?: Record<string, string> } = {}): Consumer {
  consumer = installDevbox({ config: CONFIG, ...options });
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

describe('переход: чистое дерево → обвес разложен', () => {
  it('артефакт лёг на ДИСК, записан в манифест и сходится с живым эталоном', async () => {
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

    // Сверка с ЖИВЫМ файлом этого репозитория — теперь ПРЯМАЯ, снимать с
    // артефакта нечего. Единственное расхождение то же, что назвала проба
    // формы: во второй строке живого файла руками написано «baser devbox», а
    // обвес подставляет туда настройку `name`.
    const landed = box.read(LIVE) as string;
    expect(withoutLine(landed, 2)).toBe(withoutLine(liveArtifact(LIVE), 2));
    expect(landed.split('\n')[1]).toContain('baser-devbox');
    expect(liveArtifact(LIVE).split('\n')[1]).toContain('baser devbox');
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
    expect(again.plan?.steps).toEqual([]);
    expect(again.writes).toEqual([]);
    expect(box.read(LIVE)).toBe(after);
  });
});

describe('переход: пресет убран из конфига', () => {
  it('значение возвращается к дефолту обвеса, и артефакт догоняет', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('--network=omnifield-gateway');

    box.write(
      'baser.json',
      `${JSON.stringify(
        { formVersion: 1, sources: [{ use: DEVBOX_PACKAGE }] },
        null,
        2,
      )}\n`,
    );

    const plan = await run({ command: 'plan', cwd: box.root });
    const network = plan.settings.find((setting) => setting.key === 'network');
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
  const BUMPED = `
export function repoName(ctx) { return ctx.repo.name; }
export function devboxName(ctx) { return \`\${ctx.repo.name}-devbox\`; }
export function latestStableNode() { return '24'; }
`;

  it('движение названо ДО применения, и артефакт догоняет эталон', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('typescript-node:22');

    box.updateResolvers(BUMPED);

    // Сначала ПЛАН: движение обязано быть названо до того, как что-то поедет.
    const plan = await run({ command: 'plan', cwd: box.root });
    const runtime = plan.settings.find(
      (setting) => setting.key === 'runtimeVersion',
    );
    expect(runtime?.value).toBe('24');
    expect(runtime?.ours).toBe(true);
    expect(plan.plan?.steps[0].reason).toBe('diverged');
    // Названо — и не применено: команда `plan` дерева не трогает.
    expect(box.read(LIVE)).toContain('typescript-node:22');

    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('typescript-node:24');
  });

  it('заполненное пользователем переживает обновление обвеса', async () => {
    consumer = installDevbox({
      config: {
        formVersion: 1,
        sources: [
          {
            use: DEVBOX_PACKAGE,
            presets: ['omnifield'],
            settings: { runtimeVersion: '20' },
          },
        ],
      },
    });
    await run({ command: 'apply', cwd: consumer.root });

    consumer.updateResolvers(BUMPED);
    await run({ command: 'apply', cwd: consumer.root });

    // Дефолт под ним уехал на 24 — значение осталось: подниматься неоткуда,
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
    const [step] = plan.plan?.steps ?? [];

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

    expect(result.plan?.steps[0].reason).toBe('orphan');
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
      plan.plan?.steps.map((step) => `${step.kind}/${step.reason}`),
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
    expect(result.plan?.conflicts[0].kind).toBe('foreign-dest');
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
    expect(result.plan?.conflicts.map((item) => item.dest)).toEqual([LOCK]);
    expect(box.read(LIVE)).toContain('не наш');

    // Подтверждаем оба — и оба берутся во владение как усыновлённые.
    const both = await run({
      command: 'apply',
      cwd: box.root,
      confirm: [LIVE, LOCK],
    });
    expect(both.status).toBe('applied');
    expect(both.plan?.steps.every((step) => step.reason === 'adopted')).toBe(
      true,
    );
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
      result.plan?.conflicts.every(
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
    expect(named?.message).toContain('обязан коммититься');
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
      blocked.plan?.conflicts.map((conflict) => conflict.dest) ?? [];

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

  it('ПЕРВЫЙ ПРОГОН молчит: записи нет и там, а кричать не о чем', async () => {
    // То же отсутствие манифеста, но артефактов на диске нет — это норма, а не
    // потеря. Условие обязано их различать, иначе сообщение кричит каждому.
    const result = await run({ command: 'plan', cwd: clean().root });

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

function withoutLine(text: string, line: number): string {
  const lines = text.split('\n');
  lines.splice(line - 1, 1);
  return lines.join('\n');
}
