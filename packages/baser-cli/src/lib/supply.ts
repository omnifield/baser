/**
 * ПОСТАВКУ ДОСТАЁТ ДВЕРЬ, а не пакетный менеджер потребителя.
 *
 * Раньше дверь искала обвесы среди того, что у потребителя уже стоит: резолв по
 * имени от корня локации, то есть по её `node_modules`. Значит поставку клал
 * пакетный менеджер потребителя, и локация получала `package.json`, склад и лок —
 * даже если она на Go. Три цены названы в `kb:BASER2-22`, и третья не
 * теоретическая: обвес в зависимостях означает, что конвейер потребителя обязан
 * ходить в НАШ закрытый склад при установке, и падает там без токена
 * (`tasker:BASER2-108`).
 *
 * Форма взята с рынка, а не придумана (`kb:BASER3-9`, сверено 2026-08-03):
 * **инструмент ставится один раз снаружи · локация объявляет намерение своим
 * нейтральным файлом · загружаемое живёт в кэше снаружи · версия фиксируется
 * своим состоянием, а не чужим лок-файлом.** Так устроены pre-commit, copier,
 * asdf/mise, devcontainer features, Terraform. Ближайший образец — pre-commit: он
 * на питоне, обслуживает локации на чём угодно, и в обслуживаемой локации от
 * питона ни следа.
 *
 * ── ДОСТАЁМ ТЕМ ЖЕ ПАКЕТНЫМ МЕНЕДЖЕРОМ ──────────────────────────────────────
 *
 * `npm` зовётся как есть, своего загрузчика здесь нет и не будет. Причина не в
 * экономии: свой загрузчик — это ВТОРОЙ ИСТОЧНИК ПРАВДЫ о том, где лежит
 * поставка. Адрес склада, скоуп, токен, зеркало, прокси, оффлайн-кэш — всё это
 * человек уже настроил один раз, и всё это читает `npm` из своих файлов. Своя
 * реализация обязана была бы повторить их все и молча разошлась бы на первом же
 * непрочитанном ключе (`kb:BASER2-17`: инфраструктурные узлы берём с рынка).
 *
 * Отсюда же и `--ignore-scripts`: поставка — это СОДЕРЖИМОЕ, и собирать ей
 * нечего. Резолверы обвеса дверь грузит сама и явно (`values.ts`), а молчаливо
 * исполнить чужой lifecycle-скрипт при установке мы не согласны — фикстура зоны
 * приняла то же решение и по той же причине.
 *
 * ── КЭШ СНАРУЖИ ЛОКАЦИИ ─────────────────────────────────────────────────────
 *
 * Кэш живёт в каталоге пользователя (`$XDG_CACHE_HOME`, иначе `~/.cache`), а не в
 * рабочем дереве: он обязан переживать пересоздание среды и быть общим на машину,
 * а в локации после установки не должно остаться ни склада, ни лока, ни записи в
 * чужом манифесте.
 *
 * **В ключе кэша стоит АДРЕС СКЛАДА**, и это не украшение. Канон называет подмену
 * версии главной ловушкой двух складов (`kb:BASER3-9`): `0.3.0` из дев-склада и
 * `0.3.0` из релизного — разные поставки с одинаковым номером. Кэш, ключованный
 * одним номером, стал бы третьим местом, где они молча сливаются в одну.
 *
 * ── ВОПРОС «КАКАЯ ПОСЛЕДНЯЯ» — С ЧИСТЫМ БЛОКНОТОМ ───────────────────────────
 *
 * Кэш экономит СКАЧИВАНИЕ, а не вопрос: «какая последняя» — вопрос про
 * сегодняшний день, и ответить на него из вчерашней записи значит соврать.
 * Обещание было названо верно, а механика под ним его не держала
 * (`tasker:BASER2-161`): у пакетного менеджера свой HTTP-кэш ответов склада, и
 * при сетевой ошибке он отдаёт УСТАРЕВШУЮ запись вместо отказа — его собственный
 * лог из пойманного падения:
 *
 *     http fetch GET  http://…/пакет attempt 1 failed with ECONNREFUSED
 *     http fetch GET 200 http://…/пакет 13ms (cache stale)
 *
 * Это не догадка про менеджер, а его код: обновляя устаревшую запись, он ловит
 * сетевую ошибку и отдаёт лежащее, если у ответа склада не стояло
 * `must-revalidate` (`make-fetch-happen`, `lib/cache/entry.js`). Заголовок ставит
 * склад, а не мы, и режим «всегда переспрашивай» (`--prefer-online`) идёт по той
 * же ветке — замерено на живом 2026-08-04: погашенный склад отвечал версией и
 * с ним.
 *
 * Изоляцией кэша это не лечится. Проба свой кэш изолировала (`tasker:BASER2-156`)
 * и была права: у неё склад одноразовый. **Дверь работает на машине человека, и
 * его кэш трогать не вправе** — там он не мешает, а делает ровно то, что обещано.
 * Поэтому изолируется не кэш, а ВОПРОС: «какая последняя» задаётся с одноразовым
 * каталогом (`askToday`), где отвечать нечем по построению. Склад ответил —
 * ответ сегодняшний; склад молчит — названный отказ, а не вчерашнее число.
 *
 * Скачивание при этом остаётся на кэше человека (`#install`): там вопроса про
 * сегодняшний день нет — версия уже названа, а содержимое сходится по
 * контрольной сумме. Экономия обещана именно ему, и она не тронута.
 *
 * ── МЕТКА КАНАЛА — ТОТ ЖЕ ВОПРОС ПРО СЕГОДНЯ, ТОЛЬКО ДРУГИМИ СЛОВАМИ ────────
 *
 * Локация вправе сказать «дай последнее из дев-канала», не зная номера
 * (`kb:BASER3-26`, форма 5). Метка — УКАЗАТЕЛЬ, который двигается, и потому она
 * спрашивается у склада каждый прогон и отвечается только сегодняшним ответом:
 * тем же `askToday`, что и «какая последняя». Ответить на неё из вчерашней
 * записи значило бы соврать ровно так же — просто ложь была бы адресована тому,
 * кто как раз и просил движущийся указатель.
 *
 * Спрашивается при этом КАРТА МЕТОК целиком (`npm view <имя> dist-tags`), а не
 * «версия под меткой» (`npm view <имя>@<метка> version`). Стоит это одного и
 * того же запроса, а различает два разных состояния: склад, у которого нет
 * такого ПАКЕТА, отвечает `404`, а склад, у которого нет такой МЕТКИ, отвечает
 * картой без неё — и тогда отказ называет метки, которые у пакета есть.
 * Спросив сразу «версию под меткой», мы получили бы на оба случая один `404`
 * и отправили бы человека проверять имя пакета, с которым всё в порядке.
 *
 * **Паспорт укладки метку не держит и держать не может**: он фиксирует НОМЕР
 * (`run.ts`, `engineInput`) — метка сдвинется, и та же укладка дала бы другое
 * содержимое. По той же причине названная метка идёт МИМО записи паспорта: она
 * прямое слово человека «бери сегодняшнее из канала», а запись отвечает на
 * другой вопрос — «чем уже разложено». Приняв паспорт первым, дверь навсегда
 * заперла бы локацию на первой дев-сборке, которую та поставила, — то есть
 * ответила бы отказом на единственную просьбу, ради которой метка и написана.
 *
 * ── ЧТО ЗДЕСЬ НЕ РЕШАЕТСЯ ───────────────────────────────────────────────────
 *
 * Форма записи перечня — зона контрактов; здесь она только читается. Разбор
 * объявления обвеса — тоже: этот модуль отвечает на один вопрос, «где физически
 * лежит поставка, объявленная вот этой записью», и отдаёт корень пакета тем же
 * типом, каким его отдаёт резолв контрактов (`LocatedPackage`).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  locatePackage,
  type LocatedPackage,
} from '@omnifield/baser-contracts/locate';
import type { DoorProblem } from './problems.js';

/** Где лежит кэш поставок, если человек не сказал иначе. */
export const SUPPLY_CACHE_ENV = 'BASER_CACHE';

