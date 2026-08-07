import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { READINESS, SKIPPED, STATE_SUFFIX, sweep } from './verify.mjs';

const SCRIPT = fileURLToPath(new URL('./verify.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Настоящий `tsc` монорепы — проба судит инструментом, а не рассуждением. */
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

/** @type {string} */
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** @param {string} where @param {string} what */
function file(where, what) {
  const path = join(dir, where);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, what);
  return path;
}

describe('прогретое состояние прячет ошибку — снос её возвращает', () => {
  // Живой случай, из которого выросла `tasker:BASER2-219`: раскладке добавили
  // обязательное поле (`tasker:BASER2-213`, коммит `b12b05b`), пробы соседнего
  // пакета его не назвали, и `@omnifield/baser-pack:typecheck` покраснел в CI
  // с `TS2741` — оставшись зелёным у четырёх сессий подряд. Здесь та же фигура
  // в одном проекте: одна ошибка, один `tsc --build`, и вся разница — в том,
  // лежит ли рядом файл памяти.

  const CONFIG = JSON.stringify({
    compilerOptions: {
      composite: true,
      strict: true,
      module: 'nodenext',
      moduleResolution: 'nodenext',
      target: 'es2022',
      outDir: 'dist',
      tsBuildInfoFile: `dist/tsconfig${STATE_SUFFIX}`,
    },
    include: ['src/**/*.ts'],
  });

  const GREEN = [
    'export type Shape = { a: string };',
    "export const shape: Shape = { a: 'ok' };",
  ].join('\n');

  /** То же самое, но полю `b` неоткуда взяться — это и есть `TS2741`. */
  const RED = [
    'export type Shape = { a: string; b: number };',
    "export const shape: Shape = { a: 'ok' };",
  ].join('\n');

  const state = () => join(dir, 'dist', `tsconfig${STATE_SUFFIX}`);

  const build = () =>
    spawnSync(TSC, ['--build', 'tsconfig.json'], {
      cwd: dir,
      encoding: 'utf8',
    });

  /**
   * Ломает исходник ЗАДНИМ ЧИСЛОМ. Правка человека приходит с новым временем, и
   * тогда `tsc` её видит; прогретое дерево ловит другой случай — когда сделанное
   * записано в память, а работа с тех пор не переделывалась. Здесь это выражено
   * прямо, чтобы проба судила память, а не расторопность файловой системы.
   */
  const breakSource = () => {
    const source = file('src/index.ts', RED);
    const backdated = new Date('2020-01-01T00:00:00Z');
    utimesSync(source, backdated, backdated);
  };

  // ПОРОГ ПОСТАВЛЕН ОТ ЗАМЕРА НА МЕДЛЕННОЙ МАШИНЕ, А НЕ НА СВОЕЙ.
  //
  // Проба дорогая ПО ПОСТРОЕНИЮ: она четыре раза зовёт настоящий `tsc` монорепы
  // — собрать зелёное, показать ложный зелёный на прогретой памяти, показать
  // красное после сноса и снова спрятать его вернувшейся памятью. Подставным
  // компилятором это не доказывается: судим мы как раз поведение настоящего.
  //
  // Замер (`tasker:BASER2-230`, 2026-08-07): локально 1985 мс, в CI на
  // `ubuntu-latest` — 9959 мс. Раннер впятеро медленнее, и дефолтные 5000 мс
  // vitest (выбранные для проб над чистыми функциями) режут её ТАМ, оставаясь
  // зелёными ЗДЕСЬ. 30 000 мс — троекратно к замеру CI, то есть запас больше
  // разброса нагрузки на общем раннере.
  //
  // Порог стоит на ЭТОЙ пробе, а не в конфиге зоны: следующая по цене проба
  // рядом — 132 мс, и общий лимит спрятал бы её зависание вместо того, чтобы
  // назвать. Уменьшать обратно, глядя на локальные секунды, нельзя — локально
  // она зелёная при любом пороге, и это ровно та расходимость машин, ради
  // которой лимит и назначен.
  it(
    'память tsc делает красное дерево зелёным, а снос памяти — обратно',
    { timeout: 30_000 },
    () => {
      file('tsconfig.json', CONFIG);
      file('src/index.ts', GREEN);

      expect(build().status, 'зелёное дерево обязано собираться').toBe(0);
      expect(existsSync(state()), 'память tsc обязана появиться').toBe(true);

      breakSource();

      // 1. Вот он, ложный зелёный — ровно то, что видели четыре сессии.
      const hidden = build();
      expect(hidden.status).toBe(0);
      expect(`${hidden.stdout}${hidden.stderr}`).not.toContain('TS2741');

      // Память откладываем: ниже проверим, что вернувшись, она снова спрячет.
      const kept = join(dir, 'kept');
      copyFileSync(state(), kept);

      // 2. Снос — и ошибка на месте, тем же кодом, что покрасил CI.
      expect(sweep(dir)).toEqual([`dist/tsconfig${STATE_SUFFIX}`]);
      const caught = build();
      expect(caught.status).not.toBe(0);
      expect(`${caught.stdout}${caught.stderr}`).toContain('TS2741');

      // 3. МУТАЦИЯ: вернули состояние — ошибка спряталась снова. Значит красное
      //    выше держит снос, а не дисциплина: перестанет сносить — проба упадёт.
      copyFileSync(kept, state());
      expect(build().status).toBe(0);
    },
  );
});

describe('снос заходит только туда, где состояние наше', () => {
  it('снимает состояние из дерева и не трогает чужое', () => {
    const ours = file(`packages/p/dist/tsconfig.lib${STATE_SUFFIX}`, 'наше');
    const theirs = file(`node_modules/dep/dist/x${STATE_SUFFIX}`, 'чужое');
    const engine = file(`.nx/cache/17/p/dist/x${STATE_SUFFIX}`, 'кэш движка');
    const git = file(`.git/x${STATE_SUFFIX}`, 'не наше вовсе');
    const other = file('packages/p/dist/index.d.ts', 'не состояние');

    expect(sweep(dir)).toEqual([`packages/p/dist/tsconfig.lib${STATE_SUFFIX}`]);

    expect(existsSync(ours)).toBe(false);
    for (const kept of [theirs, engine, git, other]) {
      expect(existsSync(kept), kept).toBe(true);
    }
  });

  it('по симлинку в обход границы не приходит', () => {
    // pnpm связывает пакеты монорепы внутрь `node_modules`, и обход по ссылкам
    // пришёл бы в пропущенное вторым путём — то есть граница бы не держала.
    const hidden = file(`node_modules/dep/x${STATE_SUFFIX}`, 'чужое');
    symlinkSync(join(dir, 'node_modules'), join(dir, 'link'), 'dir');

    expect(sweep(dir)).toEqual([]);
    expect(existsSync(hidden)).toBe(true);
  });

  it('границы названы списком, а не разбросаны по обходу', () => {
    expect([...SKIPPED].sort()).toEqual(['.git', '.nx', 'node_modules']);
  });
});

describe('набор целей готовности — тот же самый', () => {
  it('команда остаётся одна на вахтёра, приёмку и выпуск', () => {
    // `tasker:BASER2-191`: вердикт «готово» обязан значить одно и то же везде.
    // Правка этой строки — правка обещания, а не рефакторинг.
    expect(READINESS.join(' ')).toBe(
      'run-many -t test typecheck build --skip-nx-cache',
    );
  });
});

describe('вахтёр отдаёт вердикт nx, а не свой', () => {
  /**
   * Подставной `nx`: записывает, ЧТО он застал в дереве и с чем его позвали, и
   * выходит заказанным кодом. Настоящий здесь не нужен — судим обвязку.
   */
  function fakeNx() {
    const stale = `packages/p/dist/tsconfig.lib${STATE_SUFFIX}`;
    file(stale, 'память с прошлого прогона');

    const bin = file(
      'node_modules/.bin/nx',
      [
        '#!/usr/bin/env node',
        "const { existsSync, writeFileSync } = require('node:fs');",
        "writeFileSync('seen.json', JSON.stringify({",
        `  stale: existsSync(${JSON.stringify(stale)}),`,
        '  args: process.argv.slice(2),',
        '  cwd: process.cwd(),',
        '}));',
        'process.exit(Number(process.env.FAKE_NX_CODE ?? 0));',
      ].join('\n'),
    );
    chmodSync(bin, 0o755);
  }

  const run = (code) =>
    spawnSync(process.execPath, [SCRIPT, '--root', dir], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_NX_CODE: String(code) },
    });

  const seen = () => JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8'));

  it('красное от nx остаётся красным', () => {
    fakeNx();

    expect(run(0).status).toBe(0);
    // Проглоченный код выхода — тот же ложный зелёный, только уже свой.
    expect(run(7).status).toBe(7);
    expect(run(130).status).toBe(130);
  });

  it('состояние снято ДО прогона, а не после него', () => {
    fakeNx();
    run(0);

    // Порядок здесь несущий: снос после прогона проверял бы ровно то же
    // прогретое дерево и чинил бы только следующий раз.
    expect(seen().stale).toBe(false);
  });

  it('целями и каталогом прогон — тот же, что был', () => {
    fakeNx();
    run(0);

    expect(seen().args).toEqual(READINESS);
    expect(seen().cwd).toBe(dir);
  });

  it('аргументы прогона доходят до nx', () => {
    fakeNx();

    spawnSync(process.execPath, [SCRIPT, '--root', dir, '--verbose'], {
      encoding: 'utf8',
    });

    expect(seen().args).toEqual([...READINESS, '--verbose']);
  });

  it('без поставленных зависимостей — отказ, а не тишина', () => {
    // Ложное зелёное «проверять нечем, значит всё хорошо» стоит ровно столько
    // же, сколько то, которое эта команда и чинит.
    const failed = spawnSync(process.execPath, [SCRIPT, '--root', dir], {
      encoding: 'utf8',
    });

    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('зависимости не поставлены');
  });

  it('прогон оставляет след: сколько снято и сколько заняло', () => {
    fakeNx();
    const done = run(0);

    expect(done.stderr).toContain('снято инкрементальное состояние tsc — 1');
    expect(done.stderr).toContain('код выхода 0');
  });
});
