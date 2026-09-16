# dsh-qa-surface — Admin Console, User Management & Quality Review

## 1. Goal

Добавить в `dsh-qa-surface` полноценный административный контур для:

- управления пользователями;
- назначения пользовательских ролей и QA subroles;
- просмотра QA conversations;
- просмотра сообщений и agent activity;
- сбора user feedback на ответы;
- ручной модерации и оценки диалогов;
- анализа причин плохих ответов;
- поиска recurring quality problems;
- формирования данных для дальнейшего улучшения prompts, skills, tools, knowledge и role policies;
- базовых operational/quality metrics.

Основной пользовательский сценарий:

```text
User asks QA
    ↓
Agent answers
    ↓
User optionally rates answer
    ↓
Feedback is stored against exact message
    ↓
Negative / suspicious conversations appear in Review Queue
    ↓
Admin / Reviewer inspects conversation
    ↓
Reviewer classifies issue
    ↓
Quality dashboard aggregates recurring problems
    ↓
Team changes:
  prompt / role / skill / tool / knowledge / model
    ↓
Future quality can be compared
```

Админка должна быть частью самого `qa-surface`, а не отдельным внешним Grafana-like приложением.

---

# 2. Separation of responsibilities

Следует чётко разделить несколько разных понятий.

## 2.1 Authorization role

Определяет права человека внутри QA Surface:

```text
Admin
Reviewer
User
```

Например:

| Action | Admin | Reviewer | User |
|---|---:|---:|---:|
| Use QA | ✓ | ✓ | ✓ |
| Rate own conversations | ✓ | ✓ | ✓ |
| View own conversations | ✓ | ✓ | ✓ |
| View all conversations | ✓ | ✓ | — |
| Review conversations | ✓ | ✓ | — |
| Manage users | ✓ | — | — |
| Manage roles/subroles | ✓ | — | — |
| Manage capabilities | ✓ | — | — |
| View quality dashboard | ✓ | ✓ | — |
| Change system settings | ✓ | — | — |

---

## 2.2 QA Subrole

Определяет capabilities агента:

```text
Analyst
Sales
Pre-Sales
Developer
...
```

Это отдельная сущность из capability/RBAC specification.

Не следует смешивать:

```text
authorizationRole = admin
```

с:

```text
subrole = developer
```

Admin может пользоваться QA как Analyst и при этом административно иметь доступ ко всей панели управления.

---

## 2.3 Reviewer state

Review является ещё одним отдельным измерением:

```text
unreviewed
in_review
reviewed
needs_followup
```

Это состояние conversation / feedback item, а не пользовательская роль.

---

# 3. Admin navigation

Объединить административные функции под единым route:

```text
/qa/admin
```

Предлагаемая структура:

```text
QA Administration

Overview
Users

Access
 ├─ Subroles
 ├─ Common Capabilities
 └─ Permissions

Conversations
 ├─ All Conversations
 └─ Review Queue

Quality
 ├─ Feedback
 ├─ Issues
 └─ Analytics

Audit

Settings
```

В перспективе:

```text
Evals
Knowledge
Prompts
```

Но в первый релиз их можно не добавлять.

Поверхность QA владеет консолью по префиксу: `/qa/admin` и любой путь под ним —
это консоль, всё остальное — чат. Разделы и сущности живут своими путями под
базой, поэтому поверхность обязана узнавать их все сразу: проверка строгим
равенством базовому пути размонтирует консоль на первом же переходе внутрь неё
и на каждой ссылке, которую ревьюер вставляет в чат.

---

# 4. Admin overview

Главная `/qa/admin` должна отвечать на вопросы:

> Всё ли нормально работает?

> Пользователи довольны ответами?

> Есть ли всплеск плохих ответов?

> Что сейчас требует моего внимания?

Пример:

