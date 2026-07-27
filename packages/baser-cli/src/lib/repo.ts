/**
 * РЕПОЗИТОРИЙ ПОТРЕБИТЕЛЯ — то, откуда дверь зовут и куда она кладёт.
 *
 * Корень берётся ровно один: каталог, из которого дверь позвали (или `--cwd`).
 * Поиска вверх по дереву тут нет намеренно — «умный» поиск корня означал бы, что
 * один и тот же вызов из разных подкаталогов раскладывает по-разному, а прогон
 * в CI и у человека обязан быть один и тот же (`tasker:BASER2-20`).
 *
 * Конфиг потребителя дверь ЧИТАЕТ, а создаёт ровно один раз — когда его нет
 * вовсе. Дальше он пользовательский и авторитетный: движок в него не пишет и
 * ничего оттуда не чистит (`kb:BASER2-5`), и дверь ведёт себя так же.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CONSUMER_CONFIG_PATH,
  DECLARATION_BLOCK,
  FORM_VERSION,
  parseConsumerConfig,
  type ConsumerConfig,
  type FormResult,
} from '@omnifield/baser-contracts';
import { resolveInstalledPackage } from './installed.js';

/** Куда дверь пришла работать. */
export interface Repo {
  /** Абсолютный корень репозитория потребителя — он же корень дерева. */
  readonly root: string;
  /**
   * Имя репозитория — из имени его каталога.
   *
   * Из него растут имена, которые обвес считает резолвером (`ctx.repo.name`):
   * девбокс `<репозиторий>-devbox`, алиас в сети и прочее. Берётся каталог, а не
   * `name` из `package.json`: имя пакета бывает scope'нутым и служебным
   * (`@omnifield/baser-source`), а «имя репозитория» человек читает с диска.
   */
  readonly name: string;
}

export function readRepo(cwd: string): Repo {
  const root = resolve(cwd);
  return { root, name: basename(root) };
}

/** Конфиг потребителя и то, откуда он взялся. */
export interface ConsumerConfigState {
  /** Путь к `baser.json` относительно корня — он же адрес в сообщениях. */
  readonly path: string;
  /** Файл лежал на диске до прогона. */
  readonly existed: boolean;
  /**
   * Конфиг родила дверь этим прогоном. `plan` его только называет, `apply`
   * кладёт: конфиг рождается сразу пользовательским, поэтому режим владения ему
   * не нужен и движок о нём не знает.
   */
  readonly creates: boolean;
  readonly config: ConsumerConfig;
}

/**
 * Читает конфиг потребителя, а при его отсутствии — рождает.
 *
 * Засев идёт по УСТАНОВЛЕННЫМ зависимостям: обвес — это пакет, объявивший блок
 * `baser`, и другого признака у него нет. Вопросов пользователю при этом не
 * возникает ни одного (`tasker:BASER2-18`) — что поставлено, то и записано.
 *
 * Засев работает ТОЛЬКО когда файла нет. Существующий конфиг авторитетен
 * целиком: иначе снятый пользователем обвес возвращался бы в конфиг сам, и
 * отказаться от поставленного пакета стало бы нечем.
 */
export function readConsumerConfig(
  repo: Repo,
): FormResult<ConsumerConfigState> {
  const path = CONSUMER_CONFIG_PATH;
  const absolute = join(repo.root, path);

  if (!existsSync(absolute)) {
    const config: ConsumerConfig = {
      // Версию формы проставляет дверь, а не пользователь: миграционный крючок
      // появляется, вводить его никто не вводит (`kb:BASER2-5`, §6 формы).
      formVersion: FORM_VERSION,
      sources: discoverInstalledSources(repo).map((use) => ({
        use,
        presets: [],
        settings: {},
      })),
    };
    return {
      ok: true,
      value: { path, existed: false, creates: true, config },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf-8'));
  } catch (cause) {
    return {
      ok: false,
      problems: [
        {
          code: 'not-an-object',
          at: path,
          message: `конфиг не разбирается как JSON: ${describe(cause)}`,
        },
      ],
    };
  }

  const parsed = parseConsumerConfig(raw, path);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    value: { path, existed: true, creates: false, config: parsed.value },
  };
}

/** Сериализация конфига — ровно то, что дверь кладёт при его рождении. */
export function serializeConsumerConfig(config: ConsumerConfig): string {
  return `${JSON.stringify(
    {
      formVersion: config.formVersion,
      sources: config.sources.map((entry) => ({
        use: entry.use,
        ...(entry.presets.length > 0 ? { presets: entry.presets } : {}),
        ...(Object.keys(entry.settings).length > 0
          ? { settings: entry.settings }
          : {}),
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * Имена поставленных пакетов, объявивших себя обвесами.
 *
 * Проход по объявленным зависимостям, а не по всему `node_modules`: обвес — это
 * то, что потребитель поставил СЕБЕ, а не то, что приехало транзитивно с чужой
 * зависимостью. Порядок байтовый — конфиг, рождённый дважды на одной раскладке,
 * обязан выйти одинаковым.
 */
function discoverInstalledSources(repo: Repo): string[] {
  const manifest = join(repo.root, 'package.json');
  if (!existsSync(manifest)) {
    return [];
  }

  let parsed: { dependencies?: unknown; devDependencies?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf-8'));
  } catch {
    // Битый манифест потребителя — не наша забота и не повод падать: обвесов из
    // него просто не видно, а конфиг родится пустым и скажет об этом вслух.
    return [];
  }

  const names = new Set<string>();
  for (const block of [parsed.dependencies, parsed.devDependencies]) {
    if (typeof block === 'object' && block !== null) {
      for (const name of Object.keys(block)) {
        names.add(name);
      }
    }
  }

  return [...names]
    .sort()
    .filter((name) => declaresItselfSource(name, repo.root));
}

function declaresItselfSource(packageName: string, repoRoot: string): boolean {
  const installed = resolveInstalledPackage(packageName, repoRoot);
  if (!installed.ok) {
    return false;
  }
  const manifest = installed.value.manifest;
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    (manifest as Record<string, unknown>)[DECLARATION_BLOCK] !== undefined
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
