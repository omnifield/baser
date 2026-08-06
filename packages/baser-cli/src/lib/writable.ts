/**
 * МОГУ ЛИ Я СЮДА ПИСАТЬ — спрошено ДО применения, а не в момент записи.
 *
 * Дверь узнавала о невозможности записи ровно тогда, когда писала, и говорила
 * об этом чужим голосом: `EACCES` из библиотеки посреди сброса. Живой случай
 * (`tasker:BASER2-190`): в репозитории мира часть файлов осталась под другим
 * пользователем, и отказ всплыл ПОЗЖЕ — на git-операции, — прочитавшись как
 * защита ветки и как сетевая ошибка. Цена находилась через `find -user root`,
 * то есть человеком, который уже догадался, что дело в правах.
 *
 * Проверка дешёвая, и она отвечает на вопрос, который задают в этот момент:
 * **какие файлы я не смогу записать и почему**. Перечень поимённо, причина
 * рядом с каждым.
 *
 * ## Чего этот модуль НЕ делает
 *
 * **Не чинит владение.** Ни `sudo`, ни `chown`, ни тихой смены владельца: дверь
 * пишет файлы, а не администрирует машину, и молчаливая правка чужого владения —
 * сюрприз хуже отказа. Починку она НАЗЫВАЕТ, делает человек.
 *
 * **Не равняется на `imageUser` и прочие настройки обвесов.** Это настройка
 * ОБВЕСА девбокса, а дверь кладёт артефакты любых обвесов и в любых локациях, в
 * том числе там, где девбокса нет вовсе. Знает она ровно одно — от кого идёт
 * прогон, — и говорит только про это.
 *
 * **Не ходит по репозиторию искать чужое.** Спрашивается ровно то, что дверь
 * собирается записать этим прогоном (плюс паспорт укладки — см. `run.ts`).
 * Обход всего дерева нашёл бы чужие файлы, которых дверь никогда не коснётся, и
 * превратил бы отказ в шум.
 *
 * ## Почему `access`, хотя рынок от него отговаривает
 *
 * Дока Node прямо говорит: «Do not use `fs.access()` to check for the
 * accessibility of a file before calling `fs.open()`, `fs.readFile()`, or
 * `fs.writeFile()`. Doing so introduces a race condition» — и разрешает его там,
 * где файл не будет использован сразу: «check for the accessibility of a file
 * only if the file will not be used directly» (сверено 2026-08-05,
 * `nodejs.org/api/fs.html`). Наш случай — второй, и вот по каким причинам:
 *
 * 1. **Это ОТЧЁТ, а не гейт.** Ответ на вопрос «что не ляжет» едет человеку
 *    вместе с планом, до всякой записи. Обработку ошибки записи он не заменяет:
 *    сброс по-прежнему ловит своё и отвечает `flush-failed` — то есть ровно то,
 *    что дока и требует.
 * 2. **`plan` не пишет ничего, и это инвариант зоны.** Рыночная альтернатива —
 *    открыть файл на запись и обработать ошибку — для НЕСУЩЕСТВУЮЩЕГО файла
 *    означает его создать; в каталоге потребителя, под командой `plan`, это
 *    было бы нарушением более дорогого обещания, чем то, ради которого мы бы
 *    его нарушили.
 * 3. **Гонка тут не про нас.** Она значила бы, что владение файла меняется
 *    посреди прогона — а отчёт остаётся верным на момент, когда его сняли, и
 *    само применение всё равно проверяется ядром.
 *
 * ## Вердикт — у ядра, объяснение — из `stat`
 *
 * Считать права самим (владелец · группа · биты · ACL · sticky) значило бы
 * держать вторую правду о том, на что уже отвечает ядро, — и разойтись с ним на
 * первом же нетипичном монтировании. Поэтому «смогу или нет» решает `access`, а
 * `stat` даёт только СЛОВА для объяснения: чей файл и какие на нём биты.
 */

import { accessSync, constants, statSync, type Stats } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import type { ChangeKind } from './tree.js';

/** Запись, которую дверь собирается тронуть: путь в дереве и вид изменения. */
export interface IntendedWrite {
  readonly path: string;
  readonly kind: ChangeKind;
}

/**
 * Одна запись на диске, которая записи не даёт, — и что из-за неё не ляжет.
 *
 * Группировка по ОТКАЗАВШЕЙ записи, а не по пути прогона: каталог, закрытый для
 * записи, останавливает все файлы внутри себя, и повторить причину на каждый из
 * них значило бы сказать одно и то же столько раз, сколько файлов кладёт обвес.
 */
export interface WriteRefusal {
  /** Путь отказавшей записи относительно корня локации. */
  readonly at: string;
  /** Она сама и есть цель записи либо каталог, в котором цель появилась бы. */
  readonly kind: 'file' | 'directory';
  /**
   * Владелец записи. `null` — ФС владения не называет (не POSIX).
   *
   * Число, а не имя: перевод uid в имя — работа службы имён (`/etc/passwd`,
   * LDAP, NSS), у Node её нет, а сочинить имя значило бы уверенно указать не
   * туда. Единственное исключение — `0`: суперпользователь это инвариант POSIX,
   * а не догадка про конкретную машину.
   */
  readonly owner: number | null;
  /** Биты прав — те же, что человек видит в `ls -l`. */
  readonly mode: number;
  /** Что из намеченного этим прогоном в неё упирается. */
  readonly paths: readonly string[];
}

