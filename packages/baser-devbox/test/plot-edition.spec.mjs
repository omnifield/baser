/**
 * ЛОКАЦИЯ ЗНАЕТ, НА КАКОМ ОБРАЗЕ СТОИТ: ФИКСАЦИЯ РЕДАКЦИИ УЧАСТКА.
 *
 * `tasker:BASER2-290`, требование мира — `kb:WORLD-50`: у участка есть СВОЯ редакция
 * — «из чего он поднят», — отдельно от перечня стоящего на нём. Вторая половина того
 * же нарушения; первую (инструменты машины) закрыл `-292`.
 *
 * ── ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ, А ЧТО ДОКАЗАТЬ НЕЛЬЗЯ ──────────────────────────
 *
 * «В артефакте есть шаг фиксации» — утверждение про текст, и оно ничего не стоит.
 * Поэтому пробы ИСПОЛНЯЮТ шаг из артефакта настоящим `sh` и читают файл, который
 * после этого лежит.
 *
 * Главная проба — **«запись не повторяет объявление»**: маркер образа говорит одно,
 * объявленный тег — другое, и запись обязана пойти за маркером. Без неё «фиксация
 * работает» доказывалось бы совпадением: у нашего собственного репозитория тег `22`,
 * а вариант образа `22-trixie` — подстрока, и подмена факта объявлением прошла бы
 * незамеченной. Ровно эту ловушку приёмка задачи и называет.
 *
 * ── ПОЧЕМУ АДРЕС МАРКЕРА ПОДМЕНЯЕТСЯ, И ПОЧЕМУ ЭТО НЕ КОПИЯ ЦЕПОЧКИ ────────
 *
 * Маркер лежит по абсолютному адресу МАШИНЫ (`/usr/local/etc/vscode-dev-containers/
 * meta.env`), и другого у него быть не может: его кладёт образ. Проба, читающая
 * настоящий файл, мерила бы машину прогона — зелёная в этом девбоксе, никакая в
 * конвейере, где такого файла нет вовсе.
 *
 * Поэтому адрес маркера — АРГУМЕНТ шага (`node -e '…' <объявлено> <маркер> <файл>`),
 * и проба меняет ровно его. Тело программы при этом остаётся байт в байт тем, что
 * лежит в артефакте, — подменяется вход, а не предмет. Чтобы подмена не могла
 * спрятать неверный адрес, рядом стоит проба, требующая в артефакте настоящий.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerEnv } from './env.mjs';
import {
  chainStep,
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  stepRun,
  steps,
  tuning,
} from './packed.mjs';

/** Адрес маркера редакции у семейства Dev Containers — тот, что обязан быть в артефакте. */
const MARKER = '/usr/local/etc/vscode-dev-containers/meta.env';

/** Имя файла записи — ОДНО место, где оно записано в пробах. */
const RECORD = '.devbox-plot-edition.json';

const IMAGE = 'mcr.microsoft.com/devcontainers/typescript-node';
/** Настоящий дайджест: тег `22` этого семейства указывал на него 2026-08-10. */
const DIGEST =
  'sha256:4f634c449931ac2aff140f9fac5825413196e631ccc0eb7afd17033144253be4';

/** Маркер настоящей формы: шелловые пары, значения в апострофах, лишнее внутри. */
function markerText({ version, definition = 'typescript-node', variant = '22-trixie' }) {
  return [
    `VERSION='${version}'`,
    `CONTENTS_URL='https://github.com/devcontainers/images/tree/main/src/typescript-node/history/${version}.md'`,
    `DEFINITION_ID='${definition}'`,
    `VARIANT='${variant}'`,
    "GIT_REPOSITORY='https://github.com/devcontainers/images'",
    "BUILD_TIMESTAMP='Thu, 30 Jul 2026 17:44:47 GMT'",
  ].join('\n');
}

let consumer = null;
let boxes = [];

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
  for (const path of boxes) rmSync(path, { force: true, recursive: true });
  boxes = [];
});

function box(prefix) {
  const path = mkdtempSync(join(tmpdir(), `baser-devbox-${prefix}-`));
  boxes.push(path);
  return path;
}

