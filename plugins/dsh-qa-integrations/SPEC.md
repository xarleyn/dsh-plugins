# SPEC / PLAN: User Integrations & Secure Credentials for `qa-surface`

Status: Phases 1–2 implemented (read-only Bitrix24 catalog); phases 3+ pending
Primary use case: per-user Bitrix24 access from DSH agents
Designed to be reusable for Jira, Confluence, GitLab, generic MCP and other user-scoped integrations.

---

## 1. Summary

Add a new **`Интеграции` / `Integrations`** page to the existing user Settings UI in `qa-surface`, next to pages such as Profile, General and Skills.

The page lets each authenticated user connect their own external services (initially Bitrix24) using OAuth or a manually supplied secret/token. Credentials are stored server-side, encrypted, never returned to the browser after saving, never exposed to the LLM, and never shared across users.

DSH tools resolve the effective user from the authenticated QA session on the server. The model is not allowed to pass `userId`, `credentialId`, another user's integration id, or a raw token to a tool.

The intended trust chain is:

```text
Browser
  │ authenticated qa-surface session
  ▼
qa-surface
  │ user/session ownership
  ▼
DSH integration tool proxy
  │ resolve principal from DSH session
  ▼
Integration Broker
  │ select this user's integration + decrypt credential
  ▼
Provider adapter (Bitrix24)
  │ user-scoped API/MCP call
  ▼
Bitrix24
```

The first release should be **read-only**. Write operations are added later with explicit user confirmation.

---

## 2. Naming decision

### User-facing Settings tab

Use **`Интеграции`** (`Integrations`).

Do not call the top-level page `Credentials`, `Tokens`, `Secrets` or `API Keys` because:

- OAuth connections are not meaningfully presented to a user as credentials;
- some integrations may use tokens, others OAuth, service bindings or MCP authorization;
- the page should describe what the user connects, not how authentication is technically stored;
- `Интеграции` scales naturally when Bitrix24 is followed by Jira, Confluence, GitLab, etc.

Possible secondary labels inside the page:

- `Подключения` / `Connections` — list of configured services;
- `Доступ` / `Permissions` — what the agent may do;
- `Авторизация` / `Authentication` — only inside an integration details page.

### Suggested package/component names

Preferred generic names:

- DSH plugin: `dsh-qa-integrations`
- reusable core package: `@yadsh/integrations-core`
- Bitrix provider: `@yadsh/integration-bitrix24`
- optional isolated service: `qa-integration-broker`

Avoid naming the whole subsystem `dsh-bitrix24`; Bitrix24 should be the first provider, not the architecture.

---

## 3. UX

The new page should be a normal Settings page, not a nested modal.

Suggested left navigation:

```text
Настройки

┌──────────────┬────────────────────────────────────────────────────┐
│ Профиль      │ Интеграции                                        │
│ Общие        │                                                    │
│ Навыки       │ Подключённые                                      │
│ Интеграции ● │                                                    │
│              │ ┌──────────────────────────────────────────────┐   │
│              │ │ Bitrix24                              ●      │   │
│              │ │ company.bitrix24.ru                         │   │
│              │ │ Подключено как Иван Иванов                  │   │
│              │ │                                              │   │
│              │ │ Чтение CRM                    Разрешено      │   │
│              │ │ Чтение чатов                  Разрешено      │   │
│              │ │ Отправка сообщений            Запрещено      │   │
│              │ │ Изменение CRM                  Запрещено      │   │
│              │ │                                              │   │
│              │ │ [Проверить] [Настроить] [Отключить]         │   │
│              │ └──────────────────────────────────────────────┘   │
│              │                                                    │
│              │ Доступные интеграции                               │
│              │ [ + Bitrix24 ]     [ Jira — позже ]               │
└──────────────┴────────────────────────────────────────────────────┘
```

### Integration detail view

Can be an inline Settings route such as:

```text
/settings/integrations/bitrix24
```

It should show:

- connection status;
- external portal/tenant;
- external account display name;
- last successful check;
- granted capabilities;
- local agent policy (`allow`, `confirm`, `deny`);
- reconnect/rotate credential;
- disconnect.

Do not display the saved token again.

### Manual token UX

If a provider/auth mode needs a manually supplied token:

```text
Токен подключения
[ ••••••••••••••••••••••••••••• ]

Токен будет храниться в зашифрованном виде и после сохранения
не отображается повторно.

[Сохранить и проверить]
```

After saving, replace the input with:

```text
Токен: настроен
Обновлён: 14.09.2026 21:40
[Заменить токен]
```

There must be no `show token` / `copy existing token` action.

---

## 4. Goals

