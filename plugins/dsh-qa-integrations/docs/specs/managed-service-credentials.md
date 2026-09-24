# dsh-qa-integrations — Managed Service Credentials

**Status:** Milestone 1 implemented (§38); phases 5–7 open
**Feature:** shared service credentials / service-token mode  
**Target:** `dsh-qa-integrations`, integration broker и provider implementations

## Implementation status

Milestone 1 of §38 is implemented: the generic service-credential core, GitLab
and TeamCity.

Implemented:

- operation security metadata (`effect`, `sensitivity`, `serviceCredential`,
  `requiresResourceBoundary`) with a fail-closed default for anything a provider
  does not classify (`src/service-credentials/`);
- the service credential profile registry, including `secretFile`/`secretEnv`
  loading, content-hash revisions and rotation without reconnecting;
- the binding columns on the stored connection (`credential_source`,
  `service_profile_id`, `binding_revision`, `service_selection_json`,
  `service_policy_revision`) and the migration that leaves every existing
  connection on `personal`;
- the ceiling, the administrator narrowing and the resource boundary, enforced in
  the broker and again inside each supporting provider;
- the GitLab `ci.read` → `ci.metadata.read` + `ci.logs.read` split, with a
  provider-agnostic capability repair at startup for connections that stored the
  old id;
- the GitLab and TeamCity service credential surfaces: connect checkbox
  (default-on for a new connection when the deployment says so), connected card
  with the access mode, the personal-only and unavailable capabilities, the
  boundary editor, and the switch in both directions;
- the release-blocking security tests of §36 that apply to this milestone
  (`tests/service-credentials.test.ts`, `tests/gitlab-service.test.ts`,
  `tests/teamcity-service.test.ts`, `tests/service-card.test.tsx`).

Deviations from this document, and why:

- the binding is stored on the existing integration row rather than in a separate
  `integration_bindings` table. The store already keeps exactly one connection per
  (principal, provider) under a unique index, and the shared credential itself
  never lands there: it stays deployment configuration, and the row only records
  which source the binding spends. Splitting the table would add a join without
  changing what can be expressed;
- error codes keep this package's `PascalCase` convention
  (`ServiceCredentialUnavailable`, `SensitiveReadRequiresPersonalCredential`, …)
  while keeping the specification's vocabulary; §29 lists the same set in
  `SCREAMING_SNAKE`;
- §27 rate limiting covers the service mode, which is the bottleneck it was
  written for: `managedServiceCredentials.rateLimit` limits one principal on one
  provider and one shared credential in total, and both balances are read before
  either is written, so a user refused by the shared ceiling keeps their own
  allowance. The `per-integration-binding` and `per-upstream-instance` levels of
  its list collapse into those two here: the store keeps one binding per
  (principal, provider) and the registry resolves one profile per
  (provider, instance). Personal-mode calls stay unthrottled — upstream sets
  that frequency itself.

Deferred, by design: Bitrix24, Jira, Confluence and the remaining providers offer
no service mode (their cards show nothing about it); the Atlassian strategy split
of §35; cross-principal caching.

## 1. Goal

Добавить в общий integration layer возможность использовать управляемый deployment'ом **сервисный credential** вместо персонального OAuth/PAT/token пользователя.

Основной UX:

```text
GitLab
─────────────────────────────────────
[x] Использовать сервисный токен

Сервисный режим
Только безопасное чтение.
Изменения и чувствительные данные недоступны.
```

Для новых подключений checkbox:

```text
Использовать сервисный токен
```

включён по умолчанию, если для данного provider/instance администратором настроен service credential.

Причина:

- большинству пользователей не хочется самостоятельно создавать PAT/token;
- часть пользователей не может создавать токены;
- некоторым integrations требуется сложный OAuth/connect flow;
- для обычных QA/agent use cases часто достаточно ограниченного read-only доступа;
- один централизованно управляемый read-only service account проще ротировать и контролировать.

При этом сервисный credential не должен превращаться в общий высокопривилегированный аккаунт.

---

# 2. Main design decision

Внутренне использовать термин:

```text
Managed Service Credential
```