async function materialize({ presets = [], settings } = {}) {
  consumer = installConsumer({
    repoName: 'weber',
    config: consumerConfig(),
    tuning: tuning({ presets, settings }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  const text = consumer.read(LIVE);
  return { result, text, json: text === null ? null : parseJsonc(text) };
}

/** Отказ прогона: код формы, текст обвеса и пустой диск. */
function refusal({ result, text }, code = 'render-failed') {
  expect(text, 'артефакт лёг, хотя отказ обязан был остановить прогон').toBe(
    null,
  );
  expect(result.problems.map((problem) => problem.code)).toContain(code);
  return result.problems.map((problem) => problem.message).join('\n');
}

function sh(script, named) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', script], {
      cwd: consumer.root,
      env: containerEnv(named),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/**
 * Тот же шаг, но смотрящий на НАШ маркер: подменяется ровно адрес, и только он.
 *
 * Единственность вхождения проверяется здесь же: появись адрес в команде дважды,
 * подмена сделала бы половину работы, а проба продолжила бы зеленеть.
 */
function markerAt(command, path) {
  const found = command.split(MARKER).length - 1;
  if (found !== 1) {
    throw new Error(
      `адрес маркера встречается в шаге ${found} раз(а), подменять нечего или нечем:\n${command}`,
    );
  }
  return command.replace(MARKER, path);
}

/**
 * ПОДЪЁМ ЛОКАЦИИ, изображённый шагом из артефакта: маркер такой, какой сказали.
 *
 * `marker: null` — маркера в машине нет вовсе (чужое семейство образов): адрес
 * остаётся, файла по нему не существует.
 */
async function bootstrap(artifact, { marker, home = box('home') } = {}) {
  const path =
    marker === null
      ? join(box('image-nowhere'), 'meta.env')
      : join(box('image-meta'), 'meta.env');
  if (marker !== null) {
    writeFileSync(path, marker);
  }

  const result = await sh(
    markerAt(stepRun(artifact.onCreateCommand, 'plot'), path),
    { HOME: home },
  );
  const record = join(home, RECORD);
  return {
    result,
    home,
    path: record,
    plot: existsSync(record)
      ? JSON.parse(readFileSync(record, 'utf-8')).plotEdition
      : null,
  };
}

describe('фиксация редакции участка — ПЕРВОЕ звено цепочки', () => {
  it('шаг стоит ПЕРВЫМ: отказ дальше по цепочке разбирают по вопросу «а на каком образе»', async () => {
    const { json } = await materialize({ presets: ['omnifield'] });

    expect(steps(json.onCreateCommand).map((step) => step.id)).toEqual([
      'plot',
      'corepack',
      'tools',
      'editions',
    ]);
  });

  it('шаг есть даже у локации без единого инструмента: участок есть всегда', async () => {
    // Редакция участка не зависит от того, что на участке стоит. Пустой перечень
    // инструментов убирает свои два шага и не трогает этот.
    const { json } = await materialize();

    expect(steps(json.onCreateCommand).map((step) => step.id)).toEqual([
      'plot',
      'corepack',
    ]);
  });

  it('адрес маркера в артефакте НАСТОЯЩИЙ — тот, по которому его кладёт образ', async () => {
    // Второй конец подмены адреса в пробах ниже: подменять можно только то, что
    // в артефакте верно. Иначе пробы зеленели бы на собственном адресе.
    const { json } = await materialize();

    expect(stepRun(json.onCreateCommand, 'plot')).toContain(MARKER);
  });
});

describe('ЗАМОРОЗКА ОБРАЗА — это дайджест, и только он', () => {
  it('объявлен ДАЙДЖЕСТ — ссылка через «собаку», и шага фиксации нет вовсе', async () => {
    const { json } = await materialize({ settings: { imageTag: DIGEST } });

    expect(json.image).toBe(`${IMAGE}@${DIGEST}`);
    // Объявление само себе доказательство — работы мир не просит.
    expect(steps(json.onCreateCommand).map((step) => step.id)).toEqual([
      'corepack',
    ]);
    expect(json.onCreateCommand).not.toContain(RECORD);
    // И читателю артефакта сказано, почему шага нет.
    expect(consumer.read(LIVE)).toContain('Образ закреплён ДАЙДЖЕСТОМ');
  });

  it('ПОЛНЫЙ НОМЕР В ТЕГЕ заморозкой не является: тег это указатель', async () => {
    // Ловушка того же класса, что `1.2` у инструментов, только злее: тег выглядит
    // закреплением, а перенаправить его вправе семейство образа. Значит фиксация
    // нужна и здесь.
    const { json } = await materialize({
      settings: { imageTag: '5.0.3-22-trixie' },
    });

    expect(json.image).toBe(`${IMAGE}:5.0.3-22-trixie`);
    expect(steps(json.onCreateCommand).map((step) => step.id)).toContain('plot');
  });

  it('ОБРЕЗАННЫЙ ДАЙДЖЕСТ — названный отказ, а не ссылка, которую отвергнет докер', async () => {
    const attempt = await materialize({
      settings: { imageTag: 'sha256:4f634c44' },
    });

    const said = refusal(attempt);
    expect(said).toContain('imageTag');
    expect(said).toContain('64');
  });

  it('ССЫЛКА С ЧУЖИМИ СИМВОЛАМИ — отказ: она едет в команду шага', async () => {
    // То же правило, что у имени сети: значению, которое окажется в команде,
    // обвес обязан доверять. Апостроф здесь не «некрасивое имя», а выход из
    // кавычек в шелле контейнера.
    const attempt = await materialize({
      settings: { image: "mcr.microsoft.com/dev'containers/typescript-node" },
    });

    expect(refusal(attempt)).toContain('ссылкой на образ');
  });
});

describe('ЗАПИСЬ ПО ФАКТУ: на каком образе стоим, а не на каком объявлено', () => {
  it('после подъёма редакция участка читается ИЗ ФАЙЛА', async () => {
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { result, plot } = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });

    expect(result.code, `${result.out}\n${result.err}`).toBe(0);
    expect(plot).toEqual({
      declared: `${IMAGE}:22`,
      state: 'marked',
      release: '5.0.3',
      definition: 'typescript-node',
      variant: '22-trixie',
    });
  });

  it('ЗАПИСЬ НЕ ПОВТОРЯЕТ ОБЪЯВЛЕНИЕ: маркер говорит своё — запись идёт за ним', async () => {
    // Главная проба задачи. Объявлен тег `22`, а в машине стоит образ, который про
    // «22» не говорит ничего: разойтись обязано ВСЁ, кроме объявления. Подмени
    // фиксация факт объявлением — здесь и покраснеет.
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { plot } = await bootstrap(json, {
      marker: markerText({
        version: '9.9.9',
        definition: 'javascript-node',
        variant: '18-bookworm',
      }),
    });

    expect(plot.release).toBe('9.9.9');
    expect(plot.definition).toBe('javascript-node');
    expect(plot.variant).toBe('18-bookworm');
    // Объявленное при этом на месте: фиксация это запись факта, а НЕ подмена
    // объявления. Владелец объявил тег — он и остаётся объявленным.
    expect(plot.declared).toBe(`${IMAGE}:22`);
  });

  it('ОБРАЗ ПОЕХАЛ: то же объявление, другой выпуск — запись идёт следом', async () => {
    // Ровно тот день, ради которого фиксация и заводится: `imageTag` не менялся, а
    // семейство пересобрало образ. Наш живой долг выглядит именно так.
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const first = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });
    const second = await bootstrap(json, {
      marker: markerText({ version: '5.1.0' }),
    });

    expect(first.plot.declared).toBe(second.plot.declared);
    expect(first.plot.release).toBe('5.0.3');
    expect(second.plot.release).toBe('5.1.0');
  });

  it('ДВА ПОДЪЁМА БЕЗ ДВИЖЕНИЯ дают одинаковые записи — сравнивать можно побайтово', async () => {
    // Вторая половина сравнимости, и она про ШУМ: отметка сборки образа в маркере
    // есть, и попади она в запись, две записи об одном и том же образе всё равно
    // остались бы равны — а вот отметка ВРЕМЕНИ ЗАПИСИ развела бы их. Проба держит
    // границу: в записи нет ничего, что меняется само.
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const first = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });
    const second = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });

    expect(readFileSync(second.path, 'utf-8')).toBe(
      readFileSync(first.path, 'utf-8'),
    );
  });

  it('ДАЙДЖЕСТА В ЗАПИСИ НЕТ: изнутри он не виден, а догадок мы не пишем', async () => {
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { plot, path } = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });

    // Ни ключа, ни пустого места под него: чего не измерили, того в записи нет
    // вовсе. Иначе она обещала бы ответ, которого у неё не будет никогда.
    expect(Object.keys(plot)).toEqual([
      'declared',
      'state',
      'release',
      'definition',
      'variant',
    ]);
    expect(readFileSync(path, 'utf-8')).not.toContain('sha256');
  });

  it('ЗАПИСЬ ЖИВЁТ ТАМ, ГДЕ ЖИВЁТ ОБРАЗ, — в доме машины, не в репозитории', async () => {
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { home } = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });

    expect(existsSync(join(home, RECORD))).toBe(true);
    // И ни строки в дереве потребителя: `.devcontainer/` принадлежит двери, а вне
    // его это был бы вечно грязный файл в ЧУЖОМ репозитории.
    expect(consumer.exists(RECORD)).toBe(false);
    expect(consumer.exists(join('.devcontainer', RECORD))).toBe(false);
  });

  it('ЗАПИСЬ ОБ УЧАСТКЕ ОТДЕЛЬНА от записи об инструментах: разные ярусы', async () => {
    // Сложи их в один файл — и получится та же куча, от которой мир ушёл в
    // объявлении, только теперь в записи о факте.
    const { json } = await materialize({ presets: ['omnifield'] });

    expect(stepRun(json.onCreateCommand, 'plot')).toContain(RECORD);
    expect(stepRun(json.onCreateCommand, 'plot')).not.toContain(
      '.devbox-editions.json',
    );
    expect(stepRun(json.onCreateCommand, 'editions')).not.toContain(RECORD);
  });
});

