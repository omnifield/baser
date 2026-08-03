/**
 * ЛОМАЕМ ЖИВОЙ ОБВЕС ПО ОДНОМУ ПУНКТУ.
 *
 * Каждый тест портит копию `packages/baser-devbox` ровно в одном месте и
 * проверяет, что назван ИМЕННО ЭТОТ пункт: проба, зеленеющая на сломанном
 * обвесе, и проба, краснеющая на всё подряд, одинаково бесполезны — по ним
 * нельзя чинить.
 *
 * Отдельно проверяется, что список не обрывается на первом отказе: три беды в
 * обвесе обязаны стать тремя строками, а не тремя прогонами.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkPackage } from './check.js';
import {
  cleanupCopies,
  copyDevbox,
  editDeclaration,
  editManifest,
  emptyDir,
  RESOLVER_SETTINGS,
} from './devbox.fixture.js';
import type { CheckProblemCode } from './problems.js';
import type { CheckReport } from './report.js';

afterEach(cleanupCopies);

const codes = (report: CheckReport): CheckProblemCode[] =>
  report.problems.map((problem) => problem.code);

const at = (report: CheckReport, code: CheckProblemCode): string[] =>
  report.problems
    .filter((problem) => problem.code === code)
    .map((problem) => problem.at);

const stage = (report: CheckReport, name: string) =>
  report.stages.find((entry) => entry.name === name);

describe('манифест как файл', () => {
  it('каталога нет — сказано про каталог, а не про пакет', () => {
    const report = checkPackage(join(emptyDir(), 'нет-такого'));

    expect(codes(report)).toEqual(['root-missing']);
    expect(report.ok).toBe(false);
  });

  it('каталог есть, package.json нет — это не пакет', () => {
    const report = checkPackage(emptyDir());

    expect(codes(report)).toEqual(['manifest-missing']);
  });

  it('манифест не JSON — назван он, а не объявление', () => {
    const root = copyDevbox();
    writeFileSync(join(root, 'package.json'), '{ это не json');

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['manifest-unreadable']);
    expect(stage(report, 'declaration')?.status).toBe('skipped');
    expect(stage(report, 'declaration')?.reason).toContain('манифест');
  });

  it('пакет без имени — поставить его нечем', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      delete manifest.name;
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['package-name-missing']);
    // Разбор на этом не встал: поставка сверена целиком.
    expect(stage(report, 'content')?.status).toBe('ok');
    expect(stage(report, 'templates')?.counted).toBe(1);
  });
});

describe('форму судят контракты — проверка их зовёт', () => {
  it('обвес из будущего: версия формы не поддерживается', () => {
    const root = copyDevbox();
    editDeclaration(root, (declaration) => {
      declaration.formVersion = 99;
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['form-version-unsupported']);
    // Сверять поставку не с чем — и это сказано, а не выдано за чистый слой.
    for (const name of ['content', 'shipping', 'templates']) {
      expect(stage(report, name)?.status).toBe('skipped');
      expect(stage(report, name)?.reason).toContain('объявление непригодно');
    }
  });

  it('два dest внутри объявления — столкновение', () => {
    const root = copyDevbox();
    editDeclaration(root, (declaration) => {
      declaration.layout.push({
        src: 'devcontainer-lock.json',
        dest: '.devcontainer/devcontainer.json',
        render: false,
      });
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['duplicate-dest']);
  });

  it('шаблон на чужом языке — язык подстановки судит форма', () => {
    const root = copyDevbox();
    writeFileSync(
      join(root, 'template/devcontainer.json.ejs'),
      '{ "name": "{{ name }}" }\n',
    );

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['template-not-ejs']);
    expect(at(report, 'template-not-ejs')).toEqual([
      'template/devcontainer.json.ejs',
    ]);
  });
});

describe('объявленное лежит в поставке', () => {
  it('шаблона нет — названа запись раскладки, которая его кладёт', () => {
    const root = copyDevbox();
    rmSync(join(root, 'template/devcontainer-lock.json'));

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['content-missing']);
    expect(at(report, 'content-missing')).toEqual([
      'package.json.baser.layout[1].src',
    ]);
    // Второй шаблон при этом прочитан и сверен: слой не свернулся.
    expect(stage(report, 'templates')?.counted).toBe(1);
  });

  it('корня содержимого нет — назван он, а список не обрывается на нём', () => {
    const root = copyDevbox();
    rmSync(join(root, 'template'), { recursive: true });

    const report = checkPackage(root);

    expect(codes(report)).toEqual([
      'content-root-missing',
      'content-missing',
      'content-missing',
    ]);
  });

  it('модуль резолвера пропал — названа каждая настройка, которой он нужен', () => {
    const root = copyDevbox();
    rmSync(join(root, 'defaults.mjs'));

    const report = checkPackage(root);

    expect(codes(report)).toEqual([
      'resolver-missing',
      'resolver-missing',
      'resolver-missing',
    ]);
    expect(at(report, 'resolver-missing')).toEqual(RESOLVER_SETTINGS);
  });

  it('резолвер из каталога разработчика, а не из состава пакета', () => {
    const root = copyDevbox();
    editDeclaration(root, (declaration) => {
      declaration.settings['name']['defaultFrom'] =
        './src/defaults.mjs#devboxName';
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['resolver-missing']);
    expect(report.problems[0].message).toContain('src/defaults.mjs');
  });
});

describe('объявленное уедет потребителю', () => {
  it('шаблоны не попали в files — обвес приедет пустым', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['defaults.mjs'];
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['not-shipped', 'not-shipped']);
    expect(at(report, 'not-shipped')).toEqual([
      'package.json.baser.layout[0].src',
      'package.json.baser.layout[1].src',
    ]);
    // На диске всё на месте — именно поэтому у автора прогоны зелёные.
    expect(stage(report, 'content')?.status).toBe('ok');
  });

  it('модуль резолвера не попал в files — вычислять дефолт будет нечем', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['template'];
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual([
      'not-shipped',
      'not-shipped',
      'not-shipped',
    ]);
    expect(at(report, 'not-shipped')).toEqual(RESOLVER_SETTINGS);
  });

  it('образец увозит часть каталога — назван ровно тот файл, что остался', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['template/*.json', 'defaults.mjs'];
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual(['not-shipped']);
    expect(at(report, 'not-shipped')).toEqual([
      'package.json.baser.layout[0].src',
    ]);
  });

  it('files не объявлен — состав не выдумывается, слой пропущен вслух', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      delete manifest.files;
    });

    const report = checkPackage(root);

    expect(report.ok).toBe(true);
    expect(report.shipping).toEqual({ kind: 'not-declared' });
    expect(stage(report, 'shipping')?.status).toBe('skipped');
    expect(stage(report, 'shipping')?.reason).toContain('.npmignore');
  });

  it('в files отрицание — состав неразбираем, и это сказано', () => {
    const root = copyDevbox();
    editManifest(root, (manifest) => {
      manifest.files = ['template', 'defaults.mjs', '!template/*.md'];
    });

    const report = checkPackage(root);

    expect(report.ok).toBe(true);
    expect(report.shipping.kind).toBe('undecidable');
    expect(stage(report, 'shipping')?.status).toBe('skipped');
    expect(stage(report, 'shipping')?.reason).toContain('отрицание');
  });
});

describe('обвес без подстановок — слою нечего мерить', () => {
  /**
   * Тот же случай, что у чужого обвеса в приёмке, но точечной поломкой живого:
   * закрепляет формулировку и счёт «0 из N» независимо от чужой поставки —
   * подними её версию, и приёмка расскажет об этом, а эта проба не соврёт.
   */
  it('причина читается итогом, а не оставшейся работой', () => {
    const root = copyDevbox();
    editDeclaration(root, (declaration) => {
      for (const entry of declaration.layout) {
        entry.render = false;
      }
    });

    const report = checkPackage(root);

    // Зелёный ответ обязан остаться зелёным: это про читаемость, не про вердикт.
    expect(codes(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(stage(report, 'templates')?.status).toBe('skipped');
    expect(stage(report, 'templates')?.counted).toBe(0);
    expect(stage(report, 'templates')?.reason).toBe(
      'мерить нечего: рендеримых записей в раскладке 0 из 2 — ' +
        'все артефакты едут байт в байт. Это полный ответ слоя, а не отложенная проверка',
    );
  });

  it('пропуск от непригодного объявления остаётся пропуском — прогон красный', () => {
    const root = copyDevbox();
    editDeclaration(root, (declaration) => {
      declaration.formVersion = 99;
    });

    const report = checkPackage(root);

    // Два состояния под одним машинным именем различает ТОЛЬКО причина: там
    // сверять было нечем, здесь — нечего. Слить их в один текст значило бы
    // потерять разницу, ради которой правка и делалась.
    expect(report.ok).toBe(false);
    expect(stage(report, 'templates')?.reason).toContain(
      'объявление непригодно',
    );
    expect(stage(report, 'templates')?.reason).not.toContain('полный ответ');
  });
});

