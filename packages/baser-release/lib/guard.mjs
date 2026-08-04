/**
 * ГЕЙТ ВЫПУСКА: ломающее изменение не уедет в реестр патчем.
 *
 * Здесь — само суждение, без единого обращения к диску и git: факты (пакеты,
 * теги, коммиты) подаются снаружи. Так гейт судится пробами на живых номерах
 * наших пакетов, а не только на том, что сегодня лежит в рабочем дереве.
 *
 * ПОЧЕМУ ГЕЙТ ВООБЩЕ ЕСТЬ. `nx release` настроен считать версии по conventional
 * commits, и на пакетах старше `1.0.0` он это делает верно. На НУЛЕВЫХ МАЖОРАХ —
 * а мы все на них — он поднимает патч и фиче, и ломающему: проверено прогоном
 * 2026-08-01, включая явное соответствие типов в `nx.json`, которое ничего не
 * меняет (`tasker:BASER2-95`). То есть номер, посчитанный машиной, сегодня не
 * несёт информации, и потребитель узнаёт о снятом имени, только сломавшись.
 *
 * Решение (user, 2026-08-01): номер назначает человек и называет причину, а
 * НЕВРАНЬЕ держит машина — этот гейт. Уйдём с нулевых мажоров — считалка станет
 * честной сама, и гейт останется страховкой, а не костылём.
 *
 * ЧТО ИМЕННО ОН УТВЕРЖДАЕТ — три вещи, и все три про один вопрос «что этот номер
 * обещает потребителю»:
 *
 *   1. номер называет цену изменения: ломающее с прошлого выпуска требует
 *      подъёма не меньше, чем требует конвенция нулевых мажоров — минор при
 *      `0.x`, мажор при `1.0.0` и старше;
 *   2. выпуск не идёт назад — и для предвыпускного номера это то же правило, что
 *      у менеджера пакетов (`0.3.0-dev.1` старше `0.2.0`, но младше `0.3.0`);
 *   3. занятый номер не переиспользуется: номер — адрес содержимого, а не имя
 *      черновика (`kb:BASER3-20`).
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ. Не назначает версий и не судит фичи с починками: недобранный
 * минор у фичи — потеря сигнала, недобранный минор у ЛОМАЮЩЕГО — сломанный
 * потребитель, и лечится это разным. Здесь только второе.
 *
 * КОГДА МОЛЧИТ. Версия пакета совпадает с последним тегом — выпуска нет,
 * проверять нечего: гейт стоит на PR, а на обычном PR версии не двигаются.
 * Тегов у пакета нет вовсе — он не выпускался ни разу, базы для сравнения нет.
 */

import { baseOf, compare, isPrerelease, parse } from './version.mjs';

/** @typedef {import('./trace.mjs').Trace} Trace */

/**
 * Трейс-заглушка: гейт работает и без наблюдателя.
 * @type {Trace}
 */
const SILENT = { event() {}, span: (_name, run) => run() };

/**
 * @typedef {object} Manifest
 * @property {string} name     имя пакета в реестре
 * @property {string} version  номер из `package.json`
 * @property {string} dir      путь каталога пакета от корня репозитория
 * @property {string} zone     зона-владелец (leaf-имя, `cli` для `baser-cli`)
 * @property {boolean} [private] невыпускаемый — гейту нечего утверждать
 */

/**
 * @typedef {object} Commit
 * @property {string} hash
 * @property {string} subject
 */

/**
 * Судит набор пакетов.
 *
 * @param {object} facts
 * @param {readonly Manifest[]} facts.packages
 * @param {(name: string) => readonly string[]} facts.releasedVersions
 *   номера, выпущенные тегами этого пакета (в любом порядке)
 * @param {(tag: string, pkg: Manifest) => readonly Commit[]} facts.breakingSince
 *   ломающие коммиты, задевшие каталог пакета с указанного тега
 * @param {Trace} [facts.trace]
 * @returns {{said: string[], problems: string[]}}
 */
export function judge({
  packages,
  releasedVersions,
  breakingSince,
  trace = SILENT,
}) {
  /** @type {string[]} */
  const said = [];
  /** @type {string[]} */
  const problems = [];

  for (const pkg of packages) {
    const { name, version } = pkg;
    if (!name || !version || pkg.private) {
      trace.event('release.skipped', {
        package: name ?? pkg.dir,
        private: Boolean(pkg.private),
      });
      continue;
    }

    const verdict = judgeOne(pkg, releasedVersions(name), breakingSince, trace);
    trace.event('release.verdict', {
      package: name,
      version,
      kind: verdict.kind,
    });
    if (verdict.kind === 'problem') problems.push(verdict.text);
    else if (verdict.kind === 'said') said.push(verdict.text);
  }

  return { said, problems };
}

/**
 * Вердикт по одному пакету: `silent` — сказать нечего, `said` — сказано и всё в
 * порядке, `problem` — выпуск не поедет.
 *
 * @param {Manifest} pkg
 * @param {readonly string[]} tags
 * @param {(tag: string, pkg: Manifest) => readonly Commit[]} breakingSince
 * @param {Trace} trace
 * @returns {Verdict}
 */