describe('НЕИЗМЕРИМОЕ НАЗВАНО СОСТОЯНИЕМ, а не изображено пустотой', () => {
  it('МАРКЕРА НЕТ — состояние названо, подъём идёт дальше', async () => {
    // Чужое семейство образов маркера не кладёт, и это законная раскладка, а не
    // поломка: отказ здесь ронял бы подъём за то, что человек взял не наш образ.
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { result, plot } = await bootstrap(json, { marker: null });

    expect(result.code, `${result.out}\n${result.err}`).toBe(0);
    expect(plot).toEqual({ declared: `${IMAGE}:22`, state: 'unmarked' });
  });

  it('МАРКЕР ЕСТЬ, А ВЫПУСКА В НЁМ НЕТ — то же состояние, а не половина записи', async () => {
    // Файл по адресу лежит, но про редакцию не говорит. Записать «marked» без
    // выпуска значило бы объявить знание, которого нет.
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { plot } = await bootstrap(json, {
      marker: "DEFINITION_ID='typescript-node'\nVARIANT='22-trixie'",
    });

    expect(plot).toEqual({ declared: `${IMAGE}:22`, state: 'unmarked' });
  });

  it('состояние — ЗНАЧЕНИЕ, а не пустая строка и не null', async () => {
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { path } = await bootstrap(json, { marker: null });

    // Читается это глазами человека, поэтому проверяется текстом файла: `null` и
    // пустая строка в записи о факте — это «не знаю», сказанное так, чтобы никто
    // не заметил.
    const text = readFileSync(path, 'utf-8');
    expect(text).toContain('"state": "unmarked"');
    expect(text).not.toContain('null');
    expect(text).not.toContain('""');
  });
});

