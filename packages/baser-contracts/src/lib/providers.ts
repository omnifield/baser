/**
 * ОДИН АРТЕФАКТ — ОДИН ПОСТАВЩИК (`kb:BASER2-6`).
 *
 * Проверка над всеми поставленными обвесами сразу: каждый `dest` встречается
 * ровно один раз. Столкновение называется вслух и **порядком записей не
 * разрешается** — ни в объявлении, ни в конфиге потребителя.
 *
 * Почему это инвариант, а не неудобство: движок кладёт артефакт ЦЕЛИКОМ от
 * одного владельца. Свести вклад двоих можно было бы только сведением версий, а
 * оно отменено насмерть. Значит выбора нет: либо файл целиком чей-то один, либо
 * его не существует. Совладения не бывает.
 *
 * Разложить обвес на «базовый + надстройку» двумя источниками поэтому нельзя:
 * уровни выражаются ПРЕСЕТОМ внутри одного обвеса.
 */

import type { SourceDeclaration } from './declaration.js';
import { byBytes } from './paths.js';
import { ProblemLog, type FormResult } from './problems.js';

/** Поставленный обвес: что объявил и чем привезли. */
export interface InstalledSource {
  readonly declaration: SourceDeclaration;
  /** Имя пакета — из конфига потребителя, для адреса в сообщении. */
  readonly packageName: string;
}

/** Кто владеет артефактом в репозитории потребителя. */
export interface ArtifactOwner {
  readonly sourceId: string;
  readonly packageName: string;
  /** Шаблон, из которого артефакт перегенерируется целиком. */
  readonly src: string;
  readonly render: boolean;
}

/** Путь артефакта → его единственный владелец. */
export type ArtifactOwners = Readonly<Record<string, ArtifactOwner>>;

/**
 * Сводит раскладки всех обвесов в одну карту владения либо называет
 * столкновения.
 *
 * Отдельная от разбора проверка потому, что столкновение — свойство НАБОРА:
 * каждый обвес поодиночке безупречен, непригодна их комбинация.
 */
export function checkSingleProvider(
  sources: readonly InstalledSource[],
): FormResult<ArtifactOwners> {
  const log = new ProblemLog();
  const owners: Record<string, ArtifactOwner> = {};
  const byId = new Map<string, InstalledSource>();

  for (const installed of sources) {
    const { declaration, packageName } = installed;
    const id = declaration.source.id;

    const twin = byId.get(id);
    if (twin) {
      // Идентичность — то, за что цепляются владение и форк. Две одинаковые
      // делают владение неразличимым: снять один обвес, не задев второй, нельзя.
      log.add(
        'duplicate-source-id',
        `${packageName}.source.id`,
        `идентичность "${id}" уже объявлена пакетом "${twin.packageName}" — ` +
          'по ней группируется владение, двух одинаковых не бывает',
      );
      continue;
    }
    byId.set(id, installed);

    for (const entry of declaration.layout) {
      const held = owners[entry.dest];
      if (held) {
        log.add(
          'artifact-shared',
          `${packageName}.layout → ${entry.dest}`,
          `артефакт "${entry.dest}" уже кладёт обвес "${held.sourceId}" (${held.packageName}); ` +
            `на него же целится "${id}" (${packageName}). Один артефакт — один поставщик: ` +
            'движок кладёт файл целиком от одного владельца, свести вклад двоих нечем. ' +
            'Уровни выражаются пресетом внутри одного обвеса, а не вторым обвесом поверх',
        );
        continue;
      }
      owners[entry.dest] = {
        sourceId: id,
        packageName,
        src: entry.src,
        render: entry.render,
      };
    }
  }

  return log.result(() => sortedOwners(owners));
}

/** Порядок ключей стабилен: карта владения уезжает в машинночитаемый вывод. */
function sortedOwners(owners: Record<string, ArtifactOwner>): ArtifactOwners {
  const sorted: Record<string, ArtifactOwner> = {};
  for (const dest of Object.keys(owners).sort(byBytes)) {
    sorted[dest] = owners[dest];
  }
  return sorted;
}
