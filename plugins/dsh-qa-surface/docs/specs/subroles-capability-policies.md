# dsh-qa-surface — Subroles & Capability Policies

## Goal

Пересмотреть текущую ролевую систему `dsh-qa-surface` и добавить отдельный уровень **Subrole / Agent Capability Profile**.

Примеры сабролей:

| Subrole | Назначение |
|---|---|
| Analyst | Аналитика, поиск, работа с данными |
| Sales | Работа с клиентами, CRM, коммерческие материалы |
| Pre-Sales | Technical discovery, подготовка решений и предложений |
| Developer | Код, Git, shell, документация, developer tools |
| Support | Диагностика и работа с пользовательскими обращениями |
| Manager | Сводки, отчёты, read-only бизнес-инструменты |

Каждая саброль определяет, какие capabilities агенту разрешено видеть и использовать.

В первой версии обязательными типами capabilities являются:

| Capability | Required |
|---|---:|
| Tools | yes |
| Skills | yes |
| MCP tools / integrations | архитектурно предусмотреть |
| Knowledge sources | архитектурно предусмотреть |
| Prompt additions | архитектурно предусмотреть |

Главный принцип:

```text
effectiveCapabilities =
    systemRequired
  + commonCapabilities
  + subroleCapabilities
```

При этом capabilities вне effective set должны быть не просто скрыты в UI, а отсутствовать из agent-visible surface и, где возможно, блокироваться при непосредственном вызове.

---

## Role model

Не стоит смешивать административную роль пользователя и роль агента.

Предлагаемая модель:

```text
User
 ├─ authorizationRole
 │   ├─ admin
 │   └─ user
 │
 └─ allowedSubroles
     ├─ analyst
     ├─ pre-sales
     └─ developer
```

`authorizationRole` отвечает за доступ пользователя к административным функциям.

`subrole` отвечает исключительно за поведение и capabilities QA-agent.

У QA session должна быть ровно одна активная саброль.

Если пользователю разрешено несколько сабролей, он может выбирать между ними, но capabilities нескольких сабролей автоматически объединять не следует. Это уменьшает вероятность случайного расширения полномочий.

Пример:

```ts
interface QaUserAccess {
  allowedSubroles: string[]
  defaultSubrole?: string
}
```

Session хранит выбранную саброль:

```ts
interface QaSessionContext {
  subroleId: string
}
```

После начала meaningful conversation смена саброли должна либо быть запрещена, либо создавать новую QA session. Это предотвращает hybrid capability state.

---

## Capability policy

### System Required

Внутренний неизменяемый слой.

Это capabilities, без которых сам QA runtime нормально не работает.

Они не должны отображаться обычному администратору как отключаемые checkboxes.

Например:

```ts
systemRequiredTools = [...]
systemRequiredSkills = [...]
```

Этот набор желательно держать минимальным.

---

## Common capabilities

Добавить отдельное понятие:

```text
Common Tools
Common Skills
```

Capabilities из этого слоя доступны **всем сабролям**.

Например, если `web_search` должен быть у Analyst, Sales, Pre-Sales и Developer, его не нужно вручную включать четыре раза.

Администратор один раз помещает его в `Common Tools`.

В UI такой capability внутри конкретной саброли отображается примерно как:

```text
☑ web_search        Common
```

Checkbox disabled, поскольку capability наследуется.

Effective set:

```ts
effectiveTools =
  union(
    systemRequired.tools,
    common.tools,
    subrole.tools,
  )
```

Аналогично для skills.

---

## Default-deny

Для role-specific capabilities использовать allowlist, а не denylist.

То есть:

```text
не "Developer запрещён Salesforce"
а "Developer разрешены bash, git, fs, web_search..."
```

Причина особенно важна для DSH: новый установленный plugin может автоматически зарегистрировать новый tool.

При allowlist новый tool не должен внезапно появиться у всех QA users.

DSH уже предоставляет подходящий механизм для tools — `ctx.tools.restrict({ allow })`. Restriction используется общим visibility resolver для schemas, lookup и dispatch: restricted-away inherited tool исчезает из prompt и не выполняется как обычный tool.

---

## Tool enforcement

Политику нужно применять **на scope конкретного созданного Agent**, а не глобально и не только на preset.

Примерная схема:

```ts
agent/created
    ↓
resolve user
    ↓
resolve active subrole
    ↓
build EffectiveCapabilityPolicy
    ↓
agent.ctx.tools.restrict({
  allow: effectiveTools,
})
```

