# dsh-session-audit

## Session Audit Registry, Viewer and QA Surface Integration

## 1. Summary

Создать отдельный DeepSeek Harness plugin:

```text
dsh-session-audit
```

Плагин должен предоставлять централизованную инфраструктуру для аудитов DSH-сессий:

```text
audit artifacts
    ↓
discovery / validation
    ↓
session mapping
    ↓
registry
    ↓
provider API
    ↓
┌─────────────────────┬──────────────────────┐
│ Ordinary DSH        │ dsh-qa-surface       │
│                     │                      │
│ Audit tab           │ badge + audit modal  │
└─────────────────────┴──────────────────────┘
```

`dsh-session-audit` является **единственным владельцем ingestion/indexing/runtime registry аудитов**.

`dsh-qa-surface`:

- создаёт аудит;
- записывает audit artifacts;
- использует `dsh-session-audit` как provider для отображения результата.

Обычный DSH:

- получает отдельную conversation view `Audit`;
- показывает аудит текущей сессии независимо от наличия `dsh-qa-surface`.

---

# 2. Goals

Основные цели:

1. Добавить в обычный DSH отдельную вкладку:

```text
Chat | Trajectory | Context | Audit
```

2. Автоматически подхватывать audit artifacts, просто появившиеся в filesystem.

3. Использовать один audit registry для всех consumers.

4. Сохранить в `dsh-qa-surface` ранее спроектированный UX:

```text
✓ Аудит проведён
      ↓
large modal
      ↓
Report / Findings / JSON
```

5. Не дублировать:

- filesystem watcher;
- parsing;
- validation;
- registry;
- schema handling;
- session resolution.

6. Разделить:

```text
audit generation
audit storage
audit ingestion
audit presentation
```

7. Сделать формат аудита независимым от конкретного evaluator-а.

---

# 3. Non-goals

В первой версии не требуется:

- встраивание элементов непосредственно внутрь native `Trajectory`;
- изменение native Trajectory UI;
- отдельная audit database;
- изменение или редактирование аудита из DSH;
- автоматическое исправление проблем, найденных аудитором;
- upload аудит-файлов через UI;
- глобальный analytics dashboard;
- сравнение двух аудитов;
- полноценная история версий аудита;
- review approval workflow;
- comments/annotations поверх аудита.

Эти возможности могут появиться позже поверх основной архитектуры.

---

# 4. Existing audit format

На текущий момент каждый аудит представлен двумя файлами:

```text
analysis.json
REPORT.md
```

Текущий `analysis.json` уже содержит:

```text
schemaVersion
trajectory
evidenceSufficiency
verdict
taskOutcome
scores
findings
missedOpportunities
userCorrections
betterTrajectory
recommendations
limitations
```

В `trajectory` присутствует полный `sessionId`, а также model, agent preset, tool calls/errors и execution metadata.

Scorecard имеет структурированное представление:

```text
score
confidence
summary
evidence
```

для каждой оцениваемой dimension.

Findings уже имеют подходящую для UI структуру:

```text
id
severity
category
title
status
rootCause
description
evidence
recommendationTarget
```



Recommendations отдельно содержат:

```text
target
priority
action
evidence
```



`REPORT.md` является полноценным human-readable представлением того же аудита и содержит Verdict, Executive summary, Scorecard, Material issues, Better trajectory, Recommended changes и ограничения.

---

# 5. Core architectural rule

Главный архитектурный принцип:

```text
analysis.json = semantic source
REPORT.md     = presentation source
```

Следовательно:

```text
badge           ← analysis.json
summary         ← analysis.json
findings UI     ← analysis.json
scorecard UI    ← analysis.json
recommendations ← analysis.json
JSON view       ← analysis.json

Report tab      ← REPORT.md
```

Запрещается:

- вычислять verdict по Markdown;
- regex-парсить findings из `REPORT.md`;
- извлекать scorecard из Markdown-таблицы;
- определять sessionId из текста REPORT, если он уже имеется в JSON.

---

# 6. Package architecture

Рекомендуемая архитектура:

```text
packages/
├── dsh-audit-core/
│
├── dsh-audit-ui/
│
├── dsh-session-audit/
│
└── dsh-qa-surface/
```

При использовании npm scope:

```text
@scope/dsh-audit-core
@scope/dsh-audit-ui

@scope/dsh-session-audit
@scope/dsh-qa-surface
```

Если shared packages не должны публиковаться отдельно, они могут быть:

```text
private: true
```

и использоваться workspace dependencies.

---

# 7. dsh-audit-core

`dsh-audit-core` не является DSH plugin.

Он не должен зависеть от:

- React;
- DOM;
- Cordis;
- DSH server;
- DSH UI.

Он предоставляет общий domain layer.

Предлагаемая структура:

