/**
 * ОБЕЩАНИЯ ЗОНЫ — ТАКОЙ ЖЕ КОНТРАКТ, КАК КОД (`tasker:BASER2-71`).
 *
 * Аудит 2026-07-29 прошёл зону читателем и нашёл двенадцать мест, где она
 * обещает человеку то, чего не делает. Ни одно не ловилось тестами: тексты
 * доки, подсказок и `USAGE` никем не проверялись — их вычитывали.
 *
 * Правило зона уже держит на отказах двери: обещал путь восстановления —
 * прогони его пробой. Здесь оно распространено на **доку и подсказки**, потому
 * что дверь — единственная зона, которая говорит с человеком, и её текст это и
 * есть продукт для того, кто первый раз распаковал бандл.
 *
 * Что проверяется тут, а не глазами:
 *   — `INSTALL.md` не описывает снятый костыль и не подсказывает путь ЧУЖОГО
 *     обвеса;
 *   — `--json` отдаёт РАЗБИРАЕМЫЕ данные, а не данные вперемешку с прозой;
 *   — флаг, не относящийся к команде, отказывает, а не глотается молча;
 *   — словарь совпадает с каноном.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { installDoc } from './install-doc.js';
import { cli, USAGE } from './cli.js';
import { run, soleRun } from '../index.js';
import { renderText } from './report.js';
import {
  installDevbox,
  DEVBOX_PACKAGE,
  type Consumer,
  type SourceSpec,
} from './devbox.fixture.js';
import type { PackReport } from '@omnifield/baser-pack';

let consumer: Consumer | null = null;

afterEach(() => {
  consumer?.cleanup();
  consumer = null;
});

/**
 * Опись НЕ девбокса.
 *
 * Дока обещает быть «инструкцией под КОНКРЕТНЫЙ обвес», и проверить это можно
 * только на обвесе, который кладёт не `.devcontainer`: на девбоксе прибитый путь
 * и путь из описи совпадают, и подмена не видна.
 */
function packedAgents(): PackReport {
  return {
    ok: true,
    manifest: {
      source: {
        id: 'omnifield/agent-harness',
        title: 'Плагин агент-харнесса',
        package: { name: '@omnifield/brain-harness', version: '0.3.0' },
      },
      // Классы — как в настоящей описи (`PayloadArtifact.class`): роль-модель
      // продукта заполняет человек, рамка ролей наша. Опись без классов
      // проверяла бы доку на грузе, которого упаковка не выдаёт.
      artifacts: [
        {
          dest: '.omnifield/harness.yaml',
          src: 'harness.yaml.ejs',
          class: 'placed-once',
        },
        {
          dest: '.claude/agents/shared-policy.md',
          src: 'shared-policy.md',
          class: 'regenerated',
        },
      ],
      files: [],
    },
  } as unknown as PackReport;
}

