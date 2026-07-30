/**
 * ПОДСТАНОВКА ЗНАЧЕНИЙ — обязательство двери целиком.
 *
 * Движок значений не получает вовсе: он берёт ГОТОВОЕ содержимое через порт
 * `CanonSource` и кладёт артефакт целиком (`tasker:BASER2-23`). Значит читать
 * шаблон с диска, спрашивать форму, на том ли он языке, подставлять значения и
 * исполнять `render: false` — здесь и больше нигде.
 *
 * Три обязательства, и ни одно не «настройка рендерера»:
 *
 * **`checkTemplate` ДО рендера.** Что разрешено — решает форма, а не дверь
 * (README контрактов §5а). Шаблон на чужом языке EJS отрендерил бы САМ В СЕБЯ:
 * артефакт лёг бы к потребителю с неподставленным `{{ name }}` и ничем бы себя
 * не выдал. Проверка стоит перед каждым рендером, а не отдельным тестом.
 *
 * **Ноль HTML-экранирования.** Артефакты — это JSON и shell, а не разметка
 * страницы: кавычка обязана остаться кавычкой, иначе валидный
 * `devcontainer.json` перестаёт быть JSON. Держится это тем, что форма запрещает
 * `<%=` (проверкой выше), а дверь не подменяет `escape`.
 *
 * **`render: false` — байт в байт.** Это уже не шаблон, а содержимое: пин
 * toolchain по digest, бинарь, файл, который обязан лечь как есть. Языком формы
 * такое не меряется и через шаблонизатор не проходит вовсе.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import ejs from 'ejs';
import {
  checkTemplate,
  type SettingValue,
  type SourceDeclaration,
} from '@omnifield/baser-contracts';
import { toRepoPath, type CanonSource } from '@omnifield/baser-materialize';
import { DoorProblemLog, type DoorProblem } from './problems.js';
import type { InstalledPackage } from './installed.js';

export interface RenderedLayout {
  /**
   * Готовое содержимое по `src`.
   *
   * Ключ — КАНОНИЧНАЯ форма пути от самого движка (`toRepoPath`), а не строка из
   * объявления: движок приводит `src` к ней перед обращением к порту, и
   * разъехавшись в написании (`./a.ejs` против `a.ejs`), дверь отдала бы `null`
   * на собственный же шаблон, а движок назвал бы его пропавшим.
   */
  readonly bySrc: ReadonlyMap<string, string>;
  readonly problems: readonly DoorProblem[];
  /**
   * Пересчитать ОДИН шаблон на других значениях. Диска не касается.
   *
   * Нужно ровно одному: восстановлению прежнего конца движения
   * (`previous.ts`, `tasker:BASER2-38`). Прежние значения нигде не хранятся, а
   * разложенный артефакт — их отпечаток, и прочитать его можно только тем же
   * шаблоном, которым он положен. Поэтому подстановка остаётся ЗДЕСЬ: второй
   * вызов `ejs` в соседнем файле был бы вторым местом, где решается вопрос про
   * экранирование, и разошёлся бы с этим при первой же правке.
   *
   * `null` — шаблона под этим `src` нет, он не рендерится вовсе (`render: false`)
   * либо подстановка сорвалась. Все три случая для восстановления значат одно:
   * доказать нечем, и утверждать нечего.
   */
  rerender(
    src: string,
    values: Readonly<Record<string, SettingValue>>,
  ): string | null;
}

/**
 * Читает шаблоны обвеса с диска и готовит содержимое каждого артефакта.
 *
 * Сбой одной записи не уносит остальные: отказы копятся списком, как и во всей
 * форме, — три непригодных шаблона это три отказа, а не один прогон на штуку.
 */
export function renderLayout(
  declaration: SourceDeclaration,
  pkg: InstalledPackage,
  values: Readonly<Record<string, SettingValue>>,
): RenderedLayout {
  const log = new DoorProblemLog();
  const bySrc = new Map<string, string>();
  /** Тексты шаблонов, прошедших проверку формы, — материал для пересчёта. */
  const templates = new Map<string, string>();
  const templatesRoot = resolvePath(pkg.root, declaration.source.contentRoot);

  for (const entry of declaration.layout) {
    const canonical = toRepoPath(entry.src);
    if (!canonical.ok) {
      // Непригодный путь записи назовёт движок своим отказом `invalid-path` по
      // своей записи — дублировать его здесь значило бы держать инвариант в
      // двух местах и разойтись в формулировке при первой же правке.
      continue;
    }

    const at = `${pkg.packageName}/${declaration.source.contentRoot}/${entry.src} → ${entry.dest}`;
    const file = resolvePath(templatesRoot, entry.src);

    let template: string;
    try {
      template = readFileSync(file, 'utf-8');
    } catch (cause) {
      log.add(
        'template-unreadable',
        at,
        `шаблон "${file}" не читается: ${describe(cause)}`,
      );
      continue;
    }

    if (!entry.render) {
      bySrc.set(canonical.path, template);
      continue;
    }

    const problems = checkTemplate(template, at);
    if (problems.length > 0) {
      log.addAll(problems);
      continue;
    }

    try {
      // Область видимости шаблона — ТОЛЬКО разрешённые значения по именам.
      // Ни контекста резолвера, ни окружения, ни файловой системы: всё, что
      // обвесу нужно вычислить, посчитал его резолвер и приехало настройкой.
      bySrc.set(canonical.path, ejs.render(template, { ...values }, {}));
      templates.set(canonical.path, template);
    } catch (cause) {
      log.add('render-failed', at, `подстановка сорвалась: ${describe(cause)}`);
    }
  }

  return {
    bySrc,
    problems: log.list(),
    rerender(src, other) {
      const template = templates.get(src);
      if (template === undefined) {
        return null;
      }
      try {
        return ejs.render(template, { ...other }, {});
      } catch {
        // Подстановка на подобранных значениях имеет полное право сорваться:
        // подбор — это гипотеза. Сорвалась — гипотеза не подтвердилась, и
        // отказом прогона это не становится.
        return null;
      }
    },
  };
}

/**
 * Порт источника для движка: содержимое уже готово, читать нечего.
 *
 * Адрес для сообщений указывает на пакет обвеса, а не на путь в дереве
 * потребителя: шаблон физически лежит там, и человек, которому план сказал
 * «шаблон не найден», обязан идти чинить его туда, а не искать в своём
 * репозитории файл, которого там нет и не должно быть.
 */
export function createDoorSource(
  rendered: RenderedLayout,
  declaration: SourceDeclaration,
  pkg: InstalledPackage,
): CanonSource {
  return {
    read(src) {
      return rendered.bySrc.get(src) ?? null;
    },
    describe(src) {
      return `${pkg.packageName}/${declaration.source.contentRoot}/${src}`;
    },
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
