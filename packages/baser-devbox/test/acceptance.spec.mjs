/**
 * ПРИЁМКА ЗОНЫ: обвес, ПОСТАВЛЕННЫЙ КАК ПАКЕТ, раскладывается дверью в чистое
 * дерево, и результат совпадает с живым `.devcontainer` этого репозитория с
 * точностью до настроек.
 *
 * Зелёные тесты закрытием не являются — в этом продукте это подтверждено
 * четырьмя зонами подряд. Поэтому приёмка устроена так, чтобы её нельзя было
 * пройти, не сделав работу:
 *
 * - обвес берётся из ТАРБОЛА (`npm pack`), а не из каталога монорепы;
 * - дверь зовётся настоящая, своей публичной поверхностью, и пишет на диск;
 * - эталон — файл, который прямо сейчас поднимает контейнер, в котором это
 *   выполняется, а не снимок в фикстуре.
 *
 * ── ДВА ПОТРЕБИТЕЛЯ, А НЕ ОДИН ──────────────────────────────────────────────
 *
 * С выпуска 0.2.0 приёмка идёт на ДВУХ стеках: нашем (prettier + Nx) и weber
 * (biome + Nx, приватный реестр, установка без `--frozen-lockfile`). Обвес,
 * проверенный на единственном потребителе, доказывает совместимость с самим
 * собой: ровно так «прибитый гвоздями» форматтер прожил до weber.
 *
 * ── РАСХОЖДЕНИЯ С ЖИВЫМ ФАЙЛОМ, НАЗВАННЫЕ ЗАРАНЕЕ ───────────────────────────
 *
 * «С точностью до настроек» — не оговорка, а утверждение, и оно проверяется
 * ПОИМЁННО: тест считает список различающихся строк и сверяет его целиком.
 * Инвариант, который держит это утверждение честным: **расходятся только
 * значения настроек и комментарии, эти значения описывающие.** Ни одной строки
 * данных.
 *
 * | строка | что                     | почему                                  |
 * |--------|-------------------------|-----------------------------------------|
 * | 2      | комментарий-заголовок   | в живом файле руками написано «baser     |
 * |        |                         | devbox», обвес подставляет `name` →      |
 * |        |                         | «baser-devbox». Прозаическое, не         |
 * |        |                         | структурное.                             |
 * | 8      | `"image": …:22` / `:24` | живой репозиторий на Node 22, дефолт     |
 * |        |                         | выпуска — 24. Заполни `runtimeVersion`   |
 * |        |                         | — расхождение исчезает (отдельный тест). |
 * | 47     | комментарий о редакторе | в живом файле «baser-стек = prettier +   |
 * |        |                         | Nx (НЕ biome)» — утверждение о стеке     |
 * |        |                         | ПОТРЕБИТЕЛЯ, которое врёт всякому, у     |
 * |        |                         | кого стек другой. Форматтер стал         |
 * |        |                         | настройкой — ярлык обязан был перестать  |
 * |        |                         | быть прибитым вместе с ним (0.2.0).      |
 * | 61     | комментарий о шагах     | перечисляет шаги постсоздания и потому   |
 * |        | постсоздания            | собирается из тех же частей, что и сами  |
 * |        |                         | шаги. «install по lock» врал бы weber:   |
 * |        |                         | у него установка без lock (0.2.0).       |
 *
 * Структурных расхождений нет: остальные строки сверяются точно.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../baser-cli/src/index.ts';
// Обвесов в ответе двери столько же, сколько поставлено (`tasker:BASER2-55`), и
// каждый прогон лежит под своим. Здесь обвес один — берём хелпер зоны `cli`, а
// не `runs[0]`: он бросает, если обвес не один, и проба про один обвес не
// начнёт молча проверять первый из двух.
import { soleRun } from '../../baser-cli/src/lib/devbox.fixture.ts';
import { MANIFEST_PATH } from '../../baser-materialize/src/index.ts';
import {
  consumerConfig,
  DEVBOX_PACKAGE,
  differingLines,
  installConsumer,
  LIVE,
  liveArtifact,
  LOCK,
  packedManifest,
  parseJsonc,
  tuning,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/**
 * Чистое дерево с поставленным обвесом.
 *
 * Имя репозитория — `baser`: из него резолверы считают `name` и `networkAlias`,
 * и другое имя дало бы расхождение с эталоном не по существу, а по вводу.
 */
