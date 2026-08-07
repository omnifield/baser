/**
 * ДЕРЕВО ДВЕРИ — порт, на котором держится вся запись на диск.
 *
 * Прогон двери целиком проверяют соседние пробы, и они же — сеть безопасности
 * при замене `FsTree` своей реализацией. Но три инварианта они трогают лишь
 * вскользь, а стоят они дорого, поэтому здесь по ним бьют прямо:
 *
 * 1. изменение — это РАСХОЖДЕНИЕ С ДИСКОМ, а не факт вызова `write`;
 * 2. движок обязан видеть то, что сам записал (иначе его журнал отката не
 *    смог бы вернуть прежнее состояние);
 * 3. снятия уезжают на диск раньше записей.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRepoTree } from './tree.js';

let box: string | null = null;

afterEach(() => {
  if (box !== null) {
    rmSync(box, { force: true, recursive: true });
    box = null;
  }
});

/** Каталог с уже лежащими файлами — «репозиторий потребителя до прогона». */
function repo(files: Record<string, string> = {}): string {
  box = mkdtempSync(join(tmpdir(), 'baser-tree-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(box, path)), { recursive: true });
    writeFileSync(join(box, path), content);
  }
  return box;
}

describe('движок видит то, что сам записал', () => {
  it('чтение идёт сначала по накопленному, потом по диску', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'диск\n' }));

    expect(tree.read('a.txt', 'utf-8')).toBe('диск\n');
    tree.write('a.txt', 'память\n');
    expect(tree.read('a.txt', 'utf-8')).toBe('память\n');

    // Журнал отката движка возвращает прежнее содержимое этим же способом.
    tree.write('a.txt', 'диск\n');
    expect(tree.read('a.txt', 'utf-8')).toBe('диск\n');
  });

  it('снятое перестаёт существовать до всякого сброса', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'диск\n' }));

    tree.delete('a.txt');

    expect(tree.exists('a.txt')).toBe(false);
    expect(tree.isFile('a.txt')).toBe(false);
    expect(tree.read('a.txt', 'utf-8')).toBeNull();
    // На диске при этом файл ещё лежит: дерево виртуально.
    expect(existsSync(join(tree.root, 'a.txt'))).toBe(true);
  });

  it('написание пути приводится: "./a" и "a" — один файл, а не два', () => {
    const tree = createRepoTree(repo());

    tree.write('./cfg/a.json', 'раз\n');
    tree.write('cfg//a.json', 'два\n');

    expect(tree.read('cfg/a.json', 'utf-8')).toBe('два\n');
    expect(tree.listChanges().map((change) => change.path)).toEqual([
      'cfg/a.json',
    ]);
  });
});

describe('изменение — расхождение с диском, а не факт вызова', () => {
  it('запись того же содержимого изменением НЕ является', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'то же\n' }));

    tree.write('a.txt', 'то же\n');

    // Иначе прогон, ничего не поменявший, рапортовал бы работу, а «сошлось»
    // перестало бы значить «делать нечего».
    expect(tree.listChanges()).toEqual([]);
  });

  it('откат к прежнему содержимому изменением НЕ является', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'было\n' }));

    tree.write('a.txt', 'стало\n');
    expect(tree.listChanges()).toHaveLength(1);

    tree.write('a.txt', 'было\n');
    expect(tree.listChanges()).toEqual([]);
  });

  it('снятие файла, созданного этим же прогоном, — тоже не изменение', () => {
    const tree = createRepoTree(repo());

    tree.write('new.txt', 'создали\n');
    tree.delete('new.txt');

    // Это отмена собственной записи, а не удаление чужого файла.
    expect(tree.listChanges()).toEqual([]);
  });

  it('вид изменения берётся с ДИСКА: create, update, delete', () => {
    const tree = createRepoTree(
      repo({ 'old.txt': 'был\n', 'gone.txt': 'x\n' }),
    );

    tree.write('new.txt', 'новый\n');
    tree.write('old.txt', 'изменён\n');
    tree.delete('gone.txt');

    expect(
      tree.listChanges().map((change) => `${change.type} ${change.path}`),
    ).toEqual(['DELETE gone.txt', 'CREATE new.txt', 'UPDATE old.txt']);
  });
});

