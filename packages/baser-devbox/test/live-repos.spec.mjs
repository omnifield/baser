/**
 * ПРИЁМКА НА ЖИВЫХ ЧУЖИХ РЕПОЗИТОРИЯХ: `omnifield/tasker` и `omnifield/knowledger`.
 *
 * Три механики этого захода (`tasker:BASER2-80`, `-81`, `-82`) заведены не «чтобы
 * было полнее», а под конкретный факт: **пока их нет, эти два репозитория не могут
 * переехать на обвес физически** — их `.devcontainer` выражает то, чего шаблон не
 * умеет сказать. Значит и приёмка задаётся фактом, а не описанием: берём ИХ файлы
 * как эталон и показываем, что материализация даёт равнозначный результат.
 *
 * ── ПОЧЕМУ НЕ СВЕРКА БАЙТ В БАЙТ, КАК С НАШИМ СОБСТВЕННЫМ ФАЙЛОМ ────────────
 *
 * Наш `.devcontainer` кладёт станок, поэтому с ним сверка побайтовая и список
 * расхождений пуст (`acceptance.spec.mjs`). Эти два — **девопсер-legacy, писанный
 * руками**: свой образ, своя проверка GH Packages, свои скрипты подъёма сервисов.
 * Требовать побайтового совпадения с ними значило бы требовать от обвеса
 * воспроизводить то, от чего он сознательно ушёл (kb:ADR-20, гринфилд на
 * стандартном Dev Containers).
 *
 * Поэтому утверждение точнее и проверяется целиком, тремя корзинами:
 *
 * | корзина          | что значит                                                |
 * | ---------------- | --------------------------------------------------------- |
 * | СОВПАЛО          | ключ равен эталону как есть                               |
 * | РАВНОЗНАЧНО      | равен после НАЗВАННОЙ нормализации (наш адрес стора и т.п.) |
 * | РАСХОДИТСЯ       | не равен — и у каждого расхождения названа причина          |
 *
 * Состав каждой корзины проверяется СПИСКОМ. Новое расхождение, которого никто не
 * назвал, не спрячется в «примерно совпадает»: оно упадёт третьей корзиной и
 * потребует либо починки, либо строки с причиной. Ровно это ТЗ и просило —
 * «чего не хватает, видно, а не обсуждается».
 *
 * Сами репозитории мы НЕ ПРАВИМ: чужие продукты, переезжают отдельной работой.
 * Здесь они только вход (`test/live/README.md` — что снято, когда и чем обновить).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consumerConfig,
  installConsumer,
  LIVE,
  parseJsonc,
  run,
  tuning,
} from './packed.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Эталон как его видит гитхаб — снимок, а не запрос по сети (см. live/README.md). */
function reference(repo) {
  return JSON.parse(
    readFileSync(join(here, 'live', `${repo}.devcontainer.json`), 'utf-8'),
  );
}

/** Объявление сервисов живого репозитория — снимок его `devbox.services.json`. */
function services(repo) {
  return JSON.parse(
    readFileSync(join(here, 'live', `${repo}.services.json`), 'utf-8'),
  );
}

/**
 * КАРТА ПРОЦЕССОВ ЛОКАЦИИ, ВЫВЕДЕННАЯ ИЗ ЕЁ ЖЕ ФАЙЛОВ (`tasker:BASER2-196`).
 *
 * Написать эти три строки руками было бы легко и бесполезно: проба доказывала
 * бы, что обвес кладёт то, что мы в неё вписали. Поэтому каждая выведена из
 * снимка чужого файла, и связь названа:
 *
 * - `publish` — работа их `scripts/devbox-publish.mjs`: копия `omnifield.yaml`
 *   в общий том реестра. Обвес манифест НЕ РАЗБИРАЕТ — что внутри, контракт
 *   двери, а не наш (`kb:BASER3-32`);
 * - остальные — записи их `devbox.services.json`, имя в имя и команда в
 *   команду.
 *
 * ── КАТАЛОГ ВХОДИТ В КОМАНДУ, ПОТОМУ ЧТО `cwd` У ФОРМЫ НЕТ ──────────────────
 *
 * Их раннер запускал сервис в объявленном `cwd`; объектная форма команд
 * выполняет всё из корня воркспейса и своего `cwd` не знает. Значит каталог
 * переезжает В САМУ КОМАНДУ. Общего правила для этого нет и быть не может —
 * каждый инструмент указывает каталог по-своему, — поэтому здесь оно НЕ
 * изобретается: разобран ровно тот случай, что есть у обоих живых
 * репозиториев (`pnpm -C`), а любой другой роняет пробу вслух вместо тихого
 * неверного вывода.
 */