```text
┌─────────────────────────────────────────────────────────────┐
│ QA Administration                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Active users     Conversations     Positive feedback        │
│     124              1,842                87%                │
│                                                             │
│ Negative          Needs review       Reviewed               │
│    63                  18                45                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Needs attention                                             │
│                                                             │
│ 🔴 8 unresolved negative feedback items                     │
│ 🟡 Developer role has 12% lower satisfaction this week      │
│ 🟡 4 users repeatedly report "missing context"              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Recent feedback                                             │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

Dashboard не должен пытаться стать полной observability-системой.

Технические LLM latency/token/runtime metrics могут позже уходить в OTel/Grafana.

Этот dashboard ориентирован именно на:

```text
users
usage
feedback
quality
review workflow
```

---

# 5. User Management

Route:

```text
/qa/admin/users
```

## 5.1 User list

Таблица:

| User | Status | Authorization | QA Roles | Last Active | Conversations | Feedback |
|---|---|---|---|---|---:|---:|
| Alice | Active | User | Analyst | 5m ago | 82 | 14 |
| Bob | Active | Reviewer | Developer | 1h ago | 41 | 7 |
| Eve | Disabled | User | Sales | 10d ago | 127 | 22 |

Поддержать:

```text
Search
Status filter
Authorization filter
Subrole filter
Last active filter
```

Действия:

```text
Open
Disable
Enable
Edit access
```

Delete пользователя лучше не делать основной операцией.

Предпочтительная семантика:

```text
Active
Disabled
```

чтобы исторические conversations не теряли автора.

---

# 6. User detail page

Route:

```text
/qa/admin/users/:userId
```

Структура:

```text
Alice Smith

[Profile] [Access] [Conversations] [Activity]
```

## Profile

Показывать минимально необходимую информацию:

```text
Name
Username / external subject
Created
Last active
Status
```

Не превращать QA Surface в полноценный Identity Provider.

Если authentication приходит из внешней системы, профиль должен отражать identity, но не пытаться управлять password/auth internals.

---

## Access

```text
Authorization Role
[ User ▼ ]

Available QA Subroles
☑ Analyst
☐ Sales
☑ Pre-Sales
☐ Developer

Default Subrole
[ Analyst ▼ ]
```

Также показывать effective access:

```text
Effective QA capabilities

Analyst
12 tools
6 skills

Pre-Sales
17 tools
9 skills
```

Со ссылкой:

```text
View role policy →
```

---

# 7. User activity

Для администратора полезно видеть basic activity:

```text
Last login
Last QA activity
Conversation count
Message count
Positive ratings
Negative ratings
```

Но не нужно в MVP делать invasive tracking вроде:

```text
every UI click
mouse movement
time spent reading message
```

Это создаёт много шума и privacy burden без явной пользы.

---

# 8. Conversations

Route:

```text
/qa/admin/conversations
```

Это один из центральных экранов новой админки.

## Conversation list

Каждая строка:

```text
Title
User
Subrole
Created
Last Activity
Messages
Feedback
Review status
```

Например:

```text
"Generate Jira release report"

Alice
Analyst

18 messages

👍 2
👎 1

Needs Review
```

---

# 9. Conversation filtering

Поддержать как минимум:

```text
User
Subrole
Date range
Feedback type
Review status
Has negative feedback
Has reviewer issue
```

Search:

```text
Search conversations...
```

По возможности search должен искать:

```text
title
user message text
assistant message text
```

Full-text search может быть отдельной второй итерацией, если storage этого пока удобно не поддерживает.

---

# 10. Conversation viewer

Route:

```text
/qa/admin/conversations/:conversationId
```

Conversation отображается максимально близко к обычному QA UI, но в review-mode.

Пример:

```text
┌──────────────────────────────────────────────────────────────┐
│ Conversation                                                │
│ Alice · Analyst · Sep 15 · 14:32                           │
├─────────────────────────────────────────┬────────────────────┤
│                                         │ Review             │
│ User                                    │                    │
│ Find tickets related to PROJ-123         │ Status             │
│                                         │ Needs review       │
│ Assistant                               │                    │
│ I found...                              │ Issues             │
│                              👍 3 👎 1 │ ☑ Missing context  │
│                                         │ ☐ Wrong answer    │
│ [tool] jira_search                      │ ☐ Tool misuse      │
│ [tool] jira_issue_get                   │                    │
│                                         │ Notes              │
│ User                                    │ [...]              │
│ That's the wrong project                │                    │
│                                         │ [Save Review]      │
└─────────────────────────────────────────┴────────────────────┘
```

---

# 11. Message-level information

Для каждого assistant message review UI должен иметь возможность показать:

```text
message text
timestamp
model
subrole
feedback
tool calls
skills used
```

Опционально:

```text
latency
token usage
provider
```

если эта информация уже присутствует в session metadata.

Не следует дублировать полноценную observability систему специально ради review UI.

---

# 12. Tool calls in conversation viewer

По умолчанию tool calls можно отображать схлопнутыми:

```text
▸ jira_search
▸ jira_issue_get
▸ knowledge_search
```

При раскрытии:

```text
Tool
Arguments
Result preview
Duration
Error
```

Это особенно важно для анализа случаев:

```text
wrong tool
wrong query
tool wasn't used
tool failed
```

Sensitive values должны проходить через существующий или отдельный redaction layer.

---

# 13. Skill visibility

При review сообщения желательно показывать:

```text
Available skills
Used / loaded skills
```

Например:

```text
Skills