а не `shared token`.

Причина: конкретный provider может использовать:

- PAT;
- OAuth credential;
- API token;
- webhook/application credential;
- другой provider-specific auth mechanism.

Пользовательский UI при этом может по-прежнему называться:

```text
Использовать сервисный токен
```

## Credential modes

```ts
type CredentialSource =
  | 'personal'
  | 'service'
```

Не вводить:

```text
auto
fallback
defaultCredential
```

и не делать:

```ts
personalCredential ?? serviceCredential
serviceCredential ?? personalCredential
```

Выбранный credential mode должен быть однозначным.

Если выбран `service`, но service credential недоступен, вызов завершается ошибкой.

Если выбран `personal`, отсутствие персонального credential требует подключения пользователя.

**Автоматического fallback между режимами нет.**

---

# 3. Security model

Главное изменение модели:

```text
qa principal
        ∩
provider implementation
        ∩
global admin policy
        ∩
credential-mode capability ceiling
        ∩
service credential policy
        ∩
service resource boundary
        ∩
user/workspace resource boundary
        ∩
upstream credential permissions
        =
effective permissions
```

В personal mode upstream identity обычно соответствует текущему пользователю.

В service mode:

```text
local actor      = authenticated qa-surface user
upstream actor   = shared service account
```

Эти две identity нельзя смешивать.

Service account определяет, что **технически может прочитать upstream credential**.

`qa principal + local policy + resource boundaries` определяют, что разрешено конкретному пользователю через `dsh-qa-integrations`.

---

# 4. Service mode is not simply read-only

Операции должны классифицироваться минимум по двум независимым признакам.

```ts
type OperationEffect =
  | 'read'
  | 'write'
  | 'admin'

type DataSensitivity =
  | 'normal'
  | 'sensitive'
  | 'secret'

interface OperationSecurityMetadata {
  effect: OperationEffect
  sensitivity: DataSensitivity

  serviceCredential:
    | 'allow'
    | 'deny'
}
```

Пример:

```ts
{
  id: 'teamcity.builds.read',
  effect: 'read',
  sensitivity: 'normal',
  serviceCredential: 'allow'
}
```

и:

```ts
{
  id: 'teamcity.buildLog.read',
  effect: 'read',
  sensitivity: 'sensitive',
  serviceCredential: 'deny'
}
```

## Default rule

Любая новая или неклассифицированная операция:

```text
serviceCredential = deny
```

То есть новый tool после обновления provider'а не становится автоматически доступным через shared credential.

Это release-blocking invariant.

---

# 5. Service credential capability ceiling

Service mode разрешает только операции, которые одновременно:

```text
effect = read
AND
sensitivity = normal
AND
serviceCredential = allow
```

Всегда запрещены:

```text
write
admin
secret
sensitive_read
raw API
permission management
credential management
```

Даже если сам service token имеет соответствующее upstream permission.

То есть upstream permission является только дополнительным ограничителем, но никогда не расширяет platform policy.

Пример:

```text
service PAT случайно умеет trigger build
        +
TeamCity позволяет trigger build
        +
agent вызывает teamcity_trigger_build

=> DENY
```

Наличие upstream permission не делает operation доступной.

---

# 6. Hard vs configurable restrictions

Для первой реализации service credential ceiling должен быть hard maximum.

Administrator config может:

```text
ALLOW -> DENY
```

но не:

```text
DENY -> ALLOW
```

Например:

```yaml
servicePolicy:
  teamcity.builds.read: deny
```

допустимо.

Но конфигурация:

```yaml
servicePolicy:
  teamcity.builds.trigger: allow
```

не должна включать write operation.

Чтобы сделать ранее запрещённую capability service-safe, требуется изменение provider code + security metadata + тесты.

---

# 7. Resource boundary

Shared service account почти неизбежно будет видеть больше, чем должен видеть отдельный QA user.

Поэтому service credential MUST иметь собственный administrator-defined resource boundary.

Модель:

```text
resources visible to service account upstream
        ∩
administrator service boundary
        ∩
user/workspace boundary
        =
resources visible to agent
```

## Important

