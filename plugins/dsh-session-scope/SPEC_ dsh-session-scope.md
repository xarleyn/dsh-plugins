# SPEC: `dsh-session-scope`

## 1. Summary

`dsh-session-scope` — fork и дальнейшее развитие `dsh-workspace-scope-selection`.

Плагин позволяет оставить DSH session привязанной к исходному большому workspace, но независимо ограничить **рабочую область агента** одним или несколькими выбранными каталогами.

Пример:

```text
/workspace
├── project-a
├── project-b
├── project-c
└── infrastructure
```

Session остаётся:

```text
cwd = /workspace
workspace = /workspace
```

Но для неё можно установить:

```text
Scope:
- /workspace/project-a
- /workspace/project-c
```

После этого агент должен работать так, будто `project-b` и `infrastructure` не являются частью доступного ему workspace.

Основной архитектурный принцип:

```text
Permission != Scope
```

`Permission` определяет, **что агент может делать** с доступными файлами.

`Scope` определяет, **какая часть workspace вообще доступна агенту**.

Таким образом должны быть допустимы комбинации:

```text
read-only         + full workspace
read-only         + project-a
workspace-write   + project-a
workspace-write   + project-a + project-c
danger-full-access + project-a
```

Scope не должен реализовываться как новый `SandboxMode`.

---

# 2. Fork source

Upstream:

```text
jiangr100/dsh-workspace-scope-selection
```

Base version:

```text
v1.0.0
```

Base commit:

```text
8ddb30078e3a09f75445d4cf9a6cb0329fe10d54
```

License:

```text
MIT
```

Upstream уже реализует:

- directory tree picker;
- per-session selection;
- `workspace-scope/selection` event;
- replay state from session log;
- path canonicalization;
- selected-root containment;
- filesystem fencing;
- sandbox argv modification;
- Linux/macOS/Windows-specific handling;
- permission chip integration;
- host-side directory listing;
- client UI;
- `/workspace-scope` command;
- tests для pure core logic.

Текущий upstream представляет scope именно как дополнительный sandbox mode `selected-workspace-write`, ограничивающий writable roots.

В fork эта концепция должна быть заменена на независимый session scope.

---

# 3. Repository strategy

Не делать полный rewrite сразу после fork.

Первый commit нового репозитория должен быть практически чистым rename.

Рекомендуемый процесс:

```text
upstream/master
    ↓ fork
dsh-session-scope
    ↓
rename package / metadata
    ↓
tests green
    ↓
remove coupling Scope <-> SandboxMode
    ↓
implement read visibility
    ↓
implement UI changes
    ↓
migration support
    ↓
optional process isolation
```

Сохранить git history upstream.

Добавить remote:

```text
origin   -> наш fork
upstream -> jiangr100/dsh-workspace-scope-selection
```

Добавить:

```text
UPSTREAM.md
```

с содержанием:

```text
Forked from:
jiangr100/dsh-workspace-scope-selection

Base:
8ddb30078e3a09f75445d4cf9a6cb0329fe10d54

License:
MIT

Major divergence:
- scope separated from SandboxMode
- read visibility restriction
- scope inheritance
- isolated workspace mode
```

Сохранять copyright/license upstream.

---

# 4. Package naming

Основное название:

```text
dsh-session-scope
```

Почему именно session scope:

Scope принадлежит не workspace глобально, а конкретной session.

Два чата одного workspace могут иметь:

```text
Session A
/workspace/project-a

Session B
/workspace/project-b

Session C
/workspace/project-a
/workspace/project-c
```

без влияния друг на друга.

---

# 5. Goals

## 5.1 Primary goal

Позволить пользователю ограничивать filesystem workspace visibility агента без:

- создания отдельного DSH workspace;
- изменения session cwd;
- перемещения проекта;
- запуска отдельного DSH;
- изменения основной структуры workspace.

## 5.2 UX goal

Scope должен переключаться примерно так же легко, как Permission.

Пример composer:

```text
[ Workspace Write ▼ ] [ Scope: 2 projects ▼ ]
```

## 5.3 Persistence

Scope является durable per-session state.

После:

- restart DSH;
- reload browser;
- resume session;
- reconnect;

scope должен восстанавливаться из session log.

DSH использует append-only session events как durable source of truth, поэтому новый scope state должен следовать этому же паттерну.

## 5.4 Enforcement