✓ jira-analysis
✓ business-analysis
○ proposal-writing
```

Это позволит понять:

> агент ошибся, потому что нужного skill вообще не было?

или:

> skill был доступен, но агент его не использовал?

---

# 14. User feedback

Добавить к каждому assistant message лёгкий feedback UI.

Минимальная версия:

```text
👍   👎
```

Не спрашивать пользователя о причине при каждом лайке.

Positive feedback должен оставаться максимально frictionless:

```text
click 👍 → done
```

---

# 15. Negative feedback flow

При `👎` можно ненавязчиво открыть:

```text
What went wrong?

□ Incorrect answer
□ Didn't follow instructions
□ Missing information
□ Outdated information
□ Tool/action issue
□ Too verbose
□ Too short
□ Other

Optional comment...
```

Кнопки:

```text
Submit
Skip
```

Комментарий и reason должны быть опциональными.

Главное — не снижать количество feedback из-за обязательной анкеты.

---

# 16. Feedback data model

Feedback должен относиться к **конкретному assistant message**.

```ts
interface MessageFeedback {
  id: string

  conversationId: string
  messageId: string

  userId: string

  rating:
    | 'positive'
    | 'negative'

  reasons?: FeedbackReason[]

  comment?: string

  createdAt: string
  updatedAt?: string
}
```

Reasons:

```ts
type FeedbackReason =
  | 'incorrect'
  | 'instruction_not_followed'
  | 'missing_information'
  | 'outdated_information'
  | 'tool_issue'
  | 'too_verbose'
  | 'too_short'
  | 'other'
```

---

# 17. Rating semantics

Не использовать numeric rating `1..5` в первой версии.

`👍 / 👎` имеет несколько преимуществ:

```text
быстрее
понятнее
больше response rate
легче агрегировать
```

Позже можно добавить отдельную detailed evaluation систему для reviewers.

---

# 18. User feedback vs reviewer evaluation

Критически важно не смешивать эти данные.

## User feedback

Отвечает на:

> Пользователю понравился ответ?

```text
👍 / 👎
```

## Reviewer evaluation

Отвечает на:

> Объективно ли ответ соответствует нашим quality criteria?

Это разные сигналы.

Например:

```text
User: 👍

Reviewer:
Accuracy = Fail
Safety = Pass
Tool usage = Pass
```

И наоборот пользователь может поставить 👎 хорошему ответу просто потому, что результат ему не понравился.

---

# 19. Review Queue

Route:

```text
/qa/admin/review
```

Queue автоматически собирает conversations/messages, требующие внимания.

Источники:

```text
negative user feedback
manual "send to review"
tool error
optional quality rule
```

В будущем:

```text
LLM judge
anomaly detector
low-confidence classifier
```

Но не в MVP.

---

# 20. Queue prioritization

Каждый item:

```ts
interface ReviewQueueItem {
  conversationId: string
  messageId?: string

  reason:
    | 'negative_feedback'
    | 'manual'
    | 'tool_failure'
    | 'automatic'

  priority:
    | 'low'
    | 'normal'
    | 'high'

  status:
    | 'unreviewed'
    | 'in_review'
    | 'reviewed'
    | 'needs_followup'

  assignedReviewerId?: string
}
```

UI:

```text
Needs Review

[High] 👎 Incorrect answer
Alice · Analyst
"Generate Jira release report"
15 min ago

[Normal] Tool failure
Bob · Developer
...
```

---

# 21. Review taxonomy

Reviewer должен классифицировать причину проблемы.

Не делать taxonomy слишком мелкой.

Начальная версия:

```text
Answer
 ├─ Incorrect answer
 ├─ Incomplete answer
 ├─ Hallucination
 ├─ Didn't follow request
 ├─ Poor formatting
 └─ Communication/style

