import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { verdaccioBin, verdaccioConfig } from './verdaccio.js';

const layout = shopLayout('/локация');

function built(settings = DEFAULT_SETTINGS) {
  const text = verdaccioConfig(settings, layout, '/локация/лог.log');
  return { text, config: parse(text) as Record<string, never> };
}

describe('конфиг раздачи собирается целиком из настроек', () => {
  it('склад — абсолютный путь: процесс стартует с чужим рабочим каталогом', () => {
    // Относительный путь означал бы товар, разложенный там, откуда позвали
    // команду, — а зовут её откуда угодно.
    expect(built().config['storage']).toBe(layout.storage);
    expect(built().config['log']).toMatchObject({ path: '/локация/лог.log' });
  });

  it('апстрим берётся из настроек человека и кэшируется', () => {
    const { config } = built({ ...DEFAULT_SETTINGS, uplink: 'https://свой/' });

    expect(config['uplinks']).toEqual({
      upstream: { url: 'https://свой/', cache: true },
    });
  });

  it('наш скоуп назван отдельным правилом — и раньше общего', () => {
    // Общее правило его и так покрывает; правило читается человеком, и «наши
    // пакеты ходят через свой магазин» должно быть видно, а не выводиться из
    // порядка масок.
    const names = Object.keys(built().config['packages']);

    expect(names).toEqual(['@omnifield/*', '**']);
  });

  it('всё идёт через апстрим — прокси, а не второй реестр рядом', () => {
    const packages = built().config['packages'] as Record<
      string,
      { proxy: string }
    >;

    for (const rule of Object.values(packages)) {
      expect(rule.proxy).toBe('upstream');
    }
  });

  it('публикация работает и без связи с миром', () => {
    expect(built().config['publish']).toMatchObject({ allow_offline: true });
  });

  it('файл говорит, что он наш и что правки в нём исчезнут', () => {
    // Артефакт перезаписывается на каждом `up`. Человек, открывший его, обязан
    // узнать об этом из файла, а не из пропавшей правки.
    const { text } = built();

    expect(text).toContain('СОБРАН МАГАЗИНОМ');
    expect(text).toContain('.baser-registry/config.yml');
  });

  it('две сборки одних настроек дают один байт в байт файл', () => {
    // Иначе «перезаписывается целиком» превратилось бы в бесконечную правку.
    expect(built().text).toBe(built().text);
  });
});

describe('исполняемый файл раздачи', () => {
  it('резолвится от нашего пакета, а не от каталога локации', () => {
    // Магазин ставится глобально и работает в чужих деревьях, где своего
    // node_modules нет и быть не должно.
    expect(verdaccioBin()).toMatch(/verdaccio/);
  });
});