describe('дети каталога: реальные плюс накопленные, минус снятые', () => {
  it('созданное этим прогоном видно наравне с лежащим на диске', () => {
    const tree = createRepoTree(repo({ 'dir/real.txt': 'x\n' }));

    tree.write('dir/pending.txt', 'y\n');
    tree.write('dir/nested/deep.txt', 'z\n');

    expect(tree.children('dir').sort()).toEqual([
      'nested',
      'pending.txt',
      'real.txt',
    ]);
  });

  it('снятое ребёнком не считается', () => {
    const tree = createRepoTree(
      repo({ 'dir/a.txt': 'x\n', 'dir/b.txt': 'y\n' }),
    );

    tree.delete('dir/a.txt');

    expect(tree.children('dir')).toEqual(['b.txt']);
  });

  it('корень дерева читается пустым путём', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'x\n' }));
    tree.write('b.txt', 'y\n');

    expect(tree.children('').sort()).toEqual(['a.txt', 'b.txt']);
  });
});

describe('сброс на диск', () => {
  it('кладёт, обновляет и убирает — и создаёт недостающие каталоги', () => {
    const tree = createRepoTree(
      repo({ 'old.txt': 'был\n', 'gone.txt': 'x\n' }),
    );

    tree.write('deep/nested/new.txt', 'новый\n');
    tree.write('old.txt', 'изменён\n');
    tree.delete('gone.txt');
    tree.flush();

    expect(readFileSync(join(tree.root, 'deep/nested/new.txt'), 'utf-8')).toBe(
      'новый\n',
    );
    expect(readFileSync(join(tree.root, 'old.txt'), 'utf-8')).toBe('изменён\n');
    expect(existsSync(join(tree.root, 'gone.txt'))).toBe(false);
  });

  it('СНЯТИЯ РАНЬШЕ ЗАПИСЕЙ: файл на месте будущего каталога уходит первым', () => {
    // Штатная миграция «артефакт стал каталогом». Порядок здесь не косметика:
    // выполнив запись первой, сброс упёрся бы в занятый путь — и упал бы уже
    // ВНЕ журнала отката движка, то есть без возможности вернуть состояние.
    const tree = createRepoTree(repo({ 'cfg.yml': 'был файлом\n' }));

    tree.delete('cfg.yml');
    tree.write('cfg.yml/inner.yml', 'стал каталогом\n');

    expect(() => tree.flush()).not.toThrow();
    expect(readFileSync(join(tree.root, 'cfg.yml/inner.yml'), 'utf-8')).toBe(
      'стал каталогом\n',
    );
  });

  it('сброс без изменений диска не касается', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'то же\n' }));
    tree.write('a.txt', 'то же\n');

    tree.flush();

    expect(readFileSync(join(tree.root, 'a.txt'), 'utf-8')).toBe('то же\n');
  });
});

/**
 * РЕЖИМ АРТЕФАКТА — судится ФАЙЛ НА ДИСКЕ, а не факт вызова.
 *
 * Здесь кончается шов «объявлено исполняемым» (`tasker:BASER2-208`): форма
 * объявляет, движок доносит, а бит ставит вот этот файл. Поэтому и утверждения
 * тут только про диск — `statSync`, а не «`setExecutable` позвали».
 */
