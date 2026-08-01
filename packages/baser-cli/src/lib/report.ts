/**
 * ТЕКСТОВЫЙ РЕНДЕР — один из выходов, а не источник.
 *
 * `renderText` принимает `DoorResult` и БОЛЬШЕ НИЧЕГО: ни репозитория, ни
 * декларации, ни движка. Так «вывод машинночитаем в первую очередь, текст —
 * рендер поверх тех же данных» (`tasker:BASER2-20`) держится формой функции, а
 * не обещанием: то, чего нет в ответе, человеку показать нечем.
 *
 * Ветвиться по этому тексту нельзя ни гейту, ни пульту — решения принимаются по
 * `status`, `kind`, `reason`, `code` и `detail`.
 *
 * Порядок разделов не косметика. **Движение значений печатается ВЫШЕ плана**,
 * потому что оно обязано быть названо ДО применения (`kb:BASER2-5`): человек
 * читает сверху вниз, и «подниму версию с 22 на 24» ниже списка шагов
 * прочиталось бы уже после решения.
 */

import { describeProblems, type FormProblem } from '@omnifield/baser-contracts';
import { describePlan } from '@omnifield/baser-materialize';
import type { CheckReport } from '@omnifield/baser-check';
import type { PackReport } from '@omnifield/baser-pack';
import type { BundleReport } from './bundle.js';
import type {
  DoorCommand,
  DoorResult,
  SourceConfigReport,
  SourceRun,
} from './result.js';
import type { DerivedMove } from './derived.js';
import type { ArtifactDifference } from './difference.js';
import type { SettingLink, SettingMovement } from './values.js';

const STATUS_LINE: Record<DoorResult['status'], string> = {
  'no-sources': 'обвесов не поставлено — раскладывать нечего',
  converged: 'сошлось: дерево совпадает с декларацией',
  pending: 'план применим — примени его командой "baser apply"',
  applied: 'применено и записано на диск',
  blocked: 'конфликт владения: не применено ничего',
  // Не «дверь отказала»: сюда приходит и отказ движка на входе (битая служебная
  // запись, непригодная структура). Строка итога, приписавшая отказ не тому,
  // отправила бы человека чинить не туда — а куда идти, говорит адрес отказа.
  refused: 'плана нет: прогон отказал на входе',
};

export function renderText(result: DoorResult): string {
  const lines: string[] = [];

  lines.push(`baser ${result.command} · ${result.repo.root}`);

  if (result.config.creates) {
    lines.push(
      `конфиг: ${result.config.path} ${
        result.command === 'apply' ? 'создан' : 'будет создан'
      } — версия формы ${result.config.formVersion} проставлена дверью`,
    );
  }

  // Обвесов бывает много (`kb:BASER2-4`), и счётчик печатается ровно тогда,
  // когда их больше одного: строка «обвесов: 1» ничего не сообщает, а строку
  // «обвесов: 2» человек обязан увидеть до того, как начнёт читать два плана
  // подряд и гадать, почему их два.
  if (result.runs.length > 1) {
    lines.push(`обвесов: ${result.runs.length}`);
  }

  for (const run of result.runs) {
    lines.push('', ...renderRun(run, result.command));
  }

  if (result.writes.length > 0) {
    lines.push(
      '',
      `записано на диск: ${result.writes.length}`,
      ...result.writes.map(
        (write) => `  ${write.kind.padEnd(7)} ${write.path}`,
      ),
    );
  }

  if (result.problems.length > 0) {
    lines.push(
      '',
      `отказов: ${result.problems.length}`,
      // Рендер отказов — контрактный, свой второй дверь не заводит. Сужение
      // кода здесь безопасно: `describeProblems` печатает код как текст и
      // ни по одному значению не ветвится.
      indent(describeProblems(result.problems as readonly FormProblem[])),
    );
  }

  lines.push('', statusLine(result));
  return lines.join('\n');
}