```text
packages/dsh-audit-core/
├── src/
│   ├── schema/
│   │   ├── v1.ts
│   │   └── index.ts
│   │
│   ├── types/
│   │   ├── audit.ts
│   │   ├── findings.ts
│   │   └── provider.ts
│   │
│   ├── parser/
│   │   └── parse-analysis.ts
│   │
│   ├── validation/
│   │   └── validate-analysis.ts
│   │
│   ├── summary/
│   │   └── build-summary.ts
│   │
│   └── index.ts
│
└── package.json
```

Основные публичные сущности:

```ts
AuditAnalysisV1

AuditSummary

AuditFinding

AuditRecommendation

AuditRecord

SessionAudit

AuditRegistryEvent

SessionAuditProvider
```

Основные функции:

```ts
parseAuditAnalysis()

validateAuditAnalysis()

buildAuditSummary()

countFindings()

getAuditSessionId()
```

---

# 8. Audit schema versioning

Текущий JSON уже содержит:

```json
{
  "schemaVersion": 1
}
```



Это необходимо сохранить как основной compatibility boundary.

Пример:

```ts
type AuditAnalysis =
  | AuditAnalysisV1
  | UnknownAuditAnalysis
```

Для известных schema:

```text
schemaVersion = 1
      ↓
v1 semantic adapter
      ↓
full rich UI
```

Для неизвестной schema:

```text
unknown schema
      ↓
generic JSON viewer
      +
REPORT.md viewer
```

Неизвестная новая schema не должна полностью блокировать просмотр аудита.

---

# 9. Future provenance metadata

Для следующей версии schema желательно добавить необязательный блок:

```json
{
  "schemaVersion": 2,

  "audit": {
    "id": "audit-f3e452",
    "createdAt": "2026-09-17T18:31:54Z",

    "producer": {
      "name": "dsh-qa-surface",
      "version": "0.4.0"
    }
  },

  "trajectory": {
    "sessionId": "session-..."
  }
}
```

Опционально:

```json
{
  "auditor": {
    "type": "llm",
    "model": "..."
  }
}
```

Однако `dsh-session-audit` v1 обязан работать и с текущей schemaVersion 1 без изменения generator-а.

---

# 10. dsh-audit-ui

`dsh-audit-ui` — reusable UI package.

Он не должен знать, откуда пришёл аудит.

Запрещается напрямую:

```text
fetch("/api/plugins/dsh-session-audit/...")
```

внутри UI primitives.

UI получает уже загруженные данные через props.

Пример:

```tsx
<AuditStatusBar summary={summary} />

<AuditReport markdown={report} />

<AuditFindings findings={analysis.findings} />

<AuditJsonTree value={analysis} />
```

---

# 11. UI component structure

Рекомендуемые primitives:

```text
AuditStatusBadge

AuditStatusBar

AuditSummary

AuditScorecard

AuditFindings

AuditFindingCard

AuditRecommendations

AuditBetterTrajectory

AuditReport

AuditJsonTree

AuditTabs

AuditEmptyState

AuditErrorState
```

Composition должна оставаться гибкой.

Не делать один монолитный:

```text
<AuditViewerEverything />
```

с зашитой layout-логикой.

---

# 12. Canonical filesystem location

Использовать нейтральный root:

```text
${DSH_HOME}/audits
```

Default:

```ts
auditRoot = path.join(DSH_HOME, "audits")
```

Override:

```text
DSH_AUDIT_ROOT=/data/dsh-audits
```

или plugin config.

Не использовать в canonical path:

```text
qa-surface
```

так как аудит становится независимой DSH-сущностью.

---

# 13. Directory contract

Минимальный layout:

```text
${DSH_HOME}/audits/
├── session-0ad608a8/
│   ├── analysis.json
│   └── REPORT.md
│
├── session-1d879563/
│   ├── analysis.json
│   └── REPORT.md
│
└── session-2d13b844/
    ├── analysis.json
    └── REPORT.md
```

Имя директории является удобным идентификатором, но **не authoritative session identifier**.

---

# 14. Session ID resolution

Приоритет определения session:

```text
1. analysis.json → trajectory.sessionId
2. exact directory basename
3. unique prefix resolution
```

Authoritative source:

```json
{
  "trajectory": {
    "sessionId": "session-41b4e63f-9e35-4406-927b-25a60b7be2c2"
  }
}
```

Такое поле уже имеется в текущем output аудитора.

Имя:

```text
session-41b4e63f
```

может быть использовано только как fallback.

---

# 15. Prefix resolution rules

Если directory называется:

```text
session-0ad608a8
```

а JSON не содержит sessionId:

найти DSH sessions matching:

```text
session-0ad608a8*
```

Результаты:

```text
0 matches
→ unresolved

1 match
→ resolved

>1 match
→ ambiguous
```

При ambiguity аудит автоматически не прикреплять.

---

# 16. AuditRecord

Runtime registry использует нормализованную запись:

```ts
interface AuditRecord {
  auditId: string

  sessionId: string | null

  sourceDirectory: string

  status:
    | "ready"
    | "pending"
    | "invalid"
    | "unresolved"

  schemaVersion?: number

  fingerprint: string

  summary?: AuditSummary

  reportPath: string
  analysisPath: string

  discoveredAt: string
  modifiedAt: string

  errors: AuditError[]
}
```

