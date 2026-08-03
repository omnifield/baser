/**
 * ОБВЕС ОБЪЯВЛЯЕТ РОВНО ТО, ЧТО РЕАЛЬНО ЛЕЖИТ В ПАКЕТЕ.
 *
 * Это та проверка, которой у примера внутри чужого пакета быть не могло. Пока
 * обвес жил каталогом в монорепе, «объявил» и «лежит» были одним и тем же
 * фактом: проба читала файлы теми же путями, что и объявление. Как только обвес
 * стал ПАКЕТОМ, между ними встал `files` — и они получили право разойтись
 * молча.
 *
 * Разойтись есть чему, и каждый случай ломает потребителя, а не нас:
 *
 * | что                     | как ломается                                        |
 * | ----------------------- | --------------------------------------------------- |
 * | `contentRoot` не уехал  | движок не находит источник: `missing-source`         |
 * | `src` не уехал          | тот же отказ, но на одном артефакте из двух          |
 * | `defaultFrom` не уехал  | `resolver-failed` при первом же прогоне двери        |
 * | `./package.json` закрыт | дверь вообще не находит пакет: `not-found`           |
 *
 * Поэтому здесь всё меряется по РАСПАКОВАННОМУ ТАРБОЛУ (`packed.mjs`), а
 * валидаторы берутся настоящие — те же, которыми форму читает дверь. Свой
 * разбор объявления был бы второй правдой о форме.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkSingleProvider,
  checkTemplate,
  describeProblems,
  FORM_VERSION,
  MIN_FORM_VERSION,
  readSourceDeclaration,
} from '../../baser-contracts/src/index.ts';
import { locatePackage } from '../../baser-contracts/src/locate.ts';
import { locateContentRoot } from '../../baser-cli/src/index.ts';
import {
  consumerConfig,
  DEVBOX_PACKAGE,
  installConsumer,
  LIVE,
  packedFiles,
  packedManifest,
  packedRoot,
  run,
  tuning,
} from './packed.mjs';

/** Объявление, прочитанное из ОПУБЛИКОВАННОГО манифеста настоящим разбором. */
function declaration() {
  const parsed = readSourceDeclaration(
    packedManifest(),
    `${DEVBOX_PACKAGE}/package.json`,
  );
  if (!parsed.ok) {
    throw new Error(
      `объявление обвеса непригодно:\n${describeProblems(parsed.problems)}`,
    );
  }
  return parsed.value;
}

describe('объявление пригодно по форме', () => {
  it('разбирается настоящим разбором контрактов и называет себя', () => {
    const decl = declaration();

    // ОКНО, А НЕ РАВЕНСТВО — и это решение, а не послабление.
    //
    // Форма обещает обвесу окно `[MIN_FORM_VERSION, FORM_VERSION]`: обвес ВПРАВЕ
    // быть написанным против прежней ревизии и остаётся законным, пока поля не
    // переехали (`MIN_FORM_VERSION` держится на 2 ровно затем, чтобы выпущенные
    // обвесы не переписывались ради возможности, которой не пользуются).
    // Равенство с `FORM_VERSION` требовало бы от НАШЕГО объявления ровно того,
    // от чего эта граница защищает чужие: любой подъём формы красил бы зону
    // девбокса — и красил бы её не тот, кто поднял (`tasker:BASER2-148`,
    // поймано на живом при 3 → 4).
    //
    // Поэтому здесь судится ПРИГОДНОСТЬ объявления: разбор его принял (выше), а
    // названная им форма — из тех, что этот baser разбирает. Соседняя зона
    // выдачи судит так же (`baser-pack`, приёмка описи) и подъём формы пережила
    // зелёной. Увидев рядом константу, «починить» это обратно на `toBe` значит
    // вернуть дефект: совпадение чисел здесь — не инвариант девбокса.
    const declaredForm = packedManifest().baser.formVersion;
    expect(declaredForm).toBeGreaterThanOrEqual(MIN_FORM_VERSION);
    expect(declaredForm).toBeLessThanOrEqual(FORM_VERSION);
    // Разбор прочитал ровно то число, что стоит в опубликованном манифесте.
    expect(decl.formVersion).toBe(declaredForm);

    expect(decl.source.id).toBe('omnifield/devbox');
    expect(decl.source.contentRoot).toBe('template');
    expect(decl.layout.map((entry) => entry.dest)).toEqual([
      '.devcontainer/devcontainer.json',
      '.devcontainer/devcontainer-lock.json',
    ]);
    // Пин toolchain по digest обязан лечь байт в байт — это не шаблон.
    expect(decl.layout[1].render).toBe(false);
  });

  it('ОБА артефакта перегенерируются целиком — placed-once обвесу не нужен', () => {
    // Класс называется по делу, а не для галочки (`tasker:BASER2-60`). У девбокса
    // обе записи — наши от первой строки до последней: `devcontainer.json`
    // собирается из значений целиком, а `devcontainer-lock.json` это пин
    // toolchain по digest. Человеку заполнять нечего ни в том, ни в другом:
    // заполняет он файл настроек, а его в раскладке нет и быть не может.
    //
    // ЛОВУШКА, которую эта проба закрывает: `.devcontainer/devcontainer.json` —
    // конфиг, путь которого диктует ЧУЖОЙ инструмент, и по форме такие конфиги
    // кладутся классом `placed-once` (`tasker:BASER2-10` §3). Исключение это про
    // конфиги, которые заполняет ЧЕЛОВЕК, а наш он не заполняет. Объяви мы здесь
    // `placed-once` — девбокс замёрз бы на своей первой версии у каждого
    // потребителя, и вся механика обновления обвеса перестала бы работать молча.
    const classes = declaration().layout.map((entry) => [
      entry.dest,
      entry.class,
    ]);

    expect(classes).toEqual([
      ['.devcontainer/devcontainer.json', 'regenerated'],
      ['.devcontainer/devcontainer-lock.json', 'regenerated'],
    ]);
    // И ни одного `class` в самом объявлении: умолчание проставляет разбор, а
    // повторять его руками значило бы держать одно правило в двух местах.
    for (const entry of packedManifest().baser.layout) {
      expect('class' in entry, `${entry.dest} называет класс руками`).toBe(
        false,
      );
    }
  });

  it('один артефакт — один поставщик: внутри обвеса dest не повторяется', () => {
    const owners = checkSingleProvider([
      { declaration: declaration(), packageName: DEVBOX_PACKAGE },
    ]);
    expect(owners.ok).toBe(true);
  });

  it('пресет выставляет только объявленные настройки', () => {
    const decl = declaration();
    const declared = Object.keys(decl.settings);
    for (const [name, preset] of Object.entries(decl.presets)) {
      for (const key of Object.keys(preset.values)) {
        expect(declared, `пресет ${name} трогает ${key}`).toContain(key);
      }
    }
  });
});