1. Give each authenticated `qa-surface` user their own integrations.
2. Ensure one user cannot discover, read, use or mutate another user's credentials/integration state.
3. Ensure LLM prompts/tool arguments cannot select a different user's credentials.
4. Keep secrets out of browser storage, DSH session logs, agent prompts, tool traces and telemetry.
5. Support both OAuth and manual-token providers.
6. Make provider permissions explicit and configurable.
7. Provide a safe path for write actions through confirmation.
8. Make the architecture reusable beyond Bitrix24.
9. Keep the solution update-friendly and avoid modifying DSH core.
10. Preserve the current Settings UX pattern: one page per area, no unnecessary nested modal chain.

---

## 5. Non-goals for MVP

- Shared/team-wide credentials.
- Admin impersonation of user integrations.
- Generic arbitrary REST execution by the model.
- Generic arbitrary MCP server configuration by ordinary users.
- Bitrix24 write operations.
- Cross-user caches/deduplication of private provider data.
- Automatic import of provider content into global memory/knowledge bases.
- Giving subagents automatic access to parent credentials.
- Secret recovery/display after initial entry.

The data model may be future-proofed for these features, but they must not silently exist in MVP.

---

## 6. Core security rule

**The model never chooses the principal.**

A tool must not accept any of these fields from the LLM:

```text
userId
ownerUserId
qaUserId
credentialId
secretId
accessToken
refreshToken
mcpBearerToken
integrationOwner
```

The current principal is resolved exclusively from trusted server-side session state.

Correct flow:

```text
ToolExecution
  -> DSH session id
  -> qa-surface session ownership mapping
  -> authenticated qa user id
  -> user's integration record
  -> user's secret reference
```

Forbidden flow:

```text
LLM args
  -> userId=42
  -> credentialId=abc
  -> call provider
```

---

## 7. Trust boundaries

### Boundary A: Browser -> qa-surface

The browser is untrusted except for its authenticated session.

Requirements:

- use existing authenticated `qa-surface` user identity;
- authorization must be checked on every integration endpoint;
- do not trust `userId` supplied in query/body;
- all user API routes should be effectively `/api/me/...` semantics;
- protect state-changing routes against CSRF according to the application's auth mechanism;
- never put provider access/refresh tokens in `localStorage` or `sessionStorage`.

### Boundary B: qa-surface -> DSH session

Each DSH session exposed through QA must have an immutable owner binding.

Conceptual table:

```text
qa_session_principals
---------------------
dsh_session_id       PK
owner_user_id        NOT NULL
created_at
revoked_at           nullable
```

Rules:

- binding is created server-side when the QA chat/session is created;
- the browser does not choose `owner_user_id`;
- ownership cannot be changed by normal user APIs;
- restoring/opening a session requires `owner_user_id == authenticated user`;
- knowing another DSH session id must not grant access to it.

If equivalent ownership already exists in `qa-surface`, reuse it rather than duplicating state.

### Boundary C: DSH tool -> integration broker

DSH may know the current session id, but it should not receive decrypted provider secrets.

Preferred API shape:

```text
callIntegration({
  principal,
  provider: "bitrix24",
  operation: "chat.search",
  input
})
```

`principal` is produced server-side, not taken from model args.

### Boundary D: integration broker -> provider

Only the provider adapter gets a short-lived decrypted credential in memory.

It must:

- fetch only the current principal's integration;
- decrypt immediately before use;
- avoid retaining plaintext longer than necessary;
- redact secrets from errors/logs;
- handle refresh/rotation atomically.

---

## 8. Recommended architecture

### Preferred deployment

Use a small **`qa-integration-broker`** service on the internal Docker network.

```text
┌────────────────────┐
│ qa-surface / DSH   │
│                    │
│ Settings UI        │
│ DSH tools          │
└─────────┬──────────┘
          │ internal authenticated API
          ▼
┌────────────────────────────┐
│ qa-integration-broker      │
│                            │
│ principal authorization    │
│ credential vault           │
│ OAuth callbacks            │
│ policy                     │
│ audit                      │
│ provider adapters          │
└───────────┬────────────────┘
            │
            ├── Bitrix24 REST/OAuth
            ├── Bitrix24 MCP (optional backend)
            ├── Jira (future)
            └── ...
```

Benefits:

- DSH process does not need direct access to provider master encryption keys;
- credentials and provider networking have their own lifecycle;
- easier audit/redaction boundary;
- easier to add Vault/KMS later;
- provider integrations stay reusable even if QA/DSH internals change.

### Acceptable MVP shortcut

For a first implementation, the broker may run in-process as an internal module of the QA plugin **if** the interfaces are kept separate:

```ts
interface IntegrationBroker {
  listForPrincipal(principal: Principal): Promise<IntegrationSummary[]>
  call(principal: Principal, request: IntegrationCall): Promise<unknown>
  connect(...): Promise<void>
  disconnect(...): Promise<void>
}
```

This allows extraction into a separate service later without changing tool/UI semantics.

---

## 9. Provider abstraction

Define a generic provider contract.

Example:

```ts
interface IntegrationProvider {
  id: string
  displayName: string
  authModes: AuthMode[]

  getCapabilities(): ProviderCapability[]

  connect(ctx: ConnectContext): Promise<ConnectionResult>
  validate(ctx: ProviderContext): Promise<ValidationResult>
  disconnect(ctx: ProviderContext): Promise<void>

  execute(
    ctx: ProviderContext,
    operation: string,
    input: unknown,
  ): Promise<unknown>
}
```

Provider context should contain the already-resolved principal and secret material. It must not contain user-controlled owner identity.

---

## 10. Data model

### `user_integrations`

```text
id                    UUID PK
owner_user_id         FK -> qa user
provider              string, e.g. bitrix24
auth_kind             oauth | token | mcp_token
status                pending | connected | error | revoked
external_tenant_id    nullable string
external_user_id      nullable string
display_name          nullable string
display_metadata_json JSON
capabilities_json     JSON
secret_ref            nullable UUID
created_at
updated_at
last_validated_at
last_error_code       nullable string
```

MVP policy: one active Bitrix24 integration per QA user.

Schema should not prevent future multi-account support. If needed later, add/use a unique key like:

```text
(owner_user_id, provider, account_alias)
```

instead of globally assuming one integration forever.

### `integration_secrets`

```text
id                    UUID PK
ciphertext            bytes
nonce                 bytes
auth_tag              bytes / part of AEAD payload
wrapped_dek           bytes
key_version           integer
secret_type           oauth | token | mcp_token
expires_at            nullable timestamp
created_at
updated_at
```

No owner lookup should be performed directly through secret id from user-facing APIs. Access should always flow from the authorized integration record.

### `integration_policies`

```text
integration_id        FK
operation             string
mode                  allow | confirm | deny
updated_at
PRIMARY KEY(integration_id, operation)
```

### `integration_audit_log`

```text
id
owner_user_id
integration_id
provider
operation
result                 success | denied | error
source_session_id
source_agent_id         nullable
request_summary_json    redacted
response_summary_json   redacted
created_at
```

Do not store raw chat bodies/CRM payloads in audit logs by default. Prefer metadata such as operation, resource type/id and result.

---

## 11. Secret storage

### Required properties

- encryption at rest;
- AEAD authenticated encryption;
- unique random nonce per encryption;
- key rotation support;
- no plaintext secret in DB;
- no secret in logs;
- no secret returned by read APIs;
- no secret in DSH config files/session files;
- no secret in browser persistent storage.

### Suggested implementation

Use envelope encryption:

```text
per-record random DEK
        │
        ├── encrypt provider secret with AES-256-GCM
        │
        └── wrap DEK with master key

DB stores:
  ciphertext
  nonce
  wrapped DEK
  key_version
```

MVP master-key source:

```text
/run/secrets/qa_integrations_master_key
```

Do not store this master key in the application database or git repository.

Define a backend interface so the same code can later use Vault/KMS:

```ts
interface KeyProvider {
  wrapKey(rawDek: Uint8Array): Promise<WrappedKey>
  unwrapKey(wrapped: WrappedKey): Promise<Uint8Array>
}
```

Backends:

```text
DockerSecretKeyProvider     MVP
VaultTransitKeyProvider     future
AwsKmsKeyProvider           future
```

---

## 12. OAuth support

OAuth should be the preferred UX when a provider supports it.

Flow:

```text
User -> Settings -> Integrations -> Bitrix24 -> Connect
  -> server creates short-lived OAuth state bound to owner_user_id
  -> redirect to provider
  -> provider callback
  -> server validates state
  -> exchange code server-side
  -> encrypt credentials
  -> fetch provider identity/tenant metadata
  -> mark integration connected
  -> redirect back to /settings/integrations/bitrix24
```

Requirements:

- OAuth `state` must be high-entropy, single-use and short-lived;
- bind state to current QA user and provider;
- use PKCE where applicable/supported;
- callback must not accept a user id from the browser as authoritative;
- handle token refresh server-side;
- use a per-integration refresh mutex/transaction to prevent refresh races;
- revoke provider credential on disconnect when possible;
- always delete local secret on disconnect even if remote revoke fails.

---

## 13. Manual token support