/** Имя каталога поставок внутри кэша: рядом могут появиться другие кэши двери. */
const SUPPLIES = 'supplies';

/**
 * ОДИН ЗАХОД НА СКЛАД, без своих повторов.
 *
 * Пакетный менеджер по умолчанию повторяет запрос с нарастающей паузой, и на
 * недоступном складе это МИНУТА молчания перед отказом. Молчащая команда
 * читается как зависание — человек убивает её раньше, чем увидит названную
 * причину, и уходит чинить не то. Повтор при этом не наша политика: сеть моргнула
 * — прогон повторяют, он для того и идемпотентен.
 *
 * Форма взята оттуда же, откуда и форма самого отказа: проверка доступа к складу
 * в постсоздании девбокса ходит ровно так же (`--fetch-retries=0`).
 */
const ONE_TRY: readonly string[] = ['--fetch-retries=0'];

/**
 * ОТКУДА ВЗЯЛАСЬ ПОСТАВКА — и почему именно эта версия.
 *
 * Не диагностика: человек обязан прочитать это ДО применения. «Взял последнюю»
 * молча — то же самое, что молча поднять дефолт: следующий прогон в другой день
 * даст другой результат, и объяснить его будет нечем.
 */
export type SupplyOrigin =
  /**
   * Названный каталог — дев-петля.
   *
   * У нас самих обвесы лежат в монорепе рядом, и путь к каталогу — законный
   * источник, а не обход. Доставать тут нечего: поставка уже здесь, поэтому
   * пакетный менеджер не зовётся вовсе.
   */
  | { readonly kind: 'local'; readonly path: string }
  /** Версия закреплена человеком в записи перечня (`sources[].version`). */
  | {
      readonly kind: 'pinned';
      readonly version: string;
      /**
       * Метка канала, названная В ТОЙ ЖЕ записи и проигравшая номеру.
       *
       * Поле есть только тогда, когда в записи стоят ОБА поля: номер бьёт метку
       * (`kb:BASER3-26`), и правило это ДВЕРИ — форма отдаёт оба целыми и молчит.
       * Молча выбрать один из двух ответов на «какую поставку брать» нельзя:
       * человек, написавший `channel: "dev"`, ждёт дев-сборку, а получает
       * закреплённый номер — и без этого поля узнаёт об этом только по
       * содержимому, если заметит.
       *
       * Отсутствие поля означает, что метки в записи не было вовсе, а не «была
       * и совпала»: совпадать здесь нечему — сравниваются не два номера, а
       * номер и указатель.
       */
      readonly beatsChannel?: string;
    }
  /**
   * Версия взята из ПАСПОРТА УКЛАДКИ — из того, чем этот артефакт уже разложен.
   *
   * Это и есть «воспроизводимость своим состоянием, а не чужим локом»: пока в
   * перечне версия не закреплена, повторный прогон обязан дать ту же поставку,
   * что и прошлый, а не догнать выпуск, случившийся между ними.
   */
  | { readonly kind: 'recorded'; readonly version: string }
  /**
   * Последняя доступная на складе — и НАЗВАННАЯ до применения.
   *
   * Состояние законное: перечень вправе версию не закреплять. Но молчать о том,
   * какую именно взяли, нельзя — поэтому версия попадает и в ответ, и в текст, и
   * закрепляется паспортом укладки следующим же применением.
   *
   * Это единственное состояние, про которое известно, что склад спрошен В ЭТОМ
   * ПРОГОНЕ: ответ на него берётся только у склада и только сегодня (`askToday`).
   */
  | { readonly kind: 'latest'; readonly version: string }
  /**
   * Версия взята ПО МЕТКЕ КАНАЛА — «дай последнее из дев-канала».
   *
   * Названы оба конца, и оба обязательны: метка — то, что человек написал в
   * перечне, номер — то, что за ней стоит СЕГОДНЯ. Одной меткой отчитаться
   * нельзя (завтра за ней встанет другая сборка, и объяснить разницу будет
   * нечем), одним номером — тоже: читатель ответа не отличил бы закреплённый
   * номер от взятого по указателю, то есть воспроизводимую укладку от
   * движущейся.
   *
   * Про склад известно то же, что и про `latest`: он спрошен В ЭТОМ ПРОГОНЕ, и
   * ответ на метку из кэша не берётся никогда (`askToday`).
   */
  | {
      readonly kind: 'channel';
      readonly channel: string;
      readonly version: string;
    };

