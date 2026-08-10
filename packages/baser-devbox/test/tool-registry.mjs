/**
 * НАСТОЯЩАЯ УСТАНОВКА ИНСТРУМЕНТА ЛОКАЦИИ: стаб-реестр, настоящий тарбол, клетка.
 *
 * Фикстура заведена в `tools.spec.mjs` (`tasker:BASER2-274`) и вынесена сюда, когда
 * второй пробе понадобилось то же самое (`tasker:BASER2-292`, фиксация редакций).
 * Копия жила бы ровно до первой правки: клетка вокруг npm — не аккуратность, а
 * условие, при котором проба вообще меряет обвес, и разъехавшиеся клетки означали
 * бы, что одна из проб тихо ходит в настоящий реестр и в машину прогона.
 *
 * ── ПОЧЕМУ СТАБ ОТДАЁТ НАСТОЯЩИЙ ТАРБОЛ ─────────────────────────────────────
 *
 * Изображать установку подставным `npm` было бы половиной имитации
 * (`kb:BASER2-2` §5): она доказала бы, что мы позвали менеджер, и промолчала бы о
 * том, кладёт ли глобальная установка команду туда, где её потом ищут, и что
 * `npm ls -g` про неё потом ответит. Поэтому пакет собирается настоящим `npm pack`,
 * а реестр отвечает на то же, что спрашивает установка: манифест и тарбол.
 *
 * Подставной менеджер у зоны тоже есть и живёт в `manager-noise.spec.mjs` — там
 * предмет другой (С ЧЕМ позвали), и там он честен.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Тарбол настоящего пакета с командой, собранный настоящим `npm pack`.
 *
 * @param {{ name: string, version: string, bin: string, says: string, box: (prefix: string) => string }} tool
 */
export function packTool({ name, version, bin, says, box }) {
  const source = join(box('tool-src'), 'tool');
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, 'package.json'),
    `${JSON.stringify({ name, version, bin: { [bin]: 'bin.js' } }, null, 2)}\n`,
  );
  writeFileSync(
    join(source, 'bin.js'),
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${says}\n`)});\n`,
  );

  const out = box('tool-pack');
  execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', out, source],
    { stdio: 'pipe' },
  );
  const file = readdirSync(out).find((entry) => entry.endsWith('.tgz'));
  return readFileSync(join(out, file));
}

/**
 * Реестр, отвечающий на то, что спрашивает установка: манифест и тарбол.
 *
 * Версия здесь ПАРАМЕТР, а не константа, и это нужно фиксации редакций: `latest`
 * обязан однажды поехать на другой номер, иначе «запись следит за фактом» нечем
 * доказать — запись совпала бы с прошлой сама собой.
 *
 * @param {{ name: string, version: string, bin: string, tarball: Buffer }} tool
 */
export async function withRegistry(tool, body) {
  const asked = [];
  let base = '';
  const server = createServer((req, res) => {
    asked.push(decodeURIComponent(req.url));
    if (req.url.endsWith('.tgz')) {
      res.setHeader('content-type', 'application/octet-stream');
      res.end(tool.tarball);
      return;
    }
    if (decodeURIComponent(req.url) !== `/${tool.name}`) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        name: tool.name,
        'dist-tags': { latest: tool.version },
        versions: {
          [tool.version]: {
            name: tool.name,
            version: tool.version,
            bin: { [tool.bin]: 'bin.js' },
            dist: {
              tarball: `${base}/tarball/tool.tgz`,
              integrity: `sha512-${createHash('sha512').update(tool.tarball).digest('base64')}`,
            },
          },
        },
      }),
    );
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await body({ base, asked });
  } finally {
    server.close();
  }
}

/**
 * Окружение установки: изображает контейнер и СИДИТ В КЛЕТКЕ.
 *
 * Клетка — не аккуратность: глобальная установка без своего префикса легла бы в
 * машину прогона, а конфиг пользователя привёл бы её в настоящий реестр. Имена
 * строчные (`npm_config_*`) намеренно: они бьют одноимённые UPPERCASE, и ровно
 * этим у зоны уже разъезжалась клетка (`test/env.mjs`).
 */
export function installEnv(base, prefix, box) {
  return {
    npm_config_registry: `${base}/`,
    npm_config_prefix: prefix,
    npm_config_cache: box('npm-cache'),
    npm_config_userconfig: join(box('npm-conf'), 'npmrc'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}
