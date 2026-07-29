/**
 * ПРОБА ФОРМЫ на живых обвесах.
 *
 * Приёмка формы — её выразительность: если реальный обвес ею не описывается,
 * плохая форма, а не пример. Поэтому проба берёт ДВА обвеса этого репозитория —
 * `.devcontainer` (девбокс) и `.omnifield/harness.yaml` (плагин агент-харнесса) —
 * и описывает их объявлениями во всех слоях: универсальное, настройки, пресет.
 *
 * Два, а не один, намеренно: несколько инструментов в репозитории — норма по
 * построению (`kb:BASER2-2` §2, `tasker:BASER2-48`), и форма обязана выражать это
 * прогоном, а не обещанием. Заодно видно то, ради чего форма 2 и заводилась: у
 * артефактов разный КЛАСС, а настройки каждого лежат в СВОЁМ файле, имя которого
 * считается из личности.
 *
 * Прогон идёт через РЕАЛИЗОВАННЫЕ валидаторы, а не глазами: те же объявления
 * проходят `readSourceDeclaration`, `parseConsumerConfig`, `parseSourceConfig`,
 * `resolveSettings` и `checkSingleProvider`, что и настоящий обвес у двери.
 *
 * **`examples/` — не выписка из живых пакетов.** Объявления здесь написаны под
 * пробу и от выпущенных обвесов отстали: у девбокса `0.1.0` против `0.5.0` и три
 * незаведённые настройки. Выразительность формы это не искажает — все её слова в
 * примере есть, — но читать пример как актуальное объявление девбокса нельзя.
 * Приведение примеров к живым обвесам — `tasker:BASER2-27`, отдельный заход.
 *
 * Подстановку значений и разбор YAML здесь делает сам тест — это обязательства
 * ДВЕРИ (`tasker:BASER2-23`, `tasker:BASER2-53`), а не контрактов: пакет ничего
 * не читает и ничего не исполняет. Проба берёт те же инструменты, которыми дверь
 * будет пользоваться.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  parseConsumerConfig,
  parseSourceConfig,
  sourceConfigPath,
  type SourceConfig,
} from './config.js';
import {
  readSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import { describeProblems } from './problems.js';
import { checkSingleProvider } from './providers.js';
import { resolveSettings, type ComputeDefault } from './settings.js';
import { checkTemplate } from './template.js';
import { FORM_VERSION } from './version.js';
import type { SettingValue } from './values.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const examples = join(repoRoot, 'packages/baser-contracts/examples');
const consumer = join(examples, 'consumer');

/** Обвесы, поставленные в этот репозиторий: каталог примера → имя пакета. */
const TOOLS = {
  devbox: '@omnifield/baser-devbox',
  harness: '@omnifield/brainer-agent-harness',
} as const;
type Tool = keyof typeof TOOLS;

/** Резолверы обвеса — модуль его же пакета; загружает их дверь, не контракт. */
const resolvers: Record<
  string,
  Record<string, (ctx: unknown) => SettingValue>
> = {};
let render: (template: string, values: Record<string, unknown>) => string;
let parseYaml: (text: string) => unknown;

beforeAll(async () => {
  for (const tool of Object.keys(TOOLS) as Tool[]) {
    resolvers[tool] = (await import(
      pathToFileURL(join(examples, tool, 'defaults.mjs')).href
    )) as Record<string, (ctx: unknown) => SettingValue>;
  }

  const require = createRequire(import.meta.url);
  const ejs = require(fromStore('ejs')) as {
    render: (t: string, d: object, o?: object) => string;
  };
  // `<%-` вместо `<%=` в шаблоне и никакого HTML-экранирования на выходе:
  // артефакты — это JSON и shell, кавычка обязана остаться кавычкой.
  render = (template, values) => ejs.render(template, values, {});

  const yaml = require(fromStore('yaml')) as {
    parse: (text: string) => unknown;
  };
  parseYaml = (text) => yaml.parse(text);
});

function declaration(tool: Tool): SourceDeclaration {
  const parsed = readSourceDeclaration(
    readJson(join(examples, tool, 'declaration.json')),
    `examples/${tool}/declaration.json`,
  );
  if (!parsed.ok) {
    throw new Error(
      `объявление обвеса непригодно:\n${JSON.stringify(parsed.problems, null, 2)}`,
    );
  }
  return parsed.value;
}

/** Установленный набор — то, что дверь получает из `baser.json`. */
function installed() {
  const parsed = parseConsumerConfig(readJson(join(consumer, 'baser.json')));
  if (!parsed.ok) {
    throw new Error(
      `конфиг потребителя непригоден:\n${describeProblems(parsed.problems)}`,
    );
  }
  return parsed.value;
}

/**
 * Файл настроек обвеса у потребителя — по имени, считанному из его личности.
 *
 * Читает YAML дверь, а не форма: сюда приезжает уже разобранное значение.
 */
function tuning(tool: Tool): SourceConfig {
  const path = sourceConfigPath(declaration(tool).source.id);
  const parsed = parseSourceConfig(
    parseYaml(readFileSync(join(consumer, path), 'utf-8')),
    path,
  );
  if (!parsed.ok) {
    throw new Error(
      `файл настроек непригоден:\n${describeProblems(parsed.problems)}`,
    );
  }
  return parsed.value;
}

