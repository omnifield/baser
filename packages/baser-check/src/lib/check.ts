/**
 * «ОБВЕС ПОДХОДИТ ПОСАДОЧНОМУ МЕСТУ — ДА ИЛИ НЕТ, И ЕСЛИ НЕТ, ТО ПОЧЕМУ».
 *
 * Одна входная точка над каталогом распакованного обвеса. Ничего не производит,
 * ничего не пишет, ничего не исполняет: читает манифест, зовёт форму и сверяет
 * объявленное с тем, что физически лежит и что уедет потребителю.
 *
 * ## Вход — КАТАЛОГ, а не имя пакета
 *
 * Имя пакета требует резолва, то есть уже установленной поставки в чьём-то
 * дереве. Каталог не требует ничего: одна и та же проверка годится для пакета
 * монорепы, для распакованного тарбола и для чужого обвеса, принесённого
 * руками (`kb:BASER2-7`). Резолв по имени — работа двери, у которой есть
 * репозиторий потребителя; здесь его нет и быть не должно.
 *
 * ## Что зовётся, а не переписывается
 *
 * Разбор объявления (`readSourceDeclaration`) и язык подстановки
 * (`checkTemplate`) живут в контрактах и остаются там. Отсюда бесплатно
 * приезжают версия формы, незнакомые поля, дефолты настроек и столкновение
 * `dest` внутри объявления: инвариант, который держит только соседняя зона, —
 * не инвариант, а второй разбор рядом с первым однажды с ним разойдётся.
 *
 * Своего здесь ровно то, чего у формы нет и быть не может, потому что она
 * ничего не читает с диска:
 *
 * - манифест как файл: каталог, `package.json`, имя пакета;
 * - `contentRoot` и каждый `src` реально лежат в поставке;
 * - модуль вычисляемого дефолта лежит в ПАКЕТЕ, а не в каталоге разработчика;
 * - белый список `files` увезёт всё это к потребителю (`shipping.ts`);
 * - содержимое рендеримых шаблонов — прочитать и подать форме.
 *
 * ## Глубоких проверок здесь НЕТ
 *
 * Мультиметр, а не тестовый сокет (`kb:BASER2-9`): проверяется форма и
 * поставка, то есть ВСТАЁТ ЛИ ОБВЕС. «Разумен ли этот devcontainer» — вопрос
 * не этой зоны и не этого уровня инструментов.
 *
 * Резолвер вычисляемого дефолта тоже не зовётся: его вызов — исполнение чужого
 * кода, акт доверия, который совершает дверь при установке
 * (`packages/baser-contracts/README.md` §3). Проверка отвечает за то, что
 * модуль найдётся и уедет, а не за то, что он вернёт.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  checkTemplate,
  FORM_VERSION,
  readSourceDeclaration,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';

import { CheckProblemLog } from './problems.js';
import {
  CHECK_SCHEMA_VERSION,
  type CheckReport,
  type CheckSpan,
  type CheckStage,
  type CheckStageName,
} from './report.js';
import { readShippingList, shipsPath, type ShippingList } from './shipping.js';

export interface CheckOptions {
  /** Источник времени для трейсов; подменяется в тестах ради детерминизма. */
  readonly now?: () => number;
}

/** Имя манифеста пакета. Адрес отказов формы строится от него же. */
const MANIFEST = 'package.json';

/** Настройка с вычисляемым дефолтом: чья она и в каком модуле лежит. */
interface ResolverModule {
  readonly setting: string;
  readonly module: string;
}

/**
 * Проверяет каталог распакованного обвеса.
 *
 * Отказы копятся и отдаются СПИСКОМ: три беды в обвесе — три строки, а не три
 * прогона. Слои идут сверху вниз, и следующий пропускается, только когда
 * сверять уже физически нечем: не разобравшееся объявление не говорит, какие
 * файлы искать. Пропуск при этом назван в `stages`, а не выдан за чистый слой.
 */