Context
 ├─ Missing conversation context
 ├─ Missing knowledge
 └─ Outdated knowledge

Tools
 ├─ Wrong tool selected
 ├─ Tool should have been used
 ├─ Bad tool arguments
 ├─ Tool failure
 └─ Tool unavailable

Skills / Instructions
 ├─ Missing skill
 ├─ Wrong skill
 ├─ Skill not followed
 └─ Prompt/policy issue

Access
 ├─ Missing capability
 └─ Excessive capability

Other
```

---

# 22. Review result

```ts
interface ConversationReview {
  id: string

  conversationId: string
  messageId?: string

  reviewerId: string

  status: 'reviewed' | 'needs_followup'

  issues: QualityIssueType[]

  severity:
    | 'minor'
    | 'major'
    | 'critical'

  notes?: string

  createdAt: string
}
```

---

# 23. Suggested improvement

Reviewer также может указать предполагаемый remediation target:

```text
Prompt
Skill
Tool
Knowledge
Role / Capability
Model
Product UX
User misunderstanding
Unknown
```

Пример:

```text
Issue:
Missing information

Likely root cause:
Knowledge

Suggested action:
Add internal release process documentation to knowledge base.
```

Это очень полезно для превращения review данных в реальные engineering tasks.

---

# 24. Quality Issues

Route:

```text
/qa/admin/quality/issues
```

Отдельный aggregate view:

```text
Missing knowledge                    42
Incorrect answer                     31
Tool should have been used           19
Didn't follow instructions           17
Tool failure                         12
Missing capability                    8
```

Drill-down:

```text
Missing knowledge
    ↓
affected subroles
    ↓
affected users
    ↓
individual conversations
```

---

# 25. Quality dashboard

Route:

```text
/qa/admin/quality
```

Основные показатели:

```text
Feedback rate

Positive feedback rate

Negative feedback rate

Reviewed negative feedback

Issue distribution

Feedback by subrole

Feedback trend over time
```

Например:

```text
Positive rating

Overall       86%
Analyst       91%
Sales         89%
Pre-Sales     84%
Developer     72%
```

Это сразу позволяет заметить role-specific problems.

---

# 26. Metrics semantics

Важно не называть:

```text
positive feedback rate
```

абсолютным:

```text
answer accuracy
```

Лайки — пользовательский сигнал, а не ground truth.

В UI использовать формулировки:

```text
Positive feedback
User satisfaction signal
Reviewer issues
```

А не:

```text
Accuracy: 93%
```

если настоящего eval dataset нет.

---

# 27. Minimum useful metrics

MVP достаточно:

```text
total conversations
active users
assistant messages

rated messages
positive ratings
negative ratings

rating rate
positive rate

unreviewed negatives
reviewed items
```

Breakdown:

```text
by date
by subrole
```

---

# 28. Conversation snapshots

Очень желательно хранить рядом с conversation или message snapshot relevant runtime metadata.

Например:

```ts
interface QaMessageExecutionContext {
  subroleId: string

  model?: string

  effectiveTools?: string[]
  effectiveSkills?: string[]

  loadedSkills?: string[]

  toolCalls?: ToolCallReference[]

  policyVersion?: string
}
```

Почему это важно:

Если Administrator изменит роль Developer завтра, review старого разговора должен отвечать:

> что было доступно агенту тогда?

а не:

> что доступно Developer сейчас?

Иначе исторический анализ станет недостоверным.

---

# 29. Policy versioning

Для capability config желательно добавить revision/version:

```text
policy revision: 42
```

Conversation сохраняет:

```text
subrole: developer
policyRevision: 42
```

Admin viewer показывает:

```text
Developer
Policy revision #42
```

Опционально:

```text
View historical capabilities
```

---

# 30. Model / prompt versioning

По той же причине желательно хотя бы сохранить identifiers:

```text
modelId
promptRevision
skill snapshot identifiers
```

Не обязательно сразу хранить целиком весь system prompt.

Главное — иметь возможность понять:

> плохие ответы появились после prompt revision 13?

---

# 31. Quality trends across revisions

В будущем dashboard сможет показывать:

```text
Developer

Prompt v12
Positive: 71%

Prompt v13
Positive: 83%
```

Или:

```text
before knowledge update
after knowledge update
```

Это уже становится простым production feedback loop без полноценной ML platform.

---

# 32. No automatic learning

В первой версии категорически не делать:

```text
👎
 ↓
