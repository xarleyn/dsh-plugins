# dsh-qa-surface — Skill Routing & Dynamic Tool Grants

## 1. Goal

Расширить интеграцию `dsh-qa-surface` со стандартными DSH skills так, чтобы сами `SKILL.md` декларативно описывали:

1. каким QA subroles skill доступен;
2. является ли skill общим для всех subroles;
3. какие tools нужны skill для полноценной работы;
4. какие tools должны становиться доступны агенту только после активации skill.

Основной результат:

```text
Skill metadata
      │
      ├── determines visibility
      │
      └── declares required tools
                    │
                    ▼
          QA capability policy
                    │
                    ▼
        Agent loads the skill
                    │
                    ▼
      temporary tool expansion
```

Пример:

```text
browser-research
  ├── available to Analyst + Pre-Sales
  └── when loaded:
         browser_open
         browser_click
         browser_extract
         browser_screenshot
         become available
```

До загрузки `browser-research` эти browser tools не занимают model tool surface.

---

# 2. Do not add custom top-level SKILL fields

Не стоит делать:

```yaml
---
name: browser-research
description: ...
isCommon: false
subroles:
  - analyst
  - presales
tools:
  - browser_open
---
```

Хотя YAML parser DSH читает frontmatter как open object, штатный filesystem provider сознательно интерпретирует только поддерживаемые поля и отдельно сохраняет `metadata`.

Использовать:

```yaml
---
name: browser-research
description: Research websites using browser automation

metadata:
  qa-surface:
    ...
---
```

Преимущества:

```text
не нужен fork DSH
не нужен runtime patch skill parser
нет конфликтов с будущими upstream fields
skill остаётся валидным обычным DSH skill
qa-surface metadata игнорируется вне qa-surface
```

---

# 3. Naming

Вместо:

```text
isCommon
subroles
```

использовать понятие:

```text
audience
```

`isCommon` создаёт потенциально противоречивые состояния:

```yaml
isCommon: true
subroles:
  - sales
```

Непонятно, означает ли это:

```text
всем
```

или:

```text
всем + sales
```

Поэтому лучше discriminated format.

---

# 4. Proposed metadata format

## Common skill

```yaml
---
name: company-basics
description: Basic company terminology and interaction rules

metadata:
  qa-surface:
    audience:
      type: common
---
```

Skill автоматически доступен всем QA subroles.

---

## Subrole-specific skill

```yaml
---
name: sales-crm
description: Work with CRM and customer records

metadata:
  qa-surface:
    audience:
      type: subroles
      include:
        - sales
        - presales
---
```

Skill доступен только:

```text
Sales
Pre-Sales
```

---

## Skill without qa-surface metadata

Например обычный старый skill:

```yaml
---
name: search-dev
description: Development-oriented web search
---
```

По умолчанию:

```text
не выдавать автоматически никакой QA subrole
```

Он отображается в Admin UI как:

```text
Unassigned
```

и администратор может распределить его вручную.

Это безопаснее, чем автоматически делать любой новый установленный skill common.

---

# 5. Final audience schema

```ts
type QaSkillAudience =
  | {
      type: 'common'
    }
  | {
      type: 'subroles'
      include: string[]
    }
```

В metadata:

```ts
interface QaSkillMetadata {
  audience?: QaSkillAudience
}
```

---

# 6. Resolution

Для subrole:

```text
effectiveSkills(role) =
    adminCommonSkills
  ∪ metadataCommonSkills
  ∪ adminRoleSkills(role)
  ∪ metadataRoleSkills(role)
```

То есть metadata автоматически распределяет skills, но Admin UI всё равно может иметь явные assignments.

---

# 7. Metadata vs Admin configuration

Здесь полезно ввести два источника назначения.

## Declared

Пришло из самого `SKILL.md`:

```text
Declared by skill
```

## Managed

Назначено через QA Admin:

```text
Managed by administrator
```

Например:

```text
browser-research

Available to:
  ✓ Analyst        Declared by skill
  ✓ Pre-Sales      Declared by skill
  ✓ Developer      Added by admin
```