export function checkPackage(
  root: string,
  options: CheckOptions = {},
): CheckReport {
  const now = options.now ?? (() => performance.now());
  const log = new CheckProblemLog();
  const stages: CheckStage[] = [];
  const trace: CheckSpan[] = [];
  const absolute = resolve(root);

  /** Замер слоя и его строка в `stages` — одним местом, чтобы не разъехались. */
  const stage = <T>(
    name: CheckStageName,
    run: () => T,
    counted: (value: T) => number,
  ): T => {
    const before = log.list().length;
    const started = now();
    const value = run();
    trace.push({ name, ms: now() - started });
    stages.push({
      name,
      status: log.list().length > before ? 'failed' : 'ok',
      counted: counted(value),
    });
    return value;
  };

  const skip = (name: CheckStageName, reason: string): void => {
    stages.push({ name, status: 'skipped', counted: 0, reason });
  };

  const report = (
    manifest: unknown,
    declaration: SourceDeclaration | null,
    shipping: ShippingList,
  ): CheckReport => ({
    checkSchemaVersion: CHECK_SCHEMA_VERSION,
    formVersion: FORM_VERSION,
    ok: log.empty,
    root: absolute,
    packageName: stringField(manifest, 'name'),
    packageVersion: stringField(manifest, 'version'),
    declaration,
    shipping,
    stages,
    problems: log.list(),
    trace,
  });

  // ── Слой 1. Манифест как файл.
  const manifest = stage(
    'manifest',
    () => readManifest(absolute, log),
    () => 1,
  );

  if (manifest === null) {
    const reason = 'манифест не прочитан — разбирать нечего';
    skip('declaration', reason);
    skip('content', reason);
    skip('shipping', reason);
    skip('templates', reason);
    return report(null, null, { kind: 'not-declared' });
  }

  // ── Слой 2. Форма объявления: разбор целиком зовём у контрактов.
  const declaration = stage(
    'declaration',
    () => {
      const parsed = readSourceDeclaration(manifest, MANIFEST);
      if (parsed.ok) {
        return parsed.value;
      }
      log.addAll(parsed.problems);
      return null;
    },
    () => 1,
  );

  if (declaration === null) {
    // Слои ниже пропускаются не «на первом отказе», а потому, что непригодное
    // объявление не говорит, какие файлы искать и какие шаблоны читать. Сам
    // разбор при этом отдал ВСЕ свои отказы разом — список формы не оборван.
    const reason = 'объявление непригодно — неизвестно, что искать в поставке';
    skip('content', reason);
    skip('shipping', reason);
    skip('templates', reason);
    return report(manifest, null, { kind: 'not-declared' });
  }

  const resolvers = resolverModules(declaration);

  // ── Слой 3. Объявленное лежит на диске.
  const present = stage(
    'content',
    () => checkContent(absolute, declaration, resolvers, log),
    () => 1 + declaration.layout.length + resolvers.length,
  );

  // ── Слой 4. Объявленное уедет потребителю.
  const shipping = readShippingList(manifest);
  if (shipping.kind === 'declared') {
    stage(
      'shipping',
      () => checkShipping(shipping, declaration, resolvers, log),
      (judged) => judged,
    );
  } else {
    skip(
      'shipping',
      shipping.kind === 'not-declared'
        ? 'манифест не объявил "files": состав поставки определяют .npmignore и правила npm, ' +
            'и выдумывать его за них проверка не станет'
        : shipping.reason,
    );
  }

  // ── Слой 5. Язык подстановки: содержимое читаем мы, судит форма.
  const renderable = declaration.layout.filter((entry) => entry.render);
  if (renderable.length === 0) {
    skip(
      'templates',
      'рендеримых записей в раскладке нет — язык подстановки мерить не на чем',
    );
  } else {
    stage(
      'templates',
      () =>
        checkTemplates(
          absolute,
          declaration.source.contentRoot,
          renderable,
          present,
          log,
        ),
      (checked) => checked,
    );
  }

  return report(manifest, declaration, shipping);
}

/** Читает `package.json` каталога. `null` — читать нечего, причина названа. */
function readManifest(absolute: string, log: CheckProblemLog): unknown {
  if (!isDirectory(absolute)) {
    log.add(
      'root-missing',
      absolute,
      `каталога обвеса нет: "${absolute}". Проверке подаётся каталог РАСПАКОВАННОГО обвеса — ` +
        'пакет монорепы, распакованный тарбол, принесённый руками обвес, — а не имя пакета',
    );
    return null;
  }

  const path = join(absolute, MANIFEST);
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    log.add(
      'manifest-missing',
      MANIFEST,
      `в каталоге нет "${MANIFEST}" — это не пакет, и объявиться обвесом ему негде`,
    );
    return null;
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (cause) {
    log.add(
      'manifest-unreadable',
      MANIFEST,
      `"${path}" не разбирается как JSON: ${describe(cause)}`,
    );
    return null;
  }

  const name = stringField(manifest, 'name');
  if (name === null) {
    log.add(
      'package-name-missing',
      `${MANIFEST}.name`,
      'у пакета нет имени — потребитель называет обвес именно им ("use" в его конфиге), ' +
        'а безымянную поставку не поставить',
    );
  }

  return manifest;
}

/**
 * Сверяет объявленное с тем, что лежит в каталоге.
 *
 * Возвращает пути шаблонов, которые НАШЛИСЬ: слою языка подстановки читать
 * нечего там, где файла нет, а второй отказ про то же отсутствие заставил бы
 * чинить одну беду по двум строкам.
 */