/**
 * НАЗВАННЫЙ КАТАЛОГ ПОСТАВКИ — ручка дев-петли, поимённо на пакет.
 *
 * Не флаг «брать локальное»: обвесов в локации бывает несколько, и общий
 * переключатель означал бы, что про один из них соврали.
 */
export interface SupplyOverride {
  /** Имя пакета из записи перечня, к которой относится каталог. */
  readonly packageName: string;
  /** Каталог самого пакета — тот, где лежит его `package.json`. */
  readonly path: string;
}

/** Запись перечня глазами доставания: что достать и есть ли ручка дев-петли. */
export interface SupplyRequest {
  /** Имя пакета из записи перечня (`sources[].use`). */
  readonly packageName: string;
  /** Закреплённая версия из записи перечня; `null` — не закреплена. */
  readonly pinned: string | null;
  /**
   * Метка канала из записи перечня (`sources[].channel`); `null` — не названа.
   *
   * Приезжает РЯДОМ с закреплённой версией, а не вместо неё: форма разбирает
   * оба поля и отдаёт оба целыми, потому что «номер бьёт метку» — правило
   * двери, и сказать это вслух обязана она (`kb:BASER3-26`).
   */
  readonly channel: string | null;
  /** Названный каталог дев-петли; `null` — доставать со склада. */
  readonly local: string | null;
}

/**
 * Что дверь знает СНАРУЖИ этого модуля и без чего цепочка версии не считается.
 *
 * Оба вопроса упираются в чужие зоны — паспорт укладки принадлежит движку,
 * разбор объявления контрактам, — и повторять их здесь значило бы завести вторую
 * правду о чужом факте.
 */
export interface SupplyContext {
  /**
   * Версия, которой ЛИЧНОСТЬ обвеса уже разложена по паспорту укладки; `null` —
   * записи нет.
   */
  readonly recordedFor: (sourceId: string) => string | null;
  /**
   * Личность обвеса по корню его пакета; `null` — объявления нет или оно
   * непригодно (назовёт его разбор, а не этот вход).
   */
  readonly identityOf: (packageRoot: string) => string | null;
}

export interface SupplyOptions {
  /** Корень кэша поставок; по умолчанию — каталог пользователя. */
  readonly cache?: string;
  /** Окружение, из которого читаются адреса кэша. Подменяется пробой. */
  readonly env?: NodeJS.ProcessEnv;
}

/** Достанная поставка: пакет и рассказ о том, откуда он взялся. */
export interface Supply {
  /** Корень пакета и его манифест — той же формой, что отдаёт резолв контрактов. */
  readonly package: LocatedPackage;
  readonly origin: SupplyOrigin;
  /**
   * За этот прогон поставку СКАЧИВАЛИ — её не было в кэше поставок.
   *
   * `false` — она уже лежала в кэше, и скачивать не пришлось. Это ровно то, что
   * спрашивает приёмка: повторный прогон обязан брать из кэша.
   *
   * Полем «ходили ли на склад» это НЕ является, хотя раньше так и было написано
   * (`tasker:BASER2-161`). Незакреплённая версия спрашивает склад каждый прогон,
   * а скачивать при этом нечего — и ответ утверждал «на склад не ходили» ровно
   * там, где на него сходили. Двух фактов здесь не нужно: «ходили» читается по
   * `origin` — `latest` спрошен у склада всегда, `local` не спрашивает никогда,
   * закреплённая и записанная паспортом идут на склад тогда же, когда качают.
   */
  readonly fetched: boolean;
  /** Каталог кэша, где лежит поставка; `null` — дев-петля, кэш не при чём. */
  readonly cache: string | null;
}

/** Отказ доставания — данными, как и всё остальное у двери. */
export interface SupplyRefusal {
  readonly ok: false;
  readonly problems: readonly DoorProblem[];
}

export type SupplyResult = { readonly ok: true; readonly value: Supply } | SupplyRefusal;

/** Ответ на «какая версия» — версия либо тот же названный отказ. */
type VersionResult = { readonly ok: true; readonly value: string } | SupplyRefusal;

/**
 * Корень кэша поставок.
 *
 * Порядок ровно рыночный: своё имя (прогрев кэша в конвейере и проба), затем
 * `XDG_CACHE_HOME`, затем `~/.cache`. Ни один из трёх не лежит в рабочем дереве —
 * это и есть обещание «в локации не появляется ничего чужого».
 */