describe('раскладка указывает в то, что реально уехало в тарболе', () => {
  it('contentRoot существует в опубликованном пакете и это каталог', () => {
    const root = join(packedRoot(), declaration().source.contentRoot);
    expect(existsSync(root), `${root} не уехал в тарбол`).toBe(true);
    expect(statSync(root).isDirectory()).toBe(true);
  });

  it('каждый src из раскладки лежит в тарболе файлом', () => {
    const decl = declaration();
    for (const entry of decl.layout) {
      const file = join(packedRoot(), decl.source.contentRoot, entry.src);
      expect(existsSync(file), `${entry.src} объявлен, но не уехал`).toBe(true);
      expect(statSync(file).isFile()).toBe(true);
    }
  });

  it('и наоборот: в contentRoot не уехало ничего необъявленного', () => {
    // Обратная сторона того же инварианта. Файл, который приехал потребителю, но
    // не назван раскладкой, не ляжет никуда и не будет никем замечен — мёртвый
    // вес, который со временем начнут считать частью обвеса.
    const decl = declaration();
    const shipped = packedFiles()
      .filter((path) => path.startsWith(`${decl.source.contentRoot}/`))
      .map((path) => path.slice(decl.source.contentRoot.length + 1));

    expect(shipped.sort()).toEqual(
      decl.layout.map((entry) => entry.src).sort(),
    );
  });

  it('состав тарбола назван целиком — лишнего в реестр не уезжает', () => {
    // `files` перечисляет, что уедет; npm сверх этого всегда кладёт манифест и
    // README. Список ЗАКРЫТЫЙ намеренно: тесты, конфиги и черновики в пакете
    // обвеса — это то, что потребитель качает и никогда не открывает.
    expect(packedFiles()).toEqual([
      'README.md',
      'defaults.mjs',
      'package.json',
      'template/devcontainer-lock.json',
      'template/devcontainer.json.ejs',
    ]);
  });
});

describe('шаблоны написаны на языке формы', () => {
  it('render: true — EJS без экранирующей подстановки и без include', () => {
    const decl = declaration();
    for (const entry of decl.layout.filter((item) => item.render)) {
      const text = readFileSync(
        join(packedRoot(), decl.source.contentRoot, entry.src),
        'utf-8',
      );
      const problems = checkTemplate(text, `${entry.src} → ${entry.dest}`);
      expect(problems.map((problem) => problem.code)).toEqual([]);
    }
  });
});