Именно такой agent-scoped wiring сейчас является нормальным plugin-side способом применения preset/tool allowlist в DSH.

Важно учитывать особенность DSH: scope-local tools добавляются после inherited restriction и поэтому могут обходить один `restrict()`. Это прямо является частью семантики tool registry.

Поэтому для `qa-surface` желательно иметь два слоя защиты:

```text
1. ctx.tools.restrict()
   → visibility + основной execution filter

2. tools/pre-execute policy gate
   → defense in depth
```

Gate проверяет:

```ts
if (!effectivePolicy.tools.has(exec.name)) {
  return deny('Tool is unavailable for the active QA subrole')
}
```

Таким образом случайно зарегистрированный agent-local tool также нельзя будет использовать.

DSH сам предусматривает `tools/pre-execute` как extensible allow/deny gate.

### PTC / run_code

Нужно отдельно покрыть тестами Code/PTC mode.

`run_code` является reserved transport и не удаляется `ctx.tools.restrict()`.

Если `qa-surface` использует native tool calling, проблема практически исчезает.

Если когда-либо будет разрешён PTC/Code Mode, capability policy должна проверять subcalls, а не считать скрытие `run_code` механизмом безопасности.

Для QA surface я бы пока явно оставил:

```text
tool presentation: native
```

если Code Mode не является реальной бизнес-потребностью.

---

## Skill enforcement

У skills сейчас нет аналога:

```ts
ctx.skills.restrict(...)
```

Registry умеет scope-aware merging через `snapshot/list/get`, однако global и scope providers объединяются.

Поэтому одного фильтра в админском UI недостаточно.

Нужно реализовать `qa-surface` skill policy consumer.

### Proposed solution

Для QA Agent зарегистрировать scoped model-facing `skill` tool, который shadow-ит стандартный `skill`.

Он должен:

```text
ctx.skills.snapshot(...)
        ↓
filter effectiveSkills
        ↓
publish filtered catalog
```

И при загрузке:

```text
skill("jira-analysis")
        ↓
effectiveSkills.has("jira-analysis") ?
        ↓ yes
ctx.skills.get(...)
        ↓
renderSkillContent(...)
```

При попытке загрузить skill вне allowlist:

```text
SKILL_NOT_AVAILABLE
```

Это важно, поскольку `ctx.skills.get()` сам по себе policy-neutral и возвращает skill независимо от `modelInvocable/userInvocable`; именно consumer обязан enforce-ить policy.

Штатный `dsh-tool-skill` уже проверяет, является ли зарегистрированный им `skill` tool фактически видимым для agent. Если scoped implementation shadow-ит его, штатный consumer не должен публиковать второй catalog.

То есть архитектурно можно сделать:

```text
ctx.skills
   │
   ├── filesystem provider
   ├── plugin providers
   └── runtime skills
            │
            ▼
   qa capability skill consumer
            │
       allowlist filter
            │
            ├── available_skills
            └── skill tool
```

Не нужно создавать второй независимый skill registry.

---

## Capability discovery

Админка не должна заставлять человека вручную вводить названия tools или skills.

Нужен read-only capability catalog service.

Например:

```ts
interface CapabilityDescriptor {
  type: 'tool' | 'skill'
  id: string
  title: string
  description?: string

  source: {
    kind: 'core' | 'plugin' | 'mcp' | 'filesystem' | 'runtime'
    name?: string
  }

  status: 'available' | 'missing'
}
```

Для tools источником истины должен быть текущий `ctx.tools`.

Для skills — `ctx.skills.snapshot/list`.

DSH tools registry уже предоставляет scoped schemas, а skill registry предоставляет summaries с `source` и `provider`.

UI поэтому может автоматически показывать:

```text
Tools

Core
  ☑ web_search
  ☐ bash
  ☑ ask_user_question

MCP · Jira
  ☑ jira_search
  ☑ jira_issue_get
  ☐ jira_issue_update

Plugin · dsh-something
  ☐ some_tool
```

---

## Missing capabilities

Конфигурация саброли не должна ломаться, если plugin временно удалён.

Например:

```json
{
  "tools": [
    "web_search",
    "jira_search"
  ]
}
```

Если `jira_search` больше не зарегистрирован:

```text
⚠ jira_search
  Tool is configured for this role but currently unavailable.
```

Не удалять его автоматически из config.

Это позволяет reinstall/update plugin без необходимости заново настраивать роли.

---

## Data model

Базовая модель:

```ts
interface QaCapabilityConfig {
  version: 1

  common: CapabilitySelection

  subroles: QaSubrole[]
}

interface CapabilitySelection {
  tools: string[]
  skills: string[]
}

interface QaSubrole {
  id: string
  name: string
  description?: string

  enabled: boolean

  capabilities: CapabilitySelection

  ui?: {
    icon?: string
    accent?: string
  }
}
```

Пример:

```yaml
roles:
  version: 1

  common:
    tools:
      - web_search
      - session_event_search

    skills:
      - company-basics

  subroles:
    - id: analyst
      name: Analyst
      description: Research and analytics
      enabled: true

      capabilities:
        tools:
          - analytics_query
          - jira_search

        skills:
          - business-analysis
          - data-analysis

    - id: sales
      name: Sales
      enabled: true

      capabilities:
        tools:
          - crm_search
          - customer_lookup

        skills:
          - sales
          - proposal-writing

    - id: pre-sales
      name: Pre-Sales
      enabled: true

      capabilities:
        tools:
          - crm_search
          - jira_search
          - architecture_lookup

        skills:
          - solution-design
          - proposal-writing

    - id: developer
      name: Developer
      enabled: true

      capabilities:
        tools:
          - bash
          - lsp
          - git
          - web_search

        skills:
          - search-dev
          - code-review
```

---

## Persistence

Capability configuration стоит хранить в собственной namespace `qa-surface`.

Например:

```text
qa-surface.roles
qa-surface.access
```

При небольшом количестве пользователей/subroles settings storage достаточно.

Если `qa-surface` уже имеет собственное persistent storage для пользователей и RBAC, assignments лучше оставить там, а capability definitions можно держать отдельно.

Главное — не размазывать одну конфигурацию по:

```text
settings.yaml
+
agent presets
+
browser localStorage
+
hardcoded frontend constants
```

Backend должен оставаться единственным source of truth.

---

# Admin UI

Добавить полноценный административный раздел внутрь QA surface.

Предлагаемый route:

```text
/qa/admin
```

или:

```text
/qa/admin/roles
```

Админка должна быть частью визуального языка `qa-surface`, а не открывать стандартную DSH settings modal.

## Layout

Desktop:

```text
┌─────────────────────────────────────────────────────────────┐
│ QA Administration                                      ●   │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│ Access       │  Roles & capabilities                        │
│              │                                              │
│ ▸ Subroles   │  [ Analyst ] [ Sales ] [ Pre-Sales ]        │
│   Common     │  [ Developer ]                               │
│   Users      │                                              │
│   Audit      │                                              │
│              │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Subroles page

Показывать карточки:

```text
┌─────────────────────────┐
│ 📊 Analyst       Enabled│
│                         │
│ Research & analytics    │
│                         │
│ 8 Tools     4 Skills    │
│ + 5 Common              │
│                         │
│                   Edit →│
└─────────────────────────┘
```

Действия:

```text
Create subrole
Duplicate
Disable
Delete
Edit
```

Удаление используемой роли должно требовать reassignment пользователей.

---

## Subrole editor

Страница:

```text
Analyst
Research and analytics

[ General ] [ Tools ] [ Skills ] [ Effective access ]
```

### General

```text
Name
Slug / ID
Description
Icon
Enabled
```

ID после создания лучше сделать immutable либо менять отдельно с migration.

### Tools

Toolbar:

```text
Search tools...            Source ▾     Show selected only
```

Далее capability groups.

```text
COMMON

✓ web_search                         Common
✓ session_event_search               Common

CORE

□ bash
✓ analytics_query
□ lsp

MCP · Jira

✓ jira_search
✓ jira_issue_get
□ jira_issue_update

PLUGIN · CRM

✓ crm_search
□ crm_customer_update
```

Inherited `Common` rows нельзя снимать прямо отсюда.

При клике:

```text
Managed in Common capabilities
```

и ссылка:

```text
Edit common capabilities →
```

---

## Skills

Визуально почти идентичны Tools.

Дополнительно показывать:

```text
provider
source
model/user invocation state
description
```

Например:

```text
✓ business-analysis

Analyze requirements, metrics and business processes.

Provider: filesystem
Source: project-dsh
```

---

## Effective access

Очень полезная вкладка.

Она показывает **результат**, а не настройки:

```text
Effective capabilities for Analyst

12 Tools
  5 inherited from Common
  7 from Analyst

6 Skills
  2 inherited from Common
  4 from Analyst