function processes(repo) {
  const map = { publish: `cp omnifield.yaml /omnifield-registry/${repo}.yaml` };
  for (const { name, cwd, command } of services(repo)) {
    if (cwd === '.') {
      map[name] = command;
      continue;
    }
    if (!command.startsWith('pnpm ')) {
      throw new Error(
        `сервис ${name} репозитория ${repo} запускается из каталога ${cwd} командой ` +
          `"${command}", а как назвать каталог этому инструменту, проба не знает. ` +
          'Объектная форма своего cwd не имеет — каталог обязан войти в команду, ' +
          'и правило для него называет человек, а не догадка пробы',
      );
    }
    map[name] = `pnpm -C ${cwd} ${command.slice('pnpm '.length)}`;
  }
  return map;
}

/**
 * Настройки, которыми ИХ раскладка выражается у нас.
 *
 * Ни одной строки шаблона под них не правится — в этом всё утверждение. Значения
 * взяты из их же файла: образ, пользователь, тома, команды.
 */
const PROFILES = {
  tasker: {
    name: 'omnifield-devbox',
    image: 'ghcr.io/omnifield/devbox',
    imageTag: 'v2026.07.10',
    imageUser: 'vscode',
    // Образ у них свой и толстый — тулчейн в нём уже есть, фичи не нужны.
    // Пустая карта это «фич нет вовсе», сказанное значением.
    devcontainerFeatures: {},
    network: 'omnifield-gateway',
    secretsVolume: 'omnifield-secrets',
    pnpmStoreVolume: 'omnifield-pnpm-store',
    // Вот они, «свои тома»: до этого захода выразить их было нечем.
    volumes: {
      'omnifield-registry': { target: '/omnifield-registry' },
      'tasker-data': { target: '/data/tasker' },
    },
    npmScope: '@omnifield',
    installAssistant: true,
    editorExtensions: [],
    editorFormatter: null,
    installCommand:
      '{ [ -f package.json ] && pnpm install || { [ -f web/package.json ] && pnpm -C web install --frozen-lockfile; } || echo "no pnpm workspace — skip"; }',
    // Не строка со своими скриптами, а КАРТА процессов, выведенная из их же
    // файлов (`tasker:BASER2-196`, решение `kb:BASER3-32`).
    startCommand: processes('tasker'),
  },
  knowledger: {
    name: 'omnifield-devbox',
    image: 'ghcr.io/omnifield/devbox',
    imageTag: 'v2026.07.10',
    imageUser: 'vscode',
    devcontainerFeatures: {},
    network: 'omnifield-gateway',
    secretsVolume: 'omnifield-secrets',
    pnpmStoreVolume: 'omnifield-pnpm-store',
    volumes: {
      'omnifield-registry': { target: '/omnifield-registry' },
      'knowledger-data': { target: '/data/knowledger' },
    },
    npmScope: '@omnifield',
    installAssistant: true,
    editorExtensions: ['biomejs.biome'],
    editorFormatter: 'biomejs.biome',
    startCommand: processes('knowledger'),
  },
};

/**
 * НОРМАЛИЗАЦИИ — то, что мы вправе не воспроизводить, названное поимённо.
 *
 * Каждая снимается с ОБЕИХ сторон и каждая — уже принятое решение зоны, а не
 * поблажка, придуманная ради зелёного теста.
 */
