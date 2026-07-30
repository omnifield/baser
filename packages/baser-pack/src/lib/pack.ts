/**
 * «ПРОВЕРЕННЫЙ ОБВЕС, НОРМАЛИЗОВАННЫЙ И С МАНИФЕСТОМ ВЫДАЧИ».
 *
 * На вход — каталог обвеса, на выход — полезная нагрузка, готовая к любому
 * способу доставки, и опись рядом с ней.
 *
 * ## Подготовка ≠ доставка
 *
 * ```
 * проверить  →  собрать  →  вынести
 *   check        pack        способов много
 * ```
 *
 * Собрать — всегда одно и то же. Вынести можно папкой в руках, в реестр, в
 * локальный том. Поэтому здесь НЕТ ни одного способа доставки: упаковка ничего
 * никуда не отправляет, ничего не публикует и не знает, что случится с
 * нагрузкой дальше. Ручная папка сегодня и публикация завтра — два потребителя
 * одного выхода, а не два разных флоу (`tasker:BASER2-29`).
 *
 * По той же причине упаковка не вкладывает в нагрузку дверь. Вложить себя может
 * только сама дверь: она единственная знает, из чего состоит. Иначе упаковка
 * зависела бы от двери, а дверь от упаковки — круг. Направление цепи:
 * `contracts ← check ← pack ← дверь`.
 *
 * ## Первым делом — отказ паковать негодное
 *
 * Обвес, не подходящий посадочному месту, упаковываться не должен: иначе мы
 * выдаём заведомо не встающий обвес и узнаём об этом у потребителя
 * (`kb:BASER2-9`).
 * Проверка зовётся ДО того, как на диске появится хоть один байт, и её отказ
 * едет наверх как есть — тем же кодом и тем же текстом.
 *
 * ## Проверок две, и вторая не выводится из первой
 *
 * Первая проверка — исходного каталога: стоит ли вообще паковать. Вторая — уже
 * СОБРАННОЙ нагрузки, как чужого каталога обвеса, принесённого руками.
 *
 * Между ними стоит npm со своими правилами упаковки, и разойтись каталог
 * разработчика с поставкой может молча. Ровно здесь снимается третье состояние
 * проверки: «не могу сказать» про `files` — это не «годен» и не «негоден», и
 * упаковка отвечает на него не более умным разбором, а тем, что **собирает
 * нагрузку и меряет то, что собралось**. Не разобравшийся белый список не
 * запрещает сборку — но и не пропускает её молча: файл, не доехавший из-за
 * отрицания в `files`, вторая проверка называет пропавшим, и выдавать становится
 * нечего.
 *
 * Состояние при этом доезжает до получателя: ответ проверки про исходный
 * каталог лежит в описи целиком, вместе с причиной «не могу сказать».
 *
 * ## Отказ не оставляет за собой недособранной нагрузки
 *
 * Всё, что упаковка успела положить на диск до отказа, она за собой убирает —
 * и нагрузку, и опись рядом с ней, включая опись, оборванную на середине.
 * Полусобранная нагрузка выглядит как настоящая, а «выдавать нечего» перестаёт
 * быть видно ровно в тот момент, когда её кто-нибудь понесёт.
 *
 * Обещание безусловное, и условным оно быть не может: человек, которому сказали
 * «мусора не будет», по этому слову планирует. Поэтому убирается СПИСОК
 * созданного, а не один путь, — и убирается ровно созданное нами: чужой каталог
 * выдачи, существовавший до нас, остаётся на месте пустым.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { checkPackage, type CheckReport } from '@omnifield/baser-check';

import { copyShipped, listShippedFiles } from './contents.js';
import {
  buildPayloadManifest,
  PAYLOAD_DIR,
  PAYLOAD_MANIFEST_FILE,
  writePayloadManifest,
  type PayloadManifest,
  type PayloadShipping,
} from './manifest.js';
import { PackProblemLog } from './problems.js';
import {
  PACK_SCHEMA_VERSION,
  type PackReport,
  type PackSpan,
  type PackStage,
  type PackStageName,
} from './report.js';

export interface PackOptions {
  /**
   * Каталог выдачи: сюда лягут нагрузка и опись.
   *
   * Создаётся, если его нет. Непустой — отказ: молча затирать чужое упаковка не
   * станет, а разбирать, что там лежало, — не её работа.
   */
  readonly into: string;
  /** Источник времени для трейсов; подменяется в тестах ради детерминизма. */
  readonly now?: () => number;
}

/**
 * Собирает нагрузку из каталога обвеса.
 *
 * Раскладка выдачи:
 *
 * ```
 * <into>/payload/       ← нагрузка: ровно то, что получит потребитель
 * <into>/payload.json   ← опись выдачи
 * ```
 *
 * Опись лежит РЯДОМ, а не внутри: нагрузку публикуют в реестр и уносят папкой
 * как есть, и лишний файл в ней менял бы саму нагрузку ради разговора о ней.
 */
