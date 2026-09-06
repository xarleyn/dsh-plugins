# SPEC: `dsh-doc-impact`

**Status:** Implemented (MVP, v0.1.0)  
**Target:** DeepSeek Harness  
**Type:** Cordis / DSH plugin  
**Primary use case:** автоматическая проверка документации, связанной с изменённым кодом  
**Working package name:** `dsh-doc-impact`

---

# 1. Summary

`dsh-doc-impact` — плагин для DeepSeek Harness, который связывает код, документацию и другие проектные артефакты в декларативный impact graph.

Основной сценарий:

1. Пользователь задаёт связи между кодом и документацией.
2. Агент выполняет обычную задачу и изменяет файлы.
3. Перед завершением turn/task плагин определяет изменения, сделанные в рамках работы агента.
4. Изменённые файлы сопоставляются с правилами impact graph.
5. Если изменения затрагивают связанную документацию, агент получает дополнительный checkpoint.
6. Агент:
   - обновляет документ;
   - проверяет его и подтверждает, что он остаётся актуальным;
   - либо явно отмечает связь как неприменимую для конкретного изменения.
7. После разрешения impact agent может завершить работу.

Пример:

```text
packages/auth/src/session.ts changed

→ docs/authentication.md
→ docs/security/session-lifecycle.md
```

Перед завершением агент получает:

```text
Documentation impact detected.

The following documentation may be affected by your changes:

- packages/auth/src/session.ts
  → docs/authentication.md
  → docs/security/session-lifecycle.md

Review the affected documentation before completing the task.
Update it if behavior changed.

If a document is already current, explicitly resolve the impact as
"reviewed-current".
```

Плагин не должен пытаться заставлять LLM самостоятельно угадывать расположение документации при каждом запуске. Основной механизм должен быть детерминированным и основанным на явно настроенных пользователем связях.

---

# 2. Goals

## 2.1 Primary goals

Плагин должен:

- отслеживать изменения файлов во время работы агента;
- отличать изменения текущего agent run/turn от уже существовавших изменений пользователя;
- поддерживать связи `code → docs`;
- поддерживать связи `docs → code`;
- поддерживать двунаправленные связи `code ↔ docs`;
- поддерживать glob patterns;
- поддерживать исключения;
- перед завершением turn вычислять impacted artifacts;
- уведомлять агента, а не только пользователя;
- при необходимости заставлять агента выполнить дополнительный step;
- предотвращать бесконечные reminder loops;
- позволять агенту явно разрешить impact без бессмысленного изменения документа;
- работать в monorepo;
- учитывать изменения, сделанные через shell/scripts, а не только через файловые tools DSH;
- не требовать изменения DeepSeek Harness core;
- быть пригодным для установки как обычный DSH plugin.

---

# 3. Non-goals

Первая версия не должна:

- автоматически переписывать документацию;
- использовать LLM для каждой операции matching;
- автоматически считать любую Markdown-ссылку dependency;
- строить полный semantic dependency graph проекта;
- анализировать AST всех языков;
- заменять CI documentation checks;
- блокировать git commit;
- требовать Git;
- автоматически определять все связи между кодом и документацией;
- гарантировать, что текст документации семантически корректен;
- заменять human review.

Discovery связей с помощью LLM, AST, embeddings или references может появиться позднее, но не является частью core MVP.

---

# 4. Core concept

Внутри плагина все отношения представлены как направленный graph:

```text
Source selector
      │
      ▼
relation
      │
      ▼
Target selector
```

Например:

```text
packages/auth/**
      │
      │ documents
      ▼
docs/authentication.md
```

или:

```text
docs/configuration.md
      │
      │ specifies
      ▼
packages/config/**
```

Пользовательский конфиг может использовать более удобные понятия `code`, `docs`, `artifacts`, но внутри они нормализуются в единый graph.

---

# 5. Direction semantics

Не использовать стрелки как единственное обозначение направления в конфиге, поскольку `docs -> code` можно интерпретировать неоднозначно.

Канонические значения:

```yaml
direction: code-to-docs
```

Изменение кода вызывает проверку документации.

```yaml
direction: docs-to-code
```

Изменение документа вызывает проверку реализации.

```yaml
direction: bidirectional
```

Изменение любой стороны вызывает проверку другой.

---

# 6. Relations

MVP должен поддерживать следующие relation types.

## `documents`

Документ описывает реализацию.

```text
code → documentation
```

Типичный сценарий:

```yaml
relation: documents
direction: code-to-docs
```

---

## `specification`

Документ является specification/source-of-truth для реализации.

```text
documentation → code
```

Пример:

```yaml
relation: specification
direction: docs-to-code
```

---

## `synchronized`

Обе стороны должны оставаться синхронизированными.

```text
code ↔ documentation
```

---

## `related`

Generic relation без дополнительной семантики.

---

# 7. Future relation types

Архитектура должна позволять позднее добавить:

```text
generated-from
example-of
changelog-for
migration-for
schema-for
contract-for
test-for
```

Например:

```text
public API
  → API documentation
  → OpenAPI schema
  → examples
  → CHANGELOG
```

Поэтому внутренний engine не должен быть жёстко привязан только к `.md`.

---

# 8. Configuration

Основной workspace config:

```text
.dsh/doc-impact.yml
```

Плагин также может позволять изменить путь через plugin config.

Пример:

```yaml
version: 1

defaults:
  mode: remind
  scope: turn
  changeDetection: auto

rules:
  - id: auth-docs

    description: Authentication behavior documentation

    code:
      include:
        - packages/auth/**
        - packages/server/src/auth/**
      exclude:
        - "**/*.test.ts"
        - "**/*.spec.ts"

    docs:
      include:
        - docs/authentication.md
        - docs/security/session-lifecycle.md

    direction: code-to-docs
    relation: documents

  - id: configuration-contract

    code:
      include:
        - packages/config/**

    docs:
      include:
        - docs/configuration.md

    direction: bidirectional
    relation: specification

    mode: require-resolution
```

---

# 9. Concise configuration

Для простых случаев должен поддерживаться сокращённый синтаксис.

```yaml
rules:
  - id: auth
    code:
      - packages/auth/**
    docs:
      - docs/authentication.md
    direction: code-to-docs
```

Parser нормализует его в canonical representation.

---

# 10. Rule model

Внутренний тип примерно:

```ts
interface ImpactRule {
  id: string
  description?: string

  source: FileSelector
  targets: ArtifactSelector[]

  direction:
    | 'code-to-docs'
    | 'docs-to-code'
    | 'bidirectional'

  relation:
    | 'documents'
    | 'specification'
    | 'synchronized'
    | 'related'

  mode:
    | 'remind'
    | 'require-review'
    | 'require-resolution'
    | 'require-update'

  enabled: boolean
}
```

---

# 11. Selectors

Selectors должны поддерживать:

- single file;
- directory;
- glob;
- multiple include patterns;
- exclude patterns.

Пример:

```yaml
code:
  include:
    - packages/api/src/**
    - packages/sdk/src/**
  exclude:
    - "**/*.test.ts"
    - "**/__fixtures__/**"
```

Все пути workspace-relative.

Пути должны нормализоваться в POSIX-style для matching независимо от ОС:

```text
packages/auth/src/index.ts
```

даже на Windows.

---

# 12. Artifact model

Хотя пользовательская функциональность называется documentation impact, internal representation желательно сразу сделать generic.

Например:

```ts
type ArtifactType =
  | 'documentation'
  | 'code'
  | 'specification'
  | 'contract'
  | 'example'
  | 'changelog'
  | 'schema'
  | 'other'
```

Это позволит позднее развить plugin в change-impact engine без изменения storage/config model.

При этом UI и первая версия продукта остаются ориентированными на documentation.

---

# 13. Impact lifecycle

Основной lifecycle:

```text
turn starts
     │
     ▼
capture baseline
     │
     ▼
agent works
     │
     ├─ edits files
     ├─ runs shell commands
     ├─ runs scripts
     └─ subagents may edit workspace
     │
     ▼
agent attempts to stop
     │
     ▼
compute changed files
     │
     ▼
match impact rules
     │
     ▼
unresolved impacts?
   ┌───────┴───────┐
  no              yes
  │                │
  ▼                ▼
finish         steer agent
                   │
                   ▼
             review/update docs
                   │
                   ▼
             resolve impacts
                   │
                   ▼
              attempt stop
```

---

# 14. DSH integration

Основная реализация должна быть обычным Cordis plugin.

DeepSeek Harness построен вокруг plugin architecture; официальная архитектура прямо указывает, что policy/hook functionality должна подключаться через event taxonomy вместо модификации agent loop.

Ключевой extension point:

```text
agent/turn-stopping
```

Он вызывается непосредственно перед закрытием turn. Listener может выполнить:

```ts
agent.steer(...)
```

После этого agent loop повторно проверяет inbox и выполняет ещё один model step вместо завершения turn. Это именно тот механизм, который уже используется Stop-hook bridge DSH.

Поэтому рекомендуемая интеграция:

```ts
ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
  // calculate impacts

  if (shouldContinue) {
    agent.steer(createImpactMessage(...))
  }
})
```

Не изменять `agent-loop`.

---

# 15. Why not system prompt injection

Постоянная инструкция вида:

```text
Remember to update documentation.
```

не должна быть основным механизмом.

Причины:

- занимает context на каждом step;
- агент привыкает игнорировать generic instructions;
- список impacted документов неизвестен заранее;
- нет deterministic tracking;
- нет состояния resolution;
- нельзя понять, какие документы относятся именно к текущим изменениям.

Плагин должен добавлять информацию только тогда, когда реально обнаружен impact.

---

# 16. Change detection requirements

Это одна из наиболее важных частей реализации.

Плагин не должен считать:

```text
git diff HEAD
```

достаточным.

В workspace до запуска агента уже могут существовать пользовательские изменения.

Пример:

```text
До запуска:

packages/auth/session.ts modified by user

Agent task:
change README formatting

Если просто посмотреть git diff:

packages/auth/session.ts appears modified

→ ложный documentation impact
```

Плагин должен определять **delta относительно состояния workspace в начале turn**.

---

# 17. Baseline

При начале turn создаётся:

```ts
TurnBaseline
```

Пример:

```ts
interface TurnBaseline {
  turnId: number

  git?: {
    head: string
    dirtyFiles: Map<string, FileState>
  }

  filesystem?: {
    files: Map<string, FileState>
  }

  createdAt: number
}
```

---

# 18. Recommended Git change detector

Если workspace является Git repository:

### At turn start

Запомнить:

```text
HEAD commit
```

и состояние файлов, которые уже отличаются от HEAD.

Для уже dirty файлов сохранить:

- existence;
- content hash;
- file type;
- optionally index hash.

Не требуется хэшировать весь repository.

### At turn stop

Получить:

- текущий HEAD;
- worktree changes;
- staged changes;
- untracked files;
- deleted files.

Если HEAD изменился:

```text
baseline HEAD != current HEAD
```

