/**
 * ПРОБА ФОРМЫ на живом обвесе.
 *
 * Приёмка формы — её выразительность: если реальный обвес ею не описывается,
 * плохая форма, а не пример. Поэтому проба берёт `.devcontainer` ЭТОГО
 * репозитория и описывает его объявлением обвеса во всех трёх слоях —
 * универсальное, настройки, пресет omnifield.
 *
 * Прогон идёт через РЕАЛИЗОВАННЫЕ валидаторы, а не глазами: то же объявление
 * проходит `readSourceDeclaration`, `parseConsumerConfig`, `resolveSettings` и
 * `checkSingleProvider`, что и настоящий обвес у двери.
 *
 * Подстановку значений здесь делает сам тест — это обязательство ДВЕРИ
 * (`tasker:BASER2-23`), а не контрактов: движок значений не получает вовсе.
 * Проба берёт тот же шаблонизатор, которым дверь будет пользоваться.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseConsumerConfig } from './config.js';
import {
  readSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { declarationBlock } from './form.fixture.js';
import { describeProblems } from './problems.js';
import { checkSingleProvider } from './providers.js';
import { resolveSettings, type ComputeDefault } from './settings.js';
import { checkTemplate } from './template.js';
import { FORM_VERSION } from './version.js';
import type { SettingValue } from './values.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const example = join(repoRoot, 'packages/baser-contracts/examples/devbox');

const manifest = readJson(join(example, 'declaration.json'));
const config = readJson(join(example, 'consumer/baser.json'));

/** Резолверы обвеса — модуль его же пакета; загружает их дверь, не контракт. */
let resolvers: Record<string, (ctx: unknown) => SettingValue>;
let render: (template: string, values: Record<string, unknown>) => string;

beforeAll(async () => {
  resolvers = (await import(
    pathToFileURL(join(example, 'defaults.mjs')).href
  )) as typeof resolvers;

  const ejs = createRequire(import.meta.url)(findEjs()) as {
    render: (t: string, d: object, o?: object) => string;
  };
  // `<%-` вместо `<%=` в шаблоне и никакого HTML-экранирования на выходе:
  // артефакты — это JSON и shell, кавычка обязана остаться кавычкой.
  render = (template, values) => ejs.render(template, values, {});
});

function declaration(): SourceDeclaration {
  const parsed = readSourceDeclaration(
    manifest,
    'examples/devbox/declaration.json',
  );
  if (!parsed.ok) {
    throw new Error(
      `объявление обвеса непригодно:\n${JSON.stringify(parsed.problems, null, 2)}`,
    );
  }
  return parsed.value;
}

function resolved(
  patch: { presets?: string[]; settings?: Record<string, SettingValue> } = {},
) {
  const parsedConfig = parseConsumerConfig(config);
  if (!parsedConfig.ok) {
    throw new Error('конфиг потребителя непригоден');
  }
  const entry = { ...parsedConfig.value.sources[0], ...patch };

  const computeDefault: ComputeDefault = (ref) => {
    const fn = resolvers[ref.member];
    if (!fn) {
      throw new Error(`в ${ref.module} нет экспорта ${ref.member}`);
    }
    return fn({
      repo: { name: 'baser', root: repoRoot },
      source: {
        id: 'omnifield/devbox',
        packageName: '@omnifield/baser-devbox',
        version: '0.1.0',
      },
    });
  };

  const result = resolveSettings(declaration(), entry, { computeDefault });
  if (!result.ok) {
    throw new Error(
      `значения не разрешились:\n${JSON.stringify(result.problems, null, 2)}`,
    );
  }
  return result.value.values;
}

function materialize(
  values: Record<string, SettingValue>,
): Record<string, string> {
  const decl = declaration();
  const out: Record<string, string> = {};
  for (const entry of decl.layout) {
    const template = readFileSync(
      join(example, decl.source.contentRoot, entry.src),
      'utf-8',
    );
    if (!entry.render) {
      // Не шаблон, а содержимое: кладётся байт в байт и языком формы не меряется.
      out[entry.dest] = template;
      continue;
    }
    // Дверь обязана спросить форму, на том ли языке написан шаблон, ДО рендера:
    // чужой язык отрендерился бы сам в себя и лёг к потребителю молча.
    const problems = checkTemplate(template, `${entry.src} → ${entry.dest}`);
    if (problems.length) {
      throw new Error(
        `шаблон не на языке формы:\n${describeProblems(problems)}`,
      );
    }
    out[entry.dest] = render(template, values);
  }
  return out;
}

