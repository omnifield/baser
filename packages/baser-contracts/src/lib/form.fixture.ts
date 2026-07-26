/**
 * Заготовки объявления и конфига — чтобы тест говорил про ОДНО отличие, а не
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

/** Минимальный пригодный `baser.json`. */
export function consumerConfig(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sources: [{ use: '@omnifield/baser-devbox' }],
    ...patch,
  };
}

/** Коды отказов в том виде, в каком их удобно сравнивать в тестах. */
export function codesOf(
  problems: readonly { readonly code: string; readonly at: string }[],
): string[] {
  return problems.map((problem) => `${problem.code} @ ${problem.at}`);
}
