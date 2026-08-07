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
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORM_VERSION } from '@omnifield/baser-contracts';
import {
  installDevbox,
  soleRun,
  DEVBOX_PACKAGE,
  PINNED_NODE,
  type Consumer,
  type InstallOptions,
} from './devbox.fixture.js';
import { cli, type CliOutcome } from './cli.js';
import { run } from './run.js';
import { renderText } from './report.js';
import type { DoorResult } from './result.js';
import { startStore, type FakeStore } from './store.fixture.js';

/**
 * Прогон, которому НУЖЕН склад: поставку двери больше не кладёт никто, и
 * ненайденная поставка — это ответ склада, а не отсутствие каталога.
 *
 * Склад поднимается пустым: он на связи и честно отвечает «такого у меня нет».
 * Без него проба ушла бы в сеть — то есть проверяла бы чужой реестр и погоду.
 */
async function withStore<T>(body: (store: FakeStore) => Promise<T>): Promise<T> {
  const store = await startStore();
  try {
    return await body(store);
  } finally {
    await store.close();
  }
}

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

function install(options: InstallOptions = {}): Consumer {
  consumer = installDevbox(options);
  return consumer;
}

const DEVBOX_ID = 'omnifield/devbox';

/** `baser.json` формы 2 — ТОЛЬКО перечень поставленного, ни одного значения. */
const CONFIG = { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] };

/** Выбранное и заполненное — в файле на инструмент, а не в конфиге. */
const TUNED = { [DEVBOX_ID]: { presets: ['omnifield'] } };

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

    const result = await run({ command: 'plan', ...box.door });

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
    await run({ command: 'apply', ...box.door });
    box.remove('baser.json');

    const plan = await run({ command: 'plan', ...box.door });

    expect(soleRun(plan).plan?.status).toBe('converged');
    expect(plan.status).toBe('pending');
    expect(plan.config.creates).toBe(true);
    // И `plan` по-прежнему не пишет: список записей у него пуст по построению.
    expect(plan.writes).toEqual([]);
    expect(box.exists('baser.json')).toBe(false);

    const applied = await run({ command: 'apply', ...box.door });
    expect(applied.status).toBe('applied');
    expect(applied.writes).toEqual([{ path: 'baser.json', kind: 'CREATE' }]);
  });

  it('apply кладёт конфиг и САМ проставляет в него версию формы', async () => {
    const box = install();
    await run({ command: 'apply', ...box.door });

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
    const box = install({ config: { formVersion: 2, sources: [] } });

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('no-sources');
    expect(result.config.creates).toBe(false);
    // Иначе отказаться от поставленного пакета было бы нечем.
    expect(box.read('baser.json')).toContain('"sources": []');
  });

  it('обвесов не поставлено — это не ошибка и пустой конфиг не кладётся', async () => {
    const box = install({ declareDependency: false });

    // Ни объявленной зависимости, ни названного каталога поставки: сказать
    // «поставлено» тут нечем, и это не ошибка, а пустая локация.
    const outcome = await cli(['apply', '--cwd', box.root], process.cwd());

    expect(door(outcome)?.status).toBe('no-sources');
    expect(outcome.exitCode).toBe(0);
    // Файл, объявляющий ноль обвесов, — мусор в чужом репозитории.
    expect(box.exists('baser.json')).toBe(false);
  });
});

