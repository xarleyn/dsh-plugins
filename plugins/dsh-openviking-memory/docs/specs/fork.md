# SPEC: `@yadsh/dsh-openviking-memory`

## 1. Goal

Перенести `@openviking/dsh-memory-plugin` из OpenViking в монорепозиторий `xarleyn/dsh-plugins` как поддерживаемый derived fork с собственным lifecycle и release cycle.

Основные цели:

1. Сохранить совместимость и основное поведение оригинального OpenViking DSH memory plugin.
2. Добавить полноценное управление автоматическим memory injection.
3. Позволить использовать OpenViking в режиме:

```yaml
autoInject: false
```

при котором:

- OpenViking остаётся подключён;
- MCP/tools продолжают работать;
- skills продолжают работать;
- URI guard продолжает работать;
- capture/commit может продолжать работать;
- агент может сам вызвать OpenViking tools;
- никакой profile/memory context автоматически не добавляется в conversation;
- никаких лишних profile/recall network requests не выполняется.

4. Интегрировать пакет в существующую архитектуру `xarleyn/dsh-plugins`: pnpm + Nx, independent versioning, стандартные build/test/check/release flows.
5. С самого начала писать и поддерживать плагин по существующим DSH и repository-specific guidelines, а не сохранять upstream layout только ради минимального diff.

---

# 2. Upstream

Original project:

- Repository: `volcengine/OpenViking`
- Upstream package: `@openviking/dsh-memory-plugin`
- Source directory: `examples/dsh-memory-plugin`
- Original authors/maintainers: OpenViking / Volcengine contributors
- Upstream integration: OpenViking ↔ DeepSeek Harness

Текущий upstream package представляет собой DSH bundle с `cordis.patch.yml`, OpenViking runtime, MCP bridge, skills, session capture, URI protection и automatic recall/profile injection. Upstream использует `agent/session-start`, `agent/pre-step`, `session/event`, `session/flush` и `tools/pre-execute`; MCP и skill surfaces монтируются независимо от memory recall.

**Нельзя импортировать код с плавающего `main` без provenance.**

При первоначальном переносе обязательно зафиксировать:

```text
upstream repository
upstream package version
exact upstream commit SHA
source directory
import date
license at that revision
```

Эти данные должны храниться внутри пакета в `UPSTREAM.md`.

---

# 3. Naming

Рекомендуемое имя каталога:

```text
plugins/dsh-openviking-memory/
```

npm package:

```text
@yadsh/dsh-openviking-memory
```

Runtime plugin name:

```text
dsh-openviking-memory
```

Bundle/group IDs:

```text
dsh-openviking-memory
dsh-openviking-memory-runtime
```

Существующий service key желательно сохранить:

```text
openvikingMemory
```

MCP server name также сохранить:

```text
openviking
```

Это позволяет не ломать model-facing tool namespace и существующие OpenViking contracts без необходимости.

Официальный upstream package сейчас публикуется как отдельный DSH bundle и объявляет DSH peer dependencies и bundle patch через `dsh.bundle.patch`.

---

# 4. License and attribution

## 4.1 Applicable license

Не использовать AGPLv3 от корня OpenViking для этого пакета.

OpenViking использует разные лицензии для разных компонентов:

- основной проект — AGPLv3;
- `examples/` — Apache License 2.0.

Сам `@openviking/dsh-memory-plugin` также явно объявляет:

```json
{
  "license": "Apache-2.0"
}
```



Исходный `examples/LICENSE` действительно содержит Apache License 2.0.

Поэтому derived package должен рассматриваться как **Apache-2.0 component** внутри MIT-монорепозитория.

Root `LICENSE` репозитория `xarleyn/dsh-plugins` не должен создавать впечатление, что upstream-derived OpenViking code был перелицензирован в MIT.

## 4.2 Package-local license

Добавить:

```text
plugins/dsh-openviking-memory/LICENSE
```

с verbatim copy применимой Apache License 2.0 из upstream `examples/LICENSE`.

В `package.json`:

```json
{
  "license": "Apache-2.0"
}
```

