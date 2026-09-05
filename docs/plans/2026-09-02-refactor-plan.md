# План рефакторинга dsh-plugins (2026-09-02)

Основан на аудите трёх направлений: исходники, тесты, структура репозитория.
Полные формулировки находок — в отчёте аудита от 2026-09-02 (обсуждение).
План делится на **обязательные** пункты (реальный выигрыш / риск дрейфа) и
**необязательные** (мелкий мусор, делается в последнюю очередь, только безопасное).

Каждый этап завершается прогоном релевантных проверок; перед началом —
фиксация базовой линии `pnpm check` на чистом дереве.

> **Статус исполнения (2026-09-05):** Этап 0 — зелёная базовая линия;
> Этап 1 — выполнен (4f93011); Этап 2 — vitest-конфигы и tsconfig-пресеты
> переведены (7 плагинов на `@yadsh/dsh-config/*`); Этап 3 — выполнен
> (клиентский kit в `packages/plugin-kit/src/client`, 4 плагина мигрированы);
> Этап 4–5 — отложены (большие файлы, мегатесты); Этап 6 (дедупликация
> пер-плагиновых скриптов) — отложен; необязательные пункты мусора —
> зачищены (0-byte файлы, RELEASING.md, SPEC-имена, .gitignore, катаalog).

---

## Обязательные пункты

### Этап 0 — Базовая линия

- [x] `pnpm check` (lint + typecheck + test + build + verify) на чистом дереве;
      зафиксировать результат. Известно-красных проверок быть не должно.
      Выполнено 2026-09-05 — зелёное.

### Этап 1 — Нормализация структуры каталогов (низкий риск)

1. `plugins/dsh-doc-impact`: `test/` → `tests/`.
2. `plugins/dsh-doc-impact`: сборка хоста `dist/` → `lib/`
   (tsconfig.build, `package.json` exports/types/files, локальные скрипты);
   удалить исключение `LEGACY_TYPES_LAYOUTS` из `scripts/verify-package-hygiene.mjs`
   и соответствующие ветки в `scripts/package-hygiene.test.mjs`.
3. `plugins/dsh-kv-persist`: `test/` → `tests/` (+ include в vitest/tsconfig,
   пути в `test:llama`, fixtures).
4. `plugins/dsh-session-scope`: `test/` → `tests/` (+ vitest include).
5. `eslint.config.js`: двойной glob `plugins/**/{test,tests}/**` → `tests`.

### Этап 2 — Консолидация конфигураций

1. `packages/config`: добавить пресет `tsconfig/client.json` (React/JSX, DOM,
   Bundler) рядом с существующими `node`/`browser`.
2. Перевести инлайн-`tsconfig.json` семи плагинов (doc-impact, draft-sessions,
   l10n-overrides, plugin-log-ui, prompt-firewall, session-scope, sleev) на
   пресеты `@yadsh/dsh-config/tsconfig/*`, сохранив текущее поведение
   компиляции каждого (два лагеря: ES2022/NodeNext и ES2024/Bundler).
3. Vitest: 4 рукописных конфига (draft-sessions, l10n-overrides,
   session-scope, sleev) → реэкспорт общего пресета
   (`definePluginVitestConfig`); добавить конфиги doc-impact и prompt-firewall;
   убрать мёртвые `globals: true` и `vitest/globals` (все файлы импортируют
   из `vitest` явно).
4. Генератор `tooling/generators/dsh-plugin`: генерировать актуальный мажоритет
   — `src/client/index.tsx`, dts через tsdown в `lib/types`, полный набор
   скриптов (clean/format/verify-package/verify), `tests/`, общий vitest-пресет.

### Этап 3 — Клиентский kit в plugin-kit

