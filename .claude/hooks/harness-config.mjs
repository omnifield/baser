// harness-config.mjs — единый источник роль-модели как ДАННЫХ (kb:BRAIN-3): читает
// `.omnifield/harness.yaml` (пресет-сид, доставленный плагином mode:seed) и отдаёт хукам
// зоны/пути, пины моделей, число архитекторов, git-доступ по роли. Ноль хардкода зон.
//
// Зависимостей нет (хуки Claude Code стартуют голым node). YAML парсится подмножеством
// (scalar + вложенные map'ы + inline flow-массив `[a, b]` для paths[] — ровно то, что нужно
// harness.yaml; block-list `- x` не поддерживаем).
// Файла нет → DEFAULT_CONFIG (degraded, но безопасный: только 'main'/architect известен,
// зоны пусты → неизвестный scope = аномалия; git по роли — инвариант рамки).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Инвариант рамки (shared-policy) — НЕ продуктовые данные: git-доступ по роли не выключить.
// Значения оверрайдятся конфигом, но роль-семантика (что именно режется) — в git-gate.
const GIT_INVARIANT = { architect: "full", owner: "commit-only", layer: "none" };

// Зарезервированные слова роль-модели: 'main' = architect, 'layer' = layer-роль. Зона с таким
// именем даёт двоемыслие (баннер owner commit-only, а git-gate по roleOf режет как layer/none) —
// поэтому такие зоны ОТВЕРГАЕМ при чтении конфига (scope тогда не резолвится → честная аномалия).
const RESERVED_ZONE_NAMES = new Set(["main", "layer"]);

export const DEFAULT_CONFIG = {
  product: null,
  architects: 1,
  models: {},
  zones: {},
  git: { ...GIT_INVARIANT },
  // Слот grabli (BRAIN2-7): куда агенты пишут затыки/грабли. Дефолта нет — если продукт
  // не задал, запись грабли не адресована (правило рамки остаётся, но канал не сконфигурен).
  grabli: null,
  // Слот services (BRAIN2-9): базы omnifield-сервисов — доступ curl'ом (НЕ MCP). Адрес
  // зависит от окружения (сосед по docker-сети vs дверь через хост). null → не сконфигурен.
  services: null,
};

/** Коэрция скалярного YAML-значения: quotes strip, int, bool, иначе строка. */
function coerce(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/**
 * Коэрция значения: inline flow-массив `[a, b, c]` → массив коэрцированных элементов
 * (пустой `[]` → `[]`, хвостовая запятая отбрасывается); иначе — скаляр через coerce.
 * Нужно для `zones.<z>.paths: [packages/a, packages/b]` (BRAIN2-1). Block-list (`- x`)
 * не поддерживаем — в harness.yaml его нет.
 */
function coerceValue(raw) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((x) => coerce(x))
      .filter((x) => x !== "");
  }
  return coerce(v);
}

/**
 * Мини-парсер YAML-подмножества: отступ = 2 пробела/уровень; `key:` → вложенный map;
 * `key: value` → скаляр или inline flow-массив `[a, b]` (см. coerceValue). Комментарии
 * (`# …`), пустые строки и `---` игнорятся. Block-list (`- x`) НЕ поддерживается.
 */
export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
    const ci = trimmed.indexOf(":");
    if (ci === -1) continue; // не key:value (списков не ждём) — пропуск
    const indent = rawLine.length - rawLine.trimStart().length;
    const key = trimmed.slice(0, ci).trim();
    let val = trimmed.slice(ci + 1).trim();
    // Хвостовой inline-комментарий (YAML: пробел + `#`) на НЕ-quoted скаляре — отрезаем,
    // иначе `product: x  # note` уезжает в значение целиком. `a/b#c` (без пробела) — НЕ коммент.
    if (val && !val.startsWith('"') && !val.startsWith("'")) {
      const h = val.search(/\s#/);
      if (h !== -1) val = val.slice(0, h).trim();
      else if (val.startsWith("#")) val = "";
    }
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (val === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = coerceValue(val);
    }
  }
  return root;
}

/** Зоны из конфига без зарезервированных имён (main/layer). Пустой/не-объект → {}. */
export function normalizeZones(rawZones) {
  if (!rawZones || typeof rawZones !== "object") return {};
  return Object.fromEntries(Object.entries(rawZones).filter(([k]) => !RESERVED_ZONE_NAMES.has(k)));
}

/** Имена зон, отвергнутые как зарезервированные (для doctor/диагностики). */
export function rejectedZoneNames(rawZones) {
  if (!rawZones || typeof rawZones !== "object") return [];
  return Object.keys(rawZones).filter((k) => RESERVED_ZONE_NAMES.has(k));
}

/** Достраивает распарсенный конфиг дефолтами по отсутствующим секциям. */
export function normalizeConfig(parsed) {
  const c = parsed && typeof parsed === "object" ? parsed : {};
  return {
    product: typeof c.product === "string" ? c.product : DEFAULT_CONFIG.product,
    architects: typeof c.architects === "number" ? c.architects : DEFAULT_CONFIG.architects,
    models: c.models && typeof c.models === "object" ? c.models : {},
    zones: normalizeZones(c.zones),
    git: { ...GIT_INVARIANT, ...(c.git && typeof c.git === "object" ? c.git : {}) },
    grabli: c.grabli && typeof c.grabli === "object" ? c.grabli : DEFAULT_CONFIG.grabli,
    services: c.services && typeof c.services === "object" ? c.services : DEFAULT_CONFIG.services,
  };
}

