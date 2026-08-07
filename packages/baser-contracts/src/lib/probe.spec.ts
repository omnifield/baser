/**
 * ПРОБА ФОРМЫ на СИНТЕТИЧЕСКОЙ фикстуре.
 *
 * Приёмка формы — её выразительность: если инструмент ею не описывается, плохая
 * форма, а не пример. Проба берёт ДВА обвеса-фикстуры (`examples/kit` и
 * `examples/seed`) и описывает ими всё, что форма умеет сказать: личность,
 * раскладку с классами, настройки всех типов, вычисляемый дефолт, пресет,
 * столкновение и язык шаблона.
 *
 * Два, а не один, намеренно: несколько инструментов в репозитории — норма по
 * построению (`kb:BASER2-2` §2, `tasker:BASER2-48`), и форма обязана выражать это
 * прогоном, а не обещанием. Заодно видно то, ради чего форма 2 и заводилась: у
 * артефактов разный КЛАСС, а настройки каждого лежат в СВОЁМ файле, имя которого
 * считается из личности.
 *
 * ## Почему фикстура синтетическая, а не «настоящий обвес»
 *
 * Пример был черновиком обвеса, пока настоящего пакета не существовало
 * (`tasker:BASER2-27`). Пакет есть — и копия немедленно разъехалась с ним
 * (`0.1.0` против `0.5.0`), потому что копии для этого достаточно существовать.
 *
 * Выразительность формы на НАСТОЯЩЕМ обвесе доказывает дверь
 * (`tasker:BASER2-26`, `tasker:BASER2-78`): её приёмка ставит `@omnifield/baser-devbox`
 * так же, как его получит потребитель — распакованным тарболом от `npm pack`, —
 * и сверяет уложенное с живым репозиторием байт в байт. Второй копии того же
 * обвеса здесь поэтому нет и быть не должно: контракты программируют форму, а не
 * повторяют инструмент. Зависимости на девбокс у контрактов нет намеренно — обвес
 * программирует против формы, а не наоборот.
 *
 * ## Эталон укладки — в самой фикстуре, и сверка не прощает ничего
 *
 * `examples/consumer` — синтетический репозиторий потребителя: перечень
 * поставленного, два файла настроек и то, что обвесы в него укладывают. Проба
 * рендерит объявления и сверяет результат с этими файлами **байт в байт, без
 * единого исключения**: прощённая строка означала бы, что расхождение уже
 * поселилось и его согласились не замечать.
 *
 * Проба не читает ни одного файла живого репозитория — ни `.devcontainer`, ни
 * `.omnifield/harness.yaml`. Сверка с живым файлом принадлежит двери, у которой
 * есть и настоящий обвес, и движок.
 *
 * Прогон идёт через РЕАЛИЗОВАННЫЕ валидаторы, а не глазами: те же объявления
 * проходят `readSourceDeclaration`, `parseConsumerConfig`, `parseSourceConfig`,
 * `resolveSettings` и `checkSingleProvider`, что и настоящий обвес у двери.
 *
 * Подстановку значений и разбор YAML здесь делает сам тест — это обязательства
 * ДВЕРИ (`tasker:BASER2-23`, `tasker:BASER2-53`), а не контрактов: пакет ничего
 * не читает и ничего не исполняет. Проба берёт те же инструменты, которыми дверь
 * будет пользоваться.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONSUMER_CONFIG_PATH,
  parseConsumerConfig,
  parseSourceConfig,
  sourceConfigPath,
  type SourceConfig,
} from './config.js';
import {
  readSourceDeclaration,
  type ResolverRef,
  type SourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import { describeProblems } from './problems.js';
import { checkSingleProvider } from './providers.js';
import { resolveSettings, type ComputeDefault } from './settings.js';
import { checkTemplate } from './template.js';
import {
  CHANNEL_SINCE,
  EXECUTABLE_SINCE,
  FORM_VERSION,
  MAP_TYPE_SINCE,
  PINNED_VERSION_SINCE,
  WARNING_SINCE,
} from './version.js';
import type { SettingValue } from './values.js';
import { resolveWarning, type SourceWarning } from './warning.js';

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, '../../examples');

/**
 * Синтетический репозиторий потребителя: что поставлено, как настроено и что
 * легло. Он же — эталон, с которым сверяется рендер.
 */
const consumer = join(examples, 'consumer');
/** Имя «репозитория» для резолверов — фикстура, а не этот репозиторий. */
const CONSUMER_REPO = 'consumer';

/** Обвесы-фикстуры: каталог примера → имя пакета, которым его привезли. */
const TOOLS = {
  kit: '@fixture/kit',
  seed: '@fixture/seed',
} as const;
type Tool = keyof typeof TOOLS;

/**
 * Резолверы обвеса — модули его же пакета; загружает их ДВЕРЬ, не контракт.
 *
 * Ключ — `<обвес>/<модуль>`, как в самой ссылке объявления: резолверов у формы
 * два (вычисляемый дефолт и вычисляемое предупреждение), и живут они в разных
 * файлах. Разбирать ссылку и звать «какой-нибудь модуль» значило бы проверять не
 * то, что делает дверь.
 */