Apache 2.0 требует при распространении derivative work предоставить копию лицензии, сохранить применимые copyright/attribution notices и явно отмечать изменённые файлы. Если upstream distribution содержит `NOTICE`, соответствующие notices также должны сохраняться.

## 4.3 Attribution files

Обязательно создать:

```text
plugins/dsh-openviking-memory/UPSTREAM.md
```

Пример содержания:

```markdown
# Upstream provenance

This package is derived from:

- Project: OpenViking
- Authors: OpenViking / Volcengine contributors
- Repository: https://github.com/volcengine/OpenViking
- Original package: @openviking/dsh-memory-plugin
- Original path: examples/dsh-memory-plugin
- License: Apache License 2.0
- Imported from commit: <SHA>
- Upstream version: <VERSION>
- Imported on: <DATE>

## Local modifications

The @yadsh fork adapts the plugin to the xarleyn/dsh-plugins
monorepo conventions and adds configurable automatic memory injection,
including manual-only OpenViking operation.

This project is not an official OpenViking distribution.
```

README также должен содержать отдельный раздел:

```markdown
## Upstream & attribution
```

со ссылкой на:

- OpenViking repository;
- оригинальный `@openviking/dsh-memory-plugin`;
- оригинальных авторов;
- Apache-2.0;
- `UPSTREAM.md`.

Нельзя удалять существующие copyright или attribution notices из импортированных source files.

## 4.4 Changed-file notices

Для файлов, которые непосредственно основаны на upstream source, добавить короткий header вида:

```ts
/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */
```

Не нужно утверждать авторство над upstream implementation.

Новый код, написанный полностью с нуля вокруг upstream integration, может использовать обычные repository conventions, но package в целом всё равно должен явно показывать происхождение.

## 4.5 NOTICE handling

Перед импортом проверить pinned upstream revision на наличие:

```text
examples/NOTICE
examples/dsh-memory-plugin/NOTICE
```

Если такой файл существует — сохранить применимые notices.

На момент подготовки этой спеки отдельный `NOTICE` в `examples/dsh-memory-plugin` не обнаружен, однако эту проверку нужно делать именно по зафиксированному commit, а не считать это постоянным свойством upstream.

---

# 5. Repository-first development

Этот plugin **не должен сначала копироваться, а потом постепенно приводиться к правилам монорепо**.

Сначала создать canonical scaffold через существующий generator:

```bash
pnpm nx g dsh-plugin openviking-memory \
  --description "OpenViking memory integration with controllable automatic injection"
```

и только затем переносить upstream implementation в полученную структуру.

`xarleyn/dsh-plugins` уже использует `plugins/*` как independently versioned npm packages, `packages/*` для shared libraries, Nx Version Plans и проверки `check`, `deps:check`, `tarball:verify`. Repository README прямо называет plugin guidelines canonical правилами для новых пакетов.

До начала implementation coding agent обязан прочитать:

```text
/AGENTS.md
repository plugin guidelines
compatibility policy
release runbook
generated plugin scaffold
```

и посмотреть как минимум несколько существующих production plugins:

```text
plugins/dsh-doc-impact
plugins/dsh-session-scope
plugins/dsh-prompt-firewall
```

Цель — перенять:

- package layout;
- TypeScript conventions;
- Cordis lifecycle patterns;
- config/schema style;
- tests;
- logging;
- effect cleanup;
- build output;
- package `files`;
- README structure;
- release metadata.

Repository rules имеют приоритет над этой SPEC в вопросах общего code style/build/release architecture.

---

# 6. External sources of truth

При реализации соблюдать следующий порядок приоритетов:

1. `xarleyn/dsh-plugins` `AGENTS.md` и plugin guidelines.
2. Актуальный DeepSeek Harness source и official docs.
3. Актуальный upstream `@openviking/dsh-memory-plugin`.
4. Хорошие существующие `@yadsh` plugins.
5. Community DSH guides — только как вспомогательный источник.

DSH находится в developer preview и прямо предупреждает о возможных compatibility-breaking changes, поэтому нельзя переносить старые Cordis patterns только потому, что они присутствуют в OpenViking example.

