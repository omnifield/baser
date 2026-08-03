/**
 * ФАЗА 1 — ПЛАН.
 *
 * План — это ДАННЫЕ, а не побочка: он вычисляется и читается ДО применения
 * («две фазы»; рынок подтвердил разрыв дважды независимо — `nx migrate`
 * разносит его на две команды, схематики — на две фазы).
 *
 * План машинночитаем в первую очередь: вид шага, причина шага, вид конфликта и
 * вид извещения — стабильные МАШИННЫЕ КОДЫ, подробности причины лежат данными в
 * `detail`, а `message` — рендер для человека. Ветвиться по тексту сообщения
 * нельзя ни гейту, ни панели; `describePlan` — один из выходов, а не
 * единственный.
 *
 * ЧТО ДЕЛАЕТ ДВИЖОК С ОБЪЯВЛЕННЫМ АРТЕФАКТОМ — ровно одно: кладёт содержимое,
 * которое ему дали, целиком и как есть (`kb:BASER2-2`, модель A). Режимов нет,
 * сведения версий нет ни под каким флагом, СОДЕРЖИМОЕ ДВИЖОК НЕ ТРОГАЕТ —
 * поэтому `render: false` ложится байт в байт, а класс файла перестал быть
 * условием владения.
 *
 * ВЛАДЕНИЕ ВЫВОДИТСЯ ИЗ МАНИФЕСТА СБОКУ (`manifest.ts`), а не из наклейки
 * внутри файла. Отсюда инварианты этой фазы:
 *   §1 идемпотентность — сошедшийся артефакт НЕ порождает шага;
 *   §2 запись обязана утверждать объявленное СЕЙЧАС — расхождение записи с
 *      декларацией даёт шаг приведения, даже когда содержимое совпало
 *      (`tasker:BASER2-16`, Д10: это ровно то место, где прошлая модель врала);
 *   §3 отсутствие сирот — запись, потерявшая объявление, попадает в план на
 *      снятие; ищутся сироты ПО ЗАПИСЯМ, а не сканом дерева, поэтому слепых зон
 *      у поиска нет по построению;
 *   §4 отказ вместо тихой перезаписи — конфликт владения попадает в
 *      `conflicts`, а не в `steps`, и делает план неприменимым;
 *   §5 показать расхождение — каждый шаг несёт `previous`, чтобы раннер мог
 *      показать разницу, а план — НАЗВАТЬ ПОТЕРИ до применения.
 *
 * ВЛАДЕНИЕ ВЕДЁТСЯ ПО КАЖДОМУ ОБВЕСУ ОТДЕЛЬНО (`tasker:BASER2-7`). Прогон идёт
 * по ОДНОЙ декларации, а манифест — общий на репозиторий: несколько обвесов
 * одновременно есть норма по построению (`kb:BASER2-4`), и второй инструмент не
 * имеет права снимать файлы первого. Поэтому декларация ограничивает не только
 * то, что кладётся, но и то, что вообще рассматривается:
 *   — сироты ищутся среди записей ЭТОГО обвеса (`record.source`); чужая запись
 *     без объявления — не сирота, а чужое хозяйство;
 *   — `dest`, уже числящийся за другим обвесом, — отказ `cross-source-dest`:
 *     столкновение двух инструментов на один путь НАЗЫВАЕТСЯ вслух и не
 *     разрешается ни порядком записей, ни порядком прогонов (`kb:BASER2-6`).
 *
 * ЧТО ДЕЛАТЬ С ФАЙЛОМ, РЕШАЕТ ОБВЕС — КЛАССОМ АРТЕФАКТА (`tasker:BASER2-51`,
 * `classes.ts`). Движок класс ИСПОЛНЯЕТ и не выводит: станку незачем разбираться
 * в семантике чужих файлов (`kb:BASER2-2`, «Станок даёт инструменту руки, а не
 * решения»). Инварианты §1–§5 выше от этого не меняются — меняется то, ЧТО
 * считается расхождением:
 *   — `regenerated` — как было: содержимое сверяется с шаблоном, разошлось —
 *     перекладываем целиком, потеряло объявление — снимаем;
 *   — `placed-once` — содержимое не сверяется ВОВСЕ и хеш не пишется вовсе;
 *     правка человека расхождением не считается; запись, потерявшая объявление,
 *     не уходит сиротой молча, а называется извещением и снимается только
 *     поимённым подтверждением; пропал сам артефакт — кладём заново.
 *
 * ПАСПОРТ УКЛАДКИ НЕСЁТ ВЕРСИЮ ОБВЕСА (`tasker:BASER2-52`). Движок её не
 * интерпретирует и по semver не сравнивает — он её хранит и следит, чтобы запись
 * утверждала СЕГОДНЯШНЮЮ (§2): подъём версии при том же содержимом даёт шаг
 * `record`, а не молчание.
 */

import type { Tree } from '@nx/devkit';
import type { ArtifactClass } from './classes.js';
import {
  ARTIFACT_CLASSES,
  DEFAULT_ARTIFACT_CLASS,
  isArtifactClass,
} from './classes.js';
import type { Declaration, LayoutEntry } from './declaration.js';
import type { CanonSource } from './source.js';
import { createTreeSource } from './source.js';
import { DeclarationError, SourceOutsideTreeError } from './errors.js';
import type { Manifest, ManifestRecord } from './manifest.js';
import { MANIFEST_PATH, hashContent, readManifest } from './manifest.js';
import type { TraceRecorder, TraceSpan } from './trace.js';
import { createTrace } from './trace.js';
import {
  byBytes,
  normalizeRepoPath,
  REPO_PATH_PROBLEM,
  toRepoPath,
} from './paths.js';
import type { RepoPathProblem } from './paths.js';
import { OUTPUT_SCHEMA_VERSION } from './schema.js';

export type PlanStepKind =
  | 'create'
  | 'update'
  | 'delete'
  /**
   * Привести СЛУЖЕБНУЮ ЗАПИСЬ, не трогая содержимое артефакта.
   *
   * Содержимое уже целевое, а запись утверждает не то, что объявлено сейчас, —
   * и это обязано быть шагом, а не тихой правкой на применении: план, молчащий
   * про работу, которую он всё равно сделает, рапортует сходимость там, где её
   * нет (`tasker:BASER2-16`, Д10).
   */
  | 'record';

export type PlanReason =
  /** Объявленного артефакта нет — материализуем впервые. */
  | 'missing'
  /** Содержимое разошлось с тем, что даёт источник сейчас. */
  | 'diverged'
  /** Существовавший артефакт без записи впервые берётся во владение. */
  | 'adopted'
  /**
   * Запись не утверждает объявленное сейчас: другой `src`, другой хеш
   * положенного, другой класс артефакта, другая версия обвеса — либо записи нет
   * вовсе. Что именно разъехалось, шаг называет в `restated`.
   */
  | 'reclaimed'
  /** Запись потеряла объявление в `layout`. */
  | 'orphan';

/**
 * Поле служебной записи — единица расхождения записи с объявленным.
 *
 * Названо перечислением, а не строкой: по нему ветвятся панель и гейт («подняли
 * версию» это не то же событие, что «сменился шаблон»), а строка позволила бы
 * молча разъехаться с формой записи.
 */
export type RecordField = 'src' | 'hash' | 'class' | 'version';

