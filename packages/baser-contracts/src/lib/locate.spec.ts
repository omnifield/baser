/**
 * ПРОБА ВХОДА ДЛЯ ЧУЖОГО КОДА — на синтетическом репозитории потребителя.
 *
 * Судится ровно то, ради чего вход заведён (`tasker:BASER2-122`): **чужой код
 * находит собственный эталон, НЕ ЗНАЯ нашей структуры.** Поэтому проба не
 * спрашивает у формы, куда она положила файл, и не сверяет путь с путём —
 * она сверяет СОДЕРЖИМОЕ по метке, которую сама же записала. Проверка через
 * нашу же раскладку доказывала бы, что мы согласны сами с собой.
 *
 * Репозиторий потребителя здесь настоящий, на диске, во временном каталоге:
 * `baser.json`, `node_modules` с пакетами обвесов, содержимое в `contentRoot`.
 * Ни одного файла живого репозитория проба не читает — как и вся зона.
 *
 * Раскладок ДВЕ, и это не избыточность: пакет бывает и внутри дерева, и
 * поднятым к родителю (hoisting, воркспейс). Один и тот же вызов обязан
 * находить обвес в обеих — иначе «не знает нашей структуры» держалось бы только
 * на удачной раскладке.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { locatePackage, locateSource, locateSourceContent } from './locate.js';
import { readSourceDeclaration } from './declaration.js';
import { codesOf } from './form.fixture.js';
import { FORM_VERSION } from './version.js';

/** Метка, по которой сверяется НАЙДЕННОЕ содержимое, а не найденный путь. */
const МЕТКА = 'эталон обвеса, доступный его коду у потребителя';

let работа: string;
/** Репозиторий потребителя: пакеты лежат внутри него. */
let репо: string;
/** Второй репозиторий: тот же обвес поднят к родителю (hoisting). */
let поднято: string;
/**
 * Каталог БЕЗ перечня поставленного, из которого пакет всё равно резолвится.
 *
 * Он же родитель поднятой раскладки: `node_modules` тут есть, `baser.json` нет.
 */
let безПеречня: string;
/** Корни пакетов-фикстур — то, ЧТО обязан найти резолв по имени. */
const корень: Record<string, string> = {};

function пакет(
  корень: string,
  имя: string,
  объявление: Record<string, unknown>,
  манифест: Record<string, unknown> = {},
): string {
  const место = join(корень, 'node_modules', ...имя.split('/'));
  mkdirSync(место, { recursive: true });
  файл(
    join(место, 'package.json'),
    JSON.stringify({
      name: имя,
      version: '1.2.3',
      baser: объявление,
      ...манифест,
    }),
  );
  return место;
}

function файл(путь: string, содержимое: string): void {
  mkdirSync(dirname(путь), { recursive: true });
  writeFileSync(путь, содержимое);
}

/** Объявление обвеса-фикстуры: минимум формы плюс личность. */
function объявление(id: string): Record<string, unknown> {
  return {
    formVersion: FORM_VERSION,
    source: { id, title: `Фикстура ${id}`, contentRoot: 'template' },
    layout: [{ src: 'a.json', dest: 'fixture/a.json' }],
  };
}