```

Список read-only.

Это позволит администратору быстро отвечать на вопрос:

> Что на самом деле увидит Analyst?

---

# Common capabilities UI

Отдельная страница:

```text
Common capabilities
```

Description:

```text
Capabilities selected here are available to every enabled QA subrole.
```

Tabs:

```text
Tools | Skills
```

При добавлении опасного capability желательно показать impact:

```text
⚠ This tool will become available to 7 subroles and 124 users.
```

---

# User assignments

Если существующая role system уже знает пользователей, расширить её.

Таблица:

| User | Access Role | Default Subrole | Available Subroles |
|---|---|---|---|
| Alice | User | Analyst | Analyst |
| Bob | User | Developer | Developer, Analyst |
| Eve | Admin | Pre-Sales | All |

Редактор пользователя:

```text
Available QA roles

☑ Analyst
☐ Sales
☑ Pre-Sales
☐ Developer

Default role
[ Analyst ▼ ]
```

`Admin` не должен автоматически означать, что его QA-agent получает все tools.

Административные полномочия UI и capabilities агента — разные вещи.

---

# Role selection in QA UI

Если пользователю доступна только одна саброль — selector вообще не показывать.

Если несколько:

```text
┌───────────────────────┐
│ Analyst            ▾  │
└───────────────────────┘
```

В dropdown:

```text
Analyst
Developer
Pre-Sales
```

Переключение после начала разговора:

```text
Switching role starts a new conversation because the agent's
available tools and skills will change.

[Cancel] [Start new chat as Developer]
```

Не менять capabilities у уже активно использовавшегося agent silently.

---

# Admin preview

Добавить:

```text
Preview as role
```

Администратор выбирает:

```text
View as:
[ Pre-Sales ▼ ]
```

И получает обычный QA interface с реальным capability policy этой роли.

Это сильно упростит проверку конфигурации.

Желательно визуально оставлять banner:

```text
ADMIN PREVIEW · Pre-Sales
```

чтобы не перепутать preview с обычной QA session.

---

# Backend services

Архитектурно разделить feature хотя бы на следующие внутренние компоненты:

```text
RoleRepository
CapabilityCatalog
CapabilityPolicyResolver
ToolPolicyEnforcer
SkillPolicyConsumer
RoleAssignmentService
QaAdminApi
```

Основной flow:

```text
HTTP/browser principal
        │
        ▼
RoleAssignmentService
        │
        ▼
activeSubrole
        │
        ▼
CapabilityPolicyResolver
        │
        ├──────────── common
        ├──────────── role
        └──────────── system-required
        │
        ▼
EffectiveCapabilityPolicy
        │
        ├── ToolPolicyEnforcer
        └── SkillPolicyConsumer
```

---

# Effective policy object

После resolution желательно работать с immutable object:

```ts
interface EffectiveCapabilityPolicy {
  subroleId: string

  tools: ReadonlySet<string>
  skills: ReadonlySet<string>

  sources: {
    systemTools: ReadonlySet<string>
    commonTools: ReadonlySet<string>
    roleTools: ReadonlySet<string>

    systemSkills: ReadonlySet<string>
    commonSkills: ReadonlySet<string>
    roleSkills: ReadonlySet<string>
  }
}
```

UI/API может использовать `sources`, чтобы объяснить происхождение capability:

```text
web_search
Inherited from Common
```

---

# Hot updates

Изменение role config желательно применять без полного restart DSH.

Но уже работающую session не стоит незаметно расширять.

Рекомендованная семантика:

```text
role loses capability
    → revoke immediately

role gains capability
    → next new QA agent/session
```

Более простая первая версия:

```text
any role capability change
    → existing sessions keep immutable snapshot
    → new sessions receive new policy
```

Этот вариант гораздо легче reason-ить и тестировать.

В UI:

```text
Changes apply to new conversations.
```

Позже можно сделать live reconciliation.

---

# Security requirements

Frontend filtering никогда не считается enforcement.

Backend обязан независимо проверять active subrole.

Admin routes/API должны проверять authorization role server-side.

QA role selection должен проверяться по `allowedSubroles` пользователя; нельзя доверять:

```json
{ "subrole": "developer" }
```

присланному браузером.

Tool execution должен иметь defense-in-depth check.

Skill loading должен иметь отдельный allowlist check.

Unknown capabilities должны default-deny.

Newly installed capabilities должны default-deny.

Role configuration не должна позволять пользователю самостоятельно расширять свои capabilities.

---

# Audit

Я бы сразу заложил небольшой audit trail:

```text
admin changed role
admin changed common capabilities
user assignment changed
role enabled/disabled
```

Например:

```ts
interface QaAccessAuditEvent {
  timestamp: string
  actorId: string