/** Один шаг плана. */
export interface PlanStep {
  readonly kind: PlanStepKind;
  readonly dest: string;
  readonly reason: PlanReason;
  readonly src?: string;
  /**
   * Поля записи, которые шаг приводит к объявленному, — только у `reclaimed`.
   *
   * План обязан НАЗЫВАТЬ, а не только делать: «запись разошлась» без указания,
   * чем именно, оставляет потребителю ровно то гадание, ради отмены которого
   * план вообще существует. У шага, где прежней записи не было (`missing`,
   * `adopted`), приводить нечего, и поля здесь нет.
   */
  readonly restated?: readonly RecordField[];
  /**
   * Целевое содержимое артефакта: `null` у `delete` (снимаем) и у `record`
   * (содержимое не трогаем вовсе).
   */
  readonly content: string | null;
  /** Текущее содержимое до применения — материал для показа расхождения. */
  readonly previous: string | null;
  /** Запись, которая окажется в манифесте после шага; `null` у `delete`. */
  readonly record: ManifestRecord | null;
}

export type ConflictKind =
  /** Две записи `layout` претендуют на один `dest`. */
  | 'duplicate-dest'
  /**
   * `dest` уже числится за ДРУГИМ обвесом: два инструмента столкнулись на один
   * путь. От `duplicate-dest` отличается стороной столкновения — там две записи
   * одной декларации, здесь два обвеса, каждый из которых прогоняется своей.
   *
   * Подтверждением НЕ снимается: перехват сделал бы владение функцией порядка
   * прогонов — обвесы отбирали бы файл друг у друга по кругу, и каждый прогон
   * рапортовал бы работу на сошедшемся дереве (`kb:BASER2-6`).
   */
  | 'cross-source-dest'
  /** `dest` существует, а записи о нём нет — артефакт не наш. */
  | 'foreign-dest'
  /**
   * Объявленное состояние физически недостижимо: сегмент пути `dest` занят
   * файлом — объявленным другой записью или уже лежащим в дереве. Виртуальное
   * дерево такое терпит, реальная ФС — нет.
   */
  | 'unreachable-dest'
  /** `dest` лежит внутри `contentRoot` — движок писал бы в собственный источник. */
  | 'dest-in-content-root'
  /**
   * `dest` — это сам манифест: движок писал бы поверх собственной служебной
   * записи, и прогон не сошёлся бы никогда.
   */
  | 'dest-is-manifest'
  /** Источник `src` не найден. */
  | 'missing-source'
  /**
   * Запись раскладки объявлена классом, которого движок не знает.
   *
   * Умолчанием НЕ подменяется: класс говорит, чем станок держит артефакт, и
   * принять незнакомое слово за `regenerated` значило бы перегенерировать поверх
   * файла, который обвес объявил человеческим, — молча и ровно один раз, потому
   * что второго такого файла у человека не будет. Это же и страховка словаря:
   * приедет третий класс (`kb:WEBER-4`) — движок скажет об этом на первом
   * прогоне, а не сделает вид, что понял.
   */
  | 'unknown-artifact-class'
  /**
   * Путь записи раскладки непригоден: пуст, абсолютен или выходит за корень
   * дерева. Границу дерева движок держит сам — он тот, кто пишет.
   */
  | 'invalid-path'
  /**
   * Обработка ЭТОЙ записи сорвалась исключением (битый порт источника, сбойное
   * дерево). Отказ привязан к своему `dest`: сбой на одной записи не имеет
   * права уносить план целиком.
   */
  | 'entry-failed';

/**
 * Машинные подробности причины отказа.
 *
 * Всё, о чём говорит `message`, доступно здесь данными: `message` — рендер, а
 * не единственный носитель причины.
 */
export interface ConflictDetail {
  /** `duplicate-dest`: `src` записи, уже claim'нувшей этот `dest`. */
  readonly claimedBy?: string;
  /** `cross-source-dest`: идентичность обвеса, за которым числится артефакт. */
  readonly ownedBy?: string;
  /** `missing-source`: полный адрес источника, которого нет. */
  readonly sourcePath?: string;
  /**
   * Чем отказ снимается: `foreign-dest` — подтверждением, `cross-source-dest` —
   * только снятием записи из раскладки одного из обвесов.
   *
   * Код совпадает с именем механизма в API (`PlanOptions.confirm`): панель,
   * показавшая одно имя, и вызов, требующий другого, — расхождение, которое
   * всплывёт у потребителя. Значение, отличное от `confirm`, — машинный признак
   * того, что подтверждение по этому `dest` бесполезно.
   */
  readonly resolution?: 'confirm' | 'drop-layout-entry';
  /** `unreachable-dest`: путь, который занят файлом и перекрывает `dest`. */
  readonly blockedBy?: string;
  /** `unreachable-dest`: чем именно занят перекрывающий путь. */
  readonly collision?: 'declared-dest' | 'existing-file' | 'existing-directory';
  /** `dest-in-content-root`: корень содержимого источника из декларации. */
  readonly contentRoot?: string;
  /** `dest-is-manifest`: где лежит служебная запись. */
  readonly manifestPath?: string;
  /** `entry-failed`: сообщение исключения, сорвавшего обработку записи. */
  readonly failure?: string;
  /** `invalid-path`: какое поле записи непригодно. */
  readonly field?: 'src' | 'dest';
  /** `invalid-path`: сам путь, как он пришёл. */
  readonly path?: string;
  /** `invalid-path`: чем именно путь непригоден. */
  readonly pathProblem?: RepoPathProblem;
  /**
   * `unknown-artifact-class`: класс, как он пришёл во входной структуре.
   *
   * Строка, а не `ArtifactClass`: сюда попадает ровно то, чего движок НЕ знает,
   * и типизировать его известным перечислением значило бы соврать про причину.
   */
  readonly artifactClass?: string;
}

export interface PlanConflict {
  readonly kind: ConflictKind;
  readonly dest: string;
  readonly src?: string;
  /**
   * Класс, которым обвес держал бы этот артефакт (`tasker:BASER2-141`).
   *
   * СТОИТ ТАМ, ГДЕ ОТКАЗ ПРОСИТ ПОДТВЕРЖДЕНИЯ (`detail.resolution === 'confirm'`):
   * именно там класс решает, что подтверждение сделает. Вопрос перед `confirm`
   * у потребителя ровно один — «отдать во владение значит ли потерять
   * содержимое?», — и ответ зависит от класса и больше ни от чего. Движок класс
   * уже знает: он его исполняет. Живой случай показал цену молчания — шестнадцать
   * отказов подряд отличались только именем файла, и класс человек вытащил
   * дедукцией по счётчику в трейсе.
   *
   * ПОЛЕМ ЗАПИСИ, А НЕ `detail`: класс — свойство артефакта, как `dest` и `src`,
   * а не подробность причины отказа. В `detail.artifactClass` лежит другое —
   * строка, которой движок НЕ знает (`unknown-artifact-class`).
   *
   * У остальных кодов поля нет, и это не пробел:
   *   — `duplicate-dest` — записей две, и классы у них бывают разные: назвать
   *     один значило бы соврать про вторую;
   *   — `cross-source-dest` — артефакт держит ДРУГОЙ обвес, и наш класс к нему
   *     отношения не имеет: его класс лежит в чужой записи манифеста;
   *   — `unknown-artifact-class` — класса нет по определению отказа;
   *   — `missing-source` · `unreachable-dest` · `dest-in-content-root` ·
   *     `dest-is-manifest` · `invalid-path` · `entry-failed` — подтверждение их
   *     не снимает, и класс не решает ничего.
   */
  readonly class?: ArtifactClass;
  /** Машинные подробности причины — источник истины для гейта и панели. */
  readonly detail: ConflictDetail;
  /** Человекочитаемое объяснение: рендер поверх `kind` + `detail`. */
  readonly message: string;
}

