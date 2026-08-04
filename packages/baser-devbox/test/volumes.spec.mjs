/**
 * СВОИ ТОМА РЕПОЗИТОРИЯ — НАСТРОЙКА, А НЕ ПРАВКА `.devcontainer` РУКАМИ.
 *
 * `tasker:BASER2-80`. Выразимых томов было ровно два — креды и стор, — и каждый
 * своей настройкой под конкретный том. Живым продуктам нужны ещё: общий
 * `omnifield-registry` у трёх сразу и по тому данных на продукт. Выразить это было
 * нечем, значит переезд означал ручную правку артефакта — то есть форк обвеса из-за
 * одной строки, ровно тот сценарий, ради которого обвес и существует.
 *
 * ── ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ, КРОМЕ «СПИСОК ЕДЕТ» ─────────────────────────────
 *
 * **Владение точкой — часть ОДНОГО объявления, а не второй список.** `chown` в
 * постсоздании собирается из тех же частей, что и монтирование; разведи их — и
 * появятся два места, обязанных совпадать. Свой счёт по этому классу у зоны уже
 * открыт (`tasker:BASER2-115`: том смонтирован вглубь XDG, каталог достался root),
 * поэтому здесь проверяется не «оба списка совпали», а то, что второго списка нет.
 *
 * **Отказы названы, а не подразумеваются.** Опции здесь НАШИ, а не чужой фичи:
 * опечатка в имени опции — наша забота, потому что `path:` вместо `target:`
 * оставил бы том без точки монтирования, а настройка выглядела бы заполненной.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  tuning,
} from './packed.mjs';

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

async function materialize({ presets = [], settings } = {}) {
  consumer = installConsumer({
    repoName: 'tasker',
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

/** Точки монтирования из артефакта — читаем то, что легло, а не то, что задали. */
function targets(json) {
  return (json.mounts ?? []).map(
    (mount) => mount.split(',')[1].slice('target='.length),
  );
}

describe('произвольный список томов выражается настройкой', () => {
  it('три тома с разными точками — все смонтированы, порядок объявления сохранён', async () => {
    const { json } = await materialize({
      settings: {
        volumes: {
          'omnifield-registry': { target: '/omnifield-registry' },
          'tasker-data': { target: '/data/tasker' },
          'tasker-logs': { target: '/var/log/tasker' },
        },
      },
    });

    expect(json.mounts).toEqual([
      'source=omnifield-registry,target=/omnifield-registry,type=volume',
      'source=tasker-data,target=/data/tasker,type=volume',
      'source=tasker-logs,target=/var/log/tasker,type=volume',
    ]);
  });

  it('рядом с посчитанными томами: свои идут ПОСЛЕ кредов и стора', async () => {
    const { json } = await materialize({
      presets: ['omnifield'],
      settings: { volumes: { 'tasker-data': { target: '/data/tasker' } } },
    });

    // Порядок здесь не косметика, а свойство: посчитанное обвесом (креды, стор) —
    // это его собственная раскладка, и продуктовые тома встают рядом с ней, а не
    // вместо неё. Разъехаться они не могут — точка занята, и это названный отказ.
    expect(targets(json)).toEqual([
      '/home/node/.secrets',
      '/home/node/.pnpm-store',
      '/data/tasker',
    ]);
  });

  it('пустая карта — томов нет, и блока в артефакте нет тоже', async () => {
    const { json } = await materialize({ settings: { volumes: {} } });

    expect(json.mounts).toBeUndefined();
    expect(json.postCreateCommand).not.toContain('chown');
  });

  it('свои тома БЕЗ пресета: обвес не тащит за ними ни сети, ни кредов', async () => {
    const { json, text } = await materialize({
      settings: { volumes: { 'tasker-data': { target: '/data/tasker' } } },
    });

    // Настройка принадлежит слою НАСТРОЕК, а не пресету: внешний потребитель со
    // своим томом не обязан брать вместе с ним раскладку omnifield.
    expect(json.mounts).toEqual([
      'source=tasker-data,target=/data/tasker,type=volume',
    ]);
    expect(text).not.toContain('omnifield');
    expect(json.containerEnv).toBeUndefined();
  });
});