describe('INSTALL.md не описывает того, чего нет', () => {
  it('оговорка про имя от каталога снята — костыль пережил свою причину', () => {
    const doc = installDoc(packedAgents(), '/выдача/agents-bundle');

    // `BASER2-32` смержен: имя девбокса берётся из `origin`, каталог — запасной
    // вариант. Человек, читающий про костыль, которого нет, зря возится с
    // точкой монтирования — а костыль в доке, переживший причину, это ложь в
    // доке (`tasker:BASER2-38`).
    expect(doc).not.toContain('BASER2-32');
    expect(doc).not.toContain('repo-devbox');
    expect(doc).not.toMatch(/имя девбокса/);
    expect(doc).not.toMatch(/[Оо]говорка временная/);
  });

  it('монтирование под своим именем осталось: снимали оговорку, а не вход', () => {
    const doc = installDoc(packedAgents(), '/выдача/agents-bundle');
    const first = /```bash\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';

    // Эта проба сначала ЗАПРЕЩАЛА строку ниже — вместе с оговоркой ушло и
    // монтирование под настоящим именем, на `/repo`. Ошибка в самой пробе:
    // неверным было ОБЪЯСНЕНИЕ («имя всегда считается от каталога»), а команда
    // верной (`tasker:BASER2-71`, находка ревью).
    //
    // Внутри контейнера имя каталога — это и есть точка монтирования (`--cwd`
    // докерная команда не передаёт). `origin` её перебивает, но без `origin`
    // (свежий `git init`, `tasker:BASER2-44`) обвес читает имя каталога —
    // запасной вариант, заведённый нарочно. Значит `/repo` не нейтрален: он
    // стирает вход и называет всякий такой репозиторий одинаково.
    expect(first).toContain('-v "$PWD":"/$(basename "$PWD")"');
    expect(first).toContain('-w "/$(basename "$PWD")"');
    expect(first).not.toContain('/repo');

    // И сказано вслух, зачем: команду копируют целиком, а необъяснённая
    // подстановка в ней читается как шум и первой уезжает при следующей уборке.
    expect(doc).toMatch(/под СВОИМ именем/);
  });

  it('docker-команда осталась первой, и `--user` из неё никуда не делся', () => {
    const doc = installDoc(packedAgents(), '/выдача/agents-bundle');
    const first = /```bash\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';

    // Снимали оговорку, а не предусловие: на хосте Node по-прежнему не нужен, и
    // файлы по-прежнему обязаны остаться пользовательскими.
    expect(first).toContain('docker run');
    expect(first).toContain('--user');
    expect(first).toContain('node:22');
    expect(doc.indexOf('На хосте Node не нужен')).toBeLessThan(
      doc.indexOf('```'),
    );
  });

  it('`--confirm` подсказывается путём ЭТОГО обвеса, а не девбокса', () => {
    const doc = installDoc(packedAgents(), '/выдача/agents-bundle');

    // Прибитый `.devcontainer/devcontainer.json` в инструкции плагина агентов
    // отправлял бы человека подтверждать путь, которого никто не кладёт, — и он
    // получил бы `confirmation-unused` вместо снятого отказа.
    expect(doc).not.toContain('.devcontainer/devcontainer.json');
    expect(doc).toContain('--confirm .omnifield/harness.yaml');
  });

  it('обвес без артефактов не рождает подсказку из воздуха', () => {
    const empty = {
      ok: true,
      manifest: {
        source: {
          id: 'omnifield/пусто',
          title: 'Ничего не кладёт',
          package: { name: '@omnifield/пусто', version: '0.0.1' },
        },
        artifacts: [],
        files: [],
      },
    } as unknown as PackReport;

    const doc = installDoc(empty, '/выдача/пусто');

    // Подсказка `--confirm <путь>` без единого объявленного пути была бы
    // приглашением подтвердить пустоту.
    expect(doc).not.toContain('--confirm undefined');
    expect(doc).not.toMatch(/--confirm\s*\n/);
  });

  it('файл настроек не обещан безусловно — он рождается не всегда', () => {
    const doc = installDoc(packedAgents(), '/выдача/agents-bundle');

    // «Рядом появится <файл>» — обещание, которое дверь держит не всегда:
    // обвесу может быть нечего в него положить (`tasker:BASER2-124`). Читатель,
    // ждущий файла, который никогда не придёт, идёт искать поломку.
    expect(doc).not.toContain('Рядом появится');
    expect(doc).toContain(
      'только тогда, когда обвесу есть что в него положить',
    );
    expect(doc).toContain('не трогает и не удаляет');
  });

  it('цена подтверждения названа по КЛАССУ каждого артефакта', () => {
    const doc = installDoc(packedAgents(), '/выдача/agents-bundle');

    // Дока обещала «подтверждённый файл заменяется целиком» на оба класса
    // сразу, и для `placed-once` это неправда (`tasker:BASER2-123`). У этого
    // обвеса классы разные — значит и цена обязана быть названа врозь, с
    // путями: подтверждают тоже поимённо.
    expect(doc).toContain('regenerated');
    expect(doc).toContain('placed-once');
    expect(doc).toContain('содержимое не изменится');
    expect(doc).toContain('заменяется целиком');
    // Каждая цена стоит рядом со СВОИМ путём, а не сама по себе.
    const once = doc.indexOf('.omnifield/harness.yaml`): **содержимое');
    expect(once).toBeGreaterThan(-1);
  });

  it('обвес без артефактов не рассказывает про цену подтверждения', () => {
    const empty = {
      ok: true,
      manifest: {
        source: {
          id: 'omnifield/пусто',
          title: 'Ничего не кладёт',
          package: { name: '@omnifield/пусто', version: '0.0.1' },
        },
        artifacts: [],
        files: [],
      },
    } as unknown as PackReport;

    // Цена без единого артефакта — рассказ про класс того, чего нет. Ветка «все
    // артефакты этого обвеса» соврала бы про пустое множество.
    expect(installDoc(empty, '/выдача/пусто')).not.toContain(
      'все артефакты этого обвеса',
    );
  });
});