export type PlanNoticeKind =
  /**
   * Поданное подтверждение не понадобилось: по этому `dest` отказа не было
   * (или он вовсе не объявлен). Названо, чтобы «подтвердил, а ничего не
   * изменилось» не выглядело как молчание движка.
   */
  | 'confirmation-unused'
  /**
   * Запись класса `placed-once` потеряла объявление, и артефакт ОСТАВЛЕН
   * (`tasker:BASER2-51`).
   *
   * Не шаг, потому что движок ничего не делает; не отказ, потому что решать
   * нечего и прогон применим. Но и не молчание: выпиленная строка шаблона иначе
   * молча уносила бы файл, в котором человек месяц работал. Извещение стоит
   * ровно там, где `regenerated` уходит сиротой, и повторяется каждый прогон —
   * это не шум, а стоящее утверждение о состоянии репозитория.
   *
   * Снимается поимённым подтверждением того же `dest` — тем же адресным
   * согласием, что и перезапись чужого файла: явная команда, которая не
   * масштабируется сама.
   */
  | 'placed-once-retained';

/**
 * Извещение: состояние, которое обязано быть НАЗВАНО, но не является ни шагом,
 * ни отказом. Извещения не влияют на применимость плана и на сходимость.
 */
export interface PlanNotice {
  readonly kind: PlanNoticeKind;
  /** Артефакт, которого касается извещение. */
  readonly dest?: string;
  readonly src?: string;
  readonly detail: NoticeDetail;
  readonly message: string;
}

export interface NoticeDetail {
  /**
   * `confirmation-unused`: почему подтверждение не пригодилось.
   *
   * `not-required` — отказа по этому `dest` нет; `not-declared` — такой записи
   * нет в раскладке; `not-applicable` — отказ есть, но подтверждением он не
   * снимается (например, `cross-source-dest`). Третье значение отделено от
   * первого намеренно: «подтверждение не понадобилось» на артефакте, который
   * заблокирован, было бы прямой неправдой.
   */
  readonly confirmation?: 'not-required' | 'not-declared' | 'not-applicable';
  /** `placed-once-retained`: класс, из-за которого артефакт оставлен. */
  readonly artifactClass?: ArtifactClass;
  /**
   * Чем состояние снимается. У `placed-once-retained` — `confirm`, тем же
   * поимённым согласием, что и перезапись чужого файла.
   *
   * Слово то же, что в `ConflictDetail.resolution`, и это не совпадение: панель,
   * показавшая один рычаг для отказа и другой для извещения, отправила бы
   * человека искать несуществующую команду.
   */
  readonly resolution?: 'confirm';
}

/**
 * Состояние плана.
 *
 * Признак сходимости ОТДЕЛЁН от признака пустоты намеренно: план без шагов, но
 * с конфликтами, сходимости НЕ означает. Гейт, построенный на «в плане нет
 * шагов», отрапортовал бы «в каноне» при нерешённом конфликте владения — гейт,
 * зеленеющий на конфликте, опаснее отсутствующего.
 */
export type PlanStatus =
  /** Нечего делать и нечего решать: дерево сошлось с декларацией. */
  | 'converged'
  /** Есть шаги, конфликтов нет — план применим. */
  | 'pending'
  /** Есть нерешённые конфликты — план не применяется целиком. */
  | 'blocked';

export interface MaterializationPlan {
  /** Версия схемы вывода — контракт с панелью и скриптами. */
  readonly schemaVersion: number;
  /** Сходимость. `converged` учитывает и шаги, и конфликты. */
  readonly status: PlanStatus;
  readonly steps: readonly PlanStep[];
  readonly conflicts: readonly PlanConflict[];
  /** Названные состояния, не требующие ни шага, ни отказа. */
  readonly notices: readonly PlanNotice[];
  /** Куда движок положит служебную запись. */
  readonly manifestPath: string;
  /** Манифест, каким он станет после применения плана. */
  readonly manifest: readonly ManifestRecord[];
  readonly trace: readonly TraceSpan[];
}

export interface PlanOptions {
  readonly tree: Tree;
  readonly declaration: Declaration;
  /** Источник шаблонов; по умолчанию — дерево + `contentRoot` декларации. */
  readonly source?: CanonSource;
  /**
   * ПЕРЕЧЕНЬ `dest`, для которых перезапись чужого файла подтверждена
   * (семантика `--force-conflicts` из Kubernetes SSA, но адресная).
   *
   * Подтверждение — согласие на КОНКРЕТНОЕ действие, а не режим прогона.
   * **Согласие не масштабируется само** — артефакт вне перечня остаётся под
   * отказом. Что подтверждать, план называет сам: конфликты с
   * `detail.resolution`.
   */
  readonly confirm?: readonly string[];
  /** Где лежит манифест; по умолчанию `baser.lock.json` в корне дерева. */
  readonly manifestPath?: string;
  readonly trace?: TraceRecorder;
}

/** Применим ли план к дереву. Производная от `status`, а не отдельный признак. */
export function isApplicable(plan: MaterializationPlan): boolean {
  return plan.status !== 'blocked';
}

/**
 * Годен ли вход движку — и ТОЛЬКО это.
 *
 * Форму декларации разбирает дверь (валидаторы объявления, настроек, пресетов,
 * столкновений — зона контрактов). Здесь проверяется не форма, а пригодность
 * входа для работы движка.
 */
function requireUsableDeclaration(declaration: Declaration): void {
  const shape = (problem: string): never => {
    throw new DeclarationError(
      `движку подана структура не той формы: ${problem}. ` +
        'Собрать вход из объявления обвеса и конфига потребителя — забота двери',
    );
  };

  if (typeof declaration !== 'object' || declaration === null) {
    shape('ожидался объект { source, layout }');
  }
  if (!Array.isArray(declaration.layout)) {
    shape('layout — ожидался массив записей { src, dest }');
  }
  if (typeof declaration.source !== 'object' || declaration.source === null) {
    shape('source — ожидался объект { id, contentRoot }');
  }

  const { contentRoot } = declaration.source;

  // Источника в этом дереве нет — форма честная, и движок называет её сам, а не
  // вырождается в защиту, которой не за что зацепиться (`tasker:BASER2-24`).
  if (contentRoot === null) {
    throw new SourceOutsideTreeError(
      `источник обвеса "${declaration.source.id}" лежит вне дерева потребителя: ` +
        'репо-относительного пути к его шаблонам не существует, поэтому движок ' +
        'не может проверить, что не пишет в собственный источник. Поставь обвес ' +
        'в этот репозиторий',
    );
  }
  if (typeof contentRoot !== 'string') {
    shape(
      'source.contentRoot — ожидалась строка с корнем содержимого либо null, ' +
        'если источника в этом дереве нет',
    );
  }

  // Вырожденный корень («.», «/», пустая строка) означает, что источником
  // объявлено ВСЁ дерево. Тогда защита «движок не пишет в собственный источник»
  // отваливается — `isInside` от такого корня ложна, — и прогон затирает
  // шаблон, из которого сам же читает. Отказ вместо тихой порчи источника.
  if (!toRepoPath(contentRoot).ok) {
    throw new DeclarationError(
      `корень содержимого "${contentRoot}" непригоден: ` +
        'источником объявлено бы всё дерево, и движок писал бы поверх ' +
        'собственных шаблонов. Нужен путь к каталогу шаблонов внутри пакета',
    );
  }

  // Версия — необязательна, но НЕ бывает пустой. `null` и отсутствие означают
  // «источник версии не назвал» — состояние названное, оно так и ложится в
  // паспорт укладки и в трейс (извещения на него нет: событие знает дверь, а не
  // движок, — `declaration.ts`). Пустая же строка притворилась бы названной
  // версией и легла бы молчаливой пустотой (`tasker:BASER2-52`).
  const { version } = declaration.source;
  if (version !== undefined && version !== null) {
    if (typeof version !== 'string') {
      shape(
        'source.version — ожидалась строка с версией обвеса либо null, если ' +
          'источник её не назвал',
      );
    }
    if (version.trim() === '') {
      throw new DeclarationError(
        `версия обвеса "${declaration.source.id}" подана пустой строкой. ` +
          'Паспорт укладки записал бы молчаливую пустоту, выдающую себя за ' +
          'версию: не назвал версию — подавай null, это состояние движок ' +
          'называет вслух',
      );
    }
  }
}

