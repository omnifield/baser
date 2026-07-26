import { describe, expect, it } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import {
  ENGINE_ID,
  UnmarkableContentError,
  markerFormatFor,
  readOwnership,
  scanOwnership,
} from './ownership.js';
import type { OwnershipRecord } from './ownership.js';

const record: OwnershipRecord = { src: 'ci/build.yml' };

function format(dest: string) {
  const found = markerFormatFor(dest);
  if (found === null) {
    throw new Error(`ожидался формат маркера для ${dest}`);
  }
  return found;
}

describe('маркер владения', () => {
  it.each([
    ['ci.yml', '#'],
    ['setup.ts', '//'],
    ['README.md', '<!--'],
    ['Dockerfile', '#'],
  ])('ставится, читается и снимается без потери тела (%s)', (dest, prefix) => {
    const body = 'первая строка\nвторая строка\n';
    const stamped = format(dest).stamp(body, record);

    expect(stamped.startsWith(prefix)).toBe(true);
    expect(stamped).toContain(ENGINE_ID);
    expect(format(dest).parse(stamped)).toEqual(record);
    expect(format(dest).strip(stamped)).toBe(body);
  });

  it('не ломает пролог файла (shebang остаётся первой строкой)', () => {
    const body = '#!/usr/bin/env bash\nset -eu\n';
    const stamped = format('run.sh').stamp(body, record);

    expect(stamped.split('\n')[0]).toBe('#!/usr/bin/env bash');
    expect(format('run.sh').parse(stamped)).toEqual(record);
    expect(format('run.sh').strip(stamped)).toBe(body);
  });

  it('помечает JSON ключом-комментарием и приводит его к каноничной форме', () => {
    const stamped = format('tsconfig.json').stamp(
      '{"compilerOptions":{"strict":true}}',
      record,
    );

    expect(JSON.parse(stamped)['//']).toContain(ENGINE_ID);
    expect(format('tsconfig.json').parse(stamped)).toEqual(record);
    expect(JSON.parse(format('tsconfig.json').strip(stamped))).toEqual({
      compilerOptions: { strict: true },
    });
  });

  it('повторная простановка маркера не накапливает маркеры (идемпотентна)', () => {
    const once = format('ci.yml').stamp('тело\n', record);
    const twice = format('ci.yml').stamp(format('ci.yml').strip(once), record);

    expect(twice).toBe(once);
  });

  it('отказывается помечать JSON без объекта в корне', () => {
    expect(() => format('list.json').stamp('[1,2]', record)).toThrow(
      UnmarkableContentError,
    );
  });

  it('не выдумывает формат для классов файлов без комментариев', () => {
    expect(markerFormatFor('LICENSE')).toBeNull();
    expect(markerFormatFor('assets/logo.png')).toBeNull();
  });

  it('маркер, процитированный в тексте, не делает файл нашим', () => {
    // Гача канона (kb:BASER-3): документация показывает маркер, и её нельзя
    // из-за этого снести как сироту. Маркер читается только в шапке файла.
    const tree = createTreeWithEmptyWorkspace();
    const quoted = format('ci.yml').stamp('jobs: {}\n', record);
    tree.write(
      'docs/marker.md',
      `# как выглядит маркер\n\n\`\`\`yaml\n${quoted}\`\`\`\n`,
    );

    expect(readOwnership(tree, 'docs/marker.md')).toBeNull();
    expect(scanOwnership(tree).size).toBe(0);
  });

  it('чужой файл не опознаётся как наш', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('ci.yml', '# сделано вручную\njobs: {}\n');

    expect(readOwnership(tree, 'ci.yml')).toBeNull();
  });
});

describe('scanOwnership', () => {
  it('находит всё, чем движок владеет, и пропускает служебные каталоги', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      '.github/workflows/build.yml',
      format('build.yml').stamp('jobs: {}\n', record),
    );
    tree.write(
      'node_modules/@omnifield/kit/ci.yml',
      format('ci.yml').stamp('jobs: {}\n', record),
    );
    tree.write('docs/manual.md', '# написано человеком\n');

    const owned = scanOwnership(tree);

    expect([...owned.keys()]).toEqual(['.github/workflows/build.yml']);
    expect(owned.get('.github/workflows/build.yml')).toEqual(record);
  });
});