export function supplyCacheRoot(options: SupplyOptions = {}): string {
  const env = options.env ?? process.env;
  if (options.cache !== undefined && options.cache !== '') {
    return resolve(options.cache);
  }
  const named = env[SUPPLY_CACHE_ENV];
  if (named !== undefined && named !== '') {
    return resolve(named);
  }
  const xdg = env['XDG_CACHE_HOME'];
  if (xdg !== undefined && xdg !== '' && isAbsolute(xdg)) {
    return join(xdg, 'baser');
  }
  return join(homedir(), '.cache', 'baser');
}

/**
 * Достаёт поставку, объявленную одной записью перечня.
 *
 * Бросков наружу нет: недоступный склад — такой же названный отказ, как
 * непригодный конфиг. Падение с чужой ошибкой отправило бы человека читать
 * `npm error 404` про пакет, которого он не искал.
 */
export function takeSupply(
  request: SupplyRequest,
  context: SupplyContext,
  options: SupplyOptions = {},
): SupplyResult {
  if (request.local !== null) {
    return fromDirectory(request.packageName, request.local);
  }

  const store = new Store(request.packageName, options);

  // ── ТОЧНЫЙ НОМЕР БЬЁТ МЕТКУ КАНАЛА, и проигравшая метка едет в ответе.
  //
  // Оба поля в одной записи законны (`kb:BASER3-26`), и решает здесь дверь:
  // форма отдала оба целыми именно затем, чтобы выбор был НАЗВАН, а не сделан
  // молча. Номер выигрывает, потому что он адрес содержимого — под ним лежит
  // ровно одна сборка; метка же указатель, и человек, написавший рядом с ней
  // номер, сказал прямее.
  if (request.pinned !== null) {
    return store.ensure(request.pinned, (version) => ({
      kind: 'pinned',
      version,
      ...(request.channel === null ? {} : { beatsChannel: request.channel }),
    }));
  }

  // ── МЕТКА КАНАЛА — спрашивается у склада и только сегодня.
  //
  // Идёт ПЕРЕД паспортом укладки, а не после: метка это просьба «бери
  // сегодняшнее из канала», и запись паспорта, отвечающая на другой вопрос
  // («чем уже разложено»), заперла бы локацию на первой же дев-сборке —
  // то есть отменила бы ровно то, ради чего метку и написали. Воспроизводимость
  // от этого не страдает: кто её хочет, закрепляет номер, и номер бьёт метку.
  if (request.channel !== null) {
    const channel = request.channel;
    const named = store.channelVersion(channel);
    if (!named.ok) {
      return named;
    }
    return store.ensure(named.value, (version) => ({
      kind: 'channel',
      channel,
      version,
    }));
  }

  // ── Версия не закреплена и метки нет. Первым спрашивается ПАСПОРТ УКЛАДКИ.
  //
  // Спросить его по имени пакета нельзя: паспорт индексирован ЛИЧНОСТЬЮ обвеса, а
  // перечень называет ПАКЕТ, и связи между ними в локации нет — она живёт в
  // объявлении, то есть внутри самой поставки. Круг размыкается кэшем: лежащая
  // поставка своё объявление уже несёт, и по ней личность узнаётся без единого
  // запроса на склад.
  const recorded = store.recordedVersion(context);
  if (recorded !== null) {
    return store.ensure(recorded, (version) => ({ kind: 'recorded', version }));
  }

  // Кэш пуст либо ни одна лежащая поставка в паспорте не числится — спрашиваем
  // склад. Взятая версия называется в плане ДО применения: «последняя» молча
  // означала бы, что завтрашний прогон разложит другое и объяснить это будет
  // нечем.
  const latest = store.latestVersion();
  if (!latest.ok) {
    return latest;
  }

  const taken = store.ensure(latest.value, (version) => ({
    kind: 'latest',
    version,
  }));
  if (!taken.ok) {
    return taken;
  }

  // Второй проход по паспорту — на холодном кэше личность становится известна
  // только сейчас. Запись есть и она про другую версию — значит воспроизводимость
  // требует именно её: закреплённого в перечне слова тут нет, а своё состояние
  // есть, и оно старше сегодняшнего выпуска.
  const identity = context.identityOf(taken.value.package.root);
  const pinnedByManifest =
    identity === null ? null : context.recordedFor(identity);
  if (pinnedByManifest === null || pinnedByManifest === latest.value) {
    return taken;
  }
  return store.ensure(pinnedByManifest, (version) => ({
    kind: 'recorded',
    version,
  }));
}

/**
 * Поставка из НАЗВАННОГО КАТАЛОГА — дев-петля.
 *
 * Пакетный менеджер здесь не зовётся: доставать нечего, поставка уже лежит. Это
 * не второй флоу доставания, а его отсутствие — ровно поэтому каталог обязан быть
 * НАЗВАН человеком, а не найден дверью самой. Дверь, подхватывающая случайно
 * подвернувшийся каталог, вернула бы нас к «поставку кладёт кто-то другой».
 */
function fromDirectory(packageName: string, path: string): SupplyResult {
  const root = resolve(path);
  if (!existsSync(join(root, 'package.json'))) {
    return refuse(
      'supply-local-missing',
      root,
      `дев-петля: каталог поставки "${packageName}" назван, но манифеста в нём нет ` +
        `(${join(root, 'package.json')}). Назови каталог самого пакета — тот, где ` +
        'лежит его package.json',
    );
  }

  const manifest = readManifestOf(root);
  if (manifest === null) {
    return refuse(
      'package-manifest-unreadable',
      join(root, 'package.json'),
      `манифест поставки "${packageName}" не разбирается как JSON`,
    );
  }

  return {
    ok: true,
    value: {
      package: {
        packageName,
        version: versionOf(manifest),
        root,
        manifest,
      },
      origin: { kind: 'local', path: root },
      fetched: false,
      cache: null,
    },
  };
}