function checkContent(
  absolute: string,
  declaration: SourceDeclaration,
  resolvers: readonly ResolverModule[],
  log: CheckProblemLog,
): ReadonlySet<string> {
  const contentRoot = declaration.source.contentRoot;
  const present = new Set<string>();

  const contentRootPresent = isDirectory(join(absolute, contentRoot));
  if (!contentRootPresent) {
    log.add(
      'content-root-missing',
      `${MANIFEST}.baser.source.contentRoot`,
      `обвес объявил корень содержимого "${contentRoot}", но такого каталога в поставке нет — ` +
        'раскладывать потребителю нечего',
    );
  }

  declaration.layout.forEach((entry, index) => {
    const inside = `${contentRoot}/${entry.src}`;
    if (isFile(join(absolute, inside))) {
      present.add(inside);
      return;
    }
    log.add(
      'content-missing',
      `${MANIFEST}.baser.layout[${index}].src`,
      contentRootPresent
        ? `раскладка кладёт "${entry.dest}" из "${inside}", но такого файла в поставке нет`
        : `раскладка кладёт "${entry.dest}" из "${inside}" — файла нет вслед за корнем содержимого`,
    );
  });

  for (const resolver of resolvers) {
    if (isFile(join(absolute, resolver.module))) {
      continue;
    }
    log.add(
      'resolver-missing',
      `${MANIFEST}.baser.settings.${resolver.setting}.defaultFrom`,
      `вычисляемый дефолт настройки "${resolver.setting}" объявлен в "${resolver.module}", ` +
        'но такого файла в поставке нет. Резолвер резолвится из состава ПАКЕТА, а не из ' +
        'каталога разработчика: каталога разработчика у потребителя не будет',
    );
  }

  return present;
}

/**
 * Сверяет объявленное с белым списком `files`. Возвращает число сужденных путей.
 *
 * Судятся ФАЙЛЫ, а не корень содержимого: `files: ["template/*.json"]` не
 * увозит каталог `template` как таковой, но увозит часть того, что в нём
 * лежит, — и обвинение корня было бы и ложным, и бесполезным. Уезжает или нет
 * каждый конкретный артефакт, видно только по нему самому.
 */
function checkShipping(
  shipping: { readonly patterns: readonly string[] },
  declaration: SourceDeclaration,
  resolvers: readonly ResolverModule[],
  log: CheckProblemLog,
): number {
  const contentRoot = declaration.source.contentRoot;
  let judged = 0;

  declaration.layout.forEach((entry, index) => {
    judged += 1;
    const inside = `${contentRoot}/${entry.src}`;
    if (shipsPath(shipping, inside)) {
      return;
    }
    log.add(
      'not-shipped',
      `${MANIFEST}.baser.layout[${index}].src`,
      `"${inside}" не попадает в "files" манифеста — к потребителю шаблон не уедет, ` +
        `и артефакт "${entry.dest}" класть будет не из чего. У автора файл на месте ` +
        'и прогоны зелёные: пустым обвес приезжает только у потребителя',
    );
  });

  for (const resolver of resolvers) {
    judged += 1;
    if (shipsPath(shipping, resolver.module)) {
      continue;
    }
    log.add(
      'not-shipped',
      `${MANIFEST}.baser.settings.${resolver.setting}.defaultFrom`,
      `модуль "${resolver.module}" не попадает в "files" манифеста — ` +
        `у потребителя дефолт настройки "${resolver.setting}" вычислить будет нечем`,
    );
  }

  return judged;
}

/** Читает рендеримые шаблоны и отдаёт их форме. Возвращает число прочитанных. */
function checkTemplates(
  absolute: string,
  contentRoot: string,
  renderable: readonly { readonly src: string }[],
  present: ReadonlySet<string>,
  log: CheckProblemLog,
): number {
  let checked = 0;

  for (const entry of renderable) {
    const inside = `${contentRoot}/${entry.src}`;
    if (!present.has(inside)) {
      continue;
    }
    let content: string;
    try {
      content = readFileSync(join(absolute, inside), 'utf-8');
    } catch (cause) {
      log.add(
        'content-unreadable',
        inside,
        `шаблон объявлен раскладкой, но не читается: ${describe(cause)}`,
      );
      continue;
    }
    checked += 1;
    log.addAll(checkTemplate(content, inside));
  }

  return checked;
}

/** Настройки с вычисляемым дефолтом — в порядке, в котором их отдал разбор. */
function resolverModules(
  declaration: SourceDeclaration,
): readonly ResolverModule[] {
  const refs: ResolverModule[] = [];
  for (const [setting, spec] of Object.entries(declaration.settings)) {
    if (spec.defaultFrom) {
      refs.push({ setting, module: spec.defaultFrom.module });
    }
  }
  return refs;
}

function stringField(manifest: unknown, field: string): string | null {
  if (typeof manifest !== 'object' || manifest === null) {
    return null;
  }
  const value = (manifest as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
