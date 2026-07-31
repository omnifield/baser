/**
 * ШОВ: РЕЗОЛВ ПОСТАВЛЕННОГО ПАКЕТА ЖИВЁТ В ДВУХ МЕСТАХ.
 *
 * `installed.ts` этой зоны и `resolvePackage` в `packages/baser-contracts/src/lib/locate.ts`
 * отвечают на один и тот же вопрос: «по имени пакета — где он у потребителя и
 * что в его манифесте». Вопросы ВЫШЕ у них разные (у контрактов — личность
 * обвеса для чужого рантайм-кода, у двери — перечень объявленного для
 * раскладки), а этот слой один, и дублирован он целиком, вместе с тонкостями:
 * резолв от корня потребителя, обход вверх до манифеста с ТЕМ ЖЕ именем.
 *
 * ── ПОЧЕМУ ЭТО ПРОБА, А НЕ АБЗАЦ В КОММЕНТАРИИ ──────────────────────────────
 *
 * Правило `kb:BASER2-2` разрешает дубль, если он ГРОМКИЙ: «молчаливый дубль —
 * дефект, названный — шов». У словаря громкость встроена — незнакомое слово
 * даёт названный отказ на первом прогоне. У ПОВЕДЕНИЯ её нет: разъехавшиеся
 * резолвы оба отработают успешно, просто найдут разные пакеты, и дверь разложит
 * артефакты из одного, а хук обвеса прочитает свой эталон из другого. Молча.
 *
 * Поэтому громкость здесь сделана машинной: обе стороны гоняются по одному
 * настоящему дереву и обязаны сойтись на одном пакете. Пока факт не сведён в
 * одно место (заход зоны контрактов — отдать резолв по имени наружу),
 * расхождение краснит эту зону, а не всплывает у потребителя.
 *
 * ── ЧТО БЕРЁТСЯ ПОД ПРОБУ ───────────────────────────────────────────────────
 *
 * Не «одинаковый ли код», а «одинаковый ли ОТВЕТ» — и на тех раскладках, где
 * ответ вообще может разойтись:
 *
 *   · штатная — пакет в `node_modules` потребителя;
 *   · поднятая к родителю (hoisted-workspace) — пакета в дереве нет вовсе;
 *   · пакет, закрывший `./package.json` в `exports`, — обе стороны обязаны уйти
 *     в обход вверх, и это самая тонкая из веток: подниматься до первого
 *     попавшегося манифеста нельзя, у вложенной зависимости он бы тоже нашёлся.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateSource } from '@omnifield/baser-contracts/locate';
import {
  installDevbox,
  DEVBOX_PACKAGE,
  type Consumer,
  type SourceSpec,
} from './devbox.fixture.js';
import { resolveInstalledPackage } from './installed.js';

const DEVBOX_ID = 'omnifield/devbox';
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/**
 * Корень пакета глазами КАЖДОЙ из сторон.
 *
 * Контракты ищут по личности, дверь — по имени пакета: это и есть разные
 * вопросы, под которыми лежит один резолв. Сойтись они обязаны на одном
 * каталоге — иначе один и тот же обвес у одного и того же потребителя
 * оказывается в двух разных местах.
 */
function bothSides(
  repoRoot: string,
  sourceId: string,
  packageName: string,
): { readonly byIdentity: string; readonly byName: string } {
  const located = locateSource(sourceId, { from: repoRoot });
  if (!located.ok) {
    throw new Error(
      `контракты обвес не нашли: ${located.problems.map((p) => p.message).join('; ')}`,
    );
  }

  const installed = resolveInstalledPackage(packageName, repoRoot);
  if (!installed.ok) {
    throw new Error(`дверь пакет не нашла: ${installed.failure.detail}`);
  }

  return {
    byIdentity: located.value.packageRoot,
    byName: installed.value.root,
  };
}

describe('обе стороны находят ОДИН И ТОТ ЖЕ пакет', () => {
  it('штатная раскладка: пакет в node_modules потребителя', () => {
    consumer = installDevbox({ config: CONFIG });

    const { byIdentity, byName } = bothSides(
      consumer.root,
      DEVBOX_ID,
      DEVBOX_PACKAGE,
    );

    expect(byIdentity).toBe(byName);
    // И это настоящий пакет, а не совпадение двух пустот: сверка «ничего с
    // ничем» проходит всегда.
    expect(byIdentity).toBe(consumer.sourceRoot);
  });

  it('поднятая раскладка: пакета в дереве потребителя нет вовсе', () => {
    // Резолв идёт вверх по `node_modules`, и обе стороны обязаны уйти туда же.
    // Сторона, считающая от себя, нашла бы здесь свою копию — а её тут две.
    consumer = installDevbox({ config: CONFIG, hoisted: true });

    const { byIdentity, byName } = bothSides(
      consumer.root,
      DEVBOX_ID,
      DEVBOX_PACKAGE,
    );

    expect(byIdentity).toBe(byName);
    expect(byIdentity).toBe(consumer.sourceRoot);
  });

  it('пакет закрыл ./package.json в exports — обход вверх у обеих сторон', () => {
    const spec: SourceSpec = {
      packageName: '@omnifield/brain-harness',
      id: 'omnifield/agent-harness',
      title: 'Плагин агент-харнесса',
      layout: [{ src: 'policy.md', dest: '.claude/policy.md', render: false }],
      templates: { 'policy.md': '# policy\n' },
    };
    consumer = installDevbox({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: spec.packageName }],
      },
    });
    const installed = consumer.installSource(spec);

    // Закрываем манифест ровно так, как это делает пакет с современным
    // `exports`: `require.resolve('<пакет>/package.json')` перестаёт работать, и
    // обе стороны обязаны уйти в обход вверх от точки входа.
    const manifestPath = join(installed.root, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    manifest['exports'] = { '.': './index.js' };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(installed.root, 'index.js'), 'export default {};\n');

    const { byIdentity, byName } = bothSides(
      consumer.root,
      spec.id,
      spec.packageName,
    );

    expect(byIdentity).toBe(byName);
    expect(byIdentity).toBe(installed.root);
  });

  it('пакет не поставлен — отказывают ОБЕ, а не одна', () => {
    // Согласие нужно и на «нашли», и на «не нашли»: сторона, которая на том же
    // дереве находит то, чего другая не видит, — это и есть разъезд, просто с
    // другого конца.
    const ABSENT = '@omnifield/baser-не-поставлен';
    consumer = installDevbox({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: ABSENT }],
      },
    });

    // Непоставленный сосед поиск не обрывает — искомый может лежать следующим,
    // и порядок записей в чужом конфиге не решает, найдёмся ли мы.
    expect(locateSource(DEVBOX_ID, { from: consumer.root }).ok).toBe(true);
    expect(locateSource('нет/такого', { from: consumer.root }).ok).toBe(false);
    expect(resolveInstalledPackage(ABSENT, consumer.root).ok).toBe(false);
  });
});