describe('засев: два разных «не получилось», и молчание тут одно', () => {
  const BROKEN = '@fixture/сломан';
  const ABSENT = '@fixture/не-поставлен';

  it('поставленный пакет с непригодным манифестом молча не выпадает', async () => {
    const box = install();
    const broken = box.installSource({
      packageName: BROKEN,
      id: 'fixture/broken',
      layout: [{ src: 'file.md', dest: 'docs/file.md', render: false }],
      templates: { 'file.md': '# file\n' },
    });
    // Недописанный `package.json` — ровно то, на чём отказывает сам резолвер
    // Node, причём тем же отказом, что и на отсутствующем пакете. Разводит их
    // код резолва контрактов (`tasker:BASER2-127`), а не наша догадка.
    writeFileSync(join(broken.root, 'package.json'), '{ "name":');

    const result = await run({ command: 'plan', ...box.door });

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    expect(problem.code).toBe('package-manifest-unreadable');
    // Пакет назван: иначе человеку сказано «что-то не читается» и предложено
    // искать самому.
    expect(problem.message).toContain(BROKEN);
    // Перечень, про который известно, что он неполон, не рождается вовсе:
    // рождение бывает одно, и следующий прогон эту дыру уже не залатает.
    expect(result.config.creates).toBe(false);
    expect(box.exists('baser.json')).toBe(false);
  });

  it('объявленная, но НЕ поставленная зависимость молчит — и это решение', async () => {
    const box = install();
    // Так выглядит свежий `checkout` без `install`: строка в манифесте есть,
    // пакета на диске нет. Сказать про него нечего — обвес он или нет, знает
    // только его манифест, а манифеста нет вовсе.
    const manifest = JSON.parse(box.read('package.json') ?? '{}') as {
      devDependencies?: Record<string, string>;
    };
    manifest.devDependencies = {
      ...manifest.devDependencies,
      [ABSENT]: '0.1.0',
    };
    box.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await run({ command: 'apply', ...box.door });

    expect(result.problems).toEqual([]);
    expect(result.status).toBe('applied');
    // Перечень при этом настоящий: поставленный обвес в нём есть.
    expect(JSON.parse(box.read('baser.json') ?? '{}')).toEqual({
      formVersion: FORM_VERSION,
      sources: [{ use: DEVBOX_PACKAGE }],
    });
  });
});

describe('отказ говорит чужим кодом, когда код есть', () => {
  it('опечатка в настройке — код КОНТРАКТОВ, а не выдумка двери', async () => {
    const box = install({
      config: CONFIG,
      tuning: { [DEVBOX_ID]: { settings: { imageTeg: '24' } } },
    });

    const result = await run({ command: 'plan', ...box.door });

    expect(result.status).toBe('refused');
    expect(result.problems.map((problem) => problem.code)).toContain(
      'unknown-setting',
    );
  });

  it('шаблон на чужом языке — код ФОРМЫ, и он назван ДО подстановки', async () => {
    const box = install({ config: CONFIG, tuning: TUNED });
    // EJS отрендерил бы это сам в себя: артефакт лёг бы с неподставленным
    // "{{ name }}" и ничем бы себя не выдал.
    box.writeTemplate('devcontainer.json.ejs', '{ "name": "{{ name }}" }\n');

    const result = await run({ command: 'apply', ...box.door });

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('template-not-ejs');
    // Отказ до движка — значит и плана нет, и на диск не ушло ничего. Рассказ
    // про обвес при этом остаётся: отказ его не обнуляет.
    expect(soleRun(result).plan).toBeNull();
    expect(soleRun(result).source.id).toBe('omnifield/devbox');
    expect(box.exists('.devcontainer')).toBe(false);
  });

  it('резолвер обвеса не нашёлся — код КОНТРАКТОВ, хотя звала его дверь', async () => {
    const box = install({ config: CONFIG, tuning: TUNED });
    // Модуль на месте, экспорта нет: обвес объявил дефолт, которого не отдаёт.
    // Не отдаётся РОВНО ОДИН — остальные резолверы на месте намеренно. Проба про
    // язык отказа, а не про то, чей отказ окажется первым: ключи сортируются
    // побайтово, и настройка с буквой раньше молча меняла бы, кто назван первым
    // (`tasker:BASER2-83`: `imageTag` встал раньше `name`).
    box.updateResolvers(
      [
        'export function repoName(ctx) { return ctx.repo.name; }',
        `export function latestStableNode() { return '${PINNED_NODE}'; }`,
        '',
      ].join('\n'),
    );

    const result = await run({ command: 'plan', ...box.door });

    expect(result.status).toBe('refused');
    const failures = result.problems.filter(
      (item) => item.code === 'resolver-failed',
    );
    // Ровно один — иначе утверждение ниже говорило бы про случайного из многих.
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('devboxName');
    // Порт двери, отказ формы: одного языка отказа хватает на обе зоны.
    expect(failures[0].at).toContain('settings.name.defaultFrom');
  });

  it('поставка названа в перечне, а на складе её нет', async () => {
    const box = install({
      config: { formVersion: 2, sources: [{ use: 'baser-fixture-unknown' }] },
    });

    const outcome = await withStore((store) =>
      cli(
        ['plan', '--cwd', box.root, ...box.doorArgs()],
        process.cwd(),
      ).then((result) => {
        // Склад РЕАЛЬНО спросили — иначе отказ говорил бы о том, чего не делали.
        expect(store.requests()).toBeGreaterThan(0);
        return result;
      }),
    );

    // Поставку достаёт дверь (`tasker:BASER2-146`), значит и отказ её: склад
    // ответил, поставки нет. Прежний `package-not-installed` тут больше не
    // возникает — искать в чужом складе дверь перестала.
    expect(door(outcome)?.problems[0].code).toBe('supply-not-published');
    expect(outcome.exitCode).toBe(2);
  });

  it('отказ по ВТОРОМУ обвесу адресуется вторым, а не первым', async () => {
    // Разбор идёт по всему перечню и не встаёт на первом: адрес отказа несёт
    // индекс записи, иначе с двумя одинаковыми кодами непонятно, какую чинить.
    const box = install({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: 'baser-fixture-second' }],
      },
    });

    const result = await withStore(() =>
      run({ command: 'plan', ...box.door }),
    );

    expect(result.status).toBe('refused');
    const [problem] = result.problems;
    expect(problem.code).toBe('supply-not-published');
    expect(problem.at).toBe('baser.json.sources[1].use');
    // Кода `multiple-sources` больше нет: он снят вместе с причиной, а не
    // подавлен (`tasker:BASER2-55`).
    expect(result.problems.map((item) => item.code)).not.toContain(
      'multiple-sources',
    );
  });
});

