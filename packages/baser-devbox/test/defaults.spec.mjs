/**
 * РЕЗОЛВЕРЫ: синхронные, чистые, без сети — и это проверяется, а не обещается.
 *
 * Форма даёт обвесу право исполнить свой код у потребителя
 * (`packages/baser-contracts/README.md` §3: «`defaultFrom` — это исполнение
 * чужого кода»). Радиус этого права ограничен ровно тремя свойствами резолвера,
 * и держать их обязан сам обвес: контракты умеют назвать `resolver-async`, но
 * «сходил в реестр за версией» они назвать не могут — увидят готовое значение.
 *
 * Поэтому свойства меряются здесь, и меряются у ОПУБЛИКОВАННОГО файла: у
 * потребителя исполняется тарбол, а не то, что лежит в монорепе.
 *
 * ── ЧТО ИЗМЕНИЛОСЬ В 0.3.0 ──────────────────────────────────────────────────
 *
 * Резолвер имени начал читать `.git/config` (`tasker:BASER2-32`), и прежняя
 * проверка «в модуле нет НИ ОДНОГО импорта» перестала быть верной. Заменять её
 * на «ну, теперь читаем» нельзя: она была не стилистической, а несущей —
 * модуль без импортов не мог дотянуться никуда, и это держалось по построению.
 *
 * Вместо неё стоит СПИСОК РАЗРЕШЁННОГО: `node:fs` и `node:path`, и ничего
 * больше. Форма даёт резолверу «репозиторий, пакет, файлы рядом» — ровно это и
 * разрешено; сеть, подпроцесс, окружение и часы остаются запрещены поимённо, а
 * не подразумеваются отсутствием импортов.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packedRoot, writeGit } from './packed.mjs';

/** Контекст ровно той формы, которую подаёт дверь. */
function context(repoName = 'baser', root = undefined) {
  return {
    repo: { name: repoName, root: root ?? `/tmp/${repoName}` },
    source: {
      id: 'omnifield/devbox',
      packageName: '@omnifield/baser-devbox',
      version: '0.1.0',
    },
  };
}

/** Каталог с настоящей раскладкой git — и с тем адресом, который проверяем. */
const boxes = [];
function repoAt(folder, origin, layout = 'dir') {
  const box = mkdtempSync(join(tmpdir(), 'baser-devbox-names-'));
  boxes.push(box);
  const root = join(box, folder);
  mkdirSync(root, { recursive: true });
  if (origin !== null) {
    writeGit(root, origin, layout);
  }
  return context(folder, root);
}

let defaults;
let source;

beforeAll(async () => {
  defaults = await import(
    pathToFileURL(join(packedRoot(), 'defaults.mjs')).href
  );
  source = readFileSync(join(packedRoot(), 'defaults.mjs'), 'utf-8');

  return () => {
    for (const box of boxes) {
      rmSync(box, { force: true, recursive: true });
    }
  };
});

