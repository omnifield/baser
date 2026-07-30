/**
 * УБОРКА ЗА ОТКАЗОМ — обещание безусловное, значит и проба безусловная.
 *
 * Зона обещает в шапке и в README: «всё, что упаковка успела положить на диск
 * до отказа, она за собой убирает». Обещание в доке — такой же контракт, как
 * метод: человек, которому сказали, что мусора не будет, планирует по этому
 * слову и на слово же полагается.
 *
 * Проверяется оно здесь ОДНИМ вопросом ко ВСЕМ ветвям отказа — «что осталось на
 * диске» — и в том положении, где уборка сужается: **каталог выдачи существовал
 * ДО нас**. Тогда снести его целиком нельзя (он чужой), и убирать приходится
 * поимённо то, что положили сами. Ровно здесь обещание и разошлось с кодом
 * (`tasker:BASER2-74`): нагрузка убиралась, а опись — нет, потому что лежит она
 * не внутри нагрузки, а рядом с ней.
 *
 * ## Почему отказы здесь наведённые
 *
 * Три последние ветви — это отказы ОКРУЖЕНИЯ, а не обвеса: npm не ответил, файл
 * не скопировался, диск кончился на записи описи. Настоящим диском их не
 * вызвать: к этому моменту каталог выдачи уже проверен на пустоту и на
 * доступность записи, а подложить в него сломанный адрес значило бы подделать
 * условие, которого в живом прогоне не бывает.
 *
 * Поэтому ломается ровно системный вызов и ровно в одной точке за раз, а всё
 * прочее в пробе — настоящее: живой обвес, настоящий `npm pack`, настоящий
 * диск. Запись описи при этом кладёт ОГРЫЗОК и бросает `ENOSPC` — как настоящий
 * полный диск, который часть байт записал, а остальные не смог.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** Что сломано в этом прогоне. Ровно одна точка за раз. */
const broken = vi.hoisted(() => ({
  manifest: false,
  contents: false,
  copyOf: '',
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();

  const writeFileSync: typeof real.writeFileSync = (path, data, options) => {
    if (broken.manifest && String(path).endsWith('payload.json')) {
      real.writeFileSync(path, String(data).slice(0, 32), options);
      throw fail('ENOSPC', `no space left on device, write '${String(path)}'`);
    }
    return real.writeFileSync(path, data, options);
  };

  const copyFileSync: typeof real.copyFileSync = (from, to, mode) => {
    if (broken.copyOf !== '' && String(from).endsWith(broken.copyOf)) {
      throw fail('EIO', `i/o error, copyfile '${String(from)}'`);
    }
    return real.copyFileSync(from, to, mode);
  };

  return {
    ...real,
    default: { ...real, writeFileSync, copyFileSync },
    writeFileSync,
    copyFileSync,
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const execFileSync: typeof real.execFileSync = ((...args: never[]) => {
    if (broken.contents) {
      throw fail('ENOENT', 'npm недоступен');
    }
    return (real.execFileSync as (...a: never[]) => unknown)(...args);
  }) as typeof real.execFileSync;
  return { ...real, default: { ...real, execFileSync }, execFileSync };
});

function fail(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

const { cleanupBoxes, DEVBOX_ROOT, sandbox, treeFiles } = await import(
  './devbox.fixture.js'
);
const { packPackage } = await import('./pack.js');

afterEach(() => {
  broken.manifest = false;
  broken.contents = false;
  broken.copyOf = '';
  cleanupBoxes();
});

/** Каталог выдачи, который БЫЛ ЗДЕСЬ ДО НАС: пустой, но чужой. */
function existingTarget(): string {
  const into = join(sandbox(), 'out');
  mkdirSync(into, { recursive: true });
  return into;
}

describe('отказ на записи описи', () => {
  it('назван своим кодом, а не проглочен', () => {
    broken.manifest = true;

    const packed = packPackage(DEVBOX_ROOT, { into: existingTarget() });

    expect(packed.ok).toBe(false);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'manifest-unwritable',
    ]);
    expect(packed.problems[0]?.message).toContain('ENOSPC');
    expect(packed.manifest).toBeNull();
    expect(packed.manifestPath).toBeNull();
    expect(packed.payloadRoot).toBeNull();
  });

  /**
   * Заявка аудита `tasker:BASER2-74`, проверенная на коде.
   *
   * Опись лежит РЯДОМ с нагрузкой, а не внутри неё, — и уборка, снимавшая
   * нагрузку, проходила мимо неё. Сам каталог выдачи при этом остаётся: он был
   * здесь до нас, и трогать его нельзя.
   */
  it('не оставляет огрызка описи рядом с пустым местом', () => {
    broken.manifest = true;
    const into = existingTarget();

    packPackage(DEVBOX_ROOT, { into });

    expect(existsSync(into)).toBe(true);
    expect(treeFiles(into)).toEqual([]);
  });

  it('уносит выдачу целиком, если каталога выдачи до нас не было', () => {
    broken.manifest = true;
    const into = join(sandbox(), 'out');

    packPackage(DEVBOX_ROOT, { into });

    expect(existsSync(into)).toBe(false);
  });
});

/**
 * Тот же вопрос — ко всем остальным ветвям отказа.
 *
 * Каталог выдачи везде существовал ДО прогона: это положение, в котором уборка
 * сужается и в котором дефект описи жил. Ветвь «негодный обвес» сюда не входит
 * — там отказ случается раньше первого байта, и он покрыт в `pack.spec`.
 */
describe('что осталось на диске — по каждой ветви отказа', () => {
  it('состав поставки не перечислен', () => {
    broken.contents = true;
    const into = existingTarget();

    const packed = packPackage(DEVBOX_ROOT, { into });

    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'contents-unlistable',
    ]);
    expect(existsSync(into)).toBe(true);
    expect(treeFiles(into)).toEqual([]);
  });

  it('файл состава не лёг в нагрузку', () => {
    broken.copyOf = 'defaults.mjs';
    const into = existingTarget();

    const packed = packPackage(DEVBOX_ROOT, { into });

    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'payload-file-uncopyable',
    ]);
    expect(existsSync(into)).toBe(true);
    expect(treeFiles(into)).toEqual([]);
  });

  it('удачная сборка ничего не убирает — выдача остаётся на месте', () => {
    const into = existingTarget();

    const packed = packPackage(DEVBOX_ROOT, { into });

    expect(packed.ok).toBe(true);
    expect(treeFiles(into)).toContain('payload.json');
  });
});