Manual token mode is a fallback for providers that do not fit the OAuth flow or for a Bitrix MCP connection token.

API behavior:

```text
PUT /api/me/integrations/bitrix24/credential
```

Input may contain a plaintext token once over TLS.

Server must:

1. validate current QA user;
2. validate token format minimally;
3. optionally perform `test connection`;
4. encrypt token;
5. replace the existing encrypted secret atomically;
6. discard plaintext;
7. return only metadata/status.

Never provide an API that reads the stored secret back.

---

## 14. User-facing API

Prefer `/api/me/...` routes so owner identity cannot be supplied as a parameter.

Suggested endpoints:

```text
GET    /api/me/integrations
GET    /api/me/integrations/providers
GET    /api/me/integrations/:provider
POST   /api/me/integrations/:provider/connect
PUT    /api/me/integrations/:provider/credential
POST   /api/me/integrations/:provider/test
PATCH  /api/me/integrations/:provider/policy
DELETE /api/me/integrations/:provider
```

OAuth callback may be provider-specific:

```text
GET /api/integrations/bitrix24/oauth/callback
```

It resolves the QA user from signed server-side OAuth state, not query-supplied user identity.

### Response rules

Allowed:

```json
{
  "provider": "bitrix24",
  "status": "connected",
  "portal": "company.bitrix24.ru",
  "displayName": "Ivan Ivanov",
  "credentialConfigured": true,
  "capabilities": ["crm.read", "chat.read"]
}
```

Forbidden:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "encryptedSecret": "...",
  "secretRef": "..."
}
```

Internal ids should only be returned if the UI genuinely needs them; prefer provider-keyed `/api/me` routes for MVP.

---

## 15. DSH integration

Register stable DSH tools through `dsh-qa-integrations`.

MVP Bitrix tool set (read-only, implemented):

```text
# CRM
bitrix_search_crm                 # crm.item.list
bitrix_get_crm_item               # crm.item.get
bitrix_get_crm_fields             # crm.item.fields
bitrix_get_crm_funnels            # crm.category.list
bitrix_get_crm_statuses           # crm.status.list
bitrix_get_crm_activities         # crm.activity.list
bitrix_get_crm_activity           # crm.activity.get
bitrix_get_crm_timeline           # crm.timeline.comment.list
bitrix_get_crm_stage_history      # crm.stagehistory.list
bitrix_get_crm_product_rows       # crm.item.productrow.list
bitrix_find_crm_duplicates        # crm.duplicate.findbycomm

# Employees and company structure
bitrix_get_current_user           # user.current
bitrix_search_users               # user.get (NAME_SEARCH / EMAIL / UF_DEPARTMENT)
bitrix_get_departments            # department.get

# Chats and open lines
bitrix_search_chats               # im.search.chat.list
bitrix_get_chat_messages          # im.dialog.messages.get
bitrix_search_chat_messages       # im.dialog.messages.search
bitrix_get_recent_chats           # im.recent.get
bitrix_search_chat_users          # im.search.user.list
bitrix_get_openline_dialog        # imopenlines.dialog.get
bitrix_get_openline_history       # imopenlines.session.history.get

# Tasks, calendar, drive
bitrix_search_tasks               # tasks.task.list
bitrix_get_task                   # tasks.task.get
bitrix_get_calendar_events        # calendar.event.get
bitrix_get_calendar_accessibility # calendar.accessibility.get
bitrix_search_files               # disk.file.search
bitrix_get_file                   # disk.file.get
```

Two Bitrix24 docs ambiguities are resolved deliberately and must stay resolved
unless someone can test against a live portal:

- `user.search` is not called. Its parameter table wants `FIND` inside
  `FILTER`, every example puts filter keys at the top level, and a silently
  ignored filter would answer with the wrong page. `user.get` with
  `FILTER.NAME_SEARCH` is documented in one shape and gives the same search.
- `tasks.task.list` is called at the classic address, not REST 3.0. REST 3.0
  moved to `/rest/api/...` and documents "в REST 3.0 для задач поддержана
  фильтрация по полю id", which cannot express "my open tasks".

List operations answer with `{ items, pagination: { start, next, total } }`
regardless of the shape Bitrix uses (`result.items`, `result.tasks`, a bare
array, `result.productRows`), and id-keyed bundles (open-line history, calendar
accessibility) are projected into ordered arrays.

Possible later write tools:

```text
bitrix_prepare_chat_message
bitrix_prepare_crm_update
```

Avoid model-facing generic tools such as:

```text
bitrix_rest_call(method, params)
bitrix_call_mcp_tool(toolName, arbitraryArgs)
```

Those bypass the permission surface and make auditing/policy significantly harder.

### Principal resolution

Conceptual executor:

```ts
async function executeBitrixTool(input, exec) {
  const dshSessionId = exec.agent?.session?.header?.id
  if (!dshSessionId) throw new AccessDenied('QA principal required')

  const principal = await principalResolver.byDshSession(dshSessionId)
  if (!principal) throw new AccessDenied('Session is not bound to a QA user')

  return integrationBroker.call(principal, {
    provider: 'bitrix24',
    operation: 'chat.search',
    input,
    sourceSessionId: dshSessionId,
  })
}
```

There must be no fallback principal.

Forbidden:

```ts
principal ?? DEFAULT_USER
principal ?? ADMIN_USER
credential ?? GLOBAL_BITRIX_TOKEN
```

---

## 16. Bitrix24 provider

Bitrix24 is the first provider but should use the same generic integration framework.

### Auth modes to support

Phase 1 priority:

1. OAuth — preferred when the deployment/app registration permits it.
2. User-supplied Bitrix/MCP token — fallback.

### Backend strategy

Keep the provider implementation flexible enough to support either:

```text
A. Bitrix REST/OAuth adapter
B. Official/compatible Bitrix MCP behind the broker
```

The agent should not care which transport is used.

Example:

```text
bitrix_search_chats(...)
        │
        ▼