automatic prompt mutation
```

или:

```text
review notes
 ↓
automatic skill modification
```

Feedback должен сначала создавать observable data и review signal.

Изменение behaviour остаётся осознанным действием администратора/разработчика.

---

# 33. Feedback details page

Route:

```text
/qa/admin/quality/feedback
```

Таблица:

| Rating | User | Subrole | Conversation | Reason | Date | Review |
|---|---|---|---|---|---|---|
| 👎 | Alice | Analyst | Release report | Incorrect | Today | Open |
| 👍 | Bob | Developer | SQL migration | — | Today | — |

Filters:

```text
👍 / 👎
subrole
user
reason
date
review status
```

Click открывает conversation прямо на соответствующем message.

---

# 34. Deep linking

Обязательно поддержать deep link:

```text
/qa/admin/conversations/:id?message=:messageId
```

При открытии UI автоматически scroll/highlight нужное сообщение.

Это сильно улучшает review workflow.

---

# 35. Conversation privacy

Доступ к чужим conversations должен быть отдельным permission:

```text
conversations.read.all
```

Reviewer получает его.

Обычный пользователь:

```text
conversations.read.own
```

Admin:

```text
conversations.read.all
```

Проверка исключительно backend-side.

---

# 36. Sensitive data

Review console потенциально получает доступ к:

```text
user prompts
tool arguments
tool results
internal knowledge
customer data
```

Поэтому нужна возможность redaction.

Минимальный слой:

```ts
interface QaAdminRedactor {
  redactMessage(...)
  redactToolArgs(...)
  redactToolResult(...)
}
```

Необязательно строить сложный DLP engine.

Но архитектура не должна предполагать, что любой tool result безопасно показывать администратору в raw form.

---

# 37. Deleted / disabled users

При disable пользователя:

```text
login/use QA blocked
historical conversations preserved
feedback preserved
reviews preserved
```

В historical UI:

```text
Alice Smith
Disabled
```

При реально требуемом privacy deletion должна быть отдельная data erasure операция.

Не смешивать:

```text
Disable user
```

и:

```text
Delete all personal data
```

---

# 38. Audit Log

Route:

```text
/qa/admin/audit
```

Audit events:

```text
user.created
user.updated
user.enabled
user.disabled

authorization.changed
subrole.assignment.changed

subrole.created
subrole.updated
subrole.deleted

common_capabilities.updated

conversation.reviewed
review.updated

admin.settings.updated
```

Event:

```ts
interface QaAdminAuditEvent {
  id: string
  timestamp: string

  actorId: string

  action: string

  targetType?: string
  targetId?: string

  before?: unknown
  after?: unknown
}
```

---

# 39. Admin permissions

Не стоит делать только:

```text
isAdmin: true
```

Внутри реализации лучше предусмотреть permissions:

```text
users.read
users.manage

roles.read
roles.manage

conversations.read.all

reviews.read
reviews.write

analytics.read

audit.read

settings.manage
```

Authorization roles уже могут собирать permissions:

```text
Admin
  → *

Reviewer
  → conversations.read.all
  → reviews.read
  → reviews.write
  → analytics.read

User
  → own QA access
```

Это даст возможность позже добавить, например:

```text
Team Lead
Quality Manager
Support Lead
```

без очередного переписывания auth logic.

---

# 40. Backend modules

Предлагаемая структура:

```text
src/
  admin/
    auth/
      permissions.ts
      authorization.ts

    users/
      user-service.ts
      user-repository.ts

    conversations/
      conversation-query.ts
      conversation-view.ts

    feedback/
      feedback-service.ts
      feedback-repository.ts

    review/
      review-service.ts
      review-queue.ts
      quality-taxonomy.ts

    analytics/
      quality-metrics.ts

    audit/
      audit-service.ts

    api/
      routes.ts

  client/
    admin/
      layout/
      overview/
      users/
      conversations/
      feedback/
      review/
      quality/
      audit/
```

---

# 41. API structure

Примерно:

```text
GET    /api/qa/admin/overview

GET    /api/qa/admin/users
GET    /api/qa/admin/users/:id
PATCH  /api/qa/admin/users/:id

GET    /api/qa/admin/conversations
GET    /api/qa/admin/conversations/:id

GET    /api/qa/admin/feedback
POST   /api/qa/messages/:messageId/feedback
PATCH  /api/qa/messages/:messageId/feedback

