/**
 * ПОСТАВКУ ДОСТАЁТ ДВЕРЬ — главная проба захода `tasker:BASER2-146`.
 *
 * Вопрос здесь один и он про локацию, а не про код: **остаётся ли в ней хоть
 * что-нибудь чужое.** Пока обвес был зависимостью потребителя, локация получала
 * `package.json`, склад и лок — даже если она на Go, — и наша авторизация уезжала
 * в её конвейер (`kb:BASER2-22`, `tasker:BASER2-108`). Значит доказательство
 * тоже одно: **локация БЕЗ пакетного менеджера нашего стека**, где чужой манифест
 * не появляется вовсе. Остальное можно изобразить, это — нет.
 *
 * Поэтому здесь ни одного мока: склад поднимается настоящий (`store.fixture.ts`),
 * поставку достаёт настоящий `npm`, тарбол распаковывается на настоящий диск, а
 * артефакты ложатся в настоящую локацию. Сети при этом не нужно: склад свой,
 * адрес свой, версии выкладывает сама проба.
 *
 * ── ПРИМЕНЕНИЕ ПОСТАВКИ ИЗ КЭША: ЗВЕНО ЗАМКНУТО ─────────────────────────────
 *
 * Проба «артефакт лёг» здесь стояла `it.skip` и ждала соседнюю зону: движок
 * отказывал `source-outside-tree`, когда репо-относительного пути к содержимому
 * обвеса не существует (`tasker:BASER2-24`). Пока обвес лежал в `node_modules`
 * потребителя, такой путь был всегда, и отказ закрывал редкий случай кривой
 * раскладки; кэш снаружи локации сделал этот случай НОРМОЙ.
 *
 * Движок разрешил положение НАЗВАННЫМ АДРЕСОМ, а не снятием защиты
 * (`tasker:BASER2-150`): источник снаружи утверждает пустое пересечение с
 * деревом, и адрес обязан быть невыразим репо-относительным путём. Дверь его и
 * называет (`engineInput`), пропуск снят, проба зелёная — доставание и
 * применение достанутого доказаны одним прогоном.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';
import { renderText } from './report.js';
import { soleRun } from './result.js';
import { supplyCacheRoot, SUPPLY_CACHE_ENV } from './supply.js';
import { startStore, type FakeStore } from './store.fixture.js';
import type { DoorResult } from './result.js';

/** Обвес, который выкладывается на склад: одна запись раскладки. */
const SUPPLY = 'baser-fixture-supply';
const SUPPLY_ID = 'fixture/supply';
const DEST = 'tool/config.json';

let store: FakeStore | null = null;
let box: string | null = null;

beforeEach(async () => {
  store = await startStore();
  box = mkdtempSync(join(tmpdir(), 'baser-supply-'));
});

afterEach(async () => {
  await store?.close();
  store = null;
  if (box !== null) {
    rmSync(box, { force: true, recursive: true });
    box = null;
  }
});

/** Выкладывает версию поставки на склад; отдаёт каталог, из которого собрали. */
function published(version: string, content: string): string {
  return (
    store?.publish({
      packageName: SUPPLY,
      version,
      id: SUPPLY_ID,
      title: 'обвес пробы',
      layout: [{ src: 'config.json', dest: DEST, render: false }],
      templates: { 'config.json': content },
    }) ?? ''
  );
}

/**
 * ЛОКАЦИЯ НЕ НА НАШЕМ СТЕКЕ: в ней нет ничего, кроме намерения.
 *
 * Ни `package.json`, ни склада, ни лока — ровно то состояние, ради которого
 * заход и делался. Изображать «локацию на Go» файлом на Go незачем: значение
 * имеет отсутствие нашего, а не присутствие чужого.
 */
function location(
  sources: readonly unknown[],
  at = 'location',
  // Форма НАЗЫВАЕТСЯ пробой, а не берётся из текущей: перечни форм 2–4 живут у
  // потребителей и обязаны разбираться дальше (`tasker:BASER2-177`). Метка
  // канала приехала формой 5, и записи с ней называют её сами.
  formVersion = 4,
): string {
  const root = join(box ?? '', at);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'baser.json'),
    `${JSON.stringify({ formVersion, sources }, null, 2)}\n`,
  );
  return root;
}

