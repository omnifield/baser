/**
 * Значения настроек: какие бывают и как проверить, что пришло объявленное.
 *
 * Набор типов намеренно короткий. Настройка — это РЕГУЛИРОВКА, которую человек
 * видит и понимает (`kb:BASER2-5`); вложенные структуры превращают её обратно в
 * разметку файла, то есть ровно в то, от чего форма уводит.
 */

export type SettingType = 'string' | 'number' | 'boolean' | 'list';

/** Список допустимых типов — для сообщений и для проверки объявления. */
export const SETTING_TYPES: readonly SettingType[] = [
  'string',
  'number',
  'boolean',
  'list',
];

export type SettingValue = string | number | boolean | readonly string[] | null;

export function isSettingType(value: unknown): value is SettingType {
  return (
    typeof value === 'string' &&
    (SETTING_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Подходит ли значение объявленному типу.
 *
 * `null` разрешён только для `string` и `list` и означает «не задано»: шаблон
 * такой блок не разворачивает. Для `number`/`boolean` «не задано» смысла не
 * имеет — выключенный флаг это `false`, а не отсутствие флага.
 */
export function matchesType(type: SettingType, value: unknown): boolean {
  if (value === null) {
    return type === 'string' || type === 'list';
  }
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'list':
      return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
      );
  }
}

/** Как значение выглядит в сообщении об отказе. */
export function describeValue(value: unknown): string {
  if (value === undefined) {
    return 'ничего';
  }
  if (Array.isArray(value)) {
    return `список (${value.length})`;
  }
  if (value === null) {
    return 'null';
  }
  return `${typeof value} ${JSON.stringify(value)}`;
}
