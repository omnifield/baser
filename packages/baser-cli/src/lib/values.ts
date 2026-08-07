/**
 * ЗНАЧЕНИЯ И ДВИЖЕНИЕ ДЕФОЛТА.
 *
 * Разрешение значений реализовано в контрактах (`resolveSettings`) и здесь НЕ
 * переписывается: дверь подаёт ему объявление обвеса, запись конфига и порт
 * вызова резолверов, а обратно получает готовые значения и происхождение
 * каждого.
 *
 * Своего у двери здесь ровно две вещи, и обе — её и ничьи больше.
 *
 * **1. Порт `computeDefault`.** Резолвер живёт в пакете обвеса, значит позвать
 * его может только тот, у кого есть файловая система и распакованный пакет.
 * Контракт этого не делает, а требует.
 *
 * Заполненное и выбранное приезжают сюда из ФАЙЛА НА ИНСТРУМЕНТ (`settings.ts`),
 * а не из `baser.json`: там теперь только перечень поставленного
 * (`tasker:BASER2-10` §3). Порядок разрешения от переезда не изменился — он в
 * самих шагах: дефолт обвеса → пресеты → заполненное.
 *
 * **2. Движение дефолта, названное ДО применения** (`kb:BASER2-5`,
 * `tasker:BASER2-20`). Движок сказать этого не может — он значений не видит
 * вовсе (`tasker:BASER2-23`). `resolveSettings` отдаёт только КОНЕЧНОЕ
 * происхождение значения, а «подниму версию с 22 на 24» — утверждение про ДВА
 * конца, поэтому дверь восстанавливает цепочку разрешения целиком: дефолт
 * обвеса → каждый пресет, который его сдвинул → заполненное пользователем.
 *
 * Цепочка строится из тех же входных данных, что и разрешение, и сверяется с
 * его результатом (`assertAgreesWithContracts`): рассказ о значении, разошедшийся
 * с самим значением, был бы хуже отсутствия рассказа.
 *
 * **3. Прежний конец движения ВО ВРЕМЕНИ** (`tasker:BASER2-38`). Цепочка выше
 * отвечает, откуда значение взялось сегодня; вопрос «а с чем оно уже
 * разложено» — другой, и до `BASER2-38` дверь на него не отвечала вовсе: план
 * говорил `diverged` и новое значение, а прежнего конца не называл.
 *
 * Хранить его не пришлось: разложенный артефакт и есть отпечаток прежних
 * значений, и вынимаются они оттуда С ДОКАЗАТЕЛЬСТВОМ — побайтовым
 * воспроизведением лежащего файла (`previous.ts`). Паспорт укладки при этом не
 * тронут: он помнит, ЧТО положено, и менять его форму ради того, что уже лежит
 * рядом, значило бы платить швом между зонами.
 *
 * Восстанавливается не всё, и границы названы в `previous.ts`. Там, где
 * доказать нечем, дверь молчит — а расхождение самого артефакта названо всегда,
 * его несёт `step.previous` движка.
 */