export function packPackage(source: string, options: PackOptions): PackReport {
  const now = options.now ?? (() => performance.now());
  const log = new PackProblemLog();
  const stages: PackStage[] = [];
  const trace: PackSpan[] = [];

  const absoluteSource = resolve(source);
  const absoluteTarget = resolve(options.into);
  const payloadRoot = join(absoluteTarget, PAYLOAD_DIR);
  const manifestPath = join(absoluteTarget, PAYLOAD_MANIFEST_FILE);

  /**
   * Что упаковка создала своими руками — то и уберёт за собой при отказе.
   *
   * Список, а не один путь: в каталог выдачи кладутся ДВА объекта, нагрузка и
   * опись рядом с ней. Пока здесь стоял один путь, уборка снимала нагрузку и
   * проходила мимо описи — а при каталоге выдачи, существовавшем до нас, снести
   * его целиком нельзя, и огрызок описи оставался лежать рядом с пустым местом
   * (`tasker:BASER2-74`).
   */
  const created: string[] = [];

  /** Замер шага и его строка в `stages` — одним местом, чтобы не разъехались. */
  const stage = <T>(
    name: PackStageName,
    run: () => T,
    counted: (value: T) => number,
  ): T => {
    const before = log.size;
    const started = now();
    const value = run();
    trace.push({ name, ms: now() - started });
    stages.push({
      name,
      status: log.size > before ? 'failed' : 'ok',
      counted: counted(value),
    });
    return value;
  };

  const skip = (name: PackStageName, reason: string): void => {
    stages.push({ name, status: 'skipped', counted: 0, reason });
  };

  const skipRest = (from: PackStageName, reason: string): void => {
    const rest: PackStageName[] = [
      'target',
      'contents',
      'payload',
      'verify',
      'manifest',
    ];
    for (const name of rest.slice(rest.indexOf(from))) {
      skip(name, reason);
    }
  };

  /**
   * Убирает следы отказа: недособранной выдачи на диске не остаётся.
   *
   * Убирается ровно созданное нами и ничего сверх: чужой каталог выдачи был
   * здесь до нас и останется после. Порядок обратный порядку создания — иначе
   * снос каталога уносил бы то, что в нём лежит, ещё до собственной строки.
   */
  const discard = (): void => {
    for (const path of [...created].reverse()) {
      rmSync(path, { recursive: true, force: true });
    }
  };

  const report = (
    check: CheckReport,
    verify: CheckReport | null,
    manifest: PayloadManifest | null,
  ): PackReport => ({
    packSchemaVersion: PACK_SCHEMA_VERSION,
    ok: log.empty,
    source: absoluteSource,
    target: absoluteTarget,
    payloadRoot: manifest === null ? null : payloadRoot,
    manifestPath: manifest === null ? null : manifestPath,
    manifest,
    check,
    verify,
    stages,
    problems: log.list(),
    trace,
  });

  // ── Шаг 1. Обвес подходит посадочному месту. Отказ приезжает как есть.
  const check = stage(
    'check',
    () => {
      const verdict = checkPackage(absoluteSource, { now });
      if (!verdict.ok) {
        log.addAll(verdict.problems);
      }
      return verdict;
    },
    layersChecked,
  );

  // `ok` у проверки уже означает и разобранное объявление, и имя пакета. Здесь
  // это сказано типом: без объявления паковать нечего, без имени — некому.
  const declaration = check.declaration;
  const packageName = check.packageName;
  if (!check.ok || declaration === null || packageName === null) {
    skipRest('target', 'исходный обвес не годен — паковать нечего');
    return report(check, null, null);
  }

  // ── Шаг 2. Место выдачи.
  const targetReady = stage(
    'target',
    () => {
      if (isInside(absoluteTarget, absoluteSource)) {
        log.add(
          'payload-target-inside-source',
          absoluteTarget,
          `каталог выдачи "${absoluteTarget}" лежит внутри каталога обвеса — ` +
            'нагрузка стала бы частью того, из чего её собирают, и следующая сборка ' +
            'увезла бы предыдущую внутри себя',
        );
        return false;
      }

      const targetExisted = existsSync(absoluteTarget);
      if (targetExisted) {
        const occupied = describeOccupied(absoluteTarget);
        if (occupied !== null) {
          log.add('payload-target-occupied', absoluteTarget, occupied);
          return false;
        }
      }

      try {
        mkdirSync(payloadRoot, { recursive: true });
        // Убираем за собой ровно то, что создали: чужой пустой каталог выдачи
        // был здесь до нас и останется после.
        created.push(targetExisted ? payloadRoot : absoluteTarget);
      } catch (cause) {
        log.add(
          'payload-target-unwritable',
          absoluteTarget,
          `каталог выдачи не создать: ${describe(cause)}`,
        );
        return false;
      }
      return true;
    },
    () => 1,
  );

  if (!targetReady) {
    skipRest('contents', 'места для нагрузки нет — собирать некуда');
    return report(check, null, null);
  }

  // ── Шаг 3. Состав поставки. Спрашиваем у npm, а не предсказываем.
  const contents = stage(
    'contents',
    () => {
      const listed = listShippedFiles(absoluteSource);
      if (!listed.ok) {
        log.add('contents-unlistable', absoluteSource, listed.reason);
      }
      return listed;
    },
    (listed) => (listed.ok ? listed.files.length : 0),
  );

  if (!contents.ok) {
    discard();
    skipRest('payload', 'состав поставки неизвестен — копировать нечего');
    return report(check, null, null);
  }

  // ── Шаг 4. Нагрузка: копия состава, без ссылок наружу.
  const copied = stage(
    'payload',
    () => {
      const result = copyShipped(absoluteSource, contents.files, payloadRoot);
      if (!result.ok) {
        log.add(
          'payload-file-uncopyable',
          result.path,
          `файл состава не лёг в нагрузку: ${result.reason}`,
        );
      }
      return result;
    },
    (result) => (result.ok ? result.files.length : 0),
  );

  if (!copied.ok) {
    discard();
    skipRest('verify', 'нагрузка не собрана — проверять и описывать нечего');
    return report(check, null, null);
  }

  // ── Шаг 5. Проверка СОБРАННОГО — тем же мультиметром, что и исходного.
  const verify = stage(
    'verify',
    () => {
      const verdict = checkPackage(payloadRoot, { now });
      if (!verdict.ok) {
        log.addAll(verdict.problems);
      }
      return verdict;
    },
    layersChecked,
  );

  if (!verify.ok) {
    discard();
    skip(
      'manifest',
      'собранная нагрузка не принята проверкой и удалена — выдавать нечего',
    );
    return report(check, verify, null);
  }

  // ── Шаг 6. Опись выдачи.
  const manifest = stage(
    'manifest',
    () => {
      const built = buildPayloadManifest({
        declaration,
        packageName,
        packageVersion: check.packageVersion,
        shipping: shippingOf(check),
        files: copied.files,
        checkSchemaVersion: check.checkSchemaVersion,
        source: { ok: check.ok, stages: check.stages },
        payload: { ok: verify.ok, stages: verify.stages },
      });
      // Адрес описи назван созданным ДО записи, а не после: отказ на середине
      // оставляет огрызок, и убрать его надо ровно так же, как целую опись.
      created.push(manifestPath);
      try {
        writePayloadManifest(manifestPath, built);
      } catch (cause) {
        log.add(
          'manifest-unwritable',
          manifestPath,
          `опись выдачи не записать: ${describe(cause)}`,
        );
        return null;
      }
      return built;
    },
    (built) => (built === null ? 0 : built.files.length),
  );

  if (manifest === null) {
    discard();
    return report(check, verify, null);
  }

  return report(check, verify, manifest);
}

