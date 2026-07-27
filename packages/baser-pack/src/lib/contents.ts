/**
 * СОСТАВ НАГРУЗКИ — спрашиваем у того, кто пакет собирает.
 *
 * Что именно уедет потребителю, решают `files`, `.npmignore` и встроенные
 * правила npm вместе. Переписывать эту семантику к себе значило бы завести
 * вторую правду об упаковке — ту самую, от которой проверка отказалась вслух
 * (`ShippingList.undecidable`). Поэтому состав здесь не вычисляется, а
 * **запрашивается**: `npm pack --dry-run --json` перечисляет ровно те файлы,
 * которые попали бы в тарбол, и не создаёт при этом ни тарбола, ни архива.
 *
 * ## Отсюда же приходит ответ на «не могу сказать»
 *
 * Проверке нечем разобрать отрицание в `files` — и она честно говорит об этом
 * вместо молчаливого «годен». Упаковке разбирать нечего: она задаёт тот же
 * вопрос самому npm и получает список. Неопределённость снимается не более
 * умным разбором, а сменой источника ответа.
 *
 * ## Нагрузка — копия, а не архив
 *
 * Из перечисленного состава файлы копируются в каталог. Каталог годится любому
 * способу доставки без распаковки: его публикуют в реестр, уносят папкой,
 * кладут в локальный том. Тарбол пришлось бы вскрывать, а вскрытие требует
 * внешнего `tar` там, где хватает `node:fs`.
 *
 * Копирование ЧИТАЕТ файл, а не переносит ссылку: символическая ссылка,
 * уехавшая в нагрузку ссылкой, у потребителя указывала бы в никуда. Переносить
 * при этом чаще всего и нечего — npm символические ссылки в поставку не увозит
 * вовсе, и это ещё одно место, где «лежит у автора» и «поедет потребителю»
 * расходятся молча.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { byBytes } from '@omnifield/baser-contracts';

import type { PayloadFile } from './manifest.js';

/** Один файл из состава поставки, как его назвал npm. */
export interface ShippedFile {
  /** Путь относительно корня пакета, канонический (`a/b/c`). */
  readonly path: string;
  readonly bytes: number;
}

export type ShippedContents =
  | { readonly ok: true; readonly files: readonly ShippedFile[] }
  | { readonly ok: false; readonly reason: string };

export type CopiedPayload =
  | { readonly ok: true; readonly files: readonly PayloadFile[] }
  | { readonly ok: false; readonly path: string; readonly reason: string };

/**
 * Перечисляет состав поставки каталога.
 *
 * `--ignore-scripts` — по той же причине, по которой его ставит проба обвеса:
 * обвес это контент, а не код, и перечисление состава ничего исполнять не
 * должно. Понадобится однажды шаг сборки — сломается первым именно этот флаг и
 * скажет об этом вслух.
 */
export function listShippedFiles(root: string): ShippedContents {
  let stdout: string;
  try {
    stdout = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts', root],
      {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // Состав большого обвеса — это тысячи строк JSON, и упереться в
        // умолчание в 1 МБ означало бы отказать пригодному пакету.
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (cause) {
    return {
      ok: false,
      reason: `npm не перечислил состав пакета: ${describeProcess(cause)}`,
    };
  }

  return parseShippedFiles(stdout);
}

/**
 * Разбирает ответ `npm pack --json`.
 *
 * Ответ разбирается строго: неожиданная форма — это «состав неизвестен», а не
 * повод собрать нагрузку из того, что удалось угадать. Собранная по догадке
 * нагрузка выглядит как настоящая ровно до потребителя.
 */
export function parseShippedFiles(stdout: string): ShippedContents {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    return {
      ok: false,
      reason: `ответ npm не разбирается как JSON: ${describe(cause)}`,
    };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      ok: false,
      reason: 'npm описал не один пакет — состав неизвестен',
    };
  }

  const entry = parsed[0] as Record<string, unknown>;
  const raw = entry?.['files'];
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'в ответе npm нет списка файлов' };
  }

  const files: ShippedFile[] = [];
  for (const item of raw) {
    const record = item as Record<string, unknown>;
    const path = record?.['path'];
    if (typeof path !== 'string' || path === '') {
      return { ok: false, reason: 'в списке файлов npm есть запись без пути' };
    }
    if (!isInsidePackage(path)) {
      return {
        ok: false,
        reason:
          `npm назвал файл вне пакета (${JSON.stringify(path)}) — ` +
          'нагрузка собирается только из содержимого обвеса',
      };
    }
    const size = record['size'];
    files.push({ path, bytes: typeof size === 'number' ? size : 0 });
  }

  if (files.length === 0) {
    return {
      ok: false,
      reason:
        'npm перечислил пустой состав — у пакета нет ни одного файла к выдаче',
    };
  }

  return {
    ok: true,
    files: [...files].sort((a, b) => byBytes(a.path, b.path)),
  };
}

/**
 * Копирует состав в каталог нагрузки и описывает то, что реально легло.
 *
 * Размер и отпечаток снимаются с ЛЕГШЕГО файла, а не со слов npm: опись обязана
 * описывать нагрузку, а не намерение её собрать.
 */
export function copyShipped(
  sourceRoot: string,
  files: readonly ShippedFile[],
  payloadRoot: string,
): CopiedPayload {
  const copied: PayloadFile[] = [];

  for (const file of files) {
    const target = join(payloadRoot, file.path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(sourceRoot, file.path), target);
      const content = readFileSync(target);
      copied.push({
        path: file.path,
        bytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    } catch (cause) {
      return { ok: false, path: file.path, reason: describe(cause) };
    }
  }

  return { ok: true, files: copied };
}

/** Путь внутри пакета: относительный, без выходов вверх и без обратных слешей. */
function isInsidePackage(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  return !path.split('/').includes('..');
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Внешняя команда падает молча в stdout — причину она пишет в stderr. */
function describeProcess(cause: unknown): string {
  const stderr = (cause as { stderr?: unknown })?.stderr;
  const tail = typeof stderr === 'string' ? stderr.trim() : '';
  return tail === '' ? describe(cause) : `${describe(cause)}\n${tail}`;
}
