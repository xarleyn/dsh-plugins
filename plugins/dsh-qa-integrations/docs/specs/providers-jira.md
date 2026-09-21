# SPEC: `providers/jira`

## Status

Draft.

## Goal

Реализовать provider `jira` для общего multi-tenant слоя интеграций `qa-surface` / `qa-integration-broker`.

Provider должен позволять агентам DeepSeek Harness безопасно работать с Jira от имени текущего пользователя `qa-surface`, не раскрывая OAuth credentials агенту, браузеру после завершения OAuth flow, другим пользователям системы или другим DSH-сессиям.

Основной сценарий MVP — безопасное чтение задач Jira и поиск по ним. Изменяющие операции добавляются позднее через policy + explicit confirmation.

---

## Context

`qa-surface` уже имеет собственных пользователей. Эта identity является корневым security principal.

DSH session должна быть server-side привязана к одному `qa-surface user_id`.

Provider не должен принимать `userId`, `credentialId`, `cloudId` или иной идентификатор владельца credentials из model-facing tool arguments.

Связка должна выглядеть так:

```text
qa-surface user
    │
    ├── owns DSH session
    │
    ▼
dsh-user-integrations
    │ resolve principal from trusted session context
    ▼
qa-integration-broker
    │ resolve user's Atlassian account + Jira capability
    ▼
providers/jira
    │ inject decrypted OAuth token server-side
    ▼
Atlassian Jira Cloud API
```

---

## Shared Atlassian account model

Jira и Confluence не должны иметь независимые OAuth credentials для одного и того же Atlassian account.

Нужно выделить общий provider/account layer:

```text
providers/
  atlassian/
    auth/
    oauth/
    credential-store/
    accessible-resources/
  jira/
  confluence/
```

`providers/jira` использует credential типа `atlassian_oauth`.

Пример:

```text
integration_accounts
--------------------
id
principal_id
provider_family = "atlassian"
external_account_id
display_name
status

integration_resources
---------------------
id
account_id
resource_type = "atlassian_site"
cloud_id
site_url
site_name

integration_capabilities
------------------------
resource_id
provider = "jira"
enabled
granted_scopes
policy

integration_credentials
-----------------------
account_id
credential_type = "oauth2"
ciphertext
nonce
key_version
expires_at
updated_at
```

Один `integration_account` может иметь:

```text
Atlassian account
  ├── Site A / Jira
  ├── Site A / Confluence
  ├── Site B / Jira
  └── Site B / Confluence
```

### Important

Atlassian `cloudId` сам по себе не должен рассматриваться как глобально уникальный provider discriminator.

При выборе resource учитывать как минимум:

```text
account_id
cloud_id
provider capability
site URL / accessible-resource metadata
```

---

## Authentication

Использовать OAuth 2.0 Authorization Code / 3LO.

Не использовать API tokens как основной способ подключения.

Не просить пользователя создавать собственное Atlassian OAuth app.

Должно существовать одно управляемое OAuth application для `qa-surface`.

OAuth flow:

```text
GET /api/me/integrations/atlassian/connect
    ↓
generate state + PKCE where applicable
    ↓
redirect Atlassian consent
    ↓
GET /api/integrations/atlassian/callback
    ↓
validate state
    ↓
exchange code
    ↓
GET /oauth/token/accessible-resources
    ↓
persist account/resources/capabilities
    ↓
encrypt access + refresh token
```

Запрашивать `offline_access`, чтобы получить refresh token.

Atlassian использует rotating refresh tokens. После успешного refresh старый refresh token необходимо атомарно заменить новым.

### Refresh concurrency

Нельзя допускать параллельный refresh одного credential без координации.

Нужен per-credential lock:

```text
refresh_lock(account_id)
```

Возможные реализации:

- DB advisory lock;
- Redis distributed lock;
- compare-and-swap по credential version.

После refresh:

```text
BEGIN
  verify credential_version
  replace access_token
  replace refresh_token
  update expires_at
  increment version
COMMIT
```

Если refresh вернул `invalid_grant`, credential переводится в:

```text
status = reauth_required
```

Без fallback на другой account.

---

## OAuth scopes

Для MVP использовать минимально необходимый read-only scope set.

Предпочитать Atlassian classic scopes там, где это соответствует официальным рекомендациям и покрывает нужные endpoints.