/** Вычисляет план материализации. Дерево при этом НЕ меняется. */
export function computePlan(options: PlanOptions): MaterializationPlan {
  const { tree, declaration } = options;
  requireUsableDeclaration(declaration);

  const contentRoot = declaration.source.contentRoot as string;
  const sourceId = declaration.source.id;
  // Отсутствие версии приводится к `null` ЗДЕСЬ, один раз: дальше по движку
  // «версии нет» имеет ровно одно написание, и в паспорт укладки не может
  // просочиться `undefined`, которое сериализовалось бы пропуском ключа.
  const sourceVersion = declaration.source.version ?? null;
  const trace = options.trace ?? createTrace();
  const source = options.source ?? createTreeSource(tree, contentRoot);
  const manifestPath = options.manifestPath ?? MANIFEST_PATH;

  const confirm = new Set(
    (options.confirm ?? []).map((dest, index) =>
      normalizeRepoPath(dest, `confirm[${index}]`),
    ),
  );
  const consumed = new Set<string>();

  const steps: PlanStep[] = [];
  const conflicts: PlanConflict[] = [];
  let notices: PlanNotice[] = [];
  const claimed = new Map<string, LayoutEntry>();
  /** Каталог пути → `dest`, ради которого он обязан быть каталогом. */
  const claimedDirs = new Map<string, string>();

  const manifest = trace.span('plan.manifest', () =>
    readManifest(tree, manifestPath),
  );

  // Записи ЭТОГО обвеса — то, чем прогон вправе распоряжаться. Остальное в
  // манифесте принадлежит другим инструментам того же репозитория и в этом
  // прогоне не рассматривается вовсе.
  const ours = [...manifest.values()].filter(
    (record) => record.source === sourceId,
  );
  // Версия прогона — в телеметрии, а не только в файле: «этот прогон шёл
  // обвесом такой-то версии» это первое, что спрашивают, когда у потребителя
  // что-то поехало. `null` здесь такой же ответ, как строка.
  trace.event('plan.owned', {
    source: sourceId,
    version: sourceVersion,
    records: manifest.size,
    own: ours.length,
  });

  // Объявленные цели — в каноничной форме и без непригодных: по ним же
  // считаются сироты, поэтому написание должно быть одно.
  const declaredDests = new Set(
    declaration.layout
      .map((entry) => toRepoPath(entry?.dest as string))
      .filter((path): path is { ok: true; path: string } => path.ok)
      .map((path) => path.path),
  );

  /**
   * Записи ЭТОГО обвеса, потерявшие объявление.
   *
   * Ищутся ПО МАНИФЕСТУ, а не сканом дерева: у поиска по записям нет слепых
   * зон по построению, и пропуск каталогов ради скорости больше ничего не
   * прячет. Заодно исчезает целый класс дефектов прошлой модели — снятие
   * чужого файла, случайно похожего на наш.
   *
   * Отбор по `record.source` — не оптимизация, а само владение
   * (`tasker:BASER2-7`): декларация одного обвеса ничего не утверждает про
   * артефакты соседнего. Без этого отбора запись второго инструмента выглядела
   * бы записью без объявления, то есть сиротой, и прогон снимал бы чужие
   * файлы — поставил второй, снёсся первый.
   */
  const lost = ours.filter((record) => !declaredDests.has(record.dest));

  /**
   * Что из потерявшего объявление СНИМАЕТСЯ, а что остаётся у человека.
   *
   * `regenerated` уходит сиротой молча — он наш и всегда был наш. `placed-once`
   * НЕ уходит: снятие у него не автоматическое, а по явной команде, и команда
   * эта — поимённое подтверждение (`tasker:BASER2-51`). Иначе выпиленная строка
   * шаблона молча уносила бы файл, в котором человек месяц работал, — а второго
   * такого файла у него не будет.
   *
   * Класс берётся ИЗ ЗАПИСИ, а не из объявления, и другого источника тут быть
   * не может: объявления этой записи больше нет — ровно поэтому она и сирота.
   * Отсюда же требование хранить класс в паспорте укладки.
   */
  const removed = new Set(
    lost
      .filter(
        (record) =>
          record.class !== 'placed-once' || confirm.has(record.dest),
      )
      .map((record) => record.dest),
  );
  const retained = lost.filter((record) => !removed.has(record.dest));

  // Подтверждение, снявшее `placed-once`, пригодилось — иначе прогон отчитался
  // бы «подтверждение не понадобилось» ровно о том согласии, которым и снял
  // артефакт. У `regenerated`-сироты подтверждение и правда лишнее: она
  // снимается без него, и это состояние остаётся названным как прежде.
  for (const record of lost) {
    if (record.class === 'placed-once' && confirm.has(record.dest)) {
      consumed.add(record.dest);
    }
  }

  trace.span(
    'plan.layout',
    () => {
      for (const declared of declaration.layout) {
        // Пути приводятся к каноничной форме ЗДЕСЬ: движок сверяет объявленный
        // `dest` с ключами манифеста, и разъехавшись в написании, свежий
        // артефакт оказался бы сиротой сам себе.
        const entry = repoPathsOf(declared);
        if (entry === null) {
          conflicts.push(invalidPath(declared));
          continue;
        }

        // Класс, которого движок не знает, умолчанием НЕ подменяется: принять
        // незнакомое слово за `regenerated` значило бы перегенерировать поверх
        // файла, который обвес объявил человеческим. Отказ адресный — соседние
        // записи планируются как обычно.
        const declaredClass = declared.class;
        if (declaredClass !== undefined && !isArtifactClass(declaredClass)) {
          conflicts.push(unknownClass(entry, declaredClass));
          continue;
        }

        const previousClaim = claimed.get(entry.dest);
        if (previousClaim !== undefined) {
          // Спорный артефакт не получает ни шага, ни извещения: у файла под
          // двойной претензией нет решённого целевого состояния — есть отказ.
          const planned = steps.findIndex((step) => step.dest === entry.dest);
          if (planned >= 0) {
            steps.splice(planned, 1);
          }
          notices = notices.filter((notice) => notice.dest !== entry.dest);
          conflicts.push({
            kind: 'duplicate-dest',
            dest: entry.dest,
            src: entry.src,
            detail: { claimedBy: previousClaim.src },
            message:
              `конфликт владения: "${entry.dest}" объявлен дважды ` +
              `(src "${previousClaim.src}" и src "${entry.src}") — ` +
              'у артефакта может быть только одна запись layout',
          });
          continue;
        }

        // Сбой на ОДНОЙ записи не имеет права уносить план целиком: порт
        // источника и дерево приходят снаружи движка и могут бросить что
        // угодно. Отказ привязывается к своему `dest`.
        try {
          const unreachable = reachabilityConflict(entry, {
            tree,
            contentRoot,
            manifestPath,
            claimed,
            claimedDirs,
            removed,
          });
          if (unreachable !== null) {
            conflicts.push(unreachable);
            continue;
          }

          claimed.set(entry.dest, entry);
          for (const dir of ancestorsOf(entry.dest)) {
            if (!claimedDirs.has(dir)) {
              claimedDirs.set(dir, entry.dest);
            }
          }

          const outcome = planEntry(entry, {
            tree,
            source,
            sourceId,
            sourceVersion,
            manifest,
            confirmed: confirm.has(entry.dest),
          });

          if (outcome.step !== undefined) {
            steps.push(outcome.step);
          }
          if (outcome.conflict !== undefined) {
            conflicts.push(outcome.conflict);
          }
          if (outcome.confirmationUsed === true) {
            consumed.add(entry.dest);
          }
        } catch (cause) {
          conflicts.push(entryFailed(entry.dest, entry.src, cause));
        }
      }
    },
    {
      entries: declaration.layout.length,
      // Сколько записей обвес объявил человеческими. Видно должно быть в
      // телеметрии, а не выводиться на глаз: `placed-once` это ровно те файлы,
      // которых прогон НЕ касается, и «почему станок ничего не сделал»
      // отвечается этим числом.
      placedOnce: declaration.layout.filter(
        (item) => item?.class === 'placed-once',
      ).length,
    },
  );

  for (const dest of confirm) {
    if (consumed.has(dest)) {
      continue;
    }

    // Отказ, который подтверждением не снимается, обязан быть назван именно
    // так. Сказать «не понадобилось» про заблокированный артефакт значило бы
    // рапортовать согласие там, где движок всё равно ничего не сделает.
    const unyielding = conflicts.find(
      (conflict) =>
        conflict.dest === dest && conflict.detail.resolution !== 'confirm',
    );
    if (unyielding !== undefined) {
      notices.push({
        kind: 'confirmation-unused',
        dest,
        detail: { confirmation: 'not-applicable' },
        message:
          `подтверждение по "${dest}" этот отказ не снимает (${unyielding.kind}): ` +
          'согласие покрывает перезапись чужого файла, а не всякое препятствие',
      });
      continue;
    }

    const declared = declaredDests.has(dest);
    notices.push({
      kind: 'confirmation-unused',
      dest,
      detail: { confirmation: declared ? 'not-required' : 'not-declared' },
      message: declared
        ? `подтверждение по "${dest}" не понадобилось: отказа по этому артефакту нет`
        : `подтверждение по "${dest}" ни к чему не относится: такой записи нет в layout`,
    });
  }

  trace.span(
    'plan.orphans',
    () => {
      for (const dest of removed) {
        try {
          steps.push(
            planOrphan(tree, dest, manifest.get(dest) as ManifestRecord),
          );
        } catch (cause) {
          conflicts.push(entryFailed(dest, manifest.get(dest)?.src, cause));
        }
      }

      // Оставленный артефакт — не шаг и не отказ, но и не молчание.
      for (const record of retained) {
        notices.push({
          kind: 'placed-once-retained',
          dest: record.dest,
          src: record.src,
          detail: { artifactClass: record.class, resolution: 'confirm' },
          message:
            `"${record.dest}" положен однажды, а объявления в раскладке больше ` +
            'нет: артефакт и запись о нём остаются — снятие у класса ' +
            '"placed-once" не автоматическое. Снять — подтверди этот dest ' +
            'поимённо; молча выпиленная строка шаблона файл не уносит',
        });
      }
    },
    { orphans: removed.size, retained: retained.length },
  );

  // Порядок вывода БАЙТОВЫЙ, а не локале-зависимый: схема вывода — контракт с
  // пультом, и порядок в нём не имеет права плавать по ICU и локали процесса.
  steps.sort((left, right) => byBytes(left.dest, right.dest));
  conflicts.sort((left, right) => byBytes(left.dest, right.dest));
  notices.sort((left, right) => byBytes(left.dest ?? '', right.dest ?? ''));

  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    status: statusOf(steps, conflicts),
    steps,
    conflicts,
    notices,
    manifestPath,
    manifest: nextManifest(manifest, steps),
    trace: trace.snapshot(),
  };
}

