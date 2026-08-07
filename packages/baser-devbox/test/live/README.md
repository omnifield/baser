# Эталоны приёмки — ЧУЖИЕ живые файлы, снятые целиком

Здесь лежат файлы двух живых репозиториев, снятые как есть. Это **вход приёмки
`live-repos.spec.mjs`**, а не наши артефакты: обвес обязан выразить их раскладку,
и «обязан» здесь проверяется файлом, а не памятью о нём.

| файл                           | репозиторий            | что это                        | снято      | коммит файла |
| ------------------------------ | ---------------------- | ------------------------------ | ---------- | ------------ |
| `tasker.devcontainer.json`     | `omnifield/tasker`     | `.devcontainer/devcontainer.json` | 2026-08-04 | `3c428a1`    |
| `knowledger.devcontainer.json` | `omnifield/knowledger` | `.devcontainer/devcontainer.json` | 2026-08-04 | `4e113a8`    |
| `tasker.services.json`         | `omnifield/tasker`     | `devbox.services.json`         | 2026-08-06 | `HEAD`       |
| `knowledger.services.json`     | `omnifield/knowledger` | `devbox.services.json`         | 2026-08-06 | `HEAD`       |

**Снимок, а не запрос по сети.** Проба, ходящая за эталоном в GitHub, меряет
доступность сети и чужой темп правок, а не наш обвес: она краснела бы в оффлайне
и зеленела бы молча, если бы чужой репозиторий подстроился под нас. Снимок с
названной датой честнее — он старится вслух.

Обновляется руками, одной командой на файл, и вместе с датой в таблице:

```sh
gh api repos/omnifield/tasker/contents/.devcontainer/devcontainer.json --jq .content \
  | base64 -d > packages/baser-devbox/test/live/tasker.devcontainer.json
gh api repos/omnifield/tasker/contents/devbox.services.json --jq .content \
  | base64 -d > packages/baser-devbox/test/live/tasker.services.json
```

**Эти репозитории мы не правим.** Они чужие продукты и переезжают отдельной
работой (`tasker:BASER2-79` §границы); здесь они только эталон.

## Зачем здесь объявление сервисов, а не только девконтейнер

`tasker:BASER2-196`. Карта процессов локации (`startCommand`) обязана быть
**выведенной из их файлов, а не сочинённой нами**: впиши мы три команды в пробу
руками — она доказывала бы, что обвес кладёт то, что мы в неё вписали, и молчала
бы в день, когда у продукта появится третий сервис.

Поэтому `devbox.services.json` снят целиком, и проба строит карту из него:
`backend` и `frontend` — их записи слово в слово, `publish` — работа их
`scripts/devbox-publish.mjs` (копия `omnifield.yaml` в общий том реестра).

Отсюда же берётся и **замер потери**: у каждого их сервиса объявлены `healthUrl`
и `probeTimeoutMs`, то есть http_get-проба готовности с таймаутом. Объектная
форма их не выражает, и проба требует, чтобы обвес этого **не изображал** —
адреса проб в артефакт не просачиваются. Причина и что делать, если готовность
понадобится, — `kb:BASER3-32`.

## Снимок `tasker.devcontainer.json` старше переезда — и это НЕ дефект

На 2026-08-06 живой `.devcontainer/devcontainer.json` таскера **уже разложен
нашим обвесом** (`"name": "tasker-devbox"`, upstream-образ, фича `go`). Снимок
здесь держит его состояние ДО переезда — девопсер-legacy со своим образом и
пользователем `vscode`.

Обновлять его до сегодняшнего **нельзя, пока это приёмка выражения чужой
раскладки**: сверять наш артефакт с нашим же артефактом значит сверять файл сам с
собой. Утверждение пробы — «обвес выражает раскладку, писанную руками и не под
нас», и предмет у него исторический по своей природе. Единственная строка, ради
которой снимок нужен свежим, — `postStartCommand`, и она в обоих состояниях
совпадает: пара их скриптов, ради ухода которой `BASER2-196` и заведена.

## Живой подъём объектной формы — сценарий для человека с докером

Приёмка `BASER2-196` требует проверить долгоживущие процессы **исполнением**.
Пробы этой зоны докера не имеют и иметь не должны: они меряют артефакт, а
поведение объектной формы — свойство ИНСТРУМЕНТА девконтейнеров. Ниже сценарий,
который это меряет; выполняется на машине с докером и `devcontainer` CLI.

