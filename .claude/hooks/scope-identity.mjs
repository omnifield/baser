#!/usr/bin/env node
// scope-identity.mjs — SessionStart hook: инжектит identity-баннер по OMNIFIELD_SCOPE.
// Роль-модель (зоны/пины моделей/число архитекторов) — ДАННЫЕ из `.omnifield/harness.yaml`
// (kb:BRAIN-3), НЕ хардкод. Роли-рамка (инварианты) — .claude/agents/{architect,owner,layer}.md.
//   - 'main'         → architect;  <zone> → owner-<zone>;  пусто → no-op;  невалид → anomaly.
//
// Contract (SessionStart): stdout { hookSpecificOutput: { hookEventName, additionalContext } }.
// Subagents (Agent tool) SessionStart НЕ триггерят — их identity из subagent_type prompt'а.

import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { knownScopes, loadConfig, resolveScope } from "./harness-config.mjs";

function silent() {
  process.stdout.write("{}");
  process.exit(0);
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
  );
  process.exit(0);
}

function modelLine(config, role) {
  const pin = config.models?.[role];
  return pin ? ` (модель-пин: \`${pin}\`)` : "";
}

function productLabel(config) {
  return config.product
    ? `продукта \`${config.product}\``
    : "этого продукта (имя не задано в `.omnifield/harness.yaml` → впиши `product:`)";
}

/**
 * Сид не заполнен под продукт (BRAIN2-8): product пуст/отсутствует ИЛИ равен placeholder'у
 * нейтрального шаблона (`my-product`). Тогда architect стартует в ОНБОРДИНГ-режим, а не как
 * настроенный продукт. Не паника — «это общий шаблон, первая задача = конфиг с user».
 */
export function needsOnboarding(config) {
  return !config.product || config.product === "my-product";
}

function onboardingBanner(config) {
  return [
    `# Session identity — OMNIFIELD_SCOPE=main (architect · ОНБОРДИНГ)${modelLine(config, "architect")}`,
    ``,
    `Ты **architect/main**, но \`.omnifield/harness.yaml\` — ещё НЕЗАПОЛНЕННЫЙ общий шаблон`,
    `(\`product: ${config.product ?? "(пусто)"}\`, зоны/пины — placeholder). Это НЕ аномалия и НЕ повод паниковать:`,
    `**твоя первая задача — ОНБОРДИНГ, не работа.** Заполни роль-модель под этот продукт ВМЕСТЕ с user.`,
    ``,
    `## Порядок онбординга`,
    `1. **Пойми проект** (known-места, не спрашивая других агентов): \`README\`/\`*.md\`, \`package.json\`/манифесты,`,
    `   \`git log\`/структура папок. Определи реальные пакеты/папки — будущие зоны.`,
    `2. **Найди роадмап/канон продукта в сервисах** (если есть): tasker/knowledger ws по ИМЕНИ продукта`,
    `   (версия-приоритет — старшая, напр. \`FOO2\` > \`FOO\`). Нет — не выдумывай.`,
    `   Доступ — **curl'ом через Bash, НЕ MCP** (тулзов может не быть — норма); базы в \`services\``,
    `   (\`harness.yaml\`) или соседи \`:8030\`/\`:8040\`; нет связи → сэндбокс off / \`curl .../healthz\`.`,
    `3. **Предложи user конфиг** и заполните \`harness.yaml\` вместе: \`product\`, \`zones\` (\`paths[]\` из РЕАЛЬНЫХ`,
    `   папок, disjoint), \`models\` (по факту сессии), \`grabli.workspace\`. Решения по продукту — за **user**.`,
    `4. **Проект пустой** (нечего изучать) → поговори с user: что строим, какие зоны в планах → засидь под это.`,
    ``,
    `## Пока сид не заполнен`,
    `- **Owner'ов НЕ поднимаем** — governance режет по placeholder-путям, owner упрётся в стену.`,
    `- **Непонятно — спрашивай USER** (не другого агента; агенты друг друга не зовут).`,
    `- Проверка после заполнения: \`node .claude/hooks/harness-doctor.mjs\`.`,
    `- Обвязку (\`.claude/\`, \`.omnifield/harness.yaml\`) — закоммить в репу; артефакты установки`,
    `  (\`agent-harness-plugin/\`, демо-папки) — НЕ коммить (gitignore).`,
  ].join("\n");
}