describe('свойства, за которые обвес отвечает сам', () => {
  it('СИНХРОННЫ: ни один резолвер не возвращает обещание', () => {
    // Резолвер, вернувший обещание, — отказ `resolver-async` у контрактов.
    // Ловить это прогоном двери поздно: сломается у потребителя, не у нас.
    for (const [name, fn] of Object.entries(defaults)) {
      const value = fn(context());
      expect(value, `${name} вернул thenable`).not.toHaveProperty('then');
      expect(fn.constructor.name, `${name} объявлен async`).toBe('Function');
    }
  });

  it('ЧИСТЫ: тот же контекст — то же значение, другой контекст — своё', () => {
    for (const [name, fn] of Object.entries(defaults)) {
      expect(fn(context()), `${name} не воспроизводится`).toEqual(
        fn(context()),
      );
    }
    expect(defaults.devboxName(context('weber'))).toBe('weber-devbox');
    expect(defaults.repoName(context('weber'))).toBe('weber');
  });

  it('НЕ ХОДЯТ НАРУЖУ: импорт только из node:fs и node:path', () => {
    // Список разрешённого, а не запрещённого: запрещающий перечень молча
    // пропустит то, о чём мы не подумали, а разрешающий — не пропустит ничего.
    const allowed = new Set(['node:fs', 'node:path']);
    const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)]
      .map((match) => match[1])
      .concat(
        [...source.matchAll(/\bimport\s*\(\s*'([^']+)'/g)].map((m) => m[1]),
      );

    expect(
      imports.length,
      'модуль вообще перестал что-либо импортировать',
    ).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(allowed.has(specifier), `запрещённый импорт ${specifier}`).toBe(
        true,
      );
    }
    // Право читать файлы рядом форма даёт; право исполнять и ходить в сеть — нет.
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/child_process|node:http|node:net|node:dns/);
  });

  it('НЕ БРОСАЮТ: непрочитанное не роняет прогон', () => {
    // Отказ резолвера — это `resolver-failed` на ВЕСЬ прогон. Имя девбокса
    // такой цены не стоит, поэтому нечитаемое просто не участвует в ответе.
    const broken = repoAt('fresh', null);
    writeFileSync(join(broken.repo.root, '.git'), 'мусор, а не указатель\n');

    for (const [name, fn] of Object.entries(defaults)) {
      expect(() => fn(broken), `${name} бросил`).not.toThrow();
    }
    expect(defaults.devboxName(broken)).toBe('fresh-devbox');
    expect(() => defaults.devboxName({ repo: {} })).not.toThrow();
  });

  it('НЕ БРОСАЮТ на ПОЛОМАННОЙ раскладке git, а не только на её отсутствии', () => {
    // Разница существенная: «.git нет» резолвер даже не читает, а вот «.git
    // есть, но внутри не то» — это чтение файла, которого нет, то есть бросок.
    // Обе раскладки настоящие: каталог без `config` бывает у оборванного клона,
    // указатель в никуда — у рабочего дерева, чей основной репозиторий унесли.
    const headless = repoAt('fresh', null);
    mkdirSync(join(headless.repo.root, '.git'), { recursive: true });

    const dangling = repoAt('fresh', null);
    writeFileSync(
      join(dangling.repo.root, '.git'),
      `gitdir: ${join(dangling.repo.root, '..', 'нет-такого', 'worktrees', 'wt')}\n`,
    );

    for (const ctx of [headless, dangling]) {
      expect(() => defaults.devboxName(ctx)).not.toThrow();
      expect(defaults.devboxName(ctx)).toBe('fresh-devbox');
    }
  });

  it('НЕ ЕДУТ ПО КАЛЕНДАРЮ: ни часов, ни случайности, ни окружения', () => {
    // Дефолт, ездящий по календарю, ломает воспроизводимость коммита: один и
    // тот же код поднимался бы по-разному завтра и в оффлайне.
    const code = withoutComments(source);
    expect(code).not.toMatch(/\bDate\b/);
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/process\.env/);
  });
});

describe('пин версии рантайма', () => {
  it('КОНКРЕТНОЕ значение, а не latest и не диапазон', () => {
    // В артефакт попадает число (`kb:BASER2-5`): иначе один и тот же коммит
    // поднимается по-разному на разных машинах — классическое «у меня работает».
    expect(defaults.latestStableNode(context())).toMatch(/^\d+$/);
  });

  it('пин выпуска 0.1.0 — Node 24 (Active LTS на дату выпуска)', () => {
    // Число зафиксировано тестом намеренно: это РЕШЕНИЕ выпуска, и двинуть его
    // молча правкой одной строки нельзя — обоснование живёт в `defaults.mjs`
    // рядом с точкой, где его придётся переписать.
    expect(defaults.latestStableNode(context())).toBe('24');
  });

  it('решение объяснено в самом файле, а не в чьей-то памяти', () => {
    expect(source).toMatch(/Active LTS/);
    expect(source).toMatch(/КОГДА ЭТО ЧИСЛО ПОРА ДВИГАТЬ/);
  });
});

