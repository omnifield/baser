/**
 * ПРИЁМКА ЗОНЫ: обвес, ПОСТАВЛЕННЫЙ КАК ПАКЕТ, раскладывает git-обвязку в чистое
 * дерево, и результат совпадает с живой обвязкой ЭТОГО репозитория.
 *
 * Зелёные пробы закрытием не являются, поэтому приёмка устроена так, чтобы её
 * нельзя было пройти, не сделав работу:
 *
 * - обвес берётся из ТАРБОЛА (`npm pack`), а не из каталога монорепы;
 * - дверь зовётся настоящая, своей публичной поверхностью, и пишет на диск;
 * - эталон — файлы, которыми прямо сейчас держится гейт заголовка этого
 *   репозитория, а не снимок в фикстуре.
 *
 * ── ПОЧЕМУ ЭТАЛОН ЖИВОЙ ─────────────────────────────────────────────────────
 *
 * Обвес заводится ПЕРЕЕЗДОМ нашей собственной обвязки наружу: до него правило
 * жило файлом в `.github`, после него тот же файл — артефакт поставки. Сверка с
 * живым файлом и есть утверждение «переезд состоялся без потери»: разъехавшись
 * хоть строкой, обвес вёз бы уже не то правило, которое здесь работает.
 *
 * Наши настройки при этом ПУСТЫ — все значения дефолтные, и это проверяется
 * отдельной пробой ниже. Поэтому приёмка гоняет дверь без файла настроек: он у
 * нас не заведён, и заводить его ради пробы значило бы мерить не свою локацию.
 *
 * ── ГДЕ ЖИВЫЕ ФАЙЛЫ ЧИСЛЯТСЯ ВХОДАМИ ────────────────────────────────────────
 *
 * Оба лежат ВНЕ проекта, поэтому оба названы входом задачи `test` поимённо
 * (`nx.namedInputs.default` в манифесте зоны). Без этого nx отдавал бы зелёное
 * из кэша, снятого до правки эталона.
 */

import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { soleRun } from '../../baser-cli/src/index.ts';
import {
  GIT_PACKAGE,
  installConsumer,
  liveArtifact,
  packedFiles,
  packedManifest,
  run,
  RULE,
  WORKFLOW,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Чистое дерево с поставленным обвесом. */
function clean(options = {}) {
  consumer = installConsumer(options);
  return consumer;
}

/**
 * Строки, которыми два текста расходятся, — с номерами.
 *
 * Список, а не «тексты не равны»: упавшая проба обязана называть, ЧТО именно
 * разъехалось, иначе её чинят чтением обоих файлов целиком.
 */
function differingLines(ours, live) {
  const left = String(ours).split('\n');
  const right = String(live).split('\n');
  const out = [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      out.push({ line: index + 1, ours: left[index], live: right[index] });
    }
  }
  return out;
}

describe('ПРИЁМКА: поставил пакет → позвал дверь → обвязка легла', () => {
  it('на дефолтах артефакты СОВПАДАЮТ с живыми файлами этого репозитория', async () => {
    const box = clean();

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('applied');
    expect(result.writes.map((write) => write.path)).toEqual(
      expect.arrayContaining([RULE, WORKFLOW]),
    );

    // Вот оно, утверждение целиком: не расходится НИ ОДНА строка.
    expect(differingLines(box.read(RULE), liveArtifact(RULE))).toEqual([]);
    expect(differingLines(box.read(WORKFLOW), liveArtifact(WORKFLOW))).toEqual(
      [],
    );
  });

  it('повторное применение идемпотентно — второй прогон не пишет ничего', async () => {
    const box = clean();
    await run({ command: 'apply', cwd: box.root });
    const landed = box.read(RULE);

    const again = await run({ command: 'apply', cwd: box.root });

    expect(again.status).toBe('converged');
    expect(again.writes).toEqual([]);
    expect(box.read(RULE)).toBe(landed);
  });

  it('поставка взята из НАЗВАННОГО каталога — на склад дверь не ходила', async () => {
    const box = clean();

    const result = await run({ command: 'plan', cwd: box.root });

    const { source } = soleRun(result);
    expect(source.id).toBe('omnifield/git');
    expect(source.packageName).toBe(GIT_PACKAGE);
    // Версия — из тарбола, собранного ЭТИМ прогоном. Опубликованный выпуск
    // живёт своей жизнью, и здесь эти два числа и разошлись бы.
    expect(source.packageVersion).toBe(packedManifest().version);
    // «Откуда взял» дверь называет в ответе, а не подразумевает.
    expect(source.supply.origin.kind).toBe('local');
    expect(source.supply.fetched).toBe(false);
    // Кэш поставок не создан вовсе — уход на склад оставил бы след.
    expect(existsSync(box.cache)).toBe(false);
  });

  it('в тарбол уехало то, на что ссылается объявление, — и ничего лишнего', () => {
    const files = packedFiles();

    expect(files).toContain('template/pr-title.mjs.ejs');
    expect(files).toContain('template/pr-title.yml.ejs');
    // Пробы и README зоны потребителю не нужны: он получает содержимое, а не
    // наш способ его проверять.
    expect(files.filter((path) => path.startsWith('test/'))).toEqual([]);
  });
});