### Что уже известно по эталонной реализации

`devcontainers/cli`, `src/spec-common/injectHeadless.ts`, сверено 2026-08-06 —
это не догадки, а строки:

- объектная форма запускает все команды разом и **ждёт их всех**:
  `Promise.allSettled` с комментарием «Wait for all commands to finish
  (successfully or not) before continuing»;
- каждое значение уходит в шелл: `['/bin/sh', '-c', command]`;
- **вывод именованной команды держится до её конца**: `printMode = name ? 'off' :
  'continuous'`, и печатается он одним куском ПОСЛЕ завершения;
- `postAttachCommand` стоит после `postStartCommand` и ждёт его;
- подключению это не мешает: `waitFor` по умолчанию `updateContentCommand`.

Сценарий не переоткрывает это, а **проверяет на живом**, потому что чтение
исходника и поведение инструмента — разные утверждения.

### Минимальная проверка (пять минут, любой стек)

```jsonc
// .devcontainer/devcontainer.json во временном пустом репозитории
{
  "name": "poststart-probe",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:24",
  "postStartCommand": {
    "publish": "echo published > /tmp/published",
    "backend": "while :; do echo backend-tick >> /tmp/backend.log; sleep 1; done",
    "frontend": "while :; do echo frontend-tick >> /tmp/frontend.log; sleep 1; done"
  },
  "postAttachCommand": "echo attached > /tmp/attached"
}
```

```sh
devcontainer up --workspace-folder .        # 1. поднимается ли вообще
devcontainer exec --workspace-folder . cat /tmp/published      # 2. мгновенная — выполнилась
devcontainer exec --workspace-folder . sh -c 'wc -l /tmp/backend.log /tmp/frontend.log'
                                            # 3. ОБА долгих процесса живы и пишут
devcontainer exec --workspace-folder . cat /tmp/attached       # 4. постподключение
```

Что считать ответом:

| вопрос | как выглядит «да» |
| --- | --- |
| старт не повешен | шаг 1 возвращает управление, `exec` в шагах 2–4 отвечает |
| команды параллельны | оба лога растут одновременно, а не по очереди |
| мгновенная команда не ждёт долгих | `/tmp/published` появляется сразу |
| вывод долгой команды не виден | в выводе `devcontainer up` нет ни одного `-tick` |
| постподключение не пришло | шаг 4 отвечает «нет такого файла» |

**Последние две строки — не поломка, а цена, и она названа в доке зоны.** Если
же повиснет ШАГ 1 (управление не возвращается, войти нельзя) — это находка,
которой в решении нет: она означает, что объектная форма не годится под
долгоживущие процессы, и её надо нести в `kb:BASER3-32`, а не обходить.

### Проверка на живом таскере

То же самое, но карта из настоящих команд — `publish` копирует манифест в
смонтированный том реестра, `backend` поднимает Go-сервис, `frontend` — вебню:

```yaml
# .omnifield/omnifield-devbox.yaml таскера, ключ baser.settings
startCommand:
  publish: cp omnifield.yaml /omnifield-registry/tasker.yaml
  backend: env TASKER_PORT=8030 TASKER_DB=/data/tasker/tasker.db go run ./cmd/tasker
  frontend: pnpm -C web dev
```

```sh
devcontainer exec --workspace-folder . sh -c 'cat /omnifield-registry/tasker.yaml | head -3'
devcontainer exec --workspace-folder . sh -c 'curl -sf localhost:8030/tasker/healthz'
devcontainer exec --workspace-folder . sh -c 'curl -sfI localhost:5173/tasker/ | head -1'
```

Здесь же меряется то, ради чего `kb:BASER3-32` и велел проверить фактом: их
раннер ждал готовности (`healthUrl` + `probeTimeoutMs: 120000`), а объектная
форма — нет. **Ломается ли что-нибудь без ожидания** — вопрос к третьей команде:
вебня стартует раньше бэкенда и первые секунды получает отказ. Если после этого
она сама не восстанавливается, готовность несёт нагрузку, и правильный шаг —
объявить `process-compose` фичей девконтейнера, а не дописывать своё
(`kb:BASER3-32`).