Для config новый код должен следовать официальной DSH convention: typed `Config` + одноимённый Schemastery schema с defaults и validation.

---

# 7. Port strategy

Не копировать upstream directory как opaque collection `.mjs`.

Предпочтительный путь:

```text
upstream behavior
        ↓
@yadsh scaffold
        ↓
TypeScript port
        ↓
repository conventions
        ↓
@yadsh extensions
```

Если generator и текущие repository guidelines предполагают TypeScript, upstream `.mjs` implementation переносится в `.ts`.

При этом необходимо сохранять логическое разделение upstream modules примерно на:

```text
src/
  index.ts
  config.ts
  client.ts
  runtime.ts
  lifecycle.ts
  capture.ts
  mcp.ts
  skills.ts
  uri-guard.ts

  openviking/
    credentials.ts
    workspace-peer.ts
    ...
```

Фактическая структура может отличаться, если canonical `@yadsh` layout предусматривает другой organization.

Нельзя тащить generated/vendor files из OpenViking, если их можно нормально представить как поддерживаемый source в монорепо.

---

# 8. Preserve upstream behavior first

Первый implementation milestone — добиться behavioral parity с pinned upstream.

До добавления новых возможностей должны работать:

- OpenViking endpoint/auth resolution;
- workspace peer resolution;
- MCP bridge;
- OpenViking tools;
- skill mounting;
- `viking://` URI guard;
- user/assistant capture;
- optional tool-result capture;
- commit threshold;
- flush;
- subagent skipping;
- recall;
- profile loading;
- session cleanup.

Upstream currently mounts the runtime against `agents`, `sessions` and `tools`, provides `openvikingMemory`, installs session disposal effects, mounts MCP and skills, and applies a `viking://` tools guard.

Only after parity tests pass should fork-specific behavior be implemented.

---

# 9. New injection controls

## 9.1 Master switch

Добавить:

```ts
autoInject: boolean
```

Default:

```text
true
```

Чтобы default installation сохраняла upstream-compatible semantics.

При:

```yaml
autoInject: false
```

должны быть отключены **все автоматические context additions**, включая:

- startup profile injection;
- per-step profile injection;
- automatic semantic recall.

При этом не отключаются:

- capture;
- commit;
- MCP bridge;
- model-callable OpenViking tools;
- skills;
- URI guard;
- runtime/service lifecycle.

Это основной режим, ради которого создаётся fork.

---

# 10. Granular injection controls

Кроме master switch добавить:

```ts
injectStartupProfile: boolean
injectStepProfile: boolean
autoRecall: boolean
```

Defaults:

```yaml
autoInject: true
injectStartupProfile: true
injectStepProfile: true
autoRecall: true
```

Effective behavior:

```ts
startupProfileEnabled =
  autoInject && injectStartupProfile

stepProfileEnabled =
  autoInject && injectStepProfile

recallEnabled =
  autoInject && autoRecall
```

Это позволяет использовать, например:

```yaml
autoInject: true
injectStartupProfile: false
injectStepProfile: false
autoRecall: true
```

или:

```yaml
autoInject: true
injectStartupProfile: true
injectStepProfile: false
autoRecall: false
```

---

# 11. Manual-only mode

Основной целевой пользовательский configuration:

```yaml
config:
  autoInject: false
  syncTurns: true
```

Результат:

```text
automatic startup profile       OFF
automatic per-step profile      OFF
automatic semantic recall       OFF

conversation capture            ON
memory commit                   ON
MCP OpenViking tools            ON
skills                          ON
viking:// guard                 ON
manual model recall             ON
```

Это позволяет агенту самому решить:

> Сейчас мне нужна память → вызвать OpenViking search/read.

Вместо того чтобы plugin безусловно добавлял memory context в каждый step.

---

# 12. Zero-work requirement when disabled

`autoInject: false` не должен означать:

> выполнить recall и просто не добавить результат.

Он должен означать:

> вообще не выполнять автоматический recall/profile work.

То есть при выключенной функции нельзя вызывать:

```text
runtime.profileMessage(...)
runtime.recallMessage(...)
```

и нельзя выполнять соответствующие OpenViking HTTP requests.