/**
 * ИТОГОВАЯ СТРОКА НЕ ОБЕЩАЕТ ЗАВЕРШЁННОСТИ, КОТОРОЙ НЕТ (`tasker:BASER2-99`).
 *
 * «План применим — примени его» читается как «дальше ничего не нужно», а после
 * применения, переписавшего уже разложенное, человеку остаётся работа: старый
 * контейнер живёт под прежним именем, соседи ходят на прежний адрес. Дверь
 * этого не делает и делать не начнёт — но **обещание в тексте такой же
 * контракт, как код**, и сегодня текст обещал завершённость.
 *
 * Хвост приписывается ровно там, где работа действительно остаётся: прогон
 * переписывает файл, который уже лежал. Гейт при этом не трогается — он
 * ветвится по `status`, а не по строке.
 */
function statusLine(result: DoorResult): string {
  const head = STATUS_LINE[result.status];
  if (!result.runs.some(rewritesPlaced)) {
    return head;
  }
  if (result.status === 'pending') {
    return `${head}. Применением работа не кончится: что останется сделать руками, названо выше — "остаётся человеку"`;
  }
  if (result.status === 'applied') {
    return `${head} — и только на диск: что останется сделать руками, названо выше — "остаётся человеку"`;
  }
  return head;
}

/** Прогон переписывает УЖЕ ЛЕЖАЩИЙ артефакт — значит по нему уже что-то живёт. */
function rewritesPlaced(run: SourceRun): boolean {
  return (run.plan?.steps ?? []).some((step) => step.reason === 'diverged');
}

/**
 * Прогон одного обвеса: кто он, что привёз, что сделает.
 *
 * Блок цельный и по обвесу, а не по разделам через весь вывод: два инструмента,
 * чьи значения напечатаны в одном месте, а планы — в другом, читались бы как
 * один общий план, и «эта версия ноды поднимется» относилось бы неизвестно к
 * чему. Внутри блока порядок прежний — движение ВЫШЕ плана.
 */
function renderRun(run: SourceRun, command: DoorResult['command']): string[] {
  const { source } = run;
  const lines = [
    `обвес: ${source.id} — ${source.title}`,
    // Версия названа ровно так, как она есть. Обвес её не назвал — так и
    // сказано, и сказана ЦЕНА: та же неизвестность уедет в паспорт укладки и
    // останется там навсегда для этих файлов. `@undefined` в этой строке
    // отправлял бы человека искать поломку двери там, где её нет, а сочинённое
    // `@0.0.0` было бы утверждением, которого обвес не делал (`tasker:BASER2-52`).
    source.packageVersion === null
      ? `  пакет ${source.packageName} — версия не названа обвесом: ` +
        'в паспорт укладки ляжет "null"'
      : `  пакет ${source.packageName}@${source.packageVersion}`,
    `  шаблоны ${
      source.location.kind === 'in-tree'
        ? source.location.path
        : `${source.location.absolute} (вне этого репозитория)`
    }`,
    // Файл настроек печатается ВСЕГДА, а не только при рождении: человек,
    // которому надо что-то подкрутить, обязан узнать адрес из вывода, а не из
    // доки. Правило именования он на память не считает, да и не должен.
    //
    // Адрес называется и тогда, когда файла нет и не будет: он говорит, ГДЕ
    // регулировка появится, когда обвес её объявит. Но молчать при этом нельзя —
    // адрес без объяснения читается как «файл где-то потерялся»
    // (`tasker:BASER2-124`).
    `  настройки ${run.config.path}${describeSourceConfig(run.config, command)}`,
  ];

  if (run.settings.length > 0) {
    lines.push('', ...renderMovement(run.settings));
    lines.push(...renderPlaced(run.settings));
  }

  lines.push(...renderDerived(run.derived));
  lines.push(...renderRemains(run));

  if (run.plan) {
    lines.push('', describePlan(run.plan));
  }

  lines.push(...renderDifferences(run.differences));

  return lines;
}

