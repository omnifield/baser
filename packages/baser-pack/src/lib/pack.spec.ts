/**
 * ОТКАЗЫ: что упаковка паковать не станет и что после отказа остаётся на диске.
 *
 * Ломается копия живого обвеса — по одному пункту за раз, и каждый тест
 * требует, чтобы назван был именно этот пункт. Второе требование не мягче
 * первого: **после отказа на диске не остаётся ничего, что можно принять за
 * деталь**. Полусобранная нагрузка выглядит как настоящая ровно до того, как её
 * кто-нибудь понесёт.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkPackage } from '@omnifield/baser-check';

import {
  cleanupBoxes,
  copyDevbox,
  DEVBOX_ROOT,
  editManifest,
  sandbox,
  target,
  treeFiles,
} from './devbox.fixture.js';
import { packPackage } from './pack.js';

afterEach(cleanupBoxes);

/** Статусы шагов по имени — «пропущено» здесь не то же самое, что «чисто». */
function statuses(report: {
  stages: readonly { name: string; status: string; reason?: string }[];
}): Record<string, string> {
  return Object.fromEntries(
    report.stages.map((stage) => [stage.name, stage.status]),
  );
}

describe('негодный обвес не пакуется', () => {
  it('отказ приходит от проверки КАК ЕСТЬ, без своего пересказа', () => {
    const root = copyDevbox();
    // Шаблон остаётся на диске, но белый список его больше не увозит: у автора
    // всё зелено, у потребителя пусто.
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs'];
    });

    const packed = packPackage(root, { into: target() });

    expect(packed.ok).toBe(false);
    expect(packed.problems).toEqual(checkPackage(root).problems);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'not-shipped',
      'not-shipped',
    ]);
  });

  it('на диске не появляется ничего: отказ раньше первого байта', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs'];
    });
    const into = target();

    const packed = packPackage(root, { into });

    expect(existsSync(into)).toBe(false);
    expect(packed.payloadRoot).toBeNull();
    expect(packed.manifestPath).toBeNull();
    expect(packed.manifest).toBeNull();
    expect(packed.verify).toBeNull();
  });

  it('шаги ниже пропущены с причиной, а не выданы за чистые', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs'];
    });

    const packed = packPackage(root, { into: target() });

    expect(statuses(packed)).toEqual({
      check: 'failed',
      target: 'skipped',
      contents: 'skipped',
      payload: 'skipped',
      verify: 'skipped',
      manifest: 'skipped',
    });
    expect(
      packed.stages
        .filter((stage) => stage.status === 'skipped')
        .every((stage) => (stage.reason ?? '') !== ''),
    ).toBe(true);
  });

  it('каталога обвеса нет — отказ тоже принадлежит проверке', () => {
    const missing = join(sandbox(), 'нет-такого');

    const packed = packPackage(missing, { into: target() });

    expect(packed.ok).toBe(false);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'root-missing',
    ]);
  });
});