const NORMALIZE = {
  /**
   * Адрес тома стора у нас СВОЙ (`~/.pnpm-store`), и это починка нашей же
   * регрессии: их адрес — `~/.local/share/pnpm/store`, то есть внутрь общего
   * XDG-каталога, чью цепочку докер создаёт от root (`tasker:BASER2-115`).
   * Воспроизвести его значило бы вернуть поломку соседей по `~/.local/share`.
   */
  mounts: (list, home) =>
    list
      .map((mount) =>
        mount.startsWith('source=omnifield-pnpm-store,')
          ? `source=omnifield-pnpm-store,target=${home}/.pnpm-store,type=volume`
          : mount,
      )
      // Порядок монтирований докеру безразличен — это список, а не
      // последовательность шагов. Спорить о нём значило бы записать в
      // расхождения то, что ничего не значит.
      .slice()
      .sort(),
  /** Адрес стора двумя именами — та же починка, вид сбоку (`tasker:BASER2-111`). */
  containerEnv: (env) =>
    Object.fromEntries(
      Object.entries(env).filter(([key]) => !key.endsWith('_STORE_DIR')),
    ),
  /**
   * Универсальный слой обвеса: хост виден изнутри и контейнер переживает рестарт
   * демона. Оба инварианта наши и стоят в ЛЮБОЙ раскладке (`layers.spec.mjs`),
   * поэтому снимаются с обеих сторон: у tasker `--add-host` есть, у knowledger
   * нет, а спор здесь не про него.
   */
  runArgs: (args) =>
    args.filter(
      (arg) =>
        arg !== '--restart=unless-stopped' &&
        arg !== '--add-host=host.docker.internal:host-gateway',
    ),
};

/** Расхождения, названные по существу. Ключ артефакта → почему он расходится. */
const DIVERGES = {
  onCreateCommand:
    'у них его нет вовсе: пин pnpm через corepack и глобальный ассистент лежат ' +
    'внутри их собственного образа. У нас это шаг обвеса, потому что образ upstream',
  postCreateCommand:
    'та же работа, наши механики: названные потери тулчейна, наша проверка реестра ' +
    '(pnpm, а не npm) вместо их проверки GH Packages, и без их `mkdir -p` — точку ' +
    'монтирования докер создаёт сам. Права на ВСЕ их тома при этом выставляются, ' +
    'и это проверяется отдельно',
  postStartCommand:
    'предмет `tasker:BASER2-196`: у них ещё СТРОКА, зовущая пару собственных скриптов ' +
    '(`devbox-publish.mjs` + `devbox-services.mjs up`), у нас — объектная форма ' +
    'именованных команд, выведенных из их же файлов. Совпадение здесь означало бы, ' +
    'что раннер остался в репозитории, то есть что решение `kb:BASER3-32` не исполнено',
  customizations:
    'сквозного проброса настроек редактора у обвеса нет намеренно (закрытый набор ' +
    'ключей, `layers.spec.mjs`). У knowledger в них форматтер, расписанный по шести ' +
    'языкам, и `codeActionsOnSave`; выражается общий форматтер, остальное — нет',
};

let consumer = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/** Раскладывает обвес под профиль живого репозитория и отдаёт артефакт. */
async function materialize(repo) {
  consumer = installConsumer({
    repoName: repo,
    config: consumerConfig(),
    tuning: tuning({ settings: PROFILES[repo] }),
  });
  const result = await run({ command: 'apply', cwd: consumer.root });
  if (result.status !== 'applied') {
    throw new Error(
      `обвес не разложился под ${repo}: ${result.status}\n${JSON.stringify(result.problems, null, 2)}`,
    );
  }
  return parseJsonc(consumer.read(LIVE));
}

/**
 * Сериализация, не считающая расхождением ПОРЯДОК КЛЮЧЕЙ в объекте.
 *
 * Порядок ключей в JSON ничего не значит ни для докера, ни для инструмента
 * девконтейнеров: `containerEnv`, перечисленный в другом порядке, — тот же
 * `containerEnv`. Оставь мы обычный `JSON.stringify`, сводка кричала бы о разнице,
 * которой нет, и это ровно тот шум, из-за которого перестают читать отчёт.
 * Порядок ЭЛЕМЕНТОВ СПИСКА при этом сохраняется: у `runArgs` он значим.
 */