GET    /api/qa/admin/reviews
POST   /api/qa/admin/reviews
PATCH  /api/qa/admin/reviews/:id

GET    /api/qa/admin/quality/metrics

GET    /api/qa/admin/audit
```

Capability/subrole endpoints могут оставаться в соответствующем отдельном модуле.

---

# 42. Pagination

Users, conversations, feedback и audit обязательно должны быть server-side paginated.

Например:

```text
cursor pagination
```

предпочтительнее загрузки всей истории.

Особенно:

```text
/admin/conversations
/admin/audit
```

не должны загружать всё в browser.

---

# 43. Indexing

Storage должен иметь индексы минимум по:

```text
conversation.userId
conversation.createdAt
conversation.subroleId

message.conversationId

feedback.messageId
feedback.userId
feedback.rating
feedback.createdAt

review.status
review.createdAt
review.assignedReviewerId
```

Иначе админка довольно быстро станет медленной.

---

# 44. Retention

Не hardcode'ить вечное хранение admin analytics.

Предусмотреть configuration:

```yaml
admin:
  conversations:
    retentionDays: 365

  audit:
    retentionDays: 730

  feedback:
    retentionDays: 730
```

Конкретные defaults можно определить отдельно.

Если основной DSH/session storage уже управляет lifecycle conversations, `qa-surface` не должен создавать конфликтующий duplicate retention mechanism.

---

# 45. Quality improvement loop

Главная ценность всей системы должна быть не в наличии красивых графиков, а в явном цикле:

```text
Feedback
    ↓
Review
    ↓
Classification
    ↓
Aggregation
    ↓
Root cause
    ↓
Change
    ↓
Compare
```

Пример:

```text
24 negative reviews
    ↓
18 tagged "missing knowledge"
    ↓
14 relate to deployment process
    ↓
add deployment docs to knowledge
    ↓
monitor subsequent feedback
```

Или:

```text
Developer positive feedback = 68%
    ↓
9 reviews: "tool should have been used"
    ↓
git/Jira skill adjusted
    ↓
positive feedback after change = 81%
```

---

# 46. Future: Quality actions

В более поздней версии review issue можно конвертировать в internal improvement item:

```text
Create Improvement
```

Например:

```text
Title:
Developer agent doesn't use jira_search for ticket references

Source:
12 conversations

Target:
Skill

Status:
Open
```

Получится небольшой backlog качества прямо внутри QA Surface.

Но это **не MVP**.

---

# 47. Future: Evals

После накопления reviewed conversations можно добавить:

```text
/qa/admin/evals
```

Reviewed examples могут становиться кандидатами в regression eval dataset:

```text
Good example
Bad example
Expected behaviour
```

Тогда перед изменением:

```text
prompt
skill
model
tool policy
```

можно запускать offline eval.

Но reviewed production conversations нельзя автоматически считать идеальными test cases — reviewer должен явно отметить:

```text
Add to regression set
```

---

# 48. Future: LLM-assisted review

В будущем можно использовать отдельную дешёвую модель для:

```text
suggest issue category
summarize conversation
detect possible hallucination
suggest root cause
```

Но результат должен быть маркирован как:

```text
AI suggestion
```

а не как reviewer truth.

---

# 49. Future: Team scopes

Если QA Surface станет multi-team:

```text
Sales
Engineering
Support
```

можно добавить:

```text
Organization
Team
```

и permissions:

```text
conversations.read.team
users.manage.team
analytics.read.team
```

Но сейчас не нужно тащить полноценную organization hierarchy, если реальной потребности ещё нет.

---

# 50. UI design principles

Админка должна выглядеть как отдельный polished product surface.

Основные принципы:

```text
dense, но не перегруженная
table + filters для больших списков
cards для summary
side panel для review
deep links
keyboard-friendly navigation
clear status badges
```

Не превращать всё в бесконечные modal windows.

Для сущностей с отдельной идентичностью использовать routes:

```text
/users/:id
/conversations/:id
```

а modal/drawer — для быстрых действий.

---

# 51. Admin visual language

Пример sidebar:

```text
QA Admin

⌂ Overview

Users
👥 Users

Access
◈ Subroles
◉ Common Capabilities

Quality
💬 Conversations
✓ Review Queue
♡ Feedback
▥ Analytics

