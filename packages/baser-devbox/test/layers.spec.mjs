/**
 * ТРИ СЛОЯ ОБВЕСА — и каждый проверяется отдельно.
 *
 * | слой              | что это                                                    |
 * | ----------------- | ---------------------------------------------------------- |
 * | **универсальное** | всё в контейнере, рабочая папка в томе, креды и кэши — в     |
 * |                   | отдельных томах, host-gateway, рестарт вместе с демоном      |
 * | **настройки**     | имя девбокса, образ и версия рантайма, команда установки     |
 * |                   | зависимостей, расширения редактора                          |
 * | **пресет**        | сеть, peer-alias, ноль портов наружу, общие тома            |
 *
 * **Пресет, а не второй обвес.** Два источника не могут делить один файл
 * (`kb:BASER2-6`), поэтому «базовый + надстройка omnifield» выражается
 * ИМЕНОВАННЫМ НАБОРОМ ЗНАЧЕНИЙ внутри одного обвеса. Проверка этого — не
 * формальность: если бы слои разъехались, снятие пресета унесло бы с собой
 * что-нибудь универсальное, и внешний пользователь получил бы сломанный
 * девбокс. Поэтому здесь есть отдельный тест «универсальное переживает снятие
 * пресета».
 *
 * Слои меряются через ДВЕРЬ, а не собственным рендером: свой шаблонизатор в
 * тесте был бы второй правдой о подстановке и разошёлся бы с тем, что реально
 * приезжает потребителю.
 */