Базовый кандидат для Jira read-only:

```text
read:jira-work
read:jira-user
offline_access
```

Фактический список scopes должен быть зафиксирован по реально используемым endpoints перед реализацией релиза.

Write scopes не запрашивать, пока write actions не включены feature flag'ом.

Для write stage возможен:

```text
write:jira-work
```

Но scope сам по себе не разрешает действие: effective permissions всегда являются пересечением Atlassian permissions, granted OAuth scopes и локальной policy.

---

## API base

Для OAuth 2.0 3LO использовать:

```text
https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
```

Не строить вызовы к `https://{site}.atlassian.net` для 3LO как основной runtime path.

Перед использованием resource проверять его присутствие в `accessible-resources`.

---

## MVP feature set

### Read-only

MVP должен поддерживать:

- поиск issues;
- получение issue по key/id;
- получение основных полей issue;
- получение comments;
- получение attachments metadata;
- получение доступных transitions без выполнения transition;
- получение project metadata в объёме, необходимом для поиска/отображения;
- получение field metadata для нормализации custom fields;
- получение current user / account identity;
- построение human-readable permalink на Jira issue.

### Deferred

Не включать в MVP:

- создание issue;
- редактирование issue;
- assignment;
- comments write;
- transitions;
- delete;
- attachment upload;
- project administration;
- workflow administration;
- raw REST proxy;
- arbitrary JQL supplied моделью без ограничений.

---

## Tool surface

Model-facing tools должны быть provider-specific и узкими.

Рекомендуемый MVP:

```text
jira_search_issues
jira_get_issue
jira_get_issue_comments
jira_get_issue_attachments
jira_get_available_transitions
jira_get_project
```

Позже:

```text
jira_prepare_add_comment
jira_prepare_update_issue
jira_prepare_transition_issue
jira_prepare_assign_issue
jira_prepare_create_issue
```

Не создавать:

```text
jira_rest_call
jira_request
jira_execute_jql_raw
```

### Tool: `jira_search_issues`

Input:

```ts
{
  query?: string
  projectKeys?: string[]
  statuses?: string[]
  assignee?: "me" | string
  reporter?: "me" | string
  labels?: string[]
  updatedAfter?: string
  createdAfter?: string
  limit?: number
  cursor?: string
}
```

Tool не принимает `principalId`, `accountId`, `cloudId` или token.

`query` — natural-language-ish search string / text fragment, а не raw JQL.

Provider сам строит безопасный JQL.

Опционально позднее можно добавить отдельный advanced tool с JQL, но только после sanitizer/validator layer.

### Tool: `jira_get_issue`

Input:

```ts
{
  issueKey: string
  include?: [
    "description",
    "comments_summary",
    "attachments",
    "relations",
    "changelog_summary"
  ]
}
```

Output должен быть нормализован и не возвращать весь raw Jira payload.

---

## JQL policy

JQL является мощным query language и требует отдельной policy.

### MVP

Model не получает raw JQL execution tool.

Provider строит JQL из typed filters.

Пример:

```text
project in ("ABC","PROJ")
AND status in ("Open","In Progress")
AND updated >= "2026-09-01"
AND text ~ "\"payment timeout\""
ORDER BY updated DESC
```

Все values должны экранироваться builder'ом.

### Future advanced mode

Если нужен raw JQL:

1. отдельный tool `jira_search_jql`;
2. только read-only;
3. validation через Jira JQL parse API;
4. запрет/лимит слишком широких запросов;
5. hard result limit;
6. timeout;
7. audit original + normalized JQL;
8. никогда не принимать `accountId/cloudId` через JQL tool args.

---

## Issue fields

Jira heavily relies on custom fields.

Provider должен иметь field resolver:

```text
field id -> {
  id,
  key?,
  name,
  schema,
  type,
  custom
}
```

Cache scope:

```text
principal_id + cloud_id + jira
```

Не использовать глобальный cache field mappings между Atlassian sites.

### Normalized issue

Пример внутренней модели:

```ts
type JiraIssue = {
  id: string
  key: string
  url: string
  project: {
    id: string
    key: string
    name: string
  }
  issueType?: {
    id: string
    name: string
  }
  summary: string
  descriptionText?: string
  status?: {
    id: string
    name: string
    category?: string
  }
  priority?: {
    id?: string
    name?: string
  }
  assignee?: {
    accountId: string
    displayName: string
  }
  reporter?: {
    accountId: string
    displayName: string
  }
  labels: string[]
  createdAt?: string
  updatedAt?: string
  dueAt?: string
  parent?: {
    id: string
    key: string
    summary?: string
  }
  customFields?: Record<string, unknown>
}
```

---

## Atlassian Document Format

Jira descriptions/comments могут использовать Atlassian Document Format.

Provider должен иметь отдельный converter:

```text
ADF -> normalized text
ADF -> safe markdown-like representation
```

MVP не должен отдавать модели необработанный ADF JSON, если достаточно текста.

Сохранять структурные элементы:

- paragraphs;
- headings;
- bullet/ordered lists;
- code blocks;
- links;
- mentions;
- tables;
- inline code.

Не разрешать embedded remote content автоматически загружать внешние URLs.

---

## Attachments

MVP:

- list attachment metadata;
- filename;
- MIME;
- size;
- author;
- createdAt;
- Jira attachment id.

Не скачивать attachment content автоматически при каждом `jira_get_issue`.

Отдельный будущий tool:

```text
jira_get_attachment
```

должен:

- проверять principal;
- заново проверять issue visibility;
- иметь max byte limit;
- allowlist MIME/categories;
- поддерживать temporary blob;
- не класть контент в cross-user cache.

---

## Permissions

Effective permission:

```text
qa principal
∩ integration account ownership
∩ selected Atlassian resource
∩ OAuth scopes
∩ Jira user permissions
∩ qa integration policy
∩ tool action policy
```

Отсутствие любого слоя = deny.

Никаких default credentials.

Никакого fallback на admin/service account.

---

## Multi-site behavior

Один Atlassian user может иметь доступ к нескольким sites.

UI должен позволять выбрать один или несколько Jira resources.

Пример:

```text
Integrations
└── Atlassian
    ├── company-a.atlassian.net
    │   ├── Jira     enabled
    │   └── Confluence enabled
    └── sandbox.atlassian.net
        ├── Jira     disabled
        └── Confluence enabled
```

### Tool resource selection

Если у principal включён ровно один Jira resource:

```text
auto-select
```

Если несколько:

- предпочтительно использовать server-side integration preference bound to workspace/project;
- иначе tool может принимать `siteAlias`, но только из заранее разрешённого набора;
- model не должна передавать raw `cloudId`.

---

## Workspace binding

Полезно разрешить bind:

```text
qa workspace/project
    -> Atlassian resource
    -> optional Jira project allowlist
```

Пример:

```yaml
workspaceIntegration:
  provider: jira
  site: company
  projectAllowlist:
    - PROJ
    - PLATFORM
```

Это дополнительное сужение доступа, а не расширение.

Если Jira user имеет доступ к 20 projects, но workspace policy разрешает 2, агент видит только эти 2 через provider.

---

## Caching

Любой cache key должен включать security namespace.

Минимум:

```text
principal_id
account_id
cloud_id
provider
```

Пример:

```text
jira:{principal}:{account}:{cloudId}:issue:PROJ-123
```

Запрещено:

```text
jira:issue:PROJ-123
```

для user-specific data.

### Suggested TTL

- field metadata: 15-60 min;
- project metadata: 5-15 min;
- issue reads: 30-120 sec;
- search results: 15-60 sec;
- permissions-sensitive negative result: короткий TTL.

При write action инвалидировать affected cache entries.

---

## Search result limits

Нужны hard limits независимо от model args.

Пример:

```yaml
jira:
  search:
    defaultLimit: 20
    maxLimit: 100
    maxPagesPerToolCall: 3
    timeoutMs: 15000
```

Tool result должен возвращать pagination cursor, а не пытаться вычитать всю Jira.

---

## Write operations

Write stage вводится отдельно.

Рекомендованная policy:

```text
read issue              auto
search issues           auto
read comments           auto

add comment             confirm
edit issue              confirm
transition issue        confirm
assign issue            confirm
create issue            confirm

delete issue            deny
project admin           deny
workflow admin          deny
raw REST                deny
```

### Two-phase write

Agent вызывает:

```text
jira_prepare_add_comment(...)
```

Broker создаёт:

```text
pending_action
```