BitrixProvider.execute('chat.search')
        │
        ├── REST adapter
        └── MCP adapter
```

This allows using official MCP capabilities where convenient while filling missing chat/CRM operations with direct REST without changing agent tool names.

### Capability model

Implemented read capabilities, one per Bitrix24 webhook scope:

```text
crm.read        <- crm
chat.read       <- im
openlines.read  <- imopenlines
user.read       <- user_brief | user_basic | user
department.read <- department
tasks.read      <- task
calendar.read   <- calendar
disk.read       <- disk
```

A capability is offered only when the operator switch is on AND the connected
webhook reports the scope (`scope` method, read on connect and on every
connection test). Granting a new scope in Bitrix24 therefore shows up as a
detected-but-disabled capability that the user enables themselves.

Later:

```text
chat.send
crm.comment
crm.update
crm.stage.change
```

Explicitly keep out of normal user-agent policy:

```text
admin.*
user.manage
delete.*
raw_rest
raw_mcp
```

---

## 17. Permission policy

Provider capability and local AI permission are separate concepts.

Effective permission is the intersection of:

```text
provider credential/scopes
    ∩ external service user's own permissions
    ∩ qa-surface integration policy
    ∩ tool-specific safety policy
```

Suggested default policy:

```text
crm.read             allow
chat.read            allow
openlines.read       allow
user.read            allow
department.read      allow
tasks.read           allow
calendar.read        allow
disk.read            allow
chat.send            deny        # MVP
crm.comment          deny        # MVP
crm.update           deny        # MVP
crm.stage.change     deny        # MVP
delete.*             deny
admin.*              deny
raw_rest             deny
raw_mcp              deny
```

Phase 2:

```text
chat.send            confirm
crm.comment          confirm
crm.update           confirm
crm.stage.change     confirm
```

---

## 18. Confirmation flow for write actions

Do not let the model directly execute sensitive writes in the first write-enabled release.

Use two-phase execution:

```text
LLM tool call
  -> prepare action
  -> persist pending action bound to owner + session
  -> show confirmation card in qa-surface
  -> authenticated user confirms
  -> backend re-validates owner + policy + action freshness
  -> execute provider call
```

Example pending action:

```text
Отправить сообщение в Bitrix24?

Получатель: Иван Иванов
Чат: Поддержка / MDC-123

"Исправление уже готово, выкатим сегодня."

[Отправить] [Отмена]
```

`pending_action` should include a server-generated immutable payload hash so the text/resource cannot change between preview and confirmation.

Suggested expiration: 5–15 minutes.

---

## 19. Cache and data isolation

All caches containing provider data must be principal-scoped.

Bad:

```text
crm:item:123
chat:456:messages
```

Good:

```text
bitrix:{owner_user_id}:{external_tenant_id}:crm:item:123
bitrix:{owner_user_id}:{external_tenant_id}:chat:456:messages
```

This requirement applies to:

- in-memory cache;
- Redis;
- DB cache;
- result blobs;
- embeddings/vector stores;
- semantic search indexes;
- MCP result cache;
- tool-result deduplication;
- generated summaries.

For MVP, prefer no persistent cache over a cache whose isolation is uncertain.

Do not automatically place Bitrix content in global/project-wide memory or knowledge storage.

---

## 20. Session and chat isolation

Integration security is meaningless if users can open each other's QA/DSH sessions.

Required invariants:

```text
authenticated user U1
  may list/open/continue only sessions owned by U1

