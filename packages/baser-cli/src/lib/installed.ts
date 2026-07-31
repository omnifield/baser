/**
 * ПОСТАВЛЕННЫЙ ОБВЕС — то, что дверь находит на реальной ФС.
 *
 * Форма ничего не читает и ничего не резолвит: JSON ей подаёт дверь
 * (`packages/baser-contracts/README.md`). Значит найти пакет по имени из
 * `use`, прочитать его манифест и понять, ГДЕ физически лежат его шаблоны, —
 * работа этого файла и ничья больше.
 *
 * Отсюда же родом шов `contentRoot`: обвес объявляет корень содержимого
 * ОТНОСИТЕЛЬНО СВОЕГО ПАКЕТА, а движок адресует источник путём ОТНОСИТЕЛЬНО
 * ДЕРЕВА ПОТРЕБИТЕЛЯ. Перевод одного в другое возможен только здесь — и он не
 * всегда возможен вовсе (`locateContentRoot`).
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Распакованный пакет обвеса на диске. */
export interface InstalledPackage {
  readonly packageName: string;
  /**
   * Версия из манифеста пакета — единственное место, где версия обвеса живёт
   * (`kb:BASER2-2`, «Версия обвеса — в манифесте пакета»).
   *
   * `null` — **обвес версию не назвал**, и это НАЗВАННОЕ отсутствие, а не
   * пробел. Прежде здесь стояла подстановка `0.0.0`: пока версия никуда не
   * уезжала, она была безобидной косметикой строки вывода, но теперь она
   * доезжает до паспорта укладки — и сочинённая версия стала бы утверждением,
   * которого обвес не делал. На нём же потом строилось бы «между твоей версией
   * и новой было ломающее изменение» (`tasker:BASER2-52`).
   */
  readonly version: string | null;
  /** Абсолютный корень пакета — каталог, где лежит его `package.json`. */
  readonly root: string;
  /** Разобранный `package.json`; блок `baser` из него достают контракты. */
  readonly manifest: unknown;
}

/** Пакет не нашёлся или его манифест непригоден. Отказ — данные, не бросок. */
export interface InstalledFailure {
  readonly reason: 'not-found' | 'manifest-unreadable';
  readonly detail: string;
}

export type InstalledResult =
  | { readonly ok: true; readonly value: InstalledPackage }
  | { readonly ok: false; readonly failure: InstalledFailure };

/**
 * Находит пакет обвеса так же, как его нашёл бы сам репозиторий потребителя.
 *
 * Резолв ведётся ОТ КОРНЯ ПОТРЕБИТЕЛЯ, а не от каталога двери: обвес поставлен
 * пользователю, и его раскладка на диске (плоская, pnpm-симлинки, hoisting) —
 * свойство его репозитория. Дверь, резолвящая от себя, нашла бы свою копию
 * пакета вместо пользовательской и разложила бы чужую версию шаблонов.
 *
 * ── ШОВ: ТОТ ЖЕ РЕЗОЛВ ДЕРЖАТ КОНТРАКТЫ ─────────────────────────────────────
 *
 * `packages/baser-contracts/src/lib/locate.ts`, функция `resolvePackage`. Овнер
 * контрактов назвал шов вслух со своей стороны и передал сведение сюда; вот
 * разбор с этой.
 *
 * **Вопросы у нас РАЗНЫЕ, а предмет — ОДИН, и это не одно и то же.** Сверху
 * спрашивают про разное: контракты — «где лежит содержимое обвеса с такой
 * ЛИЧНОСТЬЮ» (для чужого рантайм-кода у потребителя), дверь — «какие обвесы
 * объявлены и что каждый объявляет» (чтобы разложить). Разные входы, разные
 * ответы, разные вызывающие. Но СЛОЙ, который продублирован, ни тот и ни
 * другой: это «по имени пакета — где он у потребителя и что в его манифесте».
 * Личность против имени живёт этажом выше, у вызывающих; здесь имя с обеих
 * сторон. Один вопрос — один предмет.
 *
 * **Значит сводить, а не называть разными.** Правило `kb:BASER2-2` («дублировать
 * словарь дешевле, чем связывать зоны, но дубль обязан быть громким») этот
 * случай не покрывает по обоим концам:
 *
 *   · дублируется не словарь, а ПОВЕДЕНИЕ. Расхождение словаря громкое по
 *     построению — незнакомое слово даёт названный отказ на первом прогоне.
 *     Расхождение резолва МОЛЧАЛИВОЕ: обе стороны отработают успешно, просто на
 *     разных пакетах, и дверь разложит из одного, а хук обвеса прочитает свой
 *     эталон из другого. Комментарием такое громким не сделать;
 *   · «дешевле, чем связывать зоны» здесь не считается: зоны УЖЕ связаны —
 *     `@omnifield/baser-cli` зависит от `@omnifield/baser-contracts`, стрелка
 *     идёт в нужную сторону (контракты ниже), и нового ребра сведение не заводит.
 *
 * **Почему не сведено этим заходом.** Отдать факт наружу может только владелец
 * нижней зоны: `@omnifield/baser-contracts/locate` публикует `locateSource` и
 * `locateSourceContent`, а резолв по ИМЕНИ у него внутренний, и обе наши
 * функции по личности не заменяют — дверь идёт в обратную сторону (имя из
 * перечня → объявление → личность). Расширение чужого входа — заход зоны
 * контрактов, и он эскалирован вверх.
 *
 * **Пока не сведено — дубль держится машинно, а не на слове** (`resolve-seam.spec.ts`):
 * обе стороны гоняются по одному дереву и обязаны найти ОДИН И ТОТ ЖЕ пакет,
 * включая обход вверх и раскладку выше корня. Разъедутся — краснеет эта зона.
 */
