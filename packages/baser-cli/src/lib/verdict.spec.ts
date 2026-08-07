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
 *
 * ── КАК СУДИТСЯ МАШИННЫЙ КОНЕЦ ШВА (`tasker:BASER2-197`) ────────────────────
 *
 * Подстрокой по всему ответу — НЕЛЬЗЯ, и это разобранный дефект, а не вкусовщина.
 * В `--json` уезжает `CheckReport` целиком, а в нём — разобранное объявление
 * обвеса, то есть описания настроек СОСЕДА. Поиск фразы по такому ответу не
 * различал двух разных событий: рендерер протёк в машинный канал (настоящий
 * дефект, ради которого проба и стоит) и в чужих данных встретились те же слова
 * (ложная тревога). Слова у нас ходовые, и сосед написал их первым же заходом.
 *
 * Измерение поэтому не про совпадение строки, а про форму ответа — двумя
 * утверждениями:
 *
 * 1. `stdout` разбирается как ЧИСТЫЙ JSON. Текст рендерера, напечатанный рядом с
 *    ответом, разбор роняет — и ловится он этим, а не знанием, что именно
 *    напечатали. Такую пробу не сломает ничей текст: ни соседа, ни наш завтрашний.
 * 2. В полях, которые печатает рендерер, стоят МАШИННЫЕ токены, а не слова из его
 *    словаря (`HUMAN_VERDICT` — он же и берётся, а не его копия в тексте пробы).
 *
 * Оба утверждения доказаны мутацией — ниже отдельной пробой: судья, которого не
 * покраснить подложной протечкой, это снятая проверка с видом починки.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage, type CheckReport } from '@omnifield/baser-check';
import { bundle } from './bundle.js';
import { cli } from './cli.js';
import { HUMAN_VERDICT, renderBundle, renderCheck } from './report.js';

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

/** Манифест копии — ровно те два блока объявления, которые правят пробы. */
interface DevboxManifest {
  readonly baser: {
    readonly layout: { render?: boolean }[];
    readonly settings: Record<string, { description?: string }>;
  };
}

