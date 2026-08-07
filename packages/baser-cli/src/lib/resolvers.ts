/**
 * ЗАГРУЗКА РЕЗОЛВЕРОВ ОБВЕСА — работа двери, и она ОДНА на все обещания.
 *
 * Резолвер живёт в пакете обвеса, значит позвать его может только тот, у кого
 * есть файловая система и распакованный пакет. Контракты этого не делают, а
 * ТРЕБУЮТ: они объявляют порт и разбирают то, что он вернул
 * (`baser-contracts`, `resolvers.ts`).
 *
 * Обещаний у обвеса два, и они РАЗНЫЕ — вычисляемый дефолт настройки
 * (`defaultFrom`) и вычисляемое предупреждение (`warningFrom`, форма 7,
 * `tasker:BASER2-226`). Портов в контрактах тоже два (`ComputeDefault` и
 * `ComputeWarning`), и слиты они не будут: у дефолта ответ едет в артефакт
 * потребителя и смотреть на посадочное место ему НЕЛЬЗЯ, у предупреждения ответ
 * едет человеку и смотреть НУЖНО — ради этого поле и заведено.
 *
 * **Общее у них ровно то, что здесь: как достать функцию из чужого пакета.**
 * Различение живёт в типах контрактов, а доставка модуля — механика двери, и
 * второй её копии в зоне быть не должно: разъехались бы они молча и по одной
 * строке — сначала поиск экспорта в `default`, потом текст броска, потом
 * обстановка, которую видит резолвер.
 *
 * ## Чем зовут резолвер — решает ДВЕРЬ, и она зовёт ОБОИХ одинаково
 *
 * Формой это не задано (`tasker:BASER2-233`, отчёт владельца движка): контракт
 * называет тип порта, а что подать чужой функции аргументом — знает тот, кто её
 * зовёт. Дверь подаёт `ResolverContext` — тот же самый и резолверу дефолта, и
 * резолверу предупреждения. Причина не в экономии: обстановка, нужная
 * предупреждению, — это корень локации, а он в `ResolverContext` уже есть
 * (`repo.root`). Заведя вторую форму контекста, дверь получила бы два словаря
 * на одну обстановку и обязана была бы держать их в согласии; разница между
 * обещаниями при этом лежит НЕ в контексте, а в том, что резолверу позволено с
 * ним делать, — и её выражают типы контрактов, а не форма аргумента.
 *
 * ## Беда загрузки — не отказ ЗДЕСЬ
 *
 * Модуль не нашёлся, экспорта нет — порт БРОСАЕТ, а называет случившееся тот,
 * чьё это обещание: у дефолта `resolveSettings` (`resolver-failed` с адресом
 * настройки), у предупреждения `resolveWarning` (то же, но прогон при этом не
 * останавливается вовсе). Один язык отказа на всю форму лучше, чем свой на
 * каждую зону, — и он же означает, что здесь решений нет ни одного.
 */

import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type {
  ResolverContext,
  ResolverRef,
  SourceDeclaration,
} from '@omnifield/baser-contracts';
import type { LocatedPackage } from '@omnifield/baser-contracts/locate';
import type { Repo } from './repo.js';

/** Готовые к вызову резолверы обвеса: модули загружены, обстановка собрана. */
export interface ResolverPort {
  /**
   * Зовёт объявленный обвесом экспорт и отдаёт то, что он вернул, КАК ЕСТЬ.
   *
   * Разбором ответа порт не занимается: годен ли он — вопрос обещания, а
   * обещаний у обвеса два и правила у них разные.
   */
  call(ref: ResolverRef): unknown;
}

/**
 * Грузит модули названных резолверов и отдаёт порт вызова.
 *
 * Загрузка асинхронна (ESM), а разбор в контрактах синхронен — и это не
 * противоречие, а причина, по которой модули грузятся ЗАРАНЕЕ: резолвер обязан
 * быть синхронной чистой функцией, поэтому асинхронной у двери остаётся только
 * доставка модуля, а не вычисление ответа.
 *
 * Один модуль грузится один раз, даже если на него ссылаются десять полей: за
 * повторным `import()` стоит кэш загрузчика, но счётчик обращений к диску —
 * наш, и врать им незачем.
 */
export async function loadResolvers(
  refs: readonly ResolverRef[],
  declaration: SourceDeclaration,
  pkg: LocatedPackage,
  repo: Repo,
): Promise<ResolverPort> {
  const modules = new Map<string, unknown>();
  const failures = new Map<string, string>();

  for (const ref of refs) {
    if (modules.has(ref.module) || failures.has(ref.module)) {
      continue;
    }
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

  return {
    call(ref) {
      const failed = failures.get(ref.module);
      if (failed !== undefined) {
        throw new Error(`модуль "${ref.module}" не загрузился: ${failed}`);
      }

      const loaded = modules.get(ref.module) as Record<string, unknown>;
      const member = memberOf(loaded, ref.member);
      if (typeof member !== 'function') {
        throw new Error(`в "${ref.module}" нет экспорта "${ref.member}"`);
      }

      return (member as (ctx: ResolverContext) => unknown)(context);
    },
  };
}

/** `<модуль>#<экспорт>` — то, чем резолвер назван и в объявлении, и в отчёте. */
export function refKey(ref: ResolverRef): string {
  return `${ref.module}#${ref.member}`;
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

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