/**
 * Что сказано про файл настроек рядом с его адресом.
 *
 * Три состояния, и молчание годится только для одного — «файл лежит, дверь в
 * него не пишет». Рождение называется временем команды: у `plan` это намерение,
 * у `apply` — состоявшийся факт. Отсутствие называется ПРИЧИНОЙ: обвес не
 * объявил ни настроек, ни пресетов, и файла не будет, пока не объявит
 * (`tasker:BASER2-124`).
 *
 * `tunable: null` — до вопроса прогон не дошёл, и говорить тут нечего: отказ уже
 * назван своим кодом выше.
 */
function describeSourceConfig(
  config: SourceConfigReport,
  command: DoorCommand,
): string {
  if (config.creates) {
    return command === 'apply'
      ? ' — создан с дефолтами в комментариях, значений в нём нет'
      : ' — будет создан с дефолтами в комментариях, значений в нём нет';
  }
  if (!config.existed && config.tunable === false) {
    return ' — файла нет: обвес не объявил ни настроек, ни пресетов. Появится в том выпуске, где появится первая регулировка';
  }
  return '';
}

/**
 * Движение значений: у каждого сдвига названы ОБА конца.
 *
 * Настройки, которые никуда не двигались, тоже печатаются — иначе «этих
 * значений я не выбирал» осталось бы невидимым, а именно они поедут за
 * следующим выпуском обвеса.
 *
 * ГРАНИЦА РЕГУЛИРОВКИ названа второй строкой (`tasker:BASER2-106`). Список без
 * неё читается как полный перечень того, из чего собран артефакт, — и первый
 * чужой потребитель достроил ровно это: раз `--add-host` настройкой не назван,
 * значит станок его не кладёт. Риск оказался ложным, но стоил захода с
 * экспериментом. Строка стоит здесь, а не только в отказе первой установки:
 * отказ видит тот, у кого файл уже лежал, а этот блок — каждый, кто ставит.
 */
function renderMovement(settings: readonly SettingMovement[]): string[] {
  const ours = settings.filter((setting) => setting.ours).length;
  const width = Math.max(...settings.map((setting) => setting.key.length));

  return [
    `значения: ${settings.length}, из них наших ${ours} — незаполненное едет за выпуском обвеса`,
    'регулируется ровно это: всё остальное приезжает из шаблона как есть',
    ...settings.map((setting) => {
      const head = `  ${setting.key.padEnd(width)}  `;
      const path = setting.chain.map((link) => value(link.value)).join(' → ');
      return `${head}${path}  ${trace(setting)}`;
    }),
  ];
}

/**
 * ПЕРЕЕЗД УЖЕ РАЗЛОЖЕННОГО — отдельным блоком, а не строкой в общем списке.
 *
 * Это другое событие, чем «откуда взялось значение»: там рассказ про сегодня,
 * здесь — про то, что у человека В РЕПОЗИТОРИИ сменится, когда он применит.
 * Смешать их в одну колонку значило бы спрятать переименование сетевого алиаса
 * среди тринадцати строк, из которых двенадцать ничего не меняют.
 *
 * Блок печатается ТОЛЬКО когда есть что назвать: заголовок «переезжает: 0»
 * на каждом прогоне за неделю перестал бы читаться.
 */
function renderPlaced(settings: readonly SettingMovement[]): string[] {
  const moving = settings.filter((setting) => setting.placed !== undefined);
  if (moving.length === 0) {
    return [];
  }

  const width = Math.max(...moving.map((setting) => setting.key.length));
  return [
    '',
    `уже разложенное переедет: ${moving.length} — прежнее прочитано из артефакта и доказано побайтово`,
    ...moving.map((setting) => {
      const placed = setting.placed as NonNullable<SettingMovement['placed']>;
      return (
        `  ${setting.key.padEnd(width)}  ${value(placed.value)} → ${value(
          setting.value,
        )}` + `  — доказано ${placed.provenBy}`
      );
    }),
  ];
}

