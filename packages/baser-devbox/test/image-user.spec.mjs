/**
 * ОБРАЗ С ЧУЖИМ ПОЛЬЗОВАТЕЛЕМ — то, что настройка `image` обещала, но не умела.
 *
 * `tasker:BASER2-40`. Обвес давал настройку «поставь свой базовый образ», а
 * `remoteUser` был прибит к `node` — и вместе с ним всё, что от пользователя
 * считается: цели томов, `containerEnv`, `chown`, адрес npmrc в подсказке про
 * реестр. Обещание держалось ровно для образов, где пользователя зовут `node`.
 * У живого девбокса weber образ свой, а пользователь — `vscode`: тома и
 * переменные уехали бы в несуществующий домашний каталог, а `chown` упал бы.
 *
 * Половина настройки хуже её отсутствия (`kb:BASER2-2` §5), поэтому источник
 * стал один — настройка `imageUser`, от которой считается всё домашнее.
 *
 * ── ПОЧЕМУ ЭТИХ ПРОБ НЕ БЫЛО РАНЬШЕ ─────────────────────────────────────────
 *
 * Ни одна фикстура зоны этого показать не могла: у всех до единой пользователь
 * `node`, и прибитое значение совпадало с ожидаемым в каждой пробе. Дефект
 * нашёлся сверкой с ЧУЖИМ потребителем, а не прогоном — поэтому проба здесь
 * ставит именно чужого пользователя, а не ещё раз нашего.
 *
 * Краснота против кода ДО фикса снята и записана в README зоны.
 *
 * ── ГРАНИЦА, КОТОРУЮ ЭТИ ПРОБЫ ДЕРЖАТ ───────────────────────────────────────
 *
 * Домашний каталог считается ПО СОГЛАШЕНИЮ (`/root` у root, `/home/<имя>` у
 * остальных): обвес кладёт файл, а не запускает контейнер, и спросить образ ему
 * нечем, а цель тома обязана быть литералом. Соглашение проверяется обоими
 * концами — обычным пользователем и root, — чтобы «домашний каталог» не свёлся
 * молча к склейке `/home/` с именем.
 */

import { afterEach, describe, expect, it } from 'vitest';
// Обвес здесь один — прогон под него берётся `soleRun` двери, а не `runs[0]`:
// он бросает, если обвес не один (`tasker:BASER2-55`). Публичным входом зоны
// `cli`, как и `run` (`tasker:BASER2-59`).
import { renderText, soleRun } from '../../baser-cli/src/index.ts';
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

/**
 * Раскладка под ЧУЖОЙ образ — тот случай, ради которого настройка `image` и
 * заводилась: не наш `typescript-node`, и пользователь в нём не `node`.
 */
function foreignImage(settings = {}) {
  return tuning({
    presets: ['omnifield'],
    settings: {
      image: 'ghcr.io/omnifield/devbox',
      imageTag: 'v2026.07.10',
      imageUser: 'vscode',
      ...settings,
    },
  });
}

