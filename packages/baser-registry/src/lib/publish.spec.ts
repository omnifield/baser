/**
 * ПУБЛИКАЦИЯ КОМАНДОЙ ИНСТРУМЕНТА — живьём, обоими менеджерами.
 *
 * Проверяется главное обещание: **человеку не нужно знать про `npmrc`, флаги
 * скоупа и разницу менеджеров, чтобы положить товар на свой склад.** Поэтому
 * пробы зовут ровно то, что зовёт человек, — одну команду, — и не помогают ей
 * ничем: ни конфигом, ни адресом, ни выбором менеджера.
 *
 * Негативный контроль обязателен и стоит рядом с каждым позитивным: в этом
 * девбоксе скоуп `@omnifield` настроен на GitHub Packages, поэтому «уехало
 * куда надо» без него не значит ничего (`kb:BASER3-39`).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shopLayout } from './layout.js';
import { HOME_VARIABLE } from './location.js';
import { ShopProblemLog } from './problems.js';
import {
  chooseManager,
  fingerprintOf,
  judgeRelease,
  lookOnShelf,
  npmrcFor,
  readManifest,
  sameContent,
} from './publish.js';
import { cli } from './cli.js';
import { exitCodeOf, SCHEMA_VERSION, type ShopResult } from './result.js';
import { down, publish, up } from './shop.js';

let root: string;
let shopRoot: string;
let address: string;
let port: number;

/** Магазин пробы живёт в своём месте: чужой ~/.local/share не трогаем. */
let options: {
  environment: NodeJS.ProcessEnv;
  scopes: () => Promise<never[]>;
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'baser-registry-publish-'));
  shopRoot = mkdtempSync(join(tmpdir(), 'baser-registry-publish-shop-'));
  options = {
    environment: { [HOME_VARIABLE]: shopRoot },
    scopes: async () => [],
  };
  port = await freePort();

  const config = shopLayout(options.environment).config;
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, `port: ${port}\n`, 'utf8');

  address = `http://127.0.0.1:${port}`;
  await up({ cwd: root, ...options });
}, 120_000);

afterAll(async () => {
  if (root) {
    await down({ cwd: root, ...options });
    rmSync(root, { recursive: true, force: true });
    rmSync(shopRoot, { recursive: true, force: true });
  }
}, 120_000);

