/**
 * СЛОВАРЬ ЗОНЫ — проба, а не памятка.
 *
 * Отменённая пара слов («деталь подходит патрону») дожила в этой зоне до
 * сплошной сверки architect'ом: `report.ts` держал заголовок раздела
 * «ПОДГОТОВКА ДЕТАЛИ», а ниже, в том же файле, ответ `check` уже говорил
 * канонично — файл спорил сам с собой (`tasker:BASER2-101`).
 *
 * Почему это не поймали пробы: `promises.spec.ts` судит `USAGE` и текст ответа —
 * то, что видит человек, — и внутренний комментарий в эту область не попадает.
 * И правильно, что не попадает: проба не должна проверять всё подряд. Но
 * проверка и выдача пошли дальше и завели ровно эту границу — судить **всё, что
 * уезжает получателю**. У двери такой пробы не было, и это единственная причина,
 * по которой место дожило.
 *
 * ── ЧТО СУДИТСЯ ─────────────────────────────────────────────────────────────
 *
 * Описание пакета для npm, заголовок README и каждый модуль, попадающий в
 * `dist` (`*.spec.ts` и `*.fixture.ts` исключены той же строкой, что и в
 * `tsconfig.lib.json`, — они не уезжают). Чужой получатель читает всё это, и
 * читает раньше, чем нашу переписку про канон.
 *
 * Объяснение отменённой пары живёт в README (§ «Словарь») и называет эти слова
 * НАМЕРЕННО: оно объясняет замену. Поэтому README судится по заголовку, а не
 * целиком — иначе проба запрещала бы объяснять собственную причину. Ровно так
 * же устроен `vocabulary.spec.ts` у проверки и у выдачи: одна граница на три
 * зоны, а не три разных.
 *
 * Словарь канона (`kb:BASER2-4`, `kb:BASER2-9` поправлен 2026-07-29): то, что
 * станок ПРОИЗВОДИТ, — это сам продукт; обвес подходит ПОСАДОЧНОМУ МЕСТУ, из
 * которых патрон лишь одно. `check`/`pack`/`bundle` готовят обвес К ВЫДАЧЕ.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installDevbox,
  DEVBOX_PACKAGE,
  type Consumer,
} from './devbox.fixture.js';
import { renderText } from './report.js';
import { run } from './run.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Отменённая пара слов. Ищется по корню — «детали» и «патрона» тоже. */
const CANCELLED = /детал|патрон/i;

/**
 * Выведенное из языка слово (`kb:BASER3-29`, решение user 2026-08-06).
 *
 * Ищется НАЧАЛО слова, а не подстрока: «подвернувшийся» несёт те же буквы и к
 * словарю отношения не имеет — проба, красневшая на нём, учила бы обходить себя,
 * а не держать слово.
 */
const RETIRED = /(?<![А-Яа-яЁё])двер/gi;

/** Модули, уезжающие в `dist`: те же исключения, что в `tsconfig.lib.json`. */
function shippedModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return shippedModules(path);
    }
    if (!entry.name.endsWith('.ts')) {
      return [];
    }
    return entry.name.endsWith('.spec.ts') || entry.name.endsWith('.fixture.ts')
      ? []
      : [path];
  });
}

describe('словарь зоны', () => {
  it('описание пакета для npm говорит канонично', () => {
    // Описания у пакета двери не было вовсе — на странице npm первый, кого
    // встречает чужой получатель, это пустое место. Пустое место словарь не
    // нарушает и ничего не обещает; оно просто не работает.
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf-8'),
    ) as { description?: string };

    expect(manifest.description).toBeDefined();
    expect(manifest.description).not.toMatch(CANCELLED);
  });

  it('заголовок README говорит канонично', () => {
    const [title] = readFileSync(join(ROOT, 'README.md'), 'utf-8').split('\n');

    // Слово «дверь» выведено из языка (`kb:BASER3-29`, решение user
    // 2026-08-06): оно значило разом вход в машину снаружи (`:8080`) и наш
    // командный фронт. Фронт называется КОНСОЛЬЮ, и заголовок зоны — первое
    // место, где чужой читатель это видит.
    expect(title).toContain('консоль');
    expect(title).not.toMatch(CANCELLED);
  });

  it('видимый текст зоны не говорит «дверь»', () => {
    // Судится ровно то, что названо работой `tasker:BASER2-201`: описание
    // пакета для npm и README зоны. Внутренние комментарии выводятся из языка
    // отдельно и лениво — сплошная правка 186 файлов конфликтует со всем, что в
    // работе, и читателю не даёт ничего.
    const manifest = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const description = (JSON.parse(manifest) as { description: string })
      .description;
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');

    expect(description).not.toMatch(RETIRED);
    // README называет отменённое слово РОВНО ОДИН раз — в «Словаре», где
    // объясняет замену: тем же правилом, что и отменённая пара «деталь ·
    // патрон» ниже. Запрет на упоминание запретил бы зоне объяснять причину.
    expect(readme.match(RETIRED) ?? []).toHaveLength(1);
    expect(readme).toContain('«дверь» выведена из языка');
  });

  it('отменённого словаря нет ни в одном уезжающем модуле', () => {
    const modules = shippedModules(join(ROOT, 'src'));

    // Пустой список прошёл бы эту пробу молча — «сверено ноль» и «сверено всё»
    // читаются одинаково, и это в продукте уже названо отдельным правилом.
    expect(modules.length).toBeGreaterThanOrEqual(15);
    for (const path of modules) {
      // Адрес едет в утверждение: красная проба обязана называть файл, а не
      // сообщать, что где-то в зоне что-то есть.
      expect([path, readFileSync(path, 'utf-8').match(CANCELLED)]).toEqual([
        path,
        null,
      ]);
    }
  });
});