дополнительно вычислить файлы, изменённые между commit states.

---

# 19. Dirty workspace attribution

Для файла, который был clean на baseline:

```text
clean initially
dirty now

→ changedByAgent = true
```

Для файла, который уже был dirty:

```text
initial hash != current hash

→ changedByAgent = true
```

Если content одинаков:

```text
initial hash == current hash

→ changedByAgent = false
```

Это позволяет не приписывать агенту пользовательские изменения.

---

# 20. Committed changes

Агент может выполнить:

```text
git commit
```

во время задачи.

Поэтому только current worktree diff недостаточен.

Нужно фиксировать:

```text
baselineHead
```

и сравнивать его с current HEAD.

Если HEAD изменился:

```text
git diff baselineHead..currentHead
```

участвует в change set.

---

# 21. Net-change semantics

По умолчанию plugin реагирует на **финальный semantic filesystem delta**, а не на любой факт открытия/перезаписи файла.

Если агент:

```text
changes file
then restores original contents
```

impact отсутствует.

Это ожидаемое поведение.

Опционально позднее:

```yaml
trackTouches: true
```

может учитывать сам факт изменения независимо от финального состояния.

---

# 22. Non-Git workspace

Если Git отсутствует, используется filesystem snapshot detector.

На baseline для файлов, попадающих под configured selectors, сохраняются:

```text
path
existence
size
mtime
content hash
```

На stop выполняется comparison.

Новые файлы обнаруживаются повторным glob expansion.

Удалённые — сравнением baseline set с current set.

---

# 23. Large repositories

Filesystem snapshot всего repository запрещён по умолчанию.

Хэшируются только:

- файлы, соответствующие configured selectors;
- уже dirty files;
- необходимые target artifacts.

Config:

```yaml
changeDetection:
  maxSnapshotFiles: 10000
```

При превышении:

```text
warn + degrade gracefully
```

а не падать.

---

# 24. Realtime FS events

DSH имеет filesystem extension points вроде:

```text
fs/write-intent
fs/edit-intent
fs/observed
```

но они относятся к соответствующим filesystem tool paths и не должны считаться единственным источником истины для arbitrary shell mutation.

Их следует использовать как optimization:

```text
fs event
   ↓
mark candidate dirty
   ↓
final detector verifies actual state
```

Таким образом:

```text
FS events = hints
baseline diff = source of truth
```

---

# 25. Matching algorithm

После получения:

```ts
changedFiles: Set<string>
```

plugin проходит rules.

Для каждой rule определяется:

```text
changed source files
changed target files
direction
```

### code-to-docs

Если изменён любой `code` selector:

```text
docs become impacted
```

### docs-to-code

Если изменён любой `docs` selector:

```text
code becomes impacted
```

### bidirectional

Любое изменение одной стороны вызывает impact другой.

---

# 26. Impact instance

Для каждого срабатывания создаётся runtime entity:

```ts
interface Impact {
  id: string

  ruleId: string

  triggerFiles: string[]
  targetFiles: string[]

  relation: string

  status:
    | 'pending'
    | 'updated'
    | 'reviewed-current'
    | 'not-applicable'
    | 'superseded'

  reason?: string

  detectedAt: number
}
```

---

# 27. Impact fingerprint

Для защиты от повторных reminder loops рассчитывается fingerprint.

Например:

```text
hash(
  ruleId +
  sorted(triggerFiles) +
  sorted(targetFiles)
)
```

Plugin хранит:

```ts
reminderCount[fingerprint]
```

Если change set изменился, fingerprint изменяется и impact считается новым.

---

# 28. Resolution modes

## `remind`

Самый мягкий режим.

Plugin один раз вызывает:

```text
agent.steer(...)
```

После следующего stop тот же fingerprint больше не блокирует завершение.

Не требует explicit resolution.

Recommended default.

---

## `require-review`

Агент должен проверить target artifact.

Resolution:

```text
reviewed-current
updated
not-applicable
```

---

## `require-resolution`

То же, но explicit resolution обязательно.

Это рекомендуемый строгий режим.

---

## `require-update`

Target artifact должен реально измениться.

Использовать только для случаев, где update гарантированно требуется.

Например generated manifests.

Для обычной документации этот режим не должен быть default.

---

# 29. Resolution tool

Для strict modes plugin должен зарегистрировать model tool:

```text
doc_impact_resolve
```

Schema:

```ts
{
  ruleId: string,

  status:
    | 'reviewed-current'
    | 'updated'
    | 'not-applicable',

  reason?: string
}
```

Пример:

```json
{
  "ruleId": "auth-docs",
  "status": "reviewed-current",
  "reason": "The refactor preserves the documented session behavior."
}
```

---

# 30. Resolution validation

### `updated`

Plugin проверяет, что хотя бы один target artifact действительно изменился после baseline или после impact detection.

Если нет:

```text
reject resolution
```

### `reviewed-current`

Допускается без изменения файла.

### `not-applicable`

Требует непустой `reason`.

---

# 31. Automatic resolution

Если impacted target был изменён после обнаружения impact:

```text
pending → updated
```

можно выполнять автоматически.

Но `reviewed-current` нельзя надёжно определить без explicit model action.

---

# 32. Reminder message

Сообщение должно быть коротким и детерминированным.

Пример:

```text
Documentation impact check

Your changes affect documentation linked by project rules.

Changed:
- packages/auth/src/session.ts

Review:
- docs/authentication.md
- docs/security/session-lifecycle.md

Relation:
auth implementation → authentication documentation

Update the documents if behavior changed.

If they remain correct, resolve this impact using
doc_impact_resolve with status "reviewed-current".
```