1. `packages/plugin-kit/src/client/`: `plugin-card-css.ts` (канонический shell
   CSS), `chevron.tsx` (ChevronDown, SVG 0 0 14 14 / m3.5 5.25 3.5 3.5 3.5-3.5),
   `card-shell.tsx` (li + header-кнопка + head-text + badge + chevron + body),
   `register-settings-card.tsx` (bootstrap: инжект стиля + slots.inject +
   slots.register), `settings-store.ts` (bindSettingsExternalStore),
   `polling.ts` (startVisibilityAwarePolling). React — peerDependency;
   экспорт сабпути `./client`.
2. Убедиться, что tsdown клиентских плагинов инлайнит kit в бандл
   (self-containment сохраняется; kit не попадает в externals).
3. Перевести 4 плагина (doc-impact, plugin-log-ui, prompt-firewall, sleev)
   на kit, удалить локальные копии (7 классов артефактов, ~350–420 строк).
4. Отдельный подэтап: общий `createSettingsForm` и конвергенция
   doc-impact `SettingsForm` ↔ sleev `SleevSettingsController`
   (единственная нетривиальная часть этапа; при риске поведения —
   остановиться и зафиксировать решение).
5. Верификация: build всех плагинов, per-plugin verify-client-bundle,
   `pnpm verify:packages`, `scripts/ci-verification.test.mjs`
   (карточный контракт по собранным бандлам).

### Этап 4 — Разнесение больших файлов

1. `dsh-session-scope/src/client.ts` (827, `@ts-nocheck`, eslint-игнор) →
   `src/client/`: `css.ts`, `icons.tsx`, `paths.ts`, `scope-remote.ts`,
   `scope-editor.tsx`, `scope-button.tsx`, `index.tsx` (~100 строк bootstrap);
   хелпер `withTimeout` против 4× копипасты settled-флага; снять `@ts-nocheck`;
   убрать игнор из `eslint.config.js`; согласовать client-path-хелперы с `core.ts`.
2. `dsh-session-scope/src/index.ts` (734) → `scope-patches.ts`,
   `scope-commands.ts`, `scope-commands.legacy.ts` (handleWorkspaceScope),
   `scope-projections.ts`; `apply()` сокращается до связки (~120 строк);
   barrel `export *` сохраняет API.
3. `dsh-doc-impact/src/client.ts` (794) → `src/client/`: `settings-form.ts`,
   `fields.tsx`, `card.tsx`, `dictionary.ts`; рендер `ConfigCard` по спеке
   `FIELDS` (вместо 7 рукописных блоков), слияние TextField/NumberField.
4. `dsh-l10n-overrides/src/runtime/dom-translator.ts` (896) → вынести
   `runtime/scope-selector.ts` (66–205) и `runtime/protected-surfaces.ts`
   (4–64); дедупликация reconcile/restore ownership-логики.
5. `dsh-draft-sessions/src/client/`: `native-tabs.ts` (протокол из
   workspace-contribution 52–134), `draft-footer-action.tsx` (259–373),
   `draft-sidebar/` (css/menu/row); CSS инжектить один раз, не на каждый рендер.
6. `dsh-prompt-firewall/src/client/index.tsx` (405): секции карточки в
   подкомпоненты/хуки; цикл по таблице полей вместо 7× копипасты
   `explicitRules` (221–229).

### Этап 5 — Тесты

1. Оживить `packages/test-kit`: temp-fixture (уже есть), лог-ридеры
   (`makeLogDir`/`readLogLines`), мок `window.__ModuleLoader__`,
   `flushMutations`, `deferred`, мок-логгер; подключить как devDep
   потребителям; мигрировать verbatim-дубли (лог-ридеры plugin-log ↔
   doc-impact, ModuleLoader-моки doc-impact/session-scope).
2. Закрыть typecheck-дыру: включить тесты в `tsc --noEmit` для
   session-scope, plugin-kit, plugin-log, test-kit.