Scope должен применяться как минимум к:

```text
read
write
edit
list
glob
grep
search
filesystem-backed tools
```

Попытка обратиться к другому проекту должна быть отклонена до выполнения операции.

---

# 6. Non-goals

Для первой версии не требуется:

- контейнер на каждую session;
- VM/microVM isolation;
- полноценная security sandbox всего host filesystem;
- скрытие `/usr`, `/etc`, runtime libraries и прочих OS paths;
- filesystem virtualization уровня Docker;
- автоматическое определение того, какие проекты нужны агенту;
- изменение `SessionHeader.cwd`;
- отдельный workspace внутри DSH;
- ACL management на host;
- generic security policy для произвольных MCP tools.

Scope в первую очередь ограничивает **видимость содержимого session workspace**.

---

# 7. Core architecture decision

## Старое поведение

Upstream объединяет:

```text
selected roots
+
write permission
```

через:

```text
SandboxMode = selected-workspace-write
```

## Новое поведение

Использовать две независимые policy axes:

```text
Sandbox Policy
├── read-only
├── workspace-write
└── danger-full-access

Session Scope
├── full
├── focused
└── isolated
```

Нельзя добавлять:

```text
selected-workspace-write
```

в основной `SandboxMode` новой архитектуры.

DSH sandbox официально определяет свои modes как filesystem-effect policy (`read-only`, `workspace-write`, `danger-full-access`), поэтому scope является отдельным понятием.

---

# 8. Scope modes

## 8.1 `full`

Обычное поведение DSH.

```text
Scope: Entire workspace
```

Scope layer фактически отключена.

## 8.2 `focused`

Основной cross-platform режим.

Агенту доступны только выбранные workspace roots через контролируемые DSH filesystem capabilities.

Гарантированно ограничиваются:

```text
read
write
edit
list
glob
grep
filesystem search
другие известные path-aware DSH tools
```

Модель также получает runtime context с текущим scope.

Shell/terminal при этом не является жёсткой security boundary.

UI должен явно обозначать это:

```text
Focused
DSH file tools are restricted.
Shell isolation is not guaranteed.
```

## 8.3 `isolated`

Более строгий режим.

Кроме tool-level enforcement, процессы должны видеть только выбранные части session workspace.

Первоначальная реализация:

```text
Linux + bubblewrap
```

Другие платформы могут быть добавлены позже.

Если strict isolation на текущем backend недоступна:

```text
isolated
→ fail closed
```

Не следует молча переключать пользователя в `focused`, если он явно выбрал `isolated`.

---

# 9. Permission interaction

Scope является более сильной границей, чем Permission.

Пример:

```text
Permission:
danger-full-access

Scope:
/workspace/project-a
```

не должен означать:

```text
можно читать project-b
```

`danger-full-access` снимает sandbox filesystem-effect restrictions, но не должен автоматически отключать session scope.

Чтобы агент получил другой проект, пользователь должен явно:

```text
Edit Scope
```

или:

```text
Scope → Entire workspace
```

## Scope denial

Scope denial не должен проходить через обычную sandbox escalation.

То есть:

```text
Agent tries:
/workspace/project-b/file.ts

→ SESSION_SCOPE_DENIED
```

а не:

```text
Agent asks permission to access project-b
```

Scope меняется пользователем, а не approval request от агента.

---

# 10. Durable state

Ввести новый session event:

```text
session-scope/set
```

Payload:

```ts
interface SessionScopeEvent {
  version: 1

  mode:
    | "full"
    | "focused"
    | "isolated"

  roots: string[]

  workspaceRoot: string

  source?:
    | "ui"
    | "command"
    | "migration"
    | "delegation"
}
```

Пример:

```json
{
  "version": 1,
  "mode": "focused",
  "workspaceRoot": "/workspace",
  "roots": [
    "/workspace/project-a",
    "/workspace/project-c"
  ],
  "source": "ui"
}
```

State fold:

```text
last session-scope/set wins
```

Как и в upstream `workspace-scope/selection`, event содержит полный snapshot, а не delta.

Никакого отдельного JSON state storage создавать не нужно.

---

# 11. Effective scope

Добавить pure helper:

```ts
effectiveSessionScope(events, sessionHeader)
```

Результат:

```ts
interface EffectiveSessionScope {
  mode: "full" | "focused" | "isolated"

  workspaceRoot: string

  roots: string[]

  navigationRoots: string[]
}
```

