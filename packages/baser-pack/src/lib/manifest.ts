/**
 * МАНИФЕСТ ВЫДАЧИ — опись груза, а не второй экземпляр груза.
 *
 * Принимающая сторона обязана уметь сказать, ЧТО она получила, не вскрывая ящик
 * и не разбирая содержимое заново. Для этого нужны четыре вещи: чей это обвес,
 * какой версии формы он соответствует, из чего состоит поставка и чем она
 * проверена. Ровно они здесь и лежат.
 *
 * ## Почему это не «вторая правда»
 *
 * Правда о детали живёт в самой нагрузке — в её `package.json`. Опись её не
 * дублирует, а **описывает уже замороженный груз**: у каждого файла назван
 * размер и отпечаток, а у всей нагрузки — один общий. Разойтись с грузом опись
 * не может молча: изменившийся файл меняет отпечаток, и расхождение видно
 * арифметикой, а не спором двух источников.
 *
 * Поэтому опись лежит РЯДОМ с нагрузкой, а не внутри неё: нагрузка — это ровно
 * то, что получит потребитель, и класть в неё лишний файл значило бы менять
 * деталь ради разговора о детали.
 *
 * ## Третье состояние доезжает сюда
 *
 * Проверка умеет отвечать «не могу сказать» про белый список `files`
 * (`ShippingList.undecidable`). Это состояние в описи названо вслух вместе с
 * причиной — и рядом сказано, кто состав нагрузки определил в итоге. Растворить
 * «не могу сказать» в `ok: true` значило бы выдать деталь, про которую мы не
 * знаем, что в ней.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import type { CheckStage } from '@omnifield/baser-check';
import type { SourceDeclaration } from '@omnifield/baser-contracts';

/** Версия формы ОПИСИ. Отдельная от формы объявления и формы ответа проверки. */
export const PAYLOAD_SCHEMA_VERSION = 1;

/** Каталог нагрузки внутри каталога выдачи. */
export const PAYLOAD_DIR = 'payload';

/** Опись — файлом рядом с нагрузкой, тем же именем. */
export const PAYLOAD_MANIFEST_FILE = 'payload.json';

/** Один файл нагрузки: путь внутри неё, размер и отпечаток. */
export interface PayloadFile {
  /** Путь относительно корня нагрузки, канонический (`a/b/c`). */
  readonly path: string;
  readonly bytes: number;
  /** `sha256` содержимого — шестнадцатеричной строкой. */
  readonly sha256: string;
}

/** Что деталь положит потребителю: адрес артефакта и откуда он берётся. */
export interface PayloadArtifact {
  /** Путь артефакта в репозитории потребителя — он же единица владения. */
  readonly dest: string;
  /** Путь внутри нагрузки, из которого он кладётся. */
  readonly from: string;
  /** Подставлять ли значения настроек при укладке. */
  readonly render: boolean;
}

/**
 * Что известно про состав поставки — включая «не могу сказать».
 *
 * `claim` — ответ ПРОВЕРКИ про исходный обвес. `decidedBy` — кто определил
 * состав нагрузки на самом деле: не предсказание разбора, а сам упаковщик.
 */
export interface PayloadShipping {
  readonly claim: 'declared' | 'not-declared' | 'undecidable';
  /** Почему проверка не смогла сказать. Есть ровно тогда, когда её назвали. */
  readonly reason?: string;
  readonly decidedBy: 'npm';
}

/** Вердикт одной проверки — как есть, без пересказа. */
export interface PayloadVerdict {
  readonly ok: boolean;
  /** Слои проверки со статусами и объёмом сверенного. */
  readonly stages: readonly CheckStage[];
}

export interface PayloadManifest {
  readonly payloadSchemaVersion: number;
  /** Версия формы объявления, которой соответствует деталь. */
  readonly formVersion: number;
  /** Личность обвеса и пакет, которым он доставлен. */
  readonly source: {
    /** `<поставщик>/<обвес>` — личность, а не имя npm-пакета. */
    readonly id: string;
    readonly title: string;
    readonly package: {
      readonly name: string;
      readonly version: string | null;
    };
  };
  readonly shipping: PayloadShipping;
  /** Что деталь положит потребителю. */
  readonly artifacts: readonly PayloadArtifact[];
  /** Из чего состоит поставка — закрытым списком. */
  readonly files: readonly PayloadFile[];
  /**
   * Отпечаток всей нагрузки: `sha256` по описи «отпечаток + путь».
   *
   * Одно слово вместо списка — им принимающая сторона называет ровно этот груз
   * и отличает его от собранного из другого дерева.
   */
  readonly digest: string;
  /** Чем проверено: версия формы ответа проверки и оба её вердикта. */
  readonly verified: {
    readonly checkSchemaVersion: number;
    /** Проверка ИСХОДНОГО каталога — та, что решает, паковать ли вообще. */
    readonly source: PayloadVerdict;
    /** Проверка СОБРАННОЙ нагрузки — та, что решает, годна ли она к выдаче. */
    readonly payload: PayloadVerdict;
  };
}

export interface ManifestInput {
  readonly declaration: SourceDeclaration;
  readonly packageName: string;
  readonly packageVersion: string | null;
  readonly shipping: PayloadShipping;
  readonly files: readonly PayloadFile[];
  readonly checkSchemaVersion: number;
  readonly source: PayloadVerdict;
  readonly payload: PayloadVerdict;
}

/** Собирает опись по уже собранной нагрузке. */
export function buildPayloadManifest(input: ManifestInput): PayloadManifest {
  const contentRoot = input.declaration.source.contentRoot;

  return {
    payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
    formVersion: input.declaration.formVersion,
    source: {
      id: input.declaration.source.id,
      title: input.declaration.source.title,
      package: { name: input.packageName, version: input.packageVersion },
    },
    shipping: input.shipping,
    artifacts: input.declaration.layout.map((entry) => ({
      dest: entry.dest,
      from: `${contentRoot}/${entry.src}`,
      render: entry.render,
    })),
    files: input.files,
    digest: payloadDigest(input.files),
    verified: {
      checkSchemaVersion: input.checkSchemaVersion,
      source: input.source,
      payload: input.payload,
    },
  };
}

/**
 * Отпечаток нагрузки — по отпечаткам файлов и их путям.
 *
 * Считается по описи, а не по склейке содержимого: переименование файла обязано
 * менять отпечаток так же, как правка его содержимого, — иначе две разные
 * нагрузки назывались бы одним словом.
 *
 * Порядок берётся из описи, а она отсортирована при сборке: две сборки одного
 * обвеса обязаны давать одно слово.
 */
export function payloadDigest(files: readonly PayloadFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file.sha256}  ${file.path}\n`);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Кладёт опись рядом с нагрузкой. Читаемым JSON — её читают и глазами. */
export function writePayloadManifest(
  path: string,
  manifest: PayloadManifest,
): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}
