#!/usr/bin/env node
// git-gate.mjs — PreToolUse hook: hard-gate на write-операции git/gh. Уровень доступа —
// ДАННЫЕ из `.omnifield/harness.yaml` (config.git[role]): architect=full / owner=commit-only /
// layer=none (kb:BRAIN-3). Роль-семантика (ЧТО режет каждый уровень) — рамка (инвариант).
//
// Несколько owner-сессий могут работать в одном shared working tree (одна .git).
// Неконтролируемая смена HEAD / push размазывает работу соседей. Промпт под нагрузкой
// игнорится — это hard-gate.
//
// Контракт (Claude Code PreToolUse):
//   stdin  = JSON { tool_name, tool_input:{command}, session_id, cwd, ... }
//   stdout = JSON { hookSpecificOutput:{ hookEventName, permissionDecision, permissionDecisionReason } }
//   exit 0 всегда; FAIL-OPEN на внутренних ошибках.
//
// Уровень доступа сессии:
//   - marker `.claude/.main-session-id` содержит session_id → architect → 'full' (allow всё).
//     Marker — ЕДИНСТВЕННЫЙ источник 'full' (subagents наследуют env scope=main, но в marker
//     их нет → не получают full). Пишет marker только main-session-marker.mjs при scope 'main'.
//   - иначе env OMNIFIELD_SCOPE → config.git[roleOf(scope)]. Пусто/main без marker (=subagent)
//     → commit-only (gated), НЕ full.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { gitAccess, loadConfig } from "./harness-config.mjs";

function allow() {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    }),
  );
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// Префикс, после которого может идти git/gh: начало строки, пробел, `;`, `&&`, `||`, `|`, кавычка.
const PFX = "(?:^|[\\s;|&\"'`])";
// git может идти с global-options перед verb'ом (git -C path --no-pager <verb>).
const GIT_PFX = `${PFX}git\\s+(?:[^\\s]+\\s+){0,6}`;

// commit-only режет write-операции, меняющие HEAD/публикующие/переписывающие историю.
const COMMIT_ONLY_RULES = [
  { rx: new RegExp(`${GIT_PFX}switch(?:\\s|$)`, "i"), label: "git switch" },
  { rx: new RegExp(`${GIT_PFX}checkout\\s+-b\\b`, "i"), label: "git checkout -b" },
  { rx: new RegExp(`${GIT_PFX}push(?:\\s|$)`, "i"), label: "git push" },
  { rx: new RegExp(`${GIT_PFX}merge(?:\\s|$)`, "i"), label: "git merge" },
  { rx: new RegExp(`${GIT_PFX}rebase(?:\\s|$)`, "i"), label: "git rebase" },
  {
    rx: new RegExp(`${GIT_PFX}reset\\s+--(?:hard|keep)\\b`, "i"),
    label: "git reset --hard/--keep",
  },
  { rx: new RegExp(`${GIT_PFX}branch\\s+-(?:D|f|m|M)\\b`), label: "git branch -D/-f/-m" },
  {
    rx: new RegExp(`${GIT_PFX}worktree\\s+(?:add|remove|move)\\b`, "i"),
    label: "git worktree add/remove/move",
  },
  {
    rx: new RegExp(`${PFX}gh\\s+pr\\s+(?:create|merge|close|reopen|edit)\\b`, "i"),
    label: "gh pr write",
  },
];

// none (layer) режет ЛЮБУЮ git-запись, включая commit/add — git не трогает вообще.
const NONE_EXTRA_RULES = [
  { rx: new RegExp(`${GIT_PFX}commit(?:\\s|$)`, "i"), label: "git commit" },
  { rx: new RegExp(`${GIT_PFX}add(?:\\s|$)`, "i"), label: "git add" },
  { rx: new RegExp(`${GIT_PFX}tag(?:\\s|$)`, "i"), label: "git tag" },
  { rx: new RegExp(`${GIT_PFX}stash(?:\\s|$)`, "i"), label: "git stash" },
];

// `git checkout <branch>` режется в commit-only ТОЛЬКО если нет ` -- ` (path-restore пускается).
function matchesCheckoutBranch(cmd) {
  const rx = new RegExp(`${GIT_PFX}checkout(?!\\s+-b\\b)\\b`, "i");
  if (!rx.test(cmd)) return null;
  if (/\s--(?:\s|$)/.test(cmd)) return null;
  return "git checkout <branch>";
}

/** Причина блокировки под уровень доступа, либо null. */
export function blockReason(cmd, access) {
  if (access === "full") return null;
  const rules = access === "none" ? [...COMMIT_ONLY_RULES, ...NONE_EXTRA_RULES] : COMMIT_ONLY_RULES;
  for (const { rx, label } of rules) {
    if (rx.test(cmd)) return label;
  }
  return matchesCheckoutBranch(cmd);
}

function buildMessage(cmd, label, access) {
  return [
    `❌ Команда \`${cmd}\` заблокирована harness-хуком (git-gate, доступ: ${access}).`,
    "",
    `Причина: \`${label}\` вне прав твоей роли на shared \`.git\`.`,
    "",
    "Действие: STOP. Не пытайся обойти (через `bash -c`, `&&`, кавычки — хук видит полную команду).",
    "Верни state architect. Architect либо сделает операцию сам, либо выдаст отдельный worktree.",
  ].join("\n");
}

function isMainSession(input) {
  const sessionId = input?.session_id;
  if (!sessionId) return false;
  const cwd = input.cwd || process.cwd();
  try {
    const ids = readFileSync(join(cwd, ".claude", ".main-session-id"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return ids.includes(String(sessionId));
  } catch {
    return false;
  }
}

/** Уровень доступа сессии: marker→full; env-scope→config.git; subagent/пусто→commit-only. */
export function currentAccess(input, config) {
  if (isMainSession(input)) return "full";
  const scope = process.env.OMNIFIELD_SCOPE;
  if (!scope || scope === "main") return config?.git?.owner ?? "commit-only";
  return gitAccess(scope, config);
}

function main() {
  let input;
  try {
    // strip BOM: Windows-пайпы (PowerShell) могут префиксовать stdin — не повод для fail-open.
    input = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, ""));
  } catch {
    return allow();
  }
  // Оба shell-тула харнесса (дыра PowerShell-пути найдена 2026-07-09).
  if (input.tool_name !== "Bash" && input.tool_name !== "PowerShell") return allow();

  const cmd = String(input.tool_input?.command ?? "");
  if (!cmd) return allow();

  const config = loadConfig(input.cwd || process.cwd());
  const access = currentAccess(input, config);
  const reason = blockReason(cmd, access);
  if (!reason) return allow();
  deny(buildMessage(cmd, reason, access));
}

// Исполняем main() ТОЛЬКО как скрипт (node git-gate.mjs) — при import (тесты) main не
// запускается: он читает stdin(0) и блокировал бы импортёра.
if (fileURLToPath(import.meta.url) === argv[1]) {
  try {
    main();
  } catch {
    // FAIL-OPEN: внутренняя ошибка хука не должна ломать read-only команды.
    allow();
  }
}