function clean(options = {}) {
  consumer = installConsumer({
    repoName: 'baser',
    config: consumerConfig(),
    ...options,
  });
  return consumer;
}

/** Настройки, воспроизводящие живой репозиторий: пресет omnifield + его Node. */
const AS_LIVE = tuning({
  presets: ['omnifield'],
  settings: { runtimeVersion: '22' },
});

describe('ПРИЁМКА: поставил пакет → позвал дверь → .devcontainer лёг', () => {
  it('на настройках живого репозитория артефакт СОВПАДАЕТ с ним', async () => {
    const box = clean({ tuning: AS_LIVE });

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    expect(result.writes.map((write) => write.path).sort()).toEqual(
      [LIVE, LOCK, MANIFEST_PATH].sort(),
    );

    // Вот оно, утверждение целиком: расходятся три строки, каждая названа.
    const diff = differingLines(box.read(LIVE), liveArtifact(LIVE));
    expect(diff.map((item) => item.line)).toEqual([2, 47, 61]);
    expect(diff[0].ours).toContain('baser-devbox — Ф2');
    expect(diff[0].live).toContain('baser devbox — Ф2');
    expect(diff[1].live).toContain('НЕ biome');
    expect(diff[2].live).toContain('install по lock');
  });

  it('НИ ОДНА строка данных не расходится — только комментарии', async () => {
    // Утверждение, которое держит «до настроек» честным: расхождения живут в
    // комментариях, а не в том, что читает Docker. Комментарий разъезжается
    // потому, что описывает настройку; строка данных разъехаться не имеет права.
    const box = clean({ tuning: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });

    const diff = differingLines(box.read(LIVE), liveArtifact(LIVE));
    const data = diff.filter((item) => !item.ours.trim().startsWith('//'));

    expect(data).toEqual([]);
  });

  it('render: false лёг БАЙТ В БАЙТ — и с живым локом, и с шаблоном', async () => {
    const box = clean({ tuning: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });

    // Пин toolchain по digest: два конца одной проверки — эталон в репозитории
    // и содержимое, приехавшее в тарболе.
    expect(box.read(LOCK)).toBe(liveArtifact(LOCK));
    expect(box.read(LOCK)).toBe(
      readFileSync(
        join(box.sourceRoot, 'template/devcontainer-lock.json'),
        'utf-8',
      ),
    );
  });

  it('владение доказано записью сбоку, второй прогон сходится', async () => {
    const box = clean({ tuning: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });
    const landed = box.read(LIVE);

    const again = await run({ command: 'apply', cwd: box.root });

    expect(again.status).toBe('converged');
    expect(soleRun(again).plan?.steps).toEqual([]);
    expect(again.writes).toEqual([]);
    expect(box.read(LIVE)).toBe(landed);
  });

  it('дверь опознала ИМЕННО поставленный пакет, а не копию в монорепе', async () => {
    const box = clean({ tuning: AS_LIVE });

    const result = await run({ command: 'plan', cwd: box.root });

    const { source } = soleRun(result);
    expect(source.id).toBe('omnifield/devbox');
    expect(source.packageName).toBe(DEVBOX_PACKAGE);
    expect(source.packageVersion).toBe(packedManifest().version);
    // Корень пакета — внутри дерева потребителя: значит источник закрыт от
    // записи в себя, а не «где-то на машине».
    expect(source.packageRoot).toBe(
      join(box.root, 'node_modules', DEVBOX_PACKAGE),
    );
    expect(source.location.kind).toBe('in-tree');
    // Трейс прогона существует — мерить работу двери есть чем.
    expect(result.trace.length).toBeGreaterThan(0);
  });
});