beforeAll(() => {
  работа = mkdtempSync(join(tmpdir(), 'baser-locate-'));

  // ── Раскладка 1: пакеты внутри репозитория потребителя.
  репо = join(работа, 'внутри');
  mkdirSync(репо, { recursive: true });
  файл(join(репо, 'package.json'), JSON.stringify({ name: 'потребитель' }));
  файл(
    join(репо, 'baser.json'),
    JSON.stringify({
      formVersion: FORM_VERSION,
      sources: [
        { use: '@fixture/kit' },
        { use: '@fixture/closed' },
        { use: '@fixture/не-поставлен' },
      ],
    }),
  );

  const kit = пакет(репо, '@fixture/kit', объявление('fixture/kit'));
  корень['@fixture/kit'] = kit;
  файл(join(kit, 'template', 'settings.hooks.json'), МЕТКА);
  файл(join(kit, 'template', 'вложенно', 'схема.json'), `${МЕТКА} (вложенно)`);

  // Пакет, закрывший `./package.json` в exports: манифест берётся обходом вверх.
  const closed = пакет(репо, '@fixture/closed', объявление('fixture/closed'), {
    exports: { '.': './index.js' },
  });
  корень['@fixture/closed'] = closed;
  файл(join(closed, 'index.js'), 'module.exports = {};\n');
  файл(join(closed, 'template', 'эталон.json'), `${МЕТКА} (exports закрыт)`);

  // Тот же обход вверх, но с ловушкой: точка входа лежит ГЛУБЖЕ корня, а рядом
  // с ней — чужой `package.json` без имени. Так подписывают тип модуля целые
  // каталоги, и подъём до ПЕРВОГО попавшегося манифеста прочитал бы его.
  const deep = пакет(репо, '@fixture/deep', объявление('fixture/deep'), {
    exports: { '.': './dist/index.js' },
  });
  корень['@fixture/deep'] = deep;
  файл(join(deep, 'dist', 'index.js'), 'module.exports = {};\n');
  файл(
    join(deep, 'dist', 'package.json'),
    JSON.stringify({ type: 'commonjs' }),
  );
  файл(join(deep, 'template', 'эталон.json'), `${МЕТКА} (вход глубже корня)`);

  // Подкаталог: хук запускают не только из корня.
  mkdirSync(join(репо, 'packages', 'глубоко'), { recursive: true });

  // ── Раскладка 2: тот же обвес поднят к родителю репозитория.
  const родитель = join(работа, 'поднято');
  безПеречня = родитель;
  поднято = join(родитель, 'репозиторий');
  mkdirSync(поднято, { recursive: true });
  файл(join(поднято, 'package.json'), JSON.stringify({ name: 'потребитель' }));
  файл(
    join(поднято, 'baser.json'),
    JSON.stringify({ sources: [{ use: '@fixture/kit' }] }),
  );
  const поднятый = пакет(родитель, '@fixture/kit', объявление('fixture/kit'));
  корень['поднятый'] = поднятый;
  файл(join(поднятый, 'template', 'settings.hooks.json'), МЕТКА);
});

afterAll(() => {
  rmSync(работа, { recursive: true, force: true });
});

describe('обвес находит собственное содержимое у потребителя', () => {
  it('ЧУЖОЙ КОД БЕРЁТ СВОЙ ЭТАЛОН, зная только личность и имя файла', () => {
    // Ровно то, что напишет автор обвеса: две строки и ни одного знания про то,
    // как устроены наши пакеты, где лежит node_modules и что такое contentRoot.
    const эталон = locateSourceContent('fixture/kit', 'settings.hooks.json', {
      from: репо,
    });

    expect(эталон.ok).toBe(true);
    if (!эталон.ok) return;
    // Сверяется СОДЕРЖИМОЕ: путь мы не собираем, иначе проверяли бы себя собой.
    expect(readFileSync(эталон.value, 'utf-8')).toBe(МЕТКА);
  });

  it('находит из ПОДКАТАЛОГА — корень ищется вверх по перечню поставленного', () => {
    const эталон = locateSourceContent('fixture/kit', 'settings.hooks.json', {
      from: join(репо, 'packages', 'глубоко'),
    });
    expect(эталон.ok).toBe(true);
    if (!эталон.ok) return;
    expect(readFileSync(эталон.value, 'utf-8')).toBe(МЕТКА);
  });

  it('РАСКЛАДКА ПАКЕТА НИЧЕГО НЕ МЕНЯЕТ: поднятый к родителю находится так же', () => {
    // Тот же вызов, другая раскладка на диске. Зависимость от неё была бы ровно
    // тем знанием о структуре, ради снятия которого вход и заведён.
    const эталон = locateSourceContent('fixture/kit', 'settings.hooks.json', {
      from: поднято,
    });
    expect(эталон.ok).toBe(true);
    if (!эталон.ok) return;
    expect(readFileSync(эталон.value, 'utf-8')).toBe(МЕТКА);
  });

  it('пакет, закрывший package.json в exports, тоже находится', () => {
    const эталон = locateSourceContent('fixture/closed', 'эталон.json', {
      from: репо,
    });
    expect(эталон.ok).toBe(true);
    if (!эталон.ok) return;
    expect(readFileSync(эталон.value, 'utf-8')).toContain('exports закрыт');
  });

  it('вложенный путь внутри содержимого разбирается по правилам формы', () => {
    const схема = locateSourceContent('fixture/kit', './вложенно/схема.json', {
      from: репо,
    });
    expect(схема.ok).toBe(true);
    if (!схема.ok) return;
    expect(readFileSync(схема.value, 'utf-8')).toContain('(вложенно)');
  });

  it('ЛИЧНОСТЬ, А НЕ ИМЯ ПАКЕТА: чем привезли — рассказывает ответ', () => {
    const найден = locateSource('fixture/kit', { from: репо });
    expect(найден.ok).toBe(true);
    if (!найден.ok) return;

    expect(найден.value.packageName).toBe('@fixture/kit');
    expect(найден.value.version).toBe('1.2.3');
    expect(найден.value.repoRoot).toBe(репо);
    // Содержимое лежит внутри пакета, а не в дереве потребителя: артефактом оно
    // не является, и `dest` у него нет.
    expect(найден.value.contentRoot.startsWith(найден.value.packageRoot)).toBe(
      true,
    );
  });
});