describe('флаг, не относящийся к команде, отказывает', () => {
  it('`check --confirm` не проглатывается молча', async () => {
    const outcome = await cli(
      ['check', 'packages/baser-devbox', '--confirm', 'a.txt'],
      process.cwd(),
    );

    // Молчание тут — ровно то, от чего файл разбора отгораживается абзацем
    // выше: «незнакомый флаг — отказ, а не пропустим». Флаг, знакомый ДРУГОЙ
    // команде, для этой ничем не лучше опечатки: человек уверен, что подтвердил,
    // а согласие ушло в пустоту.
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('--confirm');
    expect(outcome.stdout).toContain('check');
  });

  it('`plan --into` не проглатывается молча', async () => {
    const outcome = await cli(['plan', '--into', '/tmp/x'], process.cwd());

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('--into');
  });

  it('свой флаг у своей команды по-прежнему работает', async () => {
    consumer = installDevbox({
      config: { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] },
    });

    const outcome = await cli(
      ['plan', '--cwd', consumer.root, '--confirm', 'a.txt'],
      process.cwd(),
    );

    // Отказ обязан быть УЗКИМ: закрыли лишнее, а не работающее.
    expect(outcome.exitCode).toBe(0);
  });
});

describe('словарь — тот, что в каноне', () => {
  it('«деталь подходит патрону» не звучит ни в подсказке, ни в ответе', async () => {
    const outcome = await cli(
      ['check', 'packages/baser-devbox'],
      process.cwd(),
    );

    // Канон поправлен (`kb:BASER2-9`): деталь — то, что станок ПРОИЗВОДИТ,
    // то есть продукт; обвес подходит ПОСАДОЧНОМУ МЕСТУ, из которых патрон
    // лишь одно. Зона приводится следом, а не закрепляет молча своё чтение.
    for (const text of [USAGE, outcome.stdout]) {
      expect(text).not.toMatch(/деталь/i);
      expect(text).not.toMatch(/патрон/i);
    }
    expect(USAGE).toContain('посадочному месту');
  });

  it('справка про --confirm не обещает перезаписи, а называет оба класса', () => {
    // Одна строка справки стоила первому чужому обвесу подготовки к потере
    // заполненного руками файла (`tasker:BASER2-123`). Поведение было верным —
    // врал текст, поэтому проба стоит на тексте.
    expect(USAGE).not.toMatch(/--confirm.*перезапис/);
    expect(USAGE).toContain('во владение');
    expect(USAGE).toContain('regenerated');
    expect(USAGE).toContain('placed-once');
    expect(USAGE).toContain('содержимое не трогается');
  });
});

describe('публичная поверхность равна фактической', () => {
  it('soleRun отдан через публичный вход', async () => {
    consumer = installDevbox({
      config: { formVersion: 2, sources: [{ use: DEVBOX_PACKAGE }] },
    });

    const result = await run({ command: 'plan', cwd: consumer.root });

    // Сосед держится за него глубоким путём в наш `src/lib` (`tasker:BASER2-59`).
    // Пока хелпер не отдан наружу, любая перекладка наших тестовых файлов
    // краснит ЧУЖУЮ зону — а сигнала об этой зависимости у нас нет.
    expect(soleRun(result).source.id).toBe('omnifield/devbox');
  });
});

describe('отказ набора доезжает до человека читаемым текстом', () => {
  it('артефакт целится в файл настроек соседа — сказано словами, а не кодом', async () => {
    // Свойство НАБОРА: чужой файл настроек виден только рядом с чужим
    // объявлением (`artifact-over-source-config`, приехал из контрактов).
    const rival: SourceSpec = {
      packageName: '@omnifield/brain-harness',
      id: 'omnifield/agent-harness',
      title: 'Плагин агент-харнесса',
      layout: [
        {
          src: 'tuning.yaml',
          dest: '.omnifield/omnifield-devbox.yaml',
          render: false,
        },
      ],
      templates: { 'tuning.yaml': 'baser: {}\n' },
    };
    consumer = installDevbox({
      config: {
        formVersion: 2,
        sources: [{ use: DEVBOX_PACKAGE }, { use: rival.packageName }],
      },
    });
    consumer.installSource(rival);

    const result = await run({ command: 'plan', cwd: consumer.root });
    const text = renderText(result);

    expect(result.status).toBe('refused');
    expect(result.problems[0].code).toBe('artifact-over-source-config');
    // Код нужен гейту, человеку нужен текст: что случилось, где и почему это
    // не чинится подтверждением.
    expect(text).toContain('artifact-over-source-config');
    expect(text).toContain('файл настроек');
    expect(text).toContain('.omnifield/omnifield-devbox.yaml');
  });
});
