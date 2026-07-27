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
 * ── РАСХОЖДЕНИЯ, НАЗВАННЫЕ ЗАРАНЕЕ ──────────────────────────────────────────
 *
 * «С точностью до настроек» — не оговорка, а утверждение, и оно проверяется
 * ПОИМЁННО: тест считает список различающихся строк и сверяет его целиком.
 * Расхождений ровно два, оба на настройках, и оба ниже названы своим тестом:
 *
 * | # | строка                       | почему                                  |
 * |---|------------------------------|-----------------------------------------|
 * | 1 | комментарий-заголовок (стр.2)| в живом файле руками написано «baser     |
 * |   |                              | devbox», обвес подставляет `name` →      |
 * |   |                              | «baser-devbox». Прозаическое, не         |
 * |   |                              | структурное.                             |
 * | 2 | `"image": …:22` vs `…:24`    | живой репозиторий стоит на Node 22, а    |
 * |   |                              | дефолт выпуска 0.1.0 — 24 (Active LTS на |
 * |   |                              | дату выпуска, `defaults.mjs`). Это и     |
 * |   |                              | есть «до настроек»: заполни              |
 * |   |                              | `runtimeVersion` — расхождение исчезает. |
 *
 * Структурных расхождений нет: остальные строки сверяются точно.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../baser-cli/src/index.ts';
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
  consumer = installConsumer({ repoName: 'baser', ...options });
  return consumer;
}

/** Конфиг, воспроизводящий живой репозиторий: пресет omnifield + его Node. */
const AS_LIVE = consumerConfig({
  presets: ['omnifield'],
  settings: { runtimeVersion: '22' },
});

describe('ПРИЁМКА: поставил пакет → позвал дверь → .devcontainer лёг', () => {
  it('на настройках живого репозитория артефакт СОВПАДАЕТ с ним', async () => {
    const box = clean({ config: AS_LIVE });

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    expect(result.writes.map((write) => write.path).sort()).toEqual(
      [LIVE, LOCK, MANIFEST_PATH].sort(),
    );

    // Вот оно, утверждение целиком: различается РОВНО одна строка, и это
    // рукописный комментарий-заголовок живого файла.
    const diff = differingLines(box.read(LIVE), liveArtifact(LIVE));
    expect(diff.map((item) => item.line)).toEqual([2]);
    expect(diff[0].ours).toContain('baser-devbox — Ф2');
    expect(diff[0].live).toContain('baser devbox — Ф2');
  });

  it('render: false лёг БАЙТ В БАЙТ — и с живым локом, и с шаблоном', async () => {
    const box = clean({ config: AS_LIVE });
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
    const box = clean({ config: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });
    const landed = box.read(LIVE);

    const again = await run({ command: 'apply', cwd: box.root });

    expect(again.status).toBe('converged');
    expect(again.plan?.steps).toEqual([]);
    expect(again.writes).toEqual([]);
    expect(box.read(LIVE)).toBe(landed);
  });

  it('дверь опознала ИМЕННО поставленный пакет, а не копию в монорепе', async () => {
    const box = clean({ config: AS_LIVE });

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.source.id).toBe('omnifield/devbox');
    expect(result.source.packageName).toBe(DEVBOX_PACKAGE);
    expect(result.source.packageVersion).toBe(packedManifest().version);
    // Корень пакета — внутри дерева потребителя: значит источник закрыт от
    // записи в себя, а не «где-то на машине».
    expect(result.source.packageRoot).toBe(
      join(box.root, 'node_modules', DEVBOX_PACKAGE),
    );
    expect(result.source.location.kind).toBe('in-tree');
    // Трейс прогона существует — мерить работу двери есть чем.
    expect(result.trace.length).toBeGreaterThan(0);
  });
});

describe('РАСХОЖДЕНИЕ, названное до user: дефолт выпуска ушёл вперёд живого репо', () => {
  it('без заполнения версия 24, живой репозиторий на 22 — и это ЕДИНСТВЕННОЕ различие сверх заголовка', async () => {
    const box = clean({ config: consumerConfig({ presets: ['omnifield'] }) });

    const result = await run({ command: 'apply', cwd: box.root });

    const runtime = result.settings.find(
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

    // Ровно две строки: рукописный заголовок и версия образа. Всё остальное —
    // универсальный слой и пресет — сходится с живым файлом точно.
    const diff = differingLines(landed, liveArtifact(LIVE));
    expect(diff.map((item) => item.line)).toEqual([2, 8]);
    expect(diff[1].ours).toContain('typescript-node:24');
    expect(diff[1].live).toContain('typescript-node:22');
  });

  it('заполненное значение убирает расхождение — «до настроек» проверяемо', async () => {
    const box = clean({ config: AS_LIVE });
    await run({ command: 'apply', cwd: box.root });

    const diff = differingLines(box.read(LIVE), liveArtifact(LIVE));
    expect(diff.map((item) => item.line)).not.toContain(8);
  });
});

describe('переход: обвес обновился под потребителем', () => {
  it('дефолт поднялся — движение НАЗВАНО планом до применения', async () => {
    const box = clean({ config: consumerConfig({ presets: ['omnifield'] }) });
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('typescript-node:24');

    // Следующий выпуск обвеса двигает пин — ровно так, как это опишет
    // `defaults.mjs`, когда 26 войдёт в Active LTS.
    bumpPin(box, '26');

    const plan = await run({ command: 'plan', cwd: box.root });
    const runtime = plan.settings.find(
      (setting) => setting.key === 'runtimeVersion',
    );
    expect(runtime.value).toBe('26');
    expect(plan.plan?.steps[0].reason).toBe('diverged');
    // Названо — и не применено: `plan` дерева не трогает.
    expect(box.read(LIVE)).toContain('typescript-node:24');

    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('typescript-node:26');
  });

  it('заполненное пользователем переживает обновление обвеса', async () => {
    const box = clean({ config: AS_LIVE });
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
