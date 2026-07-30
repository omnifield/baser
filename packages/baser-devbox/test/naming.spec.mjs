/**
 * ИМЯ ДЕВБОКСА И АЛИАС В СЕТИ — от РЕПОЗИТОРИЯ, а не от того, как его назвали.
 *
 * Починка `tasker:BASER2-32`. Дефект нашёлся не тестом, а живым прогоном: клон
 * в папку `weber-live` дал `weber-live-devbox` и алиас `weber-live` в общей
 * сети, а установка бандла через докер (`-v "$PWD":/repo`) вообще назвала
 * девбокс точкой монтирования.
 *
 * Пробы устроены вокруг ТРЁХ ИМЁН, которые в жизни расходятся:
 *
 * | имя               | чьё оно                        | что им отвечают         |
 * |-------------------|--------------------------------|-------------------------|
 * | каталог           | человека с его клоном          | «как я назвал папку»    |
 * | `name` манифеста  | ПАКЕТА внутри репозитория      | «как называется пакет»  |
 * | `origin`          | самого репозитория             | «что это за репозиторий»|
 *
 * Отвечает на вопрос «что это за репозиторий» только третье, поэтому имя растёт
 * из него, каталог остаётся запасным вариантом, а манифест не читается вовсе —
 * см. `defaults.mjs`, где это решение расписано вместе с обоими живыми
 * контрпримерами.
 *
 * Всё меряется ДВЕРЬЮ по распакованному тарболу: имя, которое сошлось в юнитах
 * и разошлось в артефакте, никого не спасает.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
// Обвес здесь один — прогон под него берётся `soleRun` двери, а не `runs[0]`:
// он бросает, если обвес не один (`tasker:BASER2-55`). Публичным входом зоны
// `cli`, как и `run` (`tasker:BASER2-59`).
import { renderText, run, soleRun } from '../../baser-cli/src/index.ts';
import {
  consumerConfig,
  DEVBOX_PACKAGE,
  installConsumer,
  LIVE,
  parseJsonc,
  tuning,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Раскладывает обвес и отдаёт разобранный артефакт. */