---

# 17. AuditSummary

Для быстрых запросов UI:

```ts
interface AuditSummary {
  auditId: string

  sessionId: string

  verdict?: string

  outcomeStatus?: string

  evidenceLevel?: string

  model?: string

  agentPreset?: string

  toolCalls?: number
  toolErrors?: number

  findings: {
    major: number
    minor: number
    observation: number
    other: number
  }

  modifiedAt: string
}
```

Не возвращать полный `analysis.json` при каждом открытии session.

---

# 18. dsh-session-audit server

Server-часть является canonical audit provider.

Структура:

```text
packages/dsh-session-audit/src/server/
├── audit-service.ts
├── audit-scanner.ts
├── audit-watcher.ts
├── audit-registry.ts
├── audit-loader.ts
├── audit-validator.ts
├── audit-fingerprint.ts
├── session-resolver.ts
├── provider.ts
├── api.ts
└── events.ts
```

---

# 19. AuditService

Высокоуровневый coordinator:

```text
AuditService
    │
    ├─ scanner
    ├─ watcher
    ├─ loader
    ├─ validator
    ├─ resolver
    └─ registry
```

Lifecycle:

```text
plugin start
    ↓
initial scan
    ↓
build registry
    ↓
start watcher
    ↓
serve provider/API
```

---

# 20. No database in v1

Filesystem является source of truth.

Registry:

```text
in-memory
```

После restart:

```text
scan auditRoot
    ↓
rebuild registry
```

Не добавлять SQLite/Postgres только ради indexing.

Причины:

```text
audit directories already persistent
registry is derivable
fewer sync problems
easy backup
easy manual operations
```

Database можно добавить позже как optional cache.

---

# 21. Initial scanning

На startup:

```text
read auditRoot
      ↓
enumerate immediate directories
      ↓
check artifacts
      ↓
parse + validate
      ↓
resolve session
      ↓
register
```

Не рекурсивно обходить произвольную filesystem tree.

Разрешён только ожидаемый layout.

---

# 22. Filesystem watcher

Использовать:

```text
startup scan
+
filesystem watcher
+
periodic reconciliation
```

Приоритет:

```text
chokidar
```

или существующая watcher-инфраструктура DSH.

Не полагаться исключительно на `fs.watch`, особенно при:

- Docker bind mounts;
- network filesystem;
- Syncthing;
- remote copy.

---

# 23. Reconciliation

Default:

```text
30 sec
```

Config:

```ts
rescanIntervalMs: 30_000
```

Reconciliation должна быть дешёвой:

```text
directory list
mtime / size / fingerprint metadata
```

Полное чтение всех JSON при каждом цикле не требуется.

---

# 24. Partial-copy safety

Типовой сценарий:

```text
scp -r session-123 server:/audits
```

может сначала создать directory, затем один файл, затем второй.

Watcher должен использовать settle mechanism.

Например:

```text
filesystem event
     ↓
debounce 1000ms
     ↓
check expected files
     ↓
check stable mtime/size
     ↓
parse
```

Default:

```ts
settleMs: 1000
```

---

# 25. Pending audit

Если существует только:

```text
analysis.json
```

или только:

```text
REPORT.md
```

запись может временно иметь:

```text
status = pending
```

Pending audit:

- не показывается пользователю;
- может логироваться debug-level;
- автоматически переоценивается после следующего event.

---

# 26. Fingerprinting

Для каждого готового аудита вычислять fingerprint:

```text
SHA-256(
  analysis.json bytes
  +
  REPORT.md bytes
)
```

Если watcher event пришёл, но fingerprint не изменился:

```text
ignore
```

Если изменился:

```text
reload
validate
update registry
emit audit.updated
```

---

# 27. Recommended writer protocol

`dsh-qa-surface` не должен писать готовый audit directory постепенно.

Рекомендуемый flow:

```text
create:
${auditRoot}/.incoming/<uuid>/

write analysis.json
write REPORT.md

fsync/close

validate locally

atomic rename:
.incoming/<uuid>
        ↓
session-xxxx
```

Если atomic rename невозможен через boundary filesystem, watcher settle logic остаётся fallback.

---

# 28. Duplicate/repeated audits

Внутренне registry желательно сразу проектировать:

```ts
Map<SessionId, AuditRecord[]>
```

даже если MVP фактически использует только один audit.

Active audit:

```text
latest valid audit
```

Но UI истории можно пока не реализовывать.

Это предотвратит архитектурный тупик позже.

---

# 29. SessionAuditProvider

Главный plugin-to-plugin contract:

```ts
interface SessionAuditProvider {
  getSessionAuditSummary(
    sessionId: string
  ): Promise<AuditSummary | null>

  getSessionAudit(
    sessionId: string
  ): Promise<SessionAudit | null>

  listSessionAudits(
    sessionId: string
  ): Promise<AuditSummary[]>

  subscribe(
    listener: (event: AuditRegistryEvent) => void
  ): () => void
}
```