Не добавлять огромный policy prompt.

---

# 33. Multiple impacts

Impacts группируются.

Не отправлять:

```text
10 individual steering messages
```

Вместо этого:

```text
Documentation impact check

3 rules were triggered.

1. auth-docs
   changed:
   - packages/auth/src/session.ts

   review:
   - docs/authentication.md

2. api-docs
   changed:
   - packages/api/src/router.ts

   review:
   - docs/api.md
   - docs/sdk.md
```

---

# 34. Loop protection

Поскольку `agent/turn-stopping` + `agent.steer()` может продолжить turn, plugin обязан иметь собственную защиту от бесконечных циклов.

DSH Stop hook использует тот же механизм continuation, поэтому plugin не должен blindly steer на каждом stop.

Config:

```yaml
safety:
  maxReminderRounds: 2
  onLimit: allow
```

Варианты:

```text
allow
warn
error
```

Default:

```yaml
maxReminderRounds: 2
onLimit: allow
```

---

# 35. `remind` loop behavior

Первый stop:

```text
pending impact
→ steer
```

Второй stop с тем же fingerprint:

```text
allow stop
```

Если между ними агент изменил дополнительный код и появился новый impact:

```text
new fingerprint
→ another reminder
```

---

# 36. Strict loop behavior

Для `require-resolution`:

```text
pending
→ steer
→ agent works
→ stop
```

Если impact остаётся unresolved:

```text
steer again
```

до `maxReminderRounds`.

После limit действует `onLimit`.

Default fail-open нужен для защиты от поломанной модели/plugin loop.

---

# 37. User configuration override

Global plugin config:

```yaml
- id: dsh-doc-impact
  config:
    enabled: true
    configFile: .dsh/doc-impact.yml

    defaults:
      mode: remind

    safety:
      maxReminderRounds: 2
      onLimit: allow
```

Workspace config содержит project relations.

---

# 38. Local overrides

Optional:

```text
.dsh/doc-impact.local.yml
```

Он может использоваться для personal overrides.

Например:

```yaml
disabledRules:
  - legacy-docs
```

Этот файл рекомендуется добавить в `.gitignore`.

Не обязателен для MVP.

---

# 39. Frontmatter configuration

Post-MVP можно поддержать colocated rules непосредственно в документации:

```markdown
---
doc-impact:
  code:
    - packages/auth/**
    - packages/server/src/session/**
  direction: code-to-docs
  mode: require-review
---

# Authentication
```

Это позволяет документу объявить:

```text
"I document these parts of the project."
```

---

# 40. Central vs colocated config precedence

Рекомендуемый порядок:

```text
plugin global config
       ↓
workspace .dsh/doc-impact.yml
       ↓
document frontmatter
       ↓
local overrides
```

Central config может отключать frontmatter scanning:

```yaml
frontmatter:
  enabled: false
```

---

# 41. Commands

MVP желательно предоставить commands.

## `/doc-impact`

Показывает текущий status.

```text
Documentation impacts

Pending: 2
Resolved: 1
```

---

## `/doc-impact check`

Принудительно вычисляет impacts сейчас.

---

## `/doc-impact explain <rule>`

Показывает:

```text
Rule: auth-docs

Code:
packages/auth/**

Documentation:
docs/authentication.md

Direction:
code-to-docs

Mode:
require-resolution
```

---

## `/doc-impact changed`

Показывает файлы, которые plugin считает изменёнными текущим агентом.

Это крайне полезно для debugging.

---

# 42. Optional agent tool

Можно предоставить read-only tool:

```text
doc_impact_status
```

Он возвращает:

```json
{
  "pending": [...],
  "resolved": [...]
}
```

Но для MVP достаточно `doc_impact_resolve`, поскольку status уже содержится в steering message.

---

# 43. UI

UI не является обязательным для MVP.

Phase 2 может добавить settings panel.

Представление:

```text
Documentation Impact

Auth
packages/auth/**
        ↓
docs/authentication.md

API
packages/api/**
        ↓
docs/api.md
        ↓
examples/api/**
```

---

# 44. Graph editor

В перспективе UI может позволять:

- создать rule;
- выбрать source glob;
- выбрать target;
- выбрать direction;
- выбрать relation;
- выбрать enforcement mode;
- временно отключить rule.

Не пытаться реализовать visual graph editor в первой версии.

---

# 45. Subagents

Baseline-diff architecture автоматически видит изменения subagent, если subagent работает в том же workspace.

Это предпочтительно.

Например:

```text
root agent
   │
   └─ subagent edits packages/api/**
```

На stop root agent увидит filesystem delta.

Не требуется перехватывать каждый `subagent/end`.

---

# 46. Separate subagent workspaces

Если subagent работает в отдельном checkout/worktree:

MVP:

```text
not automatically aggregated
```

Phase 2:

подписка на:

```text
subagent/start
subagent/end
```

и aggregation impact reports от child agents.

DSH имеет соответствующие lifecycle events для subagents.

---

# 47. Turn scope

Default:

```yaml
scope: turn
```

Каждый user turn получает свой baseline.

Это минимизирует false positives.

---

# 48. Session scope

Optional:

```yaml
scope: session
```

Baseline создаётся при начале session.

Полезно для длинных autonomous workflows.

Но тогда impacts могут накапливаться слишком долго.

Не default.

---

# 49. Workspace concurrency

Два агента могут одновременно изменять один workspace.

В таком случае filesystem delta нельзя абсолютно точно приписать конкретному агенту.