/**
 * ПАСПОРТ УКЛАДКИ, положенный руками, — прошлый прогон этой локации.
 *
 * Кладёт его движок, и здесь он не при чём: предмет пробы — цепочка версии,
 * то есть чем дверь отвечает на вопрос «какую поставку брать». Гонять ради этого
 * настоящее применение значило бы проверять две механики одной пробой.
 */
function recorded(root: string, version: string): void {
  writeFileSync(
    join(root, 'baser.lock.json'),
    `${JSON.stringify(
      {
        version: 2,
        artifacts: [
          {
            dest: DEST,
            src: 'config.json',
            source: SUPPLY_ID,
            version,
            class: 'regenerated',
            hash: 'sha256:0',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/** Кэш поставок — СНАРУЖИ локации, как ему и положено. */
function cache(): string {
  return join(box ?? '', 'cache');
}

/** Поставка, которую дверь достала, — так, как она её назвала в ответе. */
function supplyOf(result: DoorResult): DoorResult['runs'][number]['source'] {
  return soleRun(result).source;
}

describe('ЧУЖАЯ ЛОКАЦИЯ БЕЗ ПАКЕТНОГО МЕНЕДЖЕРА: дверь достаёт поставку сама', () => {
  it('поставка достаётся со склада и ложится в кэш СНАРУЖИ локации', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY }]);

    const result = await run({ command: 'apply', cwd: root, cache: cache() });
    const { supply, packageRoot, packageVersion } = supplyOf(result);

    // Склад спросили и поставку взяли — это утверждение про СКЛАД, а не про наш
    // флаг: обращения считает он сам.
    expect(store?.requests()).toBeGreaterThan(0);
    expect(supply.fetched).toBe(true);
    expect(packageVersion).toBe('0.1.0');

    // Кэш лежит вне дерева локации: он переживает и пересоздание среды, и снос
    // локации целиком.
    expect(supply.cache?.startsWith(cache())).toBe(true);
    expect(supply.cache?.startsWith(root)).toBe(false);
    expect(packageRoot.startsWith(root)).toBe(false);
    // И это настоящая распакованная поставка, а не запись в отчёте.
    expect(existsSync(join(packageRoot, 'template/config.json'))).toBe(true);

    // В локации при этом не появилось ничего чужого — ни манифеста чужого
    // стека, ни склада, ни лока пакетного менеджера.
    expect(existsSync(join(root, 'package.json'))).toBe(false);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
    expect(existsSync(join(root, 'pnpm-lock.yaml'))).toBe(false);
  });

  /**
   * ЗВЕНО ЗАМКНУТО ЦЕЛИКОМ — от склада до артефакта на диске.
   *
   * Соседняя проба выше судит доставание: поставка в кэше, в локации ничего
   * чужого. Эта судит ПРИМЕНЕНИЕ достанутого — то, что до `tasker:BASER2-150`
   * упиралось в отказ движка на источнике вне дерева. Держать доказательство
   * порознь было нечем: «достали» и «разложили» — разные утверждения, и второе
   * тут единственное, что подтверждает пользу первого.
   */
  it('артефакт лёг, паспорт укладки несёт версию поставки', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY }]);

    const result = await run({ command: 'apply', cwd: root, cache: cache() });

    expect(result.problems).toEqual([]);
    expect(result.status).toBe('applied');
    expect(readFileSync(join(root, DEST), 'utf-8')).toBe('{"tool": true}\n');

    // Своё состояние: паспорт укладки несёт версию поставки — воспроизводимость
    // держится им, а не чужим локом.
    const manifest = JSON.parse(
      readFileSync(join(root, 'baser.lock.json'), 'utf-8'),
    ) as { artifacts: { dest: string; source: string; version: string }[] };
    expect(manifest.artifacts).toContainEqual(
      expect.objectContaining({
        dest: DEST,
        source: SUPPLY_ID,
        version: '0.1.0',
      }),
    );
  });

  it('ПОВТОРНЫЙ ПРОГОН берёт из кэша: склад не спрашивают вовсе', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY, version: '0.1.0' }]);

    await run({ command: 'apply', cwd: root, cache: cache() });
    store?.forgetRequests();

    const again = await run({ command: 'apply', cwd: root, cache: cache() });

    expect(supplyOf(again).supply.fetched).toBe(false);
    // Утверждение ПРО СКЛАД, а не про наш флаг: ни одного обращения.
    expect(store?.requests()).toBe(0);
  });

  it('кэш общий на машину: ВТОРАЯ локация берёт ту же поставку не тянув', async () => {
    published('0.1.0', '{"tool": true}\n');
    await run({
      command: 'apply',
      cwd: location([{ use: SUPPLY, version: '0.1.0' }]),
      cache: cache(),
    });
    store?.forgetRequests();

    const second = location([{ use: SUPPLY, version: '0.1.0' }], 'вторая');
    const result = await run({ command: 'apply', cwd: second, cache: cache() });

    expect(supplyOf(result).supply.fetched).toBe(false);
    expect(store?.requests()).toBe(0);
  });

  it('`plan` в локацию не пишет — доставание записью в неё не является', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY, version: '0.1.0' }]);

    const planned = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(planned.writes).toEqual([]);
    expect(existsSync(join(root, DEST))).toBe(false);
    // А кэш прогрет: следующий прогон на склад не идёт. Кэш вне локации, значит
    // «plan ничего не пишет» этим не нарушено.
    expect(supplyOf(planned).supply.fetched).toBe(true);
    store?.forgetRequests();
    await run({ command: 'apply', cwd: root, cache: cache() });
    expect(store?.requests()).toBe(0);
  });

  it('НЕЗАКРЕПЛЁННАЯ версия спрашивает склад каждый прогон — пока её не закрепили', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY }]);
    await run({ command: 'plan', cwd: root, cache: cache() });
    store?.forgetRequests();

    // Кэш экономит СКАЧИВАНИЕ, а не вопрос: «какая последняя» — вопрос про
    // склад, и ответить на него из кэша значило бы соврать про сегодняшний день.
    const again = await run({ command: 'plan', cwd: root, cache: cache() });
    expect(store?.requests()).toBeGreaterThan(0);
    expect(supplyOf(again).supply.fetched).toBe(false);

    // Закрепление снимает и вопрос: паспорт укладки называет версию, и прогон
    // обходится без склада вовсе — это и есть оффлайн.
    recorded(root, '0.1.0');
    store?.forgetRequests();
    const third = await run({ command: 'plan', cwd: root, cache: cache() });
    expect(supplyOf(third).supply.origin).toEqual({
      kind: 'recorded',
      version: '0.1.0',
    });
    expect(store?.requests()).toBe(0);
  });
});

describe('ЦЕПОЧКА ВЕРСИИ: что берём и почему — сказано ДО применения', () => {
  it('закреплённая в намерении бьёт последнюю доступную', async () => {
    published('0.1.0', '{"first": true}\n');
    published('0.2.0', '{"second": true}\n');
    const root = location([{ use: SUPPLY, version: '0.1.0' }]);

    const result = await run({ command: 'plan', cwd: root, cache: cache() });
    const source = supplyOf(result);

    expect(source.supply.origin).toEqual({ kind: 'pinned', version: '0.1.0' });
    expect(source.packageVersion).toBe('0.1.0');
    // Взята именно она, а не «последняя, о которой сказали 0.1.0».
    expect(
      readFileSync(join(source.packageRoot, 'template/config.json'), 'utf-8'),
    ).toBe('{"first": true}\n');
  });

  it('не закреплена — берётся ПОСЛЕДНЯЯ, и план называет её до применения', async () => {
    published('0.1.0', '{"first": true}\n');
    published('0.2.0', '{"second": true}\n');
    const root = location([{ use: SUPPLY }]);

    const planned = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(supplyOf(planned).supply.origin).toEqual({
      kind: 'latest',
      version: '0.2.0',
    });
    // Обещание в тексте — такой же контракт, как код: молча взятая «последняя»
    // это молча поднятый дефолт другими словами.
    const text = renderText(planned);
    expect(text).toContain('0.2.0');
    expect(text).toContain('ПОСЛЕДНЯЯ доступная');
  });

  it('ПАСПОРТ УКЛАДКИ держит версию: выпуск между прогонами не догоняют', async () => {
    published('0.1.0', '{"first": true}\n');
    published('0.2.0', '{"second": true}\n');
    const root = location([{ use: SUPPLY }]);
    // Локация уже разложена версией 0.1.0, а в перечне версия не закреплена.
    recorded(root, '0.1.0');

    const result = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(supplyOf(result).supply.origin).toEqual({
      kind: 'recorded',
      version: '0.1.0',
    });
    expect(supplyOf(result).packageVersion).toBe('0.1.0');
  });

  it('паспорт держит её и на ХОЛОДНОМ кэше — воспроизводимость без чужого лока', async () => {
    published('0.1.0', '{"first": true}\n');
    published('0.2.0', '{"second": true}\n');
    const root = location([{ use: SUPPLY }]);
    recorded(root, '0.1.0');

    // Другая машина: кэша нет вовсе, паспорт приехал вместе с локацией. Личность
    // обвеса дверь узнаёт, только достав поставку, — и, узнав, берёт ту версию,
    // которой локация уже разложена.
    const result = await run({
      command: 'plan',
      cwd: root,
      cache: join(box ?? '', 'холодный'),
    });

    expect(supplyOf(result).supply.origin).toEqual({
      kind: 'recorded',
      version: '0.1.0',
    });
    expect(supplyOf(result).packageVersion).toBe('0.1.0');
  });

  it('закреплённая в намерении бьёт и паспорт: человек сказал прямо', async () => {
    published('0.1.0', '{"first": true}\n');
    published('0.2.0', '{"second": true}\n');
    const root = location([{ use: SUPPLY, version: '0.2.0' }]);
    recorded(root, '0.1.0');

    const result = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(supplyOf(result).supply.origin).toEqual({
      kind: 'pinned',
      version: '0.2.0',
    });
  });
});

/**
 * МЕТКА КАНАЛА: локация берёт дев-сборку, НЕ ЗНАЯ ЕЁ НОМЕРА (`kb:BASER3-26`).
 *
 * Предмет здесь один и он не про синтаксис: **перечень не меняется, а поставка
 * меняется.** Ровно этого не умела дверь с двумя режимами («последняя
 * стабильная» и «точный номер») — и на этом встал первый эталонный переезд
 * (`tasker:BASER2-171`): чтобы взять дев-сборку, приходилось гнаться за её
 * номером и править перечень на каждый выпуск.
 *
 * Склад здесь настоящий, и метка на нём тоже настоящая: `dist-tags` в описи
 * пакета, которые менеджер читает сам. Изобразить движущийся указатель моком
 * значило бы проверить наши представления о нём.
 */
describe('МЕТКА КАНАЛА: поставка берётся по указателю, а не по номеру', () => {
  /** Перечень, называющий метку: форма 5 — та, которой метка приехала. */
  function byChannel(channel: string, extra: Record<string, unknown> = {}) {
    return location([{ use: SUPPLY, channel, ...extra }], 'location', 5);
  }

  it('локация берёт дев-сборку, НЕ ЗНАЯ её номера', async () => {
    published('0.1.0', '{"stable": true}\n');
    published('0.2.0-dev.1', '{"dev": true}\n');
    // Метка ставится отдельным действием — так же, как выпуском в канал.
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev');

    const result = await run({ command: 'apply', cwd: root, cache: cache() });
    const source = supplyOf(result);

    expect(result.status).toBe('applied');
    expect(source.supply.origin).toEqual({
      kind: 'channel',
      channel: 'dev',
      version: '0.2.0-dev.1',
    });
    // Взята именно дев-сборка, а не последняя стабильная: содержимое своё.
    expect(source.packageVersion).toBe('0.2.0-dev.1');
    expect(readFileSync(join(root, DEST), 'utf-8')).toBe('{"dev": true}\n');
  });

  /**
   * МЕТКА ПЕРЕЕХАЛА — и локация поехала за ней, не тронув ни символа в перечне.
   *
   * Это и есть то, ради чего поле существует. Проба судит два утверждения
   * сразу: указатель движется (новая сборка приезжает сама) и запись паспорта
   * его НЕ ЗАПИРАЕТ — иначе локация навсегда осталась бы на первой дев-сборке,
   * которую поставила, то есть получила бы отказ на единственную свою просьбу.
   */
  it('метка ПЕРЕЕХАЛА — следующий прогон берёт новую сборку, перечень не тронут', async () => {
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev');
    await run({ command: 'apply', cwd: root, cache: cache() });
    const before = readFileSync(join(root, 'baser.json'), 'utf-8');

    published('0.2.0-dev.2', '{"dev": 2}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.2');
    const again = await run({ command: 'apply', cwd: root, cache: cache() });

    expect(supplyOf(again).supply.origin).toEqual({
      kind: 'channel',
      channel: 'dev',
      version: '0.2.0-dev.2',
    });
    expect(readFileSync(join(root, DEST), 'utf-8')).toBe('{"dev": 2}\n');
    // Перечень не менялся: номера в нём нет и не появилось.
    expect(readFileSync(join(root, 'baser.json'), 'utf-8')).toBe(before);
  });

  it('ПАСПОРТ УКЛАДКИ фиксирует НОМЕР, а не метку', async () => {
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev');

    await run({ command: 'apply', cwd: root, cache: cache() });

    const passport = readFileSync(join(root, 'baser.lock.json'), 'utf-8');
    const manifest = JSON.parse(passport) as {
      artifacts: { source: string; version: string }[];
    };
    expect(manifest.artifacts).toContainEqual(
      expect.objectContaining({ source: SUPPLY_ID, version: '0.2.0-dev.1' }),
    );
    // Метки в паспорте нет ВООБЩЕ: она сдвинется, и та же укладка дала бы
    // другое содержимое — воспроизводимости бы не осталось.
    expect(passport).not.toContain('channel');
  });

  it('паспорт метку НЕ БЬЁТ: она про сегодня, а он про «чем уже разложено»', async () => {
    published('0.1.0', '{"stable": true}\n');
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev');
    // Локация уже разложена стабильной — и всё равно поедет за меткой.
    recorded(root, '0.1.0');

    const result = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(supplyOf(result).supply.origin).toEqual({
      kind: 'channel',
      channel: 'dev',
      version: '0.2.0-dev.1',
    });
  });

  it('ВЫБОР НАЗВАН ДО ПРИМЕНЕНИЯ: и метка, и номер за ней', async () => {
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');

    const planned = await run({
      command: 'plan',
      cwd: byChannel('dev'),
      cache: cache(),
    });
    const text = renderText(planned);

    // Одной метки мало: под ней завтра будет другая сборка. Одного номера —
    // тоже: он не отличит закреплённую укладку от движущейся.
    expect(text).toContain('ВЗЯТО ПО МЕТКЕ КАНАЛА');
    expect(text).toContain('"dev"');
    expect(text).toContain('0.2.0-dev.1');
  });

  it('ТОЧНЫЙ НОМЕР БЬЁТ МЕТКУ — и проигравшая метка названа вслух', async () => {
    published('0.1.0', '{"stable": true}\n');
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev', { version: '0.1.0' });

    const result = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(supplyOf(result).supply.origin).toEqual({
      kind: 'pinned',
      version: '0.1.0',
      beatsChannel: 'dev',
    });
    // Молча выбрать одно из двух слов человека нельзя: написавший channel ждёт
    // дев-сборку и обязан узнать, почему её нет, из ответа — а не по содержимому.
    const text = renderText(result);
    expect(text).toContain('бьёт метку канала');
    expect(text).toContain('"dev"');
  });

  it('МЕТКА СПРАШИВАЕТСЯ КАЖДЫЙ ПРОГОН — кэш экономит скачивание, а не вопрос', async () => {
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev');
    await run({ command: 'plan', cwd: root, cache: cache() });
    store?.forgetRequests();

    const again = await run({ command: 'plan', cwd: root, cache: cache() });

    // Утверждение ПРО СКЛАД: его спросили, хотя поставка уже лежала в кэше.
    expect(store?.requests()).toBeGreaterThan(0);
    expect(supplyOf(again).supply.fetched).toBe(false);
  });

  /**
   * ТОТ ЖЕ ЗАПРЕТ, ЧТО И У «КАКАЯ ПОСЛЕДНЯЯ» (`tasker:BASER2-161`).
   *
   * Менеджер при сетевой ошибке отдаёт устаревшую запись вместо отказа —
   * погашенный склад отвечает `200 (cache stale)`. Для метки это ложь того же
   * рода и на том же месте: указатель по построению движется, и вчерашний ответ
   * про него — вчерашний. Проба судит различимость: склад погашен, кэш
   * менеджера прогрет ЭТИМ ЖЕ прогоном (тот же адрес, тот же порт).
   */
  it('погашенный склад на прогретом кэше: отказ, а не вчерашний номер метки', async () => {
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('dev');
    const warm = await run({ command: 'plan', cwd: root, cache: cache() });
    expect(supplyOf(warm).supply.origin).toEqual({
      kind: 'channel',
      channel: 'dev',
      version: '0.2.0-dev.1',
    });

    await store?.shutdown();
    const again = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(again.status).toBe('refused');
    expect(again.problems[0].code).toBe('supply-unreachable');
    // Номер из кэша не выдан за сегодняшний, и вопрос назван тем, каким был.
    const text = renderText(again);
    expect(text).not.toContain('ВЗЯТО ПО МЕТКЕ КАНАЛА');
    expect(again.problems[0].message).toContain('метка "dev"');
  });

  /**
   * НЕИЗВЕСТНЫЙ КАНАЛ — ОТКАЗ, А НЕ ТИХИЙ ОТКАТ НА СТАБИЛЬНУЮ.
   *
   * Откат выглядел бы как удачный прогон: локация разложена, кодов нет, а
   * содержимое не то, что просили. Человек узнал бы об этом по последствиям —
   * то есть тогда, когда объяснять их будет уже нечем.
   */
  it('метки у пакета нет: названы причина и метки, которые ЕСТЬ', async () => {
    published('0.1.0', '{"stable": true}\n');
    published('0.2.0-dev.1', '{"dev": 1}\n');
    store?.tag(SUPPLY, 'dev', '0.2.0-dev.1');
    const root = byChannel('development');

    const result = await run({ command: 'apply', cwd: root, cache: cache() });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    expect(problem.code).toBe('supply-channel-unknown');
    // Метки, которые есть, — названы: «dev» вместо «development» видно сразу.
    expect(problem.message).toContain('dev');
    expect(problem.message).toContain('latest');
    // Отказ ведёт в перечень, а не за токеном: склад на связи и пакет знает.
    expect(problem.message).not.toContain('токен');
    expect(problem.at).toBe('baser.json.sources[0].use');
    // И отката не случилось: на диске ничего.
    expect(existsSync(join(root, DEST))).toBe(false);
    expect(renderText(result)).not.toContain('ПОСЛЕДНЯЯ доступная');
  });
});

describe('НЕДОСТУПНЫЙ СКЛАД — названный отказ, а не чужая ошибка', () => {
  it('склад не отвечает: назван адрес, проверка руками и то, что делать', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY, version: '0.1.0' }]);
    const address = store?.url ?? '';
    await store?.shutdown();

    const result = await run({ command: 'apply', cwd: root, cache: cache() });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    expect(problem.code).toBe('supply-unreachable');
    // Адрес склада в отказе — то, чего не скажет чужая ошибка про сокет.
    expect(problem.message).toContain(address);
    expect(problem.message).toContain('npm view');
    // Адрес отказа — запись перечня: чинят её, а при двух записях иначе не
    // понять, какую именно.
    expect(problem.at).toBe('baser.json.sources[0].use');
    // Локация при этом цела: отказ на доставании не оставляет за собой ничего.
    expect(existsSync(join(root, DEST))).toBe(false);
    expect(existsSync(join(root, 'baser.lock.json'))).toBe(false);
  });

  it('склад отвечает, а поставки у него нет: другой код и другая починка', async () => {
    const root = location([{ use: 'baser-fixture-nothing' }]);

    const result = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('supply-not-published');
    // Не «нет доступа»: склад на связи, и человека посылают в перечень, а не
    // за токеном.
    expect(result.problems[0].message).toContain('baser-fixture-nothing');
    expect(result.problems[0].message).not.toContain('токен');
  });

  /**
   * ВОПРОС ПРО СЕГОДНЯШНИЙ ДЕНЬ НЕ ОТВЕЧАЕТСЯ ВЧЕРАШНИМ ЧИСЛОМ.
   *
   * Проба соседнего склада (`tasker:BASER2-156`) показала механику: менеджер
   * кэширует ответы склада по URL, а при сетевой ошибке отдаёт устаревшую
   * запись вместо отказа — погашенный склад отвечает `200`. Для пробы это был
   * флейк, для двери на живой машине это ЛОЖЬ: «ПОСЛЕДНЯЯ доступная» печатается,
   * не спросив склад.
   *
   * Изоляцией кэша, как у склада пробы, здесь не лечится: дверь работает на
   * машине человека с его кэшем, и кэш там обещан — он экономит скачивание.
   * Проба поэтому судит РАЗЛИЧИМОСТЬ: склад погашен, кэш менеджера прогрет тем
   * же прогоном (тот же адрес, тот же порт) — и ответа «последняя» не выдаётся.
   */
  it('НЕЗАКРЕПЛЁННАЯ версия на прогретом кэше: погашенный склад — отказ, а не вчерашнее число', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY }]);
    // Прогрев: этот прогон спрашивает склад, и его ответ ложится в кэш менеджера.
    const warm = await run({ command: 'plan', cwd: root, cache: cache() });
    expect(supplyOf(warm).supply.origin).toEqual({
      kind: 'latest',
      version: '0.1.0',
    });

    await store?.shutdown();
    const again = await run({ command: 'plan', cwd: root, cache: cache() });

    expect(again.status).toBe('refused');
    expect(again.problems[0].code).toBe('supply-unreachable');
    // Число из кэша не выдано за сегодняшнее: поставка в нашем кэше лежит, а
    // «последняя» — это вопрос про склад, и склада нет.
    expect(renderText(again)).not.toContain('ПОСЛЕДНЯЯ доступная');
  });

  /**
   * МЕНЕДЖЕР, НАСТРОЕННЫЙ НЕ ХОДИТЬ НА СКЛАД, — состояние, которое стало видимым.
   *
   * Пока «какая последняя» отвечалось из кэша, настройка `offline` молча меняла
   * ответ двери: склад не спрашивали, число печатали. Теперь вопрос идёт мимо
   * кэша — и настройка обязана назваться, а не притвориться оборванной связью:
   * человек, которому сказали «склад не ответил», пойдёт чинить сеть, которой не
   * касался.
   */
  it('менеджер настроен НЕ ходить на склад: отказ называет offline, а не связь', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY }]);
    const was = process.env['npm_config_offline'];
    process.env['npm_config_offline'] = 'true';

    try {
      const result = await run({ command: 'plan', cwd: root, cache: cache() });

      expect(result.status).toBe('refused');
      const [problem] = result.problems;
      expect(problem.code).toBe('supply-unreachable');
      expect(problem.message).toContain('offline');
      // Выход назван оба: закрепить версию либо снять настройку.
      expect(problem.message).toContain('sources[].version');
    } finally {
      if (was === undefined) {
        delete process.env['npm_config_offline'];
      } else {
        process.env['npm_config_offline'] = was;
      }
    }
  });

  it('прогретый кэш переживает падение склада — оффлайн работает', async () => {
    published('0.1.0', '{"tool": true}\n');
    const root = location([{ use: SUPPLY, version: '0.1.0' }]);
    await run({ command: 'plan', cwd: root, cache: cache() });

    await store?.shutdown();
    const again = await run({ command: 'plan', cwd: root, cache: cache() });

    // Ни одного отказа доставания: поставка уже здесь, склад не нужен.
    expect(
      again.problems.filter((item) => item.code.startsWith('supply-')),
    ).toEqual([]);
    expect(supplyOf(again).supply.fetched).toBe(false);
  });
});

describe('ДЕВ-ПЕТЛЯ: названный каталог — законный источник', () => {
  /**
   * Каталог поставки лежит В ЛОКАЦИИ — так же, как у нас самих обвесы лежат в
   * монорепе рядом, и так же, как ложится папка бандла ручной выдачи.
   */
  function beside(version: string, content: string): string {
    const source = published(version, content);
    const root = location([{ use: SUPPLY }]);
    const local = join(root, 'vendor', SUPPLY);
    mkdirSync(join(root, 'vendor'), { recursive: true });
    cpSync(source, local, { recursive: true });
    return local;
  }

  it('каталог назван — склад не спрашивают вовсе, и обвес ложится', async () => {
    const local = beside('9.9.9', '{"local": true}\n');
    const root = join(box ?? '', 'location');
    store?.forgetRequests();

    const result = await run({
      command: 'apply',
      cwd: root,
      cache: cache(),
      sources: [{ packageName: SUPPLY, path: local }],
    });

    expect(result.problems).toEqual([]);
    expect(result.status).toBe('applied');
    expect(readFileSync(join(root, DEST), 'utf-8')).toBe('{"local": true}\n');
    expect(supplyOf(result).supply.origin).toEqual({
      kind: 'local',
      path: local,
    });
    // Кэш тут ни при чём, и склада никто не спрашивал: доставать нечего.
    expect(supplyOf(result).supply.cache).toBeNull();
    expect(store?.requests()).toBe(0);
  });

  it('правка в каталоге доезжает СЛЕДУЮЩИМ прогоном — петля живая', async () => {
    const local = beside('9.9.9', '{"local": 1}\n');
    const root = join(box ?? '', 'location');
    const options = {
      cwd: root,
      cache: cache(),
      sources: [{ packageName: SUPPLY, path: local }],
    };

    await run({ command: 'apply', ...options });
    writeFileSync(join(local, 'template', 'config.json'), '{"local": 2}\n');
    const again = await run({ command: 'apply', ...options });

    expect(again.status).toBe('applied');
    expect(readFileSync(join(root, DEST), 'utf-8')).toBe('{"local": 2}\n');
  });

  it('каталог назван, а поставки в нём нет — свой код, своя починка', async () => {
    const root = location([{ use: SUPPLY }]);

    const result = await run({
      command: 'plan',
      cwd: root,
      cache: cache(),
      sources: [{ packageName: SUPPLY, path: join(box ?? '', 'нет-такого') }],
    });

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('supply-local-missing');
    // Отправить в этот момент настраивать токен значило бы дать уверенный
    // указатель не туда.
    expect(result.problems[0].message).not.toContain('токен');
  });
});

/**
 * СКЛАД ПРОБЫ НЕ ДЕЛИТ НИЧЕГО С МАШИНОЙ — страховка от возврата флейка.
 *
 * Проба «склад не отвечает» падала через прогон-другой не по своей вине
 * (`tasker:BASER2-156`): менеджер кэширует ответы по URL целиком, порт у склада
 * случайный, а при сетевой ошибке менеджер отдаёт устаревшую запись. Погашенный
 * склад отвечал `200` из ОБЩЕГО кэша машины, и отказа не случалось.
 *
 * Утверждение здесь поэтому не про поведение двери, а про изоляцию склада: у
 * него свой кэш, и уезжает он вместе с ним. Без такой пробы инвариант невидим —
 * его снимут одной строкой, а вернётся он падением раз в десяток прогонов,
 * которое опять спишут на нагрузку.
 */
describe('ИЗОЛЯЦИЯ СКЛАДА ПРОБЫ: общего с машиной не остаётся', () => {
  it('кэш менеджера свой, уезжает со складом, окружение возвращается', async () => {
    const outer = process.env['npm_config_cache'];

    const own = await startStore();
    const mine = process.env['npm_config_cache'] ?? '';

    // Кэш этого склада — его собственный каталог, а не кэш человека.
    expect(mine.startsWith(tmpdir())).toBe(true);
    expect(mine).not.toBe(outer);

    await own.close();

    // После склада не остаётся ни каталога, ни адреса в окружении: соседняя
    // проба не унаследует ни кэш, ни склад, которого больше нет.
    expect(existsSync(mine)).toBe(false);
    expect(process.env['npm_config_cache']).toBe(outer);
  });
});

describe('АДРЕС КЭША — каталог пользователя, а не рабочее дерево', () => {
  it('своё имя бьёт всё остальное: кэш прогревают конвейер и проба', () => {
    expect(
      supplyCacheRoot({
        cache: '/явно/сюда',
        env: { [SUPPLY_CACHE_ENV]: '/из/окружения', XDG_CACHE_HOME: '/xdg' },
      }),
    ).toBe('/явно/сюда');
  });

  it('дальше — XDG, дальше — домашний каталог', () => {
    expect(
      supplyCacheRoot({ env: { [SUPPLY_CACHE_ENV]: '/из/окружения' } }),
    ).toBe('/из/окружения');
    expect(supplyCacheRoot({ env: { XDG_CACHE_HOME: '/xdg' } })).toBe(
      '/xdg/baser',
    );
    expect(supplyCacheRoot({ env: {} })).toMatch(/\.cache\/baser$/);
  });

  it('ни один из трёх не лежит в рабочем дереве', () => {
    expect(supplyCacheRoot({ env: {} }).startsWith(process.cwd())).toBe(false);
  });
});