/**
 * ПОСЧИТАННОЕ ОТ ЗНАЧЕНИЯ — отдельным блоком, следом за самим движением.
 *
 * Движение выше отвечает «что сменится»; здесь — «что уедет вместе с этим».
 * Значение человек выбрал сам, а адрес тома от него только СЧИТАЕТСЯ, и в томе
 * лежит то, что человек клал руками (`tasker:BASER2-98`). Строка
 * `imageUser "node" → "vscode"` про это не говорит ничего — говорит вот эта.
 *
 * Печатается ВЫШЕ плана по той же причине, что и движение: последствие обязано
 * быть прочитано до решения, а не после списка шагов.
 *
 * Само значение сюда не попадает — его назвал блок выше; сюда попадает только
 * то, во что оно вошло частью. Дверь при этом не знает ни про тома, ни про
 * формат: она называет слово, которое исчезнет из файла, и слово, которое
 * встанет на его место, и оба доказаны подстановкой (`derived.ts`).
 */
function renderDerived(moves: readonly DerivedMove[]): string[] {
  if (moves.length === 0) {
    return [];
  }

  const width = Math.max(...moves.map((move) => move.key.length));
  // Адрес артефакта дописывается только когда их несколько: у одного он назван
  // строкой выше («доказано <файл>»), и повторять его на каждой строке значило
  // бы разбавлять то единственное, ради чего блок печатается.
  const many = new Set(moves.map((move) => move.dest)).size > 1;

  return [
    '',
    `вместе с ними переедет ПОСЧИТАННОЕ от них: ${moves.length} — найдено в артефакте и доказано подстановкой`,
    ...moves.map(
      (move) =>
        `  ${move.key.padEnd(width)}  ${move.placed} → ${move.comes}` +
        (many ? `  — в ${move.dest}` : ''),
    ),
  ];
}

/**
 * ЧТО ОСТАЁТСЯ ЧЕЛОВЕКУ — потому что дверь этого не делает (`tasker:BASER2-99`).
 *
 * Дверь кладёт файл. Старый контейнер после применения остаётся под старым
 * именем, и его надо пересоздать; соседей, ходивших на прежний сетевой алиас,
 * надо поправить. Обвес сделать этого не может — **это не его работа и не
 * работа станка** (`kb:BASER2-2` §6: пульт и триггеры запуска не наши), — но
 * молчать об этом он не вправе: обещание в тексте такой же контракт, как код.
 *
 * Здесь названо ПРАВИЛО, а не список: что именно у человека запущено по этому
 * файлу, дверь не знает и знать не может. Она называет то, что знает точно, —
 * границу собственной работы.
 *
 * Блок печатается ровно там, где работа остаётся: прогон переписывает файл,
 * который УЖЕ ЛЕЖИТ, — значит по нему уже что-то живёт. На первой укладке его
 * нет: пересоздавать нечего, и предупреждение, которое видит каждый, за неделю
 * перестаёт читаться.
 */
function renderRemains(run: SourceRun): string[] {
  if (!rewritesPlaced(run)) {
    return [];
  }

  return [
    '',
    'остаётся человеку — дверь этого не делает и делать не начнёт:',
    '  применение переписывает ФАЙЛ, а не то, что по нему уже запущено. Контейнер, поднятый',
    '  по прежнему содержимому, живёт под прежним именем, пока ты сам его не пересоздашь:',
    '  докер дверь не зовёт и контейнерами не управляет — это не её работа и не работа станка.',
    '  Значение, которое видно СНАРУЖИ (имя, адрес, сетевой алиас), — обещание соседям, а не',
    '  подпись для себя: сменив его, поправь и тех, кто ходил на прежнее.',
  ];
}

/**
 * ЧТО ИЗ ЧУЖОГО ФАЙЛА НЕ ВОСПРОИЗВЕДЁТСЯ — построчно (`tasker:BASER2-112`).
 *
 * Стоит ПОСЛЕ плана, а не выше: этот блок объясняет его отказы — он читается
 * как их подробность, а вклиненный между значениями и шагами он оторвал бы
 * причину от следствия. Человеку он всё равно достаётся до решения:
 * подтверждения ещё не было, и отказ ниже прямо на него ссылается.
 *
 * Форма подачи — усечённая. Дифф бывает длинным, и вывалить чужой файл целиком
 * в лицо каждому, кто ставит обвес в живой репозиторий, значило бы сделать
 * вывод нечитаемым; поэтому показывается начало, а остаток НАЗВАН счётчиком и
 * достаётся по `--difference`. Молча обрезанный список читается как полный.
 */
