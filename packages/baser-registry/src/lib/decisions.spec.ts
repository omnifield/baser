/**
 * ОРГАН РЕШЕНИЯ ЧИТАЕТСЯ, А НЕ ЗАПОЛНЯЕТСЯ.
 *
 * Пробы здесь про разбор: диска они не трогают, текст приходит строкой. Живая
 * отгрузка объявленной партии проверяется исполнением — в `acceptance.spec.ts`,
 * потому что «файл разобрался» и «товар уехал» это разные утверждения.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECISIONS,
  LOCATION,
  readDecisions,
  registerOf,
} from './decisions.js';
import { ShopProblemLog } from './problems.js';

const AT = '/постройка/.omnifield/omnifield-registry.yaml';
const LOCATION_CONFIG = '/участок/магазин/config.yml';

function read(text: string | null) {
  const problems = new ShopProblemLog();
  const decisions = readDecisions(text, AT, LOCATION_CONFIG, problems);
  return { decisions, problems: problems.list() };
}

function codes(text: string | null): string[] {
  return read(text).problems.map((one) => one.code);
}

describe('отсутствие файла — законное состояние, а не пробел', () => {
  it('файла нет — решений нет, и это НЕ отказ', () => {
    const { decisions, problems } = read(null);

    // «Не продаём» — состояние, которое человек выбрал молчанием, и требовать
    // от него органа продаж значило бы соврать про его намерение.
    expect(decisions).toBeNull();
    expect(problems).toEqual([]);
  });

  it('файл есть, а решений в нём нет — работают дефолты', () => {
    const { decisions, problems } = read('# ничего не решили\n');

    expect(decisions).toEqual(DEFAULT_DECISIONS);
    expect(problems).toEqual([]);
  });

  it('заведённый файл означает «магазин нужен»: дефолт не отказывает от продаж', () => {
    expect(DEFAULT_DECISIONS.shop).toBe(true);
    expect(DEFAULT_DECISIONS.batch).toEqual([]);
  });
});

describe('постройка объявляет, что и куда отгружает', () => {
  it('партия читается списком путей, а порядок — её собственный', () => {
    const { decisions, problems } = read(
      ['batch:', '  - packages/один', '  - packages/два', ''].join('\n'),
    );

    expect(problems).toEqual([]);
    expect(decisions?.batch).toEqual(['packages/один', 'packages/два']);
  });

  it('адрес по умолчанию — магазин этой локации', () => {
    expect(read('batch: []\n').decisions?.address).toBe(LOCATION);
  });

  it('«магазин нужен, а отгружать нечего» — законное состояние', () => {
    // Постройка может брать со склада, ничего туда не кладя. Вывести «магазин
    // не нужен» из пустой партии значило бы объявить потребителя без магазина.
    const { decisions, problems } = read('shop: true\nbatch: []\n');

    expect(problems).toEqual([]);
    expect(decisions).toEqual({ ...DEFAULT_DECISIONS, batch: [] });
  });

  it('«магазин не нужен» объявляется словом, а не выводится из пустоты', () => {
    const { decisions, problems } = read('shop: false\n');

    expect(problems).toEqual([]);
    expect(decisions?.shop).toBe(false);
  });
});

describe('имена не спрашиваются второй раз — регистр следует из адреса', () => {
  it('свой магазин — внутреннее имя, то самое, что в манифесте', () => {
    expect(registerOf(LOCATION)).toBe('internal');
    expect(read('batch:\n  - packages/штука\n').decisions?.names).toBe(
      'internal',
    );
  });

  it('ключа `names` у решений нет вовсе — вторая карта имён запрещена', () => {
    // Карта публичных имён объявлена репозиторием один раз
    // (`packages/baser-release/public-names.json`). Второе такое место
    // разъехалось бы с первым и отправило наружу имя, которого никто не выбирал.
    expect(codes('names: public\n')).toContain('decision-unknown');
  });
});

describe('спорные и непригодные решения называются отказом', () => {
  it('«магазин не нужен» плюс непустая партия — отказ, а не выбор за человека', () => {
    const { decisions, problems } = read(
      'shop: false\nbatch:\n  - packages/штука\n',
    );

    expect(decisions).toBeNull();
    expect(problems.map((one) => one.code)).toEqual(['decision-conflict']);
  });

  it('адрес не тот, до которого построена дорога, — отказ с причиной', () => {
    // Отгрузка наружу необратима: молча повезти туда партию — худший исход.
    const problem = read('address: https://npm.pkg.github.com\n').problems[0];

    expect(problem?.code).toBe('address-not-built');
    expect(problem?.at).toBe(`${AT}#address`);
  });

  it('путь партии за пределы постройки — отказ: в партии называют СВОЁ', () => {
    expect(codes('batch:\n  - ../соседний-клон\n')).toEqual(['decision-type']);
    expect(codes('batch:\n  - /абсолютный/путь\n')).toEqual(['decision-type']);
  });

  it('партия не список, решение не того типа — каждое названо своим адресом', () => {
    expect(codes('batch: packages/штука\n')).toEqual(['decision-type']);
    expect(codes('shop: "да"\n')).toEqual(['decision-type']);
    expect(read('shop: "да"\n').problems[0]?.at).toBe(`${AT}#shop`);
  });

  it('опечатка в имени решения не работает молча', () => {
    // Молча работающий дефолт здесь означал бы, что постройка «объявила» не то,
    // что написала, и узнала бы об этом по отсутствию товара на складе.
    const { problems } = read('batсh:\n  - packages/штука\n');

    expect(problems.map((one) => one.code)).toContain('decision-unknown');
  });

  it('не YAML и не набор ключей — свой код, отдельный от настроек раздачи', () => {
    // Отдельно от `config-unreadable`: чинят это в разных файлах и на разных
    // уровнях мира, и один код отправлял бы человека читать не тот файл.
    expect(codes('- список\n- вместо\n- ключей\n')).toEqual([
      'decisions-unreadable',
    ]);
    expect(codes('{ не: [закрыто\n')).toEqual(['decisions-unreadable']);
  });

  it('несколько опечаток приезжают ЗА ОДИН прогон, а не по одной', () => {
    const { problems } = read(
      ['shop: "да"', 'batch: packages/штука', ''].join('\n'),
    );

    expect(problems).toHaveLength(2);
  });
});

describe('старое содержимое этого пути ловится по ключам', () => {
  it('настройки раздачи в схеме постройки — переезд, а не решение', () => {
    const { decisions, problems } = read('port: 4999\nbatch: []\n');

    expect(decisions).toBeNull();
    expect(problems[0]?.code).toBe('config-in-old-place');
    // Названы оба места: что убрать отсюда и куда это положить.
    expect(problems[0]?.message).toContain('port');
    expect(problems[0]?.message).toContain(LOCATION_CONFIG);
  });

  it('перечень ловимых ключей берётся из объявления настроек, а не второй копией', () => {
    for (const key of ['port', 'host', 'uplink', 'log']) {
      expect(codes(`${key}: что-нибудь\n`), key).toContain(
        'config-in-old-place',
      );
    }
  });
});
