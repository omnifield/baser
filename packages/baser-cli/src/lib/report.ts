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
import type { DoorResult } from './result.js';
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

  if (result.source) {
    const { source } = result;
    lines.push(
      `обвес: ${source.id} — ${source.title}`,
      `  пакет ${source.packageName}@${source.packageVersion}`,
      `  шаблоны ${
        source.location.kind === 'in-tree'
          ? source.location.path
          : `${source.location.absolute} (вне этого репозитория)`
      }`,
    );
  }

  if (result.config.creates) {
    lines.push(
      `конфиг: ${result.config.path} ${
        result.command === 'apply' ? 'создан' : 'будет создан'
      } — версия формы ${result.config.formVersion} проставлена дверью`,
    );
  }

  if (result.settings.length > 0) {
    lines.push('', ...renderMovement(result.settings));
  }

  if (result.plan) {
    lines.push('', describePlan(result.plan));
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