/** От кого идёт прогон. Единственное знание двери о пользователях. */
export interface Runner {
  readonly uid: number | null;
  readonly name: string | null;
}

/**
 * Кто зовёт дверь.
 *
 * `null` в обоих полях — не POSIX либо у пользователя нет записи в службе имён.
 * Молчание тут честнее выдумки: отказ в этом случае назовёт биты и владельца, а
 * про «а ты кто» промолчит.
 */
export function whoRuns(): Runner {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  let name: string | null = null;
  try {
    name = userInfo().username;
  } catch {
    // Имени нет — говорим числом. Это не пробел: uid и есть то, чем ФС
    // отличает пользователей, а имя — удобство поверх него.
  }
  return { uid, name };
}

/**
 * Что из намеченного записать не выйдет.
 *
 * Пусто — писать можно всё. Порядок ответа — тот, в котором пути пришли: список
 * читает человек, а перетасовать его значило бы разойтись с планом, который он
 * только что прочитал.
 */
export function unwritable(
  root: string,
  writes: readonly IntendedWrite[],
): readonly WriteRefusal[] {
  const absolute = resolve(root);
  const found = new Map<string, { entry: Stats; paths: string[] }>();

  for (const write of writes) {
    const target = join(absolute, write.path);
    // Кого спрашивать, решает ВИД изменения, а не наличие файла:
    //   · перезапись упирается в сам файл — каталог при этом не меняется;
    //   · снятие и создание упираются в КАТАЛОГ: и то, и другое правит его
    //     содержимое, а не содержимое файла.
    const asked =
      write.kind === 'UPDATE' ? target : nearestExisting(dirname(target));
    if (asked === null) {
      continue;
    }

    const entry = statOf(asked);
    if (entry === null || writable(asked)) {
      continue;
    }

    const key = asked;
    const seen = found.get(key);
    if (seen === undefined) {
      found.set(key, { entry, paths: [write.path] });
      continue;
    }
    seen.paths.push(write.path);
  }

  return [...found].map(([asked, { entry, paths }]) => ({
    at: relative(absolute, asked) || '.',
    kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
    owner: typeof entry.uid === 'number' ? entry.uid : null,
    mode: entry.mode & 0o777,
    paths,
  }));
}

/**
 * ПОЧЕМУ эта запись не даётся — одной фразой, без указателя на починку.
 *
 * Починка общая на весь отказ и стоит в нём один раз (`run.ts`): повторять её у
 * каждого пути значило бы сделать перечень нечитаемым ровно там, где его читают.
 *
 * Различаются два случая, и различаются они не для красоты — чинятся они
 * по-разному: чужое владение возвращают себе (либо зовут дверь от того
 * пользователя), а свой файл без бита записи чинит сам владелец.
 */
export function describeRefusal(
  refusal: WriteRefusal,
  runner: Runner,
): string {
  const what = refusal.kind === 'directory' ? 'каталог' : 'файл';
  const bits = refusal.mode.toString(8).padStart(3, '0');
  const blocked =
    refusal.kind === 'directory'
      ? ` — в нём не появится: ${refusal.paths.join(' · ')}`
      : '';

  if (refusal.owner === null || runner.uid === null) {
    return `"${refusal.at}" — ${what} записи не даёт (права ${bits})${blocked}`;
  }

  if (refusal.owner !== runner.uid) {
    return (
      `"${refusal.at}" — ${what} ПРИНАДЛЕЖИТ ДРУГОМУ ПОЛЬЗОВАТЕЛЮ ` +
      `(${who(refusal.owner)}, права ${bits}), а прогон идёт от ${who(runner.uid, runner.name)}` +
      blocked
    );
  }

  return (
    `"${refusal.at}" — ${what} твой (${who(runner.uid, runner.name)}), но права ` +
    `${bits} записи не дают${blocked}`
  );
}

/** Пользователь для человеческого глаза: число всегда, имя — если известно. */
function who(uid: number, name?: string | null): string {
  if (name !== undefined && name !== null && name !== '') {
    return `uid ${uid}, ${name}`;
  }
  // Единственное имя, которое дверь называет не спрашивая: `0` — это
  // суперпользователь по определению POSIX, а не догадка про эту машину.
  return uid === 0 ? 'uid 0, суперпользователь' : `uid ${uid}`;
}

/** Ближайшая существующая запись вверх по дереву; `null` — не нашлось. */
function nearestExisting(from: string): string | null {
  let current = from;
  for (;;) {
    if (statOf(current) !== null) {
      return current;
    }
    const up = dirname(current);
    if (up === current) {
      return null;
    }
    current = up;
  }
}

function statOf(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