describe('место выдачи', () => {
  it('непустой каталог выдачи — отказ, и чужое остаётся нетронутым', () => {
    const into = join(sandbox(), 'out');
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, 'чужое.txt'), 'не моё\n');

    const packed = packPackage(DEVBOX_ROOT, { into });

    expect(packed.ok).toBe(false);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'payload-target-occupied',
    ]);
    expect(readFileSync(join(into, 'чужое.txt'), 'utf-8')).toBe('не моё\n');
    expect(treeFiles(into)).toEqual(['чужое.txt']);
  });

  it('каталог выдачи внутри обвеса — отказ: деталь не собирают внутрь себя', () => {
    const root = copyDevbox();
    const before = treeFiles(root);

    const packed = packPackage(root, { into: join(root, 'out') });

    expect(packed.ok).toBe(false);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'payload-target-inside-source',
    ]);
    expect(treeFiles(root)).toEqual(before);
  });

  it('пустой каталог выдачи годится и остаётся собой при отказе', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs', '!template/**'];
    });
    const into = join(sandbox(), 'out');
    mkdirSync(into, { recursive: true });

    const packed = packPackage(root, { into });

    expect(packed.ok).toBe(false);
    // Каталог выдачи был здесь до нас — он и остаётся, пустым.
    expect(existsSync(into)).toBe(true);
    expect(treeFiles(into)).toEqual([]);
  });
});

describe('«не могу сказать» про состав поставки', () => {
  it('не запрещает сборку: состав определяет npm, а не разбор', () => {
    const root = copyDevbox();
    // Отрицание, которое ничего не вычитает. Разбору проверки этого не понять —
    // и он честно говорит «не могу сказать» вместо молчаливого «годен».
    editManifest(root, (manifest) => {
      manifest.files = ['template', 'defaults.mjs', '!template/нет-такого.txt'];
    });

    const source = checkPackage(root);
    expect(source.ok).toBe(true);
    expect(source.shipping.kind).toBe('undecidable');

    const packed = packPackage(root, { into: target() });

    expect(packed.ok).toBe(true);
    expect(treeFiles(packed.payloadRoot as string)).toEqual([
      'README.md',
      'defaults.mjs',
      'package.json',
      'template/devcontainer-lock.json',
      'template/devcontainer.json.ejs',
    ]);
  });

  it('и не растворяется в «всё хорошо»: доезжает до получателя нагрузки', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['template', 'defaults.mjs', '!template/нет-такого.txt'];
    });

    const packed = packPackage(root, { into: target() });
    const shipping = packed.manifest?.shipping;

    expect(shipping?.claim).toBe('undecidable');
    expect(shipping?.reason).toContain('отрицание');
    expect(shipping?.decidedBy).toBe('npm');
    // И тем же словом — в вердикте проверки, лежащем в описи целиком.
    expect(
      packed.manifest?.verified.source.stages.find(
        (stage) => stage.name === 'shipping',
      )?.status,
    ).toBe('skipped');
  });

  it('но собранное меряется: пропавший из-за отрицания шаблон ловится', () => {
    const root = copyDevbox();
    // Отрицание вычитает весь каталог шаблонов. Проверка исходного каталога
    // этого не видит — файлы на месте, а список она не судит.
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs', 'template', '!template/**'];
    });
    expect(checkPackage(root).ok).toBe(true);

    const into = target();
    const packed = packPackage(root, { into });

    expect(packed.ok).toBe(false);
    // Отказ снова приходит от проверки как есть — теперь по СОБРАННОЙ нагрузке.
    expect(packed.problems).toEqual(packed.verify?.problems);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'content-root-missing',
      'content-missing',
      'content-missing',
    ]);
    expect(statuses(packed)).toMatchObject({
      check: 'ok',
      payload: 'ok',
      verify: 'failed',
      manifest: 'skipped',
    });
  });

  it('непринятая нагрузка удаляется — выдавать нечего значит нечего', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs', 'template', '!template/**'];
    });
    const into = target();

    const packed = packPackage(root, { into });

    expect(packed.payloadRoot).toBeNull();
    expect(packed.manifest).toBeNull();
    expect(existsSync(into)).toBe(false);
  });
});

describe('нормализация нагрузки', () => {
  it('каталог разработчика не уезжает: необъявленное остаётся дома', () => {
    const root = copyDevbox();
    writeFileSync(join(root, 'заметки.md'), 'черновик\n');
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test', 'прогон.mjs'), 'export default 1\n');

    const packed = packPackage(root, { into: target() });

    expect(packed.ok).toBe(true);
    const inside = treeFiles(packed.payloadRoot as string);
    expect(inside).not.toContain('заметки.md');
    expect(inside).not.toContain('test/прогон.mjs');
  });

  /**
   * Ссылка вместо файла — тот же класс беды, что и забытый `files`, но увидеть
   * его на исходном каталоге нельзя в принципе: файл открывается, белый список
   * его перечисляет, проверка исходника чиста. А npm символические ссылки в
   * поставку не увозит — и модуль резолвера пропадает ровно у потребителя.
   *
   * Ловится это только на СОБРАННОЙ нагрузке. Ради таких случаев вторая
   * проверка и стоит: из первой она не выводится.
   */
  it('символическая ссылка не уезжает — и ловится это на собранном', () => {
    const root = copyDevbox();
    rmSync(join(root, 'defaults.mjs'));
    symlinkSync(join(DEVBOX_ROOT, 'defaults.mjs'), join(root, 'defaults.mjs'));

    const source = checkPackage(root);
    expect(source.ok).toBe(true);
    expect(source.shipping.kind).toBe('declared');

    const into = target();
    const packed = packPackage(root, { into });

    expect(packed.ok).toBe(false);
    expect(packed.problems).toEqual(packed.verify?.problems);
    expect(packed.problems.map((problem) => problem.code)).toEqual([
      'resolver-missing',
      'resolver-missing',
      'resolver-missing',
    ]);
    expect(existsSync(into)).toBe(false);
  });
});