async function materialize(block, repoName = 'weber') {
  consumer = installConsumer({
    repoName,
    config: consumerConfig(),
    tuning: block,
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  expect(result.status, 'обвес не разложился').toBe('applied');
  const text = consumer.read(LIVE);
  return { result, text, json: parseJsonc(text) };
}

/** Все домашние каталоги, упомянутые в артефакте, — по одному разу. */
function homesIn(text) {
  return [...new Set(text.match(/\/(?:home\/[a-z0-9_.-]+|root)\b/g) ?? [])];
}

/**
 * Все адреса артефакта, посчитанные от домашнего каталога, — по одному разу.
 *
 * Отличается от `homesIn` тем, ради чего заводится: тот отвечает «сколько домов
 * в артефакте», этот — «какие адреса от дома считаются», то есть перечисляет
 * ровно то, что обязано переехать вместе с настройкой.
 *
 * Адрес обязан кончаться буквой или цифрой, и это не придирка к форме: в
 * артефакте он встречается и в тексте комментария, где за ним стоит точка конца
 * предложения. Без этого требования `/home/node/.secrets.` уехал бы в перечень
 * седьмым адресом, которого нет.
 */
function derivedPaths(text) {
  return [
    ...new Set(
      text.match(/\/home\/[a-z0-9_.-]*[a-z0-9](?:\/[a-z0-9_.-]*[a-z0-9])+/g) ??
        [],
    ),
  ].sort();
}

/**
 * Строка плана, в которой названо движение этого адреса, — одна и целиком.
 *
 * Ищется по СТАРОМУ значению, а не по стрелке: старое человек видит в
 * разложенном артефакте, и в плане он ищет именно его. Требование
 * единственности здесь несущее — два места, называющие один адрес по-разному,
 * это не полнота, а расхождение.
 */
function namedMove(text, from) {
  const lines = text.split('\n').filter((line) => line.includes(from));
  expect(lines, `план не назвал движение "${from}"`).toHaveLength(1);
  return lines[0].trim();
}

describe('образ с чужим пользователем раскладывается целиком', () => {
  it('девбокс работает ПОД НИМ, а не под нашим node', async () => {
    const { json } = await materialize(foreignImage());

    expect(json.image).toBe('ghcr.io/omnifield/devbox:v2026.07.10');
    expect(json.remoteUser).toBe('vscode');
  });

  it('тома, переменные и права считаются от НЕГО — все четыре места сразу', async () => {
    // Четыре места, а не одно: дефект был именно в том, что прибитых значений
    // несколько, и починить одно — значит оставить девбокс сломанным тремя
    // другими способами.
    const { json } = await materialize(foreignImage());

    expect(json.mounts).toEqual([
      'source=omnifield-secrets,target=/home/vscode/.secrets,type=volume',
      'source=omnifield-pnpm-store,target=/home/vscode/.pnpm-store,type=volume',
    ]);
    expect(json.containerEnv).toEqual({
      CLAUDE_CONFIG_DIR: '/home/vscode/.secrets/claude',
      GIT_CONFIG_GLOBAL: '/home/vscode/.secrets/gitconfig',
      GH_CONFIG_DIR: '/home/vscode/.secrets/gh',
      NPM_CONFIG_USERCONFIG: '/home/vscode/.secrets/npmrc',
      // Адрес стора считается от того же пользователя — иначе pnpm ушёл бы в
      // чужой дом, а том остался бы нетронутым уже по второй причине.
      NPM_CONFIG_STORE_DIR: '/home/vscode/.pnpm-store',
      PNPM_CONFIG_STORE_DIR: '/home/vscode/.pnpm-store',
    });
    // Права на том выставляются ПОЛЬЗОВАТЕЛЮ КОНТЕЙНЕРА: `node:node` здесь —
    // это `chown` на несуществующего пользователя, то есть падение постсоздания.
    expect(json.postCreateCommand).toContain(
      'sudo chown -R vscode:vscode /home/vscode/.secrets /home/vscode/.pnpm-store',
    );
  });

  it('ОДИН ИСТОЧНИК: в артефакте нет ни одного пути в чужой дом', async () => {
    // Утверждение сильнее перечисления мест: не «эти четыре починены», а «домов
    // в артефакте ровно один». Забытое пятое место всплывёт здесь, даже если
    // проба под него не написана.
    const { text } = await materialize(foreignImage());

    expect(homesIn(text)).toEqual(['/home/vscode']);
    expect(text).not.toContain('node:node');
  });

  it('подсказка про креды ведёт в дом ЭТОГО пользователя', async () => {
    // Обещание в тексте отказа — такой же контракт, как код: адрес, по которому
    // человек не найдёт своего npmrc, заводит в тупик ровно там, где отказ
    // затевался как указатель.
    const { text } = await materialize(
      foreignImage({ npmScope: '@omnifield' }),
    );

    expect(text).toContain('/home/vscode/.secrets/npmrc');
    expect(homesIn(text)).toEqual(['/home/vscode']);
  });

  it('второй прогон сходится — раскладка под чужим пользователем устойчива', async () => {
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
      tuning: foreignImage(),
    });
    await run({ command: 'apply', cwd: consumer.root });

    const again = await run({ command: 'apply', cwd: consumer.root });

    expect(again.status).toBe('converged');
    expect(soleRun(again).plan?.steps).toEqual([]);
  });
});

describe('домашний каталог — соглашение, названное обоими концами', () => {
  it('root живёт в /root, а не в /home/root', async () => {
    // Соглашение проверяется там, где наивная склейка `/home/` + имя даёт
    // каталог, которого в образе нет. Без этой пробы «дом считается» означало бы
    // «дом склеивается», и первый же root-образ приехал бы сломанным.
    const { json, text } = await materialize(
      foreignImage({ imageUser: 'root' }),
    );

    expect(json.remoteUser).toBe('root');
    expect(json.mounts).toEqual([
      'source=omnifield-secrets,target=/root/.secrets,type=volume',
      'source=omnifield-pnpm-store,target=/root/.pnpm-store,type=volume',
    ]);
    expect(json.containerEnv.NPM_CONFIG_USERCONFIG).toBe(
      '/root/.secrets/npmrc',
    );
    expect(json.postCreateCommand).toContain('sudo chown -R root:root /root/');
    expect(homesIn(text)).toEqual(['/root']);
  });
});