/**
 * СКЛАД И КЭШ ОДНОГО ПАКЕТА — всё, что требует знания адреса склада.
 *
 * Адрес спрашивается у `npm` и запоминается на объект: он нужен и ключу кэша, и
 * тексту отказа, а спрашивать его дважды значило бы платить запуском процесса за
 * один и тот же ответ.
 */
class Store {
  readonly #packageName: string;
  readonly #cacheRoot: string;
  #registry: string | null = null;

  constructor(packageName: string, options: SupplyOptions) {
    this.#packageName = packageName;
    this.#cacheRoot = join(supplyCacheRoot(options), SUPPLIES);
  }

  /** Адрес склада, по которому пойдёт менеджер за ЭТИМ пакетом. */
  registry(): string {
    if (this.#registry !== null) {
      return this.#registry;
    }
    // Скоуп бьёт общий адрес, и это не тонкость: у нас `@omnifield` пришпилен к
    // закрытому складу, а общий адрес при этом публичный. Отказ, назвавший общий,
    // отправил бы человека настраивать не тот адрес.
    const scope = this.#packageName.startsWith('@')
      ? this.#packageName.split('/')[0]
      : null;
    const scoped = scope === null ? null : npmConfig(`${scope}:registry`);
    this.#registry = scoped ?? npmConfig('registry') ?? 'не настроен';
    return this.#registry;
  }

