# baser

**Фундамент-фреймворк Omnifield** — переиспользуемые капабилити (`@omnifield/baser-*`), построенные на рыночном каноне (rebuild-on-canon), а не на самопале.

- Каноны/vision: knowledger `BASER-2` (канон-стек), `BASER-1` (release-research).
- Решения: `ADR-15` (split), `ADR-19` (реестр=публичный npm), `ADR-20` (гринфилд на Nx).
- Именование пакетов: `@omnifield/<product>-<package>` (MECH-15).

## Стек
- **Монорепо-движок:** [Nx](https://nx.dev) (package-based, pnpm) — генераторы, project-graph, `nx release`.
- **Публикация:** `nx release` (independent, Conventional Commits) → публичный npm, OIDC trusted publishing + provenance.
- **Без Nx Cloud** — локального кэша достаточно для фундамент-монорепо.

## Разработка
```sh
pnpm install
pnpm exec nx run-many -t build typecheck   # сборка/типы
pnpm exec nx release --dry-run             # предпросмотр релиза
```

## Пакеты
| Пакет | Назначение |
|---|---|
| `@omnifield/baser-release` | (каркас) release-капабилити на nx release |

## Релиз
`nx release` управляет версиями/changelog из Conventional Commits (`feat`→minor, `fix`→patch). Публикация — воркфлоу `release.yml` (`workflow_dispatch`, ручной), OIDC + provenance на публичный npm. Идемпотентно: уже изданная версия — skip, не fail.