User resource picker никогда не должен показывать любой resource, который service account способен увидеть.

Он показывает только:

```text
serviceAccountResources
∩
serviceProfile.allowedResources
```

Пользователь может только дополнительно сузить этот список.

---

# 8. Generic service credential profile

Добавить platform-level entity:

```text
service_credential_profiles
---------------------------
id
provider
provider_instance
label
auth_type
secret_ref / encrypted_credential
external_identity_id
external_identity_label
status
policy_profile
resource_boundary_json
credential_revision
policy_revision
expires_at
last_validated_at
created_at
updated_at
```

Примеры:

```text
gitlab-corp-readonly
teamcity-corp-readonly
bitrix-corp-readonly
```

Service credentials принадлежат deployment'у, а не пользователю.

Normal user не может:

- создать service credential;
- изменить secret;
- поменять upstream identity;
- изменить service resource boundary;
- выбрать произвольный `service_credential_profile_id`.

---

# 9. Integration binding

Не рекомендуется просто добавлять shared credential в существующий user-owned `integration_accounts`.

Лучше ввести отдельную связь:

```text
integration_bindings
--------------------
id
principal_id
provider
provider_instance
resource_id / capability_id
credential_source
personal_account_id nullable
service_profile_key nullable
user_resource_boundary_json
workspace_binding_id nullable
status
created_at
updated_at
```

Причина — Jira и Confluence уже используют общий Atlassian account, но provider capabilities независимы.

Например пользователь сможет иметь:

```text
Jira       -> service credential
Confluence -> personal Atlassian credential
```

даже если personal Jira/Confluence используют один Atlassian OAuth account.

`service_profile_key` не принимается из model-facing tool args.

Server сам резолвит допустимый service profile по:

```text
provider
provider instance
workspace binding
deployment configuration
```

---

# 10. Resolved execution context

Broker должен передавать provider'у уже проверенный контекст:

```ts
interface ResolvedCredentialContext {
  source: 'personal' | 'service'

  credentialRevision: number

  personal?: {
    accountId: string
    externalIdentityId: string
  }

  service?: {
    profileId: string
    externalIdentityId: string
    policyRevision: number
  }
}
```

Provider tool args не меняются.

Модель по-прежнему не получает:

```text
principalId
credentialId
serviceProfileId
token
accountId
```

---

# 11. Resolution flow

Service mode:

```text
DSH session
    ↓
PrincipalResolver
    ↓
qa principal
    ↓
IntegrationBinding
    credential_source = service
    ↓
server-selected ServiceCredentialProfile
    ↓
service capability ceiling
    ↓
service resource boundary
    ↓
user/workspace resource boundary
    ↓
operation policy
    ↓
inject managed credential
    ↓
upstream provider
```

Personal mode остаётся текущим:

```text
DSH session
    ↓
principal
    ↓
user-owned integration account
    ↓
personal credential
    ↓
provider
```

---

# 12. UI

## 12.1 New connection

Если service credential доступен:

```text
Connect GitLab
────────────────────────────────

[x] Использовать сервисный токен

Рекомендуется.
Не нужно создавать собственный токен или проходить авторизацию.

Сервисный режим предоставляет только безопасный доступ на чтение.
Изменения, секретные данные и чувствительные пользовательские данные
будут недоступны.

[Continue]
```

Checkbox по умолчанию включён.

Если пользователь выключает его:

```text
[ ] Использовать сервисный токен

Подключение:
[Continue with GitLab OAuth]
```

или для TeamCity:

```text
Access token:
[______________________]
```

---

## 12.2 Connected card — service mode

```text
GitLab
────────────────────────────────
● Connected

Credential:
Service account
Managed by administrator

[x] Использовать сервисный токен

Access mode:
Safe read-only

Projects:
8 available to this workspace

Unavailable with service token:
• Write actions
• Secret-management operations
• Sensitive reads

[Manage access]
[Use personal account]
```

Не показывать сам token или его prefix/suffix.

При необходимости допустимо показать безопасный alias:

```text
Service account: QA Read-only
```

---

# 13. Capability toggles in UI

Если service mode включён:

```text
[x] Read issues
[x] Read merge requests

[ ] Write comments
    unavailable with service token

[ ] Trigger pipeline
    unavailable with service token
```

Sensitive reads:

```text
[ ] Read chats
    requires personal connection
```

Disable должен быть не только визуальным.

Backend обязан возвращать deny даже на вручную сформированный API/tool request.

---

# 14. Switching modes

Переключение:

```text
personal -> service
service -> personal
```

должно:

1. increment binding revision;
2. invalidate authorization cache;
3. invalidate provider result cache;
4. invalidate continuation cursors;
5. invalidate pending actions;
6. immediately affect future tool calls.

Персональный credential не обязательно удалять при переходе в service mode.

Он может оставаться сохранённым как inactive, чтобы пользователь мог быстро вернуться.

Но он ни при каких обстоятельствах не используется как fallback.

---

# 15. Migration behavior

Очень важно:

**default-on service mode применяется только к новым integrations.**

Существующие пользователи с уже подключённым personal credential не должны после update внезапно начать работать через общий аккаунт.

Migration:

```text
existing connection
    -> credential_source = personal
```

New connection:

```text
service profile available
    -> default credential_source = service

service profile unavailable
    -> credential_source = personal
```

---

# 16. GitLab changes

GitLab является хорошим кандидатом для Phase 1.

## Credential

Deployment-managed PAT/service-user token.

Предпочтительно upstream scopes:

```text
read_user
read_api
read_repository
```

Без:

```text
api
write_repository
admin scopes
```

## Service-safe capabilities

Кандидаты:

```text
gitlab.identity.read
gitlab.projects.read
gitlab.repository.read
gitlab.search.read
gitlab.issues.read
gitlab.merge_requests.read
gitlab.ci.metadata.read
```

## Required capability split

Существующий:

```text
gitlab.ci.read
```

слишком широкий для service mode, потому что туда попадают job logs.

Разделить минимум на:

```text
gitlab.ci.metadata.read
gitlab.ci.logs.read
```

где:

```text
ci.metadata.read -> service allow
ci.logs.read     -> sensitive_read -> service deny
```

## Always denied in service mode

```text
comments.write
issues.write
merge_requests.write
ci.run
repository.write
merge
admin
raw_api
secret_management
membership_management
```

Рекомендуется дополнительно классифицировать как sensitive:

```text
confidential issues
CI job logs
future secret/security endpoints
```

Если issue имеет `confidential = true`, service mode должен fail closed и не возвращать его содержимое.

## Resource boundary

Service profile обязан иметь:

```text
allowedProjectIds
allowedGroupIds
```

User/workspace project selection может только сужать эту границу.

---

# 17. TeamCity changes

TeamCity также подходит для Phase 1.

## Credential

Deployment-managed PAT от отдельного service account.

Token должен быть максимально ограничен TeamCity permissions.

## Service-safe

```text
projects.read
buildConfigs.read
builds.read
buildChanges.read
failures.read
queue.read
investigations.read
agents.read
artifacts.list
```

`failures.read` должен продолжать использовать normalized/sanitized output, а не полный log.

## Sensitive — blocked

```text
buildLog.read
artifacts.readText
```

Также service mode не должен получать:

```text
configuration parameters
resulting properties
hidden/password parameters
secret values
```

даже если upstream token это позволяет.

## Writes — blocked

```text
builds.trigger
builds.retry
builds.cancel
builds.comment
builds.tags

investigations.write
mutes.write
agents.write
buildConfigs.write
projects.write
rawRest
```

В service mode эти tools желательно вообще не включать в effective tool set.

## Resource boundary

Service profile:

```yaml
resources:
  allowedProjects:
    - PAYMENTS
    - PLATFORM
```

Если TeamCity resource tree поддерживает стабильные IDs — использовать IDs, а не display names.

---

# 18. Bitrix changes

Точная tool matrix должна быть сделана в самом Bitrix provider, но общий принцип должен быть platform-level.

Минимум следующие классы operations считаются:

```text
sensitive_read
```

и недоступны через service credential:

```text
чтение истории чатов
чтение личных сообщений
чтение групповых сообщений
поиск по сообщениям
получение содержимого chat attachments
любые аналогичные endpoints личной/межличностной коммуникации
```

Любые операции:

```text
send
create
update
delete
assign
change state
```

являются write и также запрещены.

Обычные read operations Bitrix разрешаются через service mode только после явной provider classification:

```ts
serviceCredential: 'allow'
```

Не классифицированная Bitrix operation = deny.

---

# 19. Jira

Generic infrastructure должна поддерживать service credential для Jira, но Jira provider не стоит включать в первую фазу автоматически.

Причина: текущая модель построена вокруг personal Atlassian 3LO identity.

Для service-mode Jira потребуется отдельный auth strategy:

```text
providers/atlassian
    personalOAuthStrategy
    serviceCredentialStrategy
```

Перед включением service mode обязательны:

```text
administrator-selected Atlassian site
project allowlist
read-only capability ceiling
issue-security handling
no writes
```

Особенно важно учитывать Jira issue security.

Service account может видеть issue, которое обычный пользователь не увидел бы.

Поэтому service mode не должен интерпретироваться как:

```text
"то, что может видеть текущий Jira user"
```

Его семантика:

```text
"организационный shared Jira view,
явно опубликованный через service profile"
```

Рекомендуется считать issues с ограниченным issue-security level чувствительными и не возвращать их в service mode.

До реализации такой проверки:

```text
jira.serviceCredentials.enabled = false
```

по умолчанию.

---

# 20. Confluence

Для Confluence проблема аналогична Jira, но дополнительно существуют page-level restrictions.

Service account может технически видеть restricted page, которую текущий QA user не видит.

Поэтому generic core реализуется сразу, но Confluence service mode включается отдельным provider milestone.

Для включения необходимы:

```text
site allowlist
space allowlist
restriction-aware search
restriction-aware direct page reads
restriction-aware comments/attachments/version reads
```

Если provider не может достоверно отличить shared content от content, доступного только service identity:

```text
fail closed
```

а не возвращать страницу.

---

# 21. Provider capability declaration

Каждый provider должен экспортировать metadata:

```ts
interface ProviderOperationDescriptor {
  id: string

  effect: 'read' | 'write' | 'admin'
  sensitivity: 'normal' | 'sensitive' | 'secret'

  serviceCredential: 'allow' | 'deny'

  requiresResourceBoundary?: boolean
}
```

Пример registry:

```ts
{
  'teamcity.builds.read': {
    effect: 'read',
    sensitivity: 'normal',
    serviceCredential: 'allow',
    requiresResourceBoundary: true,
  },

  'teamcity.buildLog.read': {
    effect: 'read',
    sensitivity: 'sensitive',
    serviceCredential: 'deny',
  },

  'teamcity.builds.trigger': {
    effect: 'write',
    sensitivity: 'normal',
    serviceCredential: 'deny',
  },
}
```

---

# 22. Tool exposure

Предпочтительное поведение:

```text
effective capabilities
        ↓
DSH tool registry/filter
        ↓
model receives only usable tools
```

То есть в service mode модель по возможности вообще не видит:

```text
teamcity_trigger_build
gitlab_issue_comment_prepare
bitrix_chat_history
```

если они запрещены.

Но tool hiding — только UX/context optimization.

Security enforcement всегда остаётся в broker/provider.

Если DSH runtime не позволяет динамически фильтровать tools по session:

1. tool остаётся зарегистрированным;
2. broker проверяет service policy;
3. вызов возвращает typed `OPERATION_DISABLED`.

---

# 23. Configuration

Пример:

```yaml
integrations:
  managedServiceCredentials:
    enabled: true
    defaultForNewConnections: true

    profiles:
      - id: gitlab-corp-readonly
        provider: gitlab
        instance: corp
        label: QA GitLab Read-only

        credential:
          type: pat
          secretFile: /run/secrets/qa_gitlab_service_token

        resources:
          groups:
            - 100
          projects:
            - 1208
            - 1337

      - id: teamcity-corp-readonly
        provider: teamcity
        instance: corp
        label: QA TeamCity Read-only

        credential:
          type: personal_access_token
          secretFile: /run/secrets/qa_teamcity_service_token

        resources:
          projects:
            - PAYMENTS
            - PLATFORM
```