import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import {
  byBytes,
  resolveSettings,
  type ComputeDefault,
  type FormResult,
  type ResolverContext,
  type ResolverRef,
  type SettingMap,
  type SettingOrigin,
  type SettingType,
  type SettingValue,
  type SourceConfig,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';
import type { LocatedPackage } from '@omnifield/baser-contracts/locate';
import type { PlacedValue } from './previous.js';
import type { Repo } from './repo.js';

/** Одно звено цепочки разрешения — один сдвиг значения. */
export interface SettingLink {
  readonly kind: SettingOrigin['kind'];
  readonly value: SettingValue;
  /** `kind === 'preset'`: чьё это ходовое положение. */
  readonly preset?: string;
  /** `kind === 'computed'`: `<модуль>#<экспорт>`, посчитавший дефолт. */
  readonly resolver?: string;
}

/** Что стало со значением одной настройки и откуда оно приехало. */
export interface SettingMovement {
  readonly key: string;
  readonly title: string;
  readonly type: SettingType;
  /** Значение, которое поедет в шаблон. */
  readonly value: SettingValue;
  /** Конечное происхождение — авторитетно, приходит из контрактов. */
  readonly origin: SettingOrigin;
  /**
   * Значение НАШЕ: пользователь его не заполнял, поэтому оно поедет за выпуском
   * обвеса. Заполненное не поднимается никогда — подниматься неоткуда.
   */
  readonly ours: boolean;
  /** Цепочка целиком: у каждого сдвига названы оба конца. */
  readonly chain: readonly SettingLink[];
  /** Значение сдвинуто относительно дефолта обвеса. */
  readonly moved: boolean;
  /**
   * С ЧЕМ УЖЕ РАЗЛОЖЕНО — прежний конец движения во времени.
   *
   * Цепочка выше объясняет, откуда значение взялось СЕГОДНЯ (дефолт → пресет →
   * заполненное). Здесь другое измерение: артефакт на диске положен вчерашним
   * значением, и при следующем применении оно сменится. Поле есть только у тех
   * настроек, чей прежний конец ВОССТАНОВЛЕН И ДОКАЗАН (`previous.ts`);
   * недоказанное не утверждается вовсе.
   */
  readonly placed?: PlacedValue;
}

export interface ResolvedValues {
  /** Готовые значения для подстановки: имя настройки → значение. */
  readonly values: Readonly<Record<string, SettingValue>>;
  /** Движение по каждой настройке, в байтовом порядке имён. */
  readonly movements: readonly SettingMovement[];
}

/**
 * Порт вызова резолверов + кэш посчитанного.
 *
 * Кэш обязателен, а не оптимизация: дверь зовёт резолвер дважды — один раз
 * через `resolveSettings` (за значением) и второй раз при сборке цепочки (за
 * ДЕФОЛТНЫМ концом движения). Резолвер обязан быть чистым, но полагаться на
 * чужую чистоту в рассказе о значениях нельзя: два разных ответа на один вызов
 * сделали бы цепочку враньём.
 */
export interface DefaultsPort {
  readonly computeDefault: ComputeDefault;
}

/**
 * Готовит порт `computeDefault`: грузит модули резолверов обвеса.
 *
 * Загрузка асинхронна (ESM), а `resolveSettings` синхронен — и это не
 * противоречие, а причина, по которой модули грузятся ЗАРАНЕЕ: резолвер обязан
 * быть синхронной чистой функцией локального контекста, поэтому асинхронной у
 * двери остаётся только доставка модуля, а не вычисление значения.
 *
 * Сбой загрузки не роняет прогон здесь: он превращается в бросок из порта, и
 * контракты называют его своим кодом `resolver-failed` вместе с адресом
 * настройки. Один язык отказа на всю форму — лучше, чем свой на каждую зону.
 */
export async function loadDefaults(
  declaration: SourceDeclaration,
  pkg: LocatedPackage,
  repo: Repo,
): Promise<DefaultsPort> {
  const modules = new Map<string, unknown>();
  const failures = new Map<string, string>();

  for (const spec of Object.values(declaration.settings)) {
    const ref = spec.defaultFrom;
    if (
      ref === undefined ||
      modules.has(ref.module) ||
      failures.has(ref.module)
    )
      continue;
    try {
      modules.set(
        ref.module,
        await import(pathToFileURL(resolvePath(pkg.root, ref.module)).href),
      );
    } catch (cause) {
      failures.set(ref.module, describe(cause));
    }
  }

  const context: ResolverContext = {
    repo: { name: repo.name, root: repo.root },
    source: {
      id: declaration.source.id,
      packageName: pkg.packageName,
      // Обвес версию не назвал — резолвер получает `null`, тот же самый, что
      // уезжает в паспорт укладки.
      //
      // Здесь стоял обход: `?? ''`. Он появился не по недосмотру — форма
      // контракта требовала `string`, и изобразить отсутствие было нечем;
      // пустую строку выбрали как «видную», в отличие от правдоподобного
      // `0.0.0`. Обход снят вместе с причиной: `ResolverContext.source.version`
      // стал `string | null` (`tasker:BASER2-69`), и у одного факта теперь одна
      // форма во всех трёх зонах — резолвер отличает «не назвали» проверкой, а
      // не угадыванием по пустоте.
      version: pkg.version ?? null,
    },
  };

  const cache = new Map<string, unknown>();

  const computeDefault: ComputeDefault = (ref) => {
    const key = refKey(ref);
    if (cache.has(key)) {
      return cache.get(key);
    }

    const failed = failures.get(ref.module);
    if (failed !== undefined) {
      throw new Error(`модуль "${ref.module}" не загрузился: ${failed}`);
    }

    const loaded = modules.get(ref.module) as Record<string, unknown>;
    const member = memberOf(loaded, ref.member);
    if (typeof member !== 'function') {
      throw new Error(
        `в "${ref.module}" нет экспорта "${ref.member}" — вычислять дефолт нечем`,
      );
    }

    const value = (member as (ctx: ResolverContext) => unknown)(context);
    cache.set(key, value);
    return value;
  };

  return { computeDefault };
}

/**
 * Разрешает значения и восстанавливает движение каждого.
 *
 * Разрешение — целиком контрактное; здесь только рассказ поверх него.
 */
export function resolveValues(
  declaration: SourceDeclaration,
  config: SourceConfig,
  defaults: DefaultsPort,
): FormResult<ResolvedValues> {
  const resolved = resolveSettings(declaration, config, {
    computeDefault: defaults.computeDefault,
  });
  if (!resolved.ok) {
    return resolved;
  }

  const movements = Object.keys(declaration.settings)
    .sort(byBytes)
    .map((key) =>
      movementOf(key, declaration, config, defaults, resolved.value),
    );

  assertAgreesWithContracts(movements, resolved.value.values);

  return { ok: true, value: { values: resolved.value.values, movements } };
}

function movementOf(
  key: string,
  declaration: SourceDeclaration,
  config: SourceConfig,
  defaults: DefaultsPort,
  resolved: {
    values: Readonly<Record<string, SettingValue>>;
    origins: Readonly<Record<string, SettingOrigin>>;
  },
): SettingMovement {
  const spec = declaration.settings[key];
  const chain: SettingLink[] = [];

  // ── 1. Дефолт обвеса. Это тот конец, ОТ которого меряется всякое движение.
  if (spec.defaultFrom) {
    chain.push({
      kind: 'computed',
      value: defaults.computeDefault(spec.defaultFrom, key) as SettingValue,
      resolver: refKey(spec.defaultFrom),
    });
  } else {
    chain.push({ kind: 'default', value: spec.default as SettingValue });
  }

  // ── 2. Пресеты, в порядке перечисления: следующий бьёт предыдущего.
  for (const name of config.presets) {
    const preset = declaration.presets[name];
    if (preset && key in preset.values) {
      chain.push({ kind: 'preset', value: preset.values[key], preset: name });
    }
  }

  // ── 3. Заполненное пользователем — бьёт всё и не поднимается никогда.
  if (key in config.settings) {
    chain.push({ kind: 'filled', value: config.settings[key] });
  }

  const origin = resolved.origins[key];
  return {
    key,
    title: spec.title,
    type: spec.type,
    value: resolved.values[key],
    origin,
    ours: origin.kind !== 'filled',
    chain,
    moved: chain.length > 1,
  };
}

/**
 * Рассказ обязан сходиться с самим значением.
 *
 * Цепочка строится дверью, а значение — контрактами, из одних и тех же данных.
 * Разойтись они могут только если дверь начала понимать форму иначе, чем зона,
 * которая её держит, — и тогда пользователь получил бы правдоподобный рассказ
 * про значение, которого в артефакте нет. Это дефект двери, поэтому он бросает,
 * а не копится отказом: отвечать на него планом не за что.
 */
function assertAgreesWithContracts(
  movements: readonly SettingMovement[],
  values: Readonly<Record<string, SettingValue>>,
): void {
  for (const movement of movements) {
    const tail = movement.chain[movement.chain.length - 1];
    if (!sameValue(tail.value, values[movement.key])) {
      throw new Error(
        `консоль рассказывает про настройку "${movement.key}" не то, что разрешили ` +
          `контракты: цепочка кончается ${JSON.stringify(tail.value)}, ` +
          `а значение ${JSON.stringify(values[movement.key])}`,
      );
    }
  }
}

/**
 * Одно ли это значение — ПО СОДЕРЖИМОМУ, а не по ссылке (`tasker:BASER2-118`).
 *
 * Составное значение — карта и список — приезжает сюда двумя дорогами: одно
 * читали контракты, другое дверь. Совпадать они обязаны содержимым; требовать
 * при этом ОДИН И ТОТ ЖЕ объект значило бы проверять не то, что написано в
 * `assertAgreesWithContracts`, а случайность реализации: сегодня обе дороги
 * ведут к одному объекту, завтра любая из них отдаст свою копию — и дверь
 * назовёт расхождением значение, которое ни на йоту не менялось.
 *
 * Глубина ровно та, что есть у формы, и не глубже (`kb:BASER2-23`): карта
 * настройки — два этажа, `имя → скаляр либо плоская карта опций`. Общего
 * глубокого сравнения здесь нет намеренно — оно приняло бы за значение то, чего
 * форма выразить не может, и молча.
 */
function sameValue(left: SettingValue, right: SettingValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    );
  }
  if (isMap(left) || isMap(right)) {
    return isMap(left) && isMap(right) && sameMap(left, right);
  }
  return left === right;
}