/**
 * Манифест после применения плана.
 *
 * Считается ЗДЕСЬ, а не на применении, по той же причине, по которой план
 * вообще существует: служебное состояние читаемо до того, как что-то поедет.
 * Записи, по которым план заблокирован, остаются как есть — отказ не меняет
 * ничего, в том числе служебного.
 */
function nextManifest(
  manifest: Manifest,
  steps: readonly PlanStep[],
): readonly ManifestRecord[] {
  const next = new Map(manifest);
  for (const step of steps) {
    if (step.kind === 'delete') {
      next.delete(step.dest);
    } else if (step.record !== null) {
      next.set(step.dest, step.record);
    }
  }
  return [...next.values()].sort((left, right) => byBytes(left.dest, right.dest));
}

/**
 * Каноничная запись раскладки; `null` — путь непригоден.
 *
 * Возвращается новая запись, а не мутируется входная: структура приходит
 * снаружи, и движок её не переписывает.
 */
function repoPathsOf(entry: LayoutEntry): LayoutEntry | null {
  const src = toRepoPath(entry?.src as string);
  const dest = toRepoPath(entry?.dest as string);
  return src.ok && dest.ok
    ? { src: src.path, dest: dest.path, ...classOf(entry) }
    : null;
}

/**
 * Класс записи как поле объекта: `{}`, когда он не назван.
 *
 * Именно `{}`, а не `{ class: DEFAULT_ARTIFACT_CLASS }`: умолчание проставляет
 * `planEntry` в одном месте — там, где оно попадает в запись паспорта укладки.
 * Проставить его ещё и здесь значило бы держать два места, где «класс не назван»
 * превращается в `regenerated`.
 */
function classOf(entry: LayoutEntry): { class?: ArtifactClass } {
  return entry?.class === undefined ? {} : { class: entry.class };
}

/** Отказ по записи, объявленной классом, которого движок не знает. */
function unknownClass(entry: LayoutEntry, declared: unknown): PlanConflict {
  return {
    kind: 'unknown-artifact-class',
    dest: entry.dest,
    src: entry.src,
    detail: { artifactClass: String(declared) },
    message:
      `запись раскладки "${entry.dest}" объявлена классом ` +
      `${JSON.stringify(declared)}, которого движок не знает — известны ` +
      `${ARTIFACT_CLASSES.join(' · ')}. Класс говорит, чем станок держит ` +
      'артефакт, и угадывать его движок не станет: принять незнакомое слово за ' +
      '"regenerated" значило бы перегенерировать поверх файла, который обвес ' +
      'мог объявить человеческим',
  };
}