describe('три беды — три строки, а не три прогона', () => {
  it('поломки разных слоёв названы все сразу', () => {
    const root = copyDevbox();
    rmSync(join(root, 'template/devcontainer-lock.json'));
    writeFileSync(
      join(root, 'template/devcontainer.json.ejs'),
      '{ "name": "{{ name }}" }\n',
    );
    editManifest(root, (manifest) => {
      manifest.files = ['template'];
    });

    const report = checkPackage(root);

    expect(codes(report)).toEqual([
      'content-missing',
      'not-shipped',
      'not-shipped',
      'not-shipped',
      'template-not-ejs',
    ]);
  });
});

describe('шаблон есть, но не читается', () => {
  it('назван отдельно от отсутствия — чинится он в другом месте', (ctx) => {
    // Под root права ничего не значат: тест не мешает прогону, но и не врёт,
    // что проверил недоступность.
    if (process.getuid?.() === 0) {
      ctx.skip();
      return;
    }

    const root = copyDevbox();
    const template = join(root, 'template/devcontainer.json.ejs');
    chmodSync(template, 0o000);

    const report = checkPackage(root);
    chmodSync(template, 0o644);

    expect(codes(report)).toEqual(['content-unreadable']);
    expect(at(report, 'content-unreadable')).toEqual([
      'template/devcontainer.json.ejs',
    ]);
  });
});