describe('РАСХОЖДЕНИЕ, названное до user: дефолт выпуска ушёл вперёд живого репо', () => {
  it('без заполнения версия 24, живой репозиторий на 22 — и это ЕДИНСТВЕННОЕ различие сверх заголовка', async () => {
    const box = clean({ tuning: tuning({ presets: ['omnifield'] }) });

    const result = await run({ command: 'apply', cwd: box.root });

    const runtime = soleRun(result).settings.find(
      (setting) => setting.key === 'runtimeVersion',
    );
    // Значение НАШЕ: пользователь его не заполнял, поэтому оно едет за выпуском
    // обвеса. Заполнил бы — не поднялось бы никогда.
    expect(runtime.value).toBe('24');
    expect(runtime.ours).toBe(true);
    expect(runtime.origin.kind).toBe('computed');

    const landed = box.read(LIVE);
    expect(parseJsonc(landed).image).toBe(
      'mcr.microsoft.com/devcontainers/typescript-node:24',
    );

    // К трём комментариям добавилась ОДНА строка данных — версия образа, и она
    // же единственная. Всё остальное сходится с живым файлом точно.
    const diff = differingLines(landed, liveArtifact(LIVE));
    expect(diff.map((item) => item.line)).toEqual([2, 8, 47, 61]);
    expect(diff[1].ours).toContain('typescript-node:24');
    expect(diff[1].live).toContain('typescript-node:22');
    expect(
      diff
        .filter((item) => !item.ours.trim().startsWith('//'))
        .map((i) => i.line),
    ).toEqual([8]);
  });

  it('заполненное значение убирает расхождение — «до настроек» проверяемо', async () => {
    const box = clean({ tuning: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });

    const diff = differingLines(box.read(LIVE), liveArtifact(LIVE));
    expect(diff.map((item) => item.line)).not.toContain(8);
  });
});

/**
 * ВТОРОЙ ПОТРЕБИТЕЛЬ — не «ещё один тест», а условие пригодности обвеса.
 *
 * weber настоящий и чужой: biome вместо prettier, приватные `@omnifield/*`,
 * установка без `--frozen-lockfile`. Ровно на нём вскрылось, что прибитый гвоздями
 * форматтер оставлял потребителю единственный ход — форк обвеса целиком из-за одной
 * строки. Обвес, который умеет ровно свой первый репозиторий, ничего не обещает.
 */
const AS_WEBER = tuning({
  presets: ['omnifield'],
  settings: {
    editorExtensions: ['biomejs.biome', 'nrwl.angular-console'],
    editorFormatter: 'biomejs.biome',
    privateScope: '@omnifield',
    installCommand: 'pnpm install',
  },
});