Это важно как для latency, так и для token/cost hygiene.

---

# 13. Lifecycle changes

Upstream сейчас выполняет profile/recall в `agent/pre-step`; profile и recall запускаются параллельно через `Promise.all`, а startup hook отдельно вызывает startup profile injection.

Fork должен превратить это примерно в следующую модель:

```ts
ctx.on('agent/session-start', ({ agent }) => {
  if (skipMemory(agent.session)) return

  registerSessionCleanup(agent.session)

  if (!config.autoInject) return
  if (!config.injectStartupProfile) return

  return injectStartupProfile(agent, runtime)
})
```

Для `agent/pre-step`:

```ts
ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
  const decision = await next()

  if (skipMemory(agent.session)) return decision
  if (decision.kind !== 'enter' || signal.aborted) return decision
  if (!config.autoInject) return decision

  const tasks = []

  if (config.injectStepProfile) {
    tasks.push(runtime.profileMessage(agent))
  }

  if (config.autoRecall) {
    tasks.push(runtime.recallMessage(agent, decision.messages))
  }

  if (tasks.length === 0) {
    return decision
  }

  const additions = (await Promise.all(tasks)).filter(Boolean)

  ...
})
```

Не копировать этот pseudo-code буквально, если актуальные DSH lifecycle APIs отличаются. Использовать current official contracts.

---

# 14. Existing settings compatibility

Все полезные upstream settings должны быть сохранены, если нет конкретной причины удалить их.

В частности:

```text
endpoint
apiKey
account
user
peerId
workspacePeer
recallPeerScope
recallQueryExpansion
syncTurns

recallTokenBudget
recallMaxContentChars
recallPreferAbstract
recallLimit
scoreThreshold
minQueryLength
profileTokenBudget

commitTokenThreshold
commitKeepRecentCount

captureToolResults
captureMode
captureMaxLength
captureToolMaxChars
captureAssistantTurns

skipSubagentSessions

requestTimeoutMs
mcpToolCallTimeoutMs
```

Upstream currently exposes this family of settings and clamps/normalizes many of them in its runtime config.

Не менять semantics существующего setting без migration note.

---

# 15. Configuration schema

Не оставлять configuration как невалидируемый loose object.

Создать canonical:

```ts
export interface Config {
  ...
}

export const Config = Schema.object({
  ...
})
```

с:

- defaults;
- ranges;
- enums;
- descriptions;
- validation.

DSH official docs прямо рекомендуют Schemastery configuration и fail-fast behavior для invalid configuration.

Особенно:

```text
scoreThreshold        0..1
recallLimit           positive bounded integer
timeouts              positive integer
captureMode           enum
recallPeerScope       enum
recallQueryExpansion  enum
```

не должны молча превращать явно ошибочные значения пользователя в другие значения, если repository guidelines предпочитают fail-loud validation.

---

# 16. Settings UI

Если текущий `xarleyn/dsh-plugins` reference architecture уже использует DSH user settings sections, injection controls желательно также зарегистрировать как user-editable settings.

Приоритетно вывести:

```text
Automatic memory injection
Inject startup profile
Inject profile before each step
Automatic memory recall
Capture conversations
Capture assistant turns
Capture tool results
Skip subagent sessions
```

Но UI settings не должны становиться blocking requirement для первого релиза, если это требует отдельного client plugin.

Минимум v1 — полноценный typed Cordis config.

DSH имеет отдельный settings seam и официальный pattern регистрации Schemastery-backed settings section; его использовать только если это соответствует текущим conventions монорепо.

---

# 17. Bundle

Package должен оставаться нормальным installable DSH bundle.

Пример:

```json
{
  "name": "@yadsh/dsh-openviking-memory",
  "type": "module",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

DSH официально использует bundle patch как package-level composition mechanism.

`cordis.patch.yml` должен ссылаться уже на:

```text
@yadsh/dsh-openviking-memory
```

а не на upstream package.

---

# 18. Package metadata

`package.json` должен явно содержать:

```json
{
  "name": "@yadsh/dsh-openviking-memory",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/xarleyn/dsh-plugins.git",
    "directory": "plugins/dsh-openviking-memory"
  }
}
```

Добавить keywords:

```text
deepseek-harness
dsh
dsh-plugin
openviking
memory
agent-memory
long-term-memory
manual-recall
auto-recall
context
```

Description должна прямо обозначать происхождение или integration:

> OpenViking memory integration for DeepSeek Harness with configurable automatic context injection; derived from the official OpenViking DSH plugin.

---

# 19. Dependency policy

Не добавлять собственные копии DSH runtime packages как runtime dependencies, если canonical DSH pattern предусматривает peer dependencies.

Upstream уже использует DSH components как peer dependencies и отдельно pins dev dependencies для testing.

Fork должен привести dependency model к текущей policy `xarleyn/dsh-plugins`.

Перед добавлением каждой dependency проверить:

1. можно ли использовать существующую workspace package;
2. нужна ли dependency в runtime;
3. должна ли она быть peerDependency;
4. допускается ли она `deps:check`;
5. не создаёт ли она вторую Cordis/DSH runtime copy.

---

# 20. Shared code

Не переносить OpenViking-specific код в `packages/plugin-kit` только потому, что он используется несколькими файлами этого плагина.

В shared packages монорепо выносить код только если он реально пригоден другим `@yadsh` plugins.

OpenViking-specific:

```text
credentials
peer resolution
client
recall
capture
OpenViking MCP behavior
```

должен оставаться внутри `dsh-openviking-memory`.

---

# 21. Logging

Использовать существующий `@yadsh` logging convention / `plugin-log`, если repository guidelines считают его canonical.

Полезные debug events:

```text
openviking connected
startup profile skipped
step profile skipped
automatic recall skipped
recall requested
recall returned N entries
capture accepted/skipped
commit requested
commit completed
MCP mounted
skill provider mounted
session excluded as subagent
```

Не логировать:

```text
API keys
Bearer tokens
raw credentials
полный memory content по умолчанию
```

---

# 22. Tests

## 22.1 Upstream parity

Перенести или переосмыслить upstream tests так, чтобы покрыть:

- config resolution;
- credentials;
- client;
- recall;
- capture;
- commit;
- MCP mount;
- URI guard;
- peer scope;
- subagent skipping;
- cleanup.

Не копировать tests только ради количества — привести их к `@yadsh/test-kit` и canonical repository patterns.

## 22.2 New injection matrix

Обязательно покрыть:

| Config | startup profile | step profile | recall |
|---|---:|---:|---:|
| defaults | yes | yes | yes |
| `autoInject: false` | no | no | no |
| `injectStartupProfile: false` | no | yes | yes |
| `injectStepProfile: false` | yes | no | yes |
| `autoRecall: false` | yes | yes | no |
| all granular false | no | no | no |

## 22.3 Manual-only test

Test должен доказать, что:

```yaml
autoInject: false
syncTurns: true
```

приводит к:

- zero startup injection;
- zero pre-step injection;
- zero automatic recall request;
- capture still occurs;
- commit still occurs;
- MCP still mounts;
- skills still mount;
- URI guard still works.

Особенно важно spy/assert на network/client layer:

```text
profile request count == 0
recall request count == 0
```

---

# 23. Integration tests

Добавить isolated DSH profile integration test.

Минимальный smoke flow:

```bash
dsh plugin --profile test-openviking add <packed-tarball>
dsh --profile test-openviking --dump-config
```

Проверить:

- bundle обнаружен;
- Cordis graph собирается;
- service isolation корректен;
- plugin загружается;
- uninstall не оставляет composition debris.

Если возможно — использовать temporary `DSH_HOME`.

---

# 24. Live OpenViking test

Сохранить идею upstream optional E2E test.

Запуск только при явном opt-in:

```text
OPENVIKING_E2E=1
```

Тест:

1. подключается к реальному OpenViking;
2. создаёт sentinel memory;
3. ждёт commit/extraction;
4. делает search/read;
5. проверяет sentinel;
6. при возможности удаляет созданные test resources.

Без credentials test должен корректно skip, а не fail CI.

---

# 25. Standard monorepo gates

Перед merge должны проходить существующие repository gates:

```bash
pnpm check
pnpm deps:check
pnpm tarball:verify
```

а также plugin-local:

```bash
pnpm nx test dsh-openviking-memory
pnpm nx lint dsh-openviking-memory
pnpm nx typecheck dsh-openviking-memory
pnpm nx build dsh-openviking-memory
```

Названия Nx project targets уточнить по scaffold.

`tarball:verify` особенно важен: package должен реально содержать:

```text
compiled runtime
cordis.patch.yml
README.md
LICENSE
UPSTREAM.md
required skills/assets
```

и не зависеть от случайных workspace files.

---

# 26. Upstream sync strategy

Fork не должен становиться permanently detached copy.

Создать:

```text
plugins/dsh-openviking-memory/UPSTREAM.md
plugins/dsh-openviking-memory/docs/upstream-sync.md
```

`upstream-sync.md` описывает процесс:

```text
1. Determine current imported upstream SHA.
2. Fetch newer upstream dsh-memory-plugin.
3. Review upstream commits affecting the package/shared memory code.
4. Separate:
   - bug fixes
   - DSH compatibility fixes
   - OpenViking API changes
   - behavior changes
   - generated/shared changes