При отсутствии `session-scope/set`:

```text
mode = full
roots = []
```

---

# 12. Root normalization

Переиспользовать максимально возможную часть:

```text
lib/core.js
```

upstream.

Уже существующие helpers для:

- `realpath`;
- normalization;
- deduplication;
- lexical containment;
- root limits;

сохраняются и расширяются.

Текущий upstream уже использует максимум 128 selected roots; этот лимит можно оставить.

## Rules

Selected root должен:

1. быть absolute path после host resolution;
2. существовать в момент выбора;
3. canonicalize через filesystem semantics;
4. находиться внутри canonical workspace root;
5. не escape'ить workspace через symlink;
6. не дублироваться.

По умолчанию:

```yaml
allowExternalRoots: false
```

Если выбран:

```text
/workspace/foo-link -> /mnt/private/foo
```

то при `allowExternalRoots: false` selection должна быть отвергнута.

---

# 13. Root collapsing

Если выбраны:

```text
/workspace/project-a
/workspace/project-a/packages/foo
```

в event хранить только:

```text
/workspace/project-a
```

Потомок уже полностью покрыт parent root.

Helper:

```ts
collapseNestedRoots(roots)
```

---

# 14. Navigation visibility

Это важное отличие от простой проверки:

```text
target is under selectedRoot
```

Предположим выбран:

```text
/workspace/apps/project-a
```

Чтобы агент мог навигироваться к нему, он должен иметь возможность увидеть:

```text
/workspace
└── apps
    └── project-a
```

Но не содержимое остальных каталогов.

Поэтому вводятся:

```text
content roots
navigation ancestors
```

Для:

```text
/workspace/apps/project-a
```

content root:

```text
/workspace/apps/project-a
```

navigation ancestors:

```text
/workspace
/workspace/apps
```

## Directory listing

Если агент делает:

```text
list /workspace
```

и selected roots:

```text
/workspace/project-a
/workspace/project-c
```

результат:

```text
project-a
project-c
```

а не:

```text
project-a
project-b
project-c
infrastructure
```

Если выбран nested path:

```text
/workspace/apps/project-a
```

то:

```text
list /workspace
→ apps
```

а:

```text
list /workspace/apps
→ project-a
```

Таким образом hidden project names не попадают в model context.

---

# 15. Read rules

Для файла:

```text
read(path)
```

разрешение:

```text
ALLOW if path ∈ selected content roots
DENY otherwise
```

Navigation ancestors разрешены только для directory traversal/listing.

Например:

```text
selected:
/workspace/apps/project-a
```

Тогда:

```text
list /workspace/apps
ALLOW + filtered

read /workspace/apps/config.json
DENY

read /workspace/apps/project-a/package.json
ALLOW
```

---

# 16. Write rules

Write всегда требует выполнения одновременно двух независимых policy:

```text
Session Scope
AND
DSH Permission
```

Например:

```text
Scope:
project-a

Permission:
workspace-write
```

Получаем:

```text
project-a/read       ALLOW
project-a/write      ALLOW

project-b/read       DENY by scope
project-b/write      DENY by scope
```

Для:

```text
Permission:
read-only
```

получаем:

```text
project-a/read       ALLOW
project-a/write      DENY by sandbox

project-b/read       DENY by scope
project-b/write      DENY by scope
```

---

# 17. Filesystem enforcement

Scope не должен существовать только в system prompt.

Нужен capability-level enforcement.

Предпочтительная архитектура:

```text
ctx.fs
  ↓
session scope gate
  ↓
existing sandbox/fs policy
  ↓
provider
```

DSH официально предоставляет filesystem capability seam через `ctx.fs` и `fs/*` events.

Необходимо покрыть как минимум:

```text
read
write
edit
stat
directory listing
glob
grep/search
```

Если upstream fork уже оборачивает fs для writable root validation, этот механизм нужно обобщить с:

```text
isWritableRoot()
```

до:

```text
canObservePath()
canListPath()
canMutatePath()
```

---

# 18. Tool-level guard

Добавить второй enforcement layer для известных model-facing tools.

Для invariant-denial предпочтительно использовать final tool guard, а не только обычный waterfall.

DSH extension cookbook отдельно рекомендует `ctx.tools.guard()` для monotonic final denial и `tools/pre-execute` для обычных permission gates.

Scope является invariant, поэтому:

