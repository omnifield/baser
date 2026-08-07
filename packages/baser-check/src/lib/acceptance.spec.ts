/**
 * ПРИЁМКА: настоящий наш обвес годен — и сверено у него всё объявленное.
 *
 * Прогон идёт по живому `packages/baser-devbox`, а не по выдуманному пакету:
 * приёмка «инструмент проверки работает» держится ровно на том, что он даёт
 * верный ответ про обвес, который мы выпускаем сами.
 *
 * Второе утверждение здесь не менее важно первого: «годен» проверяется вместе с
 * ОБЪЁМОМ проверки. Зелёная проба, которая ничего не сверила, хуже
 * отсутствующей — у нас это подтверждалось дважды, — поэтому тест называет,
 * сколько путей, шаблонов и записей прошло через каждый слой, и падает, если
 * слой вдруг стал пустым или пропущенным.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { checkPackage } from './check.js';
import { DEVBOX_ROOT } from './devbox.fixture.js';

/**
 * ЧУЖОЙ обвес, на котором наблюдение и было сделано, — агент-харнесс brainer
 * (`tasker:BRAIN2-62`, `tasker:BASER2-130`). Берётся установленным, из
 * `node_modules`: это ровно та поставка, которую видит потребитель, а не наша
 * рабочая копия. Версия закреплена в `devDependencies` корня, поэтому образец
 * не уплывает молча.
 */
const FOREIGN_HARNESS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../node_modules/@omnifield/brainer-harness',
);

describe('приёмка на живом обвесе девбокса', () => {
  const report = checkPackage(DEVBOX_ROOT);

  it('обвес подходит посадочному месту', () => {
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.packageName).toBe('@omnifield/baser-devbox');
    expect(report.declaration?.source.id).toBe('omnifield/devbox');
  });

  it('сверены все пять слоёв — ни одного пропуска', () => {
    expect(report.stages.map((stage) => stage.name)).toEqual([
      'manifest',
      'declaration',
      'content',
      'shipping',
      'templates',
    ]);
    expect(report.stages.every((stage) => stage.status === 'ok')).toBe(true);
  });

  it('объём сверенного назван, а не подразумевается', () => {
    const counted = Object.fromEntries(
      report.stages.map((stage) => [stage.name, stage.counted]),
    );

    // 1 корень содержимого + 2 записи раскладки + 3 настройки с резолвером.
    expect(counted['content']).toBe(6);
    // 2 шаблона + 3 модуля резолверов: судятся файлы, а не каталог.
    expect(counted['shipping']).toBe(5);
    // Рендеримая запись у девбокса одна: lock-файл едет байт в байт.
    expect(counted['templates']).toBe(1);
  });

  it('состав поставки прочитан из белого списка манифеста', () => {
    expect(report.shipping).toEqual({
      kind: 'declared',
      patterns: ['template', 'defaults.mjs'],
    });
  });

  it('разобранное объявление уезжает следующему звену цепи', () => {
    expect(report.declaration?.layout).toEqual([
      {
        src: 'devcontainer.json.ejs',
        dest: '.devcontainer/devcontainer.json',
        render: true,
        class: 'regenerated',
        executable: false,
      },
      {
        src: 'devcontainer-lock.json',
        dest: '.devcontainer/devcontainer-lock.json',
        render: false,
        class: 'regenerated',
        executable: false,
      },
    ]);
  });

  it('каждый слой оставил замер', () => {
    expect(report.trace.map((span) => span.name)).toEqual([
      'manifest',
      'declaration',
      'content',
      'shipping',
      'templates',
    ]);
    expect(report.trace.every((span) => Number.isFinite(span.ms))).toBe(true);
  });
});

/**
 * ПРИЁМКА НА ЧУЖОМ ОБВЕСЕ БЕЗ ПОДСТАНОВОК — `tasker:BASER2-130`.
 *
 * Наблюдение сделано не на выдуманном пакете, а на настоящем чужом обвесе,
 * который не рендерит ни одной записи, — поэтому и держит его тот же образец.
 * Судится ЗДЕСЬ ровно то, что увидит человек: причину пропуска дверь печатает
 * хвостом строки слоя (`baser check`, живой прогон 2026-08-03):
 *
 * ```
 *   shipping     ok        16
 *   templates    skipped    0  — мерить нечего: рендеримых записей в раскладке 0 из 16 …
 * ```
 *
 * Само слово `skipped` в колонке итога — машинный статус, по которому снаружи
 * ветвятся (`baser-pack` считает им сверенные слои), и рисует его дверь. Здесь
 * закрепляется то, что принадлежит этой зоне: причина обязана читаться ИТОГОМ,
 * а не оставшейся работой.
 */
describe('приёмка на чужом обвесе без подстановок', () => {
  const report = checkPackage(FOREIGN_HARNESS_ROOT);

  it('образец — тот самый случай: рендеримых записей нет ни одной', () => {
    expect(report.packageName).toBe('@omnifield/brainer-harness');
    expect(report.declaration?.layout.length).toBe(16);
    expect(report.declaration?.layout.some((entry) => entry.render)).toBe(false);
  });

  it('ответ остаётся зелёным — это про читаемость, а не про вердикт', () => {
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(
      report.stages.filter((entry) => entry.status === 'failed'),
    ).toEqual([]);
  });

  it('причина названа итогом, а не пропущенной работой', () => {
    const templates = report.stages.find((entry) => entry.name === 'templates');

    expect(templates?.status).toBe('skipped');
    expect(templates?.counted).toBe(0);
    expect(templates?.reason).toBe(
      'мерить нечего: рендеримых записей в раскладке 0 из 16 — ' +
        'все артефакты едут байт в байт. Это полный ответ слоя, а не отложенная проверка',
    );
  });

  it('машинный ответ не изменился — статусы слоёв прежние', () => {
    expect(report.checkSchemaVersion).toBe(1);
    expect(report.stages.map((entry) => [entry.name, entry.status])).toEqual([
      ['manifest', 'ok'],
      ['declaration', 'ok'],
      ['content', 'ok'],
      ['shipping', 'ok'],
      ['templates', 'skipped'],
    ]);
  });
});