/**
 * ВЫВЕДЕННОЕ СЛОВО СУДИТСЯ ПО ВЫХОДУ, А НЕ ПО ИСХОДНИКУ (`tasker:BASER2-204`).
 *
 * Справка и README вычищены раньше (`tasker:BASER2-201`), и там проба смотрит на
 * текст напрямую — он и есть продукт. У прогона иначе: печатаемая строка
 * собирается из кусков, а рождаемый файл настроек и вовсе не лежит в исходнике
 * целиком. Поиск по `src` ответил бы про НАМЕРЕНИЕ зоны, а человек читает то,
 * что вышло, — поэтому здесь прогоняется настоящий прогон, и судится его вывод.
 *
 * Внутренние комментарии этими пробами не судятся намеренно: они уезжают своей
 * работой (`tasker:BASER2-203`), и смешать их сюда значило бы получить красноту
 * там, где читателя нет.
 */
describe('выведенное слово не доезжает до человека', () => {
  const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };
  const DEVBOX_ID = 'omnifield/devbox';
  const LIVE = '.devcontainer/devcontainer.json';

  let consumer: Consumer | null = null;

  afterEach(() => {
    consumer?.cleanup();
    consumer = null;
  });

  it('ни одна печатаемая строка прогона: укладка, сходимость, переезд, отказ', async () => {
    consumer = installDevbox({
      config: CONFIG,
      tuning: { [DEVBOX_ID]: { presets: ['omnifield'] } },
    });

    // Четыре прогона, потому что печатают они РАЗНОЕ. Одного мало: блок
    // «остаётся человеку» появляется только на переезде, а отказ — только там,
    // где на пути обвеса лежит чужой файл.
    const said: Record<string, string> = {
      план: renderText(await run({ command: 'plan', ...consumer.door })),
      укладка: renderText(await run({ command: 'apply', ...consumer.door })),
      сходимость: renderText(await run({ command: 'plan', ...consumer.door })),
    };

    // Переезд значения: заполненный пользователь образа двигает и посчитанные
    // от него адреса томов — тот самый прогон с блоком «остаётся человеку».
    consumer.tune(DEVBOX_ID, {
      presets: ['omnifield'],
      settings: { imageUser: 'vscode' },
    });
    said['переезд'] = renderText(
      await run({ command: 'plan', ...consumer.door }),
    );
    expect(said['переезд']).toContain('остаётся человеку');

    // Отказ: на пути обвеса лежит чужой файл — самый читаемый текст зоны,
    // потому что человек упирается в него в первые пять минут. Конфига тут нет
    // намеренно: так это и выглядит у того, кто ставит обвес впервые.
    consumer.cleanup();
    consumer = installDevbox({
      existing: { [LIVE]: '{\n  "name": "мой старый девбокс"\n}\n' },
    });
    said['отказ'] = renderText(
      await run({ command: 'plan', ...consumer.door }),
    );
    expect(said['отказ']).toContain('первая установка в непустой репозиторий');

    for (const [scenario, text] of Object.entries(said)) {
      // Имя прогона едет в утверждение: красная проба обязана называть, какой
      // именно вывод сказал лишнее, а не сообщать, что где-то в зоне что-то есть.
      expect([scenario, text.match(RETIRED)]).toEqual([scenario, null]);
    }

    // Обратная половина — там, где предмет есть: инструмент называет себя не в
    // каждом прогоне, и требовать слова от всех значило бы судить не замену, а
    // разговорчивость. На переезде он себя называет, и называет консолью.
    expect(said['переезд']).toContain(
      'докер консоль не зовёт и контейнерами не управляет',
    );
  });

  it('рождённый файл настроек — на живом рождении, а не в шаблоне', async () => {
    consumer = installDevbox({ config: CONFIG });

    await run({ command: 'apply', ...consumer.door });

    // Читается ровно то, что человек откроет: файл с диска, а не строка из
    // `renderSourceConfig`. Комментарии в нём — первое, что он читает про
    // инструмент, и читает раньше любой доки.
    const born = consumer.readTuning(DEVBOX_ID);
    expect(born).not.toBeNull();
    expect(born).not.toMatch(RETIRED);
    expect(born).toContain('Файл родила консоль');
  });
});