```text
outside selected scope
```

не должен быть разрешён другим downstream plugin.

Pseudo-flow:

```text
tool call
  ↓
session scope guard
  ↓
permission / approval
  ↓
tool implementation
```

Возвращать structured error:

```text
SESSION_SCOPE_DENIED
```

с сообщением:

```text
Path is outside the active session scope.
Change the session scope if access is required.
```

Не перечислять hidden roots в error.

---

# 19. Unknown tools

Невозможно автоматически гарантировать path isolation для произвольного MCP tool:

```text
some_custom_tool({
  repository: "/workspace/project-b"
})
```

если plugin не знает semantics аргументов.

Поэтому scope guarantees относятся к:

- DSH filesystem seam;
- встроенным path-aware filesystem tools;
- shell isolation в isolated mode.

Добавить extension registry:

```ts
ctx.sessionScope.registerToolAdapter(...)
```

или локальный adapter registry внутри плагина.

Пример API:

```ts
registerToolAdapter({
  name: "some_tool",

  extractPaths(args) {
    return [args.path]
  }
})
```

Не обязательно делать public API в первой версии, но архитектура не должна этому мешать.

---

# 20. Model-facing context

Агент должен знать текущий scope.

Добавить runtime/system section.

Пример:

```text
### Session workspace scope

The current session is restricted to selected areas of its workspace.

Accessible roots:
- /workspace/project-a
- /workspace/project-c

Treat all other paths under the session workspace as unavailable.
Do not search, inspect, read, modify, or execute against paths outside these roots.
If access to another workspace area is required, report that limitation to the user.
```

Важно:

не писать:

```text
Hidden:
- project-b
- infrastructure
```

иначе сама policy раскрывает агенту названия скрытых проектов.

---

# 21. UI

Удалить концепцию:

```text
Selected Workspace Write
```

из Permission picker.

Вместо неё добавить отдельный control.

Composer:

```text
[ Workspace Write ▼ ] [ Scope: All ▼ ]
```

или:

```text
[ Workspace Write ▼ ] [ Scope: project-a ▼ ]
```

или:

```text
[ Workspace Write ▼ ] [ Scope: 3 roots ▼ ]
```

Scope chip должен визуально отличаться от permission chip.

---

# 22. Scope picker

При клике:

```text
Scope ▼
```

открывается существующий upstream directory-tree editor.

Переделывать его с нуля не нужно.

Новый UI:

```text
Session Scope

Mode

○ Entire workspace
● Focused
○ Isolated

Accessible workspace areas

workspace/
  ☑ project-a/
  ☐ project-b/
  ☑ project-c/
  ☐ infrastructure/

Focused limits DSH filesystem tools.
Isolated also confines supported shell processes.

[Cancel]                       [Apply]
```

---

# 23. Selection semantics

Checkbox означает:

```text
этот каталог и всё его содержимое входят в scope
```

Если parent checked:

```text
☑ project-a
   ✓ src        via parent
   ✓ docs       via parent
```

как уже делает upstream.

Если пользователь check'ает workspace root:

```text
☑ workspace
```

это эквивалентно:

```text
Scope = full
```

При Apply рекомендуется автоматически сохранить:

```text
mode: full
roots: []
```

---

# 24. Lazy tree loading

Сохранить host-side lazy directory listing upstream.

Не загружать всё дерево workspace заранее.

Существующий upstream имеет ограничение в 500 entries на один listing level; его можно сохранить.

UI listing выполняется от имени пользователя/host UI и поэтому может видеть полный workspace.

Это не нарушение session scope: scope ограничивает агента, а не пользователя.

---

# 25. Commands

Новый command:

```text
/scope
```

Открывает picker.

Дополнительно:

```text
/scope full
```

```text
/scope focused
```

```text
/scope isolated
```

```text
/scope show
```

Можно сохранить alias:

```text
/workspace-scope
```

для backward compatibility.

---

# 26. Host API

Переиспользовать transport/remote infrastructure существующего client plugin.

Логически host должен предоставлять операции:

```text
getScope(session)
setScope(session, payload)
listDirectory(session, path)
getCapabilities()
```

Wire names могут сохранить стиль upstream, чтобы уменьшить diff.

`getCapabilities()` нужен UI для отображения:

```text
focused: supported
isolated: supported / unsupported
isolatedBackend: bwrap / null
```

---

