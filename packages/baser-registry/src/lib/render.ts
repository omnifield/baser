/**
 * ТЕКСТ ДЛЯ ЧЕЛОВЕКА — рендер поверх ответа, а не вторая правда.
 *
 * Функция принимает ответ целиком и больше ничего: то, чего нет в структуре,
 * человеку показать физически нечем, — так правило «данные первичны»
 * (`kb:BASER3-10`) держится формой, а не дисциплиной.
 *
 * ОБЕЩАНИЕ В ТЕКСТЕ — ТАКОЙ ЖЕ КОНТРАКТ, КАК КОД. Команда, названная здесь,
 * прогоняется пробой БУКВАЛЬНО (`acceptance.spec.ts`): непроверенное обещание
 * тихо протухает, и человек идёт по нему в тупик. Именно так мы уже оплатили
 * скоуп-настройку, которая молча бьёт `--registry`.
 */

import type { ShopResult } from './result.js';

export function renderText(result: ShopResult): string {
  const lines: string[] = [];

  lines.push(headline(result));
  lines.push('');
  lines.push(`адрес     ${result.shop.address}`);
  lines.push(`магазин   ${result.location.shopHome}`);
  lines.push(
    `товар     ${plural(result.stock.packages)} · ${result.stock.storage}`,
  );
  lines.push(`апстрим   ${result.shop.uplink}`);

  if (result.state === 'running' && result.shop.pid !== null) {
    lines.push(`процесс   ${result.shop.pid}`);
  }

  // ПРАВДА ПРО УРОВНИ. «Магазин работает» верно для всей локации, но постройка,
  // которая его не поднимала, обязана видеть разницу — иначе она принимает
  // общую раздачу за свою и удивляется, что товар оказался «не там»
  // (`tasker:BASER2-254`).
  if (result.state === 'running' && !result.building.startedShop) {
    lines.push('');
    lines.push(
      'раздачу подняла не эта постройка — она общая на локацию, как и склад.',
    );
    lines.push('Это не конфликт: у построек одного участка магазин один.');
  }

  if (result.published !== null) {
    // Чем публиковали — не деталь реализации: человек не выбирал менеджера, и
    // если выбор был вынужденным, он должен видеть, чем именно.
    lines.push(
      `положено  ${result.published.manager}` +
        (result.published.needsWorkspace
          ? ' (у пакета есть зависимости workspace: — иначе нельзя)'
          : ''),
    );
    lines.push(`уехало в  ${result.published.destination}`);
  }
  if (result.state === 'closed' && result.shop.claimed) {
    // Ровно то состояние, ради которого инструмент существует: контейнер
    // перезапустился, магазин закрыт, товар на месте.
    lines.push('');
    lines.push(
      'заявка о запуске осталась с прошлой жизни контейнера — магазин её не пережил.',
    );
    lines.push('`baser-registry up` вернёт раздачу с тем же товаром.');
  }

  // Печатается ВСЕГДА, а не только на поднятом магазине: строки зависят от
  // адреса, а не от того, отвечает ли раздача прямо сейчас. Условие здесь
  // однажды уже соврало — текст про конфликт скоупа ссылался на строки «выше»,
  // которых при закрытом магазине не печаталось.
  lines.push('');
  lines.push('чтобы публиковать и ставить отсюда — строки в .npmrc:');
  for (const line of result.access.npmrc) {
    lines.push(`  ${line}`);
  }
  lines.push(
    'токен любой непустой: прав доступа у магазина локации нет, а без токена',
  );
  lines.push('npm не публикует вовсе — решает это он, не раздача.');

  for (const conflict of result.scopeConflicts) {
    lines.push('');
    lines.push(
      `ВНИМАНИЕ: скоуп ${conflict.scope} настроен на ${conflict.registry}.`,
    );
    lines.push(
      'Публикация и установка по нему уедут ТУДА: скоуп-настройка бьёт --registry молча.',
    );
    lines.push(`Строка ${conflict.scope}:registry выше перебивает это.`);
  }

  if (result.problems.length > 0) {
    lines.push('');
    for (const problem of result.problems) {
      lines.push(`[${problem.code}] ${problem.at}`);
      lines.push(`  ${problem.message}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function headline(result: ShopResult): string {
  switch (result.outcome) {
    case 'started':
      return 'магазин поднят';
    case 'already-running':
      return 'магазин уже работал — делать нечего';
    case 'stopped':
      return 'магазин закрыт, товар остался на месте';
    case 'already-closed':
      return 'магазин и так был закрыт';
    case 'reported':
      return result.state === 'running'
        ? 'раздача локации работает'
        : 'магазин закрыт';
    case 'published':
      return result.published === null
        ? 'товар положен на склад'
        : `положено на склад: ${result.published.name}@${result.published.version}`;
    case 'already-published':
      // Не «не получилось», а «делать нечего»: то же слово, каким отвечают
      // второй `up` и второй `down`.
      return result.published === null
        ? 'эта версия уже на складе'
        : `уже на складе: ${result.published.name}@${result.published.version}`;
    case 'failed':
      return 'не вышло';
    case 'refused':
      return 'отказ: так работать нельзя';
  }
}

/** Русское число словом рядом с цифрой: «1 пакет», «2 пакета», «5 пакетов». */
function plural(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} пакетов`;
  switch (count % 10) {
    case 1:
      return `${count} пакет`;
    case 2:
    case 3:
    case 4:
      return `${count} пакета`;
    default:
      return `${count} пакетов`;
  }
}
