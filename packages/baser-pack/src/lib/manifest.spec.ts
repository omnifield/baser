/**
 * ОПИСЬ ВЫДАЧИ: отпечаток называет ровно этот груз, а не похожий.
 *
 * Опись не спорит с нагрузкой — она её описывает. Значит любое изменение
 * нагрузки обязано менять слово, которым её называют: и правка содержимого, и
 * переименование файла, и лишний файл, и пропавший.
 */

import { describe, expect, it } from 'vitest';

import type { SourceDeclaration } from '@omnifield/baser-contracts';

import {
  buildPayloadManifest,
  payloadDigest,
  PAYLOAD_SCHEMA_VERSION,
  type PayloadFile,
} from './manifest.js';

const FILES: PayloadFile[] = [
  { path: 'defaults.mjs', bytes: 3, sha256: 'аа'.repeat(32) },
  { path: 'template/x.ejs', bytes: 5, sha256: 'бб'.repeat(32) },
];

const DECLARATION: SourceDeclaration = {
  formVersion: 1,
  source: { id: 'omnifield/devbox', title: 'Девбокс', contentRoot: 'template' },
  settings: {},
  presets: {},
  layout: [
    { src: 'x.ejs', dest: '.devcontainer/devcontainer.json', render: true },
  ],
};

const VERDICT = { ok: true, stages: [] };

function manifestOf(files: readonly PayloadFile[]) {
  return buildPayloadManifest({
    declaration: DECLARATION,
    packageName: '@omnifield/baser-devbox',
    packageVersion: '0.2.0',
    shipping: { claim: 'declared', decidedBy: 'npm' },
    files,
    checkSchemaVersion: 1,
    source: VERDICT,
    payload: VERDICT,
  });
}

describe('отпечаток нагрузки', () => {
  it('меняется вместе с содержимым файла', () => {
    const other = [{ ...FILES[0], sha256: 'вв'.repeat(32) }, FILES[1]];

    expect(payloadDigest(other)).not.toBe(payloadDigest(FILES));
  });

  it('меняется вместе с ИМЕНЕМ файла при том же содержимом', () => {
    const renamed = [{ ...FILES[0], path: 'умолчания.mjs' }, FILES[1]];

    expect(payloadDigest(renamed)).not.toBe(payloadDigest(FILES));
  });

  it('меняется, когда файл пропал или появился', () => {
    expect(payloadDigest([FILES[0]])).not.toBe(payloadDigest(FILES));
    expect(
      payloadDigest([...FILES, { path: 'лишний', bytes: 0, sha256: '00' }]),
    ).not.toBe(payloadDigest(FILES));
  });

  it('одинаков для одной и той же описи', () => {
    expect(payloadDigest([...FILES])).toBe(payloadDigest(FILES));
  });
});

describe('опись', () => {
  it('называет артефакты полным путём внутри нагрузки', () => {
    expect(manifestOf(FILES).artifacts).toEqual([
      {
        dest: '.devcontainer/devcontainer.json',
        from: 'template/x.ejs',
        render: true,
      },
    ]);
  });

  it('несёт свою версию формы — несовместимость обязана быть видимой', () => {
    expect(manifestOf(FILES).payloadSchemaVersion).toBe(PAYLOAD_SCHEMA_VERSION);
    expect(manifestOf(FILES).formVersion).toBe(1);
  });

  it('отпечаток в описи посчитан по её же файлам', () => {
    expect(manifestOf(FILES).digest).toBe(payloadDigest(FILES));
  });
});