function judgeOne(pkg, tags, breakingSince, trace) {
  const { name, version } = pkg;

  const released = tags
    .flatMap((raw) => {
      const parsed = parse(raw);
      return parsed === null ? [] : [parsed];
    })
    .sort(compare);

  if (released.length === 0) {
    return say(
      `${name}: тегов выпуска нет — пакет не выпускался, сравнивать не с чем`,
    );
  }

  // Старший выпущенный — ЛЮБОЙ, включая предвыпускной: монотонность номера
  // считается против всего, что уже уехало, а не против одних релизных троек.
  const latest = released[released.length - 1];
  if (latest.raw === version) return { kind: 'silent' };

  const now = parse(version);
  if (now === null) {
    return fail(
      `${name}: версия "${version}" не разбирается как <мажор>.<минор>.<патч>[-<предвыпуск>]`,
    );
  }

  // Правило 3: занятый номер не переиспользуется. Формально это частный случай
  // «назад не идёт», но причина у него своя и человеку она нужна отдельной:
  // «этот номер уже выпущен» чинится другим действием, чем «номер младше».
  if (released.some((entry) => entry.raw === version)) {
    return fail(
      [
        `${name}: номер ${version} уже выпущен тегом ${name}@${version} — занятый номер не переиспользуется.`,
        `  Номер — адрес содержимого, а не имя черновика: под одним номером не может лежать двух разных сборок.`,
      ].join('\n'),
    );
  }

  // Правило 2: выпуск назад не идёт — и для предвыпускного номера это правило
  // менеджера пакетов, а не наше (semver §11.3, сверено с node-semver 2026-08-04):
  // `0.3.0-dev.1` старше `0.2.0`, но младше `0.3.0`.
  if (compare(now, latest) <= 0) {
    return fail(
      `${name}: версия ${version} не старше выпущенной ${latest.raw} — выпуск назад не идёт`,
    );
  }

  // Правило 1: цена изменения. База — последний СТАБИЛЬНЫЙ выпуск, то есть то,
  // что стоит у потребителя по метке `latest`. Мерить дев-сборку против
  // предыдущей дев-сборки было бы неверно: серия `0.3.0-dev.*` — это черновики
  // ОДНОГО будущего выпуска `0.3.0`, и минор за ломающее в этой серии уже поднят
  // один раз — относительно `0.2.0`. Мерили бы против черновика — каждая
  // следующая итерация той же работы сжигала бы ещё один минор.
  const releases = released.filter((entry) => !isPrerelease(entry));
  const stable = releases[releases.length - 1];
  if (stable === undefined) {
    return say(
      `${name}: выпускался только предвыпускными номерами — цену изменения мерить не с чем`,
    );
  }

  const breaking = trace.span(
    'release.breaking-scan',
    () => breakingSince(`${name}@${stable.raw}`, pkg),
    { package: name, since: stable.raw },
  );

  // Предвыпускной номер судится по тройке ПЕРЕД суффиксом: дев-сборка едет к
  // живому потребителю внутри контура и ломается ровно так же, значит и подъём
  // базы требуется тот же, что у обычного выпуска.
  const note = isPrerelease(now) ? ` (предвыпускной, база ${baseOf(now)})` : '';

  if (breaking.length === 0) {
    return say(
      `${name}: ${stable.raw} → ${version}${note}, ломающего с прошлого выпуска нет`,
    );
  }

  // Конвенция нулевых мажоров: пока мажор нулевой, ломающее поднимает МИНОР —
  // мажор занят под «форма встала». После 1.0.0 ломающее поднимает мажор.
  const was = stable.release;
  const enough =
    was[0] === 0
      ? now.release[1] > was[1] || now.release[0] > was[0]
      : now.release[0] > was[0];
  const required = was[0] === 0 ? 'минор' : 'мажор';

  if (enough) {
    return say(
      `${name}: ${stable.raw} → ${version}${note}, ломающих коммитов ${breaking.length} — ${required} набран`,
    );
  }

  return fail(
    [
      `${name}: ${stable.raw} → ${version} — ЭТОГО МАЛО.`,
      `  С прошлого выпуска пакет получил ломающее (${breaking.length}), а номер требует поднять ${required}:`,
      ...breaking.map(({ hash, subject }) => `    ${hash} ${subject}`),
      ...(isPrerelease(now)
        ? [
            `  Номер предвыпускной, и это ничего не меняет: судится тройка перед суффиксом (${baseOf(now)}),`,
            `  потому что дев-сборка едет к живому потребителю и ломает его так же.`,
          ]
        : []),
      `  Потребитель узнает о снятом имени, только сломавшись, — номер обязан сказать это раньше.`,
    ].join('\n'),
  );
}

/**
 * @typedef {{kind: 'silent'} | {kind: 'said'|'problem', text: string}} Verdict
 */

/**
 * @param {string} text
 * @returns {Verdict}
 */
function say(text) {
  return { kind: 'said', text };
}

/**
 * @param {string} text
 * @returns {Verdict}
 */
function fail(text) {
  return { kind: 'problem', text };
}
