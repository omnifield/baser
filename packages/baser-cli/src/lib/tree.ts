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
import type { Tree } from '@nx/devkit';

/** Вид изменения — тот же словарь, на котором говорит движок. */
export type ChangeKind = 'CREATE' | 'UPDATE' | 'DELETE';

/** Дерево потребителя плюс то, что нужно раннеру: список и сброс. */
export interface RepoTree extends Tree {
  /** Сбрасывает накопленное на реальную ФС. Снятия — раньше записей. */
  flush(): void;
}

/** Запись, ожидающая сброса: содержимое либо `null` для снятия. */
interface Pending {
  readonly content: Buffer | null;
  readonly mode?: Mode;
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
    listChanges(): {
      path: string;
      type: ChangeKind;
      content: Buffer | null;
      options?: { mode?: Mode };
    }[] {
      const changes = [];
      for (const [path, held] of pending) {
        const before = bytesOnDisk(path);

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
            ...(held.mode === undefined
              ? {}
              : { options: { mode: held.mode } }),
          });
          continue;
        }

        if (!before.equals(held.content)) {
          changes.push({
            path,
            type: 'UPDATE' as const,
            content: held.content,
            ...(held.mode === undefined
              ? {}
              : { options: { mode: held.mode } }),
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
      }
    },

    /**
     * Переименование и смена прав движку не нужны — он их не зовёт.
     *
     * Отказ, а не тихая заглушка: молчаливый no-op на смене прав отдал бы
     * потребителю файл с неверным режимом и не сказал бы об этом ни слова. Если
     * движок когда-нибудь их позовёт, это будет видно сразу.
     */
    rename(): never {
      throw new Error(
        'дерево двери не умеет rename: движок его не зовёт. ' +
          'Появилась нужда — реализуй явно, а не молчаливой заглушкой',
      );
    },

    changePermissions(): never {
      throw new Error(
        'дерево двери не умеет changePermissions: движок его не зовёт. ' +
          'Права задаются при записи (`write(..., { mode })`)',
      );
    },
  };

  return tree as unknown as RepoTree;
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
