/**
 * НОМЕР ВЫПУСКА: разбор и старшинство — включая предвыпускной.
 *
 * Гейт судит номера, а судить их можно только по тем же правилам, по каким их
 * читает менеджер пакетов. Если наше сравнение разойдётся с node-semver хотя бы
 * на одной паре, гейт и реестр будут говорить о номере разное — и прав окажется
 * реестр, потому что у потребителя стоит он.
 *
 * СВЕРКА С РЫНКОМ 2026-08-04 (первоисточник, не пересказ):
 * - `semver.org` §9 (форма предвыпускного), §10 («build metadata MUST be ignored
 *   when determining version precedence»), §11 (старшинство). Оттуда же взято
 *   рекомендованное спецификацией регулярное выражение — ниже.
 * - прогон живого `node-semver@7.8.5`: `0.3.0-dev.1 > 0.2.0`,
 *   `0.3.0-dev.1 < 0.3.0`, `0.3.0-dev.1 < 0.3.0-dev.2`, `0.3.0-dev.10 > 0.3.0-dev.9`,
 *   `1.0.0+build == 1.0.0`, цепочка спеки `1.0.0-alpha < 1.0.0-alpha.1 <
 *   1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 <
 *   1.0.0` воспроизводится целиком. Та же таблица стоит пробой (`version.spec.mjs`):
 *   расхождение с менеджером обязано ронять прогон, а не обнаруживаться выпуском.
 *
 * ЧТО ИЗМЕНИЛОСЬ ПРОТИВ ПРЕЖНЕГО РАЗБОРА. Прежний `parse()` признавал только
 * `^(\d+)\.(\d+)\.(\d+)$` — то есть отвергал предвыпускной номер («не
 * разбирается», поймано живьём 2026-08-03 на `0.3.0-dev.1`) и заодно ПРИНИМАЛ
 * `01.2.3`, который менеджер номером не считает. Оба конца выправлены разом:
 * форма теперь ровно та, что у менеджера.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Префикс `v` (`v1.2.3`) не признаётся: node-semver его глотает
 * из снисхождения к чужим тегам, а мы читаем номер из `package.json` и из своих
 * тегов, где такой формы не бывает. Признать её значило бы завести второй способ
 * писать один номер.
 */

/**
 * Форма номера — регулярное выражение из самой спецификации (semver.org, раздел
 * «Is there a suggested regular expression (RegEx) to check a SemVer string?»).
 * Взято дословно: свой вариант здесь означал бы свою трактовку ведущих нулей и
 * пустых идентификаторов.
 */
const PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Числовой идентификатор предвыпускной части — сравнивается числом, а не текстом. */
const NUMERIC = /^(0|[1-9]\d*)$/;

/**
 * @typedef {object} Version
 * @property {string} raw            номер как написан
 * @property {[number, number, number]} release  тройка перед суффиксом — «база»
 * @property {readonly (string|number)[]} prerelease  идентификаторы после `-`
 * @property {string|null} build     метаданные после `+`; в сравнении не участвуют
 */

/**
 * Разбирает номер. Не разобрался — `null`: это не исключение, а ответ, который
 * гейт печатает человеку.
 *
 * @param {string} version
 * @returns {Version|null}
 */
export function parse(version) {
  const match = PATTERN.exec(version);
  if (match === null) return null;

  const [, major, minor, patch, prerelease, build] = match;
  return {
    raw: version,
    release: [Number(major), Number(minor), Number(patch)],
    prerelease:
      prerelease === undefined
        ? []
        : prerelease
            .split('.')
            .map((id) => (NUMERIC.test(id) ? Number(id) : id)),
    build: build ?? null,
  };
}

/** Номер предвыпускной, если после тройки есть хоть один идентификатор. */
export function isPrerelease(/** @type {Version} */ version) {
  return version.prerelease.length > 0;
}

/** Тройка как текст — то, во что дев-серия однажды превратится (`0.3.0-dev.7` → `0.3.0`). */
export function baseOf(/** @type {Version} */ version) {
  return version.release.join('.');
}

/**
 * Старшинство: `<0`, `0`, `>0` — как у `semver.compare`.
 *
 * Порядок правил — §11 спеки, и порядок этот существенный: сначала тройка, и
 * только при её равенстве в дело идёт суффикс. Поэтому `0.3.0-dev.1` старше
 * `0.2.0` (тройка больше), но младше `0.3.0` (тройка та же, а предвыпускное
 * уступает выпущенному).
 *
 * @param {Version} a
 * @param {Version} b
 */
export function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.release[i] !== b.release[i]) return a.release[i] - b.release[i];
  }

  // §11.3: при равной тройке предвыпускное МЛАДШЕ выпущенного. Это и есть
  // правило «назад не идёт» для дев-серии: после `0.3.0` номер `0.3.0-dev.2`
  // выпуском вперёд не является, сколько бы ни рос счётчик.
  const aPre = isPrerelease(a);
  const bPre = isPrerelease(b);
  if (aPre !== bPre) return aPre ? -1 : 1;
  if (!aPre) return 0;

  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * §11.4 — поидентификаторно: числа сравниваются числами, всё остальное текстом
 * по ASCII, число всегда младше не-числа, а при совпавшем начале длиннее значит
 * старше (`1.0.0-alpha` < `1.0.0-alpha.1`).
 *
 * @param {readonly (string|number)[]} a
 * @param {readonly (string|number)[]} b
 */
function comparePrerelease(a, b) {
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];

    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = typeof left === 'number';
    const rightNumeric = typeof right === 'number';
    if (leftNumeric && rightNumeric) return left - right;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return String(left) < String(right) ? -1 : 1;
  }

  return 0;
}