describe('ВЛАДЕНИЕ ТОЧКОЙ едет тем же объявлением, что и монтирование', () => {
  it('по умолчанию точка забирается себе — одной командой на все тома', async () => {
    const { json } = await materialize({
      presets: ['omnifield'],
      settings: {
        volumes: {
          'omnifield-registry': { target: '/omnifield-registry' },
          'tasker-data': { target: '/data/tasker' },
        },
      },
    });

    expect(json.postCreateCommand).toContain(
      'sudo chown -R node:node /home/node/.secrets /home/node/.pnpm-store /omnifield-registry /data/tasker',
    );
    // Инвариант, ради которого настройка одна: КАЖДАЯ смонтированная точка названа
    // в правах. Проверяется по артефакту, а не по входу, — забытая точка всплыла бы
    // здесь, даже если бы отдельной пробы под неё никто не написал.
    for (const target of targets(json)) {
      expect(json.postCreateCommand, `${target} без прав`).toContain(target);
    }
  });

  it('own: false — том смонтирован, а права не трогаем', async () => {
    const { json } = await materialize({
      settings: {
        volumes: {
          'tasker-data': { target: '/data/tasker' },
          'vendor-blobs': { target: '/opt/vendor', own: false },
        },
      },
    });

    expect(targets(json)).toEqual(['/data/tasker', '/opt/vendor']);
    // «Не забирать» — про том, у которого свой владелец внутри (чужой образ, чужой
    // uid). Состояние выражается ЗНАЧЕНИЕМ настройки, а не её отсутствием.
    expect(json.postCreateCommand).toContain(
      'sudo chown -R node:node /data/tasker',
    );
    expect(json.postCreateCommand).not.toContain('/opt/vendor');
  });

  it('все тома own: false — команды прав нет вовсе, а не пустая', async () => {
    const { json } = await materialize({
      settings: {
        volumes: { 'vendor-blobs': { target: '/opt/vendor', own: false } },
      },
    });

    expect(json.mounts).toHaveLength(1);
    expect(json.postCreateCommand).not.toContain('chown');
  });

  it('комментарий над шагом собран из тех же частей, что и шаг', async () => {
    const own = await materialize({
      presets: ['omnifield'],
      settings: { volumes: { 'tasker-data': { target: '/data/tasker' } } },
    });
    // «Общие» верно ровно до тех пор, пока тома только наши — креды и стор одни на
    // все девбоксы машины. Появился том репозитория — слово перестаёт быть верным.
    expect(own.text).toContain('права на тома,');
    expect(own.text).toContain('Свои тома репозитория — настройка volumes');

    consumer.cleanup();
    consumer = null;
    const shared = await materialize({ presets: ['omnifield'] });
    expect(shared.text).toContain('права на общие тома,');
    expect(shared.text).not.toContain('Свои тома репозитория');
  });
});

describe('названные отказы: настройка, заполненная неверно, не кладёт ПОЛОВИНУ', () => {
  it('опция, которой обвес не знает, — с перечислением тех, что есть', async () => {
    const message = refusal(
      await materialize({
        settings: { volumes: { 'tasker-data': { path: '/data/tasker' } } },
      }),
    );

    expect(message).toContain('опции path обвес не знает');
    expect(message).toContain('target · own');
  });

  it('target не задан вовсе', async () => {
    const message = refusal(
      await materialize({ settings: { volumes: { 'tasker-data': {} } } }),
    );

    expect(message).toContain('target обязана быть абсолютным путём');
    expect(message).toContain('получено: ничего');
  });

  it('относительный путь: докер разворачивает mounts до старта контейнера', async () => {
    const message = refusal(
      await materialize({
        settings: { volumes: { 'tasker-data': { target: 'data/tasker' } } },
      }),
    );

    expect(message).toContain('абсолютным путём');
  });

  it('пробел и метасимвол в пути: он едет не только в mounts, но и в шелл', async () => {
    for (const bad of ['/data/my tasker', '/data/$(id -u)', '/data/x;whoami']) {
      const message = refusal(
        await materialize({
          settings: { volumes: { 'tasker-data': { target: bad } } },
        }),
      );
      expect(message, bad).toContain('служебных символов шелла');
      consumer.cleanup();
      consumer = null;
    }
  });

  it('own — да/нет, а не строка «да»', async () => {
    const message = refusal(
      await materialize({
        settings: {
          volumes: { 'tasker-data': { target: '/data/tasker', own: 'yes' } },
        },
      }),
    );

    expect(message).toContain('опция own это да/нет');
  });

  it('имя тома, которого докер не примет', async () => {
    const message = refusal(
      await materialize({
        settings: { volumes: { '/data/tasker': { target: '/data/tasker' } } },
      }),
    );

    expect(message).toContain('не годится в имя тома docker');
    expect(message).toContain('Ключ карты это ИМЯ ТОМА');
  });
});