System
◷ Audit
⚙ Settings
```

Количество визуальных украшений держать умеренным.

Главное — чтобы при открытии было понятно:

```text
где пользователи
где права
где разговоры
где проблемы качества
```

---

# 52. MVP

Первая рабочая версия должна включать:

### Users

- user list;
- active/disabled state;
- authorization role;
- QA subrole assignments;
- default QA subrole.

### Conversations

- global conversation list;
- filters;
- conversation viewer;
- user/subrole metadata;
- assistant/user messages;
- collapsed tool calls.

### Feedback

- 👍 / 👎 на assistant messages;
- optional negative reason;
- optional text comment.

### Review

- negative feedback review queue;
- issue taxonomy;
- reviewer notes;
- severity;
- reviewed/unreviewed status.

### Quality

- positive/negative feedback counts;
- rating rate;
- breakdown by subrole;
- issue distribution;
- time trend.

### Administration

- backend permission checks;
- audit log.

---

# 53. Second iteration

Следом можно добавить:

```text
reviewer assignments
quality alerts
historical policy snapshots
prompt/model revision comparison
advanced conversation search
CSV/JSON export
improvement backlog
```

---

# 54. Third iteration

После накопления данных:

```text
regression eval sets
LLM-assisted review
before/after quality comparison
automatic anomaly detection
team scopes
quality release gates
```

---

# 55. Non-goals

В этой специи намеренно не строим:

```text
full CRM
full identity provider
password management
SIEM
full observability backend
full data warehouse
automatic model fine-tuning
automatic prompt mutation
automatic skill mutation
employee surveillance
```

---

# 56. Acceptance criteria

Система считается готовой для первого релиза, если:

- Admin может увидеть список пользователей.
- Admin может disable/enable пользователя.
- Admin может назначить authorization role.
- Admin может назначить доступные QA subroles.
- Reviewer/Admin может открыть список всех QA conversations.
- Обычный пользователь не может получить чужую conversation через API.
- Conversation можно отфильтровать минимум по user, subrole, date и feedback.
- Conversation viewer показывает сообщения в правильном порядке.
- Assistant message может получить 👍 или 👎.
- Feedback хранится относительно конкретного message.
- При 👎 пользователь может необязательно выбрать причину и оставить комментарий.
- Negative feedback появляется в Review Queue.
- Reviewer может классифицировать проблему.
- Reviewer может добавить notes и severity.
- Review можно отметить завершённым.
- Dashboard показывает feedback metrics.
- Metrics можно разбить по subrole.
- Admin actions пишутся в audit.
- Authorization проверяется backend-side.
- Disabled пользователь сохраняется как автор исторических conversations.
- Изменение/удаление role config не уничтожает исторические conversations или feedback.
- Нельзя автоматически изменять prompts/skills/tools на основании пользовательского 👎.

---

# 57. Recommended implementation order

```text
1. Authorization permissions
2. User management
3. Conversation query API
4. Conversation viewer
5. Message feedback
6. Review Queue
7. Review taxonomy
8. Quality aggregations
9. Overview dashboard
10. Audit
11. Historical runtime metadata
12. Advanced analytics / eval foundation
```

Так можно получить полезную админку уже примерно после шагов 1–6, не ожидая реализации всей analytics части.

---

# 58. Resulting QA Surface architecture

После обеих спецификаций общая картина становится примерно такой:

```text
                    dsh-qa-surface

┌─────────────────────────────────────────────────────┐
│                    User Surface                     │
│                                                     │
│  QA Chat ── Feedback ── Role Selector               │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│                   Access Layer                      │
│                                                     │
│ Authorization ─ Subroles ─ Capability Policies     │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│                    QA Runtime                       │
│                                                     │
│ Agent ─ Tools ─ Skills ─ Knowledge ─ Models        │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│                  Quality Layer                      │
│                                                     │
│ Conversations                                      │
│ Feedback                                           │
│ Reviews                                            │
│ Quality Issues                                     │
│ Metrics                                            │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│                   Admin Console                     │
│                                                     │
│ Users                                              │
│ Access                                             │
│ Conversations                                      │
│ Review Queue                                       │
│ Quality Analytics                                  │
│ Audit                                              │
└─────────────────────────────────────────────────────┘
```

В итоге `dsh-qa-surface` перестаёт быть просто альтернативным chat UI и становится контролируемой enterprise-style QA оболочкой над DSH, при этом execution и agent runtime остаются на стороне самого Harness.