function architectBanner(config) {
  return [
    `# Session identity — OMNIFIELD_SCOPE=main (architect)${modelLine(config, "architect")}`,
    ``,
    `Ты в роли **architect/main** ${productLabel(config)}. Правила роли — \`.claude/agents/architect.md\` + \`.claude/agents/shared-policy.md\`.`,
    `Роль-модель — данные \`.omnifield/harness.yaml\` (архитекторов сконфигурено: ${config.architects}).`,
    ``,
    `- Триаж запросов user; арх-решения и контракты пишешь в **knowledger**; координируешь овнеров **задачами в tasker** (\`tasker:KEY\`).`,
    `- **НЕ пиши код зон сам** — ставишь задачу овнеру в tasker → owner-сессию запускает user.`,
    `- Вся координация — через tasker, знания/решения — через knowledger. Локальных \`briefs/\`-файлов НЕ заводим (истина снаружи репо).`,
    `- Git: полный доступ (commit/push/merge) — marker \`.claude/.main-session-id\` даёт права. Owner-сессии — под git-gate.`,
  ].join("\n");
}

function ownerBanner(config, { scope, paths, name }) {
  const list = paths.length
    ? paths.map((p) => `\`${p}/\``).join(", ")
    : "`(зона без путей — аномалия конфига)`";
  const firstPath = paths[0] ?? "<зона>";
  return [
    `# Session identity — OMNIFIELD_SCOPE=${scope} (owner-${scope})${modelLine(config, "owner")}`,
    ``,
    `Ты в роли **owner-${scope}** ${productLabel(config)}, владелец зоны: ${list} (${name}).`,
    `**Ты НЕ architect** — правила роли architect не твои.`,
    ``,
    `## Зона (boundary)`,
    `- Edits — ТОЛЬКО внутри своих папок: ${list}. Любой файл вне них → STOP, верни state architect.`,
    `- Машинная граница (governance-хук) блокирует Edit/Write вне этих путей — не обходи, эскалируй ВВЕРХ.`,
    `- Перед первым Edit прочитай свой раздел в knowledger + \`${firstPath}/README.md\` (если есть).`,
    ``,
    `## Правила (канон)`,
    `- Первым читаешь \`.claude/agents/shared-policy.md\`.`,
    `- **НЕ пиши ADR**, не принимай cross-zone решения — это architect. Упёрлось → STOP + эскалация.`,
    `- **Git: commit-only** (под git-gate). Push/merge — architect после ревью. Conventional: \`feat(${scope}): ...\`.`,
    `- Хук заблокировал git — НЕ обходи (\`bash -c\`/\`&&\`/\`--no-verify\`). STOP + эскалация.`,
    `- POLICY priority 0: никаких костылей, причина не следствие, DoD = код+тесты+трейсы+доки.`,
    ``,
    `## Скоуп задачи`,
    `Работаешь по задаче в **tasker** (\`tasker:KEY\`) или прямому ТЗ от user — НЕ по локальным файлам. Непонятен scope — STOP, спроси. Не угадывай.`,
  ].join("\n");
}

function anomalyBanner(config, scope) {
  const list = knownScopes(config).join(", ");
  return [
    `# Session identity — OMNIFIELD_SCOPE=${scope} (UNRESOLVED)`,
    ``,
    `**Аномалия**: scope "${scope}" не резолвится в зону (нет в \`.omnifield/harness.yaml\`).`,
    `Впиши зону в \`.omnifield/harness.yaml\` (секция \`zones:\`) или перезапусти под верным scope. Доступные сейчас: ${list}.`,
    ``,
    `**Action**: STOP. Сообщи user — scope невалидный. Не начинай работу (нет boundary/ownership).`,
  ].join("\n");
}

function main() {
  const scope = process.env.OMNIFIELD_SCOPE;
  if (!scope) return silent();
  const config = loadConfig(process.cwd());
  if (scope === "main") {
    return emit(needsOnboarding(config) ? onboardingBanner(config) : architectBanner(config));
  }
  const resolved = resolveScope(scope, config);
  if (resolved?.kind !== "zone") return emit(anomalyBanner(config, scope));
  return emit(ownerBanner(config, resolved));
}

// Исполняем main() ТОЛЬКО как скрипт (main вызывает process.exit) — при import безопасно.
if (fileURLToPath(import.meta.url) === argv[1]) {
  try {
    main();
  } catch {
    silent();
  }
}
