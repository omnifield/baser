/**
 * ВИРТУАЛЬНОЕ ДЕРЕВО НАД РЕАЛЬНОЙ ФС — порт, который дверь держит сама.
 *
 * Движок работает только с `Tree` и файловой системы не касается вовсе; кто
 * подаёт ему дерево и кто потом сбрасывает изменения на диск — работа раннера
 * (`packages/baser-materialize/README.md`). Раньше дверь брала для этого `FsTree`
 * из `nx`, и это работало, пока дверь жила в монорепе.
 *
 * ## Почему своя реализация, а не `FsTree`
 *
 * Ручная выдача уносит дверь в чужой репозиторий папкой в руках
 * (`tasker:BASER2-29`), и всё, что она несёт, обязано быть переносимым. `nx` —
 * 21 МБ и платформенные нативные модули (`@nx/nx-linux-x64-gnu` и соседи):
 * бандл с ними перестал бы работать при переносе на другую платформу, то есть
 * ровно там, где обещано «унесли и заработало».
 *
 * Цена вопроса — ШЕСТЬ МЕТОДОВ. Движок зовёт `read` · `write` · `exists` ·
 * `isFile` · `children` · `delete`, и больше ничего; `@nx/devkit` остаётся
 * зависимостью ТИПА, а в рантайме двери его нет. Тащить двадцать мегабайт ради
 * шести методов — не размен, а недосмотр.
 *
 * ## Седьмой член: режим артефакта (`tasker:BASER2-215`)
 *
 * Раскладка объявляет исполняемость (`layout[].executable`, форма 6), движок
 * доносит объявленное отдельным НЕОБЯЗАТЕЛЬНЫМ членом порта — `setExecutable`,
 * а не третьим параметром `write` (`packages/baser-materialize/src/lib/tree.ts`).
 * Форма выбрана так не по вкусу: наш мешок опций столкнулся бы с чужим
 * `{ mode?: Mode }` девкита, а это дерево — `RepoTree extends Tree` из девкита,
 * то есть покрасило бы ровно нашу сборку.
 *
 * Здесь этот член РЕАЛИЗОВАН, и от этого меняется не только диск: движок видит
 * наличие члена и говорит в трейсе `apply.executable`, донеслось ли объявленное
 * до раннера (`port: "accepts"` против `"blind"`). Консоль перестала быть
 * слепым раннером — объявленное доезжает до бита.
 *
 * **Кладётся БИТ, а не режим целиком.** Объявление отвечает на один вопрос —
 * «программа или данные», — и отвечать за него на второй («кому читать») нельзя:
 * файл с правами `600`, объявленный программой, обязан стать `700`, а не
 * общедоступным `755`. Исполняемость поэтому ложится поверх сложившегося
 * режима, и ложится по праву чтения (`programMode`).
 *
 * **Режим — часть расхождения с диском, а не довесок к записи.** Файл, чьё
 * содержимое совпало, а режим объявленному противоречит, — это расхождение, и
 * прогон обязан назвать его работой: иначе «сошлось» значило бы «содержимое
 * сошлось», и шов, ради которого всё это затевалось (`tasker:BASER2-208`),
 * закрылся бы наполовину. Бита, который не держит файловая система, здесь не
 * боимся: исполнение у нас контейнерное (`kb:FUND-4`), и диск под ним свой.
 *
 * ## Что здесь важно не переизобрести
 *
 * Дерево виртуально: изменения копятся в памяти и уезжают на диск ОДНИМ
 * броском (`flush`). Отсюда два инварианта, которые держит этот файл:
 *
 * **Изменение — это расхождение с диском, а не факт вызова `write`.** Запись,
 * совпавшая с тем, что уже лежит, изменением не является: иначе прогон, который
 * ничего не поменял, рапортовал бы работу, а «сошлось» перестало бы значить
 * «делать нечего».
 *
 * **Снятия идут раньше записей.** Артефакт, переобъявленный из файла в каталог,
 * освобождает путь именно снятием; выполнив запись первой, сброс упёрся бы в
 * занятый путь — и упал бы уже ВНЕ журнала отката движка.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Mode } from 'node:fs';
import type { FileChange, Tree } from '@nx/devkit';

/** Вид изменения — тот же словарь, на котором говорит движок. */
export type ChangeKind = 'CREATE' | 'UPDATE' | 'DELETE';