3. Разбить мегатесты `dsh-l10n-overrides/tests/`:
   - `dom-translator.test.ts` (1273) → `dom-translator/{text-scoping,
     attributes,ownership,scope-grammar,mutation-observability,
     hostile-environment}.test.ts`;
   - `locale-hook.test.ts` (920) → `locale-hook/{install,disposal-ownership,
     hostile-runtimes,runtime-shapes}.test.ts` (цикл из 11 кейсов → `it.each`);
   - `registry.test.ts` (811) → `registry/{resolution,duplicates,dom-rules,
     atomic-rejection,immutability}.test.ts`; 150k perf-тест → отдельный файл;
   - `integration.test.ts` (521) → `client/{composition,
     failure-containment}.test.ts` + `packs/example-pack.test.ts`.
   Общие фикстуры — `tests/helpers/`.
4. `dsh-kv-persist`: `coordinator.test.ts` → `coordinator-{slot,lease,
   idle-checkpoint,failures}.test.ts`; real-timer idle-checkpoint тесты
   изолировать в собственном файле.
5. Опционально: split `plugin-logger.test.ts` (file-output/registry/guards),
   если не потребует переработки общего состояния реестра.

### Этап 6 — Общие скрипты плагинов + check-dependencies

1. Новый private-пакет `packages/plugin-scripts` (или расширение plugin-kit —
   решить по итогам анализа публикации/путей): реализации
   `verify-package`, `verify-client-bundle`, `prepare-release`,
   `smoke-packed-dsh`, `generate-typert`; 22 копии в `plugins/*/scripts/`
   → тонкие шимы без логики.
2. `scripts/check-dependencies.sh`: инлайн Node-чекер (~290 строк) →
   `scripts/check-dependencies.mjs`; bash остаётся тонкой обвязкой.

### Этап 7 — Финальная верификация

- [ ] `pnpm check` (lint + typecheck + test + build + verify)
- [ ] `pnpm deps:check`
- [ ] `pnpm tarball:verify --all` (через run-bash, если bash доступен)
- Отчёт: точные команды и результаты.

---

## Необязательные пункты (мелкий мусор)

Делать после обязательных; каждый пункт должен быть дешёвым и безопасным.
Untracked `docs/superpowers/` — пользовательские файлы: НЕ удалять без
отдельного решения; допустимо только перенести спеку уже реализованного
плагина в сам плагин (копия останется на месте до решения владельца).

1. Удалить пустые tracked-файлы `.agents/notes/AGENTS.md`,
   `.agents/notes/implemented/AGENTS.md`.
2. Починить dangling-правило `.dsh/doc-impact.yml` (`monorepo-spec` →
   фактический путь спеки монорепо).
3. Переименовать `SPEC_ dsh-*.md` (пробел после подчёркивания, 3 плагина)
   в единую конвенцию; `dsh-sleev-spec-v0.1.md` → `docs/`.
4. Добавить CHANGELOG `dsh-user-correction-miner`; каркас SPEC для
   plugin-log-ui.
5. Убрать `vitest/globals` из tsconfig doc-impact и мёртвый `globals: true`
   из пресета (пересекается с Этапом 2).
6. doc-impact e2e: удалить пустой `beforeAll(..., 30_000)`;
   `core.test.ts` session-scope: `node:assert` → `expect`;
   bwrap-пробу перенести с уровня модуля внутрь гейтованных тестов.
7. Удалить избыточные пер-плагинные `.gitignore` (после сверки содержимого
   с корневым), пустой `packages/config/build/`; добавить README
   `packages/config`.
8. `nx.json`: убрать легаси `.eslintrc.json` из `namedInputs.production`;
   корневые `@swc/*` версии в каталог.
9. Корневой `.dsh/doc-impact.yml`: добавить правила README для kv-persist,
   plugin-log-ui, user-correction-miner.
10. Не входит в объём (только решение владельца): судьба untracked
    `docs/superpowers/` (спеки будущих плагинов cas-results /
    session-hibernator / ui-kit, план remediation), портирование
    tarball-verify.sh в Node.