const resolvers: Record<string, Record<string, (ctx: unknown) => unknown>> = {};
let render: (template: string, values: Record<string, unknown>) => string;
let parseYaml: (text: string) => unknown;

beforeAll(async () => {
  for (const tool of Object.keys(TOOLS) as Tool[]) {
    for (const file of readdirSync(join(examples, tool)).filter((name) =>
      name.endsWith('.mjs'),
    )) {
      resolvers[`${tool}/${file}`] = (await import(
        pathToFileURL(join(examples, tool, file)).href
      )) as Record<string, (ctx: unknown) => unknown>;
    }
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

/** Манифест пакета обвеса-фикстуры — то, что дверь читает у поставщика. */
function manifest(tool: Tool): Record<string, unknown> {
  return readJson(join(examples, tool, 'declaration.json')) as Record<
    string,
    unknown
  >;
}

function declaration(tool: Tool): SourceDeclaration {
  const parsed = readSourceDeclaration(
    manifest(tool),
    `examples/${tool}/declaration.json`,
  );
  if (!parsed.ok) {
    throw new Error(
      `объявление обвеса непригодно:\n${describeProblems(parsed.problems)}`,
    );
  }
  return parsed.value;
}

/** Установленный набор — то, что дверь получает из `baser.json`. */
function installed() {
  const parsed = parseConsumerConfig(
    readJson(join(consumer, CONSUMER_CONFIG_PATH)),
  );
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

/**
 * Вызов резолвера обвеса — то, что делает дверь: найти модуль ПО ССЫЛКЕ и
 * позвать экспорт с контекстом.
 *
 * Один загрузчик на оба порта: механизм у них общий, различаются обещания
 * (`warning.ts`), а не способ дотянуться до функции.
 */
function callResolver(tool: Tool, ref: ResolverRef, root: string): unknown {
  const module = resolvers[`${tool}/${ref.module}`];
  if (!module) {
    throw new Error(`модуль ${ref.module} обвес не привёз`);
  }
  const fn = module[ref.member];
  if (!fn) {
    throw new Error(`в ${ref.module} нет экспорта ${ref.member}`);
  }
  return fn({
    repo: { name: CONSUMER_REPO, root },
    source: {
      id: declaration(tool).source.id,
      packageName: TOOLS[tool],
      // Версия приходит из манифеста пакета — вторым полем объявления она не
      // заводится (`tasker:BASER2-10` §1) и бывает отсутствующей
      // (`tasker:BASER2-69`).
      version: (manifest(tool)['version'] as string | undefined) ?? null,
    },
  });
}

/**
 * Что обвес говорит человеку в этой локации — сквозным путём, а не заглушкой.
 *
 * Резолвер грузится настоящим `import` из фикстуры и зовётся с настоящим
 * контекстом: звено формы кончается ровно здесь, и отсюда дверь берёт готовое
 * состояние (`tasker:BASER2-232`).
 */
function warning(tool: Tool, root: string = consumer): SourceWarning {
  return resolveWarning(declaration(tool), (ref) =>
    callResolver(tool, ref, root),
  );
}

function resolved(
  tool: Tool,
  patch: Partial<SourceConfig> = {},
): Record<string, SettingValue> {
  const decl = declaration(tool);
  const config = { ...tuning(tool), ...patch };

  const computeDefault: ComputeDefault = (ref) =>
    callResolver(tool, ref, consumer);

  const result = resolveSettings(decl, config, { computeDefault });
  if (!result.ok) {
    throw new Error(
      `значения не разрешились:\n${describeProblems(result.problems)}`,
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

describe('проба формы: два обвеса-фикстуры сразу', () => {
  it('оба объявления и перечень поставленного пригодны', () => {
    expect(installed().sources.map((entry) => entry.use)).toEqual([
      TOOLS.kit,
      TOOLS.seed,
    ]);
    expect(declaration('kit').source.id).toBe('fixture/kit');
    expect(declaration('seed').source.id).toBe('fixture/seed');
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
      'fixture/hook.sh',
      'fixture/kit.json',
      'fixture/kit.lock.json',
      'fixture/seed.yaml',
    ]);
    // Наш файл перегенерируется целиком; заготовка, которой дальше владеет
    // человек, кладётся один раз и больше не трогается.
    expect(owners.value['fixture/kit.json'].class).toBe('regenerated');
    expect(owners.value['fixture/seed.yaml'].class).toBe('placed-once');
    // Второй артефакт набора обязан лечь байт в байт — это уже содержимое.
    expect(owners.value['fixture/kit.lock.json'].render).toBe(false);
  });

  it('У КАЖДОГО ИНСТРУМЕНТА СВОЙ ФАЙЛ НАСТРОЕК, имя — из личности', () => {
    expect(sourceConfigPath(declaration('kit').source.id)).toBe(
      '.omnifield/fixture-kit.yaml',
    );
    expect(sourceConfigPath(declaration('seed').source.id)).toBe(
      '.omnifield/fixture-seed.yaml',
    );
    // Оба лежат в одной папке — человек ходит в одно место (`kb:BASER2-2` §4).
    expect(tuning('kit').presets).toEqual(['shared']);
    expect(tuning('seed').settings['areas']).toEqual(['form', 'probe', 'door']);
  });

  it('ОДИН ФАЙЛ, ДВА ЧИТАТЕЛЯ: чужая половина двери не мешает', () => {
    // В файле настроек набора рядом с ключом `baser` лежат настройки самого
    // инструмента — это его дело, и дверь о них молчит.
    const raw = parseYaml(
      readFileSync(join(consumer, sourceConfigPath('fixture/kit')), 'utf-8'),
    ) as Record<string, unknown>;
    expect(raw['runner']).toBeDefined();
    // Дверь при этом видит только свою половину, и в ней не заполнено ничего.
    expect(tuning('kit').settings).toEqual({});
  });

  it('НОЛЬ ВОПРОСОВ ПОЛЬЗОВАТЕЛЮ: дефолт, вычисляемое и пресет сходятся сами', () => {
    // В файле настроек набора не заполнено ни одного значения — только пресет.
    expect(resolved('kit')).toEqual({
      name: 'consumer-kit',
      stamp: 'fixture/kit@1.0.0',
      command: 'pnpm exec fixture --scope "*"',
      retries: 2,
      labels: ['form', 'probe'],
      store: 'fixture-store',
      strict: true,
      // Составной тип разрешается тем же порядком, что и остальные: пресет бьёт
      // дефолт, и опции инструмента приезжают вместе со ссылкой на него.
      tools: {
        'fixture/lint': { strict: true },
        'fixture/probe': { version: '0.11' },
      },
      env: null,
    });
  });

  it('СОСТАВНОЙ ТИП: ссылка и её опции выражаются объявлением', () => {
    // То, ради чего форма поднялась до 3 (`tasker:BASER2-116`): рыночная спека
    // принимает опции инструмента ОБЪЕКТОМ, и списком строк это не выражается
    // никак, кроме изобретения словаря внутри строки.
    const spec = declaration('kit').settings['tools'];
    expect([spec.type, spec.of]).toEqual(['map', 'map']);

    const parsed = JSON.parse(
      materialize('kit', resolved('kit'))['fixture/kit.json'],
    ) as { tools: Record<string, Record<string, unknown>> };

    // Опции одной ссылки разнородны — так их объявляет чужая спека, и однородной
    // картой это не выражалось бы.
    expect(parsed.tools['fixture/lint']).toEqual({ strict: true });
    expect(parsed.tools['fixture/probe']).toEqual({ version: '0.11' });
  });

  it('ГЛУБИНА УПИРАЕТСЯ В ДВА ЭТАЖА — и это замер спеки, а не «двух хватит»', () => {
    // Третий этаж не выражается ни объявлением, ни заполненным значением: `of`
    // — слово из закрытого словаря, а не выражение типа.
    const третий = readSourceDeclaration({
      baser: declarationBlock({
        settings: {
          deep: {
            title: 'Глубже спеки',
            type: 'map',
            of: 'map',
            default: { ссылка: { опции: { глубже: 'некуда' } } },
          },
        },
      }),
    });
    expect(третий.ok).toBe(false);
    if (третий.ok) return;
    expect(codesOf(третий.problems)).toEqual([
      'value-type-mismatch @ package.json.baser.settings.deep.default',
    ]);

    // И слово `of` вложить само в себя нечем: словарь закрыт четырьмя.
    const выражение = readSourceDeclaration({
      baser: declarationBlock({
        settings: {
          deep: {
            title: 'Тип выражением',
            type: 'map',
            of: 'map(map)',
            default: {},
          },
        },
      }),
    });
    expect(выражение.ok).toBe(false);
    if (выражение.ok) return;
    expect(codesOf(выражение.problems)).toEqual([
      'map-value-type @ package.json.baser.settings.deep.of',
    ]);
  });

  it('НЕ ЗАДАНО (null) И ЗАДАНО ПУСТЫМ ({}) — РАЗНЫЕ СОСТОЯНИЯ', () => {
    // Дефолт `env` — null: блока в артефакте нет вовсе, как у тома при `store`.
    const молчит = materialize('kit', resolved('kit'))['fixture/kit.json'];
    expect(молчит).not.toContain('"env"');

    // Пустая карта — это СКАЗАННОЕ «переменных нет», и блок разворачивается.
    const сказано = materialize(
      'kit',
      resolved('kit', { settings: { env: {} } }),
    )['fixture/kit.json'];
    expect(сказано).toContain('"env": {}');
    expect(JSON.parse(сказано)['env']).toEqual({});
  });

  it('ПРЕСЕТ ЗАМЕНЯЕТ КАРТУ ЦЕЛИКОМ, А НЕ СЛИВАЕТ ЕЁ С ДЕФОЛТОМ', () => {
    // Дефолт обвеса — одна ссылка без опций; пресет объявляет свои две. Слейся
    // они, у ключа дефолта остались бы пустые опции, и убрать его человек не мог
    // бы иначе как надгробием — синтаксисом внутри значения, который запрещён.
    expect(declaration('kit').settings['tools'].default).toEqual({
      'fixture/lint': {},
    });
    expect(Object.keys(resolved('kit')['tools'] as object)).toEqual([
      'fixture/lint',
      'fixture/probe',
    ]);
    expect(
      (resolved('kit')['tools'] as Record<string, unknown>)['fixture/lint'],
    ).toEqual({ strict: true });

    // И заполненное бьёт пресет тем же правилом: карта целиком, а не по ключам.
    expect(resolved('kit', { settings: { tools: {} } })['tools']).toEqual({});
  });

  it('ФОРМЫ 2, 5 И 7 ЖИВУТ РЯДОМ: подъём не требует правки от соседа', () => {
    // Набор уехал на 7 ради вычисляемого предупреждения, заготовка осталась на
    // 2, а перечень поставленного стоит на 5 ради метки канала — и всё это
    // разбирается одним и тем же baser'ом. Ровно это и обещает MIN_FORM_VERSION:
    // граница двигается за ПЕРЕЕЗДОМ полей, а не за номером.
    expect(declaration('kit').formVersion).toBe(WARNING_SINCE);
    expect(declaration('seed').formVersion).toBe(2);
    expect(declaration('seed').settings['areas'].type).toBe('list');

    // Номер объявления — СТАРШИЙ из тех, чем обвес пользуется, а не «номер на
    // каждую возможность»: составной тип приехал формой 3, исполняемость —
    // формой 6, предупреждение — формой 7, и набор объявился по старшей из трёх.
    expect(declaration('kit').settings['tools'].type).toBe('map');
    expect(declaration('kit').layout[2].executable).toBe(true);
    expect(declaration('kit').formVersion).toBeGreaterThanOrEqual(
      MAP_TYPE_SINCE,
    );
    expect(declaration('kit').formVersion).toBeGreaterThanOrEqual(
      EXECUTABLE_SINCE,
    );

    // Объявление обвеса формы 4 и 5 не тронули ни на одно поле: то прибавление
    // было целиком на стороне потребителя, и ни один выпущенный обвес от тех
    // подъёмов не правился.
    expect(installed().formVersion).toBe(CHANNEL_SINCE);
  });

  it('ИСПОЛНЯЕМЫЙ АРТЕФАКТ: намерение автора доезжает до разобранной формы', () => {
    // Обвес объявляет ПРОГРАММУ, а не данные (`tasker:BASER2-212`): до формы 6
    // сказать это было нечем, хук ложился с правами 644, и коммит в такой
    // локации проходил без проверки молча.
    const раскладка = declaration('kit').layout;
    const хук = раскладка.find((entry) => entry.dest === 'fixture/hook.sh');

    expect(хук?.executable).toBe(true);
    // Умолчание проставлено при разборе — соседние записи поля не объявляли и
    // получили явное `false`, а не `undefined`: читателю формы нечего гадать.
    expect(раскладка.map((entry) => entry.executable)).toEqual([
      false,
      false,
      true,
    ]);

    // Исполняемость и подстановка — РАЗНЫЕ оси: хук рендерится из шаблона и при
    // этом программа. Класс — третья ось, и её она тоже не трогает.
    expect(хук?.render).toBe(true);
    expect(хук?.class).toBe('regenerated');
  });

  it('ОБВЕС ГОВОРИТ ЧЕЛОВЕКУ: живой резолвер доезжает до текста, прогон верный', () => {
    // Сквозной путь, а не «поле есть»: резолвер фикстуры загружен настоящим
    // `import`, позван с настоящим контекстом и посмотрел на настоящий каталог
    // локации. Отсюда дверь берёт готовое состояние и печатает его в жанре
    // «остаётся человеку» (`tasker:BASER2-226`).
    const сказанное = warning('kit');

    expect(сказанное.kind).toBe('said');
    if (сказанное.kind !== 'said') return;
    expect(сказанное.text).toContain('fixture/hooks.list');
    // Условие — про ПОСАДОЧНОЕ МЕСТО, и знает его только обвес: ни форма, ни
    // движок про чужие перечни хуков не знают по построению (`kb:BASER3-34`).
    expect(existsSync(join(consumer, 'fixture/hooks.list'))).toBe(false);

    // И главное: прогон при этом ВЕРНЫЙ. Укладка сходится с эталоном, значения
    // разрешились, отказывать не за что — предупреждение отказом не является.
    expect(materialize('kit', resolved('kit'))['fixture/hook.sh']).toBe(
      readFileSync(join(consumer, 'fixture/hook.sh'), 'utf-8'),
    );
  });

  it('ОБВЕС БЕЗ ПРЕДУПРЕЖДЕНИЯ МОЛЧИТ — и это не беда, а состояние', () => {
    // Заготовка объявлена формой 2 и поля не знает вовсе. Разбирается как
    // всегда, а на вопрос «что скажешь» отвечает «нечего».
    expect(declaration('seed').warningFrom).toBeUndefined();
    expect(warning('seed')).toEqual({ kind: 'none' });
  });

  it('НОМЕР И МЕТКА — РАЗНЫЕ ПОЛЯ: один обвес закреплён, второй назван каналом', () => {
    // Номер это адрес содержимого (под ним ровно одна сборка, навсегда), метка —
    // указатель, который двигается (`kb:BASER3-26`). Разные обещания живут в
    // разных полях: иначе читающий перечень не скажет, воспроизводим он, не
    // разбирая строку. Что дверь делает со значением, форма не решает — она его
    // принимает и судит пригодность.
    const [набор, заготовка] = installed().sources;

    expect(набор).toEqual({ use: TOOLS.kit, version: '1.0.0' });
    expect(заготовка).toEqual({ use: TOOLS.seed, channel: 'dev' });
    // Реестра этот вход не видит: сходство с версией манифеста фикстуры —
    // свойство самой фикстуры, а не проверки. Про метку `dev` он не знает и
    // подавно: про каналы знает только склад, и спрашивает его дверь.
    expect(manifest('kit')['version']).toBe('1.0.0');
  });

  it('НОМЕР И МЕТКА ВМЕСТЕ ЗАКОННЫ — кого бьёт кто, называет дверь', () => {
    // Форме довольно разобрать оба поля и отдать наверх целыми: «номер бьёт
    // метку» — правило двери, и сказать его вслух обязана она.
    const оба = parseConsumerConfig({
      formVersion: CHANNEL_SINCE,
      sources: [{ use: TOOLS.kit, version: '1.0.0', channel: 'dev' }],
    });

    expect(оба.ok).toBe(true);
    if (!оба.ok) return;
    expect(оба.value.sources[0]).toEqual({
      use: TOOLS.kit,
      version: '1.0.0',
      channel: 'dev',
    });
  });

  it('СВЕРКА НЕ ПРОЩАЕТ НИЧЕГО: уложенное сходится с эталоном байт в байт', () => {
    const compared: string[] = [];

    for (const tool of Object.keys(TOOLS) as Tool[]) {
      const produced = materialize(tool, resolved(tool));
      for (const [dest, text] of Object.entries(produced)) {
        expect(text).toBe(readFileSync(join(consumer, dest), 'utf-8'));
        compared.push(dest);
      }
    }

    // Прощённых строк нет — но их не должно быть и в виде артефакта, который
    // сверку молча обошёл. Перечень сверенного назван целиком.
    expect(compared.sort()).toEqual([
      'fixture/hook.sh',
      'fixture/kit.json',
      'fixture/kit.lock.json',
      'fixture/seed.yaml',
    ]);
    // Сверяется СОДЕРЖИМОЕ, и у хука тоже: бит исполняемости здесь не судится —
    // его кладёт порт, который пишет (`materialize`), а этот вход не трогает
    // файловой системы вовсе. Эталон — то, что форма умеет ВЫРАЗИТЬ.
  });

  it('ЗАПОЛНЕННОЕ БЬЁТ ДЕФОЛТ: разделы заготовки приехали от человека', () => {
    expect(resolved('seed')).toEqual({
      owner: CONSUMER_REPO,
      areas: ['form', 'probe', 'door'],
    });
    // Дефолт обвеса — пустой список, и он законен: заготовка без разделов
    // рабочая. Человек заполнил, и это значение не поднимется никогда.
    expect(declaration('seed').settings['areas'].default).toEqual([]);
  });

  it('артефакт без подстановки ложится содержимым, а не шаблоном', () => {
    const produced = materialize('kit', resolved('kit'));
    const source = readFileSync(
      join(examples, 'kit/template/kit.lock.json'),
      'utf-8',
    );
    expect(produced['fixture/kit.lock.json']).toBe(source);
    // Языком формы он не меряется по построению — тегов подстановки в нём нет,
    // и объявленный рендеримым он получил бы отказ `template-not-ejs`.
    expect(checkTemplate(source, 'kit.lock.json').map((p) => p.code)).toEqual([
      'template-not-ejs',
    ]);
  });

  it('слой «универсальное»: без пресета блок не разворачивается вовсе', () => {
    const text = materialize('kit', resolved('kit', { presets: [] }))[
      'fixture/kit.json'
    ];
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Том не задан (`null`) — значит блока с томами в артефакте нет совсем, а не
    // есть пустой: третий слой выражается ветвлением шаблона.
    expect(parsed['mounts']).toBeUndefined();
    expect(text).not.toContain('mounts');
    expect(parsed['onFailure']).toBe('continue');
    expect(parsed['name']).toBe('consumer-kit');
  });

  it('слой «настройки»: заполненное значение бьёт пресет', () => {
    const text = materialize(
      'kit',
      resolved('kit', { settings: { store: 'своё-хранилище', retries: 5 } }),
    )['fixture/kit.json'];
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(parsed['mounts']).toEqual(['своё-хранилище:/work/cache']);
    expect(parsed['retries']).toBe(5);
    // Пресет при этом на месте: заполнено одно значение, а не отменён слой.
    expect(parsed['onFailure']).toBe('stop');
  });

  it('рендер не экранирует под HTML — кавычка остаётся кавычкой', () => {
    const text = materialize('kit', resolved('kit'))['fixture/kit.json'];
    expect(text).not.toContain('&#34;');
    expect(text).toContain('"pnpm exec fixture --scope \\"*\\""');
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe('проба отказов: каждый случай называется вслух', () => {
  it('два обвеса на один dest', () => {
    const надстройка = readSourceDeclaration({
      baser: declarationBlock({
        source: {
          id: 'fixture/kit-over',
          title: 'Надстройка над набором',
          contentRoot: 'tpl',
        },
        layout: [{ src: 'over.json', dest: 'fixture/kit.json' }],
      }),
    });
    expect(надстройка.ok).toBe(true);
    if (!надстройка.ok) return;

    const result = checkSingleProvider([
      { declaration: declaration('kit'), packageName: TOOLS.kit },
      { declaration: надстройка.value, packageName: '@чужой/kit-over' },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].code).toBe('artifact-shared');
    expect(result.problems[0].message).toContain('fixture/kit.json');
  });

  it('АРТЕФАКТ ПОВЕРХ КОНФИГА ПОТРЕБИТЕЛЯ: соседние записи разбираются как обычно', () => {
    // Живое объявление фикстуры, которому дописали ещё одну запись раскладки:
    // она целится в перечень поставленного (`tasker:BASER2-25`).
    const block = manifest('kit')['baser'] as Record<string, unknown>;
    const жадный = readSourceDeclaration({
      baser: {
        ...block,
        layout: [
          ...(block['layout'] as unknown[]),
          { src: 'kit.json.ejs', dest: CONSUMER_CONFIG_PATH },
        ],
      },
    });

    expect(жадный.ok).toBe(false);
    if (жадный.ok) return;
    // Ровно один отказ и ровно по дописанной записи: живые прошли разбор молча,
    // то есть непригодна запись, а не объявление вокруг неё.
    expect(codesOf(жадный.problems)).toEqual([
      'artifact-over-consumer-config @ package.json.baser.layout[3].dest',
    ]);
    expect(жадный.problems[0].message).toContain(CONSUMER_CONFIG_PATH);
  });

  it('незнакомый ключ настройки в файле настроек', () => {
    expect(() => resolved('kit', { settings: { retires: 5 } })).toThrow(
      /unknown-setting/,
    );
  });

  it('ОБЪЯВЛЕНА КАРТА, ЗАПОЛНЕН СПИСОК: отказ показывает, ЧТО ДЕЛАТЬ', () => {
    // Живой случай перехода, а не выдуманный: два потребителя держат ссылки на
    // инструменты заполненными СПИСКОМ, и после перевода настройки на карту
    // отказ увидят оба (`tasker:BASER2-116`). Сказать им «ожидалась карта» —
    // значит отправить читать доку там, где правка занимает минуту.
    let message = '';
    try {
      resolved('kit', { settings: { tools: ['fixture/lint'] } });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }

    expect(message).toContain('value-type-mismatch');
    // Тип назван полностью — «просто карта» не сказала бы главного.
    expect(message).toContain('map «ключ → map»');
    // И показана сама правка, СТРОКОЙ ЧЕЛОВЕКА, а не абстрактной «ссылкой».
    expect(message).toContain('"- fixture/lint" замени на "fixture/lint: {}"');
  });

  it('СОСТАВНОЙ ТИП В ОБЪЯВЛЕНИИ ФОРМЫ 2: сказано, что поднять', () => {
    // Старый baser сказал бы «такого типа не знаю» и отправил искать опечатку
    // там, где её нет. Этот говорит про версию — ради этого она и поднята.
    const block = manifest('kit')['baser'] as Record<string, unknown>;
    const прежний = readSourceDeclaration({
      ...manifest('kit'),
      baser: { ...block, formVersion: 2 },
    });

    expect(прежний.ok).toBe(false);
    if (прежний.ok) return;
    expect(codesOf(прежний.problems)).toEqual([
      // Предупреждение форме 2 незнакомо так же, как составной тип и
      // исполняемость: копилка называет ВСЁ, что видит, а не первый пункт.
      'form-version-unsupported @ package.json.baser.warningFrom',
      'form-version-unsupported @ package.json.baser.settings.env.type',
      'form-version-unsupported @ package.json.baser.settings.tools.type',
      // Настройка не разобралась — значит пресет выставляет то, чего в этом
      // объявлении нет. Отказ каскадный и это честно: копилка называет всё, что
      // видит, а не первый пункт, и объявление уже отказ целиком.
      'unknown-setting @ package.json.baser.presets.shared.values.tools',
      // И раскладка названа тем же прогоном: исполняемость форме 2 незнакома
      // ровно так же, как составной тип.
      'form-version-unsupported @ package.json.baser.layout[2].executable',
    ]);
    expect(
      прежний.problems.find((problem) =>
        problem.at.endsWith('settings.tools.type'),
      )?.message,
    ).toContain('подними "formVersion" до 3');
  });

  it('ИСПОЛНЯЕМОСТЬ В ОБЪЯВЛЕНИИ ФОРМЫ 5: сказано, что поднять', () => {
    // Составной тип тот baser уже знает, а исполняемость — ещё нет. Сказать про
    // неё он обязан «обнови baser», а не «форма такого поля не знает»: поверив
    // второму, автор уберёт поле и поставит потребителю хук, который лёг и не
    // работает (`tasker:BASER2-212`).
    const block = manifest('kit')['baser'] as Record<string, unknown>;
    const назвался5 = readSourceDeclaration({
      ...manifest('kit'),
      baser: { ...block, formVersion: EXECUTABLE_SINCE - 1 },
    });

    expect(назвался5.ok).toBe(false);
    if (назвался5.ok) return;
    expect(codesOf(назвался5.problems)).toEqual([
      // Предупреждение приехало ещё позже — форме 5 незнакомы оба слова.
      'form-version-unsupported @ package.json.baser.warningFrom',
      'form-version-unsupported @ package.json.baser.layout[2].executable',
    ]);
    const проИсполняемость = назвался5.problems[1];
    expect(проИсполняемость.message).toContain(
      `подними "formVersion" до ${EXECUTABLE_SINCE}`,
    );
    expect(проИсполняемость.message).toContain('обнови baser');
  });

  it('ПРЕДУПРЕЖДЕНИЕ В ОБЪЯВЛЕНИИ ФОРМЫ 6: сказано, что поднять', () => {
    // Исполняемость тот baser уже знает, а предупреждение — ещё нет. Сказать
    // про него он обязан «обнови baser», а не «форма такого поля не знает»:
    // поверив второму, автор уберёт поле — и обвес вернётся к одной громкости,
    // промолчать либо уронить весь прогон (`tasker:BASER2-226`).
    const block = manifest('kit')['baser'] as Record<string, unknown>;
    const назвался6 = readSourceDeclaration({
      ...manifest('kit'),
      baser: { ...block, formVersion: WARNING_SINCE - 1 },
    });

    expect(назвался6.ok).toBe(false);
    if (назвался6.ok) return;
    expect(codesOf(назвался6.problems)).toEqual([
      'form-version-unsupported @ package.json.baser.warningFrom',
    ]);
    expect(назвался6.problems[0].message).toContain(
      `подними "formVersion" до ${WARNING_SINCE}`,
    );
    expect(назвался6.problems[0].message).toContain('обнови baser');
  });

  it('РЕЖИМ ЧИСЛОМ: форма его не знает и отправляет к executable', () => {
    // Ходовая ошибка после формы 6 — написать привычный восьмеричный режим.
    // Обычное «форма такого поля не знает» отправило бы человека искать
    // опечатку там, где её нет: он выразил ровно то намерение, которое форма
    // умеет принять, — просто другим словом.
    const block = manifest('kit')['baser'] as Record<string, unknown>;
    const режимом = readSourceDeclaration({
      ...manifest('kit'),
      baser: {
        ...block,
        layout: [{ src: 'hook.sh', dest: 'fixture/hook.sh', mode: '0755' }],
      },
    });

    expect(режимом.ok).toBe(false);
    if (режимом.ok) return;
    expect(codesOf(режимом.problems)).toEqual([
      'unknown-field @ package.json.baser.layout[0].mode',
    ]);
    expect(режимом.problems[0].message).toContain('"executable": true');
    // И про второй смысл слова сказано там же: режимов материализации в записи
    // нет — `merge` отменён, `seed` выражается классом.
    expect(режимом.problems[0].message).toContain('"class"');
  });

  it('обвес без дефолта у настройки', () => {
    const broken = readSourceDeclaration({
      baser: declarationBlock({
        settings: { retries: { title: 'Сколько раз', type: 'number' } },
      }),
    });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.problems[0].code).toBe('setting-no-default');
    expect(broken.problems[0].message).toContain('вопросов у двери не бывает');
  });

  it('ОБВЕС ПЕРВОЙ ФОРМЫ: отказ целиком, а не разбор наполовину', () => {
    // Обвес, у которого поднята только версия формы: настройки потребителя он
    // всё ещё ждёт в baser.json, и разобрать его по правилам формы 2 значило бы
    // молча потерять то, что человек настроил.
    const block = manifest('kit')['baser'] as Record<string, unknown>;
    const старый = readSourceDeclaration({
      ...manifest('kit'),
      baser: { ...block, formVersion: 1 },
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
      sources: [{ use: TOOLS.kit, presets: ['shared'] }],
    });
    expect(первая.ok).toBe(false);
    if (первая.ok) return;
    expect(первая.problems[0].code).toBe('consumer-settings-moved');
    expect(первая.problems[0].message).toContain('.omnifield/');
  });

  it('ТОТ ЖЕ ОБВЕС, ШАБЛОН НА ЧУЖОМ ЯЗЫКЕ', () => {
    // Берём живой шаблон фикстуры и переписываем подстановки на Handlebars.
    // EJS отрендерил бы такое сам в себя: артефакт лёг бы к потребителю с
    // неподставленным "{{ name }}" и ничем бы себя не выдал.
    const foreign = template('kit/template/kit.json.ejs')
      .replace(/<%[^]*?%>/g, '')
      .replace('"name": ""', '"name": "{{ name }}"');

    const problems = checkTemplate(foreign, 'подделка → fixture/kit.json');
    expect(problems.map((problem) => problem.code)).toEqual([
      'template-not-ejs',
    ]);
    expect(problems[0].message).toContain('EJS');
  });

  it('тот же обвес с экранирующей подстановкой', () => {
    const escaping = template('kit/template/kit.json.ejs').replace(
      '<%- name %>',
      '<%= name %>',
    );

    const problems = checkTemplate(escaping, 'подделка → fixture/kit.json');
    expect(problems.map((problem) => problem.code)).toEqual([
      'template-html-escape',
    ]);
  });

  it('ЗАКРЕПЛЕНИЕ В ПЕРЕЧНЕ ПРЕЖНЕЙ ФОРМЫ: сказано, что поднять', () => {
    // Живой перечень фикстуры, названный прежним номером. Старый baser сказал бы
    // «конфиг такого поля не знает» и отправил искать опечатку там, где её нет:
    // человек написал не опечатку, а закрепление, которого у ТОГО baser'а ещё
    // не было. Ради этого версия и поднята.
    const прежний = parseConsumerConfig(
      readJson(join(consumer, CONSUMER_CONFIG_PATH)) as Record<string, unknown>,
    );
    expect(прежний.ok).toBe(true);

    const назвался3 = parseConsumerConfig({
      ...(readJson(join(consumer, CONSUMER_CONFIG_PATH)) as Record<
        string,
        unknown
      >),
      formVersion: PINNED_VERSION_SINCE - 1,
    });
    expect(назвался3.ok).toBe(false);
    if (назвался3.ok) return;
    // Обе записи названы, а не первая: три опечатки это три опечатки, и чинить
    // их по одному прогону на штуку человека никто не заставляет.
    expect(codesOf(назвался3.problems)).toEqual([
      `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.sources[0].version`,
      `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.sources[1].channel`,
    ]);
    expect(назвался3.problems[0].message).toContain('обнови baser');
  });

  it('МЕТКА КАНАЛА В ПЕРЕЧНЕ ФОРМЫ 4: сказано, что поднять', () => {
    // Живой перечень фикстуры, названный прежним номером. Закрепление версии тот
    // baser уже знает, а метку канала — ещё нет: сказать про неё он обязан
    // «обнови baser», а не «конфиг такого поля не знает».
    const назвался4 = parseConsumerConfig({
      ...(readJson(join(consumer, CONSUMER_CONFIG_PATH)) as Record<
        string,
        unknown
      >),
      formVersion: PINNED_VERSION_SINCE,
    });

    expect(назвался4.ok).toBe(false);
    if (назвался4.ok) return;
    expect(codesOf(назвался4.problems)).toEqual([
      `form-version-unsupported @ ${CONSUMER_CONFIG_PATH}.sources[1].channel`,
    ]);
    expect(назвался4.problems[0].message).toContain(
      `подними "formVersion" до ${CHANNEL_SINCE}`,
    );
  });

  it('НОМЕР ВМЕСТО МЕТКИ: канал — указатель, а не адрес содержимого', () => {
    const номером = parseConsumerConfig({
      formVersion: FORM_VERSION,
      sources: [{ use: TOOLS.kit, channel: '1.0.0' }],
    });

    expect(номером.ok).toBe(false);
    if (номером.ok) return;
    expect(номером.problems[0].code).toBe('invalid-channel');
    expect(номером.problems[0].message).toContain(
      'закрепляется полем "version"',
    );
  });

  it('ДИАПАЗОН ВМЕСТО ВЕРСИИ: закреплением он не является', () => {
    const плавающий = parseConsumerConfig({
      formVersion: FORM_VERSION,
      sources: [{ use: TOOLS.kit, version: '^1.0.0' }],
    });

    expect(плавающий.ok).toBe(false);
    if (плавающий.ok) return;
    expect(плавающий.problems[0].code).toBe('invalid-version');
    expect(плавающий.problems[0].message).toContain('не пиши поле вовсе');
  });

  it('версию конфига проставила дверь, пользователь её не вводил', () => {
    const номер = installed().formVersion;

    // Номер из окна разбираемого — иначе перечень не разобрался бы вовсе.
    expect(номер).toBeLessThanOrEqual(FORM_VERSION);
    // И он ровно тот, которым файл записан: перечень остался на 5, хотя текущая
    // форма уже 6. Форма 6 конфига не тронула НИ НА ОДНО поле (прибавление
    // целиком на стороне обвеса), а поднимать номер в чужом файле дверь не
    // вправе — файл ведут она и человек, и молчаливая правка означала бы
    // изменение того, что человек читает как своё.
    expect(номер).toBe(CHANNEL_SINCE);
  });
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function template(path: string): string {
  return readFileSync(join(examples, path), 'utf-8');
}

/**
 * Инструменты ДВЕРИ, а не формы: `ejs` приезжает транзитивно с `@nx/devkit`,
 * `yaml` — с инструментарием сборки. Своих зависимостей на них контракты НЕ
 * заводят: подстановка значений и чтение файла — дело двери (`tasker:BASER2-53`),
 * а пакет формы не читает и не исполняет ничего.
 *
 * Это единственное, что проба берёт за пределами своего пакета, и устареть
 * незамеченным оно не может: версия пакета в сторе меняется вместе с локом, а
 * лок nx хеширует сам. Файлов живого репозитория проба не читает вовсе — потому
 * в манифесте зоны и нет блока `namedInputs` (сравни с дверью,
 * `tasker:BASER2-78`).
 */
function fromStore(name: string): string {
  const store = resolve(here, '../../../../node_modules/.pnpm');
  const dir = readdirSync(store)
    .filter((entry) => entry.startsWith(`${name}@`))
    .sort()
    .at(-1);
  if (!dir) {
    throw new Error(`${name} не найден в pnpm-сторе — прогнать пробу нечем`);
  }
  return join(store, dir, 'node_modules', name);
}