function renderDifferences(
  differences: readonly ArtifactDifference[],
): string[] {
  if (differences.length === 0) {
    return [];
  }

  const lines = [
    '',
    `чужое не воспроизведётся: ${differences.length} — построчно, формат при этом не разбирается`,
  ];

  for (const difference of differences) {
    if (!difference.measured) {
      // «Не считали» и «расхождений нет» — разные утверждения, и второе на
      // месте первого сказало бы человеку «ничего не потеряешь» там, где дверь
      // не смотрела.
      lines.push(
        `  ${difference.dest} — расхождение НЕ СЧИТАЛОСЬ: файл двоичный либо слишком длинный`,
      );
      continue;
    }

    lines.push(
      `  ${difference.dest} — не воспроизведётся строк: ${difference.goneCount}, ляжет своих: ${difference.comesCount}`,
      ...shown(difference.gone, difference.goneCount, '-'),
      ...shown(difference.comes, difference.comesCount, '+'),
    );
  }

  return lines;
}

/** Показанные строки одной стороны плюс честный хвост про непоказанные. */
function shown(
  lines: readonly string[],
  total: number,
  mark: string,
): string[] {
  return [
    ...lines.map((line) => `    ${mark} ${line}`),
    ...(total > lines.length
      ? [
          `    ${mark} … ещё ${total - lines.length}: целиком — тот же прогон с "--difference"`,
        ]
      : []),
  ];
}

/** Откуда значение приехало и поедет ли оно дальше за нами. */
function trace(setting: SettingMovement): string {
  const steps = setting.chain.map(source).join(', затем ');
  return setting.ours
    ? `${steps} — поедет за выпуском обвеса`
    : `${steps} — не поднимется никогда`;
}

function source(link: SettingLink): string {
  switch (link.kind) {
    case 'default':
      return 'дефолт обвеса';
    case 'computed':
      return `дефолт обвеса, посчитанный ${link.resolver}`;
    case 'preset':
      return `пресет ${link.preset}`;
    case 'filled':
      return 'заполнено тобой';
  }
}