  /** Каталог кэша под конкретную версию: адрес склада, имя пакета, версия. */
  #dir(version: string): string {
    return join(
      this.#cacheRoot,
      hostOf(this.registry()),
      ...this.#packageName.split('/'),
      version,
    );
  }

  /**
   * Версия, которой личность этой поставки числится в паспорте укладки.
   *
   * Смотрит ТОЛЬКО в кэш и ни разу не ходит на склад: вопрос «чем мы это уже
   * разложили» обязан отвечаться в оффлайне — иначе повторный прогон без сети
   * упирался бы в склад ровно там, где ничего доставать не надо.
   */
  recordedVersion(context: SupplyContext): string | null {
    for (const version of this.#cached()) {
      const root = this.#rootIn(this.#dir(version));
      if (root === null) {
        continue;
      }
      const identity = context.identityOf(root);
      if (identity === null) {
        continue;
      }
      const recorded = context.recordedFor(identity);
      if (recorded !== null) {
        return recorded;
      }
    }
    return null;
  }

  /** Версии этого пакета, уже лежащие в кэше, — новые впереди. */
  #cached(): readonly string[] {
    const box = join(this.#cacheRoot, hostOf(this.registry()));
    const home = join(box, ...this.#packageName.split('/'));
    if (!existsSync(home)) {
      return [];
    }
    try {
      return readdirSync(home, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(byVersionDesc);
    } catch {
      return [];
    }
  }

  /** Корень пакета внутри каталога кэша; `null` — поставки там нет. */
  #rootIn(dir: string): string | null {
    const root = join(dir, 'node_modules', ...this.#packageName.split('/'));
    return existsSync(join(root, 'package.json')) ? root : null;
  }

  /**
   * Последняя доступная версия — спрашивается у СКЛАДА и СЕГОДНЯ.
   *
   * Не «спрашивается у менеджера»: у того есть память о вчерашнем ответе, и
   * отдать её он готов даже с погашенным складом. Поэтому вопрос идёт с чистым
   * блокнотом (`askToday`) — см. шапку модуля.
   */
  latestVersion(): VersionResult {
    const asked = askToday([
      'view',
      this.#packageName,
      'version',
      '--json',
      ...ONE_TRY,
    ]);
    if (!asked.ok) {
      return this.#refuseFetch(asked, null);
    }
    try {
      const value: unknown = JSON.parse(asked.stdout);
      // Несколько версий приезжают массивом — берём последнюю названную: у `npm
      // view` порядок версий возрастающий, и «последняя» здесь буквальная.
      const version = Array.isArray(value)
        ? value[value.length - 1]
        : (value as unknown);
      if (typeof version === 'string' && version !== '') {
        return { ok: true, value: version };
      }
    } catch {
      // Разбор сорвался — ниже общий отказ: он назовёт и склад, и то, что пришло.
    }
    return refuse(
      'supply-fetch-failed',
      this.#packageName,
      `склад ${this.registry()} не назвал последнюю версию "${this.#packageName}": ` +
        `в ответ пришло "${asked.stdout.trim().slice(0, 200)}". ` +
        `Проверить руками: npm view ${this.#packageName} version`,
    );
  }

  /**
   * За какой версией стоит МЕТКА КАНАЛА — спрашивается у склада и СЕГОДНЯ.
   *
   * Тот же одноразовый блокнот, что и у «какая последняя» (`askToday`), и по
   * той же причине: метка это указатель, который двигается, и вчерашняя запись
   * о нём — вчерашний ответ.
   *
   * Спрашивается КАРТА МЕТОК целиком, а не версия под одной. Стоит это того же
   * одного запроса, а различает два состояния, которые иначе слиплись бы в
   * общий `404`: «такого пакета на складе нет» и «пакет есть, а метки у него
   * нет». Второе чинится в перечне либо выпуском, первое — именем пакета или
   * адресом склада, и отказ обязан вести в разные места.
   */
  channelVersion(channel: string): VersionResult {
    const asked = askToday([
      'view',
      this.#packageName,
      'dist-tags',
      '--json',
      ...ONE_TRY,
    ]);
    if (!asked.ok) {
      return this.#refuseFetch(asked, null, channel);
    }

    const tags = readTags(asked.stdout);
    if (tags === null) {
      return refuse(
        'supply-fetch-failed',
        this.#packageName,
        `склад ${this.registry()} не назвал меток "${this.#packageName}": ` +
          `в ответ пришло "${asked.stdout.trim().slice(0, 200)}". ` +
          `Проверить руками: npm view ${this.#packageName} dist-tags`,
      );
    }

    const version = tags.get(channel);
    if (version !== undefined) {
      return { ok: true, value: version };
    }

    // НЕИЗВЕСТНАЯ МЕТКА — отказ с названной причиной, а не тихий откат на
    // стабильную (`kb:BASER3-26`). Откат выглядел бы как рабочий прогон и
    // разложил бы локацию не тем, что у неё написано: человек просил дев-канал,
    // получил бы релиз и узнал бы об этом по последствиям.
    const known = [...tags.keys()];
    return refuse(
      'supply-channel-unknown',
      `${this.#packageName}@${channel}`,
      `склад ${this.registry()} знает пакет "${this.#packageName}", а метки ` +
        `"${channel}" у него нет. ` +
        (known.length === 0
          ? 'Меток у пакета нет ни одной — брать по метке нечего, пока в этот ' +
            'канал не выпустили. '
          : `Есть: ${known.map((name) => `${name} → ${tags.get(name) ?? ''}`).join(' · ')}. `) +
        'Либо метка в перечне не та (channel в baser.json), либо в этот канал ' +
        'ещё не выпускали — тогда возьми номер полем "version". ' +
        `Проверить руками: npm view ${this.#packageName} dist-tags --registry=${this.registry()}`,
    );
  }

  /** Кладёт версию в кэш, если её там ещё нет, и отдаёт поставку. */
  ensure(
    version: string,
    origin: (version: string) => SupplyOrigin,
  ): SupplyResult {
    const dir = this.#dir(version);
    if (this.#rootIn(dir) !== null) {
      return this.#supply(dir, origin(version), false);
    }

    const put = this.#install(version, dir);
    if (put !== null) {
      return put;
    }

    if (this.#rootIn(dir) === null) {
      return refuse(
        'supply-fetch-failed',
        dir,
        `пакетный менеджер отчитался об установке "${this.#packageName}@${version}", ` +
          'а поставки в кэше нет. Кэш можно снести целиком — он весь пересобираемый',
      );
    }
    return this.#supply(dir, origin(version), true);
  }

  /**
   * Установка в кэш — через СОСЕДНИЙ каталог и переименование.
   *
   * Двери запускают из хука, из конвейера и руками, и два прогона на одну машину
   * — обычное дело. Ставь мы прямо в конечный каталог, оборванная посередине
   * установка оставила бы кэш, который выглядит готовым: следующий прогон принял
   * бы половину поставки за целую и упёрся бы в отсутствующий файл где-то в
   * шаблоне.
   */
  #install(version: string, dir: string): SupplyRefusal | null {
    mkdirSync(dirname(dir), { recursive: true });
    const staging = mkdtempSync(`${dir}.`);
    try {
      writeFileSync(
        join(staging, 'package.json'),
        `${JSON.stringify(
          {
            name: 'baser-supplies',
            private: true,
            version: '0.0.0',
            description:
              'кэш поставок baser: каталог создан дверью, правят его не руками',
          },
          null,
          2,
        )}\n`,
        'utf-8',
      );

      const done = npm([
        'install',
        `${this.#packageName}@${version}`,
        '--prefix',
        staging,
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--json',
        ...ONE_TRY,
      ]);
      if (!done.ok) {
        return this.#refuseFetch(done, version);
      }

      try {
        renameSync(staging, dir);
      } catch {
        // Каталог занял соседний прогон, положивший ту же версию, — это не отказ:
        // поставка одна и та же, и переигрывать её незачем.
        if (this.#rootIn(dir) === null) {
          throw new Error(`кэш поставки не переехал в ${dir}`);
        }
      }
      return null;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  #supply(dir: string, origin: SupplyOrigin, fetched: boolean): SupplyResult {
    // Резолв по имени зовётся тот же, что и везде (`tasker:BASER2-128`: экземпляр
    // резолва в продукте один): каталог кэша — обычный корень с `node_modules`, и
    // своя навигация по нему была бы второй правдой о том, где лежит пакет.
    const located = locatePackage(this.#packageName, dir);
    if (!located.ok) {
      return { ok: false, problems: located.problems };
    }
    return {
      ok: true,
      value: { package: located.value, origin, fetched, cache: dir },
    };
  }

  /**
   * ОТКАЗ ДОСТАВАНИЯ — адрес склада, чего не хватает, что сделать.
   *
   * Форма взята с постсоздания девбокса, где она уже прожита на живом: без неё
   * `npm` отвечает «404, пакета нет», и человек идёт искать несуществующий пакет
   * вместо своих кредов — стена без указателя. Разные коды здесь потому, что
   * чинятся случаи по-разному, а не ради дробности.
   */
  #refuseFetch(
    failed: NpmFailure,
    version: string | null,
    channel: string | null = null,
  ): SupplyRefusal {
    const what = `${this.#packageName}${version === null ? '' : `@${version}`}`;
    const registry = this.registry();
    const host = hostOf(registry);

    // ВОПРОС, НА КОТОРОМ СОРВАЛОСЬ, — своими словами, а не «версия не названа».
    // Их два, и человеку они говорят разное: «какая последняя» снимается
    // закреплением номера, «за какой версией метка» — ещё и правкой метки.
    // Названный вопрос отличает их прямо в тексте отказа, а не оставляет
    // читателя выводить его из того, что стоит в перечне.
    const question =
      channel === null
        ? `«какая последняя версия "${this.#packageName}"»`
        : `«за какой версией стоит метка "${channel}" у "${this.#packageName}"»`;
    const byHand =
      channel === null
        ? `npm view ${this.#packageName} version`
        : `npm view ${this.#packageName} dist-tags`;

    if (failed.reason === 'missing-manager') {
      return refuse(
        'package-manager-missing',
        'npm',
        `поставку "${what}" достаёт дверь, и достаёт она тем же пакетным менеджером — ` +
          'а `npm` в этой среде не нашёлся. Дверь ставится в среду один раз, вместе ' +
          'с ним: чинится это установкой среды, а не правкой локации. Дев-петля при ' +
          'этом работает и без склада — назови каталог поставки: --source ' +
          `${this.#packageName}=<путь к каталогу>`,
      );
    }

    if (failed.reason === 'no-notebook') {
      return refuse(
        'supply-fetch-failed',
        tmpdir(),
        `вопрос ${question} задаётся с одноразовым ` +
          'каталогом менеджера — иначе на него ответит вчерашняя запись из кэша, ' +
          `и склад окажется не спрошен. Завести каталог в ${tmpdir()} не вышло: ` +
          `${failed.summary}. Закреплённая версия при этом работает и так — ` +
          'sources[].version в baser.json спрашивает не сегодняшний день, а склад',
      );
    }

    if (failed.code === 'E404') {
      return refuse(
        'supply-not-published',
        what,
        `склад ${registry} отвечает, что поставки "${what}" у него нет. ` +
          'Либо имя в перечне не то, либо такой версии не выпускали, либо это ' +
          'ЧУЖОЙ склад — у скоупа свой адрес, и он бьёт общий. ' +
          `Проверить руками: npm view ${this.#packageName} versions --registry=${registry}`,
      );
    }

    // МЕНЕДЖЕР НАСТРОЕН НЕ ХОДИТЬ НА СКЛАД (`offline`) — состояние, которое
    // раньше было невидимым: вопрос «какая последняя» отвечался из кэша, и
    // настройка молча меняла ответ двери. Теперь вопрос идёт мимо кэша, значит
    // отказ обязан назвать не «склад не ответил», а то, что случилось на самом
    // деле, — иначе человек пойдёт чинить связь, которой не касался.
    if (failed.code === 'ENOTCACHED') {
      return refuse(
        'supply-unreachable',
        what,
        version === null
          ? `пакетный менеджер на этой машине настроен НЕ ХОДИТЬ на склад (offline), ` +
            `а ${question} — вопрос про сегодняшний ` +
            'день, и из кэша дверь на него не отвечает. Выходов два: закрепить версию ' +
            '(sources[].version в baser.json) — тогда склад не нужен вовсе, поставка ' +
            `возьмётся из кэша, — либо снять offline: npm config get offline`
          : `пакетный менеджер настроен НЕ ХОДИТЬ на склад (offline), а поставки ` +
            `"${what}" в его кэше нет — достать её нечем. Либо снять offline ` +
            '(npm config get offline), либо прогреть кэш прогоном со связью',
      );
    }

    if (failed.code === 'E401' || failed.code === 'E403') {
      return refuse(
        'supply-unreachable',
        what,
        `склад ${registry} есть, а доступа к нему нет: токен не положен или протух. ` +
          `Поставка: ${what}.\n` +
          `  проверка руками: npm whoami --registry=${registry}\n` +
          `  положить токен:  npm config set //${host}/:_authToken <токен> --location=user`,
      );
    }

    // Вопрос называется там, где он БЫЛ, — то есть когда версия ещё не выбрана.
    // «Склад не ответил» без вопроса одинаково выглядит и на «какая последняя»,
    // и на «за какой версией метка», а чинятся они по-разному: второе снимается
    // ещё и правкой метки в перечне.
    const failedAt =
      version === null
        ? `склад ${registry} не ответил на вопрос ${question} — поставку ` +
          `"${what}" взять нечем`
        : `склад ${registry} не ответил — поставку "${what}" достать нечем`;

    return refuse(
      'supply-unreachable',
      what,
      `${failedAt} ` + `(${failed.code ?? 'без кода'}: ${failed.summary}).\n` +
        `  проверка руками: ${byHand} --registry=${registry}\n` +
        '  кэш поставок при этом переживает пересоздание среды: прогретый прогон ' +
        'на склад не ходит вовсе',
    );
  }
}

/** Что случилось с вызовом менеджера. Разбирается по его же коду, не по тексту. */
interface NpmFailure {
  readonly ok: false;
  readonly reason: 'missing-manager' | 'no-notebook' | 'failed';
  readonly code: string | null;
  readonly summary: string;
}

type NpmResult = { readonly ok: true; readonly stdout: string } | NpmFailure;

/**
 * Вызов пакетного менеджера.
 *
 * `--json` просится у самого менеджера: он кладёт в поток разбираемый отказ с
 * КОДОМ (`E404`, `ECONNREFUSED`, `E401`), а код — публичный контракт, в отличие
 * от текста, который меняют от выпуска к выпуску. Ветвиться по тексту чужой
 * ошибки значит переписывать ветвление каждый раз, когда сосед поправит
 * формулировку.
 */
function npm(args: readonly string[]): NpmResult {
  try {
    const stdout = execFileSync('npm', [...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout };
  } catch (cause) {
    const failure = cause as {
      code?: unknown;
      stdout?: string | null;
      stderr?: string | null;
      message?: string;
    };
    if (failure.code === 'ENOENT') {
      return {
        ok: false,
        reason: 'missing-manager',
        code: null,
        summary: 'npm не найден',
      };
    }
    const said = describeNpmError(failure.stdout ?? '');
    return {
      ok: false,
      reason: 'failed',
      code: said.code,
      summary:
        said.summary ??
        firstLine(failure.stderr ?? '') ??
        (failure.message ?? 'отказ без объяснения'),
    };
  }
}

/**
 * ВОПРОС, НА КОТОРЫЙ ОТВЕЧАЕТ ТОЛЬКО СКЛАД, — с одноразовым блокнотом менеджера.
 *
 * Своего кэша у менеджера на время этого вызова нет: каталог пустой, живёт
 * ровно один вопрос и уезжает вместе с ответом. Значит вчерашней записи, которую
 * можно выдать за сегодняшний ответ, физически не существует — не «маловероятно»,
 * а по построению, как и у изоляции склада пробы (`tasker:BASER2-156`).
 *
 * Каталог — временный, а не наш кэш поставок, и это не мелочь: место, которое
 * ОБЯЗАНО быть пустым, не должно называться кэшем и лежать рядом с тем, что
 * обязано переживать пересоздание среды. Оборванный прогон оставит его системе,
 * которая временные каталоги и убирает.
 *
 * Платится за это одним скачиванием описи пакета вместо условного запроса — той
 * самой ценой, которую README назвал вслух: незакреплённая версия спрашивает
 * склад каждый прогон. Скачивание САМОЙ поставки идёт кэшем человека и этим не
 * тронуто.
 */
function askToday(args: readonly string[]): NpmResult {
  let notebook: string;
  try {
    notebook = mkdtempSync(join(tmpdir(), 'baser-ask-'));
  } catch (cause) {
    return {
      ok: false,
      reason: 'no-notebook',
      code: null,
      summary: cause instanceof Error ? cause.message : String(cause),
    };
  }
  try {
    return npm([...args, `--cache=${notebook}`]);
  } finally {
    rmSync(notebook, { recursive: true, force: true });
  }
}

/**
 * КАРТА МЕТОК СКЛАДА: метка → номер. `null` — ответ картой меток не является.
 *
 * Пустая карта от неразобранного ответа отличается намеренно: у пакета
 * действительно может не быть ни одной метки, и это не сбой склада, а состояние
 * — отказ на нём говорит «брать по метке нечего», а не «склад ответил мусором».
 *
 * Нестроковые значения выкидываются молча: карта меток — плоский словарь строк,
 * и всё, что им не является, для нас не метка. Спорить с формой чужого ответа
 * тут нечем, а свалиться на ней — значит потерять и годные метки рядом.
 */
function readTags(stdout: string): Map<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const tags = new Map<string, string>();
  for (const [name, version] of Object.entries(parsed)) {
    if (typeof version === 'string' && version !== '') {
      tags.set(name, version);
    }
  }
  return tags;
}

/** Разбор `--json`-отказа менеджера: код и краткое объяснение, как он их назвал. */
function describeNpmError(stdout: string): {
  code: string | null;
  summary: string | null;
} {
  try {
    const parsed = JSON.parse(stdout) as {
      error?: { code?: unknown; summary?: unknown };
    };
    const error = parsed.error;
    if (error !== undefined && error !== null) {
      return {
        code: typeof error.code === 'string' ? error.code : null,
        summary: typeof error.summary === 'string' ? error.summary : null,
      };
    }
  } catch {
    // Не JSON — значит менеджер сорвался раньше, чем начал отвечать формой.
  }
  return { code: null, summary: null };
}

/** Значение настройки менеджера; `null` — не задано. */
function npmConfig(key: string): string | null {
  const asked = npm(['config', 'get', key]);
  if (!asked.ok) {
    return null;
  }
  const value = asked.stdout.trim();
  return value === '' || value === 'undefined' || value === 'null'
    ? null
    : value;
}

function hostOf(registry: string): string {
  const withoutScheme = registry.replace(/^[a-z]+:\/\//i, '');
  const host = withoutScheme.split('/')[0];
  return host === '' ? 'без-адреса' : host.replace(/:/g, '_');
}

function firstLine(text: string): string | null {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item !== '');
  return line ?? null;
}

/**
 * Старшая из названных версий; `null` — не названо ни одной.
 *
 * Живёт здесь, а не у вызывающего, ровно потому, что порядок версий один на
 * зону: паспорт укладки и кэш обязаны отвечать «которая новее» одинаково.
 */
export function newestVersion(versions: readonly string[]): string | null {
  const sorted = [...versions].sort(byVersionDesc);
  return sorted[0] ?? null;
}

/**
 * Порядок версий в кэше — по числам, а не по строкам.
 *
 * Строковое сравнение поставило бы `0.10.0` перед `0.9.0`, и поиск записи
 * паспорта начинался бы не с той поставки. Полного semver здесь не нужно: сравним
 * то, что сравнимо, остальное уходит в конец списка.
 */
function byVersionDesc(left: string, right: string): number {
  const parts = (value: string): number[] =>
    value.split(/[.\-+]/).map((item) => Number.parseInt(item, 10));
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = Number.isNaN(a[i]) || a[i] === undefined ? -1 : a[i];
    const y = Number.isNaN(b[i]) || b[i] === undefined ? -1 : b[i];
    if (x !== y) {
      return y - x;
    }
  }
  return 0;
}

function refuse(
  code: DoorProblem['code'],
  at: string,
  message: string,
): SupplyRefusal {
  return { ok: false, problems: [{ code, at, message }] };
}

/** Манифест лежащего пакета; `null` — файла нет или он не разбирается. */
function readManifestOf(root: string): unknown {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function versionOf(manifest: unknown): string | null {
  const head = manifest as { version?: unknown };
  return typeof head.version === 'string' && head.version.trim() !== ''
    ? head.version
    : null;
}
