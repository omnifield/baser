/**
 * ПРИЁМКА `tasker:BASER2-155` — колонка итога говорит человеческим словом.
 *
 * Слой проверки отдаёт машинный статус, и по нему ветвятся снаружи: `baser-pack`
 * считает им сверенные слои, по нему же зеленеет гейт. Менять статус нельзя, это
 * ломающее для соседа (проверено при `tasker:BASER2-130`). А дверь печатала его
 * человеку КАК ЕСТЬ — и в колонке итога `skipped` читался как несделанная работа:
 * слово говорило «пропущено», причина рядом объясняла, что ничего не пропущено.
 *
 * **Проба меряет то, что увидит человек** — рендер, а не поле структуры: разъехаться
 * могли именно они, и проверка поля зеленела бы на любом тексте.
 *
 * Оба конца шва проверяются ОДНИМ прогоном: текст обязан смениться, а машинный
 * ответ обязан остаться прежним до байта. Разнести их по разным пробам значило бы
 * позволить им разъехаться ровно там, где заход их и разделяет.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage } from '@omnifield/baser-check';
import { bundle } from './bundle.js';
import { cli } from './cli.js';
import { renderBundle, renderCheck } from './report.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEVBOX = resolve(here, '../../../baser-devbox');

const boxes: string[] = [];

afterEach(() => {
  while (boxes.length > 0) {
    rmSync(boxes.pop() as string, { force: true, recursive: true });
  }
});

function box(name: string): string {
  const created = mkdtempSync(join(tmpdir(), `baser-${name}-`));
  boxes.push(created);
  return created;
}

/**
 * ЖИВОЙ ОБВЕС, у которого нечего рендерить, — а не сочинённый пакет.
 *
 * Копия девбокса, где каждая запись раскладки объявлена нерендеримой: ровно то
 * состояние, ради которого правилась причина в `tasker:BASER2-130` — обвес,
 * получивший ПОЛНЫЙ ответ слоя, и прогон при этом зелёный. Точечная поломка
 * копии, а не ожидание чужого выпуска: иначе проба зависела бы от того, что
 * сосед положит в свою раскладку завтра.
 */
function nothingToRender(): string {
  const root = join(box('verdict'), 'обвес');
  cpSync(DEVBOX, root, { recursive: true });
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    baser: { layout: { render?: boolean }[] };
  };
  for (const entry of manifest.baser.layout) {
    entry.render = false;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

/** Строка слоя в тексте — та, что человек и читает глазами. */
function lineOf(text: string, stage: string): string {
  const found = text
    .split('\n')
    .find((line) => line.trim().startsWith(`${stage} `));
  if (found === undefined) {
    throw new Error(`строки слоя "${stage}" в тексте нет`);
  }
  return found;
}

describe('зелёный прогон: слово в колонке итога не порождает вопроса', () => {
  it('человек не читает «пропущено» там, где ничего не пропущено', () => {
    const report = checkPackage(nothingToRender());

    // Предмет пробы существует: прогон ЗЕЛЁНЫЙ, и слой при этом пропущен.
    // Без этой пары наблюдения не было бы вовсе — на красном прогоне
    // «пропущено» читается верно.
    expect(report.ok).toBe(true);
    expect(
      report.stages.find((stage) => stage.name === 'templates')?.status,
    ).toBe('skipped');

    const text = renderCheck(report);

    // Машинного токена в тексте нет ни одного — ни в этой строке, ни в соседних.
    expect(text).not.toContain('skipped');
    expect(lineOf(text, 'templates')).toContain('нет предмета');
    // И слово не спорит с причиной, которая стоит на той же строке: причина
    // говорит «это полный ответ слоя», слово — «предмета не было».
    expect(lineOf(text, 'templates')).toContain('мерить нечего');
  });

  it('по проводу едет ПРЕЖНИЙ статус — машинный ответ не изменился ни на байт', async () => {
    const root = nothingToRender();
    const report = checkPackage(root);
    const before = JSON.stringify(report);

    // Рендер человеку — это чтение ответа, а не правка его.
    renderCheck(report);
    expect(JSON.stringify(report)).toBe(before);

    // И то же самое на сквозном прогоне: `--json` отдаёт машинное слово, по
    // которому сосед считает сверенные слои. Проверять это полем структуры
    // мало — наружу уезжает то, что напечатала команда.
    const outcome = await cli(['check', root, '--json'], process.cwd());
    const payload = JSON.parse(outcome.stdout) as {
      stages: { name: string; status: string }[];
    };

    expect(outcome.exitCode).toBe(0);
    expect(
      payload.stages.find((stage) => stage.name === 'templates')?.status,
    ).toBe('skipped');
    // Человеческого слова в машинном ответе нет — шов держится с обеих сторон.
    expect(outcome.stdout).not.toContain('нет предмета');
  });

  it('колонка не разъезжается: прогон с пропуском читается столбцами с прогоном без него', () => {
    const withSkip = renderCheck(checkPackage(nothingToRender()));
    const whole = renderCheck(checkPackage(DEVBOX));

    // Ширина колонки итога постоянная, а не по самому длинному в ЭТОМ прогоне:
    // человеческое слово длиннее машинного, и колонка, считаемая по прогону,
    // сдвигала бы счётчик у каждого прогона без пропуска.
    //
    // Меряется строка, одинаковая в обоих прогонах (`manifest ok 1`): разъедется
    // она ровно тогда, когда ширину начнут считать по содержимому прогона.
    expect(lineOf(withSkip, 'manifest')).toBe(lineOf(whole, 'manifest'));
  });
});

describe('слово верно и там, где пропуск означает «не смогли»', () => {
  it('красный прогон: причина другая, а слово ей не противоречит', () => {
    const root = join(box('broken'), 'обвес');
    cpSync(DEVBOX, root, { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ это не json');

    const report = checkPackage(root);
    const text = renderCheck(report);

    expect(report.ok).toBe(false);
    // Тот же машинный статус — и он по-прежнему прежний.
    expect(
      report.stages.find((stage) => stage.name === 'declaration')?.status,
    ).toBe('skipped');
    expect(text).not.toContain('skipped');
    // «Нет предмета — манифест не прочитан, разбирать нечего»: слово и причина
    // говорят одно. Различие двух смыслов несёт причина, а не статус, — статус
    // их не различает вовсе, и дверь этого не изображает.
    expect(lineOf(text, 'declaration')).toContain('нет предмета');
    expect(lineOf(text, 'declaration')).toContain('манифест не прочитан');
  });

  it('колонка одна на все три механики — сборка печатает то же слово', () => {
    // Починить один вход и оставить открытым соседний это не починка: `check`,
    // `pack` и `bundle` печатают итог шага одной колонкой, и машинный токен
    // уехал бы человеку через две оставшиеся.
    const report = bundle(join(box('empty'), 'пусто'), {
      into: join(box('into'), 'выдача'),
    });
    const text = renderBundle(report);

    expect(report.ok).toBe(false);
    expect(report.stages.some((stage) => stage.status === 'skipped')).toBe(true);
    expect(text).not.toContain('skipped');
    expect(lineOf(text, 'runtime')).toContain('нет предмета');
  });
});
