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
      shopHome: '/участок/магазин',
      origin: 'variable',
    },
    building: {
      root: '/участок/постройка',
      origin: 'git',
      startedShop: true,
      // Постройка ничего не объявила — законное состояние и самое частое:
      // орган решения заводит тот, кто отгружает.
      decisions: null,
    },
    shop: {
      // Состояние по умолчанию: слушается сеть локации, а ходит хозяин по
      // петле. Образец повторяет дефолт, иначе пробы мерили бы то, чего у
      // человека из коробки не бывает.
      address: 'http://127.0.0.1:4873',
      listen: '0.0.0.0:4873',
      reach: 'network',
      port: 4873,
      uplink: 'https://registry.npmjs.org/',
      pid: 4242,
      claimed: true,
      log: '/участок/магазин/runtime/shop.log',
    },
    stock: {
      storage: '/участок/магазин/storage',
      packages: 3,
    },
    scopeConflicts: [],
    access: {
      npmrc: [
        'registry=http://127.0.0.1:4873',
        '//127.0.0.1:4873/:_authToken=baser-registry',
      ],
    },
    published: [],
    writes: [],
    trace: [],
    problems: [],
    ...patch,
  };
}
