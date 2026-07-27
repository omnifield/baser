/**
 * Отказы УПАКОВКИ — данные, как у соседей по цепи.
 *
 * Форма отказа взята у контрактов через проверку и не переизобретается: код,
 * адрес, человеческий текст. Потребитель ветвится по коду, а не по строке.
 *
 * ## Чужой отказ едет КАК ЕСТЬ
 *
 * Когда обвес не годен, отказ приходит от `baser-check` и кладётся сюда без
 * переупаковки: тем же кодом, тем же адресом, тем же текстом. Своего «обвес
 * непригоден» упаковка поверх не пишет — две правды об одном событии это два
 * события для читателя, и починок у него станет две вместо одной.
 *
 * Здесь объявлены ТОЛЬКО коды событий, которых у проверки быть не может, потому
 * что она ничего не пишет и ничего не собирает: это события самой сборки.
 */

import type { CheckProblem, CheckProblemCode } from '@omnifield/baser-check';

/**
 * Что не так со СБОРКОЙ нагрузки — то, чего проверка сказать не может.
 *
 * Каждый код — про место назначения или про сам ход сборки, но никогда не про
 * пригодность обвеса: про неё говорит проверка и только она.
 */
export type BuildProblemCode =
  /** В каталоге назначения уже что-то лежит — молча затирать чужое нельзя. */
  | 'payload-target-occupied'
  /**
   * Каталог назначения внутри каталога обвеса.
   *
   * Нагрузка оказалась бы частью того, из чего её собирают: следующая сборка
   * увезла бы предыдущую внутри себя, а сам обвес перестал бы быть чистым.
   */
  | 'payload-target-inside-source'
  /** Каталог назначения не создать или в него не записать. */
  | 'payload-target-unwritable'
  /** Состав поставки не перечислен — спросить у npm не вышло. */
  | 'contents-unlistable'
  /** Файл состава не скопировался в нагрузку. */
  | 'payload-file-uncopyable'
  /** Опись выдачи не записалась рядом с нагрузкой. */
  | 'manifest-unwritable';

/** Код отказа упаковки: свой либо приехавший снизу, но всегда машинный. */
export type PackProblemCode = BuildProblemCode | CheckProblemCode;

/** Отказ в ответе упаковки. Структурно совместим с отказом проверки. */
export interface PackProblem extends Omit<CheckProblem, 'code'> {
  readonly code: PackProblemCode;
}

/**
 * Копилка отказов.
 *
 * Сборка называет беды списком — ровно как проверка и форма: три беды это три
 * строки, а не три прогона.
 */
export class PackProblemLog {
  readonly #problems: PackProblem[] = [];

  add(code: PackProblemCode, at: string, message: string): void {
    this.#problems.push({ code, at, message });
  }

  /** Принимает отказы проверки как есть — код и адрес уже машинные. */
  addAll(problems: readonly (CheckProblem | PackProblem)[]): void {
    this.#problems.push(...problems);
  }

  get empty(): boolean {
    return this.#problems.length === 0;
  }

  get size(): number {
    return this.#problems.length;
  }

  list(): readonly PackProblem[] {
    return this.#problems;
  }
}
