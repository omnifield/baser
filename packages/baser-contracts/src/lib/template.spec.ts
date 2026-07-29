import { describe, expect, it } from 'vitest';
import { codesOf } from './form.fixture.js';
import { checkTemplate } from './template.js';

const AT = 'devcontainer.json.ejs → .devcontainer/devcontainer.json';

describe('язык подстановки', () => {
  it('пропускает шаблон на языке формы: подстановка и ветвление', () => {
    const template = [
      '{',
      '  "name": "<%- name %>",',
      '<% if (network) { -%>',
      '  "runArgs": ["--network=<%- network %>"],',
      '<% } -%>',
      '  "remoteUser": "node"',
      '}',
    ].join('\n');

    expect(checkTemplate(template, AT)).toEqual([]);
  });

  it('ЛОВИТ ШАБЛОН, НАПИСАННЫЙ НЕ НА ТОМ ЯЗЫКЕ', () => {
    // Handlebars/Jinja отрендерились бы EJS сами в себя: артефакт лёг бы к
    // потребителю с неподставленными местами и ничем бы себя не выдал.
    for (const foreign of [
      '{ "name": "{{ name }}" }',
      '{% if network %}{ "net": "x" }{% endif %}',
      '{ "name": "${name}" }',
    ]) {
      const problems = checkTemplate(foreign, AT);
      expect(codesOf(problems)).toEqual([`template-not-ejs @ ${AT}`]);
      expect(problems[0].message).toContain('EJS');
      expect(problems[0].message).toContain('"render": false');
    }
  });

  it('называет файл без подстановок, помеченный рендеримым', () => {
    // Тот же отказ и та же подсказка: либо язык не тот, либо запись должна быть
    // с render: false — и тогда файл ляжет байт в байт.
    expect(codesOf(checkTemplate('{ "статика": true }', AT))).toEqual([
      `template-not-ejs @ ${AT}`,
    ]);
  });

  it('ЗАПРЕЩАЕТ экранирующую форму вывода', () => {
    // Ровно та ловушка, на которой споткнулась проба формы: `"` → `&#34;`, и
    // валидный devcontainer.json перестаёт быть JSON.
    const problems = checkTemplate('{ "name": "<%= name %>" }', AT);
    expect(codesOf(problems)).toEqual([`template-html-escape @ ${AT}`]);
    expect(problems[0].message).toContain('<%-');
  });

  it('запрещает подключение содержимого мимо раскладки', () => {
    const problems = checkTemplate('<%- include("./общий.json") %>', AT);
    expect(codesOf(problems)).toContain(`template-include @ ${AT}`);
  });

  it('не путает include() в СОДЕРЖИМОМ артефакта с обращением к шаблонизатору', () => {
    // Слово include( в тексте скрипта — обычная строка, а не тег.
    const template = '<%- name %>\nsource include(./lib.sh)\n';
    expect(checkTemplate(template, AT)).toEqual([]);
  });

  it('называет оборванный шаблон', () => {
    const problems = checkTemplate('{ "name": "<%- name }', AT);
    expect(codesOf(problems)).toEqual([`template-unbalanced @ ${AT}`]);
  });

  describe('граница: обычный JS внутри тега можно, ходы наружу — нет', () => {
    it('РАЗРЕШАЕТ то, что делает эталонный шаблон зоны', () => {
      // Дока обещала «только значения настроек по именам», а собственный шаблон
      // девбокса собирает runArgs и mounts локальными переменными и методами
      // массивов. Обещание приведено к поведению: это несущая часть контракта,
      // без неё форма не выражает девбокс (`tasker:BASER2-70` §2).
      const template = [
        '<%',
        'const mounts = [];',
        'if (secretsVolume) mounts.push(`source=${secretsVolume},type=volume`);',
        'const list = (items) => items.map((v) => JSON.stringify(v)).join(", ");',
        '-%>',
        '{ "mounts": [<%- list(mounts) %>] }',
      ].join('\n');

      expect(checkTemplate(template, AT)).toEqual([]);
    });

    it('ЗАПРЕЩАЕТ ОКРУЖЕНИЕ МАШИНЫ: артефакт обязан быть воспроизводимым', () => {
      const problems = checkTemplate(
        '{ "home": "<%- process.env.HOME %>" }',
        AT,
      );
      expect(codesOf(problems)).toEqual([`template-escapes-scope @ ${AT}`]);
      expect(problems[0].message).toContain('резолвер');
    });

    it('ловит ход наружу внутри шаблонного литерала — там он и прячется', () => {
      // Литерал целиком гасить нельзя: `${…}` — это снова код.
      const problems = checkTemplate('<%- `${process.cwd()}` %>', AT);
      expect(codesOf(problems)).toEqual([`template-escapes-scope @ ${AT}`]);
    });

    it('называет остальные двери наружу поимённо', () => {
      for (const escape of [
        '<%- require("node:fs").readFileSync("/etc/hosts") %>',
        '<% const m = await import("./соседний.js") %>',
        '<%- globalThis.секрет %>',
        '<%- eval("1+1") %>',
        '<%- new Function("return 1")() %>',
        '<%- fetch("https://пример") %>',
        '<%- __dirname %>',
        '<%- __filename %>',
      ]) {
        expect(codesOf(checkTemplate(escape, AT))).toContain(
          `template-escapes-scope @ ${AT}`,
        );
      }
    });

    it('НЕ ПУТАЕТ слово в подставляемой строке с ходом наружу', () => {
      // Ложная тревога дороже пропуска: из-за неё перестают верить настоящим
      // отказам. Строковые литералы и комментарии из проверки вырезаны.
      const template = [
        '<%- name %>',
        '<%- "не трогай process" %>',
        "<%- 'require(это строка)' %>",
        '<% // process тут просто слово в комментарии',
        '%>',
        '<% /* и здесь: globalThis */ %>',
      ].join('\n');

      expect(checkTemplate(template, AT)).toEqual([]);
    });

    it('слово наружу в СОДЕРЖИМОМ артефакта отказом не считается', () => {
      // Скрипт, который кладёт обвес, вправе звать process и require — он
      // исполняется у потребителя, а не при раскладке.
      const template = 'const fs = require("node:fs"); // <%- name %>\n';
      expect(checkTemplate(template, AT)).toEqual([]);
    });
  });

  it('собирает несколько отказов сразу', () => {
    const problems = checkTemplate('<%= a %><%- include("b") %>', AT);
    expect(codesOf(problems)).toEqual([
      `template-html-escape @ ${AT}`,
      `template-include @ ${AT}`,
    ]);
  });
});