/**
 * ЧТО СДЕЛАЕТ ПОДТВЕРЖДЕНИЕ — врозь по классам.
 *
 * Одной ценой на оба класса это назвать нельзя: `regenerated` подтверждение
 * перекладывает целиком, а `placed-once` — регистрирует в паспорте укладки, не
 * трогая содержимое (`tasker:BASER2-123`, `tasker:BASER2-141`). Цена ошибки
 * асимметрична и уже заплачена: человек либо готовится потерять заполненный
 * руками файл, которого никто не тронет, либо не решается подтвердить и
 * застревает на конфликте навсегда.
 *
 * Перечислением по `ArtifactClass`, а не двумя ветками: приедет третий класс —
 * компилятор потребует назвать и его цену, а не оставит его молча в чужой
 * формулировке.
 */
const CONFIRMATION_PRICE: Record<ArtifactClass, string> = {
  regenerated:
    'подтверждение отдаёт файл во владение и перекладывает содержимое из ' +
    'шаблона целиком — лежащее не воспроизведётся',
  'placed-once':
    'подтверждение отдаёт файл во владение и записывает его в паспорт ' +
    'укладки, содержимого не трогая — лежащее остаётся как есть',
};

/**
 * Отказ по чужому файлу — с НАЗВАННЫМ классом артефакта.
 *
 * Класс здесь не украшение (`tasker:BASER2-141`): шестнадцать отказов подряд,
 * отличавшихся только именем файла, ответа на единственный вопрос потребителя —
 * «отдать во владение значит ли потерять содержимое?» — не давали, и он вытащил
 * его дедукцией по счётчику `placedOnce` в трейсе. Выводимо, но выводится то,
 * что движок и так знает: класс он ИСПОЛНЯЕТ, а исполняя — обязан называть.
 *
 * Класс берётся из объявления того обвеса, который в этот путь целится, — из
 * того же места, откуда его берёт сама механика отказа. Своей карты «путь →
 * класс» движок не заводит (`tasker:BASER2-123`).
 */
function foreignDest(
  entry: LayoutEntry,
  artifactClass: ArtifactClass,
): PlanConflict {
  return {
    kind: 'foreign-dest',
    dest: entry.dest,
    src: entry.src,
    class: artifactClass,
    detail: { resolution: 'confirm' },
    message:
      `конфликт владения: "${entry.dest}" уже существует, а записи о том, что ` +
      `его положил движок, нет. Класс артефакта — "${artifactClass}": ` +
      `${CONFIRMATION_PRICE[artifactClass]}. Отказ вместо тихого взятия во ` +
      'владение: подтверди этот dest поимённо или сними запись из layout',
  };
}

/**
 * Отказ по записи, чей путь непригоден: пуст, абсолютен или выходит за корень.
 *
 * Границу дерева движок держит САМ, даже получая структуру от двери: он и есть
 * тот, кто пишет. Отказ — план, а не исключение: одна кривая запись не имеет
 * права уносить прогон.
 */
function invalidPath(entry: LayoutEntry): PlanConflict {
  const src = toRepoPath(entry?.src as string);
  const dest = toRepoPath(entry?.dest as string);
  const field = dest.ok ? 'src' : 'dest';
  const problem = (dest.ok ? src : dest) as {
    ok: false;
    problem: RepoPathProblem;
  };
  const value = String(field === 'dest' ? entry?.dest : entry?.src);

  return {
    kind: 'invalid-path',
    dest: String(entry?.dest),
    src: String(entry?.src),
    detail: { field, path: value, pathProblem: problem.problem },
    message:
      `запись раскладки непригодна: ${field} "${value}" — ` +
      `${REPO_PATH_PROBLEM[problem.problem]}`,
  };
}

/**
 * Отказ по записи, обработка которой сорвалась исключением.
 *
 * Сбой НЕ проглатывается и НЕ превращается в шаг: он попадает в конфликты, то
 * есть план становится неприменимым целиком. Право уносить прогон
 * `TypeError`'ом из недр движка при этом снимается.
 */
function entryFailed(
  dest: string,
  src: string | undefined,
  cause: unknown,
): PlanConflict {
  const failure = cause instanceof Error ? cause.message : String(cause);
  return {
    kind: 'entry-failed',
    dest,
    ...(src === undefined ? {} : { src }),
    detail: { failure },
    message:
      `обработка "${dest}" сорвалась: ${failure} — отказ привязан к этой записи, ` +
      'остальные спланированы как обычно; план целиком неприменим',
  };
}

function statusOf(
  steps: readonly PlanStep[],
  conflicts: readonly PlanConflict[],
): PlanStatus {
  if (conflicts.length > 0) {
    return 'blocked';
  }
  return steps.length === 0 ? 'converged' : 'pending';
}

interface ReachabilityContext {
  readonly tree: Tree;
  readonly contentRoot: string;
  readonly manifestPath: string;
  readonly claimed: ReadonlyMap<string, LayoutEntry>;
  readonly claimedDirs: ReadonlyMap<string, string>;
  /**
   * Артефакты ЭТОГО обвеса, которые этот же план снимает.
   *
   * Файл соседнего обвеса сюда не попадает и путь перекрывает законно: этот
   * прогон его не снимает, значит на диске он и останется.
   */
  readonly removed: ReadonlySet<string>;
}

/**
 * Достижимо ли объявленное состояние ТАМ, ГДЕ АРТЕФАКТЫ В ИТОГЕ ЖИВУТ.
 *
 * Атомарность движка кончается на виртуальном дереве: сброс на реальную ФС
 * делает раннер, и его сбой происходит уже ВНЕ журнала отката. Поэтому всё, что
 * упадёт при записи на диск, обязано быть поймано планом. Дерево Nx терпит файл
 * и каталог с одним путём одновременно — файловая система не терпит, и эталон
 * реальности здесь она, а не дерево.
 *
 * ПРЕПЯТСТВИЕ СНИМАЕТ ТОЛЬКО СОБСТВЕННЫЙ ШАГ УДАЛЕНИЯ. Путь, занятый нашим же
 * артефактом, который этот план снимает как сироту, перекрывать `dest` не
 * может: иначе штатная миграция «файл стал каталогом» блокирует сама себя.
 * Правило намеренно узкое — движок НЕ моделирует гипотетическое дерево, а
 * смотрит на один факт: есть ли в этом плане шаг удаления этого пути.
 */
