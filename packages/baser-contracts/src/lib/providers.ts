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
 *
 * Здесь же — ещё два свойства набора, и причина у всех трёх одна: совладения не
 * бывает ни у артефакта, ни у файла, в который пишет человек.
 *
 * - у двух обвесов не бывает одного файла настроек (`source-config-shared`);
 * - артефакт не ложится по адресу файла настроек — своего или соседского
 *   (`artifact-over-source-config`).
 */

import type { ArtifactClass } from './classes.js';
import { sourceConfigPath } from './config.js';
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
  /** Шаблон, из которого артефакт берётся. */
  readonly src: string;
  readonly render: boolean;
  /**
   * Чем станок держит артефакт (`classes.ts`). Едет вместе с владением, потому
   * что читатель у них один: план строится по карте владения, а класс — то, что
   * план обязан про артефакт сказать (`tasker:BASER2-51`).
   */
  readonly class: ArtifactClass;
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
  const byConfigFile = new Map<string, string>();

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

    // Имя файла настроек считается из личности, поэтому у двух РАЗНЫХ обвесов
    // оно почти всегда разное — но не гарантированно: слеш становится дефисом, а
    // дефис в сегменте личности законен, и "a-b/c" сходится с "a/b-c". Один файл
    // на двоих означал бы, что каждый называет чужие ключи опечатками, — молча
    // такое не оставляем.
    const configPath = sourceConfigPath(id);
    const sharing = byConfigFile.get(configPath);
    if (sharing) {
      log.add(
        'source-config-shared',
        `${packageName}.source.id`,
        `личности "${sharing}" и "${id}" дают один файл настроек "${configPath}" — ` +
          'человеку негде настроить их порознь, а каждый из двоих назвал бы чужие ключи ' +
          'незнакомыми. Личности обязаны различаться и после того, как слеш стал дефисом',
      );
      continue;
    }
    byConfigFile.set(configPath, id);

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
        class: entry.class,
      };
    }
  }

  // Последним — пересечение двух списков, которое видно только когда собраны оба:
  // артефакт не имеет права лечь по адресу файла настроек. Тот файл заполняет
  // ЧЕЛОВЕК, записью раскладки он не является и в паспорте укладки не числится
  // (`kb:BASER2-5`), — значит владеть им некому, а перегенерация затирала бы
  // настроенное. Проверка НАБОРА, потому что чужой файл настроек виден только
  // рядом с чужим объявлением.
  for (const dest of Object.keys(owners).sort(byBytes)) {
    const settingsOf = byConfigFile.get(dest);
    if (settingsOf === undefined) {
      continue;
    }
    const owner = owners[dest];
    log.add(
      'artifact-over-source-config',
      `${owner.packageName}.layout → ${dest}`,
      `обвес "${owner.sourceId}" кладёт артефакт "${dest}" — это файл настроек обвеса ` +
        `"${settingsOf}", который заполняет человек. Он не запись раскладки и в паспорте ` +
        'укладки не числится: владеть им нечем, а перегенерация затирала бы настроенное. ' +
        'Артефакту в этой папке нужен другой адрес',
    );
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
