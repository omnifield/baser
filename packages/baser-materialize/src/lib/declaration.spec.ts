import { describe, expect, it } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { DeclarationError } from './errors.js';
import { parseDeclaration, readDeclaration } from './declaration.js';

function treeWithManifest(manifest: unknown) {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('package.json', JSON.stringify(manifest, null, 2));
  return tree;
}

describe('readDeclaration', () => {
  it('читает блок omnifield и нормализует пути записей', () => {
    const tree = treeWithManifest({
      name: '@omnifield/consumer',
      omnifield: {
        kind: 'plugin',
        target: 'repo',
        stack: 'node',
        contentRoot: 'content',
        frame: [
          {
            src: './ci/build.yml',
            dest: '.github/workflows/build.yml',
            mode: 'exact',
          },
        ],
      },
    });

    expect(readDeclaration(tree)).toEqual({
      kind: 'plugin',
      target: 'repo',
      stack: 'node',
      contentRoot: 'content',
      frame: [
        {
          src: 'ci/build.yml',
          dest: '.github/workflows/build.yml',
          mode: 'exact',
        },
      ],
      extra: {},
    });
  });

  it('сохраняет неинтерпретируемые поля блока как есть', () => {
    const tree = treeWithManifest({
      omnifield: { contentRoot: 'content', frame: [], plugins: ['a'] },
    });

    expect(readDeclaration(tree).extra).toEqual({ plugins: ['a'] });
  });

  it('отказывает, когда продукт не объявил себя', () => {
    const tree = treeWithManifest({ name: '@omnifield/consumer' });

    expect(() => readDeclaration(tree)).toThrow(DeclarationError);
    expect(() => readDeclaration(tree)).toThrow(/не объявил себя/);
  });

  it('называет поле и файл в сообщении об ошибке', () => {
    const tree = treeWithManifest({
      omnifield: {
        contentRoot: 'content',
        frame: [{ src: 'a', dest: 'b', mode: 'copy' }],
      },
    });

    expect(() => readDeclaration(tree)).toThrow(
      /package\.json: omnifield\.frame\[0\]\.mode — ожидался один из exact \| merge \| seed/,
    );
  });

  it('отклоняет выход за корень репозитория', () => {
    expect(() =>
      parseDeclaration(
        {
          contentRoot: 'content',
          frame: [{ src: 'a', dest: '../../etc/passwd', mode: 'exact' }],
        },
        'package.json',
      ),
    ).toThrow(/выходит за корень репозитория/);
  });

  it('отклоняет декларацию без contentRoot', () => {
    expect(() => parseDeclaration({ frame: [] }, 'package.json')).toThrow(
      /contentRoot — ожидалась непустая строка/,
    );
  });
});
