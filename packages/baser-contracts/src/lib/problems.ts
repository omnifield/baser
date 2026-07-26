/**
 * Отказы формы — данные, а не исключения.
 *
 * Объявление обвеса и конфиг потребителя часто непригодны СРАЗУ В НЕСКОЛЬКИХ
 * местах: три опечатки в конфиге это три опечатки, а не одна. Бросок на первой
 * заставил бы пользователя чинить их по очереди, по одному прогону на штуку,
 * поэтому разбор собирает все и отдаёт списком.
 *
 * Форма ответа машинночитаема в первую очередь (`tasker:BASER2-20`): у отказа
 * есть код для ветвления, адрес и человеческий текст. `describeProblems` —
 * рендер поверх тех же данных, а не отдельная правда.
 */

/** Что именно не так. Ветвиться потребителю — по коду, не по тексту. */
export type FormProblemCode =
  /** На месте объекта пришло не то — строка, массив, `null`. */
  | 'not-an-object'
  /** Обязательного поля нет. */
  | 'missing-field'
  /** Поле есть, но другого типа. */
  | 'wrong-type'
  /** Строка есть, но пустая — имя, которого нет. */
  | 'empty-string'
  /**
   * Поле, которого форма этой версии не знает.
   *
   * Названо, а не пропущено молча: в пределах объявленной версии формы лишнее
   * поле — это опечатка либо надежда на поведение, которого нет (был `mode`).
   * Приезд новых полей закрывает не молчание разбора, а `formVersion`.
   */
  | 'unknown-field'
  /** Обвес не объявил версию формы. */
  | 'form-version-missing'
  /** Версия формы объявлена, но не целым положительным числом. */
  | 'form-version-invalid'
  /** Обвес рассчитан на форму, которой этот baser не знает. */
  | 'form-version-unsupported'
  /** `source.id` не похож на идентичность вида `<поставщик>/<обвес>`. */
  | 'invalid-source-id'
  /** `src`/`dest`/`contentRoot` непригодны как путь. */
  | 'invalid-path'
  /** У настройки нет дефолта — а это вопрос пользователю, которого не бывает. */
  | 'setting-no-default'
  /** У настройки сразу `default` и `defaultFrom` — неизвестно, что победит. */
  | 'setting-two-defaults'
  /** `defaultFrom` не разбирается как `<файл>#<экспорт>`. */
  | 'invalid-resolver-ref'
  /** Резолвер дефолта не нашёлся или бросил. */
  | 'resolver-failed'
  /** Резолвер вернул обещание: он обязан быть синхронным и не ходить наружу. */
  | 'resolver-async'
  /** Значение не того типа, который объявила настройка. */
  | 'value-type-mismatch'
  /** Речь про настройку, которой обвес не объявлял. */
  | 'unknown-setting'
  /** Потребитель просит пресет, которого у обвеса нет. */
  | 'unknown-preset'
  /** Два `layout` одного обвеса целятся в один `dest`. */
  | 'duplicate-dest'
  /** Два РАЗНЫХ обвеса целятся в один `dest` (`kb:BASER2-6`). */
  | 'artifact-shared'
  /** Два обвеса объявили одну и ту же идентичность. */
  | 'duplicate-source-id'
  /** Один и тот же пакет перечислен в конфиге дважды. */
  | 'duplicate-consumer-entry'
  /** Шаблон использует экранирующую форму вывода — кавычка станет `&#34;`. */
  | 'template-html-escape'
  /** Шаблон объявлен рендеримым, но ни одного тега подстановки в нём нет. */
  | 'template-not-ejs'
  /** Шаблон тянет содержимое мимо объявленной раскладки. */
  | 'template-include'
  /** Теги подстановки не сходятся — шаблон оборван. */
  | 'template-unbalanced';

export interface FormProblem {
  readonly code: FormProblemCode;
  /** Адрес в разбираемом документе: `baser.settings.name.default`. */
  readonly at: string;
  /** Человеческим текстом и самодостаточно — без «см. выше». */
  readonly message: string;
}

/** Разбор: либо пригодное значение, либо перечень названных отказов. */
export type FormResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly FormProblem[] };

/** Копилка отказов — чтобы разбор шёл дальше, а не останавливался на первом. */
export class ProblemLog {
  readonly #problems: FormProblem[] = [];

  add(code: FormProblemCode, at: string, message: string): void {
    this.#problems.push({ code, at, message });
  }

  get empty(): boolean {
    return this.#problems.length === 0;
  }

  list(): readonly FormProblem[] {
    return this.#problems;
  }

  /** Пригодное значение отдаём, только если не набралось ни одного отказа. */
  result<T>(value: () => T): FormResult<T> {
    return this.empty
      ? { ok: true, value: value() }
      : { ok: false, problems: this.list() };
  }
}

/** Текстовый рендер поверх тех же данных — для человека в терминале. */
export function describeProblems(problems: readonly FormProblem[]): string {
  if (problems.length === 0) {
    return 'отказов нет';
  }
  return problems
    .map((problem) => `${problem.at}: ${problem.message} [${problem.code}]`)
    .join('\n');
}
