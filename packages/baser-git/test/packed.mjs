/**
 * ПАКЕТ, СОБРАННЫЙ ТАК, КАК ЕГО ПОЛУЧИТ ПОТРЕБИТЕЛЬ.
 *
 * Между «файл лежит в репозитории» и «файл приехал потребителю» стоит `files`
 * из `package.json`, и разойтись они могут молча: объявление ссылается на
 * `template/pr-title.mjs.ejs`, а в тарболе его нет — и обвес ломается у первого
 * же пользователя, зеленея у нас. Поэтому здесь `npm pack`, а не копирование
 * каталога и не собственный разбор `files`: свой разбор был бы второй правдой о
 * составе пакета. Приём взят у зоны девбокса (`baser-devbox/test/packed.mjs`) —
 * там же разобрано, почему каталог поставки НАЗЫВАЕТСЯ каждому вызову двери.
 *
 * Короче он здесь по одной причине: у этого обвеса нет ни пресетов, ни второго
 * живого потребителя, — значит и фикстуре нечего про них знать. Резолвер у него
 * теперь есть (`warning.mjs`, форма 7), но фикстуре и он не нужен: модуль
 * приезжает в тарболе и грузится дверью сам, а подменять его было бы подменой
 * ровно того, что зона и проверяет. Всё, что у фикстуры есть, зовут пробы этой
 * зоны.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  cli,
  run as door,
  SUPPLY_CACHE_ENV,
} from '../../baser-cli/src/index.ts';
import { FORM_VERSION } from '../../baser-contracts/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** Исходный каталог пакета — из него собирается тарбол и больше ничего. */
export const PACKAGE_DIR = resolve(here, '..');

/** Корень ЭТОГО репозитория: живая обвязка — эталон приёмки. */
export const REPO_ROOT = resolve(here, '../../..');

export const GIT_PACKAGE = '@omnifield/baser-git';

/** `dest` артефактов обвеса — они же адреса в живом репозитории. */
export const RULE = '.github/scripts/pr-title.mjs';
export const WORKFLOW = '.github/workflows/pr-title.yml';
/**
 * Машинный хук. Живого эталона в репозитории у него НЕТ и быть не может:
 * `.git/` не версионируется, и файл приезжает не с клоном, а с применением.
 * Поэтому судится он не совпадением строк, а попыткой коммита (`hook.spec.mjs`).
 */
export const HOOK = '.git/hooks/pre-commit';

let packed = null;

/**
 * Каталог с содержимым тарбола: то и только то, что уедет в реестр.
 *
 * Собирается один раз на процесс — не ради скорости, а ради того, чтобы все
 * проверки говорили про ОДИН И ТОТ ЖЕ состав пакета.
 */
export function packedRoot() {
  if (packed !== null) {
    return packed;
  }

  const box = mkdtempSync(join(tmpdir(), 'baser-git-pack-'));
  // `--ignore-scripts` — сборка обвеса не должна ничего исполнять: он контент,
  // а не код. Понадобится однажды шаг сборки — этот флаг сломается первым и
  // скажет об этом вслух.
  execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', box, PACKAGE_DIR],
    { cwd: PACKAGE_DIR, stdio: 'pipe' },
  );

  const tarball = readdirSync(box).find((name) => name.endsWith('.tgz'));
  if (tarball === undefined) {
    throw new Error(`npm pack не оставил тарбол в ${box}`);
  }
  execFileSync('tar', ['-xzf', join(box, tarball), '-C', box], {
    stdio: 'pipe',
  });

  packed = join(box, 'package');
  return packed;
}

/** Разобранный `package.json` ОПУБЛИКОВАННОГО пакета. */
export function packedManifest() {
  return JSON.parse(readFileSync(join(packedRoot(), 'package.json'), 'utf-8'));
}

/** Пути всех файлов тарбола относительно корня пакета, в байтовом порядке. */
export function packedFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else {
        out.push(path);
      }
    }
  };
  walk(packedRoot(), '');
  return out.sort();
}