function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Ключи, которыми артефакт расходится с эталоном ПОСЛЕ названных нормализаций. */
function compare(ours, live, home) {
  const keys = [...new Set([...Object.keys(live), ...Object.keys(ours)])].sort();
  const same = [];
  const equivalent = [];
  const diverging = [];

  for (const key of keys) {
    if (stable(ours[key]) === stable(live[key])) {
      same.push(key);
      continue;
    }
    const normalize = NORMALIZE[key];
    if (
      normalize !== undefined &&
      stable(normalize(ours[key], home)) === stable(normalize(live[key], home))
    ) {
      equivalent.push(key);
      continue;
    }
    diverging.push(key);
  }
  return { same, equivalent, diverging };
}

describe.each(['tasker', 'knowledger'])('живой %s выражается настройками', (repo) => {
  const home = '/home/vscode';

  it('ТОМА: их список выражен целиком, и каждый — с владением точкой', async () => {
    const ours = await materialize(repo);
    const live = reference(repo);

    // Первое утверждение задачи `BASER2-80`: произвольный список томов, а не две
    // прибитые настройки. У обоих репозиториев томов четыре, и два из них —
    // `omnifield-registry` и данные продукта — до этого захода были невыразимы.
    expect(ours.mounts.slice().sort()).toEqual(
      NORMALIZE.mounts(live.mounts, home).slice().sort(),
    );

    // Второе, и оно про причину, а не про следствие: `chown` собирается ИЗ ТОГО ЖЕ
    // объявления. Значит забыть права на объявленный том нельзя — не потому, что
    // мы внимательные, а потому, что списка, который можно забыть, нет.
    const targets = ours.mounts.map(
      (mount) => mount.split(',')[1].slice('target='.length),
    );
    for (const target of targets) {
      expect(
        ours.postCreateCommand,
        `права на ${target} не выставлены`,
      ).toContain(target);
    }
    expect(ours.postCreateCommand).toContain(
      `sudo chown -R vscode:vscode ${targets.join(' ')}`,
    );
  });

  it('СЕТЬ: создание до старта — строка в строку с их файлом', async () => {
    const ours = await materialize(repo);

    // `BASER2-81`. Совпадение здесь буквальное, и это не совпадение: их строка и
    // была образцом — три продукта пришли к ней сами, каждый своей правкой.
    expect(ours.initializeCommand).toBe(reference(repo).initializeCommand);
    expect(ours.initializeCommand).toBe(
      'docker network create omnifield-gateway 2>/dev/null || true',
    );
  });

  it('ПОСЛЕ СТАРТА: их строка выражается КАРТОЙ, и раннер из репозитория уходит', async () => {
    const ours = await materialize(repo);
    const live = reference(repo);

    // `BASER2-82` дал ТОЧКУ, `BASER2-196` — механику подъёма. Эталон держит ровно
    // ту строку, ради которой задача и заведена: пара их собственных скриптов.
    expect(live.postStartCommand).toBe(
      'node scripts/devbox-publish.mjs; node scripts/devbox-services.mjs up',
    );

    // А у нас — объектная форма именованных команд, и ни одна не уходит в
    // `scripts/` репозитория. Это и есть «продукт не носит раннер в себе».
    expect(ours.postStartCommand).toEqual(processes(repo));
    for (const [name, command] of Object.entries(ours.postStartCommand)) {
      expect(command, `команда ${name} всё ещё зовёт скрипт локации`).not.toContain(
        'scripts/',
      );
    }

    // Ни один их сервис по дороге не потерялся — проверяется по ИХ объявлению,
    // а не по числу ключей у нас.
    for (const { name } of services(repo)) {
      expect(ours.postStartCommand[name], `сервис ${name} потерялся`).toBeTruthy();
    }

    // Публикация кладёт манифест в ТОТ ЖЕ том, что смонтирован этим же артефактом:
    // «копирование объявленного файла в объявленное место» (`kb:BASER3-32`).
    // Разойдись адрес с монтированием — публикация писала бы в пустоту, и заметил
    // бы это тот, кто ищет продукт за дверью.
    const registry = ours.mounts.find((mount) =>
      mount.startsWith('source=omnifield-registry,'),
    );
    const target = registry.split(',')[1].slice('target='.length);
    expect(ours.postStartCommand.publish).toContain(`${target}/${repo}.yaml`);
  });

  it('ЧЕГО ФОРМА НЕ ДАЁТ — названо и замерено: проб готовности в ней нет', async () => {
    const ours = await materialize(repo);
    const declared = services(repo);

    // Их раннер — самодельный `process-compose`: у каждого сервиса объявлены
    // `healthUrl` и таймаут, то есть http_get-проба готовности (`kb:BASER3-32`).
    for (const service of declared) {
      expect(service.healthUrl).toBeTruthy();
      expect(service.probeTimeoutMs).toBeGreaterThan(0);
    }

    // Объектная форма их не выражает — и обвес НЕ ИЗОБРАЖАЕТ, будто выражает.
    // Половина имитации хуже её отсутствия (`kb:BASER2-2` §5): потеря названа в
    // доке и здесь, а понадобится готовность — это фича девконтейнера, а не наш
    // код и не наша зависимость.
    const text = JSON.stringify(ours.postStartCommand);
    for (const service of declared) {
      expect(text, 'адрес пробы готовности просочился в артефакт').not.toContain(
        service.healthUrl,
      );
    }
  });

  it('СВОДКА: что совпало, что равнозначно, что расходится — списком', async () => {
    const ours = await materialize(repo);
    const { same, equivalent, diverging } = compare(ours, reference(repo), home);

    // Раскладка целиком — в первых двух корзинах. Тома, сеть, имя, образ,
    // пользователь, секрет-модель: ни одной ручной правки `.devcontainer`.
    // Точка «после старта» уехала в третью корзину намеренно и с причиной:
    // совпасть с их строкой значило бы оставить раннер в репозитории
    // (`tasker:BASER2-196`).
    expect(same).toContain('initializeCommand');
    expect(same).toContain('image');
    expect(same).toContain('remoteUser');
    expect(same).toContain('name');
    expect(equivalent.slice().sort()).toEqual(
      ['containerEnv', 'mounts', 'runArgs'].sort(),
    );

    // А вот здесь и живёт «чего не хватает — видно»: список закрытый, и у каждой
    // строки в нём есть причина. Появится новое расхождение — упадёт ровно тут.
    expect(diverging.slice().sort()).toEqual(Object.keys(DIVERGES).sort());
    for (const key of diverging) {
      expect(DIVERGES[key], `расхождение ${key} никем не названо`).toBeTruthy();
    }
  });

  it('ПРАВА на их тома выставляются все до одной — включая те, что вне дома', async () => {
    const ours = await materialize(repo);
    const live = reference(repo);

    // Их `postCreateCommand` chown'ит четыре точки тремя командами (одна из них
    // ещё и с лишним `mkdir`). У нас это одна команда, собранная из объявлений, —
    // и вот проверка, что ни одна точка по дороге не потерялась.
    for (const mount of live.mounts) {
      const target = mount.split(',')[1].slice('target='.length);
      const expected =
        target === `${home}/.local/share/pnpm/store`
          ? `${home}/.pnpm-store`
          : target;
      expect(ours.postCreateCommand, `${expected} без прав`).toContain(expected);
    }
  });
});

