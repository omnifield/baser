/**
 * ГЕРМЕТИЧНЫЙ ЗАПУСК ПРОЦЕССА ИЗ ПРОБЫ (`tasker:BASER2-179`).
 *
 * Пробы этой зоны поднимают НАСТОЯЩИЕ репозитории (`git init`, `git commit`) и
 * зовут настоящие внешние программы (`git`, `npm`, `tar`, второй `node`). Всё
 * это по умолчанию наследует окружение прогона — и ровно там жил дефект.
 *
 * ── ЧТО СЛУЧИЛОСЬ 2026-08-04 ────────────────────────────────────────────────
 *
 * Пробу запустил машинный `pre-commit`, а он выставляет git-переменные
 * (`GIT_DIR`, `GIT_INDEX_FILE`, …). Проба подняла временный репозиторий, и
 * вложенный `git` ушёл по унаследованному адресу — В НАШ репозиторий:
 *
 * - ветку `fix/release-live-specs` унесло на три коммита, сделанных пробой;
 * - в `.git/config` встало `core.bare = true`, и основное рабочее дерево
 *   перестало быть рабочим — вместе с лежавшей там незакоммиченной работой.
 *
 * Восстанавливал человек руками.
 *
 * ── ПОЧЕМУ ЭТО НЕ СРАБАТЫВАЛО РАНЬШЕ ────────────────────────────────────────
 *
 * В основном дереве `GIT_DIR`/`GIT_INDEX_FILE` ОТНОСИТЕЛЬНЫЕ (`.git/index`), и
 * вложенный `git` из другого каталога попадал в свой репозиторий: наследование
 * никого не задевало. В связанном дереве (`git worktree`) тот же адрес
 * АБСОЛЮТНЫЙ — и то же самое наследование уводит вложенный `git` наружу.
 *
 * То есть дефект был всегда, а условие для его проявления появилось вместе с
 * параллельной работой в двух деревьях.
 *
 * ── ЧЕМ ЛЕЧИТСЯ ─────────────────────────────────────────────────────────────
 *
 * Не дисциплиной («не забудь передать env»), а ПОСТРОЕНИЕМ: у проб этой зоны
 * нет своего `node:child_process` — любой внешний процесс они запускают отсюда,
 * и здесь окружение чистится один раз на всех. Правило сторожит проба
 * (`sealed.spec.ts`), а не вычитка: она же проверяет, что чистка работает, и
 * что без неё вложенный `git` действительно уходит наружу.
 *
 * **Снимается ВЕСЬ префикс `GIT_`, а не поимённый список.** Список — это снимок
 * сегодняшнего git: он молча устареет на первой же новой переменной, и
 * устареет в сторону «мы думали, что герметично». Префикс — правило самого
 * git: им адресуют репозиторий, индекс, объекты, конфиг и трассировку.
 *
 * Личность коммитов здесь же и флагами, а не переменными: `GIT_AUTHOR_*` и
 * соседи уходят вместе со всем префиксом, и проба, полагавшаяся на них, молча
 * зависела бы от машины прогона.
 *
 * ── ГРАНИЦА ─────────────────────────────────────────────────────────────────
 *
 * Это фикстура ПРОБ. Боевой код двери (`supply.ts`) окружение потребителя не
 * чистит и чистить не должен: там оно не наше, и решать за человека, каким
 * `npm` ему ходить на склад, — не наша работа.
 *
 * Файл исключён из сборки пакета.
 */

import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncReturns,
} from 'node:child_process';

/**
 * Тип долгоживущего процесса — отсюда же.
 *
 * Не косметика: правило зоны звучит как «своего входа к процессам у проб нет», и
 * проба его сторожит по имени модуля. Пустить обратно `node:child_process` ради
 * одного типа значило бы завести исключение, которое завтра приедет с вызовом.
 */
export type { ChildProcess } from 'node:child_process';

/**
 * Переменные, которыми git адресуют репозиторий, — все разом.
 *
 * `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_OBJECT_DIRECTORY`,
 * `GIT_COMMON_DIR`, `GIT_CONFIG*`, `GIT_AUTHOR_*` и всё, что git заведёт
 * завтра.
 */
const GIT_PREFIX = 'GIT_';

/** Наследуемое окружение, из которого снят весь git-префикс. */
export function sealedEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(base).filter(([name]) => !name.startsWith(GIT_PREFIX)),
  );
}

/** Ключи git-окружения, оставшиеся в наборе, — предмет утверждения пробы. */
export function gitVariables(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith(GIT_PREFIX))
    .sort();
}

/**
 * То же, что у `child_process`, — но окружение всегда проходит через чистку.
 *
 * `env` в опциях сохраняет свой смысл (ЗАМЕНА, а не добавка): проба, которой
 * нужен голый `PATH`, задаёт его прямо, и он тоже чистится — правило одно на
 * все входы, иначе у него нашлась бы дырка.
 */
export interface SealedOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdio?: SpawnOptions['stdio'];
  readonly encoding?: 'utf-8';
}

function optionsWith(options: SealedOptions): Record<string, unknown> {
  return {
    ...options,
    env: sealedEnv(options.env ?? process.env),
  };
}

/** Внешняя программа, ответом — её вывод. Аналог `execFileSync`. */
export function runSealed(
  file: string,
  args: readonly string[] = [],
  options: SealedOptions = {},
): string {
  return execFileSync(file, [...args], {
    encoding: 'utf-8',
    ...optionsWith(options),
  }) as unknown as string;
}

/** Та же программа, но нужны ОБА потока и код возврата. Аналог `spawnSync`. */
export function streamsSealed(
  file: string,
  args: readonly string[] = [],
  options: SealedOptions = {},
): SpawnSyncReturns<string> {
  return spawnSync(file, [...args], {
    encoding: 'utf-8',
    ...optionsWith(options),
  });
}

/** Долгоживущий процесс — склад пробы. Аналог `spawn`. */
export function spawnSealed(
  file: string,
  args: readonly string[] = [],
  options: SealedOptions = {},
): ChildProcess {
  return spawn(file, [...args], optionsWith(options));
}

/**
 * GIT ПРОБЫ — в названном каталоге и только в нём.
 *
 * Личность назначается флагами `-c`: у машины прогона её может не быть вовсе
 * (чистый контейнер CI), а `git commit` без неё отказывает. Подпись выключена
 * по той же причине — ключа в контейнере нет, и вопрос о нём проба задать
 * некому.
 */
export function gitSealed(cwd: string, ...args: string[]): string {
  return runSealed(
    'git',
    [
      '-c',
      'user.email=проба@baser',
      '-c',
      'user.name=проба',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd },
  );
}