  action:
    | 'subrole.created'
    | 'subrole.updated'
    | 'subrole.deleted'
    | 'common.updated'
    | 'assignment.updated'

  targetId?: string
  before?: unknown
  after?: unknown
}
```

Не обязательно делать сложный event sourcing.

Но хотя бы возможность понять:

> Кто вчера дал Sales доступ к jira_issue_update?

очень быстро окупится.

---

# Compatibility

DSH всё ещё активно меняет публичные capability seams, поэтому прямые вызовы DSH желательно изолировать за маленькими adapters. Сам Harness прямо предупреждает о compatibility-breaking changes в developer preview.

Например:

```text
src/dsh/tools.ts
src/dsh/skills.ts
src/dsh/agents.ts
```

Вместо размазывания:

```ts
ctx.tools...
ctx.skills...
```

по всему `qa-surface`.

---

# Suggested repository structure

```text
src/
  access/
    model.ts
    role-repository.ts
    assignments.ts
    capability-policy.ts
    capability-catalog.ts

  enforcement/
    tool-policy.ts
    skill-policy.ts

  admin/
    api.ts
    permissions.ts

  client/
    admin/
      AdminLayout.tsx
      SubroleList.tsx
      SubroleEditor.tsx
      CapabilityPicker.tsx
      CommonCapabilities.tsx
      UserAssignments.tsx
      EffectiveAccess.tsx

    role/
      RoleSelector.tsx
      RoleBadge.tsx

  dsh/
    tools.ts
    skills.ts
    agent-lifecycle.ts
```

---

# Implementation phases

| Phase | Work |
|---|---|
| 1 | Data model + migrations + capability policy resolver |
| 2 | Tool allowlist via agent-scoped `ctx.tools.restrict()` |
| 3 | `tools/pre-execute` defense-in-depth enforcement |
| 4 | Filtered/shadowed `skill` consumer |
| 5 | Capability discovery API |
| 6 | Admin UI: Common + Subroles |
| 7 | User assignments + QA role selector |
| 8 | Effective Access preview |
| 9 | Audit + admin preview |
| 10 | compatibility/e2e tests |

---

# Acceptance criteria

- Саброли можно создавать, редактировать, выключать и удалять через `/qa/admin`.
- Для каждой саброли независимо настраиваются Tools и Skills.
- Есть отдельные Common Tools и Common Skills.
- Effective capabilities вычисляются как `required + common + active subrole`.
- Tool вне effective allowlist отсутствует в model tool catalog.
- Попытка непосредственного вызова запрещённого tool блокируется backend policy.
- Skill вне effective allowlist отсутствует в model skill catalog и не загружается через `skill`.
- Новый установленный tool/skill автоматически не становится доступен сабролям.
- Пользователь не может выбрать саброль, которая ему не назначена.
- Если доступна одна саброль, selector не показывается.
- Смена саброли в активном разговоре создаёт новую session.
- Admin UI показывает origin capability и отдельно effective access.
- Missing/uninstalled capability остаётся в конфигурации с warning.
- Административная роль пользователя сама по себе не расширяет capabilities его QA-agent.
- Все security checks выполняются backend-side.
- Есть tests как минимум на `common`, `role-specific`, `unknown capability`, `forbidden direct invocation`, `role switching` и `admin authorization`.

---

# Out of scope for first iteration

Не обязательно включать сразу:

```text
per-user individual tool overrides
conditional policies по аргументам tool
time-based permissions
ABAC
live role mutation внутри активного agent
role inheritance Analyst → Senior Analyst
arbitrary boolean policy expressions
```

Но data model желательно не делать таким, чтобы их невозможно было добавить позже.

---

# Future extension

После Tools + Skills тот же capability model можно естественно расширить:

```ts
interface CapabilitySelection {
  tools: string[]
  skills: string[]

  mcpServers?: string[]
  knowledgeSources?: string[]
  slashCommands?: string[]
}
```

То есть в итоге саброль становится не просто набором checkboxes, а полноценным **QA Agent Profile**:

```text
Pre-Sales
├── persona/prompt
├── tools
├── skills
├── MCP
├── knowledge
├── model policy
└── permissions
```

При этом UI всё ещё может называть сущность понятным пользователю словом **Role** или **Subrole**.