import { afterEach, describe, expect, it } from 'vitest';
// Обвес здесь один — прогон под него берётся `soleRun` двери, а не `runs[0]`:
// он бросает, если обвес не один (`tasker:BASER2-55`). Публичным входом зоны
// `cli`, как и `run` (`tasker:BASER2-59`).
import { soleRun } from '../../baser-cli/src/index.ts';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  tuning,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Раскладывает обвес и отдаёт разобранный devcontainer вместе с ответом. */
async function materialize({
  presets = [],
  settings,
  repoName = 'baser',
} = {}) {
  consumer = installConsumer({
    repoName,
    config: consumerConfig(),
    tuning: tuning({ presets, settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  if (result.status !== 'applied') {
    throw new Error(
      `обвес не разложился: ${result.status}\n${JSON.stringify(result.problems, null, 2)}`,
    );
  }
  const text = consumer.read(LIVE);
  return { result, text, json: parseJsonc(text) };
}

describe('слой УНИВЕРСАЛЬНОЕ: тот же обвес без пресета', () => {
  it('валидный devcontainer, в котором нет ничего от omnifield', async () => {
    const { json, text } = await materialize();

    expect(json.remoteUser).toBe('node');
    expect(json.name).toBe('baser-devbox');
    // Ни сети, ни общих томов, ни ассистента: слой пресета не развернулся вовсе.
    expect(json.runArgs).toEqual([
      '--add-host=host.docker.internal:host-gateway',
      '--restart=unless-stopped',
    ]);
    expect(json.mounts).toBeUndefined();
    expect(json.containerEnv).toBeUndefined();
    expect(text).not.toContain('omnifield');
    // Постсоздание без пресета — названные потери тулчейна и установка, и ничего
    // больше. Проверка тулчейна универсальна намеренно: «девбокс НОДОВЫЙ» это
    // свойство обвеса, а не раскладки omnifield (`tasker:BASER2-110`).
    // Дефолт неинтерактивен целиком: вопрос pnpm про снос модулей вешает
    // постсоздание намертво, а отвечать в контейнере некому
    // (`tasker:BASER2-125`, исполняется в `post-create-install.spec.mjs`).
    expect(json.postCreateCommand).toContain(
      'pnpm install --frozen-lockfile --config.confirmModulesPurge=false',
    );
    // И БЕЗОПАСЕН К ОТСУТСТВИЮ МАНИФЕСТА: локация, где ставить нечего, — это
    // нормальное состояние, а не отказ, роняющий всё постсоздание разом
    // (`tasker:BASER2-188`, исполняется там же). Установка при этом остаётся
    // ПОСЛЕДНИМ шагом — инвариант зоны, по которому пробы отрезают её хвост.
    expect(json.postCreateCommand.endsWith('; fi')).toBe(true);
    expect(json.postCreateCommand).toContain('if [ -f package.json ]; then');
    expect(json.postCreateCommand).toContain('command -v uv');
  });

  it('ВСЁ В КОНТЕЙНЕРЕ: образ с конкретной версией, работа под node', async () => {
    const { json } = await materialize();

    // Тег обязан быть конкретным: `latest` в артефакт не попадает.
    expect(json.image).toMatch(
      /^mcr\.microsoft\.com\/devcontainers\/typescript-node:\d+$/,
    );
    expect(json.remoteUser).toBe('node');
    // Тулинг git-flow приезжает feature'ом, а не установкой на хосте.
    expect(Object.keys(json.features)).toEqual([
      'ghcr.io/devcontainers/features/github-cli:1',
    ]);
  });

  it('РАБОЧАЯ ПАПКА В ТОМЕ: workspace-том обвес не объявляет и объявлять не должен', async () => {
    const { json, text } = await materialize();

    // Томом рабочей папки управляет native «Clone Repository in Container
    // Volume» (kb:ADR-16). Объявить его здесь значило бы отобрать управление у
    // того, кто его создаёт, — поэтому проверяется именно ОТСУТСТВИЕ, а
    // причина названа в самом артефакте.
    expect(json.workspaceMount).toBeUndefined();
    expect(json.workspaceFolder).toBeUndefined();
    expect(text).toContain('Clone Repository in Container Volume');
  });

  it('HOST-GATEWAY и РЕСТАРТ ВМЕСТЕ С ДЕМОНОМ есть в ЛЮБОЙ раскладке', async () => {
    // Универсальное обязано пережить и включение пресета, и его снятие: слой,
    // который держится только пресетом, универсальным не является.
    const bare = await materialize();
    consumer.cleanup();
    consumer = null;
    const preset = await materialize({ presets: ['omnifield'] });

    for (const { json } of [bare, preset]) {
      expect(json.runArgs).toContain(
        '--add-host=host.docker.internal:host-gateway',
      );
      expect(json.runArgs).toContain('--restart=unless-stopped');
      expect(json.remoteUser).toBe('node');
    }
  });
});

describe('слой НАСТРОЙКИ: регулировка вместо правки файла', () => {
  it('имя девбокса приезжает из ИМЕНИ РЕПОЗИТОРИЯ — пользователь не вводит ничего', async () => {
    const { json, result } = await materialize({ repoName: 'weber' });

    expect(json.name).toBe('weber-devbox');
    // Ни одного заполненного значения в конфиге — и ни одного вопроса.
    expect(soleRun(result).settings.every((setting) => setting.ours)).toBe(
      true,
    );
  });

  it('образ, ТЕГ образа и команда установки — заполняемые', async () => {
    const { json } = await materialize({
      settings: {
        image: 'mcr.microsoft.com/devcontainers/base',
        imageTag: '20',
        installCommand: 'npm ci',
      },
    });

    expect(json.image).toBe('mcr.microsoft.com/devcontainers/base:20');
    expect(json.postCreateCommand.endsWith('npm ci')).toBe(true);
  });

  it('расширения редактора — список, и он едет в customizations целиком', async () => {
    const { json } = await materialize({
      settings: {
        editorExtensions: ['esbenp.prettier-vscode', 'ms-vscode.live-server'],
      },
    });

    expect(json.customizations.vscode.extensions).toEqual([
      'esbenp.prettier-vscode',
      'ms-vscode.live-server',
    ]);
  });

  it('ФОРМАТТЕР — регулировка, а не константа: стек репозитория, а не наш вкус', async () => {
    // Дыра, найденная на weber: прибитый гвоздями prettier оставлял потребителю с
    // другим стеком единственный ход — форк обвеса целиком из-за одной строки, а
    // это дефект шаблона, а не проблема пользователя (kb:BASER2-2 §5).
    const { json, text } = await materialize({
      settings: {
        editorExtensions: ['biomejs.biome'],
        editorFormatter: 'biomejs.biome',
      },
    });

    expect(json.customizations.vscode.settings['editor.defaultFormatter']).toBe(
      'biomejs.biome',
    );
    expect(text).not.toContain('prettier');
  });

  it('ФОРМАТТЕР ВНЕ СПИСКА → список, где он есть: чинится по построению', async () => {
    // `editor.defaultFormatter` принимает идентификатор расширения, значит
    // «форматтер задан» и «расширение стоит» — одно утверждение. Обвес держит его
    // сам, а не называет отказом: отказ требовал бы действия от человека там, где
    // верный ответ обвесу известен. Класс ошибки исчезает, а не ловится.
    const { json, text } = await materialize({
      settings: {
        editorExtensions: ['nrwl.angular-console'],
        editorFormatter: 'biomejs.biome',
      },
    });

    expect(json.customizations.vscode.extensions).toEqual([
      'nrwl.angular-console',
      'biomejs.biome',
    ]);
    expect(json.customizations.vscode.settings['editor.defaultFormatter']).toBe(
      'biomejs.biome',
    );
    // Видно в артефакте и объяснено на месте, а не только в доке.
    expect(text).toContain('Форматтер в списке — от обвеса');
  });

  it('форматтер УЖЕ в списке — ни дубля, ни перестановки', async () => {
    const { json, text } = await materialize({
      settings: {
        editorExtensions: ['biomejs.biome', 'nrwl.angular-console'],
        editorFormatter: 'biomejs.biome',
      },
    });

    expect(json.customizations.vscode.extensions).toEqual([
      'biomejs.biome',
      'nrwl.angular-console',
    ]);
    // Обвес ничего не добавлял — и не рассказывает, будто добавлял.
    expect(text).not.toContain('Форматтер в списке — от обвеса');
  });

  it('ВСТРОЕННЫЙ форматтер в список НЕ добавляется — его не ставят из маркетплейса', async () => {
    // Издатель `vscode.` зарезервирован за расширениями, которые уже в редакторе.
    // Запись о них в `extensions` — несуществующий идентификатор в артефакте, то
    // есть та же тихая неверность с другой стороны. Правило сужено, а не отменено.
    const { json } = await materialize({
      settings: {
        editorExtensions: ['nrwl.angular-console'],
        editorFormatter: 'vscode.json-language-features',
      },
    });

    expect(json.customizations.vscode.extensions).toEqual([
      'nrwl.angular-console',
    ]);
    // Настройка при этом на месте: форматтер задан, ставить его просто незачем.
    expect(json.customizations.vscode.settings['editor.defaultFormatter']).toBe(
      'vscode.json-language-features',
    );
  });

  it('форматтер null — список расширений остаётся как задан', async () => {
    const { json } = await materialize({
      settings: {
        editorExtensions: ['nrwl.angular-console'],
        editorFormatter: null,
      },
    });

    expect(json.customizations.vscode.extensions).toEqual([
      'nrwl.angular-console',
    ]);
  });

  it('форматтер null — обвес форматирование НЕ навязывает', async () => {
    // «Не задано» здесь осмысленно: обе строки идут парой, и форматирование по
    // сохранению без форматтера — половина настройки, а не половина результата.
    const { json } = await materialize({ settings: { editorFormatter: null } });
    const settings = json.customizations.vscode.settings;

    expect(settings['editor.defaultFormatter']).toBeUndefined();
    expect(settings['editor.formatOnSave']).toBeUndefined();
    // А tsdk на месте: он регулировкой НЕ стал.
    expect(settings['typescript.tsdk']).toBe('node_modules/typescript/lib');
  });

  it('ГРАНИЦА НАСТРОЙКИ: сквозного проброса настроек редактора нет', async () => {
    // Обвес отдаёт регулировки под то, что диктует СТЕК репозитория (форматтер), и
    // не превращается в редактор JSON с лишним шагом. Проверяемо: набор ключей в
    // customizations.vscode.settings ЗАКРЫТ, и расширить его конфигом нельзя —
    // форма настроек не знает вложенных структур намеренно.
    const { json } = await materialize();

    expect(Object.keys(json.customizations.vscode.settings).sort()).toEqual([
      'editor.defaultFormatter',
      'editor.formatOnSave',
      'typescript.tsdk',
    ]);
  });

  it('ЗАПОЛНЕННОЕ БЬЁТ ПРЕСЕТ, но слоя не отменяет', async () => {
    const { json, result } = await materialize({
      presets: ['omnifield'],
      settings: { imageTag: '20', installCommand: 'npm ci' },
    });

    expect(json.image).toBe(
      'mcr.microsoft.com/devcontainers/typescript-node:20',
    );
    expect(json.postCreateCommand).toMatch(/&& npm ci$/);
    // Пресет при этом на месте: заполнено одно значение, а не снят слой.
    expect(json.runArgs).toContain('--network=omnifield-gateway');
    expect(json.postCreateCommand).toContain('/home/node/.secrets');

    const runtime = soleRun(result).settings.find(
      (setting) => setting.key === 'imageTag',
    );
    expect(runtime.origin.kind).toBe('filled');
    expect(runtime.ours).toBe(false);
  });
});

describe('слой ПРЕСЕТ omnifield: ходовое положение регулировок', () => {
  it('СЕТЬ и PEER-ALIAS: соседей видно по имени', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });

    expect(json.runArgs).toContain('--network=omnifield-gateway');
    expect(json.runArgs).toContain('--network-alias=baser');
  });

  it('НОЛЬ ПОРТОВ НАРУЖУ: single-origin — наружу только дверь', async () => {
    const { json, text } = await materialize({ presets: ['omnifield'] });

    expect(json.forwardPorts).toBeUndefined();
    expect(json.appPort).toBeUndefined();
    expect(text).not.toMatch(/-p\s+\d+:/);
    expect(json.runArgs.some((arg) => arg.startsWith('--publish'))).toBe(false);
  });

  it('ОБЩИЕ ТОМА: креды и кэши переживают пересоздание контейнера', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });

    expect(json.mounts).toEqual([
      'source=omnifield-secrets,target=/home/node/.secrets,type=volume',
      'source=omnifield-pnpm-store,target=/home/node/.pnpm-store,type=volume',
    ]);
    // ENV указывает В ТОМ: ничего не хардкодится в образ и в репозиторий. Стор —
    // тоже ENV, и по той же причине: смонтированный том, в который никто не
    // ходит, это не общий стор (`tasker:BASER2-111`).
    expect(json.containerEnv).toEqual({
      CLAUDE_CONFIG_DIR: '/home/node/.secrets/claude',
      GIT_CONFIG_GLOBAL: '/home/node/.secrets/gitconfig',
      GH_CONFIG_DIR: '/home/node/.secrets/gh',
      NPM_CONFIG_USERCONFIG: '/home/node/.secrets/npmrc',
      NPM_CONFIG_STORE_DIR: '/home/node/.pnpm-store',
      PNPM_CONFIG_STORE_DIR: '/home/node/.pnpm-store',
    });
    // Права на тома выставляются на месте — том создаётся от root.
    expect(json.postCreateCommand).toContain(
      'sudo chown -R node:node /home/node/.secrets',
    );
  });

  it('АССИСТЕНТ ВНУТРИ контейнера, а не на хосте', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });

    expect(json.onCreateCommand).toContain(
      'npm install -g @anthropic-ai/claude-code@latest',
    );
    expect(json.postCreateCommand).toContain('$CLAUDE_CONFIG_DIR');
  });

  it('ПРЕСЕТ — НЕ ВТОРОЙ ОБВЕС: он двигает только объявленные значения', async () => {
    const { result } = await materialize({ presets: ['omnifield'] });

    const { settings } = soleRun(result);
    const fromPreset = settings
      .filter((setting) => setting.origin.kind === 'preset')
      .map((setting) => setting.key)
      .sort();

    // Ровно четыре регулировки — и ни одной строки содержимого сверх них.
    expect(fromPreset).toEqual([
      'installAssistant',
      'network',
      'pnpmStoreVolume',
      'secretsVolume',
    ]);
    for (const setting of settings) {
      if (setting.origin.kind === 'preset') {
        expect(setting.chain[0].kind).toMatch(/^(default|computed)$/);
        expect(setting.moved).toBe(true);
      }
    }
  });

  it('пресет снимается — и артефакт ДОГОНЯЕТ, а не остаётся с хвостом', async () => {
    const box = installConsumer({
      repoName: 'baser',
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    consumer = box;
    await run({ command: 'apply', cwd: box.root });
    expect(box.read(LIVE)).toContain('omnifield-gateway');

    // Пресет снимается ТАМ, ГДЕ ОН ВЫБРАН, — в файле настроек обвеса; в
    // `baser.json` его больше нет вовсе (`tasker:BASER2-10` §3).
    box.tune(tuning({ presets: [] }));
    await run({ command: 'apply', cwd: box.root });

    // Артефакт перегенерирован ЦЕЛИКОМ: следов пресета не осталось нигде.
    expect(box.read(LIVE)).not.toContain('omnifield');
    expect(box.read(LIVE)).not.toContain('mounts');
    expect(box.read(LIVE)).not.toContain('containerEnv');
    expect(parseJsonc(box.read(LIVE)).runArgs).toEqual([
      '--add-host=host.docker.internal:host-gateway',
      '--restart=unless-stopped',
    ]);
  });
});