/** Живой артефакт этого репозитория — эталон, а не снимок в фикстуре. */
export function liveArtifact(path) {
  return readFileSync(join(REPO_ROOT, path), 'utf-8');
}

/**
 * Локации, заведённые фикстурой: по корню — где лежит поставка и куда уведён кэш.
 *
 * Реестр, а не вычисление адреса из `cwd`: забытая локация тихо получила бы
 * несуществующий каталог поставки, и дверь ушла бы на склад за ОПУБЛИКОВАННЫМ
 * выпуском — то есть пробы мерили бы не этот обвес.
 */
const locations = new Map();

/** Дверь, вызванная так, как её зовёт эта зона: поставка названа, кэш уведён. */
export function run(options) {
  const location = locations.get(options.cwd);
  if (location === undefined) {
    throw new Error(
      `дверь зовут в локацию, которую фикстура не заводила: ${options.cwd}. ` +
        'Собери её через installConsumer() — иначе каталог поставки некому ' +
        'назвать, и дверь уйдёт за ОПУБЛИКОВАННЫМ обвесом на склад',
    );
  }
  return door({
    ...options,
    sources: [{ packageName: GIT_PACKAGE, path: location.supply }],
    cache: location.cache,
  });
}

/**
 * Дверь, вызванная ЧЕРЕЗ argv — с тем, что увидит человек, и кодом возврата.
 *
 * `run` отдаёт ответ данными, а приёмка слова обвеса судит ДВА исхода сразу:
 * напечатанный текст (его читают глазами) и число, которое увидит конвейер.
 * Ни то, ни другое из `DoorResult` не выводится — печать и код живут в двери, —
 * поэтому здесь зовётся её argv-поверхность, а не собирается второй отчёт.
 *
 * Кэш поставок уводится ПЕРЕМЕННОЙ, потому что через argv его назвать нечем:
 * забыв про него, проба ушла бы на склад за опубликованным выпуском и мерила бы
 * не этот обвес.
 */
export async function runCli(root, argv) {
  const location = locations.get(root);
  if (location === undefined) {
    throw new Error(
      `дверь зовут в локацию, которую фикстура не заводила: ${root}. ` +
        'Собери её через installConsumer()',
    );
  }

  const before = process.env[SUPPLY_CACHE_ENV];
  process.env[SUPPLY_CACHE_ENV] = location.cache;
  try {
    return await cli(
      [...argv, '--cwd', root, '--source', `${GIT_PACKAGE}=${location.supply}`],
      PACKAGE_DIR,
    );
  } finally {
    if (before === undefined) {
      delete process.env[SUPPLY_CACHE_ENV];
    } else {
      process.env[SUPPLY_CACHE_ENV] = before;
    }
  }
}

/** `baser.json` потребителя — ЧТО поставлено, и больше ничего. */
export function consumerConfig() {
  return {
    formVersion: FORM_VERSION,
    sources: [{ use: GIT_PACKAGE }],
  };
}

/** Содержимое ключа `baser` в файле настроек обвеса. */
export function tuning({ settings } = {}) {
  return settings === undefined ? {} : { settings };
}

/** Путь файла настроек этого обвеса у потребителя — по личности обвеса. */
export function tuningPath() {
  return '.omnifield/omnifield-git.yaml';
}