`SessionAudit`:

```ts
interface SessionAudit {
  summary: AuditSummary
  analysis: AuditAnalysis
  report: string
}
```

---

# 30. Plugin-to-plugin integration

Предпочтительно зарегистрировать provider через service registry DSH/Cordis, если механизм позволяет это сделать стабильно:

```text
session-audit.provider
```

Conceptual:

```ts
ctx.provide(
  "session-audit.provider",
  auditProvider
)
```

Consumer:

```ts
const auditProvider =
  ctx.resolve("session-audit.provider")
```

Точный API необходимо адаптировать к реальному Cordis/DSH service mechanism.

---

# 31. HTTP/RPC API

Даже при наличии internal provider необходим API для frontend.

Предлагаемый namespace:

```text
/api/plugins/dsh-session-audit
```

Endpoints:

```text
GET /sessions/:sessionId/summary

GET /sessions/:sessionId/audit

GET /sessions/:sessionId/audits

GET /audits/:auditId/analysis

GET /audits/:auditId/report
```

---

# 32. Lightweight summary endpoint

Ответ:

```json
{
  "available": true,
  "auditId": "audit-f3e452",
  "verdict": "good",
  "outcomeStatus": "completed",
  "evidenceLevel": "rich",

  "findings": {
    "major": 1,
    "minor": 2,
    "observation": 2,
    "other": 0
  },

  "modifiedAt": "2026-09-17T18:31:54Z"
}
```

Этот endpoint должен быть дешёвым.

---

# 33. Lazy loading

При обычном открытии DSH session:

```text
load summary only
```

Не загружать:

```text
REPORT.md
analysis.json
```

пока пользователь не открыл Audit view.

При открытии Audit:

```text
load report
load basic analysis
```

Тяжёлый JSON tree может быть создан только при выборе JSON tab.

---

# 34. Registry events

Поддержать события:

```text
audit.created
audit.updated
audit.deleted
audit.invalid
```

Payload:

```ts
interface AuditRegistryEvent {
  type:
    | "created"
    | "updated"
    | "deleted"
    | "invalid"

  sessionId?: string
  auditId: string

  summary?: AuditSummary
}
```

---

# 35. Frontend realtime updates

Предпочтительно использовать существующий DSH realtime/event mechanism.

Flow:

```text
filesystem
    ↓
AuditRegistry
    ↓
audit.updated
    ↓
client
    ↓
Audit tab / QA Surface refresh
```

Если realtime plugin API недоступен:

fallback:

```text
poll current session summary
every 15–30 seconds
```

Но polling не должен быть primary architecture.

---

# 36. Ordinary DSH UI integration

`dsh-session-audit` добавляет отдельную conversation view:

```text
Audit
```

Расположение:

```text
Chat | Trajectory | Context | Audit
```

Audit tab регистрируется через доступный conversation view extension mechanism.

Никаких DOM hacks native Trajectory для MVP.

---

# 37. Audit tab empty state

Если audit отсутствует:

```text
No audit available for this session
```

В обычном DSH есть два возможных UX.

Preferred:

```text
Audit tab присутствует всегда.
```

Это делает feature predictable.

Альтернатива:

```text
tab появляется только при наличии audit
```

Но динамическое исчезновение conversation view потенциально делает навигацию менее стабильной.

Рекомендация:

> Регистрировать Audit view всегда и использовать empty state.

---

# 38. Audit page layout

Основной layout:

```text
┌──────────────────────────────────────────────────────┐
│ Good · completed · rich                             │
│ 1 major · 2 minor · 2 observations                  │
├──────────────────────────────────────────────────────┤
│ Report | Findings | JSON                            │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│ Verdict      │                                       │
│ Scorecard    │                                       │
│ Findings     │          active content               │
│ Better path  │                                       │
│ Recommend.   │                                       │
│ Limitations  │                                       │
│              │                                       │
└──────────────┴───────────────────────────────────────┘
```

Sidebar является optional на небольших viewport.

---

# 39. Report tab

Источник:

```text
REPORT.md
```

Использовать Markdown/GFM renderer.

Поддержать:

- headings;
- tables;
- lists;
- code;
- inline code;
- blockquotes;
- links;
- anchors.

Current REPORT активно использует таблицы для scorecard и recommended changes, поэтому table rendering является обязательным, а не nice-to-have.

---

# 40. Report navigation

Автоматически строить TOC из Markdown headings.

Например:

```text
Verdict
Evidence sufficiency
Executive summary
Task contract
Scorecard
What went well
Material issues
Tool & skill usage
Better trajectory
Recommended changes
Evidence limitations
```

---

# 41. Findings tab

Использовать только structured JSON.

Пример:

```text
Major

┌──────────────────────────────────────────┐
│ F1 · tool_execution                      │
│                                          │
│ Git-инструменты неработоспособны...      │
│                                          │
│ Root cause: ENVIRONMENT                  │
│ Target: environment                      │
└──────────────────────────────────────────┘
```

