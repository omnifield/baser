import { describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { HOME_VARIABLE } from './location.js';
import { ShopProblemLog } from './problems.js';
import {
  DEFAULT_SETTINGS,
  clientAddress,
  listenAddress,
  logPath,
  reachOf,
  readSettings,
  settingsTemplate,
} from './settings.js';

const AT = 'config.yml';

function read(text: string | null) {
  const problems = new ShopProblemLog();
  const settings = readSettings(text, AT, problems);
  return { settings, problems: problems.list() };
}

describe('файл человека читается, а не заполняется', () => {
  it('файла нет — работают дефолты, и это не отказ', () => {
    const { settings, problems } = read(null);

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(problems).toEqual([]);
  });

  it('файл пуст — тоже дефолты: ровно таким он и рождается', () => {
    const { settings, problems } = read('# только комментарии\n');

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(problems).toEqual([]);
  });

  it('заполненное значение берётся как есть, незаполненное — дефолтом', () => {
    const { settings, problems } = read('port: 4900\n');

    expect(settings.port).toBe(4900);
    expect(settings.host).toBe(DEFAULT_SETTINGS.host);
    expect(settings.uplink).toBe(DEFAULT_SETTINGS.uplink);
    expect(problems).toEqual([]);
  });
});

describe('рождённый файл — это дефолты, а не выбор человека', () => {
  it('шаблон разбирается обратно в ровно дефолты и без единого отказа', () => {
    // Главная проба этого файла. Шаблон рождается с ЗАКОММЕНТИРОВАННЫМИ
    // значениями, и если хоть одно окажется раскомментированным, человек
    // получит замороженный дефолт, не выбрав его: инструмент поднимет свой
    // номер, а у человека навсегда останется вчерашний.
    const { settings, problems } = read(settingsTemplate());

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(problems).toEqual([]);
  });

  it('в шаблоне названа каждая настройка — иначе её не найти', () => {
    const template = settingsTemplate();

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(template).toContain(`# ${key}:`);
    }
  });
});