# 27. Session resume

При resume:

```text
effectiveSessionScope(session.events)
```

должен восстановить state без дополнительного external store.

Нельзя поддерживать mutable:

```text
Map<sessionId, scope>
```

как authoritative source.

In-memory cache разрешён только как derived optimization.

---

# 28. Session fork

Если пользователь fork'ает conversation, child session должна наследовать scope.

DSH хранит `parentSession` lineage в immutable `SessionHeader`, а fork использует session seed.

Ожидаемое поведение:

```text
Parent:
Scope project-a

Fork child:
Scope project-a
```

Fork не должен внезапно получать Full Workspace.

---

# 29. Subagent inheritance

Это security-critical requirement.

Subagent не должен позволять обойти parent scope.

DSH subagents получают новый flat agent scope и не наследуют автоматически scoped registrations; DSH отдельно реализует delegation policy inheritance для sandbox/approval.

`dsh-session-scope` должен реализовать аналогичную семантику.

При создании child:

```text
parent effective scope
        ↓
child session
        ↓
session-scope/set
source = delegation
```

## Required behavior

Parent:

```text
Scope:
project-a
```

делает:

```text
subagent(...)
```

Child:

```text
Scope:
project-a
```

не:

```text
Scope:
full
```

---

# 30. Subagent initialization strategy

Предпочтительно seed'ить delegated scope непосредственно при child creation.

Если extension point текущей DSH версии не позволяет безопасно внедриться в provider creation, использовать fail-closed `agent/pre-step` listener.

Перед первым model request:

```text
if session.origin == subagent
and no explicit session-scope/set:
    resolve parentSession
    inherit parent effective scope
    append session-scope/set source=delegation
    continue

if parent cannot be resolved:
    reject first step
```

DSH `agent/pre-step` является официальным interception point до model execution.

Это предотвращает ситуацию, когда child успевает выполнить один unrestricted request до inheritance.

---

# 31. Scope mutation during active turn

Изменение scope применяется к следующим tool executions сразу после append event.

Пример:

```text
Agent is running
User narrows:
project-a + project-b
→ project-a
```

Следующий tool call в `project-b` должен получить:

```text
SESSION_SCOPE_DENIED
```

Не требуется restart session.

---

# 32. Focused shell behavior

Focused mode не обещает hermetic shell isolation.

System prompt ограничивает shell usage, но пользователь должен понимать отличие.

Можно добавить config:

```yaml
focusedShellPolicy: warn
```

Варианты:

```text
allow
warn
deny
```

Default:

```text
warn
```

### `allow`

Ничего дополнительно не блокировать.

### `warn`

Shell доступен, UI показывает, что process isolation отсутствует.

### `deny`

При active selected scope блокировать shell/terminal целиком.

Это полезно пользователям, которым важнее гарантия isolation, чем shell.

---

# 33. Isolated mode

`isolated` должен ограничивать workspace visibility также для shell/terminal.

Первая поддерживаемая платформа:

```text
Linux + bubblewrap
```

DSH уже использует Linux bwrap/Landlock через sandbox backend, а upstream fork уже содержит runner-specific argv augmentation.

Нужно расширить текущую fork implementation с:

```text
selected writable roots
```

до:

```text
selected visible workspace roots
```

---

# 34. Linux isolation design

Для session workspace:

```text
/workspace
```

и roots:

```text
/workspace/project-a
/workspace/project-c
```

process namespace должен логически видеть:

```text
/workspace
├── project-a
└── project-c
```

а не реальные sibling directories.

Один из вариантов bwrap implementation:

1. скрыть исходный workspace mount;
2. создать пустой workspace mount point;
3. создать необходимые navigation ancestor directories;
4. bind selected roots обратно в их оригинальные locations.

Conceptually:

```text
--tmpfs /workspace

--dir /workspace/project-a
--dir /workspace/project-c

--ro-bind /real/workspace/project-a /workspace/project-a
--ro-bind /real/workspace/project-c /workspace/project-c
```

Конкретный argv должен строиться с учётом существующего DSH bwrap wrapper, а не отдельным параллельным subprocess implementation.

---

# 35. Isolated + permission modes

Для:

```text
read-only
```

selected roots должны быть:

```text
ro-bind
```

Для:

```text
workspace-write
```

selected roots:

```text
bind
```

но всё равно только selected roots.