function reachabilityConflict(
  entry: LayoutEntry,
  context: ReachabilityContext,
): PlanConflict | null {
  const { tree, contentRoot, manifestPath, claimed, claimedDirs, removed } =
    context;

  // Манифест — не артефакт и целью раскладки быть не может. Иначе движок
  // кладёт артефакт и тут же перезаписывает его собственной служебной записью:
  // каждый следующий прогон снова видит расхождение, и прогон не сходится
  // никогда, рапортуя при этом «применено». Найдено зондом переходов.
  if (entry.dest === manifestPath) {
    return {
      kind: 'dest-is-manifest',
      dest: entry.dest,
      src: entry.src,
      detail: { manifestPath },
      message:
        `"${entry.dest}" — это манифест материализации, а не артефакт: движок ` +
        'писал бы поверх собственной служебной записи, и прогон не сошёлся бы ' +
        'никогда. Объяви артефакт другим путём',
    };
  }

  if (isInside(entry.dest, contentRoot)) {
    return {
      kind: 'dest-in-content-root',
      dest: entry.dest,
      src: entry.src,
      detail: { contentRoot },
      message:
        `"${entry.dest}" лежит внутри contentRoot "${contentRoot}": движок писал бы ` +
        'в собственный источник шаблонов — материализация в источник не имеет смысла',
    };
  }

  for (const ancestor of ancestorsOf(entry.dest)) {
    if (claimed.has(ancestor)) {
      return unreachable(entry, ancestor, 'declared-dest');
    }
    if (
      tree.exists(ancestor) &&
      tree.isFile(ancestor) &&
      !removed.has(ancestor)
    ) {
      return unreachable(entry, ancestor, 'existing-file');
    }
  }

  const blockedDest = claimedDirs.get(entry.dest);
  if (blockedDest !== undefined) {
    return unreachable(entry, blockedDest, 'declared-dest');
  }

  // Симметричный случай: сам `dest` уже занят КАТАЛОГОМ. Каталог, всё
  // содержимое которого снимается этим же планом, препятствием не является.
  if (
    tree.exists(entry.dest) &&
    !tree.isFile(entry.dest) &&
    !isEmptiedBy(tree, entry.dest, removed)
  ) {
    return unreachable(entry, entry.dest, 'existing-directory');
  }

  return null;
}

/** Останется ли от каталога хоть что-то после снятия наших сирот. */
function isEmptiedBy(
  tree: Tree,
  directory: string,
  removed: ReadonlySet<string>,
): boolean {
  const queue = [directory];
  while (queue.length > 0) {
    const dir = queue.pop() as string;
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (!removed.has(path)) {
          return false;
        }
      } else {
        queue.push(path);
      }
    }
  }
  return true;
}

const COLLISION_CAUSE: Record<
  'declared-dest' | 'existing-file' | 'existing-directory',
  string
> = {
  'declared-dest': 'путь занят файлом, объявленным другой записью layout',
  'existing-file': 'путь занят файлом, который уже лежит в дереве',
  'existing-directory': 'путь занят каталогом, который уже лежит в дереве',
};

function unreachable(
  entry: LayoutEntry,
  blockedBy: string,
  collision: 'declared-dest' | 'existing-file' | 'existing-directory',
): PlanConflict {
  return {
    kind: 'unreachable-dest',
    dest: entry.dest,
    src: entry.src,
    detail: { blockedBy, collision },
    message:
      `"${entry.dest}" недостижим: ${COLLISION_CAUSE[collision]} ("${blockedBy}"). ` +
      'Виртуальное дерево такое состояние терпит, файловая система — нет',
  };
}

/** Каталоги-предки пути, от ближнего к корню: `a/b/c.yml` → `a`, `a/b`. */
function ancestorsOf(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  const dirs: string[] = [];
  let current = '';
  for (const segment of segments) {
    current = current === '' ? segment : `${current}/${segment}`;
    dirs.push(current);
  }
  return dirs;
}

/** Лежит ли путь внутри каталога (или совпадает с ним). */
function isInside(path: string, directory: string): boolean {
  const root = directory.replace(/\/+$/, '');
  return root !== '' && (path === root || path.startsWith(`${root}/`));
}

interface EntryContext {
  readonly tree: Tree;
  readonly source: CanonSource;
  /** Идентичность обвеса, от имени которого кладём. */
  readonly sourceId: string;
  /** Версия этого обвеса; `null` — источник её не назвал. */
  readonly sourceVersion: string | null;
  readonly manifest: Manifest;
  /** Подтверждена ли перезапись чужого файла именно по ЭТОМУ `dest`. */
  readonly confirmed: boolean;
}

/** Исход одной записи `layout`: не более одного шага и одного отказа. */
interface EntryOutcome {
  readonly step?: PlanStep;
  readonly conflict?: PlanConflict;
  /** Подтверждение по этому `dest` пригодилось: отказ снят именно им. */
  readonly confirmationUsed?: boolean;
}

/**
 * Целевое состояние одной записи `layout`.
 *
 * Содержимое движок НЕ ТРОГАЕТ: что дал источник, то и ляжет — байт в байт.
 * Решается здесь ровно два вопроса: можно ли трогать существующий файл и
 * требуется ли шаг (по содержимому или по служебной записи).
 *
 * Класс артефакта меняет ответ на второй вопрос и только на него: у
 * `placed-once` содержимое не сверяется вовсе, поэтому «разошлось» для него не
 * существует как событие. Право трогать чужой файл от класса не зависит —
 * владение это владение.
 */
function planEntry(entry: LayoutEntry, context: EntryContext): EntryOutcome {
  const { tree, source, sourceId, sourceVersion, manifest, confirmed } = context;

  // Умолчание проставляется ЗДЕСЬ, в одном месте: дальше класс участвует в
  // записи паспорта укладки, и «не назван» ниже по коду уже не встречается.
  const artifactClass = entry.class ?? DEFAULT_ARTIFACT_CLASS;
  const known = manifest.get(entry.dest) ?? null;

  // Артефакт числится за ДРУГИМ обвесом — столкновение двух инструментов на
  // один путь. Проверка стоит ПЕРВОЙ и до чтения шаблона: чужое владение не
  // зависит ни от того, лежит ли файл на диске (его могли снести руками), ни от
  // того, читается ли наш шаблон. Пропусти её — и прогон перехватил бы запись
  // соседа, а следующий прогон соседа перехватил бы её обратно (`kb:BASER2-6`).
  if (known !== null && known.source !== sourceId) {
    return {
      conflict: {
        kind: 'cross-source-dest',
        dest: entry.dest,
        src: entry.src,
        detail: { ownedBy: known.source, resolution: 'drop-layout-entry' },
        message:
          `конфликт владения: "${entry.dest}" уже числится за обвесом ` +
          `"${known.source}", а объявлен обвесом "${sourceId}" — у артефакта ` +
          'может быть только один поставщик. Убери запись из раскладки одного ' +
          'из двух; подтверждением это не снимается — перехват сделал бы ' +
          'владение функцией порядка прогонов',
      },
    };
  }

  const content = source.read(entry.src);
  if (content === null) {
    return {
      conflict: {
        kind: 'missing-source',
        dest: entry.dest,
        src: entry.src,
        detail: { sourcePath: source.describe(entry.src) },
        message: `шаблон "${source.describe(entry.src)}" не найден — материализовать нечего`,
      },
    };
  }

  const record: ManifestRecord = {
    dest: entry.dest,
    src: entry.src,
    source: sourceId,
    version: sourceVersion,
    class: artifactClass,
    // Хеш `placed-once` НЕ ПИШЕТСЯ ВОВСЕ: сверять его этот класс не будет
    // никогда, а записанный и никогда не сравниваемый хеш — половина имитации.
    ...(artifactClass === 'placed-once' ? {} : { hash: hashContent(content) }),
  };

  const actual = tree.exists(entry.dest) ? tree.read(entry.dest, 'utf-8') : null;

  // Артефакта нет — кладём впервые. Запись при этом могла остаться от прошлого
  // прогона (файл снесли руками): она приводится тем же шагом.
  //
  // Для `placed-once` это тот самый случай «пропал сам артефакт — кладём
  // заново»: объявленное место пустое, а не «человек удалил, уважим». Развилки
  // по классу тут поэтому нет — и не должно быть.
  if (actual === null) {
    return {
      step: {
        kind: 'create',
        dest: entry.dest,
        reason: 'missing',
        src: entry.src,
        content,
        previous: null,
        record,
      },
    };
  }

  // Файл есть, а записи о нём нет — он не наш. Отказ вместо тихого взятия во
  // владение; снимается только поимённым подтверждением. ПРАВО трогать чужой
  // файл класс не меняет: владение чужим файлом не становится нашим оттого, что
  // мы объявили файл человеческим. А вот ЦЕНУ подтверждения решает он и только
  // он — поэтому отказ его называет (`tasker:BASER2-141`).
  if (known === null) {
    if (!confirmed) {
      return { conflict: foreignDest(entry, artifactClass) };
    }
    // Взятие во владение `placed-once` содержимого НЕ ТРОГАЕТ: объявленное
    // место занято, а класс говорит «положено однажды и дальше не трогаем».
    // Перезаписать здесь значило бы затереть человеческий файл ровно тем
    // согласием, которое давалось на владение, а не на потерю.
    return {
      confirmationUsed: true,
      step:
        artifactClass === 'placed-once'
          ? {
              kind: 'record',
              dest: entry.dest,
              reason: 'adopted',
              src: entry.src,
              content: null,
              previous: actual,
              record,
            }
          : {
              kind: 'update',
              dest: entry.dest,
              reason: 'adopted',
              src: entry.src,
              content,
              previous: actual,
              record,
            },
    };
  }

  // Содержимое не то, которое должно лежать, — перегенерация целиком. Почему
  // разошлось (правили руками либо уехал шаблон), потребитель отличает
  // ДАННЫМИ: хеш в прошлой записи против `previous` в шаге. Действие от этого
  // не меняется, поэтому причина одна и она не врёт.
  //
  // У `placed-once` этой ветки нет вовсе — не «есть, но выключена». Правка
  // человека в таком файле флага не поднимает, план его расходящимся не
  // называет, и содержимое движок с шаблоном не сверяет.
  if (artifactClass !== 'placed-once' && actual !== content) {
    return {
      step: {
        kind: 'update',
        dest: entry.dest,
        reason: 'diverged',
        src: entry.src,
        content,
        previous: actual,
        record,
      },
    };
  }

  // ИНВАРИАНТ Д10 (`tasker:BASER2-16`), внесённый явно: содержимое целевое, но
  // запись утверждает не то, что объявлено СЕЙЧАС, — приведение обязательно и
  // обязано быть шагом. Совпадение содержимого не повод молчать: устаревшая
  // запись переживает смену объявления и всплывает потом снятием не того файла.
  const restated = restatedFields(known, record);
  if (restated.length > 0) {
    return {
      step: {
        kind: 'record',
        dest: entry.dest,
        reason: 'reclaimed',
        src: entry.src,
        content: null,
        previous: actual,
        record,
        restated,
      },
    };
  }

  return {};
}