Текущая JSON schema уже позволяет построить такой viewer без парсинга Markdown.

---

# 42. Findings filtering

Не обязательно для MVP, но компонент должен позволять позже добавить:

```text
All
Major
Minor
Observation
```

И:

```text
Agent
Environment
Skill
Tool
```

без смены data model.

---

# 43. JSON tab

JSON view состоит из:

```text
[ Tree ] [ Raw ]
```

Tree mode:

- expand/collapse;
- copy key;
- copy value;
- copy JSON path;
- search;
- collapse all;
- expand first level.

Raw mode:

- formatted JSON;
- copy all.

---

# 44. Semantic summary above JSON

До дерева можно показывать:

```text
Session
Model
Agent preset
Tool calls
Tool errors

Verdict
Outcome
Evidence
```

Эти данные уже имеются в текущем analysis.

---

# 45. Optional audit badge in ordinary DSH

Можно дополнительно разместить:

```text
✓ Audited
```

в session header.

Однако это secondary feature.

Основная навигация остаётся через:

```text
Audit tab
```

Badge при click:

```text
select Audit view
```

Если безопасный header extension point неудобен, badge можно отложить без влияния на основную архитектуру.

---

# 46. dsh-qa-surface responsibility

`dsh-qa-surface` выполняет две роли:

```text
producer
+
consumer
```

Producer:

```text
trajectory
    ↓
auditor
    ↓
analysis.json
REPORT.md
    ↓
auditRoot
```

Consumer:

```text
SessionAuditProvider
    ↓
badge/modal
```

---

# 47. dsh-qa-surface must not own registry

После внедрения `dsh-session-audit` удалить/не создавать в QA Surface собственные:

```text
AuditScanner
AuditWatcher
AuditRegistry
SessionResolver
```

Иначе будут существовать две независимые истины.

---

# 48. dsh-qa-surface dependency policy

Рекомендованный вариант:

```text
dsh-session-audit
```

является optional integration dependency всего QA Surface, но required dependency для audit viewer feature.

То есть:

```text
QA Surface core
    works without session-audit

Audit presentation
    requires session-audit provider
```

Если provider отсутствует:

```text
audit generation can continue

audit viewer integration:
unavailable
```

---

# 49. QA Surface UI

Сохраняется первоначальный UX.

Session card/header:

```text
✓ Аудит проведён
```

Дополнительно:

```text
Good
1 major · 2 minor
```

Click:

```text
large modal
```

---

# 50. QA Surface audit modal

Использует те же shared components:

```tsx
<AuditStatusBar compact />

<AuditTabs>
  <AuditReport />
  <AuditFindings />
  <AuditJsonTree />
</AuditTabs>
```

Но shell другой:

```text
Dialog
```

вместо полноценной conversation page.

---

# 51. Different shell, same content

Обычный DSH:

```text
AuditPage
├── AuditStatusBar
├── AuditSidebar
└── AuditTabs
```

QA Surface:

```text
AuditDialog
├── AuditStatusBar compact
└── AuditTabs
```

Не пытаться сделать один layout на оба интерфейса.

Shared должны быть именно semantic/content components.

---

# 52. QA Surface badge behavior

Badge означает:

```text
валидный audit существует
```

а не:

```text
QA passed
```

Поэтому:

```text
✓ Аудит проведён
```

и:

```text
Good
```

должны визуально быть разными сущностями.

---

# 53. Producer workflow in dsh-qa-surface

После завершения audit generation:

```text
auditor generates files
        ↓
validate using dsh-audit-core
        ↓
write temporary directory
        ↓
atomic publish into auditRoot
        ↓
return success
```

QA Surface не вызывает:

```text
registry.add()
```

напрямую.

После publish backend plugin сам обнаруживает новый audit.

---

# 54. Producer independence

`dsh-session-audit` не должен зависеть от `dsh-qa-surface`.

Это критическое правило.

В будущем producer может быть:

```text
dsh-qa-surface
CI pipeline
external evaluator
manual import
another QA plugin
```

и viewer продолжит работать.

---

# 55. Configuration

Пример:

```ts
interface SessionAuditConfig {
  enabled: boolean

  auditRoot: string

  watch: boolean

  watchMode:
    | "auto"
    | "events"
    | "poll"

  settleMs: number

  rescanIntervalMs: number

  allowDirectoryPrefixMatch: boolean

  maxAnalysisBytes: number

  maxReportBytes: number

  exposeHeaderBadge: boolean
}
```

Defaults:

```ts
{
  enabled: true,

  auditRoot: "${DSH_HOME}/audits",

  watch: true,

  watchMode: "auto",

  settleMs: 1000,

  rescanIntervalMs: 30000,

  allowDirectoryPrefixMatch: true,

  maxAnalysisBytes: 10 * 1024 * 1024,

  maxReportBytes: 5 * 1024 * 1024,

  exposeHeaderBadge: true
}
```

---

# 56. Environment variable strategy