Это позволяет skill author задать разумные defaults, а deployment admin при необходимости расширить их.

---

# 8. Do not allow Admin UI to silently edit SKILL.md

Admin UI не должен по умолчанию переписывать файл:

```text
.agents/skills/foo/SKILL.md
```

Назначения через UI следует хранить как overlay:

```text
Skill metadata
      +
Admin overrides
      =
Effective assignment
```

Причины:

```text
skill может находиться в Git
skill может быть read-only
skill может прийти из plugin/provider
skill может обновиться извне
```

---

# 9. Optional override semantics

Можно предусмотреть:

```ts
interface SkillAssignmentOverride {
  skillName: string

  addToSubroles?: string[]
  removeFromSubroles?: string[]

  forceCommon?: boolean
  disabled?: boolean
}
```

Таким образом Admin может даже убрать declarative assignment:

```text
SKILL.md says: Sales
Admin says: exclude Sales
```

Но UI должен явно показывать:

```text
Overridden
```

---

# 10. Tool requirements

Добавить вторую секцию:

```yaml
metadata:
  qa-surface:
    audience:
      type: subroles
      include:
        - analyst
        - presales

    tools:
      requires:
        - browser_open
        - browser_click
        - browser_extract
```

`requires` означает:

> Для работы этого skill необходимы эти tools.

Но само наличие этого списка **не должно автоматически обходить security policy**.

---

# 11. Why tools must be tied to skills

Без dynamic tool grants придётся выбирать между двумя плохими вариантами.

## Variant A — all possible tools always enabled

Например Analyst получает:

```text
web_search
jira_search
browser_open
browser_click
browser_extract
browser_screenshot
browser_download
...
```

Хотя browser tools нужны только в 5% задач.

Недостатки:

```text
большой tool catalog
лишние токены
сложнее выбор tool
больше вероятность неправильного tool call
лишняя capability exposure
```

---

## Variant B — browser tools forbidden

Тогда skill говорит агенту:

> используй BrowserUse

но tools физически отсутствуют.

Skill становится неработоспособным.

---

## Desired

```text
Initial agent

Tools:
  web_search
  jira_search
  skill

Skills:
  browser-research
```

Agent:

```text
skill("browser-research")
```

После загрузки:

```text
Tools:
  web_search
  jira_search

  + browser_open
  + browser_click
  + browser_extract
  + browser_screenshot
```

На следующем model step инструменты уже присутствуют.

Это особенно хорошо для BrowserUse-подобных наборов с большим количеством tools.

---

# 12. Dynamic tool grants

Использовать понятие:

```text
Tool Grant
```

или внутренне:

```text
Skill Tool Grant
```

Не:

```text
tool expansion
```

в data model, поскольку grant лучше отражает security semantics.

---

# 13. Skill metadata

Полная рекомендуемая форма:

```yaml
---
name: browser-research
description: Research websites using interactive browser automation
whenToUse: Use when normal web search is insufficient and interaction with a website is required.

metadata:
  qa-surface:

    audience:
      type: subroles
      include:
        - analyst
        - presales

    tools:
      requires:
        - browser_open
        - browser_click
        - browser_extract
        - browser_screenshot

      grant:
        lifecycle: session
---
```

---

# 14. Alternative concise form

Для большинства skills `requires` одновременно означает:

```text
skill needs tool
+
skill requests dynamic grant
```

Поэтому не обязательно дублировать список:

```yaml
tools:
  requires:
    - browser_open
    - browser_click

  grant:
    lifecycle: session
```

Это лучше, чем:

```yaml
requires:
  - browser_open

grants:
  - browser_open
```

---

# 15. Security boundary

Критически важно:

```text
SKILL.md must NOT be an authorization authority.
```

Иначе пользователь сможет создать:

```yaml
metadata:
  qa-surface:
    tools:
      requires:
        - production_delete_database
```

и получить tool автоматически.

Поэтому:

```text
requested grant
       ∩
role grant ceiling
       =
effective skill grant
```

---

# 16. Role tool model

В предыдущей role specification разделить tools на два класса.

```ts
interface RoleToolCapabilities {
  always: string[]

  skillGrantable: string[]
}
```

Например:

```yaml
developer:
  tools:
    always:
      - web_search
      - jira_search

    skillGrantable:
      - browser_open
      - browser_click
      - browser_extract
      - browser_screenshot
```

---

# 17. Common tool model

Аналогично:

```yaml
common:
  tools:
    always:
      - web_search

    skillGrantable:
      - browser_open
      - browser_click
      - browser_extract
```

---

# 18. Effective tool ceiling

```text
baseTools =
    systemRequiredTools
  ∪ common.always
  ∪ role.always
```

Grant ceiling:

```text
grantableTools =
    common.skillGrantable
  ∪ role.skillGrantable
```

При загрузке skill:

```text
requestedTools = skill.metadata.tools.requires

grantedTools =
    requestedTools
    ∩ grantableTools
```

Effective tools:

```text
effectiveTools =
    baseTools
  ∪ activeSkillGrants
```

---

# 19. Example

Role:

```yaml
presales:
  tools:
    always:
      - web_search
      - jira_search
      - crm_search

    skillGrantable:
      - browser_open
      - browser_click
      - browser_extract
      - browser_screenshot
```

Skill:

```yaml
metadata:
  qa-surface:
    tools:
      requires:
        - browser_open
        - browser_click
        - browser_extract
```

Before skill:

```text
web_search
jira_search
crm_search
skill
```

After:

```text
web_search
jira_search
crm_search
browser_open
browser_click
browser_extract
skill
```

---

# 20. Unauthorized requirement

Suppose skill declares:

```yaml
requires:
  - browser_open
  - production_shell
```

Role ceiling:

```yaml
skillGrantable:
  - browser_open
```

Result:

```text
browser_open       GRANTED
production_shell   DENIED
```

Skill loader should return additional information to agent:

```text
Skill loaded with limited capabilities.

Unavailable required tools:
- production_shell
```

Не молча выдавать tool.

---

# 21. Strict skill requirements

Некоторые skills бессмысленны без всех declared tools.

Добавить:

```yaml
tools:
  requires:
    - browser_open
    - browser_click

  grant:
    lifecycle: session
    requireAll: true
```

Если один tool нельзя выдать:

```text
skill load rejected
```

Model-facing error:

```text
Skill "browser-research" cannot be activated because required
tool "browser_click" is unavailable for the current role.
```

---

# 22. Best-effort skills

Default:

```yaml
requireAll: false
```

Тогда skill может работать degraded.

Например:

```text
browser-research

browser_open       ✓
browser_extract    ✓
browser_screenshot ✕
```

Skill загружается, но получает warning.

---

# 23. Lifecycle

Поддержать изначально:

```text
session
```

То есть:

```text
skill loaded
    ↓
tools granted
    ↓
remain available for current conversation agent
```

Это самый простой и предсказуемый вариант.

Не нужно в первой версии пытаться определить:

> закончил ли агент пользоваться skill?

---

# 24. Future lifecycle modes

Позже можно добавить:

```text
turn
task
explicit-release
```

Но `turn` проблематичен:

```text
model loads skill
    ↓
turn ends
    ↓
tools disappear
```

и skill фактически не успевает ими воспользоваться.

Поэтому нормальный default:

```yaml
lifecycle: session
```

---

# 25. Multiple active skills

Если агент загрузил:

```text
browser-research
jira-analysis
```

то:

```text
activeSkillGrants =
  grants(browser-research)
  ∪ grants(jira-analysis)
```

Tool остаётся доступным, пока хотя бы один active grant его держит.

Внутренне лучше использовать reference/source model:

```ts
Map<ToolName, Set<SkillName>>
```

Например:

```text
browser_open
  ← browser-research

jira_search
  ← jira-analysis
  ← release-investigation
```

---