со snapshot:

```json
{
  "provider": "jira",
  "resource": "company",
  "issueKey": "PROJ-123",
  "action": "add_comment",
  "payload": {
    "body": "..."
  }
}
```

Browser текущего authenticated пользователя подтверждает action.

На confirm backend обязан заново проверить:

- owner pending action;
- expiry;
- principal/session relationship;
- Jira resource ownership;
- scope;
- current Jira permission where possible;
- optimistic preconditions.

Только потом выполнить API call.

---

## Audit

Каждый provider call пишет security-aware audit record.

Не логировать:

- Authorization headers;
- access tokens;
- refresh tokens;
- OAuth codes;
- raw encrypted credential blobs.

Логировать:

```text
timestamp
principal_id
session_id
provider = jira
account_id
cloud_id / safe resource id
operation
issue key / project key where applicable
result = success|denied|error
latency
http status
policy decision
pending_action_id
```

Query text можно логировать только с configurable redaction.

---

## Error normalization

Provider возвращает стабильные ошибки:

```text
JIRA_NOT_CONNECTED
JIRA_REAUTH_REQUIRED
JIRA_RESOURCE_NOT_ENABLED
JIRA_PERMISSION_DENIED
JIRA_NOT_FOUND
JIRA_RATE_LIMITED
JIRA_INVALID_QUERY
JIRA_CONFLICT
JIRA_UPSTREAM_ERROR
JIRA_TIMEOUT
```

Model не должна видеть raw stack trace.

При `401`:

1. попытаться refresh один раз;
2. retry safe/idempotent read один раз;
3. если снова 401 — `reauth_required`.

При `403` не пытаться обходить permission через другой credential.

При `429` учитывать `Retry-After`, не делать aggressive retry внутри одного tool call.

---

## Rate limiting

Нужно два уровня:

```text
per-principal/provider
per-upstream-account/resource
```

Дополнительно global circuit breaker для Atlassian.

Не позволять одному QA user исчерпать общий concurrency.

---

## DSH integration

Рекомендуемая схема:

```text
DSH tool
  -> ToolExecution
  -> trusted session id
  -> principal resolver
  -> jira policy
  -> broker.call(principal, "jira", operation)
```

Tool arguments не содержат identity.

### Subagents

MVP:

```text
jira tools disabled for unbound child sessions
```

Future:

- child может только наследовать principal от parent;
- inheritance должна быть explicit server-side;
- child не может выбрать другой principal/account/resource.

---

## UI

`qa-surface`:

```text
Settings
└── Integrations
    └── Atlassian
        └── company.atlassian.net
            └── Jira
                Status: Connected
                User: Ivan Ivanov
                Projects: PROJ, PLATFORM, ...
                Permissions:
                  [x] Search/read issues
                  [x] Read comments
                  [ ] Allow agent write actions
```

В UI не показывать tokens.

Допустимые действия:

```text
Connect
Reconnect
Disable Jira capability
Disconnect Atlassian account
Select site
Configure workspace project allowlist
```

---

## Configuration

Пример broker config:

```yaml
providers:
  jira:
    enabled: true

    search:
      defaultLimit: 20
      maxLimit: 100
      timeoutMs: 15000

    cache:
      issueTtlSeconds: 60
      projectTtlSeconds: 600
      fieldTtlSeconds: 1800

    writes:
      enabled: false
      requireConfirmation: true

    attachments:
      enabled: false
      maxBytes: 10485760
```

Shared Atlassian:

```yaml
providers:
  atlassian:
    oauth:
      clientId: ${ATLASSIAN_CLIENT_ID}
      clientSecret: ${ATLASSIAN_CLIENT_SECRET}
      redirectUri: ${ATLASSIAN_REDIRECT_URI}

    credentialStore:
      backend: encrypted-db
      masterKeyFile: /run/secrets/qa_integrations_master_key
```

---

## Suggested repository structure