describe('проба формы: живой .devcontainer этого репозитория', () => {
  it('объявление обвеса и конфиг потребителя пригодны', () => {
    const decl = declaration();
    expect(decl.source.id).toBe('omnifield/devbox');
    expect(decl.layout.map((entry) => entry.dest)).toEqual([
      '.devcontainer/devcontainer.json',
      '.devcontainer/devcontainer-lock.json',
    ]);
    // Второй артефакт обязан лечь байт в байт — это пин toolchain по digest.
    expect(decl.layout[1].render).toBe(false);

    const owners = checkSingleProvider([
      { declaration: decl, packageName: '@omnifield/baser-devbox' },
    ]);
    expect(owners.ok).toBe(true);
  });

  it('НОЛЬ ВОПРОСОВ ПОЛЬЗОВАТЕЛЮ: имя из имени репозитория, остальное — пресет', () => {
    // Конфиг потребителя не содержит ни одного заполненного значения.
    expect(resolved()).toEqual({
      name: 'baser-devbox',
      networkAlias: 'baser',
      image: 'mcr.microsoft.com/devcontainers/typescript-node',
      runtimeVersion: '22',
      installCommand: 'pnpm install --frozen-lockfile',
      editorExtensions: ['esbenp.prettier-vscode', 'nrwl.angular-console'],
      network: 'omnifield-gateway',
      secretsVolume: 'omnifield-secrets',
      pnpmStoreVolume: 'omnifield-pnpm-store',
      installAssistant: true,
    });
  });

  it('слой «универсальное + настройки + пресет» сходится с файлом на диске', () => {
    const produced = materialize(resolved());

    for (const [dest, text] of Object.entries(produced)) {
      const actual = readFileSync(join(repoRoot, dest), 'utf-8');
      if (dest.endsWith('devcontainer.json')) {
        // Единственное расхождение названо заранее и оно ПРОЗАИЧЕСКОЕ: во второй
        // строке живого файла руками написано «baser devbox», а обвес на её месте
        // подставляет настройку `name`. Структурных расхождений нет.
        expect(withoutLine(text, 2)).toBe(withoutLine(actual, 2));
        expect(text.split('\n')[1]).toContain('baser-devbox — Ф2');
        expect(actual.split('\n')[1]).toContain('baser devbox — Ф2');
      } else {
        expect(text).toBe(actual);
      }
    }
  });

  it('рендер не экранирует под HTML — кавычка остаётся кавычкой', () => {
    const text = materialize(resolved())['.devcontainer/devcontainer.json'];
    expect(text).not.toContain('&#34;');
    expect(text).toContain('"--network=omnifield-gateway"');
    expect(() => JSON.parse(stripComments(text))).not.toThrow();
  });

  it('слой «универсальное»: тот же обвес без пресета — валидный devcontainer', () => {
    const text = materialize(resolved({ presets: [] }))[
      '.devcontainer/devcontainer.json'
    ];
    const parsed = JSON.parse(stripComments(text)) as Record<string, unknown>;

    expect(parsed['runArgs']).toEqual([
      '--add-host=host.docker.internal:host-gateway',
      '--restart=unless-stopped',
    ]);
    expect(parsed['mounts']).toBeUndefined();
    expect(parsed['containerEnv']).toBeUndefined();
    expect(parsed['postCreateCommand']).toBe('pnpm install --frozen-lockfile');
  });

  it('слой «настройки»: заполненное значение бьёт пресет', () => {
    const text = materialize(
      resolved({
        settings: { runtimeVersion: '24', installCommand: 'npm ci' },
      }),
    )['.devcontainer/devcontainer.json'];
    const parsed = JSON.parse(stripComments(text)) as Record<string, string>;

    expect(parsed['image']).toBe(
      'mcr.microsoft.com/devcontainers/typescript-node:24',
    );
    expect(parsed['postCreateCommand']).toMatch(/&& npm ci$/);
    // Пресет при этом на месте: заполнено одно значение, а не отменён слой.
    expect(parsed['postCreateCommand']).toContain('/home/node/.secrets');
  });
});