describe('шов contentRoot: источник вне дерева', () => {
  it('раскладка вне дерева НАЗВАНА адресом и работает, а не отказывает', async () => {
    const box = install({ hoisted: true, config: CONFIG, tuning: TUNED });

    const result = await run({ command: 'apply', ...box.door });

    // Репо-относительного пути к шаблонам не существует — и дверь говорит
    // именно это, адресом снаружи. Отказом это положение быть перестало
    // (`tasker:BASER2-150`): движок пишет только внутрь дерева, источник лежит
    // снаружи, пересечение пусто по построению.
    const location = soleRun(result).source.location;
    expect(location.kind).toBe('outside-tree');
    expect(result.problems).toEqual([]);
    expect(result.status).toBe('applied');
    // И это НАСТОЯЩАЯ укладка из источника снаружи, а не «отказа не было»:
    // артефакт лёг в дерево потребителя.
    expect(box.read('.devcontainer/devcontainer.json')).not.toBeNull();
  });


  it('штатная установка даёт НАСТОЯЩИЙ путь — защита движка работает', async () => {
    const box = install({ config: CONFIG, tuning: TUNED });

    const result = await run({ command: 'plan', ...box.door });

    expect(soleRun(result).source.location).toEqual({
      kind: 'in-tree',
      path: `node_modules/${DEVBOX_PACKAGE}/template`,
    });
  });
});