`danger-full-access` требует отдельного внимания, потому что DSH normal sandbox может bypass confinement в этом режиме.

Поэтому для первой strict реализации допустимо:

```text
isolated + danger-full-access
→ unsupported
```

UI должен явно сообщить конфликт.

Не делать silent weakening.

Future version может реализовать scope process isolation как отдельный layer, независимый от DSH sandbox mode.

---

# 36. Windows/macOS

## Focused

Должен работать на:

```text
Linux
macOS
Windows
```

поскольку filesystem/tool-level enforcement реализуется внутри DSH plugin.

## Isolated

v1:

```text
Linux only
```

macOS/Windows:

```text
Isolated mode unavailable on this platform.
Use Focused mode or disable unrestricted shell access.
```

Не повторять ошибку, когда UI показывает strict mode, но backend фактически enforcement не обеспечивает.

---

# 37. Symlink security

Особое внимание:

```text
/workspace/project-a/link
→ /workspace/project-b
```

Если agent выполняет:

```text
read project-a/link/secrets.txt
```

scope layer не должен разрешить escape только потому, что lexical input начинается с:

```text
project-a/
```

Проверка должна выполняться после canonical filesystem resolution.

Для несуществующих write paths:

```text
/workspace/project-a/new/file.ts
```

canonicalize nearest existing ancestor, затем безопасно append remaining lexical components.

Нужны отдельные tests.

---

# 38. Hidden-path leakage

Scope должен по возможности предотвращать раскрытие hidden workspace structure.

Не возвращать hidden names через:

```text
list
glob
grep
search
autocomplete
tool errors
system prompt
```

Например:

```text
Scope:
/workspace/project-a
```

агент не должен получать сообщение:

```text
Denied. Available sibling projects are:
project-b, project-c, infrastructure
```

Достаточно:

```text
Path is outside the active session scope.
```

---

# 39. Legacy migration

Upstream sessions могут содержать:

```text
sandbox/mode:
selected-workspace-write
```

и:

```text
workspace-scope/selection
```

Нельзя просто перестать понимать их.

## Compatibility fold

Если:

```text
session-scope/set
```

отсутствует, но найден:

```text
workspace-scope/selection
```

plugin может derived-state интерпретировать legacy selection.

Правило:

```text
legacy selected roots
→ focused scope roots
```

Если legacy sandbox mode:

```text
selected-workspace-write
```

то runtime compatibility layer должен трактовать его как:

```text
permission = workspace-write
scope = focused legacy roots
```

без обязательной немедленной переписи старого session log.

---

# 40. Migration write

При первой явной пользовательской смене scope legacy session получает новый:

```text
session-scope/set
source=migration
```

После этого new event authoritative.

Не требуется rewrite старого JSONL.

---

# 41. Configuration

Пример:

```yaml
sessionScope:
  defaultMode: full

  maxRoots: 128

  allowExternalRoots: false

  focusedShellPolicy: warn

  inheritToSubagents: true

  inheritToForks: true

  isolated:
    enabled: true
    requireFullEnforcement: true

  migration:
    legacyWorkspaceScope: true
```

---

# 42. Recommended defaults

```yaml
defaultMode: full
allowExternalRoots: false
focusedShellPolicy: warn
inheritToSubagents: true
inheritToForks: true
requireFullEnforcement: true
```

Plugin installation не должна неожиданно сузить уже существующие ordinary sessions.

---

# 43. Client code strategy

Upstream имеет:

```text
lib/client.js
```

как hand-written module-loader bundle без build step.

Для первого fork release не переписывать client tooling одновременно с scope architecture.

Сначала сохранить существующий packaging/build model.

После functional parity можно отдельным change сделать TypeScript/source build, если это вписывается в общий plugin monorepo.

Не смешивать:

```text
architectural rewrite
+
build-system migration
+
UI redesign
```

в один этап.

---

# 44. Proposed repository layout

Начальный layout желательно оставить близким к upstream:

```text
dsh-session-scope/
├── lib/
│   ├── index.js
│   ├── core.js
│   └── client.js
│
├── test/
│   ├── core.test.mjs
│   ├── migration.test.mjs
│   ├── scope-fs.test.mjs
│   ├── inheritance.test.mjs
│   └── sandbox-linux.test.mjs
│
├── scripts/
│
├── cordis.patch.yml
├── package.json
├── README.md
├── UPSTREAM.md
└── LICENSE
```