Plugin должен:

1. использовать known tool events как attribution hints;
2. использовать baseline diff;
3. при обнаружении concurrent active agents помечать impact:

```text
attribution: uncertain
```

Не делать ложное утверждение:

```text
"you changed this file"
```

Вместо:

```text
"This file changed while this agent was active."
```

---

# 50. Configuration validation

На plugin load проверить:

- duplicate rule IDs;
- invalid direction;
- invalid mode;
- malformed globs;
- targets outside workspace;
- empty source selectors;
- unsupported version.

Ошибки должны содержать rule ID.

Пример:

```text
dsh-doc-impact:
rule "auth-docs":
docs selector must not be empty
```

---

# 51. Missing documentation

Если target file отсутствует:

```text
docs/authentication.md
```

это не plugin failure.

Impact:

```text
targetStatus: missing
```

Agent message:

```text
Expected documentation target does not exist:
docs/authentication.md
```

В `require-update` создание файла считается valid update.

---

# 52. Deleted source

Удаление source file считается change.

Например:

```text
deleted: packages/api/v1.ts
```

может требовать удаления устаревшего documentation section.

---

# 53. Renames

Git detector должен распознавать rename, если возможно.

Internal change:

```ts
{
  type: 'rename',
  from: 'src/old.ts',
  to: 'src/new.ts'
}
```

Для matching проверяются оба path.

---

# 54. Symlinks

Default:

```text
do not follow symlinks outside workspace
```

Config может разрешать это позднее.

Это требуется и для performance, и для безопасности.

---

# 55. Generated files

Selectors могут исключать generated artifacts:

```yaml
exclude:
  - "**/generated/**"
```

Phase 2 можно добавить:

```yaml
ignoreGenerated: true
```

---

# 56. Ignore system

Plugin должен учитывать:

```text
.gitignore
```

только там, где это логично для filesystem discovery.

Explicit paths из config не должны исчезать только потому, что они ignored.

---

# 57. Performance targets

Обычный stop check:

```text
< 100 ms
```

для typical repository после прогрева.

Большие Git repos:

```text
< 500 ms
```

желательно.

Нельзя:

- перечитывать все Markdown files;
- сканировать весь repository каждый agent step;
- запускать LLM;
- строить embeddings.

---

# 58. Caching

Cache:

```text
parsed config
compiled globs
rule graph
baseline dirty state
file hashes
```

Config reload при изменении:

```text
.dsh/doc-impact.yml
```

может быть добавлен через watch или проверку mtime.

---

# 59. Persistence

Turn runtime state можно держать in-memory.

Durable persistence impacts не обязательна для MVP.

Optional persisted events могут позднее использоваться для:

- UI;
- telemetry;
- debugging;
- audit history.

---

# 60. Telemetry

Если доступна OTel integration, plugin может публиковать:

```text
doc_impact.rules_triggered
doc_impact.impacts_created
doc_impact.impacts_resolved
doc_impact.reminders
doc_impact.stop_blocks
doc_impact.detection_duration_ms
```

Не включать содержимое файлов.

---

# 61. Security

Plugin является trusted host code, поэтому:

- не выполнять arbitrary commands из workspace config;
- config — только declarative;
- не позволять target path escape через `../`;
- canonicalize paths;
- не follow external symlink по умолчанию;
- не отправлять содержимое документации куда-либо отдельно от обычной работы агента;
- не использовать shell для glob matching, если можно использовать library.

---

# 62. Suggested architecture

```text
src/
├── index.ts
│
├── config/
│   ├── schema.ts
│   ├── loader.ts
│   └── normalize.ts
│
├── graph/
│   ├── types.ts
│   ├── compile.ts
│   └── matcher.ts
│
├── changes/
│   ├── types.ts
│   ├── detector.ts
│   ├── git-detector.ts
│   ├── filesystem-detector.ts
│   └── baseline.ts
│
├── impact/
│   ├── engine.ts
│   ├── resolution.ts
│   ├── fingerprint.ts
│   └── state.ts
│
├── agent/
│   ├── stopping-hook.ts
│   ├── reminder.ts
│   └── messages.ts
│
├── tools/
│   ├── resolve.ts
│   └── status.ts
│
├── commands/
│   └── doc-impact.ts
│
└── utils/
    ├── paths.ts
    └── hashing.ts
```

---

# 63. Core service

Полезно зарегистрировать внутренний Cordis service:

```ts
ctx.docImpact
```

API:

```ts
interface DocImpactService {
  getChangedFiles(agentId: string): Promise<FileChange[]>

  calculateImpacts(agentId: string): Promise<Impact[]>

  getPending(agentId: string): Impact[]

  resolve(
    agentId: string,
    input: ResolveImpactInput
  ): Promise<void>
}
```

Это позволит UI или другим plugins интегрироваться позднее.

---

# 64. Plugin lifecycle

При `apply()`:

1. load config;
2. validate;
3. compile graph;
4. register service;
5. register lifecycle listeners;
6. register tools;
7. register commands;
8. register cleanup через Cordis lifecycle.

DSH плагины должны использовать обычный reversible Cordis lifecycle вместо глобальных irreversible listeners.

---

# 65. Baseline creation lifecycle

Preferred:

```text
turn/start
```

из session event stream, либо первый `agent/pre-step` конкретного turn.

Baseline должен существовать до того, как agent начнёт mutation work.

Fallback:

```text
first observed pre-step for turn
```

---

# 66. Stop lifecycle

На:

```text
agent/turn-stopping
```

алгоритм:

```ts
const changes = await detector.diff(baseline)
const impacts = engine.calculate(changes)

const unresolved = resolution.filter(impacts)

if (!unresolved.length) {
  return
}

const decision = policy.evaluate(unresolved)

if (decision.steer) {
  agent.steer(createReminderMessage(unresolved))
}
```

---

# 67. Interaction with user changes during active turn

Если пользователь вручную изменяет workspace во время работы agent, absolute attribution невозможна.

Plugin может использовать:

```text
fs events
tool executions
timestamps
baseline
```

но должен считать результат best-effort.

Не строить сложную filesystem attribution систему в MVP.

---

# 68. Alternative implementation A — Native DSH plugin + baseline diff

## Description

Cordis plugin использует:

```text
turn baseline
+
Git/filesystem diff
+
agent/turn-stopping
```

## Advantages

- надёжно видит shell changes;
- не зависит от конкретных file tools;
- работает с scripts;
- работает с generated files;
- не требует core patch;
- хорошо соответствует DSH architecture;
- может отличать pre-existing user changes;
- расширяемо до UI/services;
- естественно поддерживает enforcement modes.

## Disadvantages

- необходимо реализовать baseline logic;
- сложнее Git edge cases;
- concurrent workspace edits не всегда атрибутируемы;
- filesystem fallback может быть дорогим.

## Verdict

**Recommended architecture.**

---

# 69. Alternative implementation B — Track only filesystem/tool events

## Description

Подписаться на:

```text
fs/write-intent
fs/edit-intent
tools/post-execute
```

и вести список touched files.

В конце turn выполнить matching.

## Advantages

- очень быстрая;
- почти нет filesystem scanning;
- легко понять, какой agent вызвал tool;
- хороший realtime tracking.

## Disadvantages

Главный недостаток:

```text
bash
python script
npm script
git checkout
sed
perl
compiler/codegen
```

могут менять файлы вне filesystem tools.

Такие изменения можно пропустить.

DSH действительно имеет filesystem events и tool pipeline, но FS events относятся к соответствующим tool mutations, поэтому считать их полным filesystem journal нельзя.

## Verdict

Хорошо использовать как **optimization/hint layer**, но не как единственный detector.

---

# 70. Alternative implementation C — Generic post-tool snapshot

## Description

После каждого:

```text
tools/post-execute
```

делать:

```text
git status
```

и обновлять change state.

## Advantages

- ловит изменения после shell tool;
- не нужно понимать command;
- достаточно просто.

## Disadvantages

- `git status` после каждого tool может быть дорогим;
- несколько tool calls могут выполняться параллельно;
- изменения могут произойти вне tool execution;
- всё равно нужен baseline;
- большое количество лишнего I/O.

## Verdict

Допустимо как fallback/debug mode, но хуже final-stop snapshot.

---

# 71. Alternative implementation D — Claude/Codex-compatible Stop hooks

DSH уже содержит bridges, которые отображают external Stop hooks на `agent/turn-stopping`; blocking Stop hook может через bridge заставить agent продолжить работу.

Можно реализовать всю функцию как external script:

```text
Stop hook
   ↓
git diff
   ↓
parse .doc-impact.yml
   ↓
return block reason
```

## Advantages

- очень быстро сделать prototype;
- почти нет DSH-specific TypeScript;
- можно использовать существующий hook bridge;
- portable между некоторыми harness systems.

## Disadvantages

- сложнее хранить runtime state;
- плохой UI;
- сложнее explicit resolution;
- хуже integration с agent/session identity;
- subprocess overhead;
- сложнее Windows compatibility;
- plugin configuration менее нативная;
- telemetry и commands сложнее.

## Verdict

**Отличный способ сделать proof-of-concept**, но не preferred production architecture.

---

# 72. Alternative implementation E — Git hook

Можно реализовать:

```text
pre-commit
pre-push
```

который проверяет:

```text
changed code
vs
changed docs
```

## Advantages

- работает независимо от DSH;
- гарантирует проверку в Git workflow;
- подходит людям и агентам;
- хорошо работает в CI.

## Disadvantages

Не решает главный UX:

```text
agent attempts to finish task
```

Git hook сработает только при commit.

Агент может вообще не commit'ить.

Также hook не может естественно сказать агенту:

```text
review this documentation now
```

и продолжить его текущий reasoning loop.

## Verdict

Хороший **дополнительный enforcement layer**, но не замена DSH plugin.

---

# 73. Alternative implementation F — CI check

CI получает diff PR и rules.

Например:

```text
packages/auth/** changed
docs/authentication.md unchanged

→ warning/failure
```

## Advantages

- абсолютная воспроизводимость;
- не зависит от локального harness;
- защищает repository;
- работает для human changes.

## Disadvantages

- feedback слишком поздний;
- CI не знает, что документация была проверена и осталась актуальной;
- часто приводит к бессмысленным dummy doc changes;
- не помогает agent during task.

## Verdict

Стоит позднее предоставить отдельный CLI:

```text
dsh-doc-impact check
```

который можно использовать и в CI.

Но DSH integration остаётся основной функцией.

---

# 74. Alternative implementation G — Skill / AGENTS.md only

Инструкция:

```text
Whenever you modify code, inspect related documentation.
```

## Advantages

- нулевая разработка;
- простая установка.

## Disadvantages

- агент забывает;
- нет mapping;
- нет change detection;
- нет deterministic behavior;
- постоянно расходует context;
- невозможно enforcement;
- нет observability.

## Verdict

Не подходит как решение задачи.

---

# 75. Alternative implementation H — LLM semantic discovery