Secrets не хранить literal'ами в committed YAML.

---

# 24. Service credential validation

Каждый supporting provider должен реализовать:

```ts
validateServiceCredential(...)
```

Результат:

```ts
interface ServiceCredentialHealth {
  status:
    | 'healthy'
    | 'expired'
    | 'revoked'
    | 'unsafe_scope'
    | 'unreachable'

  upstreamIdentity?: SafeExternalIdentity

  grantedScopes?: string[]

  warnings?: string[]
}
```

При возможности provider должен проверить, что credential не имеет ненужных mutable/admin scopes.

Не использовать destructive probe для определения write permissions.

Даже если credential оказался шире ожидаемого, local service capability ceiling остаётся обязательным.

---

# 25. Cache isolation

Несмотря на shared upstream credential, cache по умолчанию остаётся principal-scoped.

Пример:

```text
provider:
  credentialSource:
  credentialRevision:
  serviceProfile:
  servicePolicyRevision:
  qaPrincipal:
  workspace:
  resourceBoundaryRevision:
  operation:
  argsHash:
```

Не делать сразу:

```text
service account один
=> cache общий для всех пользователей
```

потому что разные users/workspaces могут иметь разные local boundaries.

Cross-principal shared cache для service data — отдельная future optimization и не входит в эту задачу.

---

# 26. Continuation tokens

Cursor/continuation token должен включать или cryptographically bind:

```text
principal
provider
credential source
credential revision
service profile
service policy revision
resource boundary revision
operation
normalized args
expiry
```

После переключения:

```text
personal <-> service
```

старый cursor больше невалиден.

---

# 27. Rate limiting

Shared credential создаёт новый общий bottleneck.

Добавить уровни:

```text
per-principal/provider
per-integration-binding
per-service-credential-profile
per-upstream-instance
```

Например:

```yaml
managedServiceCredentials:
  rateLimit:
    perPrincipal:
      requestsPerMinute: 120

    perCredential:
      requestsPerMinute: 1000
      maxConcurrent: 16
```

Один QA user не должен иметь возможности исчерпать весь quota shared service token.

---

# 28. Audit

Upstream в service mode видит только service account.

Поэтому local audit становится особенно важным.

Каждый event должен включать:

```text
principal_id
session_id
provider
provider_instance
credential_source = service
service_profile_id / safe alias
upstream_external_identity_id
operation
resource
policy decision
result
request_id
```

Это позволяет ответить:

```text
Кто из реальных пользователей выполнил запрос?
```

даже если upstream audit показывает:

```text
qa-service-account
```

Никогда не логировать сам credential.

---

# 29. Errors

Добавить generic errors:

```text
SERVICE_CREDENTIAL_UNAVAILABLE
SERVICE_CREDENTIAL_DISABLED
SERVICE_CREDENTIAL_INVALID
SERVICE_CREDENTIAL_UNSAFE_SCOPE
SERVICE_RESOURCE_NOT_ALLOWED
OPERATION_NOT_ALLOWED_WITH_SERVICE_CREDENTIAL
SENSITIVE_READ_REQUIRES_PERSONAL_CREDENTIAL
PERSONAL_CREDENTIAL_REQUIRED
```

UI может переводить:

```text
SENSITIVE_READ_REQUIRES_PERSONAL_CREDENTIAL
```

в:

```text
Эта операция может содержать личные или чувствительные данные.
Подключите личный аккаунт, чтобы использовать её.
```

---

# 30. No implicit fallback

Это отдельный security invariant.

Запрещено:

```ts
try {
  return personalCredential()
} catch {
  return serviceCredential()
}
```

и наоборот.

Запрещено также после upstream `403`:

```text
personal credential 403
        ↓
retry with service account
```

или:

```text
service credential 403
        ↓
retry with personal account
```

`403` остаётся deny.

---

# 31. Pending actions