/** Репозиторий потребителя с ПОСТАВЛЕННЫМ обвесом. */
export function installConsumer(options = {}) {
  const box = mkdtempSync(join(tmpdir(), 'baser-git-'));
  const root = join(box, options.repoName ?? 'locality');
  mkdirSync(root, { recursive: true });

  const sourceRoot = join(root, 'node_modules', GIT_PACKAGE);
  mkdirSync(dirname(sourceRoot), { recursive: true });
  cpSync(packedRoot(), sourceRoot, { recursive: true });

  // Кэш поставок ЭТОЙ локации — уведённый с машины и заведомо ненужный: каталог
  // поставки назван, доставать нечего. Каталог не создаётся: его появление и
  // есть след ухода на склад, и приёмка зоны смотрит именно на него.
  const cache = join(box, 'supply-cache');
  locations.set(root, { cache, supply: sourceRoot });

  const consumer = {
    root,
    sourceRoot,
    cache,
    read(path) {
      const file = join(root, path);
      return existsSync(file) ? readFileSync(file, 'utf-8') : null;
    },
    exists(path) {
      return existsSync(join(root, path));
    },
    write(path, content) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    /** Сбить или вернуть права снаружи — то же, что сделала бы чужая ФС. */
    chmod(path, mode) {
      chmodSync(join(root, path), mode);
    },
    cleanup() {
      locations.delete(root);
      rmSync(box, { force: true, recursive: true });
    },
    /** Перезаписывает файл настроек — то же, что сделал бы человек руками. */
    tune(block) {
      consumer.write(tuningPath(), tuningText(block));
    },
    /**
     * Положенное правило, загруженное КАК МОДУЛЬ.
     *
     * Пробы судят заголовки тем самым файлом, который приехал потребителю, а не
     * шаблоном и не копией в пакете: между ними стоит подстановка значений, и
     * ровно она — то, что настройка обещает.
     */
    async rule() {
      const file = join(root, RULE);
      if (!existsSync(file)) {
        throw new Error(`правило не положено: ${file}`);
      }
      // Метка — чтобы повторная кладка на других настройках не отдавала модуль
      // из кэша загрузчика: файл тот же, содержимое другое.
      return import(`${pathToFileURL(file).href}?v=${loaded++}`);
    },
  };

  consumer.write('baser.json', `${JSON.stringify(consumerConfig(), null, 2)}\n`);
  if (options.tuning !== undefined) {
    consumer.tune(options.tuning);
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) {
    consumer.write(path, content);
  }

  return consumer;
}

let loaded = 0;

/**
 * НАСТОЯЩИЙ git-репозиторий в локации.
 *
 * Приёмка хука судится ПОПЫТКОЙ КОММИТА, а не наличием файла: «лежит» и
 * «работает» — тот самый шов, ради которого задача и разводилась (git
 * игнорирует хук без бита исполнения молча, с одним `hint`). Значит и git
 * нужен настоящий, а не изображённый.
 *
 * Идентичность и подпись задаются локально: у машины, где бегут пробы, их может
 * не быть вовсе, и коммит не состоялся бы по причине, к хуку не относящейся.
 */
export function initGit(root) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet');
  git('config', 'user.email', 'probe@example.invalid');
  git('config', 'user.name', 'probe');
  git('config', 'commit.gpgsign', 'false');
  return git;
}

/**
 * Попытка коммита: вердикт git'а и всё, что он сказал.
 *
 * Бросок наружу не выпускается — отвергнутый коммит здесь ОЖИДАЕМЫЙ исход, а не
 * сбой пробы, и вердикт обязан быть значением, которое проба сравнивает.
 */
export function tryCommit(root, message = 'chore: проба') {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  try {
    return {
      committed: true,
      output: String(
        execFileSync('git', ['commit', '-m', message], {
          cwd: root,
          stdio: 'pipe',
        }),
      ),
    };
  } catch (cause) {
    return {
      committed: false,
      output: `${cause.stdout ?? ''}${cause.stderr ?? ''}`,
    };
  }
}

/**
 * Файл настроек текстом — ровно то, что человек написал бы руками.
 *
 * Плоский YAML собирается здесь сам: тянуть в пробы сериализатор ради трёх
 * форм значений (строка, флаг, список) значило бы завести зависимость там, где
 * проверяется чтение, а не запись.
 */
function tuningText(block) {
  const lines = ['baser:'];
  const settings = block.settings ?? {};
  if (Object.keys(settings).length > 0) {
    lines.push('  settings:');
    for (const [key, value] of Object.entries(settings)) {
      if (Array.isArray(value)) {
        lines.push(`    ${key}:`);
        for (const item of value) {
          lines.push(`      - ${JSON.stringify(item)}`);
        }
        continue;
      }
      lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