# 26. Dynamic DSH restriction update

DSH `ctx.tools.restrict({ allow })` создаёт scoped allowlist и возвращает disposer. Изменение restriction генерирует `tools/change`, а следующий assembly tool schemas увидит обновлённый набор.

Поэтому `qa-surface` может держать:

```ts
class AgentToolPolicy {
  private disposeRestriction?: () => void

  update(policy: EffectiveToolPolicy) {
    this.disposeRestriction?.()

    this.disposeRestriction =
      agent.ctx.tools.restrict({
        allow: [...policy.effectiveTools]
      })
  }
}
```

Flow:

```text
skill("browser-research")
       │
       ▼
SkillPolicyConsumer
       │
       ├── validate skill audience
       ├── load skill
       ├── resolve tool requirements
       └── activate grants
                    │
                    ▼
          ToolPolicyResolver
                    │
                    ▼
       rebuild ctx.tools.restrict()
                    │
                    ▼
              tools/change
                    │
                    ▼
          next model step sees
          expanded tool schemas
```

---

# 27. Execution-time enforcement

Как и в role specification, visibility недостаточно считать единственным security layer.

Добавить agent-scoped guard.

DSH предоставляет `ctx.tools.guard()`: guard, зарегистрированный через `agent.ctx`, действует только на конкретного агента и не может force-allow вызов, который запрещён другим guard.

Логика:

```ts
agent.ctx.tools.guard(exec => {
  if (!effectivePolicy.tools.has(exec.name)) {
    return `Tool "${exec.name}" is not allowed by the active QA capability policy`
  }
})
```

Получается:

```text
restriction
  → model visibility

guard
  → actual execution authorization
```

---

# 28. Skill activation is the grant trigger

Tool grant активируется **не потому, что skill виден в catalog**.

Только:

```text
skill visible
        ≠
tools granted
```

Правильно:

```text
skill loaded
        =
tools granted
```

Иначе одна только доступность browser skill сразу раздует toolset и уничтожит пользу lazy capability expansion.

---

# 29. User explicit invocation

DSH поддерживает явный `/skill-name`, при котором skill content инжектится напрямую без обычного model-driven `skill()` loader.

Поэтому grant resolver должен реагировать на **оба пути activation**:

```text
Model:
skill("browser-research")

User:
/browser-research
```

Оба должны приводить к:

```text
activateSkill("browser-research")
```

до следующего model assembly.

Это обязательный acceptance test.

---

# 30. Common skills

`common` означает только:

```text
skill is visible to every QA subrole
```

Он **не означает**:

```text
all its tools permanently enabled
```

Например:

```yaml
metadata:
  qa-surface:
    audience:
      type: common

    tools:
      requires:
        - browser_open
        - browser_extract
```

Skill виден всем.

Но Browser tools всё равно выдаются только после его загрузки и только если текущая role имеет их в `skillGrantable`.

---

# 31. Common basic skills

Примеры подходящих common skills:

```text
company-basics
communication-style
internal-terminology
security-basics
knowledge-search
feedback-guidelines
```

Они могут вообще не содержать tool grants.

---

# 32. Role skills

Например:

```text
Sales

sales-playbook
crm-workflow
proposal-writing
```

```text
Pre-Sales

solution-discovery
architecture-assessment
browser-research
proposal-writing
```

```text
Developer

search-dev
code-review
jira-development
browser-debugging
```

---

# 33. Shared skill between roles

Нет необходимости делать копии.

```yaml
metadata:
  qa-surface:
    audience:
      type: subroles
      include:
        - sales
        - presales
```

Один skill автоматически появляется в обеих ролях.

---

# 34. Role aliases

Не привязывать skill к display name:

```text
"Pre Sales"
"Pre-Sales"
"Presale"
```

Использовать immutable role IDs:

```yaml
include:
  - sales
  - presales
```

Role:

```ts
{
  id: 'presales',
  name: 'Pre-Sales'
}
```

Display name можно менять без поломки skill metadata.

---

# 35. Invalid role

