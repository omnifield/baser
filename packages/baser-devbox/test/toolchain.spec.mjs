/**
 * ТУЛЧЕЙН: список фич — настройка, а потеря — НАЗВАНА, и обе половины исполняются.
 *
 * Находка живого переезда (`tasker:BASER2-109` П1, `tasker:BASER2-110`): репозиторий
 * brainer объявляет питон в корне (`.python-version`, `[tool.uv]`, `uv.lock`), его
 * nx-таргеты зовут `uv` — а после переезда на обвес `uv` не существует. Прежний общий
 * образ тулчейн нёс, upstream `typescript-node` — нет, и ни план, ни сводка расхождений
 * этого не назвали. Цена: pre-commit падал на трёх зонах сразу, коммит-каденс продукта
 * встал целиком, и узналось это первым же `git commit` — в самый дорогой момент.
 *
 * Половин две, и вторая важнее первой:
 *
 * 1. **Механика.** Список фич был прибит в шаблоне: полиглот не мог добавить себе
 *    питон, не форкнув обвес из-за одной строки. Теперь это настройка.
 * 2. **Не молчать.** Обвес не обязан нести все тулчейны мира — но обязан сказать, что
 *    репозиторий объявил тулчейн, которого в девбоксе нет.
 *
 * Проверка меряет ФАКТ с двух концов — объявил ли РЕПОЗИТОРИЙ (файл в корне) и есть ли
 * КОМАНДА в контейнере, — поэтому здесь она именно ИСПОЛНЯЕТСЯ, в настоящем шелле, с
 * настоящим PATH. Проба, читающая текст шага глазами, доказывала бы только текст: ровно
 * так «том смонтирован» годами значило «стор общий» (`tasker:BASER2-111`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, soleRun } from '../../baser-cli/src/index.ts';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  tuning,
} from './packed.mjs';

const GITHUB_CLI = 'ghcr.io/devcontainers/features/github-cli:1';

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const box of boxes) rmSync(box, { force: true, recursive: true });
  boxes = [];
});

async function materialize(settings) {
  consumer = installConsumer({
    repoName: 'brainer',
    config: consumerConfig(),
    tuning: tuning({ settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  const text = consumer.read(LIVE);
  return { result, text, json: text === null ? null : parseJsonc(text) };
}

/** Шаг названных потерь — первый в постсоздании, вырезается по своему хвосту. */
function toolchainStep(json) {
  const post = json.postCreateCommand;
  const end = post.indexOf('; fi )');
  expect(post.startsWith('( lost=;') && end !== -1, post).toBe(true);
  return post.slice(0, end + '; fi )'.length);
}

/**
 * РЕПОЗИТОРИЙ и PATH задаются отдельно — это и есть два конца проверки.
 *
 * PATH собирается с нуля, а не наследуется: унаследованный отвечал бы за проверку
 * сам («а вдруг на этой машине `python` есть»), и проба меряла бы машину. Внутрь
 * кладётся только то, чем пользуется сам шаг (`grep`), плюс заказанные заглушки —
 * так «команды нет» и «команда появилась» становятся управляемыми состояниями.
 */
function repo({ files = [], tools = [] } = {}) {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-toolchain-'));
  boxes.push(box);
  const root = join(box, 'repo');
  const bin = join(box, 'bin');
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  symlinkSync('/usr/bin/grep', join(bin, 'grep'));
  for (const [path, content] of Object.entries(
    Object.fromEntries(files.map((f) => (Array.isArray(f) ? f : [f, '']))),
  ))
    writeFileSync(join(root, path), content);
  for (const tool of tools) {
    const file = join(bin, tool);
    writeFileSync(file, '#!/bin/sh\nexit 0\n');
    chmodSync(file, 0o755);
  }
  return { cwd: root, env: { PATH: bin } };
}

/**
 * Шелл зовётся по АБСОЛЮТНОМУ пути, потому что PATH здесь собран с нуля: в
 * контейнере постсоздание запускает `/bin/sh`, а не «что найдётся в PATH», и
 * проба обязана мерить шаг, а не поиск интерпретатора.
 */
function sh(script, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', script], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', (cause) =>
      resolve({ code: -1, out: '', err: String(cause) }),
    );
    let err = '';
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

describe('МЕХАНИКА: список фич выражается настройкой', () => {
  it('дефолт — github-cli, и это единственное место, где он утверждается', async () => {
    const { json } = await materialize();

    expect(Object.keys(json.features)).toEqual([GITHUB_CLI]);
    // Опции у фичи по умолчанию: карты в форме настроек нет, и список строк это
    // ровно то, что он есть, — ссылка без опций.
    expect(json.features[GITHUB_CLI]).toEqual({});
  });

  it('полиглот добавляет свой тулчейн НАСТРОЙКОЙ, а не форком обвеса', async () => {
    const { json } = await materialize({
      devcontainerFeatures: [
        GITHUB_CLI,
        'ghcr.io/devcontainers/features/python:1',
      ],
    });

    expect(Object.keys(json.features)).toEqual([
      GITHUB_CLI,
      'ghcr.io/devcontainers/features/python:1',
    ]);
  });

  it('список ЗАМЕНЯЕТ дефолт целиком — обвес не дописывает своё молча', async () => {
    // Дописывать github-cli к чужому списку значило бы, что снять его нельзя
    // вовсе. Форматтер обвес в список добавляет, и это НЕ противоречие: там
    // «форматтер задан» и «расширение стоит» — одно утверждение, а здесь два
    // разных инструмента.
    const { json } = await materialize({
      devcontainerFeatures: ['ghcr.io/devcontainers/features/go:1'],
    });

    expect(Object.keys(json.features)).toEqual([
      'ghcr.io/devcontainers/features/go:1',
    ]);
  });

  it('пустой список — блока features в артефакте нет вовсе', async () => {
    const { json, text } = await materialize({ devcontainerFeatures: [] });

    expect(json.features).toBeUndefined();
    expect(text).not.toContain('"features"');
    // И артефакт остаётся валидным devcontainer, а не «почти валидным».
    expect(json.image).toContain('typescript-node');
  });

  it('дубль в списке — НАЗВАННЫЙ отказ: в артефакте это один ключ', async () => {
    const { result, text } = await materialize({
      devcontainerFeatures: [GITHUB_CLI, GITHUB_CLI],
    });

    expect(text).toBe(null);
    expect(result.problems.map((problem) => problem.code)).toContain(
      'render-failed',
    );
    expect(JSON.stringify(result.problems)).toContain('названа дважды');
  });
});

