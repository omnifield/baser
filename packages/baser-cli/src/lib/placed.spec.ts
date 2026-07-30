/**
 * ПЕРЕЕЗД УЖЕ РАЗЛОЖЕННОГО — второй конец движения, а не только новый.
 *
 * Движение значения между ВЫПУСКАМИ обвеса дверь до сих пор называла
 * наполовину: `diverged` и новое значение. Прежнего конца не было, и человек
 * читал план, не узнавая, что именно у него сменится и на что
 * (`tasker:BASER2-38`).
 *
 * Цена этой половины названа живым случаем: `tasker:BASER2-32` сменил резолвер
 * имени репозитория, и у потребителя, который имя не настраивал, при обновлении
 * обвеса поедут имя контейнера и **сетевой алиас**. Алиас — обещание СОСЕДЯМ:
 * сосед ходит на `http://weber:3000`, и смена адреса ломает не наш контейнер, а
 * чужие. Такое обязано быть названо до применения, целиком.
 *
 * ── ОТКУДА БЕРЁТСЯ ПРЕЖНИЙ КОНЕЦ ────────────────────────────────────────────
 *
 * Из РАЗЛОЖЕННОГО АРТЕФАКТА: он лежит на диске, он наш (владение доказано
 * паспортом укладки), и он есть отпечаток прежних значений. Паспорт укладки при
 * этом не трогается — форма записи это шов между зонами, и менять её ради того,
 * что уже лежит рядом, было бы дорого не по труду, а по связности.
 *
 * ── ГЛАВНОЕ ТРЕБОВАНИЕ: НИ ОДНОГО НЕДОКАЗАННОГО СЛОВА ───────────────────────
 *
 * Утверждение «прежде здесь было X» дверь делает ТОЛЬКО тогда, когда X
 * побайтово воспроизводит лежащий артефакт. Не восстановилось — молчит: план
 * по-прежнему говорит `diverged`, и это правда, а уверенный указатель не туда
 * хуже отсутствующего (тот же принцип, что в `first-install`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installDevbox,
  soleRun,
  DEVBOX_PACKAGE,
  PINNED_NODE,
  type Consumer,
} from './devbox.fixture.js';
import { run } from './run.js';
import { renderText } from './report.js';
import type { SettingMovement } from './values.js';

const DEVBOX_ID = 'omnifield/devbox';
const LIVE = '.devcontainer/devcontainer.json';
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

/**
 * Обвес выпустился заново и стал считать имя репозитория ПО-ДРУГОМУ.
 *
 * Ровно то, что сделал `tasker:BASER2-32`: резолвер перестал брать имя каталога
 * и начал брать идентичность репозитория. У потребителя от этого едут два
 * значения сразу — имя девбокса и алиас в сети.
 */
const RENAMED = `
export function repoName() { return 'weber'; }
export function devboxName() { return 'weber-devbox'; }
export function latestStableNode() { return '${PINNED_NODE}'; }
`;

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

function install(block: Record<string, unknown> = {}): Consumer {
  consumer = installDevbox({
    config: CONFIG,
    tuning: { [DEVBOX_ID]: { presets: ['omnifield'], ...block } },
  });
  return consumer;
}

async function movements(box: Consumer): Promise<Map<string, SettingMovement>> {
  const result = await run({ command: 'plan', cwd: box.root });
  return new Map(
    soleRun(result).settings.map((setting) => [setting.key, setting]),
  );
}