/**
 * Чем запись расходится с объявленным сейчас — поимённо.
 *
 * Пустой список означает «утверждает ровно то», и это единственный путь к
 * молчанию: план, который что-то приводит, обязан сказать ЧТО. Подъём версии
 * обвеса при том же содержимом виден здесь и только здесь — иначе он прошёл бы
 * тихо, и паспорт укладки продолжал бы называть вчерашнюю версию.
 *
 * Обвес не сверяется: до этого места доходят только записи ЭТОГО обвеса — чужая
 * отсекается отказом `cross-source-dest` раньше и шагом не становится никогда.
 * Сверять его тут значило бы держать вторую, более слабую копию того же
 * правила: она молча превращала бы перехват чужого артефакта в приведение
 * записи ровно тогда, когда первая сломается.
 */
function restatedFields(
  known: ManifestRecord,
  now: ManifestRecord,
): readonly RecordField[] {
  const drifted: RecordField[] = [];
  if (known.src !== now.src) {
    drifted.push('src');
  }
  // Сравниваются и отсутствия: у `placed-once` хеша нет с обеих сторон, и
  // `undefined === undefined` здесь означает согласие, а не пропуск проверки.
  if (known.hash !== now.hash) {
    drifted.push('hash');
  }
  if (known.class !== now.class) {
    drifted.push('class');
  }
  if (known.version !== now.version) {
    drifted.push('version');
  }
  return drifted;
}

/**
 * Запись ЭТОГО обвеса потеряла объявление — артефакт снимается целиком.
 *
 * Сюда доходит не всё потерявшее объявление: `placed-once` без поимённого
 * подтверждения отсеян раньше и остался у человека извещением. Записи соседних
 * обвесов не доходят тем более — их отсеял отбор сирот по `record.source`.
 *
 * Всё, что дошло, снимается одинаково: файл, который должен пережить снятие
 * записи не по классу, а по решению человека, — это форкнутый источник, а форк
 * живёт снаружи движка.
 */
function planOrphan(
  tree: Tree,
  dest: string,
  known: ManifestRecord,
): PlanStep {
  const previous = tree.exists(dest) ? tree.read(dest, 'utf-8') : null;

  return {
    kind: 'delete',
    dest,
    reason: 'orphan',
    src: known.src,
    content: null,
    previous,
    record: null,
  };
}

/**
 * Человекочитаемый рендер плана — ОДИН ИЗ выходов, а не источник.
 *
 * Ветвиться по этому тексту нельзя: решения принимаются по `status`, `kind`,
 * `reason` и `detail`.
 */
export function describePlan(plan: MaterializationPlan): string {
  const lines: string[] = [];

  if (plan.status === 'converged') {
    lines.push('план пуст: дерево сошлось с декларацией');
  } else {
    lines.push(`шагов: ${plan.steps.length}`);
    for (const step of plan.steps) {
      // Что именно приводится, названо и человеку: «запись разошлась» без
      // указания поля отправляет его сличать манифест руками.
      const restated =
        step.restated === undefined || step.restated.length === 0
          ? ''
          : `: ${step.restated.join(', ')}`;
      lines.push(
        `  ${step.kind.padEnd(7)} ${step.dest}  (${step.reason}${restated})` +
          recorded(step, plan.manifestPath),
      );
    }
  }

  if (plan.conflicts.length > 0) {
    lines.push(`конфликтов: ${plan.conflicts.length} — план не применяется`);
    for (const conflict of plan.conflicts) {
      lines.push(`  ${conflict.kind}: ${conflict.message}`);
    }
  }

  if (plan.notices.length > 0) {
    lines.push(`извещений: ${plan.notices.length}`);
    for (const notice of plan.notices) {
      lines.push(`  ${notice.kind}: ${notice.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * ГДЕ ИСКАТЬ ИЗМЕНЕНИЕ, КОТОРОЕ СДЕЛАЕТ ШАГ `record` (`tasker:BASER2-141`).
 *
 * Шаг `record` стоит на СВОЁМ `dest` — он про этот артефакт, — но содержимое
 * `dest` не трогает вовсе: меняется паспорт укладки. Строка, называвшая только
 * `dest`, отправляла читателя искать изменения в файле, который не изменится, —
 * и он их там не находил: рядом печатался отчёт «записано на диск», где стоял
 * совсем другой адрес. Механика при этом верна, врал текст.
 *
 * Оба адреса названы в ОДНОЙ строке, а не сноской под списком: сноску со своей
 * строкой читатель не сводит, а смотрит он на строку.
 */
function recorded(step: PlanStep, manifestPath: string): string {
  return step.kind === 'record'
    ? ` — меняется паспорт укладки ${manifestPath}; сам артефакт остаётся как есть`
    : '';
}