describe('ВТОРОЙ ПОТРЕБИТЕЛЬ: тот же обвес под стек weber', () => {
  it('раскладывается целиком, и в артефакте НЕТ следов нашего стека', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
      tuning: AS_WEBER,
    });

    const result = await run({ command: 'apply', cwd: consumer.root });

    expect(result.status).toBe('applied');
    const artifact = parseJsonc(consumer.read(LIVE));

    expect(artifact.name).toBe('weber-devbox');
    expect(artifact.customizations.vscode.extensions).toEqual([
      'biomejs.biome',
      'nrwl.angular-console',
    ]);
    expect(
      artifact.customizations.vscode.settings['editor.defaultFormatter'],
    ).toBe('biomejs.biome');
    // Прибитый гвоздями форматтер оставил бы здесь prettier рядом с biome —
    // редактор звал бы расширение, которого в контейнере нет.
    expect(consumer.read(LIVE)).not.toContain('prettier');
  });

  it('приватный реестр проверяется, установка идёт БЕЗ --frozen-lockfile', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
      tuning: AS_WEBER,
    });
    await run({ command: 'apply', cwd: consumer.root });

    const post = parseJsonc(consumer.read(LIVE)).postCreateCommand;

    expect(post).toContain('npm config get @omnifield:registry');
    expect(post.endsWith(' && pnpm install')).toBe(true);
    expect(post).not.toContain('--frozen-lockfile');
    // Комментарий над шагом собран из тех же частей — он назвал проверку.
    expect(consumer.read(LIVE)).toContain('проверка доступа к реестру');
  });

  it('универсальный слой и пресет у weber те же, что у нас', async () => {
    // Второй стек не должен утаскивать за собой инварианты: то, что универсально,
    // обязано выглядеть одинаково у обоих потребителей.
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
      tuning: AS_WEBER,
    });
    await run({ command: 'apply', cwd: consumer.root });
    const weber = parseJsonc(consumer.read(LIVE));

    expect(weber.remoteUser).toBe('node');
    expect(weber.runArgs).toEqual([
      '--network=omnifield-gateway',
      '--network-alias=weber',
      '--add-host=host.docker.internal:host-gateway',
      '--restart=unless-stopped',
    ]);
    expect(weber.mounts).toEqual(parseJsonc(liveArtifact(LIVE)).mounts);
    expect(weber.containerEnv).toEqual(
      parseJsonc(liveArtifact(LIVE)).containerEnv,
    );
    expect(weber.features).toEqual(parseJsonc(liveArtifact(LIVE)).features);
  });

  it('второй прогон сходится — обвес держит и чужой стек тоже', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
      tuning: AS_WEBER,
    });
    await run({ command: 'apply', cwd: consumer.root });

    const again = await run({ command: 'apply', cwd: consumer.root });

    expect(again.status).toBe('converged');
    expect(again.writes).toEqual([]);
  });
});

describe('переход: обвес обновился под потребителем', () => {
  it('дефолт поднялся — движение НАЗВАНО планом до применения', async () => {
    const box = clean({ tuning: tuning({ presets: ['omnifield'] }) });
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('typescript-node:24');

    // Следующий выпуск обвеса двигает пин — ровно так, как это опишет
    // `defaults.mjs`, когда 26 войдёт в Active LTS.
    bumpPin(box, '26');

    const plan = await run({ command: 'plan', cwd: box.root });
    const devbox = soleRun(plan);
    const runtime = devbox.settings.find(
      (setting) => setting.key === 'runtimeVersion',
    );
    expect(runtime.value).toBe('26');
    expect(devbox.plan?.steps[0].reason).toBe('diverged');
    // Названо — и не применено: `plan` дерева не трогает.
    expect(box.read(LIVE)).toContain('typescript-node:24');

    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('typescript-node:26');
  });

  it('заполненное пользователем переживает обновление обвеса', async () => {
    const box = clean({ tuning: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });

    bumpPin(box, '26');
    await run({ command: 'apply', cwd: box.root });

    // Дефолт под ним уехал — значение осталось: подниматься неоткуда, движок в
    // конфиг пользователя не пишет.
    expect(box.read(LIVE)).toContain('typescript-node:22');
  });
});

/**
 * Выпускает новую версию обвеса С ДРУГИМ ПИНОМ — прямо в поставленном пакете.
 *
 * Новый файл, а не перезапись: ESM-модуль кэшируется загрузчиком по URL на весь
 * процесс, и подмена содержимого по тому же пути не доехала бы до второго
 * прогона. Обвес при этом правится честно — через своё же объявление.
 */
let sequence = 0;
function bumpPin(consumer, version) {
  sequence += 1;
  const name = `defaults.${sequence}.mjs`;
  const source = readFileSync(
    join(consumer.sourceRoot, 'defaults.mjs'),
    'utf-8',
  );
  consumer.write(
    join('node_modules', DEVBOX_PACKAGE, name),
    source.replace(/return '\d+';/, `return '${version}';`),
  );

  const manifestPath = join('node_modules', DEVBOX_PACKAGE, 'package.json');
  const manifest = JSON.parse(consumer.read(manifestPath));
  for (const spec of Object.values(manifest.baser.settings)) {
    if (typeof spec.defaultFrom === 'string') {
      spec.defaultFrom = spec.defaultFrom.replace(
        /^\.\/defaults[^#]*/,
        `./${name}`,
      );
    }
  }
  consumer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