/** Копия живого обвеса с точечной правкой его объявления. */
function copyOfDevbox(
  name: string,
  patch: (manifest: DevboxManifest) => void,
): string {
  const root = join(box(name), 'обвес');
  cpSync(DEVBOX, root, { recursive: true });
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf-8'),
  ) as DevboxManifest;
  patch(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

/** Каждая запись раскладки объявлена нерендеримой — слою нечего мерить. */
function nothingRenderable(manifest: DevboxManifest): void {
  for (const entry of manifest.baser.layout) {
    entry.render = false;
  }
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
  return copyOfDevbox('verdict', nothingRenderable);
}

/**
 * ТОТ ЖЕ ОБВЕС, НО СОСЕД НАМЕРЕННО ГОВОРИТ НАШИМИ СЛОВАМИ.
 *
 * Не выдумка: `tasker:BASER2-196` — owner-devbox писал описание своей настройки и
 * употребил наш же словарь (`tasker:BASER2-188` называется «шаг без предмета не
 * существует, а не падает»). Слова ходовые, следующий напишет их снова, и
 * покраснеет у него проба ЧУЖОЙ зоны, в которую ему нельзя.
 *
 * Фраза ставится ВО ВСЕ описания, а не в одно выбранное: в какой именно настройке
 * сосед её напишет — не наше дело, и проба, угадывающая эту настройку, назавтра
 * снова мерила бы не то. Берётся она из словаря рендерера, а не копией: заведём
 * второе человеческое слово — фикстура поедет за ним сама.
 */
function speakingOurWords(): string {
  return copyOfDevbox('echo', (manifest) => {
    nothingRenderable(manifest);
    for (const spec of Object.values(manifest.baser.settings)) {
      spec.description = `${spec.description ?? ''} ${
        HUMAN_VERDICT['skipped']
      } — это нормальное состояние шага, а не отказ (tasker:BASER2-188).`.trim();
    }
  });
}

/**
 * СУДЬЯ МАШИННОГО КАНАЛА: ответ судится как ОТВЕТ, а не как текст.
 *
 * Возвращает разобранную нагрузку — чтобы проба, которой нужно ещё и содержимое,
 * не разбирала её вторым разбором рядом с первым.
 */
function machineAnswer(stdout: string): CheckReport {
  let payload: CheckReport;
  try {
    payload = JSON.parse(stdout) as CheckReport;
  } catch {
    // Разбор упал — значит рядом с ответом что-то напечатано. Что именно, судья
    // не спрашивает: протечка рендерера ловится ФОРМОЙ ответа, и любой текст
    // рядом с JSON это она.
    throw new Error(
      `машинный ответ не разобрался — рядом с JSON напечатан текст:\n${stdout}`,
    );
  }

  // Слово рендерера в поле, по которому ветвятся снаружи: `baser-pack` считает
  // статусом сверенные слои, по нему же зеленеет гейт.
  for (const stage of payload.stages) {
    expect(Object.values(HUMAN_VERDICT)).not.toContain(stage.status);
  }

  return payload;
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
    //
    // Судит `machineAnswer`: ответ разобрался как чистый JSON (текст рендерера
    // рядом уронил бы разбор) и слова рендерера в статусах нет. Подстрокой по
    // всему ответу это не мерится — там едут описания настроек соседа.
    const outcome = await cli(['check', root, '--json'], process.cwd());
    const payload = machineAnswer(outcome.stdout);

    expect(outcome.exitCode).toBe(0);
    expect(
      payload.stages.find((stage) => stage.name === 'templates')?.status,
    ).toBe('skipped');
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

/**
 * ЧТО ИМЕННО СТЕРЕЖЁТ ПРОБА ШВА (`tasker:BASER2-197`).
 *
 * Две пробы одна против другой: первая говорит, что чужой текст в нагрузке
 * тревоги не поднимает, вторая — что настоящая протечка её поднимает. Порознь
 * любая из них лжёт: без первой измерение краснеет на словах соседа, без второй
 * «починкой» сошло бы снятие проверки.
 */
describe('проба стережёт шов, а не совпадение слов', () => {
  it('слова рендерера в ДАННЫХ соседа — не протечка: прогон зелёный', async () => {
    const root = speakingOurWords();
    const outcome = await cli(['check', root, '--json'], process.cwd());

    // Ложная тревога воспроизведена: слово в ответе ЕСТЬ — уехало описанием
    // настройки внутри разобранного объявления. Прежнее измерение (подстрока по
    // всему ответу) краснело ровно здесь, и краснело на чужом тексте.
    expect(outcome.stdout).toContain(HUMAN_VERDICT['skipped']);
    expect(
      JSON.stringify(
        (JSON.parse(outcome.stdout) as CheckReport).declaration?.settings,
      ),
    ).toContain(HUMAN_VERDICT['skipped']);

    // А шов при этом цел, и проба это видит.
    const payload = machineAnswer(outcome.stdout);
    expect(outcome.exitCode).toBe(0);
    expect(
      payload.stages.find((stage) => stage.name === 'templates')?.status,
    ).toBe('skipped');
  });

  it('мутация: рендерер протёк в машинный ответ — проба краснеет', async () => {
    const root = nothingToRender();
    const outcome = await cli(['check', root, '--json'], process.cwd());

    // Живой ответ судья пропускает — иначе краснело бы что угодно.
    expect(() => machineAnswer(outcome.stdout)).not.toThrow();

    // Протечка первая: текст рендерера напечатан РЯДОМ с ответом — ровно то, что
    // случится, если `--json` начнёт печатать заголовок или итоговую строку.
    expect(() =>
      machineAnswer(`${renderCheck(checkPackage(root))}\n${outcome.stdout}`),
    ).toThrow();

    // Протечка вторая: человеческое слово подставлено В ПОЛЕ ответа — то есть
    // дверь отдала наружу то, что печатала человеку.
    const leaked = JSON.parse(outcome.stdout) as {
      stages: { name: string; status: string }[];
    };
    for (const stage of leaked.stages) {
      if (stage.status === 'skipped') {
        stage.status = HUMAN_VERDICT['skipped'];
      }
    }
    expect(() => machineAnswer(JSON.stringify(leaked, null, 2))).toThrow();
  });
});