При stop отправить другой модели:

```text
Here are changed files.
Search repository and determine which documentation may be affected.
```

## Advantages

- не нужно вручную поддерживать все relations;
- может найти неожиданные dependencies;
- полезно в unfamiliar repositories.

## Disadvantages

- дорогая;
- медленная;
- nondeterministic;
- false positives;
- false negatives;
- требует дополнительного repository search;
- поведение меняется между моделями;
- невозможно использовать как строгий policy layer.

## Verdict

Не использовать для enforcement.

Можно добавить как optional:

```text
suggest relations
```

---

# 76. Alternative implementation I — Static semantic graph

Можно анализировать:

- Markdown links;
- source references;
- symbol names;
- imports;
- OpenAPI;
- package structure;
- comments;
- AST.

Из этого автоматически строится graph.

## Advantages

- частично автоматическое discovery;
- нет LLM cost;
- может быть очень точным для structured formats.

## Disadvantages

- language-specific;
- документация часто не содержит прямых references;
- большая implementation complexity;
- graph всё равно требует human correction.

## Verdict

Интересное Phase 3 направление.

---

# 77. Alternative implementation J — File watcher

Запустить `chokidar`/native watcher на workspace.

Каждый filesystem mutation записывается.

## Advantages

- ловит shell changes;
- realtime;
- не зависит от Git.

## Disadvantages

- большие monorepo;
- watchers consuming resources;
- generated directories;
- node_modules;
- rename storms;
- Docker/network filesystems;
- трудно отличить agent changes от внешних processes;
- сложный cleanup.

## Verdict

Не рекомендуется как default.

Возможно optional mode:

```yaml
changeDetection: watcher
```

для non-Git projects.

---

# 78. Architecture comparison

| Architecture | Shell changes | Existing dirty workspace | Agent integration | Cost | Reliability |
|---|---:|---:|---:|---:|---:|
| Native plugin + baseline diff | Yes | Yes | Excellent | Medium | High |
| FS events only | Partial | Yes | Excellent | Low | Medium |
| Post-tool Git snapshot | Yes | Yes | Excellent | Medium/High | High |
| Stop hook script | Yes | Yes | Good | Medium | High |
| Git hook | Yes | Partial | Poor | Low | High |
| CI | Yes | N/A | None | Low | High |
| Prompt/skill | No | No | Medium | Low | Low |
| LLM discovery | Yes | Possible | Good | High | Medium |
| File watcher | Yes | Possible | Good | High | Medium |

---

# 79. Recommended hybrid

Production architecture:

```text
             DSH FS/tool events
                    │
                    │ hints
                    ▼
Turn baseline → Change Detector
                    │
                    ▼
               Impact Graph
                    │
                    ▼
            Resolution Engine
                    │
                    ▼
        agent/turn-stopping policy
                    │
                    ▼
               agent.steer()
```

Source of truth:

```text
baseline diff
```

Fast-path hints:

```text
DSH events
```

Control point:

```text
agent/turn-stopping
```

---

# 80. MVP scope

Version `0.1.0` должна включать только:

- Cordis plugin;
- `.dsh/doc-impact.yml`;
- `code-to-docs`;
- `docs-to-code`;
- `bidirectional`;
- glob include/exclude;
- Git baseline detector;
- filesystem fallback;
- `agent/turn-stopping`;
- reminder aggregation;
- `remind`;
- `require-resolution`;
- `doc_impact_resolve`;
- loop protection;
- `/doc-impact check`;
- `/doc-impact changed`;
- unit tests;
- integration tests.

Не включать:

- UI graph editor;
- LLM discovery;
- AST;
- embeddings;
- OTel dashboards;
- frontmatter;
- distributed subagent aggregation;
- CI GitHub Action.

---

# 81. Version 0.2

Добавить:

- frontmatter rules;
- UI status;
- rule editor;
- impact history;
- telemetry;
- richer artifact types;
- `require-update`;
- local overrides;
- better concurrency reporting.

---

# 82. Version 0.3+

Добавить optional discovery:

```text
"These files are often changed together."
"Documentation references this package."
"Would you like to create an impact rule?"
```

Discovery никогда не должен молча превращаться в enforcement rule.

Требуется user approval.

---

# 83. CLI future

Вынести core engine в отдельный package:

```text
@dsh-doc-impact/core
```

а DSH integration:

```text
dsh-doc-impact
```

Тогда можно сделать:

```bash
dsh-doc-impact check
```

и использовать один engine в:

```text
DSH plugin
Git hooks
CI
pre-commit
IDE
```

Это желательно предусмотреть архитектурно, даже если packages initially находятся в одном repository.

---

# 84. Suggested package separation

При росте проекта:

```text
packages/
├── core/
├── git/
├── dsh-plugin/
└── cli/
```

Но для MVP можно оставить single package с внутренними boundaries.

---

# 85. Testing strategy

## Unit tests

Проверить:

- glob matching;
- exclusions;
- direction semantics;
- config normalization;
- duplicate IDs;
- fingerprints;
- resolution transitions;
- reminder limits.

---

# 86. Git integration tests

Fixtures:

### Clean workspace

```text
baseline clean
agent modifies src/a.ts
→ detected
```

### Pre-existing dirty

```text
src/a.ts dirty before agent
agent does not modify it
→ not detected
```

### Existing dirty changed further

```text
src/a.ts dirty before agent
agent modifies it further
→ detected
```

### New untracked

```text
agent creates src/a.ts
→ detected
```

### Deleted

```text
agent deletes src/a.ts
→ detected
```