```text
providers/
  atlassian/
    src/
      auth/
        oauth.ts
        callback.ts
        refresh.ts
        state.ts
      accessible-resources.ts
      credentials.ts
      types.ts

  jira/
    SPEC.md
    src/
      index.ts
      provider.ts
      client.ts
      errors.ts
      policy.ts

      api/
        issues.ts
        search.ts
        comments.ts
        projects.ts
        fields.ts
        attachments.ts
        transitions.ts

      search/
        filters.ts
        jql-builder.ts
        jql-escape.ts

      normalize/
        issue.ts
        comment.ts
        user.ts
        adf.ts

      tools/
        search-issues.ts
        get-issue.ts
        get-comments.ts
        get-attachments.ts
        get-transitions.ts

      writes/
        pending-actions.ts
        add-comment.ts
        update-issue.ts
        transition.ts

    test/
      auth-isolation.test.ts
      cross-user.test.ts
      jql-builder.test.ts
      permissions.test.ts
      refresh-race.test.ts
      cache-isolation.test.ts
      tools.test.ts
```

---

## Security tests

Обязательные test cases:

### Alice/Bob isolation

```text
Alice QA -> Jira Alice
Bob QA   -> Jira Bob
```

Проверить:

- Alice не может запросить account Bob;
- подмена session id не даёт чужой credential;
- подмена pending action id не работает;
- cache Alice не читается Bob;
- resource selection не позволяет указать чужой site;
- search results всегда соответствуют current principal.

### Credential tests

- token никогда не попадает в tool result;
- token никогда не попадает в logs;
- encrypted DB dump не содержит plaintext token;
- refresh token rotation атомарна;
- concurrent refresh не теряет новый refresh token;
- revoke переводит capability в disconnected/reauth state.

### Jira permission tests

- issue-level security respected;
- restricted comments не обходятся;
- project allowlist сужает выдачу;
- 403 не вызывает fallback на service credential.

### Injection tests

- malicious issue content не может изменить provider identity;
- issue description с инструкциями агенту остаётся untrusted content;
- JQL values экранируются;
- model не может внедрить `OR project = SECRET` через text filter.

---

## Observability

OTel spans:

```text
integration.jira.search
integration.jira.issue.get
integration.jira.comments.get
integration.atlassian.token.refresh
```

Attributes:

```text
provider=jira
operation
principal_hash
resource_hash
http.status_code
result
cache_hit
```

Не класть issue body, comments или tokens в span attributes.

Metrics:

```text
jira_requests_total
jira_request_duration_seconds
jira_rate_limited_total
jira_auth_refresh_total
jira_auth_refresh_failed_total
jira_policy_denied_total
jira_cache_hits_total
```

---

## Compatibility

Первая версия ориентирована на Jira Cloud.

Jira Data Center / Server не должна молча считаться совместимой.

Если понадобится Data Center, сделать отдельный auth/client strategy:

```text
jira-cloud
jira-data-center
```

не смешивая API tokens/basic auth с Cloud OAuth 3LO в одном code path.

---

## Non-goals

- Jira admin console automation.
- Workflow/schema administration.
- Arbitrary REST proxy.
- Shared service account для всех QA users.
- Cross-user indexing.
- Автоматическая запись без confirmation policy.
- Полное зеркалирование Jira в локальную БД в MVP.
- Использование Jira как identity provider для qa-surface.

---

## Acceptance criteria

MVP считается готовым, если:

1. QA user может подключить Atlassian account через OAuth.
2. Broker получает и сохраняет доступные Jira resources.
3. Credentials encrypted at rest.
4. DSH tool определяет principal только из trusted session context.
5. Пользователь может искать issues в разрешённых Jira projects.
6. Пользователь может получить issue/comments.
7. Jira permissions пользователя соблюдаются upstream.
8. Alice/Bob isolation тесты проходят.
9. Raw token не появляется в browser API, model context, logs или tool results.
10. Нет raw REST tool.
11. Нет write operations без отдельного feature stage.
12. Refresh token rotation корректно переживает concurrency.

---

## Future work

- JSM provider поверх того же Atlassian account.
- semantic index per principal/resource;
- issue changelog summaries;
- Jira Software boards/sprints;
- safe attachment retrieval;
- create/update/transition через pending actions;
- workspace-to-project bindings UI;
- webhook-based cache invalidation;
- per-user notification subscriptions.

---

## Official references

- OAuth 2.0 (3LO): https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/
- OAuth API calls and cloudId: https://developer.atlassian.com/cloud/oauth/getting-started/making-calls-to-api/
- Jira REST API v3: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro
- Jira issue search/JQL: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
- Jira comments: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/
- Jira transitions: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- Jira attachments: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/
