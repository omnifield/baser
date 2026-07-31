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
  ARTIFACT_CLASSES,
  DEFAULT_ARTIFACT_CLASS,
  FORM_VERSION,
  MIN_FORM_VERSION,
} from '@omnifield/baser-contracts';

import {
  cleanupBoxes,
  copyDevbox,
  DEVBOX_ROOT,
  editManifest,
  readManifest,
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

  /**
   * Личность обвеса — прибита НАМЕРЕННО.
   *
   * `id`, `title` и имя пакета меняются осознанным решением, а не ходом времени:
   * это то, по чему принимающая сторона узнаёт обвес. Поехала личность — приёмка
   * обязана покраснеть и потребовать, чтобы человек назвал перемену вслух.
   *
   * НИ ОДНОЙ версии здесь нет специально, и это одно правило, а не два случая:
   * и номер выпуска обвеса, и форма, по которой он объявлен, меняются решением
   * СОСЕДА — первый каждым его релизом, вторая переездом формы в контрактах.
   * Обе поэтому утверждаются формой, а не значением, — соседними пробами ниже.
   */
  it('принимающая сторона узнаёт обвес, не вскрывая нагрузку', () => {
    expect(manifest.source.id).toBe('omnifield/devbox');
    expect(manifest.source.title).toBe('Девбокс: проект целиком в контейнере');
    expect(manifest.source.package.name).toBe('@omnifield/baser-devbox');
    // Класс здесь — не литерал: девбокс его не объявляет, и в описи стоит
    // умолчание, которое проставляет ФОРМА. Поедет умолчание формы — поедет и
    // эта проба вместе с ним, а не покраснеет на ровном месте.
    expect(manifest.artifacts).toEqual([
      {
        dest: '.devcontainer/devcontainer.json',
        from: 'template/devcontainer.json.ejs',
        render: true,
        class: DEFAULT_ARTIFACT_CLASS,
      },
      {
        dest: '.devcontainer/devcontainer-lock.json',
        from: 'template/devcontainer-lock.json',
        render: false,
        class: DEFAULT_ARTIFACT_CLASS,
      },
    ]);
  });

  /**
   * Класс артефакта — утверждается ФОРМОЙ, а не перечислением значений.
   *
   * Перечислить `regenerated` и `placed-once` здесь значило бы завести вторую
   * правду о форме: третье слово (`kb:WEBER-4` его уже описал) приехало бы в
   * контракты, а зона упаковки узнала бы об этом молчанием — класс не доехал
   * бы, и ни одна проба не покраснела. Поэтому проба перебирает то, что
   * объявляет форма, и требует, чтобы КАЖДОЕ её слово доехало до описи как
   * есть.
   *
   * Живой случай, ради которого узел поднят (`tasker:BASER2-63`, снятие
   * оговорки architect 2026-07-30): плагин агент-харнесса заполняется человеком,
   * то есть ровно `placed-once`. Без класса в описи принимающая сторона не
   * отличит его от артефакта, который перепишется на следующем обновлении.
   */
  it('класс артефакта доезжает до описи — каждое слово, которое знает форма', () => {
    expect(ARTIFACT_CLASSES.length).toBeGreaterThanOrEqual(2);

    for (const declared of ARTIFACT_CLASSES) {
      const root = copyDevbox();
      editManifest(root, (manifest) => {
        for (const entry of manifest.baser.layout) {
          entry.class = declared;
        }
      });

      const packed = packPackage(root, { into: target() });

      expect([declared, packed.problems]).toEqual([declared, []]);
      expect(packed.manifest?.artifacts.map((one) => one.class)).toEqual(
        packed.manifest?.artifacts.map(() => declared),
      );
    }
  });

  /**
   * Класс не назван — в описи стоит умолчание формы, а не пусто.
   *
   * Опись существует, чтобы принимающая сторона знала груз не вскрывая: поле,
   * которого иногда нет, заставило бы её гадать, что значит его отсутствие.
   */
  it('необъявленный класс приезжает умолчанием формы, а не дырой', () => {
    const declared = readManifest(DEVBOX_ROOT).baser.layout;

    expect(declared.every((entry) => entry.class === undefined)).toBe(true);
    expect(manifest.artifacts.every((one) => one.class !== undefined)).toBe(
      true,
    );
    expect(manifest.artifacts.map((one) => one.class)).toEqual(
      declared.map(() => DEFAULT_ARTIFACT_CLASS),
    );
  });

  /**
   * Форма объявления — тоже форма, а не значение.
   *
   * Прибитое здесь число утверждало бы, что живой девбокс объявлен ИМЕННО такой
   * формой. Но форму обвеса двигает не упаковка: она едет, когда контракты
   * добавляют слово, а обвес решает им воспользоваться (`tasker:BASER2-116` —
   * составной тип, форма 3). Инвариант, который держат две чужие зоны, — не
   * инвариант нашей приёмки: она краснела бы каждым их движением, ничего при
   * этом не поймав.
   *
   * Упаковка отвечает ровно за две вещи, и утверждаются они:
   *
   * 1. **Число НЕ ВЫДУМАНО** — в описи стоит то, что обвес сказал о себе сам,
   *    там же, откуда его берёт сборка. Это и есть обещание поля: опись
   *    переносит объявление как есть, а не толкует его.
   * 2. **Форма — из тех, что этот baser разбирает**: `MIN_FORM_VERSION` ≤ она ≤
   *    `FORM_VERSION`. Собранная нагрузка вне этого окна значит, что упаковка
   *    выдала обвес, разобранный не по своим правилам.
   *
   * Сверка с одной `FORM_VERSION` доказывала бы не это. Обвес ВПРАВЕ объявлять
   * форму старше текущей и остаётся законным: `MIN_FORM_VERSION` держится на 2
   * ровно затем, чтобы выпущенные обвесы не переписывались ради возможности,
   * которой не пользуются. Сегодня девбокс объявляет как раз `FORM_VERSION`, и
   * равенство прошло бы — как совпадение, которое умрёт в тот день, когда
   * контракты уедут вперёд, а обвес законно останется позади.
   */
  it('форма в описи — та, что обвес объявил сам, и её этот baser разбирает', () => {
    const declared = readManifest(DEVBOX_ROOT).baser.formVersion;

    expect(manifest.formVersion).toBe(declared);
    expect(manifest.formVersion).toBeGreaterThanOrEqual(MIN_FORM_VERSION);
    expect(manifest.formVersion).toBeLessThanOrEqual(FORM_VERSION);
    // Опись не расходится с тем, что реально уехало в нагрузке.
    expect(readManifest(report.payloadRoot as string).baser.formVersion).toBe(
      manifest.formVersion,
    );
  });

  /**
   * Версия — форма, а не значение.
   *
   * Номер выпуска обвеса не свойство упаковщика: он меняется каждым выпуском
   * соседа, и прибитый здесь литерал делал бы ЧУЖОЙ релизный цикл источником
   * красноты в нашей зоне. Инвариант, который держит только соседняя зона, — не
   * инвариант.
   *
   * Утверждается ровно то, за что упаковка отвечает: версия в описи есть, она
   * непустая и она НЕ ВЫДУМАНА — совпадает с объявленной самим обвесом там же,
   * откуда её берёт сборка. Второй половиной проверяется обещание из названия
   * соседней пробы: то же число лежит и внутри ящика, так что читающему опись
   * незачем его вскрывать.
   */
  it('версия в описи — та, что обвес объявляет сам', () => {
    const declared = readManifest(DEVBOX_ROOT).version;
    const version = manifest.source.package.version;

    expect(typeof declared).toBe('string');
    expect(version).toBe(declared);
    expect(version ?? '').toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
    // Опись не расходится с тем, что реально уехало в нагрузке.
    expect(readManifest(report.payloadRoot as string).version).toBe(version);
  });

  /**
   * Выпуск соседа — не поломка нашей приёмки.
   *
   * Прямая проба на дефект, ради которого переписана предыдущая: обвес выпускает
   * новую версию, и приёмка обязана остаться зелёной, а опись — приехать с новым
   * номером. Ломается КОПИЯ: чужой каталог мы не трогаем.
   */
  it('выпуск обвеса не красит приёмку — номер едет из объявления', () => {
    const root = copyDevbox();
    editManifest(root, (declaration) => {
      declaration.version = '99.0.0-release-probe';
    });

    const released = packPackage(root, { into: target() });

    expect(released.problems).toEqual([]);
    expect(released.ok).toBe(true);
    expect(released.manifest?.source.package.version).toBe(
      '99.0.0-release-probe',
    );
    // Личность обвеса выпуском не меняется — поехал только номер.
    expect(released.manifest?.source.id).toBe(manifest.source.id);
    expect(released.manifest?.source.package.name).toBe(
      manifest.source.package.name,
    );
  });

  it('в описи сказано, чем обвес проверен — обоими вердиктами', () => {
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