async function materialize(options) {
  consumer = installConsumer({
    config: consumerConfig(),
    tuning: tuning({ presets: ['omnifield'] }),
    ...options,
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  expect(result.status, 'обвес не разложился').toBe('applied');
  return { json: parseJsonc(consumer.read(LIVE)), result };
}

/** Алиас в сети — из `runArgs`, то есть ровно оттуда, откуда его читает docker. */
function alias(json) {
  const found = json.runArgs.find((arg) => arg.startsWith('--network-alias='));
  return found === undefined ? null : found.slice('--network-alias='.length);
}

/**
 * Значение алиаса, когда сети нет вовсе.
 *
 * Без пресета `omnifield` обвес в чужую сеть не лезет, и строки алиаса в
 * артефакте не появляется — но настройка посчитана, и поедет она в тот же
 * `--network-alias`, как только сеть появится. Спрашивать её у двери верно, а
 * не подсовывать пресет только ради того, чтобы алиас было где прочитать.
 */
function aliasSetting(result) {
  return soleRun(result).settings.find(
    (setting) => setting.key === 'networkAlias',
  ).value;
}

describe('имя растёт из идентичности репозитория, а не из точки монтирования', () => {
  it('клон в папку с другим именем — имя и алиас остаются репозиторными', async () => {
    // Ровно находка architect: `git clone … weber-live`. До 0.3.0 выходило
    // `weber-live-devbox` и алиас `weber-live` — сосед, ходивший на
    // `http://weber`, переставал попадать куда шёл.
    const { json } = await materialize({
      repoName: 'weber-live',
      gitOrigin: 'https://github.com/omnifield/weber.git',
    });

    expect(json.name).toBe('weber-devbox');
    expect(alias(json)).toBe('weber');
  });

  it('два клона одного репозитория дают ОДНО имя и ОДИН алиас', async () => {
    // Утверждение задачи целиком: «два клона одного репозитория — два разных
    // имени и два разных алиаса» перестаёт быть правдой.
    const first = await materialize({
      repoName: 'weber',
      gitOrigin: 'git@github.com:omnifield/weber.git',
    });
    const firstName = first.json.name;
    const firstAlias = alias(first.json);
    consumer.cleanup();
    consumer = null;

    const second = await materialize({
      repoName: 'weber-live',
      gitOrigin: 'git@github.com:omnifield/weber.git',
    });

    expect(second.json.name).toBe(firstName);
    expect(alias(second.json)).toBe(firstAlias);
  });

  it('установка через докер в /repo называет девбокс репозиторием, а не точкой монтирования', async () => {
    // `docker run -v "$PWD":/repo -w /repo …` из INSTALL.md двери. Каталог
    // здесь — служебный, и он же был именем девбокса; отсюда и оговорка в доке
    // «монтируй под именем репозитория».
    const { json } = await materialize({
      repoName: 'repo',
      gitOrigin: 'https://github.com/omnifield/goish.git',
      manifest: null,
    });

    expect(json.name).toBe('goish-devbox');
    expect(alias(json)).toBe('goish');
  });

  it('рабочее дерево (git worktree) — тот же ответ, что у обычного клона', async () => {
    // У `git worktree` `.git` не каталог, а файл с адресом служебного каталога;
    // настройки общие. Разложенный рабочими деревьями репозиторий — обычная
    // раскладка, а не экзотика, и имя в ней обязано быть тем же.
    const { json } = await materialize({
      repoName: 'weber-feature-x',
      gitOrigin: 'https://github.com/omnifield/weber.git',
      gitLayout: 'file',
    });

    expect(json.name).toBe('weber-devbox');
    expect(alias(json)).toBe('weber');
  });
});

describe('цена чтения — видна, а не спрятана', () => {
  it('чтение .git считается трейсом двери, своего счётчика зона не заводит', async () => {
    // Резолверы исполняются внутри `door.values`, и с 0.3.0 внутри них есть
    // файловое чтение. Свой замер здесь был бы ВТОРОЙ правдой о том же
    // событии: мерить работу двери есть чем, и мерит её дверь.
    const { result } = await materialize({
      repoName: 'weber-live',
      gitOrigin: 'https://github.com/omnifield/weber.git',
    });

    const values = result.trace.find((span) => span.name === 'door.values');
    expect(
      values,
      'работа резолверов перестала попадать в трейс',
    ).toBeDefined();
    expect(typeof values.ms).toBe('number');
  });
});

describe('манифест потребителя на имя НЕ влияет — ни настоящий, ни наш', () => {
  it('наш собственный корневой манифест назван иначе, чем репозиторий', async () => {
    // Живой контрпример, а не выдуманный: корень ЭТОГО репозитория объявлен
    // `@omnifield/baser-source`, а репозиторий называется `baser`. Имя из
    // манифеста дало бы `baser-source-devbox` — то есть разошлось бы с живым
    // `.devcontainer`, который и есть эталон приёмки этой зоны.
    const { json } = await materialize({
      repoName: 'baser-live',
      gitOrigin: 'https://github.com/omnifield/baser.git',
      manifest: {
        name: '@omnifield/baser-source',
        version: '0.0.0',
        private: true,
        devDependencies: { [DEVBOX_PACKAGE]: '0.2.0' },
      },
    });

    expect(json.name).toBe('baser-devbox');
    expect(alias(json)).toBe('baser');
  });

  it('scope в имени пакета не доезжает ни до имени, ни до алиаса', async () => {
    // `@omnifield/weber` — законное имя пакета и невозможное имя контейнера:
    // docker принимает `[a-zA-Z0-9][a-zA-Z0-9_.-]*`, и ни `@`, ни `/` в него не
    // входят. Проба стоит даже там, где манифест не читается: scope-подобная
    // форма приезжает и из адреса, и из имени каталога.
    const { json } = await materialize({
      repoName: 'weber-live',
      gitOrigin: 'https://github.com/omnifield/weber.git',
      manifest: {
        name: '@omnifield/weber',
        version: '1.0.0',
        private: true,
        devDependencies: { [DEVBOX_PACKAGE]: '0.2.0' },
      },
    });

    expect(json.name).toBe('weber-devbox');
    expect(alias(json)).toBe('weber');
    for (const value of [json.name, alias(json)]) {
      expect(value).not.toContain('@');
      expect(value).not.toContain('/');
    }
  });

  it('ОДИН репозиторий, четыре разных манифеста — имя одно и то же', async () => {
    // Утверждение сформулировано как свойство, а не как список случаев: имя не
    // зависит от манифеста ВООБЩЕ. Так ловушка с заглушкой закрывается по
    // построению — заглушка это просто ещё один манифест, которого мы не
    // читаем, и подгонять правило под её форму не нужно.
    const manifests = [
      undefined,
      null,
      { name: '@omnifield/weber', version: '1.0.0' },
      { name: 'repo', private: true },
    ];

    const names = [];
    for (const manifest of manifests) {
      const { json } = await materialize({
        repoName: 'weber-live',
        gitOrigin: 'https://github.com/omnifield/weber.git',
        manifest,
      });
      names.push(`${json.name} · ${alias(json)}`);
      consumer.cleanup();
      consumer = null;
    }

    expect(new Set(names).size, `имена разошлись: ${names.join(', ')}`).toBe(1);
    expect(names[0]).toBe('weber-devbox · weber');
  });
});

describe('ЛОВУШКА: манифест-заглушка ручной установки', () => {
  /**
   * Установщик бандла в репозитории без `package.json` создаёт его на время
   * прогона — с именем-заглушкой `repo`
   * (`packages/baser-cli/src/bundle/install.ts`, `declareDependency`). Дверь
   * при этом видит НАШ манифест, а не манифест потребителя.
   *
   * Проба воспроизводит ровно ту раскладку, которая существует в момент вызова
   * двери: заглушка на диске, `baser.json` ещё нет, обвес объявлен зависимостью
   * (иначе дверь его не найдёт). Красной она была бы против решения «читать имя
   * из манифеста», а не против кода до фикса, — и это сказано вслух, потому что
   * проба, не умеющая покраснеть, ничего не проверяет.
   */
  const STUB = {
    name: 'repo',
    private: true,
    dependencies: { [DEVBOX_PACKAGE]: '0.2.0' },
  };

  it('репозиторий без манифеста, поставленный через бандл: имя каталога, а не "repo"', async () => {
    // Сегодняшнее поведение, которое НЕЛЬЗЯ уронить: репозиторий в папке
    // `goish` без `package.json` и без remote даёт `goish-devbox`. Проверено
    // живьём architect'ом 2026-07-27.
    const { json, result } = await materialize({
      repoName: 'goish',
      manifest: STUB,
      // Ни `baser.json`, ни файла настроек: ровно та раскладка, которая
      // существует в момент вызова двери из бандла.
      config: undefined,
      tuning: undefined,
    });

    expect(json.name).toBe('goish-devbox');
    expect(aliasSetting(result)).toBe('goish');
  });

  it('тот же бандл в докере: имя репозитория бьёт и заглушку, и точку монтирования', async () => {
    const { json, result } = await materialize({
      repoName: 'repo',
      gitOrigin: 'https://github.com/omnifield/goish.git',
      manifest: STUB,
      config: undefined,
      tuning: undefined,
    });

    expect(json.name).toBe('goish-devbox');
    expect(aliasSetting(result)).toBe('goish');
  });

  it('дверь родила конфиг сама — раскладка ручной установки воспроизведена целиком', async () => {
    // Половина имитации хуже её отсутствия: если бы проба клала `baser.json`
    // руками, она проверяла бы не тот путь, которым идёт живой бандл.
    consumer = installConsumer({ repoName: 'goish', manifest: STUB });

    const result = await run({ command: 'apply', cwd: consumer.root });

    expect(result.config.creates).toBe(true);
    expect(parseJsonc(consumer.read(LIVE)).name).toBe('goish-devbox');
  });
});

describe('запасной вариант: репозитория не видно', () => {
  it('без .git имя берётся из каталога — сегодняшнее поведение сохранено', async () => {
    const { json } = await materialize({ repoName: 'goish', manifest: null });

    expect(json.name).toBe('goish-devbox');
    expect(alias(json)).toBe('goish');
  });

  it('git есть, а origin нет — тоже каталог, и прогон не падает', async () => {
    consumer = installConsumer({
      repoName: 'fresh',
      manifest: null,
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    // `git init` без remote — первый день нового репозитория.
    consumer.write('.git/config', '[core]\n\trepositoryformatversion = 0\n');

    const result = await run({ command: 'apply', cwd: consumer.root });

    expect(result.status).toBe('applied');
    expect(parseJsonc(consumer.read(LIVE)).name).toBe('fresh-devbox');
  });

  it('рабочее дерево, потерявшее свой репозиторий, не роняет прогон', async () => {
    // `.git` указывает в каталог, которого больше нет: основной репозиторий
    // унесли или переименовали. Чтение при этом идёт по несуществующему пути —
    // без страховки это `resolver-failed`, то есть отказ ВСЕГО прогона из-за
    // имени контейнера.
    consumer = installConsumer({
      repoName: 'weber-feature',
      manifest: null,
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    consumer.write('.git', 'gitdir: /нет/такого/каталога/worktrees/wt\n');

    const result = await run({ command: 'apply', cwd: consumer.root });

    expect(result.status).toBe('applied');
    expect(parseJsonc(consumer.read(LIVE)).name).toBe('weber-feature-devbox');
  });

  it('битый .git/config не роняет прогон и не отравляет имя', async () => {
    // Резолвер, бросивший исключение, — это `resolver-failed` на весь прогон.
    // Имя девбокса такой цены не стоит: нечитаемое просто не участвует.
    //
    // Байт NUL в начале фикстуры записан ЭКРАНИРОВАННЫМ намеренно. Лежал он
    // здесь сырым — и от одного байта весь ЭТОТ файл становился для инструментов
    // бинарным: `file` звал его `data`, а `grep` переставал находить в нём хоть
    // что-нибудь, молча и без единой жалобы. Ровно так `tasker:BASER2-59` чуть
    // не осталась сделанной наполовину: поиск глубоких импортов эту пробу не
    // показал. В конфиг потребителя приезжает тот же самый байт — проба от
    // экранирования не слабеет ни на сколько.
    consumer = installConsumer({
      repoName: 'fresh',
      manifest: null,
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    consumer.write('.git/config', '\u0000[remote "origin"\n\turl =\n=?');

    const result = await run({ command: 'apply', cwd: consumer.root });

    expect(result.status).toBe('applied');
    expect(parseJsonc(consumer.read(LIVE)).name).toBe('fresh-devbox');
  });
});

describe('ПЕРЕИМЕНОВАНИЕ при обновлении обвеса — что дверь про него говорит', () => {
  it('разложенное поедет: план называет расхождение и НОВОЕ имя', async () => {
    // Смена резолвера меняет уже разложенное у всех, кто имя не заполнял.
    // Здесь это воспроизведено честно: сначала артефакт кладётся СТАРЫМ
    // резолвером (имя каталога), потом обвес обновляется до нынешнего.
    consumer = installConsumer({
      repoName: 'weber-live',
      gitOrigin: 'https://github.com/omnifield/weber.git',
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    previousRelease(consumer);
    await run({ command: 'apply', cwd: consumer.root });
    expect(parseJsonc(consumer.read(LIVE)).name).toBe('weber-live-devbox');

    currentRelease(consumer);
    const plan = await run({ command: 'plan', cwd: consumer.root });
    const text = renderText(plan);

    const devbox = soleRun(plan);
    const name = devbox.settings.find((setting) => setting.key === 'name');
    expect(name.value).toBe('weber-devbox');
    // Значение НАШЕ — пользователь его не заполнял, поэтому оно и поехало.
    expect(name.ours).toBe(true);
    expect(devbox.plan.steps[0].reason).toBe('diverged');
    expect(text).toContain('weber-devbox');

    // ── НАХОДКА, а не проверка ─────────────────────────────────────────────
    // Про ПЕРЕИМЕНОВАНИЕ дверь не говорит: она называет расхождение артефакта
    // («diverged») и новое значение, но прежнего конца у неё нет — прежние
    // значения нигде не хранятся (`packages/baser-cli/src/lib/values.ts`,
    // «ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ»). Человек читает план и не узнаёт, что
    // контейнер и АЛИАС В ОБЩЕЙ СЕТИ сменят имя.
    //
    // Проба стоит на находке намеренно: когда дверь научится называть оба
    // конца, она покраснеет — и это правильный сигнал, а не поломка.
    expect(text).not.toContain('weber-live-devbox');

    await run({ command: 'apply', cwd: consumer.root });
    expect(parseJsonc(consumer.read(LIVE)).name).toBe('weber-devbox');
  });

  it('заполнивший имя не переезжает никуда', async () => {
    // Обратная сторона того же: движение касается ТОЛЬКО тех, у кого значение
    // наше. Заполненное не поднимается никогда — подниматься неоткуда.
    const { json } = await materialize({
      repoName: 'weber-live',
      gitOrigin: 'https://github.com/omnifield/weber.git',
      tuning: tuning({
        presets: ['omnifield'],
        settings: { name: 'мой-девбокс', networkAlias: 'weber-live' },
      }),
    });

    expect(json.name).toBe('мой-девбокс');
    expect(alias(json)).toBe('weber-live');
  });
});

/**
 * Выпуск обвеса С ДРУГИМ РЕЗОЛВЕРОМ ИМЁН — прямо в поставленном пакете.
 *
 * Новый файл, а не перезапись: ESM-модуль кэшируется загрузчиком по URL на весь
 * процесс. Обвес правится через своё же объявление, то есть ровно так, как его
 * правит настоящий выпуск.
 */
let sequence = 0;
function swapResolvers(consumer, body) {
  sequence += 1;
  const name = `names.${sequence}.mjs`;
  consumer.write(join('node_modules', DEVBOX_PACKAGE, name), body);

  const manifestPath = join('node_modules', DEVBOX_PACKAGE, 'package.json');
  const manifest = JSON.parse(consumer.read(manifestPath));
  for (const key of ['name', 'networkAlias']) {
    manifest.baser.settings[key].defaultFrom = `./${name}#${
      key === 'name' ? 'devboxName' : 'repoName'
    }`;
  }
  consumer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Резолверы ДО починки: имя каталога, и больше ничего. */
function previousRelease(consumer) {
  swapResolvers(
    consumer,
    'export function repoName(ctx) { return ctx.repo.name; }\n' +
      'export function devboxName(ctx) { return `${ctx.repo.name}-devbox`; }\n',
  );
}

/** Возврат к резолверам этого выпуска — тем, что лежат в тарболе. */
function currentRelease(consumer) {
  const manifestPath = join('node_modules', DEVBOX_PACKAGE, 'package.json');
  const manifest = JSON.parse(consumer.read(manifestPath));
  manifest.baser.settings['name'].defaultFrom = './defaults.mjs#devboxName';
  manifest.baser.settings['networkAlias'].defaultFrom =
    './defaults.mjs#repoName';
  consumer.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