describe('одна команда кладёт товар на склад — без npm-грамоты', () => {
  it('обычный пакет уезжает на свой склад, и это НЕ чужой реестр', async () => {
    // Негативный контроль встроен в сам случай: скоуп @omnifield в этом
    // девбоксе настроен на GitHub Packages, и без нашей защиты пакет уехал бы
    // туда — молча, с нулевым кодом возврата.
    const where = makePackage('@omnifield/publish-plain', '0.1.0');

    const answer = await publish({ cwd: root, directory: where, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.published[0]?.manager).toBe('npm');
    expect(answer.published[0]?.destination).toBe(address);
    expect(await onShelfHere('@omnifield/publish-plain')).toBe(true);
  }, 120_000);

  it('НЕГАТИВНЫЙ КОНТРОЛЬ: чужой СКОУП в окружении не уводит товар', async () => {
    // ЯД ВЫБРАН ЗАМЕРОМ, а не наугад — и первые две попытки были мимо.
    //
    // Приоритет источников у менеджеров РАЗНЫЙ (замер 2026-08-08):
    //
    //   npm   — переменная окружения бьёт и `.npmrc` проекта, И флаг `--registry`
    //   pnpm  — `.npmrc` проекта бьёт переменную окружения
    //
    // Отсюда: единственное место, где чистка окружения реально решает, — это
    // npm-путь, и травить надо СКОУПНОЙ переменной. Общая (`npm_config_registry`)
    // на пакет со скоупом не влияет вовсе, а на pnpm-пути яд бессилен по
    // построению — файл сильнее.
    //
    // Проверено на способность краснеть: со снятой чисткой окружения эта проба
    // падает, а прежние её версии — нет.
    const key = 'npm_config_@omnifield:registry';
    const was = process.env[key];
    process.env[key] = 'https://npm.pkg.github.com';
    const where = makePackage('@omnifield/publish-poisoned', '0.1.0');

    try {
      const answer = await publish({ cwd: root, directory: where, ...options });

      expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
      expect(answer.published[0]?.manager).toBe('npm');
      expect(answer.published[0]?.destination).toBe(address);
    } finally {
      if (was === undefined) delete process.env[key];
      else process.env[key] = was;
    }
  }, 120_000);

  it('пакет с workspace: публикуется pnpm и приезжает С ВЕРСИЕЙ', async () => {
    // npm опубликовал бы его УСПЕШНО и сломанным: `workspace:*` в манифесте не
    // ставится нигде. Выбор менеджера — работа инструмента, а не человека.
    const app = makeWorkspace('plain', '5.6.7');

    const answer = await publish({ cwd: root, directory: app, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.published[0]?.manager).toBe('pnpm');
    expect(answer.published[0]?.needsWorkspace).toBe(true);

    const manifest = await fromShelf('@omnifield/publish-app-plain', '0.2.0');
    expect(manifest.dependencies).toEqual({
      '@omnifield/publish-lib-plain': '5.6.7',
    });
  }, 180_000);

  it('ПОВТОР спокоен: «уже на складе», а не «сломалось»', async () => {
    // `up` и `down` в этой зоне идемпотентны, `publish` из ряда выпадал: восемь
    // отказов подряд на исправном складе, и человек шёл чинить то, что не
    // сломано (`tasker:BASER2-257`).
    const where = makePackage('@omnifield/publish-twice', '0.1.0');

    const first = await publish({ cwd: root, directory: where, ...options });
    expect(first.outcome, JSON.stringify(first.problems)).toBe('published');

    const again = await publish({ cwd: root, directory: where, ...options });

    expect(again.outcome).toBe('already-published');
    // Успех, а не отказ: конвейер, публикующий десять пакетов, не должен
    // падать на том, что три из них уже там.
    expect(exitCodeOf(again)).toBe(0);
    expect(again.problems).toEqual([]);
    // И товар при этом назван — человеку видно, о чём речь.
    expect(again.published[0]?.name).toBe('@omnifield/publish-twice');
    expect(again.published[0]?.version).toBe('0.1.0');
  }, 180_000);

  it('и склад повтором НЕ меняется — то же состояние, а не перезапись', async () => {
    const where = makePackage('@omnifield/publish-untouched', '0.2.0');
    await publish({ cwd: root, directory: where, ...options });

    const before = await shelfEntry('@omnifield/publish-untouched');
    await publish({ cwd: root, directory: where, ...options });
    const after = await shelfEntry('@omnifield/publish-untouched');

    expect(Object.keys(after.versions)).toEqual(Object.keys(before.versions));
    expect(after.versions['0.2.0']?.dist?.shasum).toBe(
      before.versions['0.2.0']?.dist?.shasum,
    );
  }, 180_000);

  it('ДРУГАЯ версия того же пакета публикуется как обычно', async () => {
    // «Пакет есть» и «эта версия есть» — разные утверждения; спутать их значило
    // бы молча не публиковать новое.
    const first = makePackage('@omnifield/publish-next', '0.1.0');
    await publish({ cwd: root, directory: first, ...options });

    const second = makePackage('@omnifield/publish-next', '0.2.0');
    const answer = await publish({ cwd: root, directory: second, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    const shelf = await shelfEntry('@omnifield/publish-next');
    expect(Object.keys(shelf.versions).sort()).toEqual(['0.1.0', '0.2.0']);
  }, 180_000);

  it('чужой .npmrc возвращается на место — и содержимым, и отсутствием', async () => {
    // Правка в дереве человека обязана быть возвратной по построению.
    const where = makePackage('@omnifield/publish-keeps-npmrc', '0.1.0');
    const mine = join(where, '.npmrc');
    writeFileSync(mine, '# моё, не трогать\n', 'utf8');

    await publish({ cwd: root, directory: where, ...options });

    expect(readFileSync(mine, 'utf8')).toBe('# моё, не трогать\n');

    const clean = makePackage('@omnifield/publish-no-npmrc', '0.1.0');
    await publish({ cwd: root, directory: clean, ...options });

    expect(existsSync(join(clean, '.npmrc'))).toBe(false);
  }, 120_000);
});

describe('публикация говорит тремя действиями, и они отказывают порознь', () => {
  /** Пакет, который выпустили, а потом тронули: три пробы ниже про него. */
  let frozen: string;

  it('удачный прогон называет ВСЕ ТРИ, и объявление в нём молчит', async () => {
    // Третье действие — самое дешёвое и самое лёгкое забыть. Витрины у нас нет
    // вовсе, и это рабочее состояние (`kb:WORLD-34`): значит шаг обязан
    // ПРИСУТСТВОВАТЬ и молчать. Отсутствие строки означало бы «мы про это не
    // подумали», а это другое утверждение.
    const where = makePackage('@omnifield/publish-three', '0.1.0');

    const answer = await publish({ cwd: root, directory: where, ...options });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.publication?.release.outcome).toBe('done');
    expect(answer.publication?.shipment.outcome).toBe('done');
    expect(answer.publication?.announcement.outcome).toBe('silent');
    expect(answer.publication?.announcement.reason).toBe('no-storefront');
    // И то же самое построчно: у пакета партии свои три действия.
    expect(answer.published[0]?.steps.announcement.outcome).toBe('silent');
  }, 120_000);

  it('ПОВТОР тем же товаром: выпуску нечего замораживать, отгрузке нечего везти', async () => {
    const where = makePackage('@omnifield/publish-three-again', '0.1.0');
    await publish({ cwd: root, directory: where, ...options });

    const again = await publish({ cwd: root, directory: where, ...options });

    expect(again.outcome).toBe('already-published');
    expect(exitCodeOf(again)).toBe(0);
    expect(again.publication?.release.outcome).toBe('nothing-to-do');
    expect(again.publication?.shipment.outcome).toBe('nothing-to-do');
    expect(again.publication?.announcement.outcome).toBe('silent');
  }, 180_000);

  it('СОДЕРЖИМОЕ РАЗОШЛОСЬ ПОД ТЕМ ЖЕ НОМЕРОМ — отказ ВЫПУСКА, а не склада', async () => {
    // Ровно тот случай, который год приезжал успехом с кодом 0: склад отвечал
    // «версия есть», и порча выпущенного проглатывалась молча.
    frozen = makePackage('@omnifield/publish-frozen', '0.1.0');
    const first = await publish({ cwd: root, directory: frozen, ...options });
    expect(first.outcome, JSON.stringify(first.problems)).toBe('published');

    writeFileSync(join(frozen, 'index.js'), 'правка после выпуска\n', 'utf8');
    const again = await publish({ cwd: root, directory: frozen, ...options });

    expect(again.outcome).toBe('refused');
    // Вход непригоден, и чинит его человек, — это не «склад сломался».
    expect(exitCodeOf(again)).toBe(2);
    expect(again.publication?.release.outcome).toBe('refused');
    expect(again.publication?.release.reason).toBe('release-frozen');
    // ОТГРУЗКИ НЕ БЫЛО ВОВСЕ: до склада дело не дошло.
    expect(again.publication?.shipment.outcome).toBe('skipped');
    expect(again.problems.map((one) => one.code)).toContain('release-frozen');

    // И СКЛАД ПРИ ЭТОМ НЕ ТРОНУТ — ни перезаписью, ни услужливым «поднимем
    // номер за вас»: лежит ровно один выпуск, и содержимое в нём прежнее.
    // Утверждение живёт здесь, а не отдельной пробой: само по себе оно зеленело
    // бы и на старом поведении — склад и так не даёт себя перезаписать.
    const shelf = await shelfEntry('@omnifield/publish-frozen');
    expect(Object.keys(shelf.versions)).toEqual(['0.1.0']);
    expect(shelf.versions['0.1.0']?.dist?.integrity).not.toBe(
      fingerprintOf('npm', frozen).print?.integrity,
    );
  }, 180_000);

  it('обещание отказа исполняется: поднял номер — уехало', async () => {
    // Путь восстановления, названный в тексте отказа, — такой же контракт, как
    // код, и прогоняется он буквально (`kb:BASER3-10`).
    writeFileSync(
      join(frozen, 'package.json'),
      JSON.stringify({
        name: '@omnifield/publish-frozen',
        version: '0.2.0',
        license: 'MIT',
      }),
      'utf8',
    );

    const answer = await publish({
      cwd: root,
      directory: frozen,
      ...options,
    });

    expect(answer.outcome, JSON.stringify(answer.problems)).toBe('published');
    expect(answer.publication?.release.outcome).toBe('done');
  }, 180_000);

  it('партию не режут пополам: сосед с занятым номером останавливает всех', async () => {
    // Отказ выпуска на третьем пакете из пяти оставил бы склад в состоянии,
    // которого никто не выбирал, — а уехавшее со склада не забирается.
    const clone = mkdtempSync(join(root, 'партия-'));
    mkdirSync(join(clone, '.git'), { recursive: true });
    for (const [where, name] of [
      ['packages/целый', '@omnifield/publish-batch-clean'],
      ['packages/порченый', '@omnifield/publish-batch-frozen'],
    ] as const) {
      mkdirSync(join(clone, where), { recursive: true });
      writeFileSync(
        join(clone, where, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', license: 'MIT' }),
        'utf8',
      );
    }
    mkdirSync(join(clone, '.omnifield'), { recursive: true });
    writeFileSync(
      join(clone, '.omnifield', 'omnifield-registry.yaml'),
      'batch:\n  - packages/целый\n  - packages/порченый\n',
      'utf8',
    );

    const first = await publish({ cwd: clone, ...options });
    expect(first.outcome, JSON.stringify(first.problems)).toBe('published');

    // Целому дают НОВЫЙ номер — то есть настоящую работу, которую видно на
    // складе, — а порченому правят содержимое под старым. Так проба меряет не
    // формулировку шага, а факт: уехал целый или нет.
    writeFileSync(
      join(clone, 'packages/целый', 'package.json'),
      JSON.stringify({
        name: '@omnifield/publish-batch-clean',
        version: '1.1.0',
        license: 'MIT',
      }),
      'utf8',
    );
    writeFileSync(
      join(clone, 'packages/порченый', 'index.js'),
      'правка после выпуска\n',
      'utf8',
    );
    const again = await publish({ cwd: clone, ...options });

    expect(again.outcome).toBe('refused');
    expect(again.publication?.release.reason).toBe('release-frozen');
    // ГЛАВНОЕ: целый НЕ УЕХАЛ, хотя сам он в полном порядке. Отказ выпуска на
    // одном пакете останавливает партию ДО первой живой отгрузки — уехавшее со
    // склада не забирается.
    const shelf = await shelfEntry('@omnifield/publish-batch-clean');
    expect(Object.keys(shelf.versions)).toEqual(['1.0.0']);

    const clean = again.published.find(
      (one) => one.name === '@omnifield/publish-batch-clean',
    );
    expect(clean?.steps.release.outcome).toBe('done');
    expect(clean?.steps.shipment.outcome).toBe('skipped');
  }, 240_000);

  it('--json отдаёт три действия ПОЛЯМИ, и текст им не нужен', async () => {
    // Приёмочный критерий формы ответа: операцию можно вызвать программно и
    // получить полный результат данными, ни разу не разобрав текст
    // (`kb:BASER3-10`). Поэтому проба РАЗБИРАЕТ вывод, а не сверяет подстроки.
    const where = makePackage('@omnifield/publish-json', '0.1.0');
    const was = process.env[HOME_VARIABLE];
    process.env[HOME_VARIABLE] = shopRoot;

    try {
      const outcome = await cli(['publish', where, '--json'], root);
      const answer = JSON.parse(outcome.stdout) as ShopResult;

      expect(outcome.exitCode).toBe(0);
      expect(answer.schemaVersion).toBe(SCHEMA_VERSION);
      expect(answer.publication?.release.step).toBe('release');
      expect(answer.publication?.shipment.outcome).toBe('done');
      expect(answer.publication?.announcement.reason).toBe('no-storefront');
    } finally {
      if (was === undefined) delete process.env[HOME_VARIABLE];
      else process.env[HOME_VARIABLE] = was;
    }
  }, 120_000);
});

describe('отказы называются, а не случаются', () => {
  it('нет package.json — отказ с кодом и каталогом', async () => {
    const empty = mkdtempSync(join(root, 'пусто-'));

    const answer = await publish({ cwd: root, directory: empty, ...options });

    expect(answer.outcome).toBe('refused');
    expect(answer.problems.map((one) => one.code)).toContain('manifest-missing');
  }, 60_000);

  it('НАСТОЯЩАЯ беда остаётся отказом, а не «уже на складе»', async () => {
    // Спокойный исход добавлен только для «состояние достигнуто». Пакет,
    // который менеджер отказался публиковать, на складе не появился — и
    // называть это «делать нечего» значило бы вернуть ту же склейку исходов,
    // только с другой стороны.
    const where = mkdtempSync(join(root, 'битый-'));
    writeFileSync(
      join(where, 'package.json'),
      JSON.stringify({ name: '@omnifield/ПЛОХОЕ-ИМЯ', version: '0.1.0' }),
      'utf8',
    );

    const answer = await publish({ cwd: root, directory: where, ...options });

    expect(answer.outcome).toBe('failed');
    expect(answer.problems.map((one) => one.code)).toContain('publish-failed');
  }, 120_000);

  it('магазин закрыт — класть некуда, и это сказано до правки чужих файлов', async () => {
    const closed = mkdtempSync(join(tmpdir(), 'baser-registry-closed-'));
    const closedShop = mkdtempSync(join(tmpdir(), 'baser-registry-closed-shop-'));
    const closedEnv = { [HOME_VARIABLE]: closedShop };
    const config = shopLayout(closedEnv).config;
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, `port: ${await freePort()}\n`, 'utf8');
    const where = makePackage('@omnifield/publish-nowhere', '0.1.0', closed);

    try {
      const answer = await publish({
        cwd: closed,
        directory: where,
        environment: closedEnv,
        scopes: async () => [],
      });

      expect(answer.outcome).toBe('refused');
      expect(answer.problems.map((one) => one.code)).toContain('shop-closed');
      // «До склада нет дороги» — отказ ОТГРУЗКИ, и видно это отдельно от
      // выпуска: выпуск здесь не рассудили вовсе, потому что судят его по
      // складу, а склада нет.
      expect(answer.publication?.shipment.outcome).toBe('refused');
      expect(answer.publication?.shipment.reason).toBe('shop-closed');
      expect(answer.publication?.release.outcome).toBe('skipped');
      // До чужого каталога дело не дошло: отказ не оставляет следов.
      expect(existsSync(join(where, '.npmrc'))).toBe(false);
    } finally {
      rmSync(closed, { recursive: true, force: true });
      rmSync(closedShop, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('менеджер выбирается по манифесту, а не по вкусу', () => {
  it('workspace: в любом наборе зависимостей требует pnpm', () => {
    const problems = new ShopProblemLog();
    for (const set of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const where = mkdtempSync(join(root, 'манифест-'));
      writeFileSync(
        join(where, 'package.json'),
        JSON.stringify({
          name: 'сосед',
          version: '1.0.0',
          [set]: { 'что-то': 'workspace:*' },
        }),
        'utf8',
      );

      const manifest = readManifest(where, problems);

      expect(manifest?.needsWorkspace, set).toBe(true);
      expect(chooseManager(manifest?.needsWorkspace ?? false)).toBe('pnpm');
    }
  });

  it('без workspace: хватает npm', () => {
    expect(chooseManager(false)).toBe('npm');
  });
});

describe('вопрос складу отвечает фактом, а не догадкой', () => {
  it('нет такой версии — значит номер свободен, и это не отказ', async () => {
    expect(
      await lookOnShelf(address, '@omnifield/publish-plain', '9.9.9'),
    ).toBeNull();
  });

  it('пакета нет вовсе — тоже спокойное «нет»', async () => {
    expect(
      await lookOnShelf(address, '@omnifield/никогда-не-был', '1.0.0'),
    ).toBeNull();
  });

  it('склад не отвечает — утверждать нечего, отвечаем «нет»', async () => {
    // Иначе недоступный склад читался бы как «всё уже опубликовано».
    expect(
      await lookOnShelf('http://127.0.0.1:1', '@omnifield/что-угодно', '1.0.0'),
    ).toBeNull();
  }, 30_000);

  it('номер занят — склад называет ОТПЕЧАТОК лежащего, а не только «да»', async () => {
    // Ради этого поля ответ и перестал быть булевым: «занят» само по себе не
    // отличает тот же выпуск от правки выпущенного (`tasker:BASER2-287`).
    const found = await lookOnShelf(address, '@omnifield/publish-plain', '0.1.0');

    expect(found).not.toBeNull();
    expect(found?.integrity).toMatch(/^sha\d+-/);
  });
});

describe('отпечаток — тот самый тарбол, а не похожая величина', () => {
  it('отпечаток сухого прогона СОВПАДАЕТ с тем, что легло на склад', async () => {
    // Вся сверка выпуска стоит на этом равенстве. Разойдётся — каждый повтор
    // станет «правишь выпущенное», то есть решение `tasker:BASER2-257`
    // отменится молча.
    const where = makePackage('@omnifield/publish-print', '0.1.0');
    await publish({ cwd: root, directory: where, ...options });

    const ours = fingerprintOf('npm', where);
    const onShelf = await lookOnShelf(address, '@omnifield/publish-print', '0.1.0');

    expect(ours.print, ours.said).not.toBeNull();
    expect(onShelf).not.toBeNull();
    expect(ours.print?.integrity).toBe(onShelf?.integrity);
  }, 120_000);

  it('правка содержимого отпечаток МЕНЯЕТ — иначе он ничего не стережёт', () => {
    const where = makePackage('@omnifield/publish-print-edit', '0.1.0');
    const before = fingerprintOf('npm', where);

    writeFileSync(join(where, 'index.js'), 'дописали строку\n', 'utf8');
    const after = fingerprintOf('npm', where);

    expect(before.print?.integrity).not.toBeNull();
    expect(after.print?.integrity).not.toBe(before.print?.integrity);
  }, 60_000);

  it('пакет, который менеджер не собрал, отпечатка не даёт', () => {
    // «Сверить нечем» обязано быть отличимо от «сверили и совпало»: иначе
    // несобираемый пакет проезжал бы под занятым номером как повтор.
    const where = mkdtempSync(join(root, 'битый-'));
    writeFileSync(
      join(where, 'package.json'),
      JSON.stringify({ name: '@omnifield/ПЛОХОЕ-ИМЯ', version: '0.1.0' }),
      'utf8',
    );

    expect(fingerprintOf('npm', where).print).toBeNull();
  }, 60_000);

  it('сверять нечем — это null, а не «одно и то же»', () => {
    const empty = { integrity: null, shasum: null };

    expect(sameContent(empty, { integrity: 'sha512-что-то', shasum: null })).toBeNull();
    // Запасное поле работает, когда сильного нет ни у кого.
    expect(
      sameContent(
        { integrity: null, shasum: 'абв' },
        { integrity: null, shasum: 'абв' },
      ),
    ).toBe(true);
  });
});

describe('выпуск судит номер, а не везёт товар', () => {
  it('номер свободен — выпуск состоялся, и менеджера ради этого не звали', () => {
    // Каталога вовсе нет: соберись здесь пакет, вердикт был бы другим.
    expect(judgeRelease(null, 'npm', join(root, 'такого-каталога-нет'))).toEqual({
      kind: 'free',
    });
  });

  it('тот же товар под тем же номером — это ПОВТОР, а не правка', async () => {
    const where = makePackage('@omnifield/publish-judge-same', '0.1.0');
    await publish({ cwd: root, directory: where, ...options });

    const onShelf = await lookOnShelf(
      address,
      '@omnifield/publish-judge-same',
      '0.1.0',
    );

    expect(judgeRelease(onShelf, 'npm', where).kind).toBe('same');
  }, 120_000);

  it('другое содержимое под тем же номером — правка выпущенного', async () => {
    const where = makePackage('@omnifield/publish-judge-diff', '0.1.0');
    await publish({ cwd: root, directory: where, ...options });
    writeFileSync(join(where, 'index.js'), 'а тут уже другое\n', 'utf8');

    const onShelf = await lookOnShelf(
      address,
      '@omnifield/publish-judge-diff',
      '0.1.0',
    );

    expect(judgeRelease(onShelf, 'npm', where).kind).toBe('diverged');
  }, 120_000);

  it('занято, а сверить нечем — отдельный вердикт, а не «совпало»', () => {
    const where = mkdtempSync(join(root, 'несобираемый-'));
    writeFileSync(
      join(where, 'package.json'),
      JSON.stringify({ name: '@omnifield/ТОЖЕ-ПЛОХОЕ', version: '0.1.0' }),
      'utf8',
    );

    expect(
      judgeRelease({ integrity: 'sha512-неважно', shasum: null }, 'npm', where)
        .kind,
    ).toBe('unjudged');
  }, 60_000);
});

describe('строки конфига называют адрес И на скоуп', () => {
  it('у пакета со скоупом строк три: общая, скоупная и токен', () => {
    // Скоуп-настройка бьёт общий адрес; без своей строки пакет уедет туда,
    // куда указывает чужой конфиг.
    const lines = npmrcFor('http://127.0.0.1:4873', '@omnifield/что-то')
      .trim()
      .split('\n');

    expect(lines).toEqual([
      'registry=http://127.0.0.1:4873',
      '@omnifield:registry=http://127.0.0.1:4873',
      '//127.0.0.1:4873/:_authToken=baser-registry',
    ]);
  });

  it('у пакета без скоупа скоупной строки нет — выдумывать нечего', () => {
    const lines = npmrcFor('http://127.0.0.1:4873', 'простой')
      .trim()
      .split('\n');

    expect(lines).toHaveLength(2);
  });
});

function makePackage(name: string, version: string, where = root): string {
  const directory = mkdtempSync(join(where, 'товар-'));
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name, version, license: 'MIT' }),
    'utf8',
  );
  return directory;
}

/** Мини-монорепа: пакет с зависимостью на соседа через `workspace:*`. */
function makeWorkspace(tag: string, libVersion: string): string {
  const where = mkdtempSync(join(root, 'монорепа-'));
  mkdirSync(join(where, 'packages', 'lib'), { recursive: true });
  mkdirSync(join(where, 'packages', 'app'), { recursive: true });

  writeFileSync(
    join(where, 'pnpm-workspace.yaml'),
    'packages:\n  - "packages/*"\n',
    'utf8',
  );
  writeFileSync(
    join(where, 'package.json'),
    JSON.stringify({ name: 'корень', private: true }),
    'utf8',
  );
  writeFileSync(
    join(where, 'packages', 'lib', 'package.json'),
    JSON.stringify({
      name: `@omnifield/publish-lib-${tag}`,
      version: libVersion,
      license: 'MIT',
    }),
    'utf8',
  );
  writeFileSync(
    join(where, 'packages', 'app', 'package.json'),
    JSON.stringify({
      name: `@omnifield/publish-app-${tag}`,
      version: '0.2.0',
      license: 'MIT',
      dependencies: { [`@omnifield/publish-lib-${tag}`]: 'workspace:*' },
    }),
    'utf8',
  );

  execFileSync('pnpm', ['install', '--silent', '--ignore-scripts'], {
    cwd: where,
    stdio: 'ignore',
  });

  return join(where, 'packages', 'app');
}

interface ShelfPackument {
  versions: Record<string, { dist?: { shasum?: string; integrity?: string } }>;
}

async function shelfEntry(name: string): Promise<ShelfPackument> {
  const response = await fetch(`${address}/${encodeURIComponent(name)}`);
  return (await response.json()) as ShelfPackument;
}

async function onShelfHere(name: string): Promise<boolean> {
  const response = await fetch(`${address}/${encodeURIComponent(name)}`);
  return response.ok;
}

async function fromShelf(
  name: string,
  version: string,
): Promise<{ dependencies?: Record<string, string> }> {
  const response = await fetch(`${address}/${encodeURIComponent(name)}`);
  const body = (await response.json()) as {
    versions: Record<string, { dependencies?: Record<string, string> }>;
  };
  return body.versions[version];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const found = (server.address() as AddressInfo).port;
      server.close(() => resolve(found));
    });
  });
}
