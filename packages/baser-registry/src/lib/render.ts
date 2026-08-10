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
import type { StepReport } from './steps.js';

export function renderText(result: ShopResult): string {
  const lines: string[] = [];

  lines.push(headline(result));
  lines.push('');
  lines.push(`адрес     ${result.shop.address}`);
  lines.push(`видимость ${visibility(result)}`);
  lines.push(`магазин   ${result.location.shopHome}`);
  lines.push(
    `товар     ${plural(result.stock.packages)} · ${result.stock.storage}`,
  );
  lines.push(`апстрим   ${result.shop.uplink}`);

  if (result.state === 'running' && result.shop.pid !== null) {
    lines.push(`процесс   ${result.shop.pid}`);
  }

  // АДРЕС ВЕРЕН ХОЗЯИНУ, А СПРАШИВАЮТ И СОСЕДИ. `127.0.0.1` у соседа свой,
  // поэтому строку выше без этой пометки он унесёт к себе и не придёт никуда
  // (`tasker:BASER2-259`). Имя локации мы не выдумываем — называем порт и то,
  // у кого имя спрашивать.
  //
  // Печатается независимо от того, работает ли раздача сейчас: видимость —
  // свойство настройки, а не текущего процесса.
  lines.push('');
  if (result.shop.reach === 'network') {
    lines.push(
      `адрес выше — для этой локации. Сосед по сети придёт на порт ${result.shop.port}`,
    );
    lines.push(
      `по имени вашей локации: http://<имя локации>:${result.shop.port}.`,
    );
    lines.push(
      'Имя задаёт тот, кто поднимал контейнер, — магазин его не знает и не выдумывает.',
    );
  } else {
    lines.push(
      'раздача заперта в петле — сосед по сети к ней не придёт, даже зная имя.',
    );
    lines.push(
      'Открыть соседям: host: 0.0.0.0 в config.yml магазина (наружу машины это не выводит).',
    );
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

  // ЧТО ПОСТРОЙКА РЕШИЛА — печатается всегда, когда решения есть: человек,
  // спрашивающий магазин, спрашивает и «а что отсюда вообще уезжает». Решений
  // нет — строк нет: выдумывать за постройку «ничего не отгружает» мы не будем,
  // это разные состояния (`decisions.ts`).
  const decisions = result.building.decisions;
  if (decisions !== null) {
    lines.push('');
    lines.push(`отгрузка  ${shipment(decisions.batch.length)} → ${decisions.address}`);
    for (const one of decisions.batch) {
      lines.push(`  ${one}`);
    }
    lines.push(`имена     ${decisions.names} · решения: ${decisions.at}`);
  }

  // ТРИ ДЕЙСТВИЯ — ВСЕ ТРИ И ВСЕГДА, когда прогон был про публикацию. Печатать
  // только отказавшее значило бы отвечать человеку тем же, от чего уходим:
  // «объявление молчит» и «объявления не было» неотличимы, если строки нет
  // (`kb:WORLD-34`).
  if (result.publication !== null) {
    lines.push('');
    lines.push('три действия:');
    for (const one of [
      result.publication.release,
      result.publication.shipment,
      result.publication.announcement,
    ]) {
      lines.push(`  ${stepName(one).padEnd(11)}${stepSaid(one)}`);
    }
  }

  // Каждая строка партии со своим исходом: у пакетов они разные, и общий
  // заголовок отвечает только на вопрос «идти ли разбираться».
  if (result.published.length > 0) {
    lines.push('');
    for (const one of result.published) {
      // Чем публиковали — не деталь реализации: человек не выбирал менеджера, и
      // если выбор был вынужденным, он должен видеть, чем именно.
      lines.push(
        `${said(one.outcome)} ${one.name}@${one.version} → ${one.destination}` +
          ` (${one.manager}${one.needsWorkspace ? ', иначе нельзя: workspace:' : ''})`,
      );
    }
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

/**
 * Кому раздача отвечает — одной строкой и без выдуманного адреса.
 *
 * Слово берётся из данных (`shop.reach`), а не считается здесь заново: текст
 * рисуется поверх ответа и второй правдой быть не должен.
 */
function visibility(result: ShopResult): string {
  return result.shop.reach === 'network'
    ? `соседям по сети локации, порт ${result.shop.port}`
    : 'только этой локации — раздача слушает петлю';
}

/** Что стало с одним пакетом — словом, а не кодом. */
function said(
  outcome: 'published' | 'already-published' | 'failed' | 'refused',
): string {
  switch (outcome) {
    case 'published':
      return 'положено';
    case 'already-published':
      return 'уже лежало';
    case 'failed':
      return 'НЕ ПОЕХАЛО';
    case 'refused':
      return 'НЕ ПОВЕЗЛИ';
  }
}

/** Имя действия — человеческим словом. */
function stepName(step: StepReport): string {
  switch (step.step) {
    case 'release':
      return 'выпуск';
    case 'shipment':
      return 'отгрузка';
    case 'announcement':
      return 'объявление';
  }
}

/**
 * То же имя, но в родительном падеже: «отказ выпуска», а не «отказ выпуск».
 *
 * Отдельная форма, а не склейка на месте: заголовок читает человек, и кривая
 * фраза в самой заметной строке ответа обесценивает всё остальное.
 */
function stepNameOf(step: StepReport): string {
  switch (step.step) {
    case 'release':
      return 'выпуска';
    case 'shipment':
      return 'отгрузки';
    case 'announcement':
      return 'объявления';
  }
}

/**
 * Что сказал шаг — фразой, собранной ИЗ ПОЛЕЙ, а не второй правдой.
 *
 * Отказ читается из кода, а не из текста отказа в `problems`: тот же принцип,
 * что и везде — код машине, фраза человеку, и собирается фраза здесь
 * (`kb:BASER3-10`).
 */
function stepSaid(step: StepReport): string {
  switch (step.outcome) {
    case 'done':
      return step.step === 'release'
        ? 'номер получен — на складе его не было'
        : 'товар уехал на склад';
    case 'nothing-to-do':
      return step.step === 'release'
        ? 'тот же выпуск уже был — замораживать нечего'
        : 'товар уже лежал на складе';
    case 'silent':
      // Тишина названа вслух: витрины нет — и это решение, а не пробел.
      return 'тишина: витрины у магазина локации нет вовсе';
    case 'skipped':
      return 'не начиналось: до него не дошли';
    case 'refused':
      return `ОТКАЗ — ${refusalSaid(step)}`;
  }
}

function refusalSaid(step: StepReport): string {
  switch (step.reason) {
    case 'release-frozen':
      return 'под этим номером на складе лежит другое содержимое (правишь выпущенное)';
    case 'release-unjudged':
      return 'номер занят, а сверить с лежащим нечем';
    case 'shop-closed':
      return 'до склада нет дороги: магазин закрыт';
    case 'wrong-destination':
      return 'назначение не то — везли бы не в свой магазин';
    case 'pnpm-required':
      return 'везти нечем: пакету нужен pnpm, а его нет';
    case 'publish-failed':
      return 'менеджер отказал на публикации';
    default:
      // Код есть, а фразы для него здесь нет. Говорим код: он и так контракт,
      // и человеку лучше увидеть его, чем ровное «что-то пошло не так».
      return step.reason ?? 'причина не названа';
  }
}

/** Партия числом: «отгружает 3 пакета» читается, «batch: 3» — нет. */
function shipment(count: number): string {
  return count === 0 ? 'ничего не отгружает' : plural(count);
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
      return result.published.length === 1
        ? `положено на склад: ${result.published[0].name}@${result.published[0].version}`
        : `партия на складе: ${plural(result.published.length)}`;
    case 'already-published':
      // Не «не получилось», а «делать нечего»: то же слово, каким отвечают
      // второй `up` и второй `down`.
      return result.published.length === 1
        ? `уже на складе: ${result.published[0].name}@${result.published[0].version}`
        : `вся партия уже на складе: ${plural(result.published.length)}`;
    case 'failed':
    case 'refused':
      // ЗАГОЛОВОК НАЗЫВАЕТ ШАГ, а не общее «не вышло». Ради этого весь заход:
      // человек обязан узнать из первой строки, кто именно сказал «нет», —
      // выпуск, отгрузка или объявление.
      return refusedStep(result) ?? 'отказ: так работать нельзя';
  }
}

/** Первый шаг, сказавший «нет», — заголовком. `null` — публикации не было. */
function refusedStep(result: ShopResult): string | null {
  const steps = result.publication;
  if (steps === null) return null;

  for (const one of [steps.release, steps.shipment, steps.announcement]) {
    if (one.outcome === 'refused') {
      return `отказ ${stepNameOf(one)}: ${refusalSaid(one)}`;
    }
  }
  return null;
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