describe('вычисляемые дефолты резолвятся ИЗ ОПУБЛИКОВАННОГО СОСТАВА', () => {
  let modules;

  beforeAll(async () => {
    // Ровно тот же путь, которым их грузит дверь: файл ВНУТРИ распакованного
    // пакета, а не модуль монорепы. Резолв через `exports` тут ни при чём —
    // `defaultFrom` это путь.
    modules = new Map();
    for (const spec of Object.values(declaration().settings)) {
      if (spec.defaultFrom && !modules.has(spec.defaultFrom.module)) {
        modules.set(
          spec.defaultFrom.module,
          await import(
            pathToFileURL(join(packedRoot(), spec.defaultFrom.module)).href
          ),
        );
      }
    }
  });

  it('модуль каждой настройки уехал в тарбол и грузится', () => {
    const decl = declaration();
    const referenced = new Set(
      Object.values(decl.settings)
        .filter((spec) => spec.defaultFrom)
        .map((spec) => spec.defaultFrom.module),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const module of referenced) {
      expect(existsSync(join(packedRoot(), module))).toBe(true);
      expect(modules.get(module)).toBeDefined();
    }
  });

  it('названный экспорт есть и это функция', () => {
    for (const [key, spec] of Object.entries(declaration().settings)) {
      if (!spec.defaultFrom) continue;
      const member = modules.get(spec.defaultFrom.module)[
        spec.defaultFrom.member
      ];
      expect(typeof member, `${key} → ${spec.defaultFrom.member}`).toBe(
        'function',
      );
    }
  });

  it('ровно одно из default / defaultFrom у каждой настройки', () => {
    // Настройка без дефолта означала бы вопрос пользователю, а вопросов у двери
    // нет вовсе. Разбор контрактов это уже проверил — здесь оно названо на
    // НАШЕМ объявлении, чтобы новая настройка не приехала «полутора дефолтами».
    for (const [key, spec] of Object.entries(declaration().settings)) {
      const hasDefault = 'default' in spec;
      const hasFrom = spec.defaultFrom !== undefined;
      expect(hasDefault !== hasFrom, `настройка ${key}`).toBe(true);
    }
  });
});

describe('дверь находит пакет так же, как его нашёл бы потребитель', () => {
  it('резолв по имени, contentRoot внутри дерева, путь ведёт в шаблоны', () => {
    const consumer = installConsumer();
    try {
      // `./package.json` в `exports` — несущая часть объявления, а не деталь:
      // закрыв его, обвес перестал бы находиться вовсе.
      const installed = locatePackage(DEVBOX_PACKAGE, consumer.root);
      expect(installed.ok).toBe(true);
      expect(installed.value.packageName).toBe(DEVBOX_PACKAGE);
      expect(installed.value.version).toBe(packedManifest().version);

      const location = locateContentRoot(
        consumer.root,
        installed.value.root,
        declaration().source.contentRoot,
      );
      expect(location.kind).toBe('in-tree');
      expect(location.path).toBe(
        `node_modules/${DEVBOX_PACKAGE}/${declaration().source.contentRoot}`,
      );
      expect(existsSync(join(consumer.root, location.path))).toBe(true);
    } finally {
      consumer.cleanup();
    }
  });
});

/**
 * СНЯТОЕ ИМЯ ОБЯЗАНО ОТВЕЧАТЬ, А НЕ ПРОПАДАТЬ.
 *
 * `runtimeVersion` опубликован (0.6.0) и заполнен у обоих живых потребителей, а
 * с этого выпуска настройки с таким именем нет: значение подставлялось ТЕГОМ
 * образа, и имя врало (`tasker:BASER2-83`). Ломающее — названное, а не тихое:
 * конфиг со снятым ключом получает отказ `unknown-setting`, дверь не кладёт
 * ничего и сама перечисляет, что есть, — включая замену.
 *
 * Проверяется это здесь, а не «известно по устройству двери»: обещание доке
 * («миграция — перенос одного значения») ровно настолько же контракт, как код.
 */
describe('снятое имя даёт НАЗВАННЫЙ отказ и называет, чем заменено', () => {
  it('заполненный runtimeVersion — unknown-setting, и в списке есть imageTag', async () => {
    const consumer = installConsumer({
      repoName: 'baser',
      config: consumerConfig(),
      tuning: tuning({ settings: { runtimeVersion: '22' } }),
    });
    try {
      const result = await run({ command: 'apply', cwd: consumer.root });

      expect(result.status).toBe('refused');
      const problem = result.problems.find(
        (item) => item.code === 'unknown-setting',
      );
      expect(problem, JSON.stringify(result.problems)).toBeDefined();
      expect(problem.at).toContain('runtimeVersion');
      expect(problem.message).toContain('imageTag');
      // И ничего не легло: обновление «не глядя» тут невозможно, поэтому дверь
      // не раскладывает половину.
      expect(consumer.read(LIVE)).toBe(null);
    } finally {
      consumer.cleanup();
    }
  });

  it('перенос одного значения чинит целиком — и артефакт тот же', async () => {
    const consumer = installConsumer({
      repoName: 'baser',
      config: consumerConfig(),
      tuning: tuning({ settings: { imageTag: '22' } }),
    });
    try {
      const result = await run({ command: 'apply', cwd: consumer.root });

      expect(result.status).toBe('applied');
      expect(consumer.read(LIVE)).toContain('typescript-node:22');
    } finally {
      consumer.cleanup();
    }
  });
});
