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
import type { DoorResult, SourceRun } from './result.js';
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
    lines.push('', ...renderRun(run));
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

  lines.push('', STATUS_LINE[result.status]);
  return lines.join('\n');
}

/**
 * Прогон одного обвеса: кто он, что привёз, что сделает.
 *
 * Блок цельный и по обвесу, а не по разделам через весь вывод: два инструмента,
 * чьи значения напечатаны в одном месте, а планы — в другом, читались бы как
 * один общий план, и «эта версия ноды поднимется» относилось бы неизвестно к
 * чему. Внутри блока порядок прежний — движение ВЫШЕ плана.
 */
function renderRun(run: SourceRun): string[] {
  const { source } = run;
  const lines = [
    `обвес: ${source.id} — ${source.title}`,
    `  пакет ${source.packageName}@${source.packageVersion}`,
    `  шаблоны ${
      source.location.kind === 'in-tree'
        ? source.location.path
        : `${source.location.absolute} (вне этого репозитория)`
    }`,
  ];

  if (run.settings.length > 0) {
    lines.push('', ...renderMovement(run.settings));
  }

  if (run.plan) {
    lines.push('', describePlan(run.plan));
  }

  return lines;
}

/**
 * Движение значений: у каждого сдвига названы ОБА конца.
 *
 * Настройки, которые никуда не двигались, тоже печатаются — иначе «этих
 * значений я не выбирал» осталось бы невидимым, а именно они поедут за
 * следующим выпуском обвеса.
 */
function renderMovement(settings: readonly SettingMovement[]): string[] {
  const ours = settings.filter((setting) => setting.ours).length;
  const width = Math.max(...settings.map((setting) => setting.key.length));

  return [
    `значения: ${settings.length}, из них наших ${ours} — незаполненное едет за выпуском обвеса`,
    ...settings.map((setting) => {
      const head = `  ${setting.key.padEnd(width)}  `;
      const path = setting.chain.map((link) => value(link.value)).join(' → ');
      return `${head}${path}  ${trace(setting)}`;
    }),
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
// ПОДГОТОВКА ДЕТАЛИ: check · pack · bundle
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
    report.ok
      ? 'деталь подходит патрону'
      : 'деталь патрону не подходит — причины выше',
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
