/**
 * ПРИЁМКА: из настоящего нашего обвеса собирается нагрузка, и опись описывает
 * то, что реально внутри.
 *
 * Прогон идёт по живому `packages/baser-devbox`, а не по выдуманному пакету:
 * упаковщик, годный только на выдуманном обвесе, не проверен.
 *
 * Два утверждения здесь равноценны. Первое — «собралось». Второе — «состав
 * закрыт списком»: в нагрузку не уехало ничего сверх названного и из неё ничего
 * не потерялось. Второе проверяется не пересчётом строк описи, а сверкой описи
 * с ДИСКОМ: отпечаток каждого файла берётся заново с того, что легло.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  cleanupBoxes,
  DEVBOX_ROOT,
  sandbox,
  target,
  treeFiles,
} from './devbox.fixture.js';
import { PAYLOAD_MANIFEST_FILE, payloadDigest } from './manifest.js';
import { packPackage } from './pack.js';
import type { PayloadManifest } from './manifest.js';

/**
 * Состав нагрузки девбокса — ЗАКРЫТЫМ списком.
 *
 * Список написан руками, а не выведен из того, что собралось: сверка выхода с
 * самим собой всегда зелёная. Появится в обвесе новый файл — этот тест обязан
 * покраснеть и потребовать, чтобы человек назвал его вслух.
 *
 * `README.md` и `package.json` npm увозит независимо от `files`, `template` и
 * `defaults.mjs` перечислены белым списком.
 */
const PAYLOAD_FILES = [
  'README.md',
  'defaults.mjs',
  'package.json',
  'template/devcontainer-lock.json',
  'template/devcontainer.json.ejs',
];

describe('приёмка на живом обвесе девбокса', () => {
  const report = packPackage(DEVBOX_ROOT, { into: target() });
  const manifest = report.manifest as PayloadManifest;

  afterAll(cleanupBoxes);

  it('нагрузка собрана', () => {
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.payloadRoot).not.toBeNull();
    expect(report.check.ok).toBe(true);
    expect(report.verify?.ok).toBe(true);
  });

  it('состав нагрузки закрыт списком — ничего лишнего и ничего потерянного', () => {
    expect(treeFiles(report.payloadRoot as string)).toEqual(PAYLOAD_FILES);
    expect(manifest.files.map((file) => file.path)).toEqual(PAYLOAD_FILES);
  });

  it('опись описывает то, что реально внутри, а не намерение', () => {
    for (const file of manifest.files) {
      const path = join(report.payloadRoot as string, file.path);
      const content = readFileSync(path);
      expect(file.bytes).toBe(statSync(path).size);
      expect(file.sha256).toBe(
        createHash('sha256').update(content).digest('hex'),
      );
    }
    expect(manifest.digest).toBe(payloadDigest(manifest.files));
  });

  it('опись лежит рядом с нагрузкой, а не внутри неё', () => {
    expect(existsSync(report.manifestPath as string)).toBe(true);
    expect(treeFiles(report.payloadRoot as string)).not.toContain(
      PAYLOAD_MANIFEST_FILE,
    );
    expect(
      JSON.parse(readFileSync(report.manifestPath as string, 'utf-8')),
    ).toEqual(manifest);
  });

  it('принимающая сторона узнаёт деталь, не вскрывая её', () => {
    expect(manifest.source).toEqual({
      id: 'omnifield/devbox',
      title: 'Девбокс: проект целиком в контейнере',
      package: { name: '@omnifield/baser-devbox', version: '0.2.0' },
    });
    expect(manifest.formVersion).toBe(1);
    expect(manifest.artifacts).toEqual([
      {
        dest: '.devcontainer/devcontainer.json',
        from: 'template/devcontainer.json.ejs',
        render: true,
      },
      {
        dest: '.devcontainer/devcontainer-lock.json',
        from: 'template/devcontainer-lock.json',
        render: false,
      },
    ]);
  });

  it('в описи сказано, чем деталь проверена — обоими вердиктами', () => {
    expect(manifest.shipping).toEqual({
      claim: 'declared',
      decidedBy: 'npm',
    });
    expect(manifest.verified.checkSchemaVersion).toBe(
      report.check.checkSchemaVersion,
    );
    expect(manifest.verified.source).toEqual({
      ok: true,
      stages: report.check.stages,
    });
    expect(manifest.verified.payload).toEqual({
      ok: true,
      stages: report.verify?.stages,
    });
    // Оба вердикта — не один и тот же дважды: сверяли разные каталоги.
    expect(report.check.root).not.toBe(report.verify?.root);
  });

  it('объём сделанного назван, а не подразумевается', () => {
    const counted = Object.fromEntries(
      report.stages.map((stage) => [stage.name, stage.counted]),
    );

    expect(report.stages.every((stage) => stage.status === 'ok')).toBe(true);
    // Пять слоёв проверки сверены на обоих каталогах — ни одного пропуска.
    expect(counted['check']).toBe(5);
    expect(counted['verify']).toBe(5);
    // Пять файлов состава: перечислены, скопированы, описаны.
    expect(counted['contents']).toBe(PAYLOAD_FILES.length);
    expect(counted['payload']).toBe(PAYLOAD_FILES.length);
    expect(counted['manifest']).toBe(PAYLOAD_FILES.length);
    expect(counted['target']).toBe(1);
  });

  it('каждый шаг оставил замер', () => {
    expect(report.trace.map((span) => span.name)).toEqual([
      'check',
      'target',
      'contents',
      'payload',
      'verify',
      'manifest',
    ]);
    expect(report.trace.every((span) => Number.isFinite(span.ms))).toBe(true);
  });

  /**
   * Главная приёмка замысла, а не кода.
   *
   * Всё остальное здесь проверяет, что упаковка сделала то, что задумала. Этот
   * тест проверяет, что задумано было верно: нагрузка обязана быть НЕ ПОХОЖА, а
   * РАВНА тому, что потребитель получил бы из реестра. Иначе «мы спросили у
   * npm» осталось бы словами — состав спрашивают у него одним способом, а
   * увозит он другим.
   *
   * Поэтому здесь настоящий `npm pack` с настоящим тарболом, а не тот же
   * `--dry-run`, которым собирали: сверять выход с самим собой бессмысленно.
   */
  it('нагрузка байт в байт равна тому, что npm увёз бы в тарболе', () => {
    const box = sandbox();
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', box, DEVBOX_ROOT],
      { cwd: box, stdio: 'pipe' },
    );
    const tarball = readdirSync(box).find((name) => name.endsWith('.tgz'));
    expect(tarball).toBeDefined();
    execFileSync('tar', ['-xzf', join(box, tarball as string), '-C', box], {
      stdio: 'pipe',
    });

    const unpacked = join(box, 'package');
    const payload = report.payloadRoot as string;
    expect(treeFiles(payload)).toEqual(treeFiles(unpacked));
    for (const path of treeFiles(unpacked)) {
      expect(readFileSync(join(payload, path))).toEqual(
        readFileSync(join(unpacked, path)),
      );
    }
  });

  it('две сборки одного обвеса дают одно слово', () => {
    const again = packPackage(DEVBOX_ROOT, { into: target() });

    expect(again.ok).toBe(true);
    expect(again.manifest?.digest).toBe(manifest.digest);
    expect(again.manifest?.files).toEqual(manifest.files);
  });
});