При переходе пользователя в service mode все существующие pending write actions, подготовленные через personal credential, должны инвалидироваться.

Причина:

```text
prepare under personal identity
switch credential mode
confirm under another identity
```

не должно быть возможно.

Service mode сам по себе не должен создавать write pending actions.

---

# 32. Observability

Добавить безопасные labels:

```text
integration.credential_source = personal|service
integration.service_profile = safe low-cardinality alias
integration.service_policy_decision
```

Metrics:

```text
integration_service_credential_requests_total
integration_service_credential_denied_total
integration_service_sensitive_read_denied_total
integration_service_credential_errors_total
integration_service_credential_rate_limited_total
```

Не использовать username/token/resource name как metric labels.

---

# 33. Changes to current GitLab SPEC

Обновить:

### Non-goals

Вместо:

```text
never share one service-account token
```

зафиксировать:

```text
service credentials are allowed only through the managed-service-credential
architecture described by the shared integration layer.

Implicit service-account fallback remains forbidden.
```

### Authentication

Добавить:

```text
personal OAuth
personal PAT
managed service PAT
```

### Data model

Не считать `integration_account.user_id` единственным возможным владельцем credential.

Credential ownership и user/provider binding разделяются.

### Principal isolation

Сохранить:

```text
principal is always required
```

но изменить assumption:

```text
principal identity != necessarily upstream credential identity
```

### Capability model

Добавить operation security metadata.

### CI

Разделить:

```text
ci metadata read
ci log read
```

### UI

Добавить service checkbox.

### Final security invariant

Новая формулировка:

```text
Every GitLab operation is attributable to the authenticated qa-surface
principal.

The upstream GitLab identity is selected only by trusted server-side
credential policy and can be either the principal's personal identity or
an administrator-managed service identity.

Neither the model nor tool arguments can select or substitute that identity.
```

---

# 34. Changes to TeamCity SPEC

Обновить:

```text
Non-goals
Authentication
Multi-user isolation
Operation policy
Token permissions
qa-surface UI
Security invariants
```

Заменить запрет shared identity на:

```text
Shared credentials are forbidden except for explicitly configured
Managed Service Credentials.

There is never implicit fallback to them.
```

Добавить credential mode и provider operation metadata.

Разделить safe vs sensitive reads.

Особенно:

```text
buildLog.read       -> service deny
artifacts.readText  -> service deny
```

---

# 35. Changes to Jira/Confluence SPEC

Shared Atlassian layer должен стать strategy-based:

```text
providers/atlassian/
  auth/
    personal-oauth/
    service/
```

Provider capability/binding выбирает credential source.

Это важно, чтобы Jira и Confluence могли независимо использовать:

```text
personal
service
```

при общей Atlassian infrastructure.

Первый release может оставить:

```text
jira.serviceCredentialSupport = false
confluence.serviceCredentialSupport = false
```

при уже реализованном generic broker layer.

---

# 36. Security tests

Release-blocking tests:

1. Новый пользователь при наличии service profile получает service mode по умолчанию.
2. Существующий personal connection после upgrade остаётся personal.
3. Model не может выбрать service profile ID.
4. User API не может подменить service profile ID.
5. Service mode не exposes write tools.
6. Прямой вызов write operation через API возвращает deny.
7. Write-capable upstream service token всё равно не позволяет write.
8. Sensitive read возвращает deny.
9. Bitrix chat/history tools запрещены.
10. TeamCity build log запрещён.
11. TeamCity text artifact content запрещён.
12. GitLab CI job log запрещён.
13. GitLab confidential issue запрещён, если включена соответствующая classification.
14. Resource вне service allowlist недоступен даже по direct object ID.
15. User boundary не может расширить service boundary.
16. Workspace boundary не может расширить service boundary.
17. Неизвестная/unclassified новая operation запрещена в service mode.
18. Service token `403` не вызывает personal fallback.
19. Personal token `403` не вызывает service fallback.
20. Switch credential mode инвалидирует cache.
21. Switch credential mode инвалидирует continuation token.
22. Switch credential mode инвалидирует pending actions.
23. Alice и Bob используют один service credential, но их local boundaries остаются независимыми.
24. Cache Alice не возвращается Bob.
25. Rate limit Alice не позволяет монополизировать shared token.
26. Audit содержит реального qa principal.
27. Audit показывает `credential_source=service`.
28. Token отсутствует в logs/traces/model/browser.
29. Service credential rotation инвалидирует старое auth/cache state.
30. Disabled service profile немедленно блокирует новые calls.

