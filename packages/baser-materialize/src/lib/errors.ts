/**
 * Ошибки движка материализации.
 *
 * Правило контракта (`kb:BASER-5`): движок никогда не «падает молча» и никогда
 * не перезаписывает молча — всё, что он отказался сделать, он обязан НАЗВАТЬ.
 * Поэтому каждая ошибка несёт адрес (файл/поле) и причину человеческим текстом.
 */

/** Общий предок ошибок зоны — позволяет потребителю отличить «наше» от чужого. */
export class BaserMaterializeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Декларация продукта не читается или не соответствует форме контракта. */
export class DeclarationError extends BaserMaterializeError {}