describe('обвес сменил резолвер: поедет имя контейнера и АЛИАС В СЕТИ', () => {
  it('план называет ОБА конца каждого движения, а не только новое значение', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('"name": "baser-devbox"');
    expect(box.read(LIVE)).toContain('--network-alias=baser');

    box.updateResolvers(RENAMED);

    const byKey = await movements(box);

    // Имя контейнера: было — стало.
    expect(byKey.get('name')?.value).toBe('weber-devbox');
    expect(byKey.get('name')?.placed?.value).toBe('baser-devbox');

    // Алиас: то же самое, и это тот конец, ради которого задача заведена.
    // Сосед ходит на прежний адрес, и смена ломает ЕГО, а не нас.
    expect(byKey.get('networkAlias')?.value).toBe('weber');
    expect(byKey.get('networkAlias')?.placed?.value).toBe('baser');
  });

  it('прежнее значение названо АДРЕСОМ артефакта, которым оно доказано', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    box.updateResolvers(RENAMED);

    const name = (await movements(box)).get('name');

    // Не «мы так думаем», а «вот файл, который этим значением воспроизводится
    // побайтово». Человеку это адрес, куда смотреть; гейту — данные.
    expect(name?.placed?.provenBy).toBe(LIVE);
  });

  it('оба конца доезжают до ТЕКСТА, и стоят выше плана', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    box.updateResolvers(RENAMED);

    const text = renderText(await run({ command: 'plan', cwd: box.root }));

    expect(text).toContain('"baser" → "weber"');
    expect(text).toContain('"baser-devbox" → "weber-devbox"');
    // Названо ДО применения — значит и прочитано будет до решения.
    expect(text.indexOf('"baser" → "weber"')).toBeLessThan(
      text.indexOf('шагов:'),
    );
  });

  it('значения, которые не двигались, поля переезда НЕ несут', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    box.updateResolvers(RENAMED);

    const byKey = await movements(box);

    // Утверждение на каждую настройку обесценило бы утверждение: переехали две.
    // Названные сначала БЕРУТСЯ, а потом проверяются: `get(...)?.placed` на
    // снятой настройке зеленеет сам собой — ключа нет, поля нет, проба молчит.
    for (const key of ['image', 'imageTag']) {
      const setting = byKey.get(key);
      expect(setting, key).toBeDefined();
      expect(setting?.placed).toBeUndefined();
    }
    expect(
      [...byKey.values()].filter((setting) => setting.placed !== undefined)
        .length,
    ).toBe(2);
  });
});

describe('человек заполнил настройку на УЖЕ СТОЯЩЕМ обвесе', () => {
  it('переезд назван так же: было "node", станет "vscode"', async () => {
    // Живой случай из `tasker:BASER2-40`: `imageUser` стал настройкой, и от неё
    // считаются цели томов. Кто заполнит её на уже стоящем девбоксе —
    // переселит тома, и узнать об этом обязан ДО применения.
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    box.tune(DEVBOX_ID, {
      presets: ['omnifield'],
      settings: { imageUser: 'vscode' },
    });

    const imageUser = (await movements(box)).get('imageUser');

    expect(imageUser?.value).toBe('vscode');
    expect(imageUser?.placed?.value).toBe('node');
  });
});

describe('НИ ОДНОГО НЕДОКАЗАННОГО СЛОВА', () => {
  it('шаблон уехал вместе со значением — дверь молчит, а не гадает', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    // Выпуск обвеса поменял и резолвер, и сам шаблон. Прежний артефакт теперь
    // не воспроизводится НИ ОДНИМ набором значений этого шаблона, и назвать
    // прежний конец нечем. Промолчать здесь — единственный честный ответ.
    box.updateResolvers(RENAMED);
    box.writeTemplate(
      'devcontainer.json.ejs',
      `// строка, которой в прошлом выпуске не было\n${readFileSync(
        join(box.sourceRoot, 'template/devcontainer.json.ejs'),
        'utf-8',
      )}`,
    );

    const result = await run({ command: 'plan', cwd: box.root });
    const byKey = new Map(
      soleRun(result).settings.map((setting) => [setting.key, setting]),
    );

    expect(byKey.get('name')?.placed).toBeUndefined();
    expect(byKey.get('networkAlias')?.placed).toBeUndefined();
    // Защита при этом не пропала: расхождение артефакта названо, как и прежде.
    expect(soleRun(result).plan?.steps[0].reason).toBe('diverged');
  });

  it('артефакт правили руками — прежний конец не сочиняется', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    const landed = box.read(LIVE) as string;
    box.write(LIVE, `${landed}\n// правка руками\n`);

    const byKey = await movements(box);

    // Значения не двигались вовсе, двигали файл. Приписать это настройке
    // значило бы отправить человека крутить то, что он не трогал.
    expect(
      [...byKey.values()].every((setting) => setting.placed === undefined),
    ).toBe(true);
  });

  it('список и флаг дверь не восстанавливает — и не притворяется', async () => {
    // Строка ложится в артефакт подстрокой, и её можно вынуть оттуда доказуемо.
    // Список разворачивается шаблоном в структуру, флаг — в ветку: «прежнего
    // места» у них в тексте нет. Восстановить нечем — значит и слова нет.
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    box.tune(DEVBOX_ID, {
      presets: ['omnifield'],
      settings: { editorExtensions: ['biomejs.biome'] },
    });

    const byKey = await movements(box);

    expect(byKey.get('editorExtensions')?.value).toEqual(['biomejs.biome']);
    expect(byKey.get('editorExtensions')?.placed).toBeUndefined();
  });

  it('первый прогон: класть ещё нечего, и переезда нет ни у чего', async () => {
    const byKey = await movements(install());

    expect(
      [...byKey.values()].every((setting) => setting.placed === undefined),
    ).toBe(true);
  });
});