/** Целевой ws для записи граблей/затыков (BRAIN2-7), либо null если слот не сконфигурен. */
export function grabliTarget(config) {
  const ws = config?.grabli?.workspace;
  return typeof ws === "string" && ws.trim() ? ws.trim() : null;
}

/** База сервиса (`tasker`/`knowledger`) из слота services — доступ curl'ом; null если не задан. */
export function serviceBase(config, name) {
  const b = config?.services?.[name];
  return typeof b === "string" && b.trim() ? b.trim().replace(/\/+$/, "") : null;
}

/** Читает `.omnifield/harness.yaml` из cwd; нет файла/парс упал → DEFAULT_CONFIG. */
export function loadConfig(cwd = process.cwd()) {
  try {
    const text = readFileSync(join(cwd, ".omnifield", "harness.yaml"), "utf8");
    return normalizeConfig(parseYaml(text));
  } catch {
    return { ...DEFAULT_CONFIG, git: { ...GIT_INVARIANT } };
  }
}

/** Роль по scope: main→architect; 'layer'→layer; иначе (зона) → owner. */
export function roleOf(scope) {
  if (scope === "main") return "architect";
  if (scope === "layer") return "layer";
  return "owner";
}

/** Git-доступ (full|commit-only|none) для scope — из config.git[role], иначе инвариант. */
export function gitAccess(scope, config) {
  const role = roleOf(scope);
  return config?.git?.[role] ?? GIT_INVARIANT[role] ?? "none";
}

/**
 * Пути зоны как МАССИВ (BRAIN2-1: один owner владеет несколькими папками). Толерантный
 * ридер: `paths: [a, b]` (канон) ∪ legacy одиночный `path:` ∪ голая строка `zone: path`
 * → всегда массив относительных путей. Пустые/не-строки отбрасываются.
 */
export function zonePaths(zone) {
  if (!zone) return [];
  if (typeof zone === "string") return zone ? [zone] : [];
  const raw = Array.isArray(zone.paths)
    ? zone.paths
    : typeof zone.path === "string"
      ? [zone.path]
      : [];
  return raw.filter((p) => typeof p === "string" && p.trim() !== "").map((p) => p.trim());
}

/** true, если путь `a` равен `b` или вложен в него (по сегментам): a === b || b + '/' — префикс a. */
function nestedOrEqual(a, b) {
  return a === b || a.startsWith(`${b}/`);
}

/** Нормализация относительного пути для сравнения: срезаем ведущий `./` и хвостовой `/`. */
function normPath(p) {
  return p.replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Детерминированный валидатор роль-модели (BRAIN2-1, канон schema-validated из kb:BRAIN2-3):
 * каждая зона — непустой набор ОТНОСИТЕЛЬНЫХ путей (не абсолют, без `..`-escape), а пути
 * РАЗНЫХ зон не пересекаются (одна папка — один владелец; disjoint-инвариант). Возвращает
 * массив строк-ошибок (пустой = валидно). Не бросает — вызыватели решают, что делать.
 */
export function validateConfig(config) {
  const errors = [];
  const owned = []; // { zone, path } — нормализованные, для disjoint-проверки
  for (const [zone, def] of Object.entries(config?.zones ?? {})) {
    const paths = zonePaths(def);
    if (!paths.length) {
      errors.push(`зона "${zone}": нет путей (ожидается непустой paths[])`);
      continue;
    }
    for (const raw of paths) {
      const p = normPath(raw);
      if (raw.startsWith("/"))
        errors.push(`зона "${zone}": путь "${raw}" абсолютный (нужен относительный)`);
      else if (p === "" || p.split("/").includes(".."))
        errors.push(`зона "${zone}": путь "${raw}" невалиден (пустой или содержит "..")`);
      else owned.push({ zone, path: p });
    }
  }
  // disjoint: любая пара путей из РАЗНЫХ зон не должна совпадать/вкладываться.
  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const a = owned[i];
      const b = owned[j];
      if (a.zone === b.zone) continue;
      if (nestedOrEqual(a.path, b.path) || nestedOrEqual(b.path, a.path)) {
        errors.push(
          `пути зон "${a.zone}" и "${b.zone}" пересекаются: "${a.path}" ↔ "${b.path}" (одна папка — один владелец)`,
        );
      }
    }
  }
  return errors;
}

/** Резолв scope → зона (из ДАННЫХ конфига). main → architect; unknown → null (аномалия). */
export function resolveScope(scope, config) {
  if (scope === "main") return { kind: "main", scope: "main", role: "architect" };
  const zone = config?.zones?.[scope];
  if (!zone) return null;
  const description =
    typeof zone === "object" && !Array.isArray(zone) ? zone.description : undefined;
  const paths = zonePaths(zone);
  return {
    kind: "zone",
    scope,
    role: "owner",
    paths,
    name: description ? `${scope} — ${description}` : scope,
  };
}

/** Список известных scope'ов (для аномалий/CLI). */
export function knownScopes(config) {
  return ["main", ...Object.keys(config?.zones ?? {})];
}