function value(setting: SettingLink['value']): string {
  return JSON.stringify(setting);
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// ПОДГОТОВКА ОБВЕСА К ВЫДАЧЕ: check · pack · bundle
//
// Те же правила, что и у рендера прогона. Механики живут в соседних зонах, и
// дверь их ответы НЕ пересказывает: коды и адреса печатаются как есть тем же
// `describeProblems` контрактов, каким печатает свои. Второй рендер для чужих
// отказов означал бы вторую правду об одном событии.
//
// Объём сверки печатается всегда. `check` и `pack` считают его сами (`stages`
// со счётчиком), и ровно ради того, чтобы зелёный прогон, ничего не сверивший,
// был виден — прятать этот счётчик в человеческом выводе значило бы вернуть
// ему возможность быть незамеченным.
// ───────────────────────────────────────────────────────────────────────────

/** Строка шага: имя, состояние, объём. Форма общая у всех трёх механик. */
interface RenderedStage {
  readonly name: string;
  readonly status: string;
  readonly counted: number;
  readonly reason?: string;
}

function renderStages(stages: readonly RenderedStage[]): string[] {
  const width = Math.max(...stages.map((stage) => stage.name.length));
  return stages.map((stage) => {
    const tail = stage.reason === undefined ? '' : `  — ${stage.reason}`;
    return `  ${stage.name.padEnd(width)}  ${stage.status.padEnd(7)} ${String(
      stage.counted,
    ).padStart(4)}${tail}`;
  });
}

function renderProblems(
  problems: readonly { code: string; at: string; message: string }[],
): string[] {
  if (problems.length === 0) {
    return [];
  }
  return [
    '',
    `отказов: ${problems.length}`,
    indent(describeProblems(problems as readonly FormProblem[])),
  ];
}

export function renderCheck(report: CheckReport): string {
  const lines = [
    `baser check · ${report.root}`,
    report.packageName === null
      ? '  пакет не назван'
      : `  пакет ${report.packageName}${
          report.packageVersion === null ? '' : `@${report.packageVersion}`
        }`,
  ];

  if (report.declaration !== null) {
    lines.push(
      `  обвес ${report.declaration.source.id} — ${report.declaration.source.title}`,
    );
  }

  lines.push(
    '',
    `проверено (слой · итог · сверено):`,
    ...renderStages(report.stages),
  );
  lines.push(...renderProblems(report.problems));
  lines.push(
    '',
    // Словарь канона (`kb:BASER2-9`, поправлен 2026-07-29): обвес подходит
    // ПОСАДОЧНОМУ МЕСТУ. Прежняя пара слов была расхождением внутри канона, а
    // не самодеятельностью зоны, — поэтому зона приведена следом за ним, а не
    // закрепила одно из двух чтений молча. Сама отменённая пара названа в
    // README зоны (§ «Словарь»): объяснение живёт в доке, а в уезжающих
    // потребителю модулях отменённых слов нет вовсе — это сторожит
    // `vocabulary.spec.ts`.
    report.ok
      ? 'обвес подходит посадочному месту'
      : 'обвес посадочному месту не подходит — причины выше',
  );
  return lines.join('\n');
}

export function renderPack(report: PackReport): string {
  const lines = [`baser pack · ${report.source} → ${report.target}`];

  const manifest = report.manifest;
  if (manifest !== null) {
    lines.push(
      `  обвес ${manifest.source.id} · пакет ${manifest.source.package.name}${
        manifest.source.package.version === null
          ? ''
          : `@${manifest.source.package.version}`
      }`,
      `  файлов ${manifest.files.length} · артефактов ${manifest.artifacts.length}`,
      // Состояние «не могу сказать» доезжает до человека, а не растворяется в
      // «годен»: его назвала проверка, и снял его не разбор, а npm.
      `  состав: ${manifest.shipping.claim} (решил ${manifest.shipping.decidedBy})${
        manifest.shipping.reason === undefined
          ? ''
          : ` — ${manifest.shipping.reason}`
      }`,
    );
  }

  lines.push(
    '',
    'собрано (шаг · итог · сверено):',
    ...renderStages(report.stages),
  );
  lines.push(...renderProblems(report.problems));
  lines.push(
    '',
    report.ok
      ? `нагрузка собрана: ${report.payloadRoot ?? ''}`
      : 'нагрузка не собрана — причины выше',
  );
  return lines.join('\n');
}

export function renderBundle(report: BundleReport): string {
  const lines = [`baser bundle · ${report.source} → ${report.target}`];

  if (report.runtime.length > 0) {
    const bytes = report.runtime.reduce((sum, item) => sum + item.bytes, 0);
    lines.push(
      `  вложено пакетов ${report.runtime.length}, ${Math.round(bytes / 1024)} КБ:`,
      ...report.runtime.map(
        (item) =>
          `    ${item.name}${item.version === null ? '' : `@${item.version}`}` +
          ` — ${item.files} ф., ${Math.round(item.bytes / 1024)} КБ`,
      ),
    );
  }

  lines.push(
    '',
    'собрано (шаг · итог · сверено):',
    ...renderStages(report.stages),
  );

  // Отказ упаковки печатается ЕЁ рендером: бандл его не пересказывает.
  if (!report.pack.ok) {
    lines.push('', indent(renderPack(report.pack)));
  }

  lines.push(...renderProblems(report.problems));
  lines.push(
    '',
    report.ok
      ? `бандл собран — унеси папку и прочти ${report.target}/INSTALL.md`
      : 'бандл не собран — причины выше',
  );
  return lines.join('\n');
}
