/**
 * Образец ответа для проб рендера и кодов возврата.
 *
 * Живёт рядом с формой, а не внутри одной пробы: ответ проверяют несколько проб,
 * и собранный по-разному он проверял бы разные вещи.
 */

import { SCHEMA_VERSION, type ShopResult } from './result.js';

export function sampleResult(patch: Partial<ShopResult> = {}): ShopResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'status',
    outcome: 'reported',
    state: 'running',
    location: {
      root: '/локация',
      origin: 'shop',
      home: '/локация/.baser-registry',
    },
    shop: {
      address: 'http://127.0.0.1:4873',
      listen: '127.0.0.1:4873',
      uplink: 'https://registry.npmjs.org/',
      pid: 4242,
      claimed: true,
      log: '/локация/.baser-registry/runtime/shop.log',
    },
    stock: {
      storage: '/локация/.baser-registry/storage',
      packages: 3,
    },
    scopeConflicts: [],
    access: {
      npmrc: [
        'registry=http://127.0.0.1:4873',
        '//127.0.0.1:4873/:_authToken=baser-registry',
      ],
    },
    published: null,
    writes: [],
    trace: [],
    problems: [],
    ...patch,
  };
}