describe('ГРАНИЦЫ: чужую точку и чужой каталог настройка не занимает', () => {
  it('точка кредов занята — её обвес считает сам, и это НЕ перекрывается', async () => {
    const message = refusal(
      await materialize({
        presets: ['omnifield'],
        settings: {
          volumes: { 'my-secrets': { target: '/home/node/.secrets' } },
        },
      }),
    );

    expect(message).toContain('уже занята');
    expect(message).toContain('secretsVolume');
  });

  it('точка стора занята — тот же отказ, другая настройка', async () => {
    const message = refusal(
      await materialize({
        presets: ['omnifield'],
        settings: {
          volumes: { 'my-store': { target: '/home/node/.pnpm-store' } },
        },
      }),
    );

    expect(message).toContain('pnpmStoreVolume');
  });

  it('два своих тома на одну точку — отказ говорит про порядок, а не про вкус', async () => {
    const message = refusal(
      await materialize({
        settings: {
          volumes: {
            'tasker-data': { target: '/data/tasker' },
            'tasker-data-old': { target: '/data/tasker' },
          },
        },
      }),
    );

    expect(message).toContain('объявлены на одну точку /data/tasker');
  });

  it('том поверх домашнего каталога целиком', async () => {
    const message = refusal(
      await materialize({
        settings: { volumes: { 'my-home': { target: '/home/node' } } },
      }),
    );

    expect(message).toContain('домашний каталог');
  });

  /**
   * ПРАВИЛО, ВЫВЕДЕННОЕ ИЗ СОБСТВЕННОЙ РЕГРЕССИИ, ТЕПЕРЬ ДЕРЖИТ ЛЮБОЙ ТОМ.
   *
   * `tasker:BASER2-115`: том стора смонтировали по адресу `~/.local/share/pnpm/store`,
   * докер создал цепочку каталогов до него от root, постсоздание выставило права
   * только на сам том — и `~/.local/share` достался root вместе со всеми соседями.
   * Лёг `uv`. README зоны обещал тогда: «третий том попадёт под то же правило, даже
   * если пробу под него не напишут». Вот проба.
   */
  it('в доме — только прямой ребёнок дома, и отказ называет цену чужого каталога', async () => {
    const message = refusal(
      await materialize({
        settings: {
          volumes: {
            'my-cache': { target: '/home/node/.local/share/thing' },
          },
        },
      }),
    );

    expect(message).toContain('ГЛУБЖЕ одного каталога');
    expect(message).toContain('tasker:BASER2-115');
    // Отказ не отправляет читать доку: он называет годный адрес.
    expect(message).toContain('/home/node/thing');
  });

  it('ВНЕ дома глубина законна: /data/tasker, /var/log/tasker, /opt/vendor', async () => {
    // Правило про ДОМ, а не про число сегментов. Вне дома цепочку от root создаёт
    // докер, и это нормальный вид такого каталога: рядом с `/data/tasker` никто не
    // ждёт права писать, в отличие от `~/.local/share`.
    const { json } = await materialize({
      settings: {
        volumes: {
          'tasker-data': { target: '/data/tasker' },
          'tasker-logs': { target: '/var/log/tasker' },
          'vendor-blobs': { target: '/opt/vendor' },
        },
      },
    });

    expect(targets(json)).toEqual([
      '/data/tasker',
      '/var/log/tasker',
      '/opt/vendor',
    ]);
  });

  it('дом СЧИТАЕТСЯ от imageUser: у чужого пользователя граница переезжает с ним', async () => {
    // Одна и та же точка законна у одного пользователя и запрещена у другого —
    // потому что правило про ДОМ, а дом считается от `imageUser` (единственный
    // источник всего домашнего, `image-user.spec.mjs`).
    const ok = await materialize({
      settings: {
        imageUser: 'vscode',
        volumes: { 'my-cache': { target: '/home/node/.local/share/thing' } },
      },
    });
    expect(ok.json.mounts).toEqual([
      'source=my-cache,target=/home/node/.local/share/thing,type=volume',
    ]);
    consumer.cleanup();
    consumer = null;

    const message = refusal(
      await materialize({
        settings: {
          imageUser: 'vscode',
          volumes: { 'my-cache': { target: '/home/vscode/.local/share/thing' } },
        },
      }),
    );
    expect(message).toContain('/home/vscode/thing');
  });
});