/**
 * Изменение дерева — то же, что у девкита, плюс объявленный режим.
 *
 * Собственный тип, а не чужой `FileChange`, потому что режим уносит на диск
 * этот же список: сброс о нём может узнать только отсюда. Расширение, а не своя
 * форма, — чтобы дерево осталось подходящим порту девкита без приведений.
 */
export interface RepoChange extends FileChange {
  /** Объявленная обвесом исполняемость; поля нет — режим не объявляли. */
  readonly executable?: boolean;
}

/** Дерево потребителя плюс то, что нужно раннеру: список и сброс. */
export interface RepoTree extends Tree {
  /** Сбрасывает накопленное на реальную ФС. Снятия — раньше записей. */
  flush(): void;
  /** Расхождения с диском — включая объявленный режим (`RepoChange`). */
  listChanges(): RepoChange[];
  /**
   * Объявленный раскладкой режим артефакта: программа (`true`) или данные
   * (`false`). Зовёт движок — сразу за записью того же пути и только там, где
   * раскладка режим НАЗВАЛА.
   */
  setExecutable(filePath: string, executable: boolean): void;
}

/** Биты исполняемости — владельцу, группе и остальным. */
const EXECUTABLE_BITS = 0o111;

/**
 * Запись, ожидающая сброса: содержимое либо `null` для снятия.
 *
 * `mode` и `executable` — разные вещи, а не одно в двух видах. Первый приезжает
 * от того, кто задаёт режим ЧИСЛОМ (`write(..., { mode })` — форма девкита,
 * движок ею не пользуется), второй — объявление обвеса «программа или данные»,
 * то есть один бит поверх уже сложившегося режима.
 */
interface Pending {
  readonly content: Buffer | null;
  readonly mode?: Mode;
  readonly executable?: boolean;
}

/**
 * Дерево над каталогом репозитория потребителя.
 *
 * Чтение идёт «сначала накопленное, потом диск»: движок обязан видеть то, что
 * сам же записал в этом прогоне, иначе его собственный журнал отката не смог бы
 * вернуть прежнее состояние.
 */
