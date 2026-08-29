# dsh-draft-sessions

[![CI](https://github.com/xarleyn/dsh-draft-sessions/actions/workflows/ci.yml/badge.svg)](https://github.com/xarleyn/dsh-draft-sessions/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yadsh%2Fdsh-draft-sessions.svg)](https://www.npmjs.com/package/@yadsh/dsh-draft-sessions)
[![npm downloads](https://img.shields.io/npm/dm/%40yadsh%2Fdsh-draft-sessions.svg)](https://www.npmjs.com/package/@yadsh/dsh-draft-sessions)
[![Node.js](https://img.shields.io/node/v/%40yadsh%2Fdsh-draft-sessions.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Постоянные неотправленные будущие диалоги для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Цель плагина — дать привычный по Cursor UX: можно подготовить несколько независимых задач, уйти из них без отправки и позже продолжить каждую с сохранённым текстом.

[English](README.md) · [简体中文](README.zh-CN.md) · [Спецификация](SPEC.md) · [Архитектура](docs/architecture.md) · [План](ROADMAP.md)

## Как это выглядит

### С `@michengai/dsh-automation`

Automation предоставляет опциональный host для совместных вкладок. Когда плагин установлен и активен, Draft Sessions обнаруживает `__dshNativeTabs@1` и добавляет `Drafts` между `Tasks` и `Scheduled`. Жёсткой зависимости от Automation и требований к порядку загрузки нет.

<p align="center">
  <img src="docs/images/draft-sessions-hero.png" alt="Три независимых черновика в отдельной вкладке DeepSeek Harness" />
</p>

### На штатном DeepSeek Harness

Без Automation или другого совместимого tab host штатный browser workspaces и sessions остаётся без изменений. Draft Sessions добавляет кнопку в footer; по нажатию тот же список черновиков открывается в popover.

<p align="center">
  <img src="docs/images/draft-sessions-stock-fallback.jpg" alt="Кнопка Draft Sessions и popover на штатном DeepSeek Harness" />
</p>

Меню строки работает одинаково в обоих режимах и отображается поверх sidebar без дополнительного скролла:

<p align="center">
  <img src="docs/images/draft-sessions-actions.png" width="360" alt="Действия с черновиком поверх sidebar без обрезки и дополнительного скролла" />
</p>

## Установка

Установка опубликованного npm-пакета по имени:

```bash
dsh plugin --profile web add @yadsh/dsh-draft-sessions
```

Или установка свежего исходного кода напрямую с GitHub:

```bash
dsh plugin --profile web add github:xarleyn/dsh-draft-sessions
```

GitHub-зависимость собирается из исходников, поэтому pnpm может попросить разрешить `prepare`-скрипт пакета. Если выдавать разрешение на сборку при установке не хочется, используйте npm-пакет.

Удаление плагина:

```bash
dsh plugin --profile web remove @yadsh/dsh-draft-sessions
```

## Задуманный сценарий

Изначальная цель — полностью повторить inline-черновики Cursor, где неотправленные задачи и обычные sessions находятся в одном дереве workspace.

```text
my-project
├─ ● Fix auth middleware
├─ ◌ Add Grafana dashboards       Draft
├─ ◌ Refactor docker entrypoint   Draft
└─ ● Implement notifications
```

Точно повторить эту компоновку через текущие публичные sidebar API DSH не удалось без замены штатного workspace browser. Поэтому Draft Sessions сохраняет главное поведение — независимые неотправленные задачи, точное восстановление текста и превращение в обычную Session после первого принятого prompt, — но показывает черновики в совместной вкладке `Drafts`, если она доступна, или в popover штатного sidebar footer.

Каждый draft связан с реальной blank Session DSH, а его неотправленный текст отдельно хранится на Host. Если blank Session исчезнет после перезапуска, плагин создаст новую оболочку и привяжет её к черновику без потери текста.

## Что уже реализовано

- Host-backed JSON-хранилище в `$DSH_HOME/storages/dsh-draft-sessions/drafts.json`.
- Строгие Remote-методы `draftSessions.list/create/update/delete/rebind`.
- Независимый порядок в workspace и настраиваемый лимит.
- Optimistic revision: устаревшая запись из второго браузера не затирает свежую.
- Атомарная запись файла и строгая проверка данных при загрузке.
- Создание отдельной blank Session с сохранением id только после успеха.
- Обнаружение исчезнувшей Session и recovery через замену без потери текста.
- Финализация только после принятого Send и подтверждённого `blank: false`.
- Сохранение draft при отклонённом Send и blank slash-командах.
- Точное восстановление текста через официальный per-session InputHub.
- Debounced optimistic autosave с обязательным flush перед переключением.
- Создание через `+` в секции Drafts или `Ctrl/Cmd + Shift + N`; оба действия сначала сохраняют активный draft, затем открывают отдельный новый.
- Отдельная вкладка `Drafts`, когда активный sidebar host предоставляет протокол `__dshNativeTabs@1`.
- Штатная кнопка и popover через `sidebar.footer.action`, когда протокола вкладок нет.
- Вынесенные поверх панелей row-меню, inline rename, duplicate, подтверждаемое удаление, клавиатурная навигация и ограниченный drag reorder.
- Безопасное удаление активного draft с финальным autosave flush и восстановлением после отказа.
- Опциональная фильтрация backing shell через протокол вкладок без изменения обычных Sessions.
- Плагин не регистрируется в single-slot `sidebar.workspaces`; штатный browser, Archive Manager и другие владельцы сохраняют полный контроль.
- Unit- и DOM-тесты persistence, concurrency, lifecycle, composer и sidebar.

Текущий код не отправляет prompt, не изменяет историю обычных Sessions и не удаляет blank Sessions.

## Требования

- Node.js `^22.19.0` или `>=24.0.0`
- pnpm 11
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0` с публичным list-slot `sidebar.footer.action`

Опубликованный клиент rc.2 поддерживается без патчей. Sidebar host с вкладками определяется через опциональный версионированный протокол `__dshNativeTabs@1`; если его нет, плагин использует штатный footer action и не заменяет workspace browser.

## Локальная разработка

```bash
cd dsh-draft-sessions
pnpm install
pnpm check
```

Сборка и подключение checkout к Web profile:

```bash
pnpm build
dsh plugin --profile web add .
dsh --profile web --dump-config
```

## Релизы

Релизы собираются из существующих SemVer-тегов с префиксом `v` ручным [Release workflow](.github/workflows/release.yml). Workflow делает checkout точного тега, запускает полный quality gate, подставляет в пакет версию из тега, создаёт npm tarball и SHA-256 checksum, проверяет чистую установку tarball, загружает Actions artifact и оформляет GitHub Release с автоматически сгенерированными notes.

Maintainer может запустить его через **Actions → Release → Run workflow** или GitHub CLI:

```bash
git tag -a v0.1.0-rc.1 -m "v0.1.0-rc.1"
git push origin v0.1.0-rc.1
gh workflow run release.yml -f tag=v0.1.0-rc.1 -f publish_npm=false
```

Prerelease-теги публикуются в npm dist-tag `next`, стабильные — в `latest`. Публикация в npm по умолчанию выключена. Для включения opt-in job нужно:

1. Один раз опубликовать пакет в npm вручную, если его ещё не существует.
2. Настроить npm trusted publishing для этого GitHub-репозитория, файла `release.yml`, environment `npm` и действия `npm publish`.
3. Создать защищённый GitHub environment `npm` и запустить workflow с `publish_npm=true`.

Publish job использует GitHub OIDC вместо долгоживущего npm token. GitHub Release всегда создаётся до попытки публикации в npm.

## Настройки

```yaml
- id: draft-sessions
  config:
    storagePath: ""
    maxDraftsPerWorkspace: 50
```

Пустой `storagePath` означает стандартный файл внутри `$DSH_HOME`.

## Главные границы дизайна

- Источник истины для неотправленного текста — `DraftStore`.
- Реальная blank Session служит execution shell для model/preset/permissions UI.
- Создание draft никогда не запускает модель.
- Draft превращается в обычную Session только после принятого первого prompt.
- Attachments отложены до v2.
- Draft-строки композируются рядом с single workspace-browser occupant; плагин не отключает и не встраивает `ui-workspace`.
- Backing blank Sessions исключаются только из slot workspace browser, поэтому стандартный composer по-прежнему получает настоящую текущую Session.

Полные критерии находятся в [SPEC.md](SPEC.md), последовательность следующих этапов — в [ROADMAP.md](ROADMAP.md).

## Лицензия

[MIT](LICENSE)