describe('объявленный режим доезжает до бита', () => {
  /** Права файла на диске — те самые девять бит. */
  const rights = (root: string, path: string): number =>
    statSync(join(root, path)).mode & 0o777;

  const runnable = (root: string, path: string): boolean =>
    (rights(root, path) & 0o111) !== 0;

  it('объявленный программой ложится с битом, необъявленный — без', () => {
    const tree = createRepoTree(repo());

    tree.write('hooks/greet.sh', '#!/bin/sh\n');
    tree.setExecutable('hooks/greet.sh', true);
    tree.write('cfg.json', '{}\n');
    tree.flush();

    expect(runnable(tree.root, 'hooks/greet.sh')).toBe(true);
    // Молчание обвеса — не «не программа», а отсутствие утверждения: файл
    // ложится с тем режимом, с каким его создаёт запись, и бита не получает.
    expect(runnable(tree.root, 'cfg.json')).toBe(false);
  });

  it('объявленный данными СНИМАЕТ бит — это утверждение, а не молчание', () => {
    const tree = createRepoTree(repo({ 'hooks/greet.sh': 'было\n' }));
    chmodSync(join(tree.root, 'hooks/greet.sh'), 0o755);

    tree.write('hooks/greet.sh', 'стало\n');
    tree.setExecutable('hooks/greet.sh', false);
    tree.flush();

    expect(runnable(tree.root, 'hooks/greet.sh')).toBe(false);
  });

  it('кладётся БИТ, а не режим целиком: прочие права остаются чужими', () => {
    // Файл, закрытый от всех, кроме владельца. Обвес объявил его программой —
    // и объявил ровно это: `700`, а не общедоступный `755`. Кому его читать,
    // обвес не говорил, и решать за него консоль не станет.
    const tree = createRepoTree(repo({ 'hooks/secret.sh': 'было\n' }));
    chmodSync(join(tree.root, 'hooks/secret.sh'), 0o600);

    tree.write('hooks/secret.sh', 'стало\n');
    tree.setExecutable('hooks/secret.sh', true);
    tree.flush();

    expect(rights(tree.root, 'hooks/secret.sh')).toBe(0o700);
  });

  it('повторный прогон бит не теряет — и работы не выдумывает', () => {
    const root = repo();

    const first = createRepoTree(root);
    first.write('hooks/greet.sh', '#!/bin/sh\n');
    first.setExecutable('hooks/greet.sh', true);
    first.flush();

    const second = createRepoTree(root);
    second.write('hooks/greet.sh', '#!/bin/sh\n');
    second.setExecutable('hooks/greet.sh', true);

    // Сошлось ЦЕЛИКОМ: и содержимое, и режим. Работы нет.
    expect(second.listChanges()).toEqual([]);
    second.flush();
    expect(runnable(root, 'hooks/greet.sh')).toBe(true);
  });

  it('содержимое сошлось, а режим — нет: это РАСХОЖДЕНИЕ, а не тишина', () => {
    // Так выглядит взятие чужого файла во владение (`--confirm`): байты те же,
    // а бита нет. Промолчать здесь значило бы отчитаться «сошлось» о файле,
    // который объявлен программой и программой не является.
    const tree = createRepoTree(repo({ 'hooks/greet.sh': '#!/bin/sh\n' }));

    tree.write('hooks/greet.sh', '#!/bin/sh\n');
    tree.setExecutable('hooks/greet.sh', true);

    expect(
      tree.listChanges().map((change) => `${change.type} ${change.path}`),
    ).toEqual(['UPDATE hooks/greet.sh']);

    tree.flush();
    expect(runnable(tree.root, 'hooks/greet.sh')).toBe(true);
  });

  it('режим для пути, который дерево не пишет, — отказ, а не тихий пропуск', () => {
    const tree = createRepoTree(repo({ 'a.txt': 'x\n' }));

    expect(() => tree.setExecutable('a.txt', true)).toThrow(/режим объявлен/);
  });
});

describe('чего дерево двери не умеет — говорит вслух', () => {
  it('rename и changePermissions бросают, а не молчат', () => {
    const tree = createRepoTree(repo());

    // Молчаливая заглушка на смене прав отдала бы потребителю файл с неверным
    // режимом и не сказала бы об этом ни слова.
    expect(() => tree.rename('a', 'b')).toThrow(/не умеет rename/);
    expect(() => tree.changePermissions('a', '755')).toThrow(
      /не умеет changePermissions/,
    );
  });
});