U1 + guessed sessionId owned by U2
  -> 404 or 403

DSH tool in session S(U1)
  -> can resolve only principal U1
```

Prefer `404` for ordinary cross-user resource lookups if revealing existence is unnecessary.

---

## 21. Subagents/background execution

Subagents are a special security case because they may have a different DSH session identity.

### MVP

Bitrix/user-integration tools are available only to the root QA-owned agent/session.

If no direct QA principal mapping exists:

```text
AccessDenied
```

### Future

Allow explicit server-side delegation:

```text
root session U1
  -> creates child session
  -> server records child -> U1 inheritance
```

Rules:

- a child may inherit the parent's principal;
- a child cannot choose/change the principal;
- delegation must be revocable with the root session;
- write permissions may be stricter for children;
- background/cron jobs need a separately designed service-principal/delegation model.

No `default user` behavior.

---

## 22. Logs, telemetry and redaction

Secrets must never appear in:

- application logs;
- DSH tool call logs;
- OpenTelemetry attributes/events;
- exception messages;
- browser error telemetry;
- audit request/response bodies;
- session transcript;
- prompt context.

Implement a central redaction layer for known fields:

```text
access_token
refresh_token
token
authorization
api_key
secret
credential
mcp_bearer
```

Also redact bearer-like strings in provider HTTP headers.

Do not log full upstream request headers.

Operational telemetry may include:

```text
provider=bitrix24
operation=chat.search
status=success
latency_ms=...
owner_hash=...      # optional non-reversible metric label, avoid high cardinality
```

Avoid raw user ids as high-cardinality metrics labels.

---

## 23. Error handling

User-facing errors should be safe and actionable.

Examples:

```text
IntegrationNotConnected
CredentialExpired
CredentialRevoked
ProviderPermissionDenied
ProviderUnavailable
OperationDeniedByPolicy
UserConfirmationRequired
PrincipalNotResolved
```

Do not return raw upstream error objects if they may contain request headers or secrets.

For expired OAuth credentials:

- attempt safe refresh once;
- if refresh fails, mark integration `error`/`revoked`;
- ask user to reconnect.

For manual token failure:

- never show token;
- mark connection unhealthy;
- offer `Replace token`.

---

## 24. Internal service authentication

If `qa-integration-broker` is a separate container:

- expose it only on the private Docker network;
- do not publish its port publicly unless there is a concrete need;
- authenticate DSH/qa-surface -> broker calls;
- use a dedicated service secret or mTLS;
- do not accept browser bearer tokens directly on the internal execution API.

Separate API surfaces conceptually:

```text
Browser API:
  authenticated qa user
  /api/me/integrations/...

Internal execution API:
  authenticated service
  principal supplied in signed/internal context
  /internal/integrations/execute
```

The browser must not be able to call `/internal/...` directly.

---

## 25. Database authorization / defense in depth

Application-level owner checks are mandatory.

If PostgreSQL is used, optional additional defense:

- Row Level Security for user-facing integration queries;
- unique constraints preventing duplicate active connections where unwanted;
- foreign keys from policies/audit/integration records;
- separate DB role for migration vs runtime.

Do not treat RLS as a replacement for application authorization; use it as defense in depth.

---

## 26. UI permission details

An integration card should clearly distinguish:

```text
Provider access
  Bitrix account has CRM/chat permissions

Agent access
  Agent may read CRM
  Agent may read chats
  Agent must ask before sending
