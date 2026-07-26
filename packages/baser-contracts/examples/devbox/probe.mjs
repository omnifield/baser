/**
 * Проба формы: описать РЕАЛЬНЫЙ `.devcontainer` этого репозитория объявлением
 * обвеса и сверить результат с файлом на диске.
 *
 * Приёмка формы — выразительность, а не покрытие: если реальный обвес формой не
 * описывается, плохая форма, а не пример.
 *
 *   node packages/baser-contracts/examples/devbox/probe.mjs
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
// ejs приезжает транзитивно с @nx/devkit (движок по форме — генератор Nx),
// поэтому резолвим от него, а не от корня.
const require = createRequire(
  join(
    repoRoot,
    'node_modules/.pnpm/@nx+devkit@23.1.0_nx@23.1.0/node_modules/@nx/devkit/package.json',
  ),
);
const ejs = require('ejs');

const declaration = JSON.parse(
  readFileSync(join(here, 'declaration.json'), 'utf-8'),
).baser;
const consumer = JSON.parse(
  readFileSync(join(here, 'consumer/baser.json'), 'utf-8'),
);

const ctx = { repo: { name: basename(repoRoot), root: repoRoot } };

/** Разрешение значений: дефолт обвеса → пресеты → заполненное пользователем. */
async function resolveSettings(spec, entry) {
  const values = {};
  for (const [key, setting] of Object.entries(spec)) {
    if ('defaultFrom' in setting) {
      const [file, fn] = setting.defaultFrom.split('#');
      const mod = await import(pathToFileURL(join(here, file)).href);
      values[key] = await mod[fn](ctx);
    } else {
      values[key] = setting.default;
    }
  }
  for (const name of entry.presets ?? []) {
    Object.assign(values, declaration.presets[name].values);
  }
  Object.assign(values, entry.settings ?? {});
  return values;
}

const contentRoot = join(here, declaration.source.contentRoot);

function render(item, values) {
  const src = readFileSync(join(contentRoot, item.src), 'utf-8');
  return item.render === false
    ? src
    : ejs.render(src, values, { filename: item.src });
}

/** Артефакт обязан быть валидным devcontainer'ом, а не просто текстом. */
function assertValidJsonc(text, label) {
  const stripped = text.replace(/^\s*\/\/.*$/gm, '');
  try {
    JSON.parse(stripped);
  } catch (cause) {
    throw new Error(`${label}: артефакт не разбирается как JSON — ${cause.message}`);
  }
}

/**
 * Расхождения, названные вслух заранее: в живом файле это РУЧНАЯ проза, а обвес
 * на её месте подставляет настройку. Не дефект формы — дефект был бы, если бы
 * расхождение было структурным.
 */
const EXPECTED_DELTAS = new Map([
  [
    '.devcontainer/devcontainer.json:2',
    'в файле руками написано «baser devbox», обвес подставляет настройку name («baser-devbox»)',
  ],
]);

let failures = 0;

// ── 1. Ровно то, что лежит в репозитории: дефолты + пресет omnifield, ноль
//       заполненных пользователем значений.
console.log('# слой «универсальное + настройки + пресет» — сверка с живым файлом\n');
const values = await resolveSettings(declaration.settings, consumer.sources[0]);
for (const item of declaration.layout) {
  const produced = render(item, values);
  const actual = readFileSync(join(repoRoot, item.dest), 'utf-8');
  const a = produced.split('\n');
  const b = actual.split('\n');
  const unexpected = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const declared = EXPECTED_DELTAS.get(`${item.dest}:${i + 1}`);
    if (declared) {
      console.log(`НАЗВАНО    ${item.dest}:${i + 1} — ${declared}`);
    } else {
      unexpected.push(`  строка ${i + 1}\n   обвес: ${a[i]}\n    репо: ${b[i]}`);
    }
  }
  failures += unexpected.length ? 1 : 0;
  console.log(
    `${unexpected.length ? 'РАЗОШЛОСЬ' : 'СОШЛОСЬ  '}  ${item.dest}`,
  );
  unexpected.forEach((line) => console.log(line));
}
console.log('\nзначения настроек:', JSON.stringify(values, null, 2));

// ── 2. Тот же обвес БЕЗ пресета: внешний пользователь, которому omnifield не нужен.
console.log('\n\n# слой «универсальное» — тот же обвес без пресета\n');
const bare = await resolveSettings(declaration.settings, { use: entryUse() });
const bareArtifact = render(declaration.layout[0], bare);
assertValidJsonc(bareArtifact, 'без пресета');
console.log(bareArtifact);

// ── 3. Пользователь заполнил значение — оно бьёт и дефолт, и пресет.
console.log('\n# слой «настройки» — заполненное значение поверх пресета\n');
const filled = await resolveSettings(declaration.settings, {
  use: entryUse(),
  presets: ['omnifield'],
  settings: { runtimeVersion: '24', installCommand: 'npm ci' },
});
const filledArtifact = render(declaration.layout[0], filled);
assertValidJsonc(filledArtifact, 'с заполненными значениями');
for (const line of filledArtifact.split('\n')) {
  if (/"image"|"postCreateCommand"/.test(line)) console.log(line);
}

function entryUse() {
  return consumer.sources[0].use;
}

process.exit(failures === 0 ? 0 : 1);