describe('фиксация участка — звено ЦЕПОЧКИ, и ведёт себя как звено', () => {
  it('её отказ НАЗЫВАЕТ ШАГ — она не механика сбоку, о поломке которой молчат', async () => {
    // Шаг гоняется В ОБЁРТКЕ (`tasker:BASER2-291`). Уронить его можно ровно одним
    // способом: записывать некуда — дома машины не существует. Маркер при этом
    // настоящий, то есть падает именно запись, а не чтение.
    const { json } = await materialize({ presets: ['omnifield'] });
    const home = join(box('home-gone'), 'нет-такого-дома');
    const marker = join(box('image-meta'), 'meta.env');
    writeFileSync(marker, markerText({ version: '5.0.3' }));

    const result = await sh(
      markerAt(chainStep(json.onCreateCommand, 'plot'), marker),
      { HOME: home },
    );

    expect(result.code).not.toBe(0);
    expect(result.err).toContain(
      'ОТКАЗ на шаге 1/4 plot — фиксация редакции участка',
    );
    expect(existsSync(join(home, RECORD))).toBe(false);
  });

  it('ПРОЙДЕННАЯ фиксация молчит: шаг, печатающий в норме, приучают не читать', async () => {
    const { json } = await materialize({ settings: { imageTag: '22' } });

    const { result } = await bootstrap(json, {
      marker: markerText({ version: '5.0.3' }),
    });

    expect(result.code).toBe(0);
    expect(result.out).toBe('');
    expect(result.err).toBe('');
  });
});