```

Avoid presenting technical OAuth scopes unless the user opens an advanced details section.

Recommended controls:

```text
[✓] Читать CRM
[✓] Читать чаты
[ ] Отправлять сообщения       Ask every time
[ ] Изменять CRM               Ask every time
```

For MVP, write toggles may simply be disabled with `Coming later`.

---

## 27. Data sent to the LLM

Provider data read by an agent will normally enter model context.

The Settings page should include a concise disclosure such as:

```text
Данные, которые агент читает через интеграцию, могут передаваться
настроенному для этого чата LLM-провайдеру для выполнения запроса.
```

Do not imply that encrypted-at-rest credentials prevent provider content from reaching the configured LLM; these are different concerns.

Future policy may allow admins to restrict which LLM providers can be used with sensitive integrations.

---

## 28. Threat model / abuse cases

The implementation must explicitly test these cases.

### Alice tries Bob's integration id

Expected: denied regardless of guessed UUID.

### Alice guesses Bob's DSH session id

Expected: cannot open/continue/list it; tools cannot resolve Bob as principal.

### Prompt injection says "use Bob's credentials"

Expected: impossible because owner identity is not a tool argument.

### Model invents `credentialId`

Expected: schema has no such field; ignored/not accepted.

### DB dump is leaked

Expected: provider credentials are ciphertext; master key is outside DB.

### App logs are leaked

Expected: no raw token or Authorization header is present.

### OAuth callback replay

Expected: state is single-use and expired after first successful/failed terminal processing.

### Global cache collision

Expected: cache key contains principal/tenant namespace or cache is disabled.

### Subagent invokes Bitrix tool

Expected MVP: denied unless explicitly delegated.

### User disconnects while an action is pending

Expected: confirmation execution re-checks integration status and fails closed.

### User permission changes in Bitrix

Expected: upstream denial is respected; no local privilege bypass.

---

## 29. Bitrix24 MVP user stories

### Connect

> As a QA user, I can open Settings -> Integrations -> Bitrix24 and connect my own Bitrix account without exposing its credentials to other users or to the LLM.

### Read CRM

> As a connected user, I can ask the agent to find/read CRM items that my own Bitrix account is allowed to access.

### Read chats

> As a connected user, I can ask the agent to search/read chats available to my own Bitrix identity, subject to the provider capabilities actually exposed by the selected Bitrix adapter.

### Isolation

> As Alice, I cannot access Bob's Bitrix connection, even if I know Bob's QA id, DSH session id, integration UUID or Bitrix resource id.

### Disconnect

> I can disconnect Bitrix24; the local secret is removed and future tool calls fail as not connected.

---

## 30. Phased implementation plan

### Phase 0 — Security prerequisite: QA session ownership

Before provider work:

- verify existing QA user -> DSH session ownership model;
- add/fix immutable server-side owner binding if missing;
- protect list/open/continue/delete session routes;
- add Alice/Bob cross-session tests.

Deliverable: a DSH session has one trustworthy QA principal.

### Phase 1 — Generic Integrations Settings + secret vault

Implement:

- `Интеграции` Settings page;
- provider registry;
- `user_integrations` persistence;
- encrypted `SecretStore`;
- Docker secret master key;
- manual-token connect/replace/disconnect;
- connection test;
- log redaction;
- audit skeleton.

No DSH provider tools yet is acceptable at the beginning of this phase.

### Phase 2 — Bitrix24 read-only provider

Implement:

- Bitrix adapter;
- OAuth if feasible in current deployment;
- manual token/MCP token fallback;
- `crm.read` and `chat.read` capabilities;
- stable DSH tools;
- principal resolution from DSH QA session;
- no persistent cross-user cache;
- tool-level audit.

### Phase 3 — Write confirmation framework

Implement generic pending actions:

- action preview;
- immutable payload hash;
- owner/session binding;
- expiration;
- confirm/cancel UI;
- server-side revalidation;
- `confirm` policy mode.

Then add narrowly scoped Bitrix writes.

### Phase 4 — Generic MCP/provider expansion

After Bitrix is stable:

- reusable principal-scoped MCP transport/provider;
- Jira/Confluence/etc.;
- provider-specific OAuth adapters;
- optionally multiple accounts per provider.

### Phase 5 — Hardening/operations

- Vault/KMS backend;
- key rotation tooling;
- rate limits/quotas;
- richer audit viewer;
- OTel dashboards;
- admin health/status without secret access;
- explicit delegated access for subagents/background jobs.

---

## 31. Suggested repository structure

If kept in the existing monorepo:

```text
packages/
  dsh-qa-surface/
    src/
      settings/
        integrations/
          IntegrationsPage.*
          IntegrationDetails.*
      auth/
      session-ownership/

  dsh-qa-integrations/
    src/
      tools/
      principal-resolver/
      broker-client/
      policy/

  integrations-core/
    src/
      provider.ts
      models.ts
      secret-store.ts
      policy.ts
      audit.ts
      errors.ts

  integration-bitrix24/
    src/
      provider.ts
      auth/
      rest/
      mcp/
      operations/

services/
  qa-integration-broker/
    src/
      api/
      oauth/
      providers/
      secrets/
      audit/
    Dockerfile
```

If a separate service is premature, keep `integrations-core` and provider interfaces clean, but run the implementation in-process initially.

---

## 32. Configuration

Example conceptual config:

```yaml
qaIntegrations:
  enabled: true

  secretStore:
    backend: docker-secret
    masterKeyPath: /run/secrets/qa_integrations_master_key

  providers:
    bitrix24:
      enabled: true
      authModes:
        - oauth
        - token

      capabilities:
        crmRead: true
        chatRead: true
        chatSend: false
        crmWrite: false