### Commit during turn

```text
agent changes + commits
→ detected
```

### Reverted

```text
agent changes then restores file
→ no final impact
```

---

# 87. Agent integration tests

### No impact

```text
change unrelated file
→ agent turn closes normally
```

### Reminder

```text
change matching code
→ turn-stopping
→ steer
→ extra model step
```

### Updated docs

```text
change code + docs
→ no unnecessary warning
```

или impact auto-resolves depending on rule semantics.

### Reviewed current

```text
change code
→ reminder
→ agent reviews docs
→ doc_impact_resolve(reviewed-current)
→ turn closes
```

### Loop protection

```text
model ignores reminder
→ maxReminderRounds reached
→ fail-open
```

---

# 88. Important semantic question: code and docs changed together

Если rule:

```text
code → docs
```

и агент уже изменил оба:

```text
code changed
docs changed
```

impact должен считаться automatically satisfied для `remind`.

Для `require-resolution` возможны два варианта.

Recommended:

```text
target changed → updated
```

и explicit resolve не нужен.

Это снижает noise.

---

# 89. Rule conflicts

Если несколько rules указывают на один target:

```text
auth → docs/api.md
session → docs/api.md
```

UI/reminder должен объединять target, сохраняя причины.

Не отправлять duplicate paths.

---

# 90. Explainability

Любой impact должен быть explainable.

Например `/doc-impact explain`:

```text
docs/authentication.md is impacted because:

rule: auth-docs
direction: code-to-docs
matched:
packages/auth/src/session.ts

selector:
packages/auth/**
```

Никаких opaque heuristic decisions в core engine.

---

# 91. Logging

Debug mode:

```yaml
debug: true
```

может логировать:

```text
baseline created
changed files detected
rule matched
impact generated
impact resolved
reminder emitted
turn allowed
```

Не логировать file contents.

---

# 92. Compatibility strategy

DeepSeek Harness пока находится в developer preview, поэтому plugin APIs могут изменяться. Официальные материалы прямо предупреждают, что core/plugin APIs продолжают развиваться.

Поэтому DSH-specific code должен быть изолирован:

```text
src/dsh/
```

а impact engine не должен импортировать agent loop internals.

Использовать только публичные extension points:

```text
agent/*
fs/*
tools/*
session/*
```

Не импортировать concrete `agent-loop`.

---

# 93. No core patching

Запрещено:

```text
patch packages/core/agent-loop
monkey-patch agent internals
replace loop implementation
```

Agent-loop README прямо указывает, что дополнительная policy/hook functionality должна жить во внешних plugins.

---

# 94. Package metadata

Предполагаемый package:

```json
{
  "name": "dsh-doc-impact"
}
```

Bundle должен подключаться стандартным способом DSH/Cordis.

Не bake plugin непосредственно в DSH source tree.

---

# 95. Definition of Done for MVP

MVP считается готовым, если выполняется следующий сценарий.

Repository:

```text
src/auth/session.ts
docs/authentication.md
```

Config:

```yaml
version: 1

rules:
  - id: auth
    code:
      - src/auth/**
    docs:
      - docs/authentication.md
    direction: code-to-docs
    mode: require-resolution
```

До запуска:

```text
workspace contains unrelated user changes
```

Agent получает задачу и изменяет:

```text
src/auth/session.ts
```

Плагин:

1. не считает unrelated user changes изменениями агента;
2. обнаруживает изменение `src/auth/session.ts`;
3. матчится на `auth`;
4. перед завершением turn вызывает continuation;
5. сообщает агенту про `docs/authentication.md`;
6. агент может:
   - изменить документ;
   - либо проверить и вызвать `doc_impact_resolve`;
7. после resolution turn завершается;
8. reminder не появляется бесконечно;
9. всё работает без изменения DSH core.

---

# 96. Recommended implementation order

### Stage 1 — pure core

Реализовать:

```text
config parser
selectors
impact graph
matcher
resolution state
fingerprints
```

Без DSH.

### Stage 2 — Git detector

Реализовать baseline/diff и тестовые repositories.

### Stage 3 — DSH lifecycle

Подключить:

```text
turn baseline
agent/turn-stopping
agent.steer
```

### Stage 4 — resolution tool

Добавить:

```text
doc_impact_resolve
```

### Stage 5 — commands/debugging

Добавить:

```text
/doc-impact check
/doc-impact changed
```

### Stage 6 — packaging

Собрать installable DSH bundle.

---

# 97. Final architectural decision

Для первой production-ready реализации использовать:

**Cordis/DSH plugin + per-turn Git/filesystem baseline + deterministic impact graph + `agent/turn-stopping` continuation.**

Не использовать:

- prompt-only;
- LLM matching;
- FS tool events как единственный source of truth;
- agent-loop patches.

DSH filesystem/tool events использовать только как optimization.

External Stop hook можно использовать для раннего prototype, если требуется сначала быстро проверить UX до разработки полноценного plugin.

Core engine желательно проектировать независимо от DSH, чтобы позднее теми же rules можно было пользоваться в CLI/CI/Git hooks.

---

# 98. Possible future rename

Если функциональность постепенно расширится с:

```text
code ↔ documentation
```

до:

```text
code
documentation
examples
schemas
contracts
migrations
changelog
tests
```

можно выделить generic core:

```text
dsh-change-impact
```

а `dsh-doc-impact` оставить user-facing preset/plugin поверх него.

Но **начинать стоит именно с `dsh-doc-impact`**: название понятно, scope ограничен и MVP не выглядит как попытка сразу построить универсальный dependency management framework.