export function createRepoTree(root: string): RepoTree {
  const absolute = resolve(root);
  const pending = new Map<string, Pending>();

  const full = (path: string): string => join(absolute, path);

  const fileOnDisk = (path: string): boolean => {
    try {
      return statSync(full(path)).isFile();
    } catch {
      return false;
    }
  };

  const bytesOnDisk = (path: string): Buffer | null => {
    try {
      return readFileSync(full(path));
    } catch {
      return null;
    }
  };

  /** Исполняем ли лежащий файл; `null` — файла на диске нет. */
  const executableOnDisk = (path: string): boolean | null => {
    try {
      return (statSync(full(path)).mode & EXECUTABLE_BITS) !== 0;
    } catch {
      return null;
    }
  };

  const tree = {
    root: absolute,

    read(path: string, encoding?: BufferEncoding): Buffer | string | null {
      const key = repoPath(path);
      const held = pending.get(key);
      const content = held !== undefined ? held.content : bytesOnDisk(key);
      if (content === null) {
        return null;
      }
      return encoding === undefined ? content : content.toString(encoding);
    },

    write(
      path: string,
      content: Buffer | string,
      options?: { mode?: Mode },
    ): void {
      pending.set(repoPath(path), {
        content: Buffer.isBuffer(content) ? content : Buffer.from(content),
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      });
    },

    /**
     * ОБЪЯВЛЕННЫЙ РЕЖИМ — поверх записи того же пути, а не вместо неё.
     *
     * Не названный обвесом режим сюда не доезжает вовсе: движок метода не
     * зовёт, и файл остаётся с тем режимом, который у него был. Это не то же
     * самое, что `false` — там обвес СКАЗАЛ «не программа», и утверждение
     * доносится до диска наравне с `true`.
     *
     * Путь без записи — отказ, а не тихий пропуск. Движок зовёт этот член
     * только следом за `write` того же шага; молча проглотить объявление о
     * файле, которого дерево не пишет, значило бы отдать потребителю неверный
     * режим и не сказать об этом ни слова — ровно то, из-за чего вся эта
     * работа и появилась (`tasker:BASER2-208`).
     */
    setExecutable(path: string, executable: boolean): void {
      const key = repoPath(path);
      const held = pending.get(key);
      if (held === undefined || held.content === null) {
        throw new Error(
          `режим объявлен для "${key}", которого дерево консоли в этом прогоне ` +
            'не пишет: режим кладётся вместе с содержимым, а не отдельно от него',
        );
      }
      pending.set(key, { ...held, executable });
    },

    delete(path: string): void {
      pending.set(repoPath(path), { content: null });
    },

    exists(path: string): boolean {
      const key = repoPath(path);
      const held = pending.get(key);
      if (held !== undefined) {
        return held.content !== null;
      }
      return existsSync(full(key));
    },

    isFile(path: string): boolean {
      const key = repoPath(path);
      const held = pending.get(key);
      if (held !== undefined) {
        return held.content !== null;
      }
      return fileOnDisk(key);
    },

    /**
     * Дети каталога: реальные плюс появившиеся в этом прогоне, минус снятые.
     *
     * Накопленное учитывается наравне с диском, потому что движок проверяет по
     * этому списку достижимость объявленного состояния: каталог, который весь
     * снимается этим же планом, препятствием не является, а созданный этим же
     * планом файл — является.
     */
    children(path: string): string[] {
      const base = repoPath(path);
      const names = new Set<string>();

      const directory = base === '' ? absolute : full(base);
      try {
        if (statSync(directory).isDirectory()) {
          for (const name of readdirSync(directory)) {
            names.add(name);
          }
        }
      } catch {
        // Каталога на диске нет — значит все дети только накопленные.
      }

      const prefix = base === '' ? '' : `${base}/`;
      for (const [key, held] of pending) {
        if (held.content === null || !key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        if (rest !== '') {
          names.add(rest.split('/')[0]);
        }
      }

      // Снятое ребёнком больше не считается. Снимаются только файлы: каталог
      // движок целиком не удаляет, поэтому проверять его содержимое здесь не за
      // чем — а если начнёт, это увидит `flush`, а не молчаливый пропуск.
      for (const name of [...names]) {
        const key = base === '' ? name : `${base}/${name}`;
        if (pending.get(key)?.content === null) {
          names.delete(name);
        }
      }

      return [...names];
    },

    /**
     * Накопленные изменения — РАСХОЖДЕНИЯ С ДИСКОМ, а не журнал вызовов.
     *
     * Считается лениво и от текущего состояния: запись, вернувшая файлу
     * прежнее содержимое (журнал отката движка делает ровно это), изменением не
     * является и в список не попадает.
     */
    listChanges(): RepoChange[] {
      const changes = [];
      for (const [path, held] of pending) {
        const before = bytesOnDisk(path);

        // Режим едет вместе со своей записью: сбрасывает его тот же `flush`,
        // который кладёт содержимое, и знать о нём он может только отсюда.
        const declared = {
          ...(held.mode === undefined ? {} : { options: { mode: held.mode } }),
          ...(held.executable === undefined
            ? {}
            : { executable: held.executable }),
        };

        if (held.content === null) {
          // Снятие того, чего на диске не было, — не изменение, а отмена
          // собственной записи (откат создавшего шага).
          if (before !== null) {
            changes.push({ path, type: 'DELETE' as const, content: null });
          }
          continue;
        }

        if (before === null) {
          changes.push({
            path,
            type: 'CREATE' as const,
            content: held.content,
            ...declared,
          });
          continue;
        }

        if (!before.equals(held.content)) {
          changes.push({
            path,
            type: 'UPDATE' as const,
            content: held.content,
            ...declared,
          });
          continue;
        }

        // СОДЕРЖИМОЕ СОШЛОСЬ, А РЕЖИМ — НЕТ: это тоже расхождение с диском.
        // Промолчать здесь значило бы отчитаться «сошлось» о файле, который
        // объявлен программой и программой не является.
        if (
          held.executable !== undefined &&
          executableOnDisk(path) !== held.executable
        ) {
          changes.push({
            path,
            type: 'UPDATE' as const,
            content: held.content,
            ...declared,
          });
        }
      }
      return changes.sort((left, right) => (left.path < right.path ? -1 : 1));
    },

    flush(): void {
      const changes = tree.listChanges();

      // Снятия раньше записей: путь, освобождаемый снятием, обязан
      // освободиться до того, как на него что-то ляжет.
      for (const change of changes) {
        if (change.type === 'DELETE') {
          rmSync(full(change.path), { force: true, recursive: true });
        }
      }
      for (const change of changes) {
        if (change.type === 'DELETE' || change.content === null) {
          continue;
        }
        mkdirSync(dirname(full(change.path)), { recursive: true });
        writeFileSync(full(change.path), change.content);
        if (change.options?.mode !== undefined) {
          chmodSync(full(change.path), change.options.mode);
        }
        // Объявленный режим — ПОСЛЕДНИМ и поверх сложившегося.
        if (change.executable !== undefined) {
          chmodSync(
            full(change.path),
            programMode(full(change.path), change.executable),
          );
        }
      }
    },

    /**
     * Переименование и смена прав движку не нужны — он их не зовёт.
     *
     * Отказ, а не тихая заглушка: молчаливый no-op на смене прав отдал бы
     * потребителю файл с неверным режимом и не сказал бы об этом ни слова. Если
     * движок когда-нибудь их позовёт, это будет видно сразу.
     *
     * Исполняемость сюда не относится: её объявляет раскладка, и доезжает она
     * своим членом порта (`setExecutable`), а не сменой прав по чужому вызову.
     */
    rename(): never {
      throw new Error(
        'дерево консоли не умеет rename: движок его не зовёт. ' +
          'Появилась нужда — реализуй явно, а не молчаливой заглушкой',
      );
    },

    changePermissions(): never {
      throw new Error(
        'дерево консоли не умеет changePermissions: движок его не зовёт. ' +
          'Права задаются при записи (`write(..., { mode })`), а объявленная ' +
          'исполняемость — своим членом порта (`setExecutable`)',
      );
    },
  };

  return tree as unknown as RepoTree;
}

/**
 * РЕЖИМ ФАЙЛА ПОСЛЕ ОБЪЯВЛЕНИЯ: исполняемость идёт туда, где уже есть чтение.
 *
 * Обвес объявляет один предмет — «программа или данные», — и права доступа
 * этим объявлением не переписываются: файл `600`, объявленный программой,
 * становится `700`, а не общедоступным `755`. Кому его читать, обвес не
 * говорил, и решать за него консоль не станет.
 *
 * Бит ставится по маске чтения (`r` → `x`), а не всем трём классам подряд, и
 * это не косметика: право выполнить скрипт без права его прочитать
 * бессмысленно — интерпретатор читает файл. Раздачу бита сужает и сам рынок:
 * `chmod +x` без явного класса режется `umask`, а не ставит `x` всем троим
 * (сверено 2026-08-07). Снятие маской проще постановки: «не программа» — это
 * ровно отсутствие трёх бит, и вопроса «у кого» там нет.
 */
function programMode(file: string, executable: boolean): number {
  const now = statSync(file).mode & 0o777;
  return executable ? now | ((now & 0o444) >> 2) : now & ~EXECUTABLE_BITS;
}

/**
 * Репо-относительный путь в каноничной форме.
 *
 * Написание приводится здесь по той же причине, по которой его приводит движок:
 * один и тот же файл, записанный как `./a.json` и `a.json`, оказался бы двумя
 * разными ключами — и прогон потерял бы собственную запись.
 */
function repoPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}
