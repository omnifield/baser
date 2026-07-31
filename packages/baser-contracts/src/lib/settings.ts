/**
 * РАЗРЕШЕНИЕ ЗНАЧЕНИЙ: дефолт обвеса → пресеты → заполненное пользователем.
 *
 * Заполненное бьёт всё и не поднимается никогда: движок в конфиг пользователя не
 * пишет, подниматься физически неоткуда. Незаполненное едет за нами — обвес
 * обновился, дефолт поднялся, значение поднялось (`kb:BASER2-5`).
 *
 * **Значения нужны ДВЕРИ, не движку.** Дверь их разрешает и она же подставляет
 * их в содержимое; движок получает содержимое уже готовым через порт
 * `CanonSource` и кладёт целиком (`tasker:BASER2-23`). Ни одна пара
 * «имя → значение» до движка не доезжает.
 */

import type { ResolverRef, SourceDeclaration } from './declaration.js';
import {
  EMPTY_SOURCE_CONFIG,
  SOURCE_CONFIG_KEY,
  sourceConfigPath,
  type SourceConfig,
} from './config.js';
import { byBytes } from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';
import {
  describeShape,
  describeValue,
  matchesType,
  typeMismatchHint,
  type SettingValue,
} from './values.js';

/**
 * Что резолвер получает на вход.
 *
 * Собирает контекст дверь; контракт только объявляет его форму — против неё
 * пишут резолверы обвесов.
 */
export interface ResolverContext {
  readonly repo: {
    /** Имя репозитория потребителя — из него растут остальные имена. */
    readonly name: string;
    /** Корень репозитория потребителя. */
    readonly root: string;
  };
  readonly source: {
    readonly id: string;
    readonly packageName: string;
    /**
     * Версия обвеса из манифеста его пакета — либо `null`, если версии там нет.
     *
     * **Отсутствие названо, а не изображено** (`tasker:BASER2-69`): у одного
     * факта одна форма во всех зонах — `string | null`, как в паспорте укладки и
     * на входе движка. Пока форма требовала здесь `string`, дверь вынуждена была
     * подставлять пустую строку, то есть изображать отсутствие значением.
     *
     * Резолвер, который версию читает, обязан отсутствие обработать: подставить
     * `null` в шаблон нельзя, а вернуть вместо версии `0.0.0` — значит выдать
     * правдоподобно неверный ответ, и это хуже отсутствующего.
     */
    readonly version: string | null;
  };
}

/**
 * Резолвер вычисляемого дефолта — **синхронная чистая функция локального
 * контекста**: репозиторий, пакет, файлы рядом. В сеть не ходит.
 *
 * Причина запрета: дефолт, ездящий по календарю («последняя стабильная на
 * сегодня»), ломает воспроизводимость коммита — один и тот же код поднимается
 * по-разному завтра и в оффлайне. Запинить вычисленное сегодня некуда: движок в
 * конфиг пользователя не пишет, а манифеста материализации ещё нет.
 *
 * «Последняя стабильная» от этого не пропадает — она пинится В САМОМ ОБВЕСЕ при
 * выпуске. Тогда версия рантайма двигается вместе с версией обвеса: видно в
 * диффе, видно в ревью, воспроизводимо на любой машине.
 */
export type SettingResolver = (ctx: ResolverContext) => SettingValue;

/**
 * Порт загрузки резолвера: найти модуль обвеса и позвать экспорт.
 *
 * Загрузка — дело двери (у неё есть файловая система и распакованный пакет),
 * поэтому контракт её не делает, а требует. Бросок наружу ловится и называется
 * отказом, а не роняет разбор.
 */
export type ComputeDefault = (ref: ResolverRef, key: string) => unknown;

/** Откуда взялось значение — чтобы дверь могла это показать человеку. */
export type SettingOrigin =
  /** Литеральный дефолт обвеса. */
  | { readonly kind: 'default' }
  /** Вычисляемый дефолт обвеса. */
  | { readonly kind: 'computed'; readonly ref: ResolverRef }
  /** Ходовое положение регулировок. */
  | { readonly kind: 'preset'; readonly preset: string }
  /** Заполнено пользователем — это значение не поднимается никогда. */
  | { readonly kind: 'filled' };

export interface ResolvedSettings {
  /** Готовые значения: имя настройки → значение. */
  readonly values: Readonly<Record<string, SettingValue>>;
  /** Откуда каждое из них взялось. */
  readonly origins: Readonly<Record<string, SettingOrigin>>;
}

export interface ResolveOptions {
  /**
   * Как позвать вычисляемый дефолт. Не передан — вычисляемые дефолты
   * называются отказом, а не подставляются пустотой: молча раскладывать обвес
   * без половины значений хуже, чем отказаться.
   */
  readonly computeDefault?: ComputeDefault;
}

/**
 * Сводит объявление обвеса и его файл настроек у потребителя в готовые значения.
 *
 * Проверяется здесь ПРИГОДНОСТЬ ПАРЫ: знает ли обвес настройку, которую
 * заполнил пользователь; есть ли у него пресет, который тот выбрал; того ли
 * типа пришло значение.
 *
 * Настройки приходят из файла на инструмент (`config.ts`), а не из `baser.json`:
 * там теперь только перечень поставленного. Порядок разрешения от переезда не
 * изменился — он в самом порядке шагов ниже.
 *
 * @param config содержимое ключа `baser` файла настроек; файла нет — дефолты
 */