describe('не заполнил — ничего не поехало', () => {
  it('дефолт node, и домашние пути ровно те же, что были до настройки', async () => {
    // Оборотная сторона починки, и она несущая: вынос прибитого значения в
    // настройку обязан быть НЕ-ОПЕРАЦИЕЙ на дефолте. Разъехался бы артефакт —
    // разъехался бы и живой `.devcontainer` этого репозитория, то есть эталон
    // приёмки зоны, а он лежит в чужой зоне и правится не отсюда.
    const { json, text, result } = await materialize(
      tuning({ presets: ['omnifield'] }),
      'baser',
    );

    expect(json.remoteUser).toBe('node');
    expect(homesIn(text)).toEqual(['/home/node']);
    expect(json.postCreateCommand).toContain('sudo chown -R node:node');

    const user = soleRun(result).settings.find(
      (setting) => setting.key === 'imageUser',
    );
    expect(user.value).toBe('node');
    expect(user.ours).toBe(true);
    expect(user.origin.kind).toBe('default');
  });

  it('пользователь образа НЕ в пресете omnifield', async () => {
    // Пресет — ходовое положение регулировок раскладки omnifield, а пользователь
    // — свойство ВЫБРАННОГО ОБРАЗА. Уехал бы в пресет — включение раскладки
    // omnifield молча переопределяло бы образ, к которому она отношения не имеет.
    const { json } = await materialize(
      tuning({ settings: { image: 'ghcr.io/omnifield/devbox' } }),
    );

    expect(json.remoteUser).toBe('node');
  });
});

describe('ПЕРЕЕЗД ТОМОВ при смене пользователя — что дверь про него говорит', () => {
  it('план называет адреса томов, посчитанные от imageUser, ДО применения', async () => {
    // Смена пользователя меняет цели томов: тот же `omnifield-secrets`
    // монтируется по новому адресу, и всё, что человек клал по старому, в
    // контейнере окажется не там, где его ищут переменные.
    consumer = installConsumer({
      repoName: 'weber',
      config: consumerConfig(),
      tuning: tuning({ presets: ['omnifield'] }),
    });
    await run({ command: 'apply', cwd: consumer.root });
    const before = consumer.read(LIVE);
    expect(before).toContain('/home/node/.secrets');

    // Значение меняется ТАМ, ГДЕ ЕГО ЗАПОЛНЯЕТ ЧЕЛОВЕК, — в файле настроек
    // обвеса, а не в перечне поставленного (`tasker:BASER2-10` §3).
    consumer.tune(foreignImage());
    const plan = await run({ command: 'plan', cwd: consumer.root });
    const text = renderText(plan);

    expect(soleRun(plan).plan?.steps[0].reason).toBe('diverged');
    // Названо — и не применено.
    expect(consumer.read(LIVE)).toContain('/home/node/.secrets');

    // ── УТВЕРЖДЕНИЕ, А НЕ НАХОДКА ──────────────────────────────────────────
    //
    // Здесь стояла находка: дверь называла движение САМОЙ НАСТРОЙКИ
    // (`imageUser "node" → "vscode"`, `tasker:BASER2-38`), но не то, что от неё
    // считается, — и проба обещала покраснеть, когда дверь научится. Дверь
    // научилась (`tasker:BASER2-98`): отдельным блоком плана — «вместе с ними
    // переедет ПОСЧИТАННОЕ от них» — назван старый и новый адрес каждого
    // производного места, и каждый в связке с настройкой-источником. Проба
    // покраснела ровно там, где обещала, и перевёрнута в утверждение.
    //
    // Утверждается то, ради чего находка заводилась: тома `omnifield-secrets`
    // и `omnifield-pnpm-store` монтируются по новому адресу, значит всё, что
    // человек клал по старому, окажется не там, где ищут переменные. Решать
    // это ему ДО применения — потому проверяется текст плана, а не артефакт.
    const secrets = namedMove(
      text,
      'source=omnifield-secrets,target=/home/node/.secrets,type=volume',
    );
    expect(secrets).toContain('imageUser');
    expect(secrets).toContain(
      '→ source=omnifield-secrets,target=/home/vscode/.secrets,type=volume',
    );

    const store = namedMove(
      text,
      'source=omnifield-pnpm-store,target=/home/node/.pnpm-store,type=volume',
    );
    expect(store).toContain('imageUser');
    expect(store).toContain(
      '→ source=omnifield-pnpm-store,target=/home/vscode/.pnpm-store,type=volume',
    );

    // Полнота держится не перечнем мест, а сверкой с РАЗЛОЖЕННЫМ артефактом:
    // каждый лежащий в нём домашний адрес обязан быть назван вместе со своей
    // новой формой. Появится седьмое производное место — проба покраснеет,
    // даже если отдельной строки под него никто не написал.
    const derived = derivedPaths(before);
    // Список назван вслух не ради дубля: без него цикл ниже зеленел бы на
    // пустом перечне, то есть молчал бы ровно в том случае, который проверяет.
    expect(derived).toEqual([
      '/home/node/.pnpm-store',
      '/home/node/.secrets',
      '/home/node/.secrets/claude',
      '/home/node/.secrets/gh',
      '/home/node/.secrets/gitconfig',
      '/home/node/.secrets/npmrc',
    ]);
    for (const path of derived) {
      expect(text, `план не назвал переезд ${path}`).toContain(
        `${path} → ${path.replace('/home/node', '/home/vscode')}`,
      );
    }

    await run({ command: 'apply', cwd: consumer.root });
    expect(consumer.read(LIVE)).toContain('/home/vscode/.secrets');
    expect(consumer.read(LIVE)).not.toContain('/home/node');
  });
});