function resolved(
  tool: Tool,
  patch: Partial<SourceConfig> = {},
): Record<string, SettingValue> {
  const decl = declaration(tool);
  const config = { ...tuning(tool), ...patch };

  const computeDefault: ComputeDefault = (ref) => {
    const fn = resolvers[tool][ref.member];
    if (!fn) {
      throw new Error(`в ${ref.module} нет экспорта ${ref.member}`);
    }
    return fn({
      repo: { name: 'baser', root: repoRoot },
      source: {
        id: decl.source.id,
        packageName: TOOLS[tool],
        // Версия приходит из манифеста пакета — вторым полем объявления она не
        // заводится (`tasker:BASER2-10` §1).
        version: (
          readJson(join(examples, tool, 'declaration.json')) as {
            version: string;
          }
        ).version,
      },
    });
  };

  const result = resolveSettings(decl, config, { computeDefault });
  if (!result.ok) {
    throw new Error(
      `значения не разрешились:\n${JSON.stringify(result.problems, null, 2)}`,
    );
  }
  return result.value.values as Record<string, SettingValue>;
}

function materialize(
  tool: Tool,
  values: Record<string, SettingValue>,
): Record<string, string> {
  const decl = declaration(tool);
  const out: Record<string, string> = {};
  for (const entry of decl.layout) {
    const template = readFileSync(
      join(examples, tool, decl.source.contentRoot, entry.src),
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

describe('проба формы: два обвеса этого репозитория сразу', () => {
  it('оба объявления и перечень поставленного пригодны', () => {
    expect(installed().sources.map((entry) => entry.use)).toEqual([
      TOOLS.devbox,
      TOOLS.harness,
    ]);
    expect(declaration('devbox').source.id).toBe('omnifield/devbox');
    expect(declaration('harness').source.id).toBe('omnifield/agent-harness');
  });

  it('НЕСКОЛЬКО ИНСТРУМЕНТОВ СРАЗУ: одна карта владения, разные классы', () => {
    const owners = checkSingleProvider(
      (Object.keys(TOOLS) as Tool[]).map((tool) => ({
        declaration: declaration(tool),
        packageName: TOOLS[tool],
      })),
    );
    expect(owners.ok).toBe(true);
    if (!owners.ok) return;

    expect(Object.keys(owners.value)).toEqual([
      '.devcontainer/devcontainer-lock.json',
      '.devcontainer/devcontainer.json',
      '.omnifield/harness.yaml',
    ]);
    // Наш файл перегенерируется целиком; конфиг, которым дальше владеет продукт,
    // кладётся один раз и больше не трогается.
    expect(owners.value['.devcontainer/devcontainer.json'].class).toBe(
      'regenerated',
    );
    expect(owners.value['.omnifield/harness.yaml'].class).toBe('placed-once');
    // Второй артефакт девбокса обязан лечь байт в байт — это пин toolchain по digest.
    expect(owners.value['.devcontainer/devcontainer-lock.json'].render).toBe(
      false,
    );
  });

  it('У КАЖДОГО ИНСТРУМЕНТА СВОЙ ФАЙЛ НАСТРОЕК, имя — из личности', () => {
    expect(sourceConfigPath(declaration('devbox').source.id)).toBe(
      '.omnifield/omnifield-devbox.yaml',
    );
    expect(sourceConfigPath(declaration('harness').source.id)).toBe(
      '.omnifield/omnifield-agent-harness.yaml',
    );
    // Оба лежат в одной папке — человек ходит в одно место (`kb:BASER2-2` §4).
    expect(tuning('devbox').presets).toEqual(['omnifield']);
    expect(tuning('harness').settings['zones']).toEqual([
      'contracts',
      'materialize',
      'cli',
    ]);
  });

  it('ОДИН ФАЙЛ, ДВА ЧИТАТЕЛЯ: чужая половина двери не мешает', () => {
    // В файле настроек харнесса рядом с ключом `baser` лежат адреса сервисов —
    // это дело самого инструмента, и дверь о них молчит.
    const raw = parseYaml(
      readFileSync(
        join(consumer, sourceConfigPath('omnifield/agent-harness')),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    expect(raw['services']).toBeDefined();
    expect(Object.keys(tuning('harness').settings)).toEqual(['zones']);
  });

  it('НОЛЬ ВОПРОСОВ ПОЛЬЗОВАТЕЛЮ: имя из имени репозитория, остальное — пресет', () => {
    // В файле настроек девбокса не заполнено ни одного значения — только пресет.
    expect(resolved('devbox')).toEqual({
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
    const produced = materialize('devbox', resolved('devbox'));

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

  it('placed-once: артефакт харнесса сходится с живым по существу', () => {
    const text = materialize('harness', resolved('harness'))[
      '.omnifield/harness.yaml'
    ];
    const produced = parseYaml(text) as Record<string, unknown>;
    const live = parseYaml(
      readFileSync(join(repoRoot, '.omnifield/harness.yaml'), 'utf-8'),
    ) as Record<string, unknown>;

    // Байт в байт с живым файлом он и НЕ ОБЯЗАН сходиться: класс placed-once
    // означает, что дальше файлом владеет продукт, и правки в нём — не
    // расхождение, а работа человека. Сверяем то, что кладёт обвес.
    expect(produced['product']).toBe(live['product']);
    expect(produced['kind']).toBe('harness');
    expect(Object.keys(produced['zones'] as object)).toEqual([
      'contracts',
      'materialize',
      'cli',
    ]);
  });

  it('рендер не экранирует под HTML — кавычка остаётся кавычкой', () => {
    const text = materialize('devbox', resolved('devbox'))[
      '.devcontainer/devcontainer.json'
    ];
    expect(text).not.toContain('&#34;');
    expect(text).toContain('"--network=omnifield-gateway"');
    expect(() => JSON.parse(stripComments(text))).not.toThrow();
  });

  it('слой «универсальное»: тот же обвес без пресета — валидный devcontainer', () => {
    const text = materialize('devbox', resolved('devbox', { presets: [] }))[
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
      'devbox',
      resolved('devbox', {
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
          id: 'omnifield/devbox-over',
          title: 'Надстройка',
          contentRoot: 'tpl',
        },
        layout: [{ src: 'over.json', dest: '.devcontainer/devcontainer.json' }],
      }),
    });
    expect(надстройка.ok).toBe(true);
    if (!надстройка.ok) return;

    const result = checkSingleProvider([
      { declaration: declaration('devbox'), packageName: TOOLS.devbox },
      { declaration: надстройка.value, packageName: '@чужой/devbox-over' },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].code).toBe('artifact-shared');
    expect(result.problems[0].message).toContain(
      '.devcontainer/devcontainer.json',
    );
  });

  it('незнакомый ключ настройки в файле настроек', () => {
    expect(() =>
      resolved('devbox', { settings: { runtimeVerison: '24' } }),
    ).toThrow(/unknown-setting/);
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

  it('ОБВЕС ПЕРВОЙ ФОРМЫ: отказ целиком, а не разбор наполовину', () => {
    // Живой обвес, у которого поднята только версия формы: настройки потребителя
    // он всё ещё ждёт в baser.json, и разобрать его по правилам формы 2 значило бы
    // молча потерять то, что человек настроил.
    const manifest = readJson(join(examples, 'devbox/declaration.json')) as {
      baser: Record<string, unknown>;
    };
    const старый = readSourceDeclaration({
      ...manifest,
      baser: { ...manifest.baser, formVersion: 1 },
    });

    expect(старый.ok).toBe(false);
    if (старый.ok) return;
    expect(codesOf(старый.problems)).toEqual(
      ['package.json.baser.formVersion'].map(
        (at) => `form-version-unsupported @ ${at}`,
      ),
    );
    expect(старый.problems[0].message).toContain('обнови обвес');
  });

  it('НАСТРОЙКИ, ОСТАВЛЕННЫЕ В baser.json: сказано, куда они уехали', () => {
    const первая = parseConsumerConfig({
      formVersion: 2,
      sources: [{ use: TOOLS.devbox, presets: ['omnifield'] }],
    });
    expect(первая.ok).toBe(false);
    if (первая.ok) return;
    expect(первая.problems[0].code).toBe('consumer-settings-moved');
    expect(первая.problems[0].message).toContain('.omnifield/');
  });

  it('ТОТ ЖЕ ОБВЕС, ШАБЛОН НА ЧУЖОМ ЯЗЫКЕ', () => {
    // Берём живой шаблон девбокса и переписываем подстановки на Handlebars.
    // EJS отрендерил бы такое сам в себя: артефакт лёг бы к потребителю с
    // неподставленным "{{ name }}" и ничем бы себя не выдал.
    const real = readFileSync(
      join(examples, 'devbox/template/devcontainer.json.ejs'),
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
      join(examples, 'devbox/template/devcontainer.json.ejs'),
      'utf-8',
    );
    const escaping = real.replace('<%- name %>', '<%= name %>');

    const problems = checkTemplate(escaping, 'подделка → devcontainer.json');
    expect(problems.map((problem) => problem.code)).toEqual([
      'template-html-escape',
    ]);
  });

  it('версию конфига проставила дверь, пользователь её не вводил', () => {
    expect(installed().formVersion).toBe(FORM_VERSION);
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
 * Инструменты ДВЕРИ, а не формы: `ejs` приезжает транзитивно с `@nx/devkit`,
 * `yaml` — с инструментарием сборки. Своих зависимостей на них контракты НЕ
 * заводят: подстановка значений и чтение файла — дело двери (`tasker:BASER2-53`),
 * а пакет формы не читает и не исполняет ничего.
 */
function fromStore(name: string): string {
  const store = join(repoRoot, 'node_modules/.pnpm');
  const dir = readdirSync(store)
    .filter((entry) => entry.startsWith(`${name}@`))
    .sort()
    .at(-1);
  if (!dir) {
    throw new Error(`${name} не найден в pnpm-сторе — прогнать пробу нечем`);
  }
  return join(store, dir, 'node_modules', name);
}