describe('НЕ МОЛЧАТЬ: тулчейн, объявленный репозиторием, назван вслух', () => {
  it('питон объявлен, команды нет — сказано ЧТО объявлено и ЧЕМ чинить', async () => {
    const { json } = await materialize();
    const step = toolchainStep(json);

    const result = await sh(
      step,
      repo({ files: ['.python-version', 'uv.lock'] }),
    );

    // Не отказ: девбокс работает, упадут только таргеты этого тулчейна. Но
    // молчать он не имеет права — человек узнавал это первым `git commit`.
    expect(result.code).toBe(0);
    expect(result.err).toContain('Репозиторий объявляет питон');
    expect(result.err).toContain('Репозиторий объявляет uv');
    // Названо и то, чего человек не знал: «девбокс» у нас значит «НОДОВЫЙ девбокс».
    expect(result.err).toContain('Девбокс НОДОВЫЙ');
    // И названо, ЧЕМ чинить: настройкой, а не форком обвеса.
    expect(result.err).toContain('devcontainerFeatures');
    expect(result.err).toContain('https://containers.dev/features');
    // И когда прилетит цена, если не чинить.
    expect(result.err).toContain('первым же git commit');
  });

  it('go — тот же класс: следующие три переезжающих продукта на нём', async () => {
    const { json } = await materialize();

    const result = await sh(toolchainStep(json), repo({ files: ['go.mod'] }));

    expect(result.err).toContain('Репозиторий объявляет go (go.mod)');
    expect(result.err).not.toContain('питон');
  });

  it('`[tool.uv]` в pyproject.toml читается так же, как uv.lock', async () => {
    const { json } = await materialize();

    const result = await sh(
      toolchainStep(json),
      repo({
        files: [
          [
            'pyproject.toml',
            '[project]\nname = "x"\n[tool.uv]\ndev-dependencies = []\n',
          ],
        ],
      }),
    );

    expect(result.err).toContain('Репозиторий объявляет uv');
  });

  it('НОДОВЫЙ репозиторий не слышит ни строки — проверка не шумит', async () => {
    const { json } = await materialize();

    const result = await sh(
      toolchainStep(json),
      repo({ files: ['package.json', 'pnpm-lock.yaml'] }),
    );

    expect(result.err).toBe('');
    expect(result.code).toBe(0);
  });

  it('фичу добавили — проверка ЗАМОЛКАЕТ сама, и это её второй конец', async () => {
    // Оба конца меряются фактом: файл в корне репозитория и команда в PATH.
    // Поэтому «починил» здесь не декларация, а появившиеся команды — ровно то,
    // что делает с контейнером добавленная фича.
    const { json } = await materialize({
      devcontainerFeatures: [
        GITHUB_CLI,
        'ghcr.io/devcontainers/features/python:1',
      ],
    });

    const result = await sh(
      toolchainStep(json),
      repo({ files: ['.python-version', 'uv.lock'], tools: ['python', 'uv'] }),
    );

    expect(result.err).toBe('');
    expect(result.code).toBe(0);
  });

  it('проверка стоит В ЛЮБОМ профиле, включая пресет omnifield', async () => {
    // «Девбокс НОДОВЫЙ» — свойство обвеса, а не раскладки omnifield: сними
    // пресет, и потеря останется той же самой.
    consumer = installConsumer({
      repoName: 'brainer',
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    await run({ command: 'apply', cwd: consumer.root });

    const step = toolchainStep(parseJsonc(consumer.read(LIVE)));
    const result = await sh(step, repo({ files: ['go.mod'] }));

    expect(result.err).toContain('Репозиторий объявляет go');
  });

  it('шаг НЕ роняет постсоздание: следом идёт установка зависимостей', async () => {
    const { json } = await materialize();

    // Названная потеря — не отказ, и цепочка `&&` обязана дожить до установки
    // даже когда потеря названа. Иначе полиглот получил бы девбокс без
    // зависимостей вместо девбокса без питона.
    const post = json.postCreateCommand;
    expect(post.endsWith('pnpm install --frozen-lockfile')).toBe(true);
    const upToInstall = post.slice(
      0,
      -' && pnpm install --frozen-lockfile'.length,
    );
    const result = await sh(upToInstall, repo({ files: ['.python-version'] }));
    expect(result.code).toBe(0);
  });
});

describe('план называет значение настройки до применения', () => {
  it('список фич виден в ответе двери как НАШ, пока его не заполнили', async () => {
    consumer = installConsumer({
      repoName: 'brainer',
      config: consumerConfig(),
    });

    const result = await run({ command: 'plan', cwd: consumer.root });

    const features = soleRun(result).settings.find(
      (setting) => setting.key === 'devcontainerFeatures',
    );
    expect(features.value).toEqual([GITHUB_CLI]);
    expect(features.ours).toBe(true);
  });
});