describe('трейсы: свои фазы, чужие отдельно', () => {
  it('дверь мерит СЕБЯ, а движок — себя; списки не смешаны', async () => {
    const box = install({ config: CONFIG, tuning: TUNED });

    const result = await run({ command: 'apply', ...box.door });
    const door = result.trace.map((span) => span.name);

    expect(door).toEqual([
      'door.config',
      // Доставание поставки — единственная фаза двери, которая ходит по сети, и
      // мерится она ОТДЕЛЬНО от разбора объявлений (`tasker:BASER2-146`):
      // прогон, подорожавший на складе, обязан указывать на склад, а не на
      // «где-то до плана». Спан на каждую поставку, поэтому он и закрывается
      // раньше объемлющего `door.declarations`.
      'door.supply',
      'door.declarations',
      // Событие, а не спан: «чем шёл прогон» — обвес, его ВЕРСИЯ и сколько
      // артефактов он держит не своими руками (`tasker:BASER2-68`). Мерить тут
      // нечего, и нулевая длительность здесь названа, а не подразумевается.
      'door.sources',
      'door.owners',
      'door.settings',
      'door.resolvers',
      // Слово обвеса про своё применение здесь (`tasker:BASER2-234`). Событие, а
      // не спан: доставка модуля резолвера меряется тем же счётчиком, что и у
      // дефолтов, а само вычисление синхронно и мгновенно. Названо оно ВСЕГДА,
      // включая молчание, — иначе телеметрия не отличила бы обвес, которому
      // нечего сказать, от прогона, где предупреждение потерялось по дороге.
      'door.warning',
      'door.values',
      'door.render',
      // Восстановление прежнего конца движения (`tasker:BASER2-38`) мерится
      // отдельно и стоит ПОСЛЕ плана: материал ему даёт сам план, а работа это
      // не бесплатная — пересчёт шаблона на подобранных значениях. Прогон, где
      // она вдруг станет дорогой, обязан быть виден в трейсе, а не размазан по
      // соседней фазе.
      'door.placed',
      // ЦЕНА движения мерится своими фазами и по той же причине: обе читают
      // содержимое целиком — одна ищет в нём слова, посчитанные от значения
      // (`tasker:BASER2-98`), другая сверяет его построчно с чужим файлом
      // (`tasker:BASER2-112`). Прогон, у которого подорожала именно эта работа,
      // обязан указывать на неё, а не на «где-то после плана».
      'door.derived',
      'door.difference',
      // «Смогу ли я это записать» — спрашивается ДО применения и мерится
      // отдельно (`tasker:BASER2-190`): вопрос идёт на диск по каждому пути, и
      // прогон, подорожавший на нём, обязан указывать на него, а не на сброс,
      // который ещё не начинался. Спан повторяется в прогоне дважды — паспорт
      // укладки спрашивается раньше склада, — и различаются они данными
      // (`subject`), а не порядком; здесь установка первая, паспорта ещё нет, и
      // спрашивать нечего.
      'door.writable',
      'door.flush',
    ]);
    // Чтение служебной записи — работа движка, и мерит её он. Свести списки
    // означало бы, что медленный прогон не отличить: разбор манифеста или
    // чтение десятка шаблонов с диска.
    expect(soleRun(result).plan?.trace.map((span) => span.name)).toContain(
      'plan.manifest',
    );
    expect(door.some((name) => name.startsWith('plan.'))).toBe(false);
  });

  it('в текст трейсы не идут: телеметрия, а не печать в поток', async () => {
    const box = install({ config: CONFIG, tuning: TUNED });
    const result = await run({ command: 'apply', ...box.door });

    expect(renderText(result)).not.toContain('door.render');
  });
});

describe('коды возврата — производная от состояния, а не отдельный признак', () => {
  it('конфликт владения даёт 1, отказ двери — 2, сделанное — 0', async () => {
    // Настоящий конфликт владения: на месте артефакта лежит чужой файл.
    const blocked = install({ config: CONFIG, tuning: TUNED });
    blocked.write(
      '.devcontainer/devcontainer.json',
      '// чужой файл, движок его не клал\n{}\n',
    );
    const outcome = await cli(['plan', '--cwd', blocked.root, ...blocked.doorArgs()], process.cwd());
    expect(soleRun(door(outcome) as DoorResult).plan?.conflicts[0].kind).toBe(
      'foreign-dest',
    );
    expect(outcome.exitCode).toBe(1);
    blocked.cleanup();

    const refused = install({
      config: { formVersion: 2, sources: [{ use: '@нет/такого' }] },
    });
    expect(
      (await cli(['plan', '--cwd', refused.root, ...refused.doorArgs()], process.cwd())).exitCode,
    ).toBe(2);
    refused.cleanup();

    const empty = install({ declareDependency: false });
    expect(
      (await cli(['plan', '--cwd', empty.root, ...empty.doorArgs()], process.cwd())).exitCode,
    ).toBe(0);
  });
});

/** Ответ прогона из общего ответа вызова: семьи команд разные, ответы тоже. */
function door(outcome: CliOutcome) {
  return outcome.result?.kind === 'door' ? outcome.result.door : null;
}