describe('непригодное названо кодом, а не молчанием', () => {
  it('не YAML — config-unreadable, дальше работают дефолты', () => {
    const { settings, problems } = read('port: [не закрыт\n');

    expect(problems.map((one) => one.code)).toEqual(['config-unreadable']);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('YAML есть, а ключей нет — config-not-mapping', () => {
    const { problems } = read('- 4873\n');

    expect(problems.map((one) => one.code)).toEqual(['config-not-mapping']);
  });

  it('опечатка в имени настройки названа вслух, а не проглочена дефолтом', () => {
    const { settings, problems } = read('ports: 4900\n');

    expect(problems).toEqual([
      {
        code: 'setting-unknown',
        at: `${AT}#ports`,
        message: expect.stringContaining('ports'),
      },
    ]);
    // И порт при этом остался дефолтным — человек обязан узнать, почему.
    expect(settings.port).toBe(DEFAULT_SETTINGS.port);
  });

  it('порт не числом — setting-type', () => {
    const { settings, problems } = read('port: "4900"\n');

    expect(problems.map((one) => one.code)).toEqual(['setting-type']);
    expect(settings.port).toBe(DEFAULT_SETTINGS.port);
  });

  it('порт за пределами TCP — port-out-of-range', () => {
    expect(read('port: 0\n').problems.map((one) => one.code)).toEqual([
      'port-out-of-range',
    ]);
    expect(read('port: 70000\n').problems.map((one) => one.code)).toEqual([
      'port-out-of-range',
    ]);
  });

  it('апстрим без схемы — setting-type: иначе это всплыло бы установкой', () => {
    const { settings, problems } = read('uplink: registry.npmjs.org\n');

    expect(problems.map((one) => one.code)).toEqual(['setting-type']);
    expect(settings.uplink).toBe(DEFAULT_SETTINGS.uplink);
  });

  it('отказы копятся: все опечатки за один прогон, а не по одной за запуск', () => {
    const { problems } = read('port: "нет"\nhost: 5\nлишний: 1\n');

    expect(problems.map((one) => one.code).sort()).toEqual([
      'setting-type',
      'setting-type',
      'setting-unknown',
    ]);
  });
});

describe('магазин по умолчанию отвечает соседям по сети локации', () => {
  it('дефолтом слушается вся сеть локации, а не петля', () => {
    // Магазин существует ради одной работы — отдать товар соседу. Дефолт
    // 127.0.0.1 запирал раздачу в петле, и из коробки инструмент этой работы не
    // делал (tasker:BASER2-266 — потребитель отложил переезд, -267 — решение).
    // Проба стоит здесь, чтобы возврат к петле был красным, а не незамеченным.
    expect(DEFAULT_SETTINGS.host).toBe('0.0.0.0');
    expect(listenAddress(DEFAULT_SETTINGS)).toBe('0.0.0.0:4873');
    expect(reachOf(DEFAULT_SETTINGS)).toBe('network');
  });

  it('запереться в петле можно — но это выбор человека, а не наш', () => {
    const { settings, problems } = read('host: 127.0.0.1\n');

    expect(settings.host).toBe('127.0.0.1');
    expect(reachOf(settings)).toBe('self-only');
    expect(problems).toEqual([]);
  });
});

describe('видимость названа данными, а адрес соседа не выдумывается', () => {
  it('петля во всех её видах — это self-only', () => {
    // Петля — сеть 127.0.0.0/8, а не один адрес, и `localhost` человек пишет
    // чаще, чем цифры. Ответить на них «сосед придёт» значило бы соврать.
    for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]']) {
      expect(reachOf({ ...DEFAULT_SETTINGS, host }), host).toBe('self-only');
    }
  });

  it('всё остальное — network: сосед придёт, если знает имя локации', () => {
    for (const host of ['0.0.0.0', '::', '172.18.0.5', 'eth0.локация']) {
      expect(reachOf({ ...DEFAULT_SETTINGS, host }), host).toBe('network');
    }
  });

  it('адрес назначения от видимости не зависит — это разные вопросы', () => {
    // `reach` отвечает соседу, `clientAddress` — хозяину локации. Слить их
    // нельзя: по 0.0.0.0 ходить некуда, а сосед по 127.0.0.1 не придёт.
    const open = { ...DEFAULT_SETTINGS, host: '0.0.0.0' };

    expect(reachOf(open)).toBe('network');
    expect(clientAddress(open)).toBe('http://127.0.0.1:4873');
  });
});

describe('лог — настройка, и путь у него от корня магазина', () => {
  it('дефолт лога совпадает с раскладкой магазина', () => {
    // Два места про один факт разъезжаются молча; здесь они сверены.
    const layout = shopLayout({ [HOME_VARIABLE]: '/участок/магазин' });

    expect(logPath(DEFAULT_SETTINGS, layout.home.path)).toBe(layout.log);
  });

  it('относительный путь считается от корня МАГАЗИНА, а не от постройки', () => {
    // Лог принадлежит раздаче, а раздача — вещь локации: класть её след внутрь
    // клона, из которого её сегодня позвали, неверно по уровню.
    expect(
      logPath({ ...DEFAULT_SETTINGS, log: 'свой.log' }, '/участок/магазин'),
    ).toBe('/участок/магазин/свой.log');
  });

  it('абсолютный путь берётся как есть', () => {
    expect(
      logPath(
        { ...DEFAULT_SETTINGS, log: '/var/log/магазин.log' },
        '/участок/магазин',
      ),
    ).toBe('/var/log/магазин.log');
  });
});

describe('адрес назначения — не то же, что слушаемый интерфейс', () => {
  it('на всех интерфейсах ходить некуда — адресом становится петлевой', () => {
    expect(clientAddress({ ...DEFAULT_SETTINGS, host: '0.0.0.0' })).toBe(
      'http://127.0.0.1:4873',
    );
  });

  it('конкретный интерфейс остаётся собой', () => {
    expect(
      clientAddress({ ...DEFAULT_SETTINGS, host: '127.0.0.1', port: 4900 }),
    ).toBe('http://127.0.0.1:4900');
  });

  it('слушаемый адрес отдаётся процессу как есть, каким его задали', () => {
    expect(listenAddress({ ...DEFAULT_SETTINGS, host: '0.0.0.0' })).toBe(
      '0.0.0.0:4873',
    );
  });
});