/**
 * РЕЗОЛВ ПО ИМЕНИ — тот же слой, другой вопрос сверху (`tasker:BASER2-127`).
 *
 * Судится не «одинаков ли код с дверью» (кода двери здесь нет и быть не
 * должно), а то, ради чего факт отдан наружу: **по имени пакета возвращается
 * его корень и разобранный манифест**, и возвращается на тех раскладках, где
 * ответ вообще может разойтись. Каждая из них — тонкая ветка одной из двух
 * бывших копий.
 */
describe('пакет находится ПО ИМЕНИ, а не только по личности', () => {
  it('ШТАТНАЯ РАСКЛАДКА: корень пакета и манифест, годный для разбора', () => {
    const найден = locatePackage('@fixture/kit', репо);
    expect(найден.ok).toBe(true);
    if (!найден.ok) return;

    expect(найден.value.root).toBe(корень['@fixture/kit']);
    expect(найден.value.packageName).toBe('@fixture/kit');
    expect(найден.value.version).toBe('1.2.3');

    // Манифест отдан сырым, и это не полуфабрикат: объявление из него достаёт
    // тот же разбор, которым пользуется дверь. Своей проверки вход не заводит.
    const объявлено = readSourceDeclaration(
      найден.value.manifest,
      '@fixture/kit/package.json',
    );
    expect(объявлено.ok).toBe(true);
    if (!объявлено.ok) return;
    expect(объявлено.value.source.id).toBe('fixture/kit');
  });

  it('ПОДНЯТАЯ РАСКЛАДКА: пакета в дереве нет вовсе, резолв уходит вверх', () => {
    // Сторона, считающая от себя, нашла бы здесь свою копию — а их тут две.
    const найден = locatePackage('@fixture/kit', поднято);
    expect(найден.ok).toBe(true);
    if (!найден.ok) return;
    expect(найден.value.root).toBe(корень['поднятый']);
  });

  it('ЗАКРЫТ ./package.json В EXPORTS — манифест берётся обходом вверх', () => {
    const найден = locatePackage('@fixture/closed', репо);
    expect(найден.ok).toBe(true);
    if (!найден.ok) return;
    expect(найден.value.root).toBe(корень['@fixture/closed']);
  });

  it('ОБХОД ВВЕРХ БЕРЁТ МАНИФЕСТ С ТЕМ ЖЕ ИМЕНЕМ, а не первый попавшийся', () => {
    // Самая тонкая ветка обеих бывших копий. Точка входа лежит в `dist`, рядом
    // с ней — `package.json` без имени: подъём до первого попавшегося вернул бы
    // ЕГО, и объявление обвеса читалось бы не из того файла.
    const найден = locatePackage('@fixture/deep', репо);
    expect(найден.ok).toBe(true);
    if (!найден.ok) return;

    expect(найден.value.root).toBe(корень['@fixture/deep']);
    const объявлено = readSourceDeclaration(
      найден.value.manifest,
      '@fixture/deep/package.json',
    );
    expect(объявлено.ok).toBe(true);
    if (!объявлено.ok) return;
    expect(объявлено.value.source.id).toBe('fixture/deep');
  });

  it('ПЕРЕЧНЯ ПОСТАВЛЕННОГО ЭТОТ ВОПРОС НЕ ТРЕБУЕТ', () => {
    // `baser.json` в этом каталоге нет — и правильно, что нет: «где лежит пакет»
    // факт файловой системы, а не следствие перечня. Дверь зовёт резолв как раз
    // тогда, когда перечня ещё не существует: она рождает его, разглядывая уже
    // поставленные зависимости.
    expect(existsSync(join(безПеречня, 'baser.json'))).toBe(false);

    const найден = locatePackage('@fixture/kit', безПеречня);
    expect(найден.ok).toBe(true);
    if (!найден.ok) return;
    expect(найден.value.root).toBe(корень['поднятый']);
  });

  it('ПАКЕТА НЕТ — назван и он сам, и место, откуда искали', () => {
    const ответ = locatePackage('@fixture/нет-такого', репо);
    expect(ответ.ok).toBe(false);
    if (ответ.ok) return;

    expect(codesOf(ответ.problems)).toEqual([
      `package-not-installed @ ${репо}`,
    ]);
    expect(ответ.problems[0].message).toContain('@fixture/нет-такого');
  });

  it('МАНИФЕСТ НЕПРИГОДЕН — это НЕ «пакет не поставлен»', () => {
    // Резолвер Node отказывает на битом манифесте так же, как на отсутствующем
    // пакете, — и без разбора его кода отказа единственным ответом было бы «не
    // поставлен» про пакет, который лежит на диске. Чинится это правкой файла, а
    // не установкой, поэтому и код другой.
    const битый = mkdtempSync(join(tmpdir(), 'baser-манифест-'));
    try {
      файл(
        join(битый, 'node_modules', '@fixture', 'сломан', 'package.json'),
        '{ "name": ',
      );

      const ответ = locatePackage('@fixture/сломан', битый);
      expect(ответ.ok).toBe(false);
      if (ответ.ok) return;

      expect(ответ.problems[0].code).toBe('package-manifest-unreadable');
      // В тексте назван сам файл — человек его открывает, а не догадывается.
      expect(ответ.problems[0].message).toContain('package.json');
      expect(ответ.problems[0].message).toContain('правкой этого файла');
    } finally {
      rmSync(битый, { recursive: true, force: true });
    }
  });
});

