/**
 * ДВЕРЬ: что она читает, что кладёт и на чём отказывает.
 *
 * Две вещи проверяются здесь жёстче остального, потому что на них держится
 * доверие к команде целиком:
 *
 * **`plan` не пишет НИЧЕГО.** Не «почти ничего» и не «только свой конфиг»: две
 * фазы разнесены ради того, чтобы план можно было прочитать, не рискуя деревом.
 *
 * **Отказ говорит чужим кодом, когда код есть.** Дверь не заводит своей
 * семантики поверх формы и движка (`tasker:BASER2-20`): опечатка в настройке —
 * это `unknown-setting` контрактов, а не выдуманный код двери. Свои коды только
 * там, где сказать больше некому.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FORM_VERSION } from '@omnifield/baser-contracts';
import {
  installDevbox,
  DEVBOX_PACKAGE,
  type Consumer,
  type InstallOptions,
} from './devbox.fixture.js';
import { cli } from './cli.js';
import { run } from './run.js';
import { renderText } from './report.js';

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

function install(options: InstallOptions = {}): Consumer {
  consumer = installDevbox(options);
  return consumer;
}

const CONFIG = {
  formVersion: 1,
  sources: [{ use: DEVBOX_PACKAGE, presets: ['omnifield'] }],
};

/** Все файлы репозитория вне `node_modules` — снимок для сверки «до/после». */
function snapshot(box: Consumer): string[] {
  const files: string[] = [];
  const walk = (relative: string): void => {
    for (const child of readdirSync(join(box.root, relative), {
      withFileTypes: true,
    })) {
      if (child.name === 'node_modules') continue;
      const path = relative === '' ? child.name : `${relative}/${child.name}`;
      if (child.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('');
  return files.sort();
}

describe('конфиг потребителя рождается один раз и дальше пользовательский', () => {
  it('plan НАЗЫВАЕТ создание конфига, но не создаёт его', async () => {
    const box = install();
    const before = snapshot(box);

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.config.existed).toBe(false);
    expect(result.config.creates).toBe(true);
    expect(result.config.formVersion).toBe(FORM_VERSION);
    // Названо — и только. Дерево не тронуто ни на байт.
    expect(snapshot(box)).toEqual(before);
    expect(box.exists('baser.json')).toBe(false);
  });

  it('СХОДИМОСТЬ мерится прогоном целиком, а не одним планом движка', async () => {
    // Артефакты уже на месте, но конфиг снесли: движку делать нечего, а прогону
    // есть. Гейт, спросивший «сошлось?», не имеет права зазеленеть здесь.
    const box = install();
    await run({ command: 'apply', cwd: box.root });
    box.remove('baser.json');

    const plan = await run({ command: 'plan', cwd: box.root });

    expect(plan.plan?.status).toBe('converged');
    expect(plan.status).toBe('pending');
    expect(plan.config.creates).toBe(true);
    // И `plan` по-прежнему не пишет: список записей у него пуст по построению.
    expect(plan.writes).toEqual([]);
    expect(box.exists('baser.json')).toBe(false);

    const applied = await run({ command: 'apply', cwd: box.root });
    expect(applied.status).toBe('applied');
    expect(applied.writes).toEqual([{ path: 'baser.json', kind: 'CREATE' }]);
  });

  it('apply кладёт конфиг и САМ проставляет в него версию формы', async () => {
    const box = install();
    await run({ command: 'apply', cwd: box.root });

    const written = JSON.parse(box.read('baser.json') ?? '{}') as {
      formVersion: number;
      sources: { use: string }[];
    };
    // Пользователь не вводил ничего — вопросов у двери не бывает.
    expect(written.formVersion).toBe(FORM_VERSION);
    expect(written.sources).toEqual([{ use: DEVBOX_PACKAGE }]);
  });

  it('СУЩЕСТВУЮЩИЙ конфиг авторитетен: снятый обвес засевом не возвращается', async () => {
    // Пакет поставлен и объявлен зависимостью, но из конфига убран руками.
    const box = install({ config: { formVersion: 1, sources: [] } });

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('no-sources');
    expect(result.config.creates).toBe(false);
    // Иначе отказаться от поставленного пакета было бы нечем.
    expect(box.read('baser.json')).toContain('"sources": []');
  });

  it('обвесов не поставлено — это не ошибка и пустой конфиг не кладётся', async () => {
    const box = install({ declareDependency: false });

    const outcome = await cli(['apply', '--cwd', box.root], process.cwd());

    expect(outcome.result?.status).toBe('no-sources');
    expect(outcome.exitCode).toBe(0);
    // Файл, объявляющий ноль обвесов, — мусор в чужом репозитории.
    expect(box.exists('baser.json')).toBe(false);
  });
});

describe('отказ говорит чужим кодом, когда код есть', () => {
  it('опечатка в настройке — код КОНТРАКТОВ, а не выдумка двери', async () => {
    const box = install({
      config: {
        formVersion: 1,
        sources: [{ use: DEVBOX_PACKAGE, settings: { runtimeVerison: '24' } }],
      },
    });

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    expect(result.problems.map((problem) => problem.code)).toContain(
      'unknown-setting',
    );
  });

  it('шаблон на чужом языке — код ФОРМЫ, и он назван ДО подстановки', async () => {
    const box = install({ config: CONFIG });
    // EJS отрендерил бы это сам в себя: артефакт лёг бы с неподставленным
    // "{{ name }}" и ничем бы себя не выдал.
    box.writeTemplate('devcontainer.json.ejs', '{ "name": "{{ name }}" }\n');

    const result = await run({ command: 'apply', cwd: box.root });

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('template-not-ejs');
    // Отказ до движка — значит и плана нет, и на диск не ушло ничего.
    expect(result.plan).toBeNull();
    expect(box.exists('.devcontainer')).toBe(false);
  });

  it('резолвер обвеса не нашёлся — код КОНТРАКТОВ, хотя звала его дверь', async () => {
    const box = install({ config: CONFIG });
    // Модуль на месте, экспорта нет: обвес объявил дефолт, которого не отдаёт.
    box.updateResolvers(
      'export function repoName(ctx) { return ctx.repo.name; }\n',
    );

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    const problem = result.problems.find(
      (item) => item.code === 'resolver-failed',
    );
    expect(problem?.message).toContain('devboxName');
    // Порт двери, отказ формы: одного языка отказа хватает на обе зоны.
    expect(problem?.at).toContain('settings.name.defaultFrom');
  });

  it('пакет назван в конфиге, но не поставлен', async () => {
    const box = install({
      config: { formVersion: 1, sources: [{ use: '@чужой/обвес' }] },
    });

    const outcome = await cli(['plan', '--cwd', box.root], process.cwd());

    expect(outcome.result?.problems[0].code).toBe('package-not-found');
    expect(outcome.exitCode).toBe(2);
  });

  it('обвесов больше одного — отказ с ПРИЧИНОЙ, а не «пока не поддерживается»', async () => {
    const box = install({
      config: {
        formVersion: 1,
        sources: [{ use: DEVBOX_PACKAGE }, { use: '@omnifield/baser-second' }],
      },
    });

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    expect(problem.code).toBe('multiple-sources');
    // Причина, а не следствие: план строится по одной декларации, а сироты
    // ищутся по всем записям манифеста — второй прогон снял бы артефакты
    // первого как потерявшие объявление.
    expect(problem.message).toContain(
      'сироты ищутся по всем записям манифеста',
    );
  });
});

describe('шов contentRoot: источник вне дерева', () => {
  it('раскладка hoisted-workspace названа своим кодом, а не подделана путём', async () => {
    const box = install({ hoisted: true, config: CONFIG });

    const result = await run({ command: 'plan', cwd: box.root });

    // Пакет резолвится (Node идёт вверх), но репо-относительного пути к его
    // шаблонам не существует — и дверь говорит именно это.
    expect(result.source?.location.kind).toBe('outside-tree');
    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('source-outside-tree');
  });

  it('штатная установка даёт НАСТОЯЩИЙ путь — защита движка работает', async () => {
    const box = install({ config: CONFIG });

    const result = await run({ command: 'plan', cwd: box.root });

    expect(result.source?.location).toEqual({
      kind: 'in-tree',
      path: `node_modules/${DEVBOX_PACKAGE}/template`,
    });
  });
});

describe('трейсы: свои фазы, чужие отдельно', () => {
  it('дверь мерит СЕБЯ, а движок — себя; списки не смешаны', async () => {
    const box = install({ config: CONFIG });

    const result = await run({ command: 'apply', cwd: box.root });
    const door = result.trace.map((span) => span.name);

    expect(door).toEqual([
      'door.config',
      'door.declaration',
      'door.resolvers',
      'door.values',
      'door.render',
      'door.flush',
    ]);
    // Чтение служебной записи — работа движка, и мерит её он. Свести списки
    // означало бы, что медленный прогон не отличить: разбор манифеста или
    // чтение десятка шаблонов с диска.
    expect(result.plan?.trace.map((span) => span.name)).toContain(
      'plan.manifest',
    );
    expect(door.some((name) => name.startsWith('plan.'))).toBe(false);
  });

  it('в текст трейсы не идут: телеметрия, а не печать в поток', async () => {
    const box = install({ config: CONFIG });
    const result = await run({ command: 'apply', cwd: box.root });

    expect(renderText(result)).not.toContain('door.render');
  });
});

describe('коды возврата — производная от состояния, а не отдельный признак', () => {
  it('конфликт владения даёт 1, отказ двери — 2, сделанное — 0', async () => {
    // Настоящий конфликт владения: на месте артефакта лежит чужой файл.
    const blocked = install({ config: CONFIG });
    blocked.write(
      '.devcontainer/devcontainer.json',
      '// чужой файл, движок его не клал\n{}\n',
    );
    const outcome = await cli(['plan', '--cwd', blocked.root], process.cwd());
    expect(outcome.result?.plan?.conflicts[0].kind).toBe('foreign-dest');
    expect(outcome.exitCode).toBe(1);
    blocked.cleanup();

    const refused = install({
      config: { formVersion: 1, sources: [{ use: '@нет/такого' }] },
    });
    expect(
      (await cli(['plan', '--cwd', refused.root], process.cwd())).exitCode,
    ).toBe(2);
    refused.cleanup();

    const empty = install({ declareDependency: false });
    expect(
      (await cli(['plan', '--cwd', empty.root], process.cwd())).exitCode,
    ).toBe(0);
  });
});