```

Secrets themselves must not be configured here.

For a separate broker:

```yaml
qaIntegrations:
  broker:
    baseUrl: http://qa-integration-broker:8080
    serviceAuthSecretFile: /run/secrets/qa_integration_broker_service_token
```

---

## 33. Migration/update strategy

- do not patch DSH core;
- register tools/plugins through supported extension points;
- keep DB migrations versioned;
- keep provider schemas backwards-compatible where possible;
- never require users to re-enter secrets during ordinary application updates;
- changing encryption master key must use an explicit rotation/re-encryption process;
- provider-specific changes must not require changing the QA session ownership model.

---

## 34. Testing plan

### Unit tests

- encrypt/decrypt secret;
- wrong key fails authentication;
- key rotation;
- redaction;
- policy intersection;
- provider capability mapping;
- OAuth state single-use/expiry;
- pending-action payload hash.

### API authorization tests

Create Alice and Bob.

Verify Alice cannot:

- read Bob's integration;
- replace Bob's token;
- test Bob's connection;
- disconnect Bob;
- change Bob's policy;
- confirm Bob's pending action;
- open Bob's QA/DSH session.

Repeat with:

- guessed UUID;
- valid Bob integration id;
- valid Bob session id;
- malformed ownership parameters;
- omitted owner fields.

### DSH tool tests

- root QA session resolves correct owner;
- unowned session fails closed;
- another user's session cannot be supplied as a tool argument;
- model-visible schema contains no credential/user selection fields;
- subagent is denied in MVP;
- disconnected integration fails cleanly;
- provider permission denied is propagated safely.

### Leakage tests

Snapshot/scan:

- app logs;
- HTTP logs;
- OTel traces;
- DSH tool traces;
- QA transcripts;
- API JSON responses.

Assert that seeded fake secrets never appear.

### E2E isolation test

Use two simultaneous browser contexts:

```text
Alice browser -> QA Alice -> Bitrix credential A
Bob browser   -> QA Bob   -> Bitrix credential B
```

Run interleaved tool calls under load and verify every upstream request uses only the expected credential/principal.

This test should be treated as release-blocking.

---

## 35. Acceptance criteria for MVP

The MVP is ready when all of the following are true:

1. Settings has a first-class `Интеграции` page.
2. Alice and Bob can independently configure Bitrix24.
3. No API lets Alice read or mutate Bob's integration.
4. Stored credentials are encrypted at rest.
5. The application never returns an existing secret to the UI.
6. No raw secret appears in DSH/model context/logs/telemetry.
7. A Bitrix DSH tool derives the current user from server-side QA session ownership.
8. Tool schemas contain no `userId`/`credentialId`/token selection arguments.
9. Unknown/unowned/subagent sessions fail closed.
10. Bitrix CRM/chat read calls run with the correct per-user identity.
11. Provider data caches are user/tenant scoped or disabled.
12. Bitrix writes are unavailable in MVP.
13. Alice/Bob E2E isolation test passes under concurrent execution.
14. Disconnecting an integration immediately prevents future provider calls.

---

## 36. Decisions to keep unless implementation evidence forces a change

- **Settings tab name:** `Интеграции`.
- **Bitrix is a provider, not the whole subsystem.**
- **Principal comes from the QA/DSH session, never from LLM args.**
- **OAuth preferred; token entry supported as fallback.**
- **Secrets encrypted server-side and never readable after save.**
- **Read-only first release.**
- **No generic raw REST/MCP tool exposed to the model.**
- **No cross-user cache or global memory ingestion of private integration data.**
- **Subagents denied until explicit principal delegation is implemented.**
- **Separate broker is the preferred final deployment boundary, but in-process MVP is acceptable if interfaces are preserved.**

---

## 37. Immediate implementation order for a coding agent

1. Inspect current `qa-surface` auth/user/session ownership implementation.
2. Document the current trusted user id and DSH session creation/restore flow.
3. Add/fix immutable user -> DSH session ownership and tests.
4. Add `Интеграции` route/page alongside `Профиль`, `Общие`, `Навыки`.
5. Implement provider registry and Bitrix placeholder card.
6. Implement `SecretStore` + master-key loading from Docker secret.
7. Implement user integration CRUD with `/api/me/...` authorization.
8. Add manual credential save/test/disconnect without secret readback.
9. Add centralized redaction and leakage tests.
10. Implement Bitrix provider read-only operations.
11. Implement `dsh-qa-integrations` tool proxy and principal resolver.
12. Add Alice/Bob concurrent E2E isolation tests.
13. Only after the above is green, add OAuth flow.
14. Only after read-only production use is stable, design/enable confirmation-based writes.