Позже возможно:

```text
src/
├── host/
├── client/
├── policy/
└── sandbox/
```

но это не blocker для первого release.

---

# 45. Core modules after refactor

Логически разделить код на:

```text
scope-state
scope-paths
scope-visibility
scope-fs
scope-tools
scope-delegation
scope-sandbox
scope-api
scope-ui
migration
```

Даже если физически первые версии остаются в нескольких JS files.

---

# 46. Error vocabulary

Ввести стабильные error codes:

```text
SESSION_SCOPE_DENIED
SESSION_SCOPE_INVALID_ROOT
SESSION_SCOPE_OUTSIDE_WORKSPACE
SESSION_SCOPE_SYMLINK_ESCAPE
SESSION_SCOPE_ISOLATION_UNAVAILABLE
SESSION_SCOPE_PARENT_UNAVAILABLE
SESSION_SCOPE_STALE_WORKSPACE
```

Agent-facing messages должны быть короткими.

Detailed diagnostics писать в logs.

---

# 47. Logging

При debug logging:

```text
session-scope: scope changed
session-scope: denied fs read
session-scope: denied write
session-scope: inherited scope to child
session-scope: isolation backend selected
```

Не логировать contents файлов.

Полезный debug payload:

```json
{
  "sessionId": "...",
  "operation": "read",
  "target": "/workspace/project-b/foo.ts",
  "result": "denied",
  "reason": "outside-scope"
}
```

---

# 48. Tests: core path logic

Обязательные unit tests:

```text
single root
multiple roots
duplicate roots
nested roots
parent collapse
workspace root
root outside workspace
symlink outside workspace
case sensitivity Windows
missing root
maximum roots
navigation ancestors
filtered directory listing
```

---

# 49. Tests: permission matrix

Минимальная matrix:

```text
                     full     focused

read-only/read       allow    selected only
read-only/write      deny     deny

workspace/read       allow    selected only
workspace/write      allow    selected only

danger/read          allow    selected only
danger/write         allow    selected only
```

Для focused filesystem tools scope всегда должен побеждать permission widening.

---

# 50. Tests: tool behavior

Workspace:

```text
/workspace
├── a/
│   └── visible.txt
├── b/
│   └── hidden.txt
└── c/
```

Scope:

```text
/workspace/a
```

Проверить:

```text
read a/visible.txt
→ success

read b/hidden.txt
→ SESSION_SCOPE_DENIED

list /workspace
→ ["a"]

glob /workspace/**
→ only a subtree

grep hidden
→ must not search b

write a/new.txt
→ according to sandbox permission

write b/new.txt
→ SESSION_SCOPE_DENIED
```

---

# 51. Tests: concurrent sessions

Один DSH process:

```text
Session A → scope /workspace/a
Session B → scope /workspace/b
```

Одновременные calls не должны влиять друг на друга.

Нельзя использовать global mutable selected-roots state.

---

# 52. Tests: persistence

Flow:

```text
create session
set focused /workspace/a
flush
destroy DSH context
reload persistence
resume session
```

Ожидание:

```text
effective scope == /workspace/a
```

---

# 53. Tests: fork

```text
Parent scope = a
fork session
```

Child:

```text
effective scope = a
```

---

# 54. Tests: subagents

Parent:

```text
scope = a
```

Subagent пытается:

```text
read b/hidden.txt
```

Ожидание:

```text
SESSION_SCOPE_DENIED
```

Проверить:

```text
spawn
fork
continuable child
resume child
nested child
```

DSH explicitly does not treat normal agent scoped registrations as automatically inherited by subagents, поэтому этот test suite обязателен.

---

# 55. Tests: scope changes during execution

1. Session starts with:

```text
a + b
```

2. Scope меняется на:

```text
a
```

3. Следующий tool call пытается read `b`.

Expected:

```text
deny
```

---

# 56. Tests: isolated Linux

При наличии bwrap:

Scope:

```text
/workspace/a
```

Inside shell:

```bash
ls /workspace
```

Expected:

```text
a
```

```bash
cat /workspace/b/hidden.txt
```

Expected:

```text
No such file / denied
```

```bash
cat /workspace/a/visible.txt
```

Expected:

```text
success
```

---

# 57. Compatibility with upstream DSH

Plugin должен использовать documented extension points и capability seams, где это возможно.

Не patch'ить:

```text
agent loop source
session core
built frontend bundles
DSH installation files
```

DSH architecture явно предусматривает:

- durable session events;
- `ctx.fs`;
- `ctx.sandbox`;
- `tools/*`;
- `agent/*`;
- UI/client integration;

как extension points для подобных функций.

Если приходится monkey-patch service implementation из upstream fork, каждый такой patch должен быть изолирован и задокументирован как compatibility shim.

---

# 58. Upstream compatibility strategy

Так как это fork, периодически проверять:

```text
git fetch upstream
git log HEAD..upstream/master
```

Из upstream желательно cherry-pick'ать:

```text
UI fixes
DSH compatibility fixes
path security fixes
sandbox backend fixes
client API fixes
```

Не cherry-pick'ать автоматически изменения, возвращающие coupling:

```text
scope == selected-workspace-write
```

`UPSTREAM.md` должен содержать список intentionally diverged concepts.

---

# 59. Release stages

## Phase 0 — Fork bootstrap

- fork repository;
- rename package;
- rename README;
- add `UPSTREAM.md`;
- preserve license;
- tests green;
- no behavior changes.

Version:

```text
0.1.0-dev
```

## Phase 1 — Decouple Permission and Scope

- remove `selected-workspace-write` from new user-facing permission model;
- introduce `session-scope/set`;
- add `full` / `focused`;
- separate Scope chip;
- migrate existing tree editor;
- retain legacy compatibility.

Version:

```text
0.2.0
```

## Phase 2 — Read visibility

- fs observation filtering;
- read denial;
- list filtering;
- glob/grep filtering;
- tool invariant guard;
- navigation ancestors;
- hidden-path leak tests.

Version:

```text
0.3.0
```

Это первый релиз, реально решающий основной use case.

## Phase 3 — Delegation

- session fork inheritance;
- subagent inheritance;
- fail-closed child initialization;
- nested delegation tests.

Version:

```text
0.4.0
```

## Phase 4 — Linux Isolated

- bwrap workspace visibility;
- strict shell/terminal confinement;
- capability detection;
- unsupported-platform UX.

Version:

```text
0.5.0
```

## Phase 5 — Stable

После production usage:

```text
1.0.0
```

---

# 60. MVP definition

Для MVP не ждать `isolated`.

MVP считается готовым, если:

1. session остаётся в исходном workspace;
2. пользователь может выбрать несколько каталогов;
3. scope сохраняется per-session;
4. UI показывает активный scope;
5. `read/write/edit/list/glob/grep` не видят остальные workspace directories;
6. directory listing скрывает sibling projects;
7. scope не зависит от Permission mode;
8. scope переживает restart/resume;
9. две sessions могут иметь разные scopes;
10. scope inherited by child agents либо child execution fail-closed;
11. agent prompt содержит только разрешённые roots;
12. legacy upstream sessions не ломаются.

---

# 61. Acceptance scenario

Исходный workspace:

```text
/workspace
├── backend/
├── frontend/
├── mobile/
└── infrastructure/
```

Пользователь открывает существующий chat внутри:

```text
/workspace
```

и выбирает:

```text
Scope → Focused

☑ backend
☑ frontend
☐ mobile
☐ infrastructure
```

Session всё ещё отображается как принадлежащая:

```text
/workspace
```

Agent получает:

```text
Accessible workspace roots:
- /workspace/backend
- /workspace/frontend
```

Agent:

```text
list /workspace
```

получает:

```text
backend
frontend
```

Agent:

```text
grep "API_URL" /workspace
```

ищет только:

```text
backend
frontend
```

Agent:

```text
read /workspace/mobile/package.json
```

получает:

```text
SESSION_SCOPE_DENIED
```

Agent запускает subagent.

Subagent также не может читать:

```text
mobile
infrastructure
```

Пользователь открывает Scope picker и добавляет:

```text
mobile
```

Следующие agent tool calls получают доступ к:

```text
backend
frontend
mobile
```

При этом chat не переносится, cwd не изменяется, новый workspace не создаётся.

---

# 62. Important implementation principle

Главное отличие нового fork от upstream можно сформулировать одной строкой:

```text
Upstream:
"Which directories may the agent write to?"

dsh-session-scope:
"Which directories belong to this agent session's active workspace view?"
```

Permission после этого применяется уже **внутри** этого view.

Именно эту модель следует использовать во всём коде, UI, naming и tests.