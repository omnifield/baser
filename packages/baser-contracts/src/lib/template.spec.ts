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

  it('собирает несколько отказов сразу', () => {
    const problems = checkTemplate('<%= a %><%- include("b") %>', AT);
    expect(codesOf(problems)).toEqual([
      `template-html-escape @ ${AT}`,
      `template-include @ ${AT}`,
    ]);
  });
});