5. Port relevant changes manually.
6. Do not overwrite @yadsh-specific injection controls.
7. Run parity + injection tests.
8. Update UPSTREAM.md SHA/version/date.
9. Add changelog entry noting upstream sync.
```

Не делать blind directory overwrite.

---

# 27. Optional upstream-sync tooling

После первого стабильного релиза можно добавить script:

```text
scripts/check-openviking-upstream.mjs
```

который проверяет:

- latest upstream package version;
- current imported SHA;
- changed files under relevant upstream paths.

Но script не должен автоматически merge/rewrite source.

Его задача — обнаружить drift и показать diff/source range.

---

# 28. README

README должен содержать:

```text
What it is
Why this fork exists
Differences from upstream
Installation
Quick start
Manual-only mode
Configuration
Behavior matrix
OpenViking setup
Security/privacy
Upstream & attribution
License
Development
```

Раздел сверху:

```markdown
> This package is a community-maintained derivative of
> OpenViking's official `@openviking/dsh-memory-plugin`.
> It is not maintained or endorsed by the OpenViking project.
```

Сразу после него ссылка на original upstream.

---

# 29. Example configuration

Основной README example:

```yaml
- insert:
    - id: dsh-openviking-memory
      name: '@deepseek-ai/cordis-plugin-group'
      group: true
      isolate:
        openvikingMemory: true
      config:
        - id: dsh-openviking-memory-runtime
          name: '@yadsh/dsh-openviking-memory'
          config:
            endpoint: http://openviking:1933

            # Fork-specific behavior:
            autoInject: false

            # Keep learning from conversations:
            syncTurns: true
            captureAssistantTurns: true
            captureToolResults: false
```

Дополнительно показать upstream-compatible mode:

```yaml
config:
  autoInject: true
  injectStartupProfile: true
  injectStepProfile: true
  autoRecall: true
```

---

# 30. Backwards compatibility

Default fork configuration должна максимально повторять upstream.

То есть установка пакета без дополнительных options не должна неожиданно менять memory semantics.

Fork-specific behavior активируется opt-in:

```yaml
autoInject: false
```

Это облегчает upstream parity и делает различия предсказуемыми.

---

# 31. Conflict with official package

Официальный:

```text
@openviking/dsh-memory-plugin
```

и fork:

```text
@yadsh/dsh-openviking-memory
```

не должны одновременно подключаться в один profile.

README должен явно предупреждать:

> Remove/disable the official OpenViking DSH memory plugin before enabling this package.

Иначе вероятны:

- duplicate capture;
- duplicate recall;
- duplicate MCP registrations;
- conflicting services;
- duplicate skill providers;
- duplicate injections.

---

# 32. Security

Сохранить upstream `viking://` guard.

Дополнительно проверить:

