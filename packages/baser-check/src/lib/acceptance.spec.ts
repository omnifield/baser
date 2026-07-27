/**
 * ПРИЁМКА: настоящий наш обвес годен — и сверено у него всё объявленное.
 *
 * Прогон идёт по живому `packages/baser-devbox`, а не по выдуманному пакету:
 * приёмка «инструмент проверки работает» держится ровно на том, что он даёт
 * верный ответ про деталь, которую мы выпускаем сами.
 *
 * Второе утверждение здесь не менее важно первого: «годен» проверяется вместе с
 * ОБЪЁМОМ проверки. Зелёная проба, которая ничего не сверила, хуже
 * отсутствующей — у нас это подтверждалось дважды, — поэтому тест называет,
 * сколько путей, шаблонов и записей прошло через каждый слой, и падает, если
 * слой вдруг стал пустым или пропущенным.
 */

import { describe, expect, it } from 'vitest';

import { checkPackage } from './check.js';
import { DEVBOX_ROOT } from './devbox.fixture.js';

describe('приёмка на живом обвесе девбокса', () => {
  const report = checkPackage(DEVBOX_ROOT);

  it('деталь подходит патрону', () => {
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
      },
      {
        src: 'devcontainer-lock.json',
        dest: '.devcontainer/devcontainer-lock.json',
        render: false,
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
