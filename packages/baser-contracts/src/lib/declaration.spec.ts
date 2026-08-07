import { describe, expect, it } from 'vitest';
import {
  DECLARATION_BLOCK,
  parseSourceDeclaration,
  readSourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import { CONSUMER_CONFIG_PATH } from './paths.js';
import {
  EXECUTABLE_SINCE,
  FORM_VERSION,
  MIN_FORM_VERSION,
} from './version.js';

/** Разбор, который обязан пройти, — чтобы отказы ниже читались как отличие. */
function parse(patch: Record<string, unknown> = {}) {
  return parseSourceDeclaration(declarationBlock(patch));
}

/** Отказы разбора; бросает, если объявление внезапно оказалось пригодным. */
function refusals(patch: Record<string, unknown>) {
  const result = parse(patch);
  if (result.ok) {
    throw new Error('ожидался отказ, объявление разобралось');
  }
  return result.problems;
}

describe('объявление обвеса', () => {
  it('разбирает минимальное пригодное объявление', () => {
    const result = parse();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source.id).toBe('omnifield/devbox');
    expect(result.value.formVersion).toBe(FORM_VERSION);
    expect(result.value.layout).toHaveLength(1);
    // Обвес без пресетов законен — не всякий инструмент имеет ходовые положения.
    expect(result.value.presets).toEqual({});
  });

  it('достаёт блок из манифеста пакета и называет его отсутствие', () => {
    const manifest = {
      name: '@omnifield/baser-devbox',
      baser: declarationBlock(),
    };
    expect(readSourceDeclaration(manifest).ok).toBe(true);

    const bare = readSourceDeclaration(
      { name: 'просто-пакет' },
      'package.json',
    );
    expect(bare.ok).toBe(false);
    if (bare.ok) return;
    expect(codesOf(bare.problems)).toEqual([
      `missing-field @ package.json.${DECLARATION_BLOCK}`,
    ]);
  });

  it('собирает ВСЕ отказы сразу, а не первый', () => {
    // Три опечатки это три опечатки: чинить их по одному прогону на штуку —
    // ровно то, ради чего разбор копит отказы, а не бросает.
    const problems = refusals({
      source: { id: 'Omnifield/Devbox', title: '', contentRoot: '../наружу' },
    });
    expect(codesOf(problems)).toEqual([
      'invalid-source-id @ baser.source.id',
      'empty-string @ baser.source.title',
      'invalid-path @ baser.source.contentRoot',
    ]);
  });

  describe('версия формы', () => {
    it('требует её назвать', () => {
      const problems = refusals({ formVersion: undefined });
      expect(codesOf(problems)).toEqual([
        'form-version-missing @ baser.formVersion',
      ]);
    });

    it('отказывает обвесу из будущего, а не разбирает его наполовину', () => {
      const problems = refusals({ formVersion: FORM_VERSION + 1 });
      expect(problems[0].code).toBe('form-version-unsupported');
      expect(problems[0].message).toContain('обнови baser');
    });

    it('ОБЪЯВЛЕНИЕ ПЕРВОЙ ФОРМЫ ОТВЕРГАЕТСЯ ЦЕЛИКОМ И НАЗВАННО', () => {
      // Форма 1 держала настройки потребителя в baser.json, а раскладку — без
      // класса. Разобрать её по правилам формы 2 значит молча потерять то, что
      // человек настроил: разбор обязан остановиться на версии, а не идти дальше.
      const problems = refusals({
        formVersion: 1,
        layout: [{ src: 'a.json', dest: 'a.json', mode: 'merge' }],
      });

      expect(codesOf(problems)).toEqual([
        'form-version-unsupported @ baser.formVersion',
      ]);
      expect(problems[0].message).toContain('обнови обвес');
      // Названо, ЧЕМ форма старая: автор обвеса читает отказ, а не changelog.
      expect(problems[0].message).toContain('.omnifield/');
      expect(problems[0].message).toContain('class');
    });

    it('первая форма — уже не самая старая разбираемая', () => {
      expect(MIN_FORM_VERSION).toBeGreaterThan(1);
      expect(MIN_FORM_VERSION).toBeLessThanOrEqual(FORM_VERSION);
    });

    it('ФОРМА 2 РАЗБИРАЕТСЯ ТРЕТЬЕЙ: третья только добавила тип', () => {
      // Граница разбираемого проходит там, где поля ПЕРЕЕЗЖАЛИ (1 → 2), а не на
      // каждом подъёме номера. Иначе подъём формы требовал бы правки от каждого
      // выпущенного обвеса ради возможности, которой он не пользуется, — и
      // заставлял бы живых потребителей мигрировать лишний раз.
      const прежний = parse({ formVersion: 2 });
      expect(прежний.ok).toBe(true);
      if (!прежний.ok) return;
      expect(прежний.value.settings['name'].type).toBe('string');
    });

    it('не принимает версию строкой или дробью', () => {
      expect(codesOf(refusals({ formVersion: '1' }))).toEqual([
        'form-version-invalid @ baser.formVersion',
      ]);
      expect(codesOf(refusals({ formVersion: 1.5 }))).toEqual([
        'form-version-invalid @ baser.formVersion',
      ]);
    });
  });

  describe('версия обвеса', () => {
    it('ВТОРЫМ ПОЛЕМ НЕ ЗАВОДИТСЯ — она в манифесте пакета', () => {
      // Два места для одного факта разъедутся; на этом краснела приёмка pack.
      const problems = refusals({
        source: {
          id: 'omnifield/devbox',
          title: 'Девбокс',
          contentRoot: 'template',
          version: '0.1.0',
        },
      });
      expect(codesOf(problems)).toEqual([
        'unknown-field @ baser.source.version',
      ]);
      expect(problems[0].message).toContain('манифеста пакета');
    });
  });

  describe('идентичность', () => {
    it('требует форму «поставщик/обвес» строчными', () => {
      for (const id of [
        'devbox',
        'omnifield/',
        '/devbox',
        'Omnifield/devbox',
      ]) {
        expect(
          codesOf(
            refusals({
              source: { ...(declarationBlock().source as object), id },
            }),
          ),
        ).toContain('invalid-source-id @ baser.source.id');
      }
    });

    it('объясняет, что это не имя пакета', () => {
      const problems = refusals({
        source: {
          id: '@omnifield/baser-devbox',
          title: 'Девбокс',
          contentRoot: 'template',
        },
      });
      expect(problems[0].message).toContain('пакет — доставка');
    });

    it('ГРАММАТИКА ЛИЧНОСТИ НАЗВАНА В САМОМ ОТКАЗЕ', () => {
      // Личность — первое, что пишет чужой автор, и отказ он получает на форме,
      // которой дока не описывала (`tasker:BASER2-70` §3). Теперь правило целиком
      // лежит там, где его читают, — в тексте отказа.
      const problems = refusals({
        source: {
          id: 'omnifield/baser/devbox',
          title: 'Девбокс',
          contentRoot: 'template',
        },
      });
      expect(codesOf(problems)).toEqual([
        'invalid-source-id @ baser.source.id',
      ]);
      expect(problems[0].message).toContain('ровно два сегмента');
      expect(problems[0].message).toContain('первый символ сегмента');
    });

    it('ровно два сегмента, и каждый начинается с буквы или цифры', () => {
      for (const id of [
        'omnifield/baser/devbox', // три сегмента
        '-omnifield/devbox', // сегмент начинается с дефиса
        'omnifield/.devbox', // и с точки тоже нельзя
        'omnifield/dev box', // пробел не буква и не цифра
        'omnifield//devbox', // пустой сегмент
      ]) {
        expect(
          codesOf(
            refusals({
              source: { ...(declarationBlock().source as object), id },
            }),
          ),
        ).toContain('invalid-source-id @ baser.source.id');
      }
    });

    it('точка, дефис и подчёркивание внутри сегмента законны', () => {
      for (const id of [
        'omnifield/devbox-plus',
        'omnifield.dev/devbox_2',
        'a1/b2',
      ]) {
        const result = parse({
          source: { id, title: 'Обвес', contentRoot: 'template' },
        });
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('настройки', () => {
    it('отказывает настройке без дефолта — вопросов пользователю не бывает', () => {
      const problems = refusals({
        settings: { name: { title: 'Имя', type: 'string' } },
      });
      expect(codesOf(problems)).toEqual([
        'setting-no-default @ baser.settings.name',
      ]);
      expect(problems[0].message).toContain('вопросов у двери не бывает');
    });

    it('отказывает настройке с двумя дефолтами сразу', () => {
      const problems = refusals({
        settings: {
          name: {
            title: 'Имя',
            type: 'string',
            default: 'a',
            defaultFrom: './defaults.js#name',
          },
        },
      });
      expect(codesOf(problems)).toEqual([
        'setting-two-defaults @ baser.settings.name',
      ]);
    });

    it('сверяет дефолт с объявленным типом', () => {
      expect(
        codesOf(
          refusals({
            settings: { n: { title: 'N', type: 'number', default: 'два' } },
          }),
        ),
      ).toEqual(['value-type-mismatch @ baser.settings.n.default']);
    });

    it('разрешает null только там, где «не задано» имеет смысл', () => {
      expect(
        parse({
          settings: { s: { title: 'S', type: 'string', default: null } },
        }).ok,
      ).toBe(true);
      expect(
        parse({ settings: { l: { title: 'L', type: 'list', default: null } } })
          .ok,
      ).toBe(true);

      expect(
        parse({
          settings: {
            m: { title: 'M', type: 'map', of: 'string', default: null },
          },
        }).ok,
      ).toBe(true);

      // Выключенный флаг — это false, а не отсутствие флага.
      const problems = refusals({
        settings: { b: { title: 'B', type: 'boolean', default: null } },
      });
      expect(problems[0].message).toContain('только для string, list и map');
    });

    describe('составной тип — карта', () => {
      it('разбирает карту и запоминает, чем бывают её значения', () => {
        const parsed = parse({
          settings: {
            features: {
              title: 'Фичи и опции',
              type: 'map',
              of: 'map',
              default: { 'ghcr.io/фикстура/uv:1': { version: '0.11' } },
            },
          },
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const spec = parsed.value.settings['features'];
        expect([spec.type, spec.of]).toEqual(['map', 'map']);
        expect(spec.default).toEqual({
          'ghcr.io/фикстура/uv:1': { version: '0.11' },
        });
      });

      it('ТРЕБУЕТ СЛОВО of: без него тип карты НЕПОЛОН', () => {
        // «Просто карта» приняла бы значение любой глубины — то есть ровно то,
        // от чего форма уводит. Отказ поэтому свой, а не общий «нет поля».
        const problems = refusals({
          settings: {
            features: { title: 'Фичи', type: 'map', default: {} },
          },
        });
        expect(codesOf(problems)).toEqual([
          'map-value-type @ baser.settings.features.of',
        ]);
        expect(problems[0].message).toContain(
          'string | number | boolean | map',
        );
      });

      it('СЛОВАРЬ ЗАКРЫТ: of — слово, а не выражение типа', () => {
        const problems = refusals({
          settings: {
            features: {
              title: 'Фичи',
              type: 'map',
              of: 'map(string)',
              default: {},
            },
          },
        });
        expect(codesOf(problems)).toEqual([
          'map-value-type @ baser.settings.features.of',
        ]);
        expect(problems[0].message).toContain('вложить его само в себя нечем');
      });

      it('of у не-карты называется вслух, а не пропускается', () => {
        const problems = refusals({
          settings: {
            name: { title: 'Имя', type: 'string', of: 'string', default: 'x' },
          },
        });
        expect(codesOf(problems)).toEqual([
          'map-value-type @ baser.settings.name.of',
        ]);
      });

      it('сверяет дефолт с ОБОИМИ этажами объявленного типа', () => {
        // Значение не того типа, что обещало `of`.
        expect(
          codesOf(
            refusals({
              settings: {
                env: {
                  title: 'Переменные',
                  type: 'map',
                  of: 'string',
                  default: { TZ: 42 },
                },
              },
            }),
          ),
        ).toEqual(['value-type-mismatch @ baser.settings.env.default']);

        // Третий этаж: опции обязаны быть плоскими скалярами, и это граница
        // самой целевой спеки, а не наше «двух хватит».
        expect(
          codesOf(
            refusals({
              settings: {
                features: {
                  title: 'Фичи',
                  type: 'map',
                  of: 'map',
                  default: { ссылка: { опции: { глубже: 'некуда' } } },
                },
              },
            }),
          ),
        ).toEqual(['value-type-mismatch @ baser.settings.features.default']);
      });

      it('ОПЦИИ ОДНОЙ ССЫЛКИ РАЗНОРОДНЫ — так их объявляет чужая спека', () => {
        // `{"version": "3.10", "pip": false}` — строка и флаг в одной карте.
        // Однородной её сделать значило бы не выразить то, ради чего тип заведён.
        expect(
          parse({
            settings: {
              features: {
                title: 'Фичи',
                type: 'map',
                of: 'map',
                default: {
                  'ghcr.io/ф/python:1': { version: '3.10', pip: false },
                },
              },
            },
          }).ok,
        ).toBe(true);
      });

      it('null и {} — разные состояния, и оба законны', () => {
        const parsed = parse({
          settings: {
            нет: {
              title: 'Не задано',
              type: 'map',
              of: 'string',
              default: null,
            },
            пусто: { title: 'Пусто', type: 'map', of: 'string', default: {} },
          },
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.settings['нет'].default).toBeNull();
        expect(parsed.value.settings['пусто'].default).toEqual({});
      });

      it('ФОРМА 2 СОСТАВНОГО ТИПА НЕ ЗНАЛА — сказано, что поднять', () => {
        const problems = refusals({
          formVersion: 2,
          settings: {
            features: { title: 'Фичи', type: 'map', of: 'map', default: {} },
          },
        });
        expect(codesOf(problems)).toEqual([
          'form-version-unsupported @ baser.settings.features.type',
        ]);
        expect(problems[0].message).toContain('подними "formVersion" до 3');
      });

      it('и словарь типов в отказе — по ОБЪЯВЛЕННОЙ форме, а не по текущей', () => {
        // Советовать формой 2 тип, который этот же разбор следующей строкой
        // отвергнет, значит послать человека по кругу.
        const [старый] = refusals({
          formVersion: 2,
          settings: { x: { title: 'X', type: 'карта', default: null } },
        });
        expect(старый.message).toContain('string · number · boolean · list,');
        expect(старый.message).not.toContain('· map');

        const [новый] = refusals({
          settings: { x: { title: 'X', type: 'карта', default: null } },
        });
        expect(новый.message).toContain('list · map');
      });
    });

    it('требует имя настройки для человека', () => {
      // Пользователь имеет дело с настройкой, а не с разметкой файла: настройку
      // без имени ему не показать.
      expect(
        codesOf(
          refusals({ settings: { n: { type: 'string', default: 'a' } } }),
        ),
      ).toEqual(['missing-field @ baser.settings.n.title']);
    });

    it('разбирает ссылку на резолвер и отказывает кривой', () => {
      const ok = parse({
        settings: {
          v: {
            title: 'V',
            type: 'string',
            defaultFrom: './defaults.js#latestStableNode',
          },
        },
      });
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.value.settings['v'].defaultFrom).toEqual({
          module: 'defaults.js',
          member: 'latestStableNode',
        });
      }

      for (const ref of [
        './defaults.js',
        '#name',
        './defaults.js#',
        './a.js#не имя',
      ]) {
        expect(
          codesOf(
            refusals({
              settings: { v: { title: 'V', type: 'string', defaultFrom: ref } },
            }),
          ),
        ).toEqual(['invalid-resolver-ref @ baser.settings.v.defaultFrom']);
      }
    });

    it('не выпускает резолвер за пределы пакета обвеса', () => {
      const problems = refusals({
        settings: {
          v: {
            title: 'V',
            type: 'string',
            defaultFrom: '../соседний/defaults.js#name',
          },
        },
      });
      expect(problems[0].message).toContain('в пакете обвеса');
    });
  });

  describe('пресеты', () => {
    it('разбирает пресет как набор значений объявленных настроек', () => {
      const result = parse({
        presets: {
          omnifield: { title: 'omnifield', values: { name: 'baser-devbox' } },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.presets['omnifield'].values).toEqual({
          name: 'baser-devbox',
        });
      }
    });

    it('называет настройку, которой обвес не объявлял', () => {
      const problems = refusals({
        presets: {
          omnifield: { title: 'omnifield', values: { сеть: 'gateway' } },
        },
      });
      expect(codesOf(problems)).toEqual([
        'unknown-setting @ baser.presets.omnifield.values.сеть',
      ]);
      expect(problems[0].message).toContain('никуда не поедет');
    });

    it('сверяет значение пресета с типом настройки', () => {
      expect(
        codesOf(
          refusals({ presets: { p: { title: 'P', values: { name: 42 } } } }),
        ),
      ).toEqual(['value-type-mismatch @ baser.presets.p.values.name']);
    });
  });

  describe('раскладка', () => {
    it('приводит render к явному значению — умолчание живёт в одном месте', () => {
      const result = parse({
        layout: [
          { src: 'a.json', dest: 'a.json' },
          { src: 'b.bin', dest: 'b.bin', render: false },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.layout.map((e) => e.render)).toEqual([true, false]);
      }
    });

    it('КЛАСС АРТЕФАКТА: умолчание regenerated, placed-once объявляется', () => {
      const result = parse({
        layout: [
          { src: 'a.json.ejs', dest: 'a.json' },
          {
            src: 'harness.yaml.ejs',
            dest: '.omnifield/harness.yaml',
            class: 'placed-once',
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Умолчание проставлено при разборе — как у render, чтобы жить в одном
      // месте, а не в каждом читателе формы.
      expect(result.value.layout.map((entry) => entry.class)).toEqual([
        'regenerated',
        'placed-once',
      ]);
    });

    it('называет класс, которого форма не знает', () => {
      const problems = refusals({
        layout: [{ src: 'a.json', dest: 'a.json', class: 'seed' }],
      });
      expect(codesOf(problems)).toEqual([
        'unknown-artifact-class @ baser.layout[0].class',
      ]);
      expect(problems[0].message).toContain('placed-once');
    });

    it('КЛАСС — ПЕРЕЧИСЛЕНИЕ, А НЕ ФЛАГ: once:true отправляют к class', () => {
      // Третий класс уже описан у соседей (kb:WEBER-4); флаг пришлось бы ломать
      // при его приезде, а перечисление примет новое слово молча.
      const problems = refusals({
        layout: [{ src: 'a.json', dest: 'a.json', once: true }],
      });
      expect(codesOf(problems)).toEqual([
        'unknown-field @ baser.layout[0].once',
      ]);
      expect(problems[0].message).toContain('"class": "placed-once"');
    });

    it('ИСПОЛНЯЕМОСТЬ: объявленное доезжает, умолчание — false', () => {
      const result = parse({
        layout: [
          { src: 'a.json', dest: 'a.json' },
          { src: 'pre-commit', dest: '.githooks/pre-commit', executable: true },
          { src: 'b.txt', dest: 'b.txt', executable: false },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Умолчание проставлено при разборе — как у render и class, чтобы жить в
      // одном месте, а не в каждом читателе формы.
      expect(result.value.layout.map((entry) => entry.executable)).toEqual([
        false,
        true,
        false,
      ]);
    });

    it('ОБВЕС БЕЗ ПОЛЯ РАЗБИРАЕТСЯ РОВНО КАК РАНЬШЕ', () => {
      // Неизменность, а не «тоже работает»: форма 6 прибавила поле и не тронула
      // ничего из того, что уже объявлено выпущенными обвесами.
      const result = parse({
        layout: [
          { src: 'a.json.ejs', dest: 'a.json' },
          { src: 'b.bin', dest: 'b.bin', render: false, class: 'placed-once' },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.layout).toEqual([
        {
          src: 'a.json.ejs',
          dest: 'a.json',
          render: true,
          class: 'regenerated',
          executable: false,
        },
        {
          src: 'b.bin',
          dest: 'b.bin',
          render: false,
          class: 'placed-once',
          executable: false,
        },
      ]);
    });

    it('ИСПОЛНЯЕМОСТЬ — ФЛАГ: "да" и 1 флагом не являются', () => {
      // Тот же код, что у соседнего render: это булево, и отказ приходит ДО
      // того, как что-либо применено, — разбор ничего не пишет и не исполняет.
      expect(
        codesOf(
          refusals({
            layout: [{ src: 'a.sh', dest: 'a.sh', executable: 'да' }],
          }),
        ),
      ).toEqual(['wrong-type @ baser.layout[0].executable']);

      const числом = refusals({
        layout: [{ src: 'a.sh', dest: 'a.sh', executable: 1 }],
      });
      expect(codesOf(числом)).toEqual([
        'wrong-type @ baser.layout[0].executable',
      ]);
      // И сказано, почему не число: режим восьмеричным здесь не выражается.
      expect(числом[0].message).toContain('программа или данные');
    });

    it('ИСПОЛНЯЕМОСТЬ В ОБЪЯВЛЕНИИ ФОРМЫ 5: сказано, что поднять', () => {
      const problems = refusals({
        formVersion: EXECUTABLE_SINCE - 1,
        layout: [{ src: 'a.sh', dest: 'a.sh', executable: true }],
      });
      expect(codesOf(problems)).toEqual([
        'form-version-unsupported @ baser.layout[0].executable',
      ]);
      expect(problems[0].message).toContain(
        `подними "formVersion" до ${EXECUTABLE_SINCE}`,
      );
    });

    it('ПОД СТАРЫМ НОМЕРОМ ОТВЕРГАЕТСЯ И false: незнакомо само поле', () => {
      // «Этот файл не программа» под формой 5 записано словом, которого та
      // форма не знает, — и прежний baser назовёт его опечаткой так же, как
      // true. Принять его значило бы согласиться с непригодным объявлением.
      expect(
        codesOf(
          refusals({
            formVersion: EXECUTABLE_SINCE - 1,
            layout: [{ src: 'a.sh', dest: 'a.sh', executable: false }],
          }),
        ),
      ).toEqual(['form-version-unsupported @ baser.layout[0].executable']);
    });

    it('нормализует путь, потому что dest — ключ владения', () => {
      const result = parse({
        layout: [{ src: './tpl/a.json', dest: './a.json' }],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.layout[0]).toMatchObject({
          src: 'tpl/a.json',
          dest: 'a.json',
        });
      }
    });

    it('ПУТЬ НОРМАЛИЗУЕТСЯ ВЕЗДЕ ОДИНАКОВО: src, dest и contentRoot', () => {
      // Дока обещала, что форма берёт путь «как есть» (`tasker:BASER2-70` §3), —
      // неправда: обратный слеш становится прямым, `./` вырезается, а результат
      // и есть ключ владения. Правило одно на все три поля.
      const result = parse({
        source: {
          id: 'omnifield/devbox',
          title: 'Девбокс',
          contentRoot: '.\\template\\',
        },
        layout: [{ src: 'tpl\\a.json', dest: './.devcontainer/./a.json' }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source.contentRoot).toBe('template');
      expect(result.value.layout[0]).toMatchObject({
        src: 'tpl/a.json',
        dest: '.devcontainer/a.json',
      });
    });

    it('contentRoot за пределы пакета не выпускается — правило то же', () => {
      for (const contentRoot of ['/шаблоны', '../соседний', '.']) {
        expect(
          codesOf(
            refusals({
              source: { id: 'omnifield/devbox', title: 'Девбокс', contentRoot },
            }),
          ),
        ).toContain('invalid-path @ baser.source.contentRoot');
      }
    });

    it('ловит столкновение внутри одного обвеса и не разрешает его порядком', () => {
      const problems = refusals({
        layout: [
          { src: 'base.json', dest: '.devcontainer/devcontainer.json' },
          { src: 'omnifield.json', dest: './.devcontainer/devcontainer.json' },
        ],
      });
      expect(codesOf(problems)).toEqual([
        'duplicate-dest @ baser.layout[1].dest',
      ]);
      expect(problems[0].message).toContain(
        'порядком записей это не разрешается',
      );
    });

    it('отказывает обвесу, который ничего не кладёт', () => {
      expect(codesOf(refusals({ layout: [] }))).toEqual([
        'missing-field @ baser.layout',
      ]);
      expect(codesOf(refusals({ layout: undefined }))).toEqual([
        'missing-field @ baser.layout',
      ]);
    });

    it('не выпускает артефакт за пределы репозитория потребителя', () => {
      // Это не дубль проверки движка: движок держит границу дерева потому, что
      // пишет сам. Здесь — про пригодность самого объявления.
      expect(
        codesOf(refusals({ layout: [{ src: 'a', dest: '/etc/hosts' }] })),
      ).toEqual(['invalid-path @ baser.layout[0].dest']);
      expect(
        codesOf(refusals({ layout: [{ src: 'a', dest: '../соседний/a' }] })),
      ).toEqual(['invalid-path @ baser.layout[0].dest']);
    });

    describe('артефакт поверх перечня поставленного', () => {
      it('НАЗЫВАЕТ ОТДЕЛЬНОЙ ПРИЧИНОЙ, а не общим «путь непригоден»', () => {
        // Обвес, кладущий файл поверх baser.json, снёс бы перечень, по которому
        // его самого и нашли. Причина у отказа своя, значит и код свой
        // (`tasker:BASER2-25`).
        const problems = refusals({
          layout: [{ src: 'a.json', dest: CONSUMER_CONFIG_PATH }],
        });
        expect(codesOf(problems)).toEqual([
          'artifact-over-consumer-config @ baser.layout[0].dest',
        ]);
        expect(problems[0].message).toContain(CONSUMER_CONFIG_PATH);
        expect(problems[0].message).toContain('перечень поставленного');
      });

      it('ловит и написание, которое нормализация сводит к тому же адресу', () => {
        // `dest` — ключ владения и сравнивается уже нормализованным: иначе
        // правило обходилось бы точкой и слешем.
        expect(
          codesOf(
            refusals({
              layout: [{ src: 'a.json', dest: `./${CONSUMER_CONFIG_PATH}` }],
            }),
          ),
        ).toEqual(['artifact-over-consumer-config @ baser.layout[0].dest']);
      });

      it('СОСЕДНЯЯ ЗАПИСЬ РАЗБИРАЕТСЯ КАК ОБЫЧНО: непригодна запись, не обвес', () => {
        const problems = refusals({
          layout: [
            { src: 'a.json.ejs', dest: 'tool/a.json' },
            { src: 'config.json', dest: CONSUMER_CONFIG_PATH },
            { src: 'b.bin', dest: 'tool/b.bin', render: false },
          ],
        });
        // Ровно один отказ и ровно по второй записи — про первую и третью
        // разбору сказать нечего.
        expect(codesOf(problems)).toEqual([
          'artifact-over-consumer-config @ baser.layout[1].dest',
        ]);
      });

      it('ПАСПОРТ УКЛАДКИ ФОРМА НЕ ЗАЩИЩАЕТ: его имя — слово движка', () => {
        // Третьей правды об этом событии не заводим: `dest`, целящийся в паспорт,
        // ловит движок (`dest-is-manifest`) — он им и владеет.
        const result = parse({
          layout: [{ src: 'a.json', dest: 'baser.lock.json' }],
        });
        expect(result.ok).toBe(true);
      });
    });
  });

  describe('лишние поля', () => {
    it('называет снятое поле, а не проглатывает его', () => {
      // `mode` объявлял поведение, которого у движка больше нет; молчаливый
      // разбор оставил бы обвес в уверенности, что его merge соблюдается.
      const problems = refusals({
        layout: [{ src: 'a.json', dest: 'a.json', mode: 'merge' }],
      });
      expect(codesOf(problems)).toEqual([
        'unknown-field @ baser.layout[0].mode',
      ]);
      // И сказано, чем это выражается вместо снятого поля — оба смысла слова
      // разом, потому что человек пишет `mode` и в том, и в другом.
      expect(problems[0].message).toContain('"class"');
      expect(problems[0].message).toContain('"executable": true');
    });

    it('РЕЖИМ ЧИСЛОМ ОТПРАВЛЯЕТСЯ К executable, а не в «форма не знает»', () => {
      // Ходовая ошибка после формы 6: привычный восьмеричный режим. Общий текст
      // отправил бы искать опечатку там, где её нет, — намерение выражено
      // верно, просто другим словом (`tasker:BASER2-212`).
      const problems = refusals({
        layout: [{ src: 'a.sh', dest: 'a.sh', mode: '0755' }],
      });
      expect(codesOf(problems)).toEqual([
        'unknown-field @ baser.layout[0].mode',
      ]);
      expect(problems[0].message).toContain('не сдержим на всех системах');
    });

    it('называет опечатку в имени поля блока', () => {
      expect(codesOf(refusals({ layouts: [] }))).toEqual([
        'unknown-field @ baser.layouts',
      ]);
    });

    it('$schema здесь НЕ поле формы, и асимметрия названа', () => {
      // В `baser.json` он пропускается: это самостоятельный JSON, редактору надо
      // чем-то подтянуть подсказки. Здесь схема у файла своя и живёт на верхнем
      // уровне package.json, а в файле настроек $schema лежит вне ключа `baser`.
      expect(
        codesOf(refusals({ $schema: 'https://omnifield.dev/baser.json' })),
      ).toEqual(['unknown-field @ baser.$schema']);
    });
  });
});