describe('имена растут из имени репозитория — вопросов пользователю ноль', () => {
  it('имя девбокса и алиас в сети', () => {
    expect(defaults.devboxName(context('baser'))).toBe('baser-devbox');
    expect(defaults.repoName(context('baser'))).toBe('baser');
  });

  it('адрес origin читается во всех ходовых формах', () => {
    // Форм у адреса несколько, и человек не выбирает, какая ему достанется:
    // `gh repo clone` даёт одну, `git clone` по ssh — другую, зеркало на диске
    // — третью. Разобрана обязана быть каждая, иначе имя молча уедет в каталог.
    const cases = [
      ['https://github.com/omnifield/weber.git', 'weber'],
      ['https://github.com/omnifield/weber', 'weber'],
      ['git@github.com:omnifield/weber.git', 'weber'],
      ['ssh://git@github.com:22/omnifield/weber.git', 'weber'],
      ['/srv/git/weber.git', 'weber'],
      ['https://github.com/omnifield/weber.git/', 'weber'],
      ['https://user:token@github.com/omnifield/weber.git', 'weber'],
    ];

    for (const [url, expected] of cases) {
      expect(defaults.repoName(repoAt('какая-то-папка', url)), url).toBe(
        expected,
      );
    }
  });

  it('берётся ИМЕННО origin, а не первый попавшийся remote', () => {
    // Форк — обычная раскладка, а не экзотика: `origin` это твой форк,
    // `upstream` — то, откуда форкали. Резолвер, берущий первый remote подряд,
    // назвал бы девбокс чужим репозиторием, и в общей сети два разных форка
    // получили бы ОДИН алиас.
    const ctx = repoAt('fork', 'https://github.com/omnifield/weber.git');
    writeFileSync(
      join(ctx.repo.root, '.git', 'config'),
      '[remote "upstream"]\n\turl = https://github.com/omnifield/weber.git\n' +
        '[remote "origin"]\n\turl = git@github.com:me/weber-fork.git\n',
    );

    expect(defaults.repoName(ctx)).toBe('weber-fork');
    // И наоборот: `pushurl` рядом с `url` не должен подменять ответ.
    writeFileSync(
      join(ctx.repo.root, '.git', 'config'),
      '[remote "origin"]\n\tpushurl = git@github.com:me/чужое.git\n' +
        '\turl = https://github.com/omnifield/weber.git\n',
    );
    expect(defaults.repoName(ctx)).toBe('weber');
  });

  it('рабочее дерево: .git файлом, настройки по commondir', () => {
    const ctx = repoAt(
      'weber-feature',
      'git@github.com:omnifield/weber.git',
      'file',
    );

    expect(defaults.repoName(ctx)).toBe('weber');
    expect(defaults.devboxName(ctx)).toBe('weber-devbox');
  });

  it('имя пригодно для docker: ни scope, ни пробелов, ни хвостов', () => {
    // Значение едет в `--network-alias`, то есть становится именем в DNS.
    // Непригодное — это не «некрасиво», а контейнер, который не поднимется.
    expect(defaults.repoName(context('@omnifield/weber'))).toBe('weber');
    expect(defaults.repoName(context('.hidden'))).toBe('hidden');
    expect(defaults.repoName(context('weber v2'))).toBe('weber-v2');
    // Имя, из которого не осталось ни одного пригодного символа: у ответа есть
    // дно, и оно названо. Пустое имя контейнера — сломанный артефакт.
    expect(defaults.repoName(context('мой проект'))).toBe('workspace');
    expect(defaults.repoName(context('a'.repeat(80))).length).toBe(63);
    expect(defaults.repoName(context('/'))).toBe('workspace');
    for (const folder of [
      '@omnifield/weber',
      'мой проект',
      '.hidden',
      'weber v2',
      '/',
    ]) {
      expect(defaults.repoName(context(folder))).toMatch(
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
      );
    }
  });

  it('origin бьёт каталог, каталог — запасной вариант', () => {
    // Порядок и есть решение задачи: `origin` знает репозиторий, каталог знает
    // только человек с его клоном.
    expect(
      defaults.devboxName(
        repoAt('weber-live', 'https://github.com/omnifield/weber.git'),
      ),
    ).toBe('weber-devbox');
    expect(defaults.devboxName(repoAt('weber-live', null))).toBe(
      'weber-live-devbox',
    );
  });

  it('экспортов ровно столько, сколько названо объявлением', () => {
    // Лишний экспорт — это код, который уехал потребителю и никем не зовётся.
    expect(Object.keys(defaults).sort()).toEqual([
      'devboxName',
      'latestStableNode',
      'repoName',
    ]);
  });
});

function withoutComments(text) {
  return text.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
