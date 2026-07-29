/**
 * Заготовки объявления и конфигов — чтобы тест говорил про ОДНО отличие, а не
 * перепечатывал форму целиком.
 */

import { FORM_VERSION } from './version.js';

/** Минимальный пригодный блок `baser`. */
export function declarationBlock(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    formVersion: FORM_VERSION,
    source: {
      id: 'omnifield/devbox',
      title: 'Девбокс',
      contentRoot: 'template',
    },
    settings: {
      name: { title: 'Имя', type: 'string', default: 'devbox' },
    },
    layout: [
      { src: 'devcontainer.json', dest: '.devcontainer/devcontainer.json' },
    ],
    ...patch,
  };
}

/** Минимальный пригодный `baser.json` — перечень поставленного, и только. */
export function consumerConfig(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sources: [{ use: '@omnifield/baser-devbox' }],
    ...patch,
  };
}

/**
 * Файл настроек обвеса у потребителя — как его отдаёт дверь после разбора YAML.
 *
 * Ключ `baser` тут не один: у файла два читателя, и проба обязана видеть, что
 * чужая половина форму не смущает.
 */
export function sourceConfigFile(
  baser: Record<string, unknown> = {},
  rest: Record<string, unknown> = {},
): Record<string, unknown> {
  return { baser, ...rest };
}

/** Коды отказов в том виде, в каком их удобно сравнивать в тестах. */
export function codesOf(
  problems: readonly { readonly code: string; readonly at: string }[],
): string[] {
  return problems.map((problem) => `${problem.code} @ ${problem.at}`);
}