export function resolveInstalledPackage(
  packageName: string,
  repoRoot: string,
): InstalledResult {
  const require = createRequire(join(repoRoot, 'package.json'));

  // Прямой путь — `exports` пакета обязан отдавать свой манифест (наши пакеты
  // отдают). Пакеты, закрывшие его, разбираются обходом вверх ниже: манифест
  // обвеса нужен по построению — в нём лежит объявление.
  let manifestPath: string | null = null;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    manifestPath = manifestByWalkingUp(require, packageName);
  }

  if (manifestPath === null) {
    return {
      ok: false,
      failure: {
        reason: 'not-found',
        detail:
          `пакет "${packageName}" не резолвится из "${repoRoot}" — ` +
          'он назван в конфиге, но не поставлен',
      },
    };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (cause) {
    return {
      ok: false,
      failure: {
        reason: 'manifest-unreadable',
        detail: `"${manifestPath}" не разбирается как JSON: ${describe(cause)}`,
      },
    };
  }

  const head = manifest as { name?: unknown; version?: unknown };
  return {
    ok: true,
    value: {
      packageName,
      // Пустая строка сюда тоже не проходит: она притворялась бы версией, а
      // движок такой вход отвергает отказом. «Версии нет» и «версия пустая» —
      // одно состояние, и называется оно одним значением.
      version:
        typeof head.version === 'string' && head.version.trim() !== ''
          ? head.version
          : null,
      root: dirname(manifestPath),
      manifest,
    },
  };
}

/**
 * Манифест пакета, закрывшего `./package.json` в `exports`.
 *
 * Идём от точки входа вверх до `package.json` с тем же именем: подниматься до
 * первого попавшегося нельзя — у вложенной зависимости он бы тоже нашёлся, и
 * дверь прочитала бы объявление не того пакета.
 */
function manifestByWalkingUp(
  require: NodeJS.Require,
  packageName: string,
): string | null {
  let dir: string;
  try {
    dir = dirname(require.resolve(packageName));
  } catch {
    return null;
  }

  for (let current = dir; ; current = dirname(current)) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: unknown;
        };
        if (parsed.name === packageName) {
          return candidate;
        }
      } catch {
        // Битый манифест по дороге наверх не должен обрывать поиск: искомый
        // может лежать выше. Непригодность НАЙДЕННОГО назовёт вызывающий.
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
  }
}

/**
 * Где лежит источник шаблонов относительно дерева потребителя.
 *
 * Движок адресует источник репо-относительным путём и этим же путём защищается
 * от записи в собственный источник (`dest-in-content-root`, `scan.exclude`).
 * Когда пакет поставлен внутрь дерева (`node_modules/…` — штатная раскладка),
 * такой путь есть, дверь подаёт его как есть, и защита настоящая.
 *
 * Когда пакет резолвится ВНЕ дерева (hoisting на корень workspace, `npm link`,
 * глобальная установка), репо-относительного пути не существует вовсе. Подделать
 * его нельзя: подделка выглядела бы как защита, а защищала бы пустоту — и
 * настоящий источник, окажись он потом внутри дерева по другому пути, остался бы
 * незакрытым. Поэтому факт называется формой, а не заменяется правдоподобием.
 */
export type SourceLocation =
  /** Источник внутри дерева: путь есть, защита движка работает в полную силу. */
  | { readonly kind: 'in-tree'; readonly path: string }
  /**
   * Источника в этом дереве нет. Защита вырождена ПО ПОСТРОЕНИЮ, а не по
   * недосмотру: писать вне корня дерева движок не может вообще.
   */
  | { readonly kind: 'outside-tree'; readonly absolute: string };

export function locateContentRoot(
  repoRoot: string,
  packageRoot: string,
  contentRoot: string,
): SourceLocation {
  const templates = resolve(packageRoot, contentRoot);
  // Симлинки снимаются с обеих сторон: pnpm кладёт пакет ссылкой в
  // `node_modules`, и сравнение ссылки с реальным корнем разъехалось бы на
  // ровном месте. Путь, которого ещё нет, сравнивается как есть — его
  // непригодность назовёт движок отказом `missing-source` по своей записи.
  const real = (path: string): string =>
    existsSync(path) ? realpathSync(path) : path;

  const inside = relative(real(repoRoot), real(templates));

  if (
    inside === '' ||
    isAbsolute(inside) ||
    inside === '..' ||
    inside.startsWith(`..${sep}`)
  ) {
    return { kind: 'outside-tree', absolute: templates };
  }

  return { kind: 'in-tree', path: inside.split(sep).join('/') };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