Основной path должен базироваться на:

```text
DSH_HOME
```

Default:

```text
${DSH_HOME}/audits
```

Overrides:

```text
DSH_AUDIT_ROOT
```

Если оба заданы:

```text
DSH_AUDIT_ROOT wins
```

---

# 57. Docker

Recommended mount:

```yaml
services:
  dsh:
    volumes:
      - ${DSH_HOME}/audits:/dsh/audits:ro
```

Если QA Surface работает внутри того же container и должен писать в каталог, mount естественно не может быть read-only.

Если auditor вынесен в отдельный container:

```text
audit producer
      │ rw
      ▼
 shared volume
      ▲
      │ ro
dsh-session-audit
```

Это предпочтительная security model.

---

# 58. Validation

Минимум для valid audit:

```text
analysis.json exists
REPORT.md exists
analysis.json parses
schemaVersion exists
trajectory.sessionId resolvable
```

Для schema v1 обязательным semantic minimum считать:

```text
schemaVersion
trajectory
trajectory.sessionId
```

Остальные поля могут отсутствовать.

Viewer обязан graceful-degrade.

---

# 59. Invalid states

Internal codes:

```text
MISSING_ANALYSIS
MISSING_REPORT
INVALID_JSON
INVALID_SCHEMA
SESSION_ID_MISMATCH
SESSION_NOT_FOUND
SESSION_ID_AMBIGUOUS
FILE_TOO_LARGE
READ_FAILED
UNSUPPORTED_SCHEMA
```

---

# 60. Invalid audit visibility

Обычный пользователь session не должен видеть шум вроде:

```text
INVALID_JSON
```

если audit ещё копируется.

Diagnostics должны попадать:

- в plugin logs;
- в optional admin diagnostics;
- позже — в QA Surface admin view.

---

# 61. Cross-file sanity check

Текущий REPORT также указывает audit session ID в начале документа.

Можно делать дополнительный sanity check:

```text
analysis.trajectory.sessionId
            VS
REPORT detected session ID
```

Но REPORT parsing должен быть только validation heuristic.

JSON остаётся authoritative.

---

# 62. Security model

Считать содержимое аудита untrusted.

Это особенно важно, потому что REPORT может быть сгенерирован LLM.

Markdown renderer:

```text
raw HTML disabled
sanitization enabled
unsafe protocols rejected
```

JSON:

```text
render as text
never innerHTML
```

---

# 63. Filesystem security

Frontend не должен иметь endpoint:

```text
/file?path=<user-controlled>
```

Вместо этого:

```text
/audits/:auditId/report
```

Backend получает path исключительно из validated registry entry.

Обязательно:

```text
path containment check
```

относительно configured audit root.

---

# 64. Symlinks

Рекомендация для v1:

```text
не follow symlinks outside auditRoot
```

Можно вообще запретить audit directories/files, которые являются symlink.

Это сильно упрощает containment/security.

---

# 65. File size limits

Необходимо проверять до чтения.

Defaults:

```text
analysis.json ≤ 10 MB
REPORT.md     ≤ 5 MB
```

Конфигурируемо.

---

# 66. Error isolation

Плохой audit не должен:

- ломать plugin startup;
- ломать session view;
- мешать индексации других audits.

Каждый directory обрабатывается независимо.

---

# 67. Compatibility strategy

Учитывая обновляемый DSH:

- backend logic не должна патчить core;
- conversation view подключать через официальный extension mechanism;
- header badge делать только через extension slot;
- любые DSH-specific adapters изолировать.

Структура:

```text
dsh-adapter/
├── conversation-view.ts
├── header.ts
└── events.ts
```

Shared components не должны импортировать internal DSH modules напрямую.

---

# 68. Repository structure

Предлагаемая структура:

```text
packages/
├── dsh-audit-core/
│   └── src/
│       ├── schema/
│       ├── types/
│       ├── parser/
│       ├── validation/
│       └── summary/
│
├── dsh-audit-ui/
│   └── src/
│       ├── components/
│       ├── markdown/
│       ├── json/
│       └── index.ts
│
├── dsh-session-audit/
│   └── src/
│       ├── server/
│       │   ├── audit-service.ts
│       │   ├── audit-scanner.ts
│       │   ├── audit-watcher.ts
│       │   ├── audit-loader.ts
│       │   ├── audit-registry.ts
│       │   ├── session-resolver.ts
│       │   ├── provider.ts
│       │   └── api.ts
│       │
│       ├── web/
│       │   ├── AuditView.tsx
│       │   ├── AuditPage.tsx
│       │   ├── AuditSidebar.tsx
│       │   ├── AuditEmptyState.tsx
│       │   └── useSessionAudit.ts
│       │
│       ├── dsh-adapter/
│       ├── config.ts
│       └── index.ts
│
└── dsh-qa-surface/
    └── src/
        ├── audit-generator/
        └── web/
            └── audit/
                ├── AuditBadge.tsx
                └── AuditDialog.tsx
```

---