Если skill содержит:

```yaml
include:
  - presales
  - banana-role
```

не отбрасывать весь skill.

Admin UI показывает:

```text
⚠ Unknown subrole: banana-role
```

`presales` продолжает работать.

Unknown role fail-closed:

```text
banana-role assignment ignored
```

---

# 36. Missing tools

Если declared tool отсутствует из DSH registry:

```text
browser_open   Missing
```

Не удалять metadata.

Admin UI:

```text
⚠ browser_open
Required by browser-research but currently not registered.
```

После установки BrowserUse/plugin dependency skill автоматически становится healthy.

---

# 37. Skill health

Добавить computed status:

```text
Healthy
Degraded
Blocked
```

### Healthy

Все required tools существуют и разрешены хотя бы соответствующим roles.

### Degraded

Опциональный/не-strict tool нельзя выдать.

### Blocked

`requireAll=true`, но required tool unavailable.

---

# 38. Admin UI — Skills

Добавить в:

```text
QA Admin
  → Access
  → Skills
```

Таблица:

| Skill            | Audience           | Tool grants | Health  | Source  |
| ---------------- | ------------------ | ----------: | ------- | ------- |
| company-basics   | Common             |           0 | Healthy | project |
| sales-crm        | Sales, Pre-Sales   |           3 | Healthy | project |
| browser-research | Analyst, Pre-Sales |           4 | Healthy | user    |
| legacy-skill     | Unassigned         |           0 | —       | plugin  |

---

# 39. Skill detail

```text
browser-research

Source
Project skill

Audience
● Selected subroles

✓ Analyst
✓ Pre-Sales
□ Sales
□ Developer

Declared in SKILL.md
Analyst, Pre-Sales

Tools

browser_open        Required · Grantable ✓
browser_click       Required · Grantable ✓
browser_extract     Required · Grantable ✓
browser_screenshot  Required · Grantable ✓
```

---

# 40. Source badges

Каждый assignment:

```text
Declared
Admin
Common
Inherited
```

Например:

```text
Pre-Sales        Declared
Developer        Admin override
```

---

# 41. Role editor integration

В Role → Skills:

```text
COMMON

✓ company-basics           Common
✓ communication            Common

ROLE SKILLS

✓ browser-research         Declared by skill
✓ architecture             Admin
□ sales-crm
```

И рядом:

```text
Dynamic tools from enabled skills

browser_open
browser_click
browser_extract
```

Но они должны быть помечены:

```text
Available on skill activation
```

а не как always-active.

---

# 42. Role capability visualization

Effective Access page разделить:

```text
Always available
```

и:

```text
Available through skills
```

Пример:

```text
Pre-Sales

TOOLS · ALWAYS

web_search
jira_search
crm_search

TOOLS · ON SKILL ACTIVATION

browser_open
  via browser-research

browser_click
  via browser-research

diagram_render
  via architecture-design
```

Это значительно понятнее обычного flat tool list.

---

# 43. Tool-grant approval UI

Если новый skill появляется с:

```yaml
requires:
  - browser_open
```

но этот tool ещё не разрешён как `skillGrantable` для роли:

```text
browser-research requests additional capability:

browser_open

Roles affected:
  Analyst
  Pre-Sales

[Keep blocked]
[Allow for these roles]
```

Это удобный admin workflow.

Но approval должен быть явным.

---

# 44. Never auto-escalate

Запрещено:

```text
new SKILL.md
   ↓
declares shell
   ↓
agent immediately receives shell
```

Разрешено:

```text
new SKILL.md
   ↓
declares shell
   ↓
Admin sees Requested capability
   ↓
Admin permits shell as skillGrantable
   ↓
future skill activation may grant it
```

---

# 45. Trusted common skills

При желании позже можно добавить:

```yaml
grant:
  trust: trusted
```

Но в первой версии не использовать metadata как источник trust.

Trust должен определяться deployment/admin config, а не самим skill file.

---

# 46. Runtime data model