describe('ТА ЖЕ раскладка без ручной правки: два продукта, один шаблон', () => {
  it('различия между tasker и knowledger — ТОЛЬКО значения настроек', async () => {
    const tasker = await materialize('tasker');
    consumer.cleanup();
    consumer = null;
    const knowledger = await materialize('knowledger');

    // Универсальное и пресетное у них совпадает; расходится ровно то, что человек
    // и заполнял: алиас в сети, свой том данных, свой форматтер.
    expect(tasker.initializeCommand).toBe(knowledger.initializeCommand);
    expect(tasker.containerEnv).toEqual(knowledger.containerEnv);
    expect(tasker.runArgs).toContain('--network-alias=tasker');
    expect(knowledger.runArgs).toContain('--network-alias=knowledger');
    expect(tasker.mounts).toContain(
      'source=tasker-data,target=/data/tasker,type=volume',
    );
    expect(knowledger.mounts).toContain(
      'source=knowledger-data,target=/data/knowledger,type=volume',
    );
    // Общий том реестра у обоих один и тот же — и это тот самый случай «том на
    // три продукта», ради которого список и заводился.
    expect(tasker.mounts).toContain(
      'source=omnifield-registry,target=/omnifield-registry,type=volume',
    );
    expect(knowledger.mounts).toContain(
      'source=omnifield-registry,target=/omnifield-registry,type=volume',
    );
  });
});