# 69. Logging

Namespace:

```text
dsh-session-audit
```

Useful messages:

```text
audit root initialized
initial scan completed
audit discovered
audit updated
audit removed
audit unresolved
audit invalid
watcher fallback activated
```

Избегать dump полного JSON в обычные logs.

---

# 70. Metrics

Не обязательны для MVP, но архитектурно полезно предусмотреть:

```text
audits_total

audits_valid

audits_invalid

audits_unresolved

audit_scan_duration_ms

audit_parse_errors_total

audit_registry_updates_total
```

---

# 71. Tests — dsh-audit-core

Проверить:

```text
schema v1 parsing
unknown fields
missing optional fields
invalid JSON
unknown schemaVersion
finding counting
summary generation
```

Использовать реальные sanitized fixture copies текущего `analysis.json`.

---

# 72. Tests — SessionResolver

Cases:

```text
JSON full session ID
exact directory full ID
unique prefix
ambiguous prefix
unknown session
malformed ID
```

---

# 73. Tests — scanner/watcher

Scenarios:

```text
complete directory appears
analysis first, report later
report first, analysis later
file modified
directory removed
duplicate fs events
partial writes
invalid JSON replaced by valid JSON
```

---

# 74. Tests — security

Обязательно:

```text
../ path traversal
symlink outside auditRoot
script tag in Markdown
javascript: link
very large JSON
malformed UTF-8
malicious JSON strings
```

---

# 75. Tests — UI

Проверить:

```text
Audit tab exists
empty state
loading state
error state
valid report rendering
wide markdown table scrolling
findings rendering
JSON expand/collapse
keyboard navigation
mobile/responsive behavior
```

---

# 76. Tests — QA Surface integration

Given:

```text
dsh-session-audit installed
dsh-qa-surface installed
```

When:

```text
audit generated
```

Then:

```text
filesystem artifact appears
provider detects it
ordinary DSH Audit tab updates
QA Surface badge updates
QA Surface modal shows same audit
```

Оба UI должны отображать один и тот же `auditId`.

---

# 77. Acceptance scenario

Исходная DSH session:

```text
session-41b4e63f-9e35-4406-927b-25a60b7be2c2
```

QA Surface или внешний auditor создаёт:

```text
${DSH_HOME}/audits/session-41b4e63f/
├── analysis.json
└── REPORT.md
```

где JSON содержит:

```text
trajectory.sessionId =
session-41b4e63f-9e35-4406-927b-25a60b7be2c2
```

После atomic publish:

```text
dsh-session-audit detects artifact
```

без restart DSH.

В обычной сессии:

```text
Chat | Trajectory | Context | Audit
```

Audit отображает:

```text
Report
Findings
JSON
```

В QA Surface:

```text
✓ Аудит проведён
```

и click открывает modal с теми же данными.

---

# 78. Implementation phases

## Phase 0 — Research DSH integration points

Перед реализацией подтвердить на актуальной версии DSH:

```text
conversation view registration API

session identifier API

plugin-to-plugin service mechanism

server→client events

header actions slot

web plugin routing/API registration
```

Результат зафиксировать в:

```text
docs/ARCHITECTURE-NOTES.md
```

Не начинать с DOM patch.

---

## Phase 1 — dsh-audit-core

Реализовать:

```text
schema v1
types
validation
parser
summary builder
finding counters
provider interfaces
fixtures/tests
```

Definition of done:

```text
текущий analysis.json успешно парсится
```

---

## Phase 2 — backend registry

Реализовать:

```text
config
scanner
loader
validator
resolver
registry
fingerprinting
startup scan
```

Без watcher на первом шаге допустимо.

---

## Phase 3 — watcher

Добавить:

```text
watch
settle
reconciliation
update/delete events
```

Проверить Docker bind mounts.

---

## Phase 4 — provider + API

Добавить:

```text
SessionAuditProvider
REST/RPC endpoints
summary
analysis
report
```

---

## Phase 5 — shared audit UI

Создать:

```text
StatusBar
Tabs
Report
Findings
JsonTree
EmptyState
```

Не связывать их напрямую с DSH APIs.

---

## Phase 6 — ordinary DSH Audit view

Зарегистрировать:

```text
Audit
```

conversation view.

Добавить:

```text
loading
empty
ready
error
```

states.

---

## Phase 7 — QA Surface integration

QA Surface:

```text
использует provider/API
показывает badge
открывает modal
использует shared audit-ui
```

Не добавлять второй registry.

---

## Phase 8 — QA Surface producer migration

Изменить output pipeline:

```text
generate
validate
write .incoming
atomic publish
```

Target:

```text
${DSH_HOME}/audits
```

---

## Phase 9 — hardening

Добавить:

```text
security checks
size limits
symlink checks
duplicate event handling
event reconnect behavior
logging
metrics
```

---

# 79. MVP boundary

Для первого usable release достаточно:

```text
dsh-audit-core

filesystem audit root

startup scan

watcher

registry

trajectory.sessionId mapping

Audit conversation view

Report tab

Findings tab

JSON tree

QA Surface badge

QA Surface modal

live add/update/delete

sanitized Markdown
```

Не блокировать MVP:

```text
history
diff
global dashboard
annotations
trajectory deep links
metrics dashboard
```

---

# 80. Phase 2 opportunities

После стабильного MVP:

```text
audit history

audit diff

global audit browser

filter sessions by verdict

filter findings by severity

producer metadata

audit generation timestamp

deep links from finding evidence to trajectory seq

export rendered audit

admin invalid-audit diagnostics
```

Особенно полезной следующей функцией будет:

```text
finding evidence seq
      ↓
Open in Trajectory
```

Поскольку текущие findings уже содержат evidence вида `seq:24`, `seq:87` и т.п.

---

# 81. Important architecture invariants

Эти правила желательно прямо занести в `AGENTS.md`/developer docs проекта.

```text
1. Filesystem artifacts are the durable source of truth.

2. dsh-session-audit is the only audit registry owner.

3. dsh-qa-surface never runs its own audit watcher.

4. analysis.json is semantic truth.

5. REPORT.md is human-readable presentation.

6. trajectory.sessionId is authoritative for session binding.

7. Shared UI cannot depend on QA Surface.

8. dsh-session-audit cannot depend on QA Surface.

9. Producers do not call registry APIs after writing artifacts.

10. Unknown future audit fields must not break the viewer.

11. Audit content is untrusted input.

12. Ordinary DSH and QA Surface must display the same audit record.
```

---

# 82. Final dependency graph

```text
                    ┌─────────────────────┐
                    │   dsh-audit-core    │
                    │ schema/types/parser │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
                 ▼             ▼             │
       dsh-session-audit   dsh-audit-ui      │
          backend              │             │
             │                 │             │
             │                 │             │
             └──────┬──────────┘             │
                    │                        │
                    ▼                        │
              Ordinary DSH                   │
                Audit tab                    │
                                             │
                                             ▼
                                      dsh-qa-surface
                                      audit generator
                                           +
                                      badge / modal
```

More precisely, QA Surface presentation uses:

```text
dsh-session-audit provider
        +
dsh-audit-ui
```

while its generator uses:

```text
dsh-audit-core
```

for validation before publishing artifacts.

---

# 83. End-to-end flow

```text
                     dsh-qa-surface
                           │
                     run evaluator
                           │
                           ▼
                    analysis.json
                      REPORT.md
                           │
                    validate via core
                           │
                           ▼
                      .incoming/
                           │
                     atomic rename
                           │
                           ▼
                 ${DSH_HOME}/audits
                           │
                           ▼
                 dsh-session-audit
                  scanner / watcher
                           │
                     parse / validate
                           │
                    resolve session
                           │
                           ▼
                     AuditRegistry
                           │
            ┌──────────────┴───────────────┐
            │                              │
            ▼                              ▼
      Ordinary DSH                  dsh-qa-surface
        Audit tab                      badge
                                        │
                                        ▼
                                     modal
```

---

# 84. Definition of Done

Реализация считается законченной, когда:

1. Plugin можно установить в обычный DSH без `dsh-qa-surface`.

2. В session UI существует отдельная вкладка `Audit`.

3. Копирование готовой audit directory в `${DSH_HOME}/audits` не требует restart.

4. Audit автоматически связывается по `trajectory.sessionId`.

5. Вкладка показывает Report, Findings и JSON.

6. Изменение artifact обновляет UI.

7. Удаление artifact корректно переводит Audit view в empty state.

8. `dsh-qa-surface` использует тот же registry/provider.

9. В QA Surface появляется `✓ Аудит проведён`.

10. QA Surface modal показывает те же данные, что ordinary DSH Audit tab.

11. Между QA Surface и session-audit отсутствует duplicate scanner/watcher.

12. Malformed audit не ломает DSH.

13. Markdown не позволяет выполнять произвольный HTML/JS.

14. Текущий `analysis.json` schemaVersion 1 и существующий `REPORT.md` работают без миграции.

---

# 85. Recommended implementation order

Для coding agent оптимальный порядок:

```text
dsh-audit-core
      ↓
server registry
      ↓
API/provider
      ↓
plain debug endpoint
      ↓
Audit conversation view
      ↓
shared UI extraction
      ↓
watcher/live updates
      ↓
QA Surface integration
      ↓
producer atomic publishing
      ↓
hardening
```

Причина: сначала необходимо доказать правильность lifecycle и binding данных, и только после этого инвестировать в polished UI.

---

# 86. Result

После реализации аудит становится самостоятельным first-class extension поверх DSH sessions:

```text
Session
 ├── Chat
 ├── Trajectory
 ├── Context
 └── Audit
```

`dsh-qa-surface` остаётся специализированным QA workflow, но перестаёт владеть хранением и отображением audit artifacts.

Это даёт одну schema, один registry, один ingestion pipeline и несколько независимых presentation surfaces без дублирования логики.