/**
 * Карта поэлементно: те же ключи, и у каждого то же значение.
 *
 * Вложенная карта опций разбирается той же функцией — не ради общности, а
 * потому что это ТА ЖЕ форма: `of: "map"` означает плоскую карту скаляров, и
 * третьего этажа в грамматике нет. Рекурсия здесь кончается на форме, а не на
 * счётчике глубины.
 */
function sameMap(left: SettingMap, right: SettingMap): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  return keys.every((key) => {
    const ours = left[key];
    const theirs = right[key];
    if (isMap(ours) || isMap(theirs)) {
      return isMap(ours) && isMap(theirs) && sameMap(ours, theirs);
    }
    return ours === theirs;
  });
}

function isMap(value: unknown): value is SettingMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Экспорт модуля резолверов: сначала именованный, потом из `default`.
 *
 * Второе — не вежливость к CJS, а поддержка формы «расширение то, которое пакет
 * реально отдаёт» (README контрактов §3): собранный CJS-пакет отдаёт свои
 * функции через `module.exports`, и для ESM-импорта они лежат под `default`.
 */
function memberOf(loaded: Record<string, unknown>, member: string): unknown {
  if (loaded[member] !== undefined) {
    return loaded[member];
  }
  const fallback = loaded['default'];
  return typeof fallback === 'object' && fallback !== null
    ? (fallback as Record<string, unknown>)[member]
    : undefined;
}

function refKey(ref: ResolverRef): string {
  return `${ref.module}#${ref.member}`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