export function resolveSettings(
  declaration: SourceDeclaration,
  config: SourceConfig = EMPTY_SOURCE_CONFIG,
  options: ResolveOptions = {},
): FormResult<ResolvedSettings> {
  const log = new ProblemLog();
  const values: Record<string, SettingValue> = {};
  const origins: Record<string, SettingOrigin> = {};

  // Два адреса, потому что две стороны формы: дефолт живёт в объявлении обвеса,
  // а выбор человека — в его файле настроек. Человеку надо открыть тот файл, в
  // котором опечатка, а не тот, который назвали для краткости.
  const at = `${declaration.source.id}`;
  const mine = `${sourceConfigPath(declaration.source.id)}.${SOURCE_CONFIG_KEY}`;

  // ── 1. Дефолты обвеса.
  for (const key of Object.keys(declaration.settings).sort(byBytes)) {
    const spec = declaration.settings[key];
    if (spec.defaultFrom) {
      const computed = compute(
        log,
        options.computeDefault,
        spec.defaultFrom,
        key,
        `${at}.settings.${key}.defaultFrom`,
      );
      if (computed.ok) {
        if (!matchesType(spec, computed.value)) {
          log.add(
            'value-type-mismatch',
            `${at}.settings.${key}.defaultFrom`,
            `настройка объявлена как ${describeShape(spec)}, ` +
              `резолвер вернул ${describeValue(computed.value)}` +
              typeMismatchHint(spec, computed.value),
          );
          continue;
        }
        values[key] = computed.value as SettingValue;
        origins[key] = { kind: 'computed', ref: spec.defaultFrom };
      }
      continue;
    }
    values[key] = spec.default as SettingValue;
    origins[key] = { kind: 'default' };
  }

  // ── 2. Пресеты, в порядке перечисления: следующий бьёт предыдущего.
  //
  // КАРТА ЗАМЕНЯЕТСЯ ЦЕЛИКОМ, А НЕ СЛИВАЕТСЯ, — и это решение, а не наследство
  // от списка (`tasker:BASER2-116`). Рынок наслоения конфигов здесь против нас:
  // compose и helm карты именно сливают. Отказались по двум причинам, и обе не
  // про удобство:
  //
  //   · СЛИЯНИЕМ НЕЛЬЗЯ УБРАТЬ. Пресет поставил фичу — снять её человек может
  //     только надгробием («ключ: null» = «удалить»), то есть словарём внутри
  //     значения, который мы себе запретили ровно так же, как «ref?version=…».
  //   · СЛИЯНИЕ ДЕЛАЕТ ВРАНЬЁМ ПРОИСХОЖДЕНИЕ. У значения ровно один `origins`, и
  //     на нём стоит весь рассказ двери «подниму версию с 22 на 24». После
  //     слияния происхождения нет — есть половинки от пресета и от человека, и
  //     одной строкой это не рассказать.
  //
  // Третья причина — целостность правила: «заполненное бьёт всё» либо верно для
  // всех пяти типов, либо не правило. Цена названа честно: пресет задал карту, а
  // человек хочет дописать своё — он переписывает карту целиком.
  config.presets.forEach((name, index) => {
    const preset = declaration.presets[name];
    if (!preset) {
      const known = Object.keys(declaration.presets).sort(byBytes);
      log.add(
        'unknown-preset',
        `${mine}.presets[${index}]`,
        `обвес не объявлял пресета "${name}"` +
          (known.length
            ? `; есть: ${known.join(' · ')}`
            : ' — у этого обвеса пресетов нет вовсе'),
      );
      return;
    }
    for (const key of Object.keys(preset.values).sort(byBytes)) {
      values[key] = preset.values[key];
      origins[key] = { kind: 'preset', preset: name };
    }
  });

  // ── 3. Заполненное пользователем — бьёт всё.
  for (const key of Object.keys(config.settings).sort(byBytes)) {
    const spec = declaration.settings[key];
    if (!spec) {
      const known = Object.keys(declaration.settings).sort(byBytes);
      log.add(
        'unknown-setting',
        `${mine}.settings.${key}`,
        `обвес не объявлял настройки "${key}" — заполненное значение никуда не поедет` +
          (known.length ? `; есть: ${known.join(' · ')}` : ''),
      );
      continue;
    }
    const raw = config.settings[key];
    if (!matchesType(spec, raw)) {
      // Здесь отказ читает ЧЕЛОВЕК, а не автор обвеса, и читает он его в своём
      // файле настроек — поэтому подсказка обязательна, а не желательна: он
      // написал не опечатку, а ровно то, что работало вчера (`values.ts`).
      log.add(
        'value-type-mismatch',
        `${mine}.settings.${key}`,
        `настройка объявлена как ${describeShape(spec)}, заполнено ${describeValue(raw)}` +
          typeMismatchHint(spec, raw),
      );
      continue;
    }
    values[key] = raw;
    origins[key] = { kind: 'filled' };
  }

  return log.result(() => ({ values, origins }));
}

function compute(
  log: ProblemLog,
  computeDefault: ComputeDefault | undefined,
  ref: ResolverRef,
  key: string,
  at: string,
): { ok: true; value: unknown } | { ok: false } {
  if (!computeDefault) {
    log.add(
      'resolver-failed',
      at,
      `дефолт настройки "${key}" вычисляемый, а звать резолверы некому — ` +
        'дверь обязана передать computeDefault',
    );
    return { ok: false };
  }

  let value: unknown;
  try {
    value = computeDefault(ref, key);
  } catch (cause) {
    log.add(
      'resolver-failed',
      at,
      `резолвер "${ref.module}#${ref.member}" не отработал: ${describeCause(cause)}`,
    );
    return { ok: false };
  }

  if (isThenable(value)) {
    log.add(
      'resolver-async',
      at,
      `резолвер "${ref.module}#${ref.member}" вернул обещание. Резолвер обязан быть ` +
        'синхронной чистой функцией локального контекста: дефолт, ездящий по календарю, ' +
        'ломает воспроизводимость коммита',
    );
    return { ok: false };
  }

  return { ok: true, value };
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