---

# 37. Implementation plan

## Phase 0 — operation security metadata

Добавить общий registry:

```text
effect
sensitivity
serviceCredential
requiresResourceBoundary
```

Перенести текущие operations GitLab/TeamCity на него.

Default для отсутствующей metadata:

```text
deny in service mode
```

## Phase 1 — broker managed credentials

Реализовать:

```text
ServiceCredentialProfile
ServiceCredentialResolver
IntegrationBinding
credential_source
service resource boundary
credential revision
policy revision
```

Добавить service credential vault/config loading.

## Phase 2 — policy engine

Добавить:

```text
credential mode ceiling
sensitive_read deny
service resource boundary intersection
no-fallback invariant
```

## Phase 3 — GitLab

Добавить:

```text
managed PAT
service profile validation
group/project service allowlist
ci metadata/log split
service-mode UI
```

## Phase 4 — TeamCity

Добавить:

```text
managed PAT
project boundary
buildLog sensitive classification
artifact-text sensitive classification
service-mode UI
```

## Phase 5 — Bitrix

Классифицировать все provider operations.

Минимум chat/message reads пометить:

```text
sensitive_read
serviceCredential = deny
```

Добавить provider-specific service resource boundary.

## Phase 6 — Atlassian

После отдельного threat review:

```text
Atlassian service auth strategy
Jira service mode
Confluence service mode
issue/page restriction handling
```

## Phase 7 — hardening

Добавить:

```text
credential rotation
health checks
per-service rate limiting
audit/OTel
cross-user negative suite
migration tests
docs/admin UI
```

---

# 38. Recommended first implementation milestone

Первый milestone специально сделать узким:

```text
M1:
generic service credential core
+
GitLab
+
TeamCity
```

В M1:

- service credentials задаются администратором;
- checkbox default-on для новых connections;
- personal mode остаётся;
- никакого fallback;
- только explicit service-safe read operations;
- GitLab job logs запрещены;
- TeamCity build logs/artifact contents запрещены;
- все writes запрещены;
- service resources ограничены admin allowlist;
- cache остаётся principal-scoped;
- audit сохраняет real user;
- Bitrix/Jira/Confluence могут подключиться к той же архитектуре далее без переделки core.

---

# 39. Acceptance criteria

Feature считается готовой к production rollout, когда:

- [ ] Deployment может определить service credential для конкретного provider instance.
- [ ] Service secret не попадает в DSH/model/browser/logs.
- [ ] Новый пользователь получает service mode по умолчанию, если profile существует.
- [ ] Existing personal connections не мигрируют на service автоматически.
- [ ] Пользователь может переключиться на personal credential.
- [ ] Нет implicit credential fallback.
- [ ] Service mode разрешает только explicitly service-safe reads.
- [ ] Sensitive reads запрещены независимо от того, read-only ли endpoint.
- [ ] Writes/admin/secret operations запрещены независимо от upstream token permissions.
- [ ] Неклассифицированная operation запрещена.
- [ ] Service resource boundary является hard upper bound.
- [ ] User/workspace policy может только сузить service boundary.
- [ ] Direct object reads проходят ту же boundary policy, что search/list.
- [ ] Effective tool set не содержит недоступных operations там, где DSH позволяет dynamic filtering.
- [ ] Backend всё равно проверяет policy независимо от tool visibility.
- [ ] Cache/cursors/pending actions invalidated при credential-mode switch.
- [ ] Per-principal и per-service-credential rate limiting работают одновременно.
- [ ] Audit связывает каждый service-account request с реальным qa principal.
- [ ] GitLab и TeamCity cross-user/security test suites проходят.
- [ ] Service credential rotation не требует переподключения каждого QA user.