describe('плохие случаи называются, а не бросаются сырым', () => {
  it('ПЕРЕЧНЯ ПОСТАВЛЕННОГО НЕТ — сказано, что позвали не оттуда', () => {
    const пусто = mkdtempSync(join(tmpdir(), 'baser-пусто-'));
    try {
      const ответ = locateSource('fixture/kit', { from: пусто });
      expect(ответ.ok).toBe(false);
      if (ответ.ok) return;
      expect(codesOf(ответ.problems)).toEqual([
        'consumer-config-missing @ baser.json',
      ]);
      expect(ответ.problems[0].message).toContain('options.from');
    } finally {
      rmSync(пусто, { recursive: true, force: true });
    }
  });

  it('ПЕРЕЧЕНЬ НЕ ЧИТАЕТСЯ — отказ про JSON, а не бросок разборщика', () => {
    const битый = mkdtempSync(join(tmpdir(), 'baser-битый-'));
    try {
      файл(join(битый, 'baser.json'), '{ "sources": [ ');
      const ответ = locateSource('fixture/kit', { from: битый });
      expect(ответ.ok).toBe(false);
      if (ответ.ok) return;
      expect(ответ.problems[0].code).toBe('consumer-config-unreadable');
    } finally {
      rmSync(битый, { recursive: true, force: true });
    }
  });

  it('ЛИЧНОСТЬ НЕ СОВПАЛА — названо, кто поставлен на самом деле', () => {
    const ответ = locateSource('brainer/agent-harness', { from: репо });
    expect(ответ.ok).toBe(false);
    if (ответ.ok) return;

    expect(ответ.problems[0].code).toBe('source-not-installed');
    // Человек чинит опечатку в личности, только если видит настоящие.
    expect(ответ.problems[0].message).toContain('fixture/closed · fixture/kit');
    // И отдельно — про пакет, до объявления которого дойти не удалось: он в
    // перечне есть, но не поставлен, и молчать об этом значило бы дать неполный
    // ответ на вопрос «почему не нашли».
    expect(ответ.problems[0].message).toContain('@fixture/не-поставлен');
  });

  it('НЕПОСТАВЛЕННЫЙ СОСЕД НЕ ОБРЫВАЕТ ПОИСК — искомый лежит следующим', () => {
    // В перечне есть пакет, которого на диске нет. Обрыв на нём означал бы, что
    // порядок записей в чужом конфиге решает, найдётся наш обвес или нет.
    expect(locateSource('fixture/closed', { from: репо }).ok).toBe(true);
  });

  it('ФАЙЛА В СОДЕРЖИМОМ НЕТ — отказ сразу, а не путь в никуда', () => {
    const ответ = locateSourceContent('fixture/kit', 'нет-такого.json', {
      from: репо,
    });
    expect(ответ.ok).toBe(false);
    if (ответ.ok) return;
    expect(ответ.problems[0].code).toBe('content-missing');
    // Названо и то, что обвес всё-таки поставлен: иначе чинят не то.
    expect(ответ.problems[0].message).toContain('@fixture/kit');
  });

  it('ПУТЬ НАРУЖУ СОДЕРЖИМОГО НЕ ВЫПУСКАЕТСЯ — правила пути те же, что у формы', () => {
    for (const наружу of ['../../etc/passwd', '/etc/passwd', '']) {
      const ответ = locateSourceContent('fixture/kit', наружу, { from: репо });
      expect(ответ.ok).toBe(false);
      if (ответ.ok) return;
      expect(ответ.problems[0].code).toBe('invalid-path');
    }
  });

  it('содержимое обвеса не уехало в пакет — сказано, где смотреть', () => {
    const без = mkdtempSync(join(tmpdir(), 'baser-без-'));
    try {
      файл(join(без, 'package.json'), JSON.stringify({ name: 'потребитель' }));
      файл(
        join(без, 'baser.json'),
        JSON.stringify({ sources: [{ use: '@fixture/empty' }] }),
      );
      пакет(без, '@fixture/empty', объявление('fixture/empty'));

      const ответ = locateSource('fixture/empty', { from: без });
      expect(ответ.ok).toBe(false);
      if (ответ.ok) return;
      expect(ответ.problems[0].code).toBe('content-missing');
      expect(ответ.problems[0].message).toContain('"files"');
    } finally {
      rmSync(без, { recursive: true, force: true });
    }
  });

  it('НЕПРИГОДНЫЙ ПЕРЕЧЕНЬ отдаётся отказами формы, а не своими словами', () => {
    const кривой = mkdtempSync(join(tmpdir(), 'baser-кривой-'));
    try {
      файл(join(кривой, 'baser.json'), JSON.stringify({ источники: [] }));
      const ответ = locateSource('fixture/kit', { from: кривой });
      expect(ответ.ok).toBe(false);
      if (ответ.ok) return;
      // Второе описание одного события завело бы два места для одного факта.
      // Адрес — абсолютный путь того самого файла: человек открывает файл, а не
      // догадывается, какой из перечней имелся в виду.
      expect(codesOf(ответ.problems)).toContain(
        `missing-field @ ${join(кривой, 'baser.json')}.sources`,
      );
    } finally {
      rmSync(кривой, { recursive: true, force: true });
    }
  });
});
