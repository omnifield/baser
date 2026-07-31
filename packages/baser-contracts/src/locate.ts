/**
 * `@omnifield/baser-contracts/locate` — ВХОД ДЛЯ РАНТАЙМ-КОДА ОБВЕСА.
 *
 * Отдельный вход пакета, и это не украшение. Основной вход обещает, что форма
 * **ничего не читает и ничего не исполняет**; здесь читают файловую систему и
 * резолвят пакеты — значит граница между тем и другим обязана быть видимой
 * машине, а не только в абзаце доки. Она видна прямо в строке импорта.
 *
 * Кому это нужно: обвесу, который везёт код, живущий у потребителя, — хуку,
 * генератору, проверяльщику. Такому коду нужен собственный файл обвеса, а
 * артефактом этот файл не является: человеку он не нужен, и в репозитории
 * потребителя ему делать нечего (`tasker:BASER2-122`).
 *
 * ```js
 * import { locateSourceContent } from '@omnifield/baser-contracts/locate';
 * import { describeProblems } from '@omnifield/baser-contracts';
 *
 * const эталон = locateSourceContent('brainer/agent-harness', 'settings.hooks.json');
 * if (!эталон.ok) {
 *   console.error(describeProblems(эталон.problems));
 *   process.exit(1);
 * }
 * ```
 *
 * Форма от этого входа не изменилась ни на одно поле: `contentRoot` объявлялся
 * и раньше — новое здесь только то, что дорогу к нему показываем мы, а не
 * каждый обвес по-своему.
 */

export { locateSource, locateSourceContent } from './lib/locate.js';
export type { LocatedSource, LocateOptions } from './lib/locate.js';