- credentials never enter agent messages;
- API key never appears in logs;
- endpoint redaction follows repository conventions;
- `viking_forget`/delete-equivalent semantics не ослабляются;
- automatic capture controls не меняют user authorization semantics;
- `autoInject: false` не превращается в `memory disabled` — это только отключение automatic context presentation.

---

# 33. Non-goals for v1

Не включать в первый перенос:

- собственный OpenViking server;
- новый memory backend abstraction;
- automatic migration данных;
- изменение OpenViking storage format;
- альтернативный RAG engine;
- сложный Web UI dashboard;
- автоматическое переписывание upstream source;
- совместную установку с official OpenViking plugin;
- радикальное изменение MCP tool contracts.

Сначала нужен качественный maintainable fork.

---

# 34. Implementation phases

## Phase 0 — Research and provenance

- прочитать repository guidelines;
- изучить reference plugins;
- зафиксировать upstream commit;
- проверить upstream license;
- проверить NOTICE;
- составить список upstream files;
- зафиксировать behavioral baseline.

Deliverable:

```text
UPSTREAM.md
initial implementation notes
```

## Phase 1 — Scaffold

Создать package через Nx generator.

Привести:

```text
package.json
tsconfig
project config
Cordis bundle
README skeleton
tests
build
```

к repository standards.

## Phase 2 — Behavioral port

Перенести upstream functionality без новых fork-specific behavior.

Все parity tests должны пройти.

## Phase 3 — Configuration modernization

Перевести config на typed Schemastery schema, если это не сделано upstream-compatible layer.

Добавить validation/defaults/docs.

## Phase 4 — Injection controls

Добавить:

```text
autoInject
injectStartupProfile
injectStepProfile
autoRecall
```

Реализовать zero-work semantics.

## Phase 5 — Tests

Добавить:

```text
behavior matrix
manual-only tests
network-call assertions
capture independence tests
MCP/skills independence tests
```

## Phase 6 — Packaging and licensing

Проверить:

```text
LICENSE
UPSTREAM.md
README attribution
modified-file notices
package.json license
tarball contents
```

## Phase 7 — Integration

Проверить installation через реальный packed package в isolated DSH profile.

## Phase 8 — Release

Создать independent Nx Version Plan для:

```text
@yadsh/dsh-openviking-memory@0.1.0
```

Release notes должны прямо написать:

> Initial @yadsh distribution derived from OpenViking's Apache-2.0 licensed `@openviking/dsh-memory-plugin`, adding controllable automatic profile/recall injection.

---

# 35. Acceptance criteria

Плагин считается готовым к `0.1.0`, когда одновременно выполнены все условия:

- package находится в `plugins/dsh-openviking-memory`;
- package построен по текущим `xarleyn/dsh-plugins` guidelines;
- original authors и repository явно указаны;
- Apache-2.0 license сохранена;
- upstream commit зафиксирован;
- modified upstream-derived files отмечены;
- official package не требуется как runtime dependency;
- upstream behavior покрыт тестами;
- `autoInject: false` действительно исключает automatic injection;
- при `autoInject: false` нет automatic profile/recall HTTP calls;
- capture может работать независимо от injection;
- MCP tools продолжают работать;
- skills продолжают работать;
- URI guard продолжает работать;
- subagent filtering продолжает работать;
- default config максимально совместим с upstream;
- package устанавливается через стандартный `dsh plugin`;
- `pnpm check` проходит;
- `pnpm deps:check` проходит;
- `pnpm tarball:verify` проходит;
- clean consumer install проходит;
- README документирует отличие от official plugin;
- release использует обычный Nx Version Plan workflow.

---

# 36. Core architectural rule

Главное отличие fork должно быть реализовано не как patch поверх готовых сообщений, а как разделение независимых capabilities:

```text
OpenViking connection
        │
        ├── tools
        ├── skills
        ├── capture
        ├── commit
        ├── URI protection
        │
        └── automatic context presentation
               ├── startup profile
               ├── step profile
               └── recall
```

`automatic context presentation` — лишь одна optional capability OpenViking integration.

Отключение этой ветки **не должно отключать весь memory integration**.

Именно это является главным функциональным отличием `@yadsh/dsh-openviking-memory` от исходного `@openviking/dsh-memory-plugin`.