/** Сколько слоёв проверка реально сверила: пропуск — не сверенный слой. */
function layersChecked(report: CheckReport): number {
  return report.stages.filter((stage) => stage.status !== 'skipped').length;
}

/**
 * Что проверка успела сказать про состав поставки — и кто решил его на самом
 * деле.
 *
 * «Не могу сказать» едет в опись вместе с причиной: растворить его в `ok: true`
 * значило бы выдать обвес, про который мы не знаем, что внутри.
 */
function shippingOf(check: CheckReport): PayloadShipping {
  return check.shipping.kind === 'undecidable'
    ? {
        claim: 'undecidable',
        reason: check.shipping.reason,
        decidedBy: 'npm',
      }
    : { claim: check.shipping.kind, decidedBy: 'npm' };
}

/** Лежит ли `path` внутри `root` — или это он сам. */
function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** Почему в каталог выдачи класть нельзя. `null` — можно. */
function describeOccupied(target: string): string | null {
  if (!statSync(target).isDirectory()) {
    return `путь выдачи "${target}" занят не каталогом — положить туда нагрузку нельзя`;
  }
  const entries = readdirSync(target);
  if (entries.length === 0) {
    return null;
  }
  return (
    `каталог выдачи "${target}" не пуст (${entries.length}): ` +
    `${entries.slice(0, 5).join(', ')}. Упаковка не затирает чужое молча — ` +
    'выбери пустой каталог или убери прежнюю выдачу сам'
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