```ts
interface QaSkillMetadata {
  audience?: QaSkillAudience

  tools?: {
    requires?: string[]

    grant?: {
      lifecycle?: 'session'
      requireAll?: boolean
    }
  }
}
```

Normalized:

```ts
interface QaSkillDescriptor {
  name: string

  audience:
    | { type: 'unassigned' }
    | { type: 'common' }
    | {
        type: 'subroles'
        include: ReadonlySet<string>
      }

  requiredTools: ReadonlySet<string>

  grant: {
    lifecycle: 'session'
    requireAll: boolean
  }
}
```

---

# 47. Active grant state

```ts
interface ActiveSkillGrant {
  skillName: string

  requestedTools: ReadonlySet<string>
  grantedTools: ReadonlySet<string>
  deniedTools: ReadonlySet<string>

  activatedAt: string
}
```

Per agent:

```ts
interface QaAgentCapabilityState {
  subroleId: string

  activeSkills: Map<string, ActiveSkillGrant>

  effectiveTools: ReadonlySet<string>
}
```

---

# 48. Policy resolver

```ts
resolveTools({
  system,
  common,
  subrole,
  activeSkills
})
```

roughly:

```ts
const base = union(
  system.requiredTools,
  common.tools.always,
  subrole.tools.always
)

const ceiling = union(
  common.tools.skillGrantable,
  subrole.tools.skillGrantable
)

const dynamic = intersection(
  union(
    ...activeSkills.map(skill => skill.requiredTools)
  ),
  ceiling
)

return union(base, dynamic)
```

---

# 49. Loading algorithm

When:

```text
skill("browser-research")
```

perform:

```text
1. Resolve skill from ctx.skills.

2. Read qa-surface metadata.

3. Verify skill belongs to:
      common
      OR current subrole.

4. Resolve required tools.

5. Check each required tool:
      registered?
      grantable by role?

6. If requireAll and one requirement fails:
      reject activation.

7. Load/render skill instructions.

8. Record ActiveSkillGrant.

9. Recompute effectiveTools.

10. Replace scoped tool restriction.

11. Emit normal DSH tool change behavior.

12. Next model step sees new tools.
```

---

# 50. Atomicity

Important:

```text
skill content loaded
```

and:

```text
tool grant activated
```

should be one logical operation.

Не должно быть состояния:

```text
skill instructions tell model to call browser_open
but grant activation failed silently
```

Если activation fails:

```text
skill load result must explain it.
```

---

# 51. Auditability

Conversation metadata should record:

```text
Skill activated:
browser-research

Requested tools:
browser_open
browser_click
browser_extract

Granted:
browser_open
browser_click

Denied:
browser_extract
```

Это полезно для Quality Console.

В conversation viewer:

```text
▸ Skill activated · browser-research
  + browser_open
  + browser_click
  × browser_extract
```

---

# 52. Feedback / quality integration

Из предыдущей Admin & Quality spec можно автоматически классифицировать ситуации:

```text
skill loaded
+
required tool denied
+
bad response
```

как candidate:

```text
Missing capability
```

А:

```text
skill available
+
never loaded
+
reviewer says tool should have been used
```

можно анализировать как:

```text
Skill not selected
```

Так role/skill architecture напрямую становится полезной quality telemetry.

---

# 53. Session snapshots

Сохранять:

```ts
interface QaCapabilitySnapshot {
  subroleId: string

  visibleSkills: string[]
  activeSkills: string[]

  baseTools: string[]
  dynamicTools: string[]

  policyRevision: string
}
```

Чтобы исторический conversation review видел именно реальные capabilities той сессии.

---

# 54. Compatibility

DSH filesystem skill provider уже:

```text
parses metadata
stores metadata on SkillCandidate
stores metadata on SkillDefinition
```

поэтому `qa-surface` должен читать только:

```ts
skill.metadata?.['qa-surface']
```

и не менять upstream skill schema.

Если metadata отсутствует:

```text
plain DSH behavior remains intact outside QA Surface
```

---

# 55. Schema version

Я бы сразу добавил:

```yaml
metadata:
  qa-surface:
    version: 1
```

Полный пример:

```yaml
---
name: browser-research
description: Research websites through browser automation
whenToUse: Use when search/fetch is insufficient and interactive browsing is required.

metadata:
  qa-surface:
    version: 1

    audience:
      type: subroles
      include:
        - analyst
        - presales

    tools:
      requires:
        - browser_open
        - browser_click
        - browser_extract
        - browser_screenshot

      grant:
        lifecycle: session
        requireAll: true
---

# Browser Research

...
```

---

# 56. Simple common example

```yaml
---
name: company-basics
description: Shared terminology and basic company rules

metadata:
  qa-surface:
    version: 1

    audience:
      type: common
---
```

---

# 57. Developer example

```yaml
---
name: browser-debugging
description: Debug web applications using browser automation

metadata:
  qa-surface:
    version: 1

    audience:
      type: subroles
      include:
        - developer

    tools:
      requires:
        - browser_open
        - browser_click
        - browser_console
        - browser_network

      grant:
        lifecycle: session
        requireAll: false
---
```

---

# 58. Backward compatibility

Existing skills:

```yaml
---
name: foo
description: Bar
---
```

continue to work normally in ordinary DSH.

Inside QA Surface:

```text
audience = unassigned
dynamic tool requirements = none
```

Admin can manually assign them.

---

# 59. MVP

First implementation should support:

```text
metadata.qa-surface.version

audience.type = common
audience.type = subroles
audience.include[]

tools.requires[]
tools.grant.lifecycle = session
tools.grant.requireAll
```

Plus:

```text
admin override assignments
role skillGrantable tools
dynamic scoped ctx.tools restriction
execution guard
skill activation tracking
admin visualization
```

---

# 60. Non-goals

First version should NOT implement:

```text
skills granting arbitrary tools without role approval

per-tool argument policies inside SKILL.md

temporary grants measured in seconds

skill-to-skill recursive capability grants

automatic admin approval

automatic modification of SKILL.md from UI

full generic DSH skill schema fork
```

---

# 61. Acceptance criteria

- Common skill is automatically visible to every QA subrole.
- Role-scoped skill is visible only to configured subroles.
- Plain skills without QA metadata are not automatically exposed.
- Admin can override metadata assignments.
- Skill metadata is stored entirely under `metadata.qa-surface`.
- Loading a skill can expand the agent's toolset.
- Merely seeing a skill in the catalog does not expand tools.
- Tool expansion happens before the next model step.
- `/skill-name` and model `skill(name)` activation both trigger grants.
- A skill cannot grant a tool outside the current role's `skillGrantable` ceiling.
- Missing tools generate a visible degraded/blocked state.
- `requireAll=true` prevents activation when mandatory tools cannot be granted.
- Tool grants survive for the current agent/session in v1.
- Multiple loaded skills union their grants.
- Removing one grant source does not revoke a tool still required by another active skill.
- Execution-time guard independently enforces the effective tool policy.
- Skill/tool activation is recorded for conversation review.
- Newly installed skills/tools do not silently expand user privileges.

---

# 62. Resulting capability model

After this change the full QA policy becomes:

```text
                         QA Subrole
                             │
               ┌─────────────┴─────────────┐
               │                           │
            Skills                       Tools
               │                           │
      ┌────────┴────────┐         ┌────────┴────────┐
      │                 │         │                 │
   Common             Role     Always         Skill-grantable
      │                 │         │                 │
      └────────┬────────┘         │                 │
               │                  │                 │
         Visible skills           │                 │
               │                  │                 │
               ▼                  │                 │
          Skill loaded            │                 │
               │                  │                 │
               └──── requires ────┼──────────────► │
                                  │                 │
                                  └──────┬──────────┘
                                         │
                                         ▼
                                Effective toolset
```

Ключевая идея:

```text
Skills decide WHEN capability is needed.

Roles decide WHETHER capability may ever be granted.
```

Это и должно быть основой dynamic capability system.