describe('проба отказов: каждый случай называется вслух', () => {
  it('два обвеса на один dest', () => {
    const надстройка = readSourceDeclaration({
      baser: declarationBlock({
        source: {
          id: 'omnifield/devbox-plus',
          title: 'Надстройка',
          contentRoot: 'tpl',
        },
        layout: [{ src: 'over.json', dest: '.devcontainer/devcontainer.json' }],
      }),
    });
    expect(надстройка.ok).toBe(true);
    if (!надстройка.ok) return;

    const result = checkSingleProvider([
      { declaration: declaration(), packageName: '@omnifield/baser-devbox' },
      { declaration: надстройка.value, packageName: '@чужой/devbox-plus' },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].code).toBe('artifact-shared');
    expect(result.problems[0].message).toContain(
      '.devcontainer/devcontainer.json',
    );
  });

  it('незнакомый ключ настройки в конфиге потребителя', () => {
    expect(() => resolved({ settings: { runtimeVerison: '24' } })).toThrow(
      /unknown-setting/,
    );
  });

  it('обвес без дефолта у настройки', () => {
    const broken = readSourceDeclaration({
      baser: declarationBlock({
        settings: { runtimeVersion: { title: 'Версия Node', type: 'string' } },
      }),
    });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.problems[0].code).toBe('setting-no-default');
    expect(broken.problems[0].message).toContain('вопросов у двери не бывает');
  });

  it('ТОТ ЖЕ ОБВЕС, ШАБЛОН НА ЧУЖОМ ЯЗЫКЕ', () => {
    // Берём живой шаблон девбокса и переписываем подстановки на Handlebars.
    // EJS отрендерил бы такое сам в себя: артефакт лёг бы к потребителю с
    // неподставленным "{{ name }}" и ничем бы себя не выдал.
    const real = readFileSync(
      join(example, 'template/devcontainer.json.ejs'),
      'utf-8',
    );
    const foreign = real
      .replace(/<%[^]*?%>/g, '')
      .replace('"name": ""', '"name": "{{ name }}"');

    const problems = checkTemplate(foreign, 'подделка → devcontainer.json');
    expect(problems.map((problem) => problem.code)).toEqual([
      'template-not-ejs',
    ]);
    expect(problems[0].message).toContain('EJS');
  });

  it('тот же обвес с экранирующей подстановкой', () => {
    const real = readFileSync(
      join(example, 'template/devcontainer.json.ejs'),
      'utf-8',
    );
    const escaping = real.replace('<%- name %>', '<%= name %>');

    const problems = checkTemplate(escaping, 'подделка → devcontainer.json');
    expect(problems.map((problem) => problem.code)).toEqual([
      'template-html-escape',
    ]);
  });

  it('версию конфига проставила дверь, пользователь её не вводил', () => {
    const parsed = parseConsumerConfig(config);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.formVersion).toBe(FORM_VERSION);
    }
  });
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function stripComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, '');
}

function withoutLine(text: string, line: number): string {
  const lines = text.split('\n');
  lines.splice(line - 1, 1);
  return lines.join('\n');
}

/**
 * ejs приезжает транзитивно с `@nx/devkit` (движок по форме — генератор Nx), и
 * своей зависимости на него контракты НЕ заводят: подстановка значений — дело
 * двери, а не формы.
 */
function findEjs(): string {
  const store = join(repoRoot, 'node_modules/.pnpm');
  const dir = readdirSync(store).find((name) => name.startsWith('ejs@'));
  if (!dir) {
    throw new Error('ejs не найден в pnpm-сторе — прогнать пробу нечем');
  }
  return join(store, dir, 'node_modules/ejs');
}
