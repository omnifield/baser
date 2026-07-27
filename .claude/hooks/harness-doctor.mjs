#!/usr/bin/env node
// harness-doctor.mjs — самопроверка установки харнесса. НЕ хук: запускается руками из корня репо.
//   node .claude/hooks/harness-doctor.mjs                 # общий отчёт
//   OMNIFIELD_SCOPE=<scope> node .claude/hooks/harness-doctor.mjs   # + кто ты при этом scope
//
// Печатает реальность (продукт · зоны+существование папок · твоя роль · marker), чтобы не
// приходилось «понимать по описанию»: запустил — увидел. Zero-deps (node:* + harness-config).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gitAccess,
  grabliTarget,
  knownScopes,
  loadConfig,
  parseYaml,
  rejectedZoneNames,
  resolveScope,
  roleOf,
  serviceBase,
  validateConfig,
  zonePaths,
} from "./harness-config.mjs";

const cwd = process.cwd();
const out = [];
const p = (s = "") => out.push(s);
const ok = (s) => `  ✓ ${s}`;
const bad = (s) => `  ✗ ${s}`;
const warn = (s) => `  ⚠ ${s}`;

p("harness doctor — проверка установки");
p(`repo (cwd): ${cwd}`);
p("");

// --- конфиг ------------------------------------------------------------------
const yamlPath = join(cwd, ".omnifield", "harness.yaml");
let raw = null;
try {
  raw = parseYaml(readFileSync(yamlPath, "utf8"));
} catch {
  raw = null;
}
const config = loadConfig(cwd);

if (!raw) {
  p(bad(".omnifield/harness.yaml не найден/не читается"));
  p("    → main-сессия заведётся на дефолте; owner-сессии НЕ смогут стартовать (нет зон).");
} else {
  p(ok(".omnifield/harness.yaml прочитан"));
  const av = raw.apiVersion ?? "(нет)";
  const kind = raw.kind ?? "(нет)";
  p(`    apiVersion: ${av} · kind: ${kind}  (справочно — движком не валидируются)`);
}
p("");

// --- продукт -----------------------------------------------------------------
if (config.product) p(ok(`продукт: ${config.product}`));
else p(warn("продукт не задан (`product:` пуст) — баннер попросит вписать"));
p(`архитекторов сконфигурено: ${config.architects}`);
const grabli = grabliTarget(config);
if (grabli) p(ok(`grabli-ws: ${grabli} (затыки/грабли пишем сюда)`));
else p(warn("grabli-ws не задан (`grabli.workspace`) — канал записи граблей не сконфигурен"));
const tsk = serviceBase(config, "tasker");
const kb = serviceBase(config, "knowledger");
if (tsk || kb) {
  p(ok(`services (доступ curl'ом, НЕ MCP): tasker=${tsk ?? "—"} · knowledger=${kb ?? "—"}`));
  p(
    `    проверь связь: curl -s ${tsk ?? "<tasker>"}/healthz  (нет ответа → сэндбокс off / смени адрес)`,
  );
} else {
  p(warn("services не заданы (`services.tasker/.knowledger`) — базы сервисов не сконфигурены"));
}
p("");

// --- зоны --------------------------------------------------------------------
const rejected = rejectedZoneNames(raw?.zones);
if (rejected.length) {
  p(bad(`зоны с зарезервированными именами ОТВЕРГНУТЫ: ${rejected.join(", ")}`));
  p("    → переименуй (main/layer — служебные слова роль-модели).");
}
const zones = Object.entries(config.zones);
if (!zones.length) {
  p(warn("зон нет — owner-сессии стартовать не смогут (только architect/main)"));
} else {
  p(`зоны (${zones.length}):`);
  for (const [name, z] of zones) {
    const paths = zonePaths(z);
    if (!paths.length) {
      p(bad(`${name} → нет путей (пустой paths[])`));
      continue;
    }
    p(`  ${name}:`);
    for (const path of paths) {
      const exists = existsSync(join(cwd, path));
      p(`    ${exists ? "✓" : "✗"} ${path}${exists ? "" : "   ПАПКИ НЕТ (boundary на пустоту)"}`);
    }
  }
}
// Валидатор роль-модели (disjoint / relative / непустой) — kb:BRAIN2-1.
const cfgErrors = validateConfig(config);
if (cfgErrors.length) {
  p("");
  p(bad(`валидатор роль-модели: ${cfgErrors.length} ошибок`));
  for (const e of cfgErrors) p(`    - ${e}`);
} else if (zones.length) {
  p(ok("валидатор роль-модели: пути relative, непустые, не пересекаются"));
}
p("");

// --- текущий scope -----------------------------------------------------------
const scope = process.env.OMNIFIELD_SCOPE;
if (!scope) {
  p("OMNIFIELD_SCOPE не задан — запусти `OMNIFIELD_SCOPE=main|<zone> ...` чтобы увидеть роль.");
  p(`доступные scope: ${knownScopes(config).join(", ")}`);
} else {
  const resolved = resolveScope(scope, config);
  if (scope === "main") {
    p(ok(`OMNIFIELD_SCOPE=main → architect (git: ${gitAccess("main", config)})`));
  } else if (resolved?.kind === "zone") {
    p(
      ok(
        `OMNIFIELD_SCOPE=${scope} → owner-${scope} (git: ${gitAccess(scope, config)}), папки: ${resolved.paths.map((x) => `${x}/`).join(", ")}`,
      ),
    );
  } else {
    p(bad(`OMNIFIELD_SCOPE=${scope} НЕ резолвится в зону (роль: ${roleOf(scope)})`));
    p(`    доступные: ${knownScopes(config).join(", ")}`);
  }
}
p("");

// --- marker ------------------------------------------------------------------
const marker = join(cwd, ".claude", ".main-session-id");
try {
  const ids = readFileSync(marker, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  p(ok(`marker .claude/.main-session-id есть (${ids.length} активн. main-сессий)`));
} catch {
  p(`  · marker .claude/.main-session-id нет (появится на SessionStart architect-сессии)`);
}

process.stdout.write(`${out.join("\n")}\n`);
