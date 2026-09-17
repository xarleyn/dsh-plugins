# `providers/gitlab` — Provider Specification

Status: Draft 0.1  
Date: 2026-09-15  
Target: `qa-surface` multi-tenant integrations platform  
Provider ID: `gitlab`

## 1. Summary

`providers/gitlab` is a multi-tenant GitLab provider for the shared integration layer used by `qa-surface` and DSH agents.

The provider gives an authenticated `qa-surface` user access to their own GitLab data through DSH tools without exposing OAuth/PAT credentials to the model, browser storage, another user, or a shared DSH/MCP configuration.

The provider MUST preserve four independent authorization boundaries:

1. the authenticated `qa-surface` principal;
2. the GitLab identity connected to that principal;
3. an optional user-selected GitLab resource boundary (groups/projects visible to the agent);
4. the action policy enforced by the integration platform.

The effective permission is the intersection of all four boundaries plus GitLab's own authorization checks.

```text
GitLab OAuth/PAT scopes
        ∩
GitLab user permissions
        ∩
qa-surface integration policy
        ∩
user-selected project/group boundary
        =
effective agent permissions
```

The LLM MUST NOT receive or select:

- `qa_user_id`;
- credential IDs;
- OAuth access/refresh tokens;
- PATs;
- OAuth client secrets;
- another GitLab account;
- another GitLab instance connection.

Identity and credentials are resolved exclusively from trusted server-side execution context.

---

## 2. Goals

### 2.1 Primary goals

- Connect each `qa-surface` user to their own GitLab identity.
- Support GitLab.com and explicitly configured GitLab Self-Managed/Dedicated instances.
- Use OAuth Authorization Code + PKCE as the preferred authentication method.
- Keep all provider credentials encrypted and server-side.
- Expose stable GitLab-specific DSH tools rather than a generic unrestricted REST proxy.
- Start read-first and gate mutating operations through explicit policy and confirmation.
- Prevent cross-user, cross-session, cross-account, cross-project, and cross-cache data leakage.
- Let users optionally restrict the agent to a subset of projects/groups even when GitLab grants broader access.
- Make the provider reusable by interactive chats, future background jobs, and subagents without weakening identity isolation.
- Keep GitLab implementation behind a provider interface so that GitLab REST, GraphQL, or the official GitLab MCP server can be swapped or combined later.

### 2.2 Secondary goals

- Provide good auditability of tool use without logging secrets or unnecessary code/content.
- Support rate-limit aware retries and pagination.
- Support GitLab webhooks later for cache invalidation and event-driven workflows.
- Support enterprise/self-managed GitLab with custom CA bundles and private networking under explicit administrator configuration.

---

## 3. Non-goals

Initial implementation MUST NOT:

- expose arbitrary `gitlab_rest_call(method, path, body)` to the model;
- expose GraphQL query text supplied by the model;
- provide GitLab admin APIs;
- use `sudo`, impersonation tokens, or administrator credentials;
- share one service-account token across all `qa-surface` users, except
  through the managed service credential described in
  [`SPEC-managed-service-credentials.md`](./SPEC-managed-service-credentials.md):
  a deployment may publish one administrator-managed read-only credential, and
  only the path that specification defines. Sharing a token any other way — a
  static MCP credential, a per-deployment token handed to every user, an
  implicit substitution — stays forbidden;
- let users specify arbitrary GitLab base URLs at tool-call time;
- let the model select `user_id`, `connection_id`, `credential_id`, or OAuth scopes;
- automatically merge merge requests;
- push directly to repositories;
- create/delete branches or tags in MVP;
- create/update/delete repository files in MVP;
- manage deploy tokens, access tokens, SSH keys, runners, protected branches, CI variables, secrets, hooks, or project membership in MVP;
- automatically ingest private GitLab data into a global/shared memory or knowledge base;
- assume the official GitLab MCP server is the canonical backend in MVP.

---

## 4. Why this is a provider, not a shared MCP config

A normal deployment-level MCP connection is not sufficient for a multi-user `qa-surface`: one static MCP credential would be shared by every user who can invoke the registered tools.

The provider MUST instead resolve the caller as follows:

```text
browser
  -> authenticated qa-surface session
  -> DSH session
  -> trusted qa principal
  -> user's GitLab connection
  -> user's encrypted credential
  -> GitLab API
```

At no point can the model replace the principal or select a different stored connection.

The provider may use MCP internally in a future transport adapter, but the security principal MUST remain the `qa-surface` user, not an MCP configuration entry.

---

## 5. High-level architecture

```text
┌────────────────────────────────────────────────────────────┐
│ Browser / qa-surface                                      │
│                                                            │
│ authenticated user = U123                                  │
│ DSH session S456 is server-side bound to U123              │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ dsh-user-integrations                                     │
│                                                            │
│ ToolExecution -> session S456                              │
│ PrincipalResolver -> U123                                  │
│ PolicyEngine                                                │
│ ConfirmationService                                        │
└───────────────────────────┬────────────────────────────────┘
                            │ trusted principal only
                            ▼
┌────────────────────────────────────────────────────────────┐
│ integration-broker                                        │
│                                                            │
│ CredentialVault                                             │
│ AccountResolver                                             │
│ AuditLog                                                    │
│ RateLimit coordinator                                       │
│                                                            │
│ providers/                                                  │
│   gitlab/                                                   │
│     provider                                                │
│     auth                                                    │
│     client                                                  │
│     policy                                                  │
│     resource-boundary                                       │
│     mappers                                                  │
└───────────────────────────┬────────────────────────────────┘
                            │ OAuth token/PAT injected here
                            ▼
┌────────────────────────────────────────────────────────────┐
│ GitLab.com / configured GitLab Self-Managed instance       │
│ REST API v4 / GraphQL where explicitly implemented         │
│ optional official GitLab MCP transport in later phase      │
└────────────────────────────────────────────────────────────┘
```

---

## 6. Provider interface

The GitLab provider should implement the same generic contract as other `providers/*` integrations.

Illustrative interface:

```ts
export interface IntegrationProvider {
  id: string
  displayName: string

  beginConnect(ctx: ConnectContext): Promise<ConnectStartResult>
  completeConnect(ctx: ConnectCallbackContext): Promise<ConnectedAccount>
  disconnect(ctx: PrincipalContext, accountId: string): Promise<void>
  validateConnection(ctx: PrincipalContext, accountId: string): Promise<ConnectionHealth>

  getCapabilities(ctx: PrincipalContext, accountId: string): Promise<ProviderCapabilities>
  execute<T>(ctx: ProviderExecutionContext, operation: string, input: unknown): Promise<T>
}
```

`ProviderExecutionContext` MUST contain a trusted principal resolved upstream. It MUST NOT be constructible from model/tool input.

```ts
interface ProviderExecutionContext {
  principal: {
    qaUserId: string
    sessionId: string
  }
  account: ResolvedIntegrationAccount
  policy: EffectiveIntegrationPolicy
  requestId: string
  abortSignal?: AbortSignal
}
```

---

## 7. Supported GitLab deployments

### 7.1 GitLab.com

GitLab.com is a predefined provider instance when configured by the administrator.

Example:

```yaml
gitlab:
  instances:
    - id: gitlab-com
      label: GitLab.com
      baseUrl: https://gitlab.com
      oauthClientId: ${GITLAB_COM_CLIENT_ID}
      oauthClientSecret: ${GITLAB_COM_CLIENT_SECRET}
```

### 7.2 Self-Managed / Dedicated

Self-managed instances MUST be administrator-defined.

A normal user MUST NOT be allowed to enter an arbitrary base URL and make the integration broker connect to it.

Example:

```yaml
gitlab:
  instances:
    - id: corp
      label: Corporate GitLab
      baseUrl: https://gitlab.example.internal
      oauthClientId: ${GITLAB_CORP_CLIENT_ID}
      oauthClientSecret: ${GITLAB_CORP_CLIENT_SECRET}
      caBundle: /run/secrets/corp_gitlab_ca.pem
      networkPolicy: private-allowed
```

This is required to avoid turning the broker into an SSRF primitive.

### 7.3 URL/network rules

For every configured instance:

- canonicalize scheme/host/port once at configuration load;
- require HTTPS in production;
- allow HTTP only in explicit development mode;
- do not follow redirects to another origin;
- resolve and validate destinations according to configured network policy;
- do not accept credentials in the URL;
- do not accept a path other than the configured GitLab root;
- API base is derived as `<baseUrl>/api/v4` unless explicitly overridden by trusted admin config;
- OAuth endpoints are derived from the same trusted origin;
- custom CA support is per instance, never supplied by a normal user;
- changing instance URL is an administrator operation and invalidates/revalidates connections.

For private/internal GitLab, private IP access is allowed only for instances explicitly marked as such by the administrator.

---

## 8. Authentication

## 8.1 Preferred mode: OAuth Authorization Code + PKCE

OAuth Authorization Code with PKCE (`S256`) is mandatory for the normal connect flow.

The flow:

```text
qa user U123
  -> POST /api/me/integrations/gitlab/:instance/connect
  -> broker creates one-time state + PKCE verifier
  -> redirect to GitLab /oauth/authorize
  -> user approves
  -> callback to integration broker
  -> validate state
  -> exchange code server-side
  -> GET /api/v4/user
  -> store encrypted tokens + external identity
  -> redirect back to qa-surface
```

The OAuth `state` record MUST be:

- cryptographically random;
- single-use;
- short-lived (recommended: 10 minutes);
- bound to `qa_user_id`;
- bound to the selected GitLab instance;
- bound to the exact redirect URI;
- bound to the PKCE verifier;
- invalidated immediately after successful or failed terminal exchange.

The browser MUST NOT receive the refresh token.

### 8.1.1 Token refresh

OAuth access tokens are short-lived and MUST be refreshed server-side.

Refresh behavior:

- refresh shortly before expiry, not only after the first failed API request;
- serialize refresh per integration account to avoid refresh-token races;
- persist the newly returned refresh token atomically with the new access token;
- if refresh fails with an unrecoverable OAuth error, mark connection `reauth_required`;
- never fall back to another user's token or a service credential.

### 8.1.2 OAuth scopes

Use least privilege and incremental authorization.

Recommended profiles:

#### Read-only profile (MVP default)

```text
read_user
read_api
read_repository
```

This profile is intended for:

- identity verification;
- projects/groups metadata;
- issues;
- merge requests;
- discussions/notes read;
- pipelines/jobs read;
- repository tree/file/commit/diff read;
- GitLab search.

#### Write-enabled profile

GitLab's general REST write surface primarily requires the broad `api` scope. Therefore write enablement MUST be an explicit privilege escalation and MUST require reauthorization when the existing grant does not contain `api`.

```text
api
```

Do not request `write_repository` merely to create comments/issues/MRs through REST; it is not the general REST write scope and should be requested only if a future feature actually performs Git-over-HTTP writes.

The UI MUST clearly explain that GitLab's `api` scope is broad even though this provider will still restrict usable operations through its own policy engine.

### 8.1.3 Application registration

Each supported GitLab instance needs a pre-registered OAuth application controlled by the deployment administrator.

For multiple self-managed instances, use separate OAuth client configuration per instance.

OAuth client secrets belong to broker infrastructure secrets, not per-user records.

---

## 8.2 Optional compatibility mode: Personal Access Token

PAT connection MAY be implemented for instances where OAuth application registration is impossible.

PAT mode is an advanced/admin-enabled compatibility feature, not the default UX.

Requirements:

- user enters PAT only into a protected server POST form;
- token MUST NOT be stored in browser local/session storage;
- API response MUST never echo the token;
- encrypt immediately on receipt;
- validate against `GET /api/v4/user` before storing as active;
- show only masked connection metadata after save;
- never log request body or authorization headers;
- support explicit revoke/delete from local vault;
- if GitLab exposes token expiry metadata, persist and surface it;
- no automatic fallback from broken OAuth to PAT.

PAT scopes should follow the same least-privilege profiles where supported.

---

## 8.3 Managed service credential

A deployment MAY publish one administrator-managed read-only GitLab credential
for a configured instance, described in
[`SPEC-managed-service-credentials.md`](./SPEC-managed-service-credentials.md).
It is a third authentication shape next to personal OAuth and personal PAT:

```text
personal OAuth (8.1)
personal PAT (8.2)
managed service PAT (8.0)
```

The user chooses between their own credential and the managed one at connect
time and can switch later; the choice is stored per connection, and switching
never happens on its own. In service mode the upstream identity is the service
account, while the local principal stays the authenticated `qa-surface` user,
who remains the subject of every audit row.

A service PAT should carry the provider's read scopes only (`read_user`,
`read_api`, `read_repository` or the narrower equivalents) and must not carry
`api`, `write_repository`, admin scopes or `sudo`. An over-wide token is reported
by the credential probe as `unsafe_scope`; it does not widen anything, because
the local capability ceiling is checked first.

---

## 9. Connection ownership and data model

Use generic integration tables where possible, with GitLab-specific metadata separated from secrets.

### 9.1 Generic account

```text
integration_accounts
--------------------
id                  UUID PK
user_id             qa user ID
provider            "gitlab"
provider_instance   configured GitLab instance ID
external_tenant_id  canonical GitLab origin/instance ID
external_user_id    GitLab numeric user ID
display_name
status              connected | reauth_required | revoked | disabled
capabilities_json
created_at
updated_at
last_validated_at
```

Unique constraint:

```text
(user_id, provider, provider_instance, external_user_id)
```

Do not assume one GitLab account per `qa-surface` user forever. The data model SHOULD support multiple accounts, while MVP UI may designate one default account per instance.

### 9.2 Credentials

```text
integration_credentials
-----------------------
account_id
credential_type        oauth | pat
ciphertext
nonce
key_version
expires_at
metadata_json          non-secret metadata only
updated_at
```

OAuth access token and refresh token SHOULD be encrypted as one versioned credential payload or as separately rotatable secret fields.

### 9.3 GitLab provider metadata

```text
gitlab_accounts
---------------
account_id
username
name
avatar_url             optional
web_url                canonical GitLab user URL
granted_scopes_json
auth_mode              oauth | pat
resource_boundary_mode selected | all_accessible
resource_boundary_rev
```

No secret belongs in `gitlab_accounts`.

---

## 10. Credential vault requirements

At-rest secrets MUST be encrypted with authenticated encryption, e.g. AES-256-GCM.

Recommended envelope scheme:

```text
per-record random DEK
    -> encrypt OAuth/PAT credential payload

master KEK
    -> encrypt/wrap DEK

DB stores:
    ciphertext
    nonce
    wrapped DEK
    key version
```

The master key MUST live outside the database, for example:

- Docker Secret for initial self-hosted deployment;
- Vault/KMS later.

Credential material MUST NOT appear in:

- DSH prompts;
- tool schemas;
- tool outputs;
- audit payloads;
- application logs;
- exception messages;
- traces;
- metrics labels;
- browser HTML;
- localStorage/sessionStorage;
- URL query strings.

Redaction middleware SHOULD defensively strip:

- `Authorization`;
- `PRIVATE-TOKEN`;
- `access_token`;
- `refresh_token`;
- `client_secret`;
- PAT-shaped values when detectable.

---

## 11. Principal isolation

Every provider call begins from a trusted `qa-surface` principal.

```ts
const sessionId = exec.agent?.session?.header?.id
if (!sessionId) deny()

const principal = await principalResolver.resolveSession(sessionId)
if (!principal) deny()

const account = await accountResolver.resolve({
  userId: principal.userId,
  provider: 'gitlab',
  // optional server-selected account/instance binding
})

if (!account) deny()
// The binding decides which credential it spends; when it runs on the
// deployment's managed credential, the upstream identity is the service
// account and NOT the principal's own GitLab user. The principal is still the
// only identity the broker knows: it is what every audit row is written
// against, and what the user/workspace boundary is applied to.
```

Forbidden patterns:

```ts
// NEVER
execute({ userId: modelArgs.userId })
execute({ credentialId: modelArgs.credentialId })
execute({ accountId: modelArgs.accountId })

// NEVER
const account = userAccount ?? sharedGitLabAdminAccount
```

The one permitted shared identity is an explicitly configured managed service
credential, and it is not a fallback: the credential source is decided before the
call, stored with the connection, and a failure in one mode is never retried in
the other. `403` stays a denial in both directions.

Principal identity and upstream credential identity are therefore not the same
thing:

```text
principal identity  == the authenticated qa-surface user (always required)
upstream identity   == the principal's GitLab user, or the service account
```

Fail closed if principal/account resolution is ambiguous or missing.

---

## 12. User-selectable resource boundary

GitLab itself may authorize the connected user to many projects. The provider SHOULD allow the user to narrow what the AI may see.

MVP default SHOULD be `selected` rather than `all_accessible`.

Supported boundary entries:

```text
project:<numeric project id>
group:<numeric group id>
```

A group grant includes projects under that group/subgroups only if the policy explicitly defines inheritance.

Do not use mutable project path as the primary authorization key. Resolve and persist numeric IDs.

Example UI:

```text
GitLab / Corporate GitLab
Connected as @alice

AI access:
  (•) Selected resources
  ( ) All projects I can access

Allowed:
  [x] group/platform
  [x] group/backend/api
  [ ] group/hr/private-tools
```

### 12.1 Boundary enforcement

Boundary checks MUST happen before every project-specific API call.

For global GitLab searches, the provider MUST either:

1. execute scoped per-project/group searches within the allowed boundary; or
2. filter server results using trustworthy project IDs before any result is returned to the model.

Option 1 is preferred for strict confidentiality because filtering after a broad search may still bring disallowed data into broker process memory/logging/traces.

Global API operations that cannot be safely restricted SHOULD be disabled when boundary mode is `selected`.

### 12.2 Service-mode boundary

When the connection runs on a managed service credential, the boundary is the
administrator's first and the user's second:

```text
resources visible to the service account upstream
  ∩ administrator boundary of the service profile
  ∩ user/workspace selection
  = resources visible to the agent
```

The service profile's boundary is a hard upper bound. A user may narrow it and
may never widen it: a selection that names anything outside the administrator's
list is dropped rather than stored, and every service-mode call resolves the
resource it touches against the narrowed boundary — a project named by id or by
path, or a build resolved to its owning project. An operation that names no
resource is refused rather than answered with the service account's whole view.

Because the shared account can see far more than any one user, an operation that
cannot be held inside the boundary must not run at all.

### 12.3 Boundary changes

Changing the boundary MUST:

- increment `resource_boundary_rev`;
- invalidate cached authorization decisions;
- invalidate or namespace affected cached GitLab results;
- apply immediately to future tool calls;
- not retroactively delete chat transcript content already shown to the user unless a separate retention policy requires it.

---

## 13. Capability model

Provider-internal capabilities SHOULD be more granular than GitLab OAuth scopes.

Suggested capability IDs:

```text
gitlab.identity.read
gitlab.projects.read
gitlab.repository.read
gitlab.search.read
gitlab.issues.read
gitlab.merge_requests.read
gitlab.ci.metadata.read
gitlab.ci.logs.read

gitlab.comments.write
gitlab.issues.write
gitlab.merge_requests.write
gitlab.ci.run
gitlab.repository.write
gitlab.merge
```

`gitlab.ci.read` was split because a pipeline listing and a job log are
different disclosures. `ci.metadata.read` covers pipelines, jobs and their
statuses; `ci.logs.read` covers the log a job printed, which may carry secrets
and internal addresses, and is never reachable through a managed service
credential. Deployment switches follow the same split (`ciMetadataRead`,
`ciLogsRead`); the pre-split `ciRead` still works and governs both halves.

Every operation carries security metadata next to its capability:

```ts
interface OperationSecurityMetadata {
  effect: 'read' | 'write' | 'admin'
  sensitivity: 'normal' | 'sensitive' | 'secret'
  serviceCredential: 'allow' | 'deny'
  requiresResourceBoundary?: boolean
}
```

An operation with no metadata is denied in service mode: a tool added by a
provider update does not become reachable through the shared credential until
someone classifies it on purpose. That default is release-blocking.

Capability availability is derived from:

- granted OAuth/PAT scopes;
- provider implementation support;
- global administrator policy;
- per-user integration settings;
- project boundary;
- credential mode: in service mode only operations that are `read` of `normal`
  sensitivity with `serviceCredential: 'allow'` may run;
- GitLab's runtime permission checks.

Never infer GitLab role solely from cached membership data and then bypass the API. GitLab remains the final authorization authority.

---

## 14. Tool surface

Tool schemas MUST be narrow, deterministic, and domain-specific.

Naming convention:

```text
gitlab_<noun>_<verb>
```

or, if namespaced by the DSH integration plugin:

```text
integration_gitlab_<noun>_<verb>
```

Tool descriptions SHOULD explicitly say that operations run as the currently authenticated `qa-surface` user.

### 14.1 Identity / connection

#### `gitlab_connection_get`

Returns safe connection metadata:

- instance label/base origin;
- GitLab username/display name;
- connection status;
- granted capability summary;
- selected resource boundary summary.

Must not return tokens or OAuth client metadata.

---

## 14.2 Projects

### `gitlab_projects_list`

Inputs:

```ts
{
  search?: string
  membership?: boolean
  archived?: boolean
  page?: number
  perPage?: number
}
```

Behavior:

- only return projects within effective resource boundary;
- default to membership/access-visible projects;
- hard-cap `perPage`;
- return compact metadata, not huge project payloads.

### `gitlab_project_get`

Inputs:

```ts
{ project: ProjectRef }
```

`ProjectRef` can accept numeric ID or path for user convenience, but MUST resolve to a numeric ID before policy enforcement.

---

## 14.3 Repository read

### `gitlab_repository_tree`

Inputs:

```ts
{
  project: ProjectRef
  path?: string
  ref?: string
  recursive?: boolean
  page?: number
}
```

Guardrails:

- recursive listings MUST have result limits;
- large trees should paginate;
- do not recursively dump an entire repository into the model.

### `gitlab_repository_file_get`

Inputs:

```ts
{
  project: ProjectRef
  path: string
  ref?: string
  maxBytes?: number
}
```

Behavior:

- default ref to repository default branch only after project resolution;
- enforce max response bytes;
- return metadata separately from content;
- binary files return metadata/unsupported marker rather than arbitrary binary in context;
- LFS handling should be explicit and off by default.

### `gitlab_commits_list`

Inputs may include:

- project;
- ref;
- path;
- since/until;
- author;
- pagination.

### `gitlab_commit_get`

Return commit metadata and bounded diff summary.

### `gitlab_compare`

Compare refs/commits with bounded diff output.

---

## 14.4 Search

### `gitlab_search`

Expose an allowlisted enum rather than raw GitLab scope strings.

```ts
{
  query: string
  scope: 'projects' | 'issues' | 'merge_requests' | 'commits' | 'code' | 'notes'
  project?: ProjectRef
  group?: GroupRef
  ref?: string
  maxResults?: number
}
```

Rules:

- if resource boundary is `selected`, search MUST remain inside that boundary;
- unsupported advanced/exact-search features degrade explicitly rather than silently broadening search;
- cap result count;
- code search results return small context snippets, not whole files;
- do not allow regex by default; if implemented, make it an explicit bounded option.

---

## 14.5 Issues

### Read tools

```text
gitlab_issues_list
gitlab_issue_get
gitlab_issue_notes_list
```

Useful filters:

- state;
- assignee;
- author;
- labels;
- milestone;
- updated_after/before;
- search;
- scope.

Return confidential issues only when GitLab returns them for the authenticated user and the project passes local boundary policy.

### Write tools — phase 2

```text
gitlab_issue_comment_prepare
gitlab_issue_create_prepare
gitlab_issue_update_prepare
```

These create a local pending action and DO NOT mutate GitLab immediately.

---

## 14.6 Merge requests

### Read tools

```text
gitlab_merge_requests_list
gitlab_merge_request_get
gitlab_merge_request_changes_get
gitlab_merge_request_discussions_list
gitlab_merge_request_approvals_get
gitlab_merge_request_pipelines_list
```

The MR detail mapper SHOULD normalize:

- source/target branch;
- author/assignees/reviewers;
- state/draft status;
- merge status;
- labels/milestone;
- pipeline summary;
- approvals summary;
- web URL;
- timestamps.

Diffs MUST be size-bounded and support pagination/chunking.

### Write tools — phase 2

```text
gitlab_merge_request_comment_prepare
gitlab_merge_request_create_prepare
gitlab_merge_request_update_prepare
```

### High-risk tools — later / disabled by default

```text
gitlab_merge_request_approve_prepare
gitlab_merge_request_merge_prepare
```

Merging SHOULD remain disabled initially even when `api` scope is granted.

---

## 14.7 CI/CD

### Read tools

```text
gitlab_pipelines_list
gitlab_pipeline_get
gitlab_pipeline_jobs_list
gitlab_job_get
gitlab_job_log_get
```

Job logs MUST be truncated/chunked and secrets redacted where practical. Never assume GitLab masking catches every secret.

### Write tools — phase 2+

```text
gitlab_pipeline_run_prepare
gitlab_pipeline_retry_prepare
gitlab_job_retry_prepare
gitlab_pipeline_cancel_prepare
```

Starting a pipeline is a write action and MUST require confirmation by default because CI may deploy, destroy infrastructure, rotate data, or trigger external side effects.

Manual job play/retry should be treated equivalently.

---

## 15. Pending-action / confirmation model

Mutations are two-phase:

```text
LLM tool call
  -> provider validates + prepares action
  -> pending action stored server-side
  -> qa-surface shows exact action preview
  -> authenticated user confirms
  -> broker revalidates principal, policy, boundary, credential
  -> provider executes mutation
  -> audit result
```

Example pending action:

```json
{
  "provider": "gitlab",
  "operation": "issue.comment",
  "resource": {
    "projectId": 123,
    "issueIid": 456
  },
  "preview": {
    "project": "group/service",
    "issue": "#456 Fix timeout",
    "body": "I reproduced this on the latest main branch..."
  }
}
```

The confirmation endpoint MUST NOT trust the preview as execution input. It uses a sealed/server-side pending payload created by the provider.

Pending actions MUST:

- belong to exactly one `qa_user_id`;
- optionally belong to the originating DSH session;
- expire quickly (recommended: 10–30 minutes);
- be single-use;
- be invalidated on account disconnect;
- be re-authorized immediately before execution;
- store no plaintext token.

---

## 16. Default policy

Recommended initial policy:

```text
identity.read                  AUTO
projects.read                  AUTO
repository.read                AUTO
search.read                    AUTO
issues.read                    AUTO
merge_requests.read            AUTO
ci.read                        AUTO

comments.write                 CONFIRM
issues.write                   CONFIRM
merge_requests.write           CONFIRM
ci.run                         CONFIRM

repository.write               DENY
merge                          DENY
admin                          DENY
raw_api                        DENY
secret_management              DENY
membership_management          DENY
```

Per-installation admin policy can only reduce permissions from the provider maximum unless an explicit software release adds a new capability.

A user toggle cannot enable a capability globally disabled by the administrator.

---

## 17. Prompt-injection boundary

GitLab content is untrusted input.

This includes:

- issue bodies/comments;
- MR descriptions/discussions;
- code comments;
- repository files;
- README files;
- CI logs;
- commit messages;
- wiki content;
- snippets.

The provider and DSH integration MUST treat retrieved content as data, not instructions.

Controls:

- tool outputs should clearly identify source/resource metadata;
- retrieved content MUST NOT be able to select another integration account or credential;
- write operations always pass policy/confirmation independently of text in GitLab;
- never auto-execute a command because a GitLab file/comment says to;
- dangerous actions require user confirmation even if the instruction originated in a trusted repository;
- raw credentials must remain unavailable to the model, so prompt injection cannot exfiltrate them directly.

The official GitLab MCP documentation itself warns clients to guard against prompt injection; this provider MUST assume the same threat model.

---

## 18. Result size and context controls

GitLab can return extremely large repository content, diffs, searches, and CI logs.

Provider-wide limits:

```yaml
gitlab:
  limits:
    defaultPageSize: 20
    maxPageSize: 100
    maxToolResultBytes: 262144
    maxFileBytesToModel: 131072
    maxDiffBytesToModel: 262144
    maxJobLogBytesToModel: 262144
    maxSearchResults: 50
```

Large outputs SHOULD return:

- compact preview;
- stable continuation cursor or page token;
- metadata about truncation;
- optional blob/result-store reference if the wider integration platform has a content-addressed result store.

Do not silently truncate without marking the result.

---

## 19. Pagination

The GitLab REST API is paginated and some endpoints use different pagination behavior.

The provider SHOULD normalize pagination into a provider-level shape:

```ts
interface Page<T> {
  items: T[]
  next?: string
  truncated?: boolean
}
```

The opaque `next` token SHOULD be server-generated and signed/sealed. Do not expose arbitrary next URLs supplied by GitLab directly to the model.

A continuation token MUST bind:

- provider;
- integration account;
- resource boundary revision;
- operation;
- normalized request parameters;
- expiry.

This prevents a continuation token from being replayed under another user or after permissions changed.

---

## 20. Rate limits and retries

The provider MUST be rate-limit aware.

Requirements:

- inspect GitLab response headers where available;
- use bounded exponential backoff with jitter for retryable `429` and transient `5xx` responses;
- honor `Retry-After` when provided;
- never retry non-idempotent writes automatically unless idempotency semantics are explicit and safe;
- apply per-account concurrency limits;
- apply per-instance concurrency limits to protect self-managed GitLab;
- surface a typed `RATE_LIMITED` error with retry metadata rather than generic failure.

Possible configuration:

```yaml
gitlab:
  concurrency:
    perAccount: 4
    perInstance: 32
  retries:
    reads: 3
    writes: 0
```

---

## 21. Cache isolation

Any cache MUST include the caller/account security context.

Minimum cache namespace:

```text
gitlab:
  {qa_user_id}:
  {provider_instance_id}:
  {external_user_id}:
  {resource_boundary_rev}:
  {operation}:
  {resource_id}:
  ...
```

Never use only:

```text
project:123
mr:456
file:README.md
```

Cross-user deduplication of private GitLab content SHOULD be disabled even if byte content is identical.

Cache invalidation triggers:

- account disconnect;
- token identity changes;
- boundary revision changes;
- admin policy revision changes;
- relevant webhook events later;
- short TTL fallback.

---

## 22. Audit logging

Audit log should answer:

- which `qa-surface` user invoked an operation;
- which GitLab instance/account was used;
- which project/resource was targeted;
- which normalized operation was invoked;
- whether it was read/prepare/confirm/execute;
- policy decision;
- success/failure category;
- latency;
- request/session correlation IDs.

Audit logs MUST NOT store:

- access tokens;
- refresh tokens;
- PATs;
- OAuth client secrets;
- `Authorization` headers;
- full private source files by default;
- full CI logs by default;
- full issue/MR text unless explicitly required by an audit policy.

Prefer resource identifiers and hashes over raw bodies.

Example:

```json
{
  "event": "integration.operation",
  "provider": "gitlab",
  "principal": "qa_42",
  "instance": "corp",
  "externalUserId": 153,
  "operation": "merge_request.get",
  "projectId": 1208,
  "resource": "mr:77",
  "decision": "allow",
  "status": "success",
  "requestId": "req_..."
}
```

---

## 23. Webhooks — later phase

Webhooks are useful for:

- cache invalidation;
- notifying users about assigned/review-requested MRs;
- pipeline completion;
- issue/MR changes;
- event-driven automation.

They are NOT required for MVP.

Preferred design:

```text
GitLab project/group webhook
  -> integration-broker public webhook endpoint
  -> verify secret
  -> resolve configured instance + project
  -> enqueue normalized event
  -> invalidate cache / trigger allowed workflow
```

Important:

- webhook secret is separate from OAuth user credentials;
- webhook event does not automatically inherit permission to perform a write;
- user-specific notifications must be resolved against current integration ownership/policy;
- group webhooks may require higher GitLab tiers; project webhooks should remain supported independently;
- webhook payload is also untrusted input.

Do not automatically create one webhook per project during initial OAuth connect.

---

## 24. Official GitLab MCP server

As of this spec date, GitLab has an official MCP server at:

```text
https://<gitlab-host>/api/v4/mcp
```

It supports OAuth and is available for GitLab.com, Self-Managed, and Dedicated, but the feature is currently documented as Beta.

The provider SHOULD therefore use REST API v4 (and narrowly implemented GraphQL where justified) as the canonical MVP backend because it gives us:

- stable provider-owned operation schemas;
- explicit local authorization boundaries;
- deterministic result shaping;
- two-phase writes;
- predictable auditing;
- no accidental expansion when GitLab adds a new MCP tool.

A future `GitLabMcpTransport` MAY be added behind the same provider interface.

If added, it MUST still enforce:

- current `qa-surface` principal;
- per-user OAuth identity;
- local resource boundary;
- allowlisted tool mapping;
- local action policy;
- confirmation for writes;
- result size limits;
- audit logging.

Never expose the entire remote MCP `tools/list` to DSH automatically.

Provider-owned tools remain the public contract.

---

## 25. REST vs GraphQL strategy

Default to REST API v4 for MVP.

Use GraphQL only when it materially reduces round trips or exposes required structured data unavailable/practically awkward in REST.

Rules:

- GraphQL queries are hard-coded/constructed by provider code;
- model-provided raw GraphQL is forbidden;
- query complexity is bounded;
- results pass the same resource-boundary and size checks;
- GraphQL is an implementation detail, not a user-visible capability.

---

## 26. Error model

Normalize GitLab-specific failures to provider errors.

Suggested codes:

```text
NOT_CONNECTED
REAUTH_REQUIRED
AUTH_FORBIDDEN
RESOURCE_NOT_ALLOWED
RESOURCE_NOT_FOUND
SCOPE_REQUIRED
CONFIRMATION_REQUIRED
RATE_LIMITED
UPSTREAM_UNAVAILABLE
UPSTREAM_TIMEOUT
RESULT_TOO_LARGE
UNSUPPORTED_CONTENT
VALIDATION_ERROR
CONFLICT
OPERATION_DISABLED
```

Security behavior:

- where useful to avoid information disclosure, return `RESOURCE_NOT_FOUND` for resources outside the local boundary;
- never reveal whether another user has the requested project connected;
- do not return raw upstream error bodies if they could contain sensitive details;
- preserve a sanitized upstream request ID for debugging when available.

---

## 27. UI specification

### 27.1 Integration card

```text
GitLab
─────────────────────────────────────
● Connected
Corporate GitLab
@alice — Alice Example

AI access: 8 selected projects
Mode: Read only

[Manage access] [Enable writes] [Reconnect] [Disconnect]
```

### 27.2 Connect

```text
Connect GitLab

Instance:
  [ Corporate GitLab ▼ ]

Permissions requested:
  ✓ Profile
  ✓ Projects / issues / merge requests
  ✓ Repository read
  ✓ CI read

[Continue to GitLab]
```

No arbitrary hostname field for ordinary users.

### 27.3 Manage resources

After OAuth:

```text
AI-visible GitLab resources

Search projects/groups...

[x] platform/
    [x] api
    [x] frontend
    [ ] secrets-tools
[ ] hr/

Default: only selected resources are visible to the agent.

[Save]
```

The project picker itself runs under the user's GitLab credential, but search/list results are returned only to that authenticated user's browser request.

### 27.4 Enable writes

If the connection lacks `api` scope:

```text
Enable GitLab write actions

GitLab requires the broad `api` OAuth scope for many write APIs.
The integration will still restrict the agent to explicitly supported actions
and will ask for confirmation before each write by default.

[Re-authorize with write access]
```

Do not silently escalate scopes.

### 27.5 Confirmation

```text
Post this comment to GitLab?

Corporate GitLab
platform/api #456 — Request timeout

"I reproduced this on main..."

[Post comment] [Cancel]
```

Confirmation should clearly show instance + project + resource + exact mutation.

---

## 28. Configuration

Illustrative deployment configuration:

```yaml
integrations:
  providers:
    gitlab:
      enabled: true

      instances:
        - id: gitlab-com
          label: GitLab.com
          baseUrl: https://gitlab.com
          oauth:
            clientId: ${GITLAB_COM_CLIENT_ID}
            clientSecret: ${GITLAB_COM_CLIENT_SECRET}

        - id: corp
          label: Corporate GitLab
          baseUrl: https://gitlab.example.internal
          oauth:
            clientId: ${GITLAB_CORP_CLIENT_ID}
            clientSecret: ${GITLAB_CORP_CLIENT_SECRET}
          tls:
            caBundle: /run/secrets/corp_gitlab_ca.pem
          network:
            allowPrivateAddresses: true

      defaultPolicy:
        reads: allow
        commentsWrite: confirm
        issuesWrite: confirm
        mergeRequestsWrite: confirm
        ciRun: confirm
        repositoryWrite: deny
        merge: deny
        rawApi: deny

      limits:
        maxToolResultBytes: 262144
        maxFileBytesToModel: 131072
        maxDiffBytesToModel: 262144
        maxJobLogBytesToModel: 262144
        maxSearchResults: 50
```

`oauth.clientSecret` SHOULD resolve from infrastructure secret storage rather than a committed YAML literal.

---

## 29. Suggested repository structure

If `providers` live inside the integration-broker repository:

```text
src/
  providers/
    gitlab/
      index.ts
      provider.ts
      types.ts
      errors.ts

      auth/
        oauth.ts
        pkce.ts
        refresh.ts
        pat.ts

      client/
        gitlab-client.ts
        rest.ts
        graphql.ts
        pagination.ts
        rate-limit.ts

      policy/
        capabilities.ts
        resource-boundary.ts
        action-policy.ts

      operations/
        identity.ts
        projects.ts
        repository.ts
        search.ts
        issues.ts
        merge-requests.ts
        ci.ts

      mappers/
        project.ts
        issue.ts
        merge-request.ts
        pipeline.ts
        errors.ts

      security/
        instance-url.ts
        redaction.ts
        result-limits.ts

      __tests__/
        auth.test.ts
        isolation.test.ts
        resource-boundary.test.ts
        operations-read.test.ts
        pending-actions.test.ts
        ssrf.test.ts
        redaction.test.ts
        rate-limit.test.ts
```

Shared integration code should remain outside the provider:

```text
src/
  identity/
  vault/
  policy/
  pending-actions/
  audit/
  cache/
  providers/
```

GitLab code MUST NOT implement a parallel user/session identity system.

---

## 30. Suggested normalized types

```ts
export type GitLabProjectRef =
  | { id: number }
  | { path: string }

export interface GitLabProjectSummary {
  id: number
  pathWithNamespace: string
  name: string
  description?: string | null
  defaultBranch?: string | null
  archived: boolean
  visibility?: 'private' | 'internal' | 'public'
  webUrl: string
}

export interface GitLabIssueSummary {
  projectId: number
  iid: number
  title: string
  state: string
  confidential: boolean
  labels: string[]
  author?: UserSummary
  assignees: UserSummary[]
  webUrl: string
  createdAt: string
  updatedAt: string
}

export interface GitLabMergeRequestSummary {
  projectId: number
  iid: number
  title: string
  state: string
  draft: boolean
  sourceBranch: string
  targetBranch: string
  author?: UserSummary
  assignees: UserSummary[]
  reviewers: UserSummary[]
  webUrl: string
  createdAt: string
  updatedAt: string
}
```

Provider DTOs should be intentionally smaller and more stable than raw GitLab API response objects.

---

## 31. Security test matrix

Cross-tenant testing is release-blocking.

Use at least:

- Alice / QA account A / GitLab user A;
- Bob / QA account B / GitLab user B;
- overlapping project accessible to both;
- project accessible only to Alice;
- project accessible only to Bob;
- private project accessible to neither integration account;
- two GitLab instances if self-managed support is enabled.

Required negative tests:

1. Alice cannot supply Bob's account ID to a tool because no such argument exists.
2. Alice cannot use Bob's DSH session ID through the UI/API.
3. A continuation token issued to Alice is rejected for Bob.
4. Cached Alice results are never returned to Bob.
5. Alice cannot search outside her selected resource boundary.
6. Changing Alice boundary invalidates old continuation/cache authorization.
7. Bob cannot confirm Alice's pending write action.
8. An expired pending action cannot execute.
9. Disconnect invalidates pending actions and credential access.
10. Tool execution with no resolved principal fails closed.
11. Subagent without explicit principal inheritance cannot invoke provider tools.
12. OAuth callback with wrong user/state/instance fails.
13. OAuth state replay fails.
14. PKCE mismatch fails.
15. Redirect to a different upstream origin is rejected.
16. User-supplied/self-edited GitLab hostname cannot cause SSRF.
17. Logs/traces do not contain access tokens, refresh tokens, PATs, or Authorization headers.
18. GitLab `403`/`404` does not reveal another user's connection state.
19. Prompt injection in issue/MR/file content cannot change provider account or bypass confirmation.
20. GitLab API returning unexpectedly huge content cannot overflow configured tool-result limits.

---

## 32. Functional test matrix

### OAuth

- GitLab.com connect/disconnect/reconnect;
- self-managed connect;
- token refresh;
- refresh race;
- revoked grant;
- expired grant;
- scope upgrade read-only -> write-enabled.

### Read operations

- list/search projects;
- repository tree;
- text file read;
- binary file behavior;
- issue list/detail/notes;
- MR list/detail/changes/discussions;
- CI pipeline/job/log read;
- pagination;
- rate limiting;
- large-result truncation.

### Resource boundaries

- exact project grant;
- group grant;
- path rename with stable numeric project ID;
- project moved between namespaces;
- project removed from selected set;
- all-accessible mode;
- selected mode global-search restrictions.

### Writes

- prepare action;
- confirmation;
- cancel;
- expiration;
- policy denied;
- scope missing;
- upstream permission denied;
- upstream resource changed between prepare and confirm.

---

## 33. Observability

Emit provider metrics/traces compatible with the wider OTel-oriented stack.

Suggested metrics:

```text
integration_provider_requests_total{provider="gitlab",operation,status}
integration_provider_request_duration_seconds{provider="gitlab",operation}
integration_provider_rate_limited_total{provider="gitlab",instance}
integration_provider_auth_refresh_total{provider="gitlab",result}
integration_provider_pending_actions_total{provider="gitlab",operation,result}
integration_provider_result_truncated_total{provider="gitlab",operation}
```

Do not use usernames, project paths, issue titles, tokens, or other high-cardinality/private values as metric labels.

Traces may include safe numeric/internal identifiers according to deployment privacy policy, but should not contain source code or comment bodies by default.

---

## 34. Migration/update strategy

Provider behavior must not depend on patching GitLab or DSH core.

Compatibility rules:

- target documented GitLab REST API v4;
- isolate upstream API mapping in `mappers/`;
- keep model-facing schemas owned by this provider and version them deliberately;
- feature-detect optional GitLab endpoints/tier features;
- treat `404`/missing capability gracefully on older/self-managed GitLab versions;
- do not expose newly added upstream GitLab endpoints automatically;
- official MCP support, if added later, is another backend adapter and not a public-schema rewrite.

---

## 35. Implementation phases

### Phase 0 — shared integration prerequisites

Required before GitLab provider is considered secure:

- immutable `qa user <-> DSH session` ownership;
- `PrincipalResolver`;
- encrypted CredentialVault;
- generic integration account model;
- policy engine;
- audit/redaction middleware;
- provider execution context.

### Phase 1 — GitLab read-only MVP

Implement:

- admin-configured GitLab instances;
- OAuth + PKCE;
- token refresh;
- optional PAT fallback behind admin flag;
- `/user` identity verification;
- selected project/group boundary;
- projects read;
- repository tree/file/commits read;
- search;
- issues read;
- MRs read;
- pipelines/jobs/logs read;
- cache isolation;
- pagination/rate limiting;
- audit/OTel;
- full Alice/Bob negative test suite.

OAuth default scopes:

```text
read_user read_api read_repository
```

### Phase 2 — confirmed collaboration writes

Add explicit `api` scope upgrade and:

- issue comments;
- issue create/update;
- MR comments;
- MR create/update;
- two-phase pending action flow;
- qa-surface confirmation UI.

### Phase 3 — CI actions

Add, all confirmed by default:

- run pipeline;
- retry pipeline/job;
- cancel pipeline;
- play manual job if desired.

### Phase 4 — event-driven integration

Add:

- optional project/group webhooks;
- cache invalidation;
- notification/event normalization;
- safe scheduled/background workflows.

### Phase 5 — optional advanced operations

Consider separately:

- approvals;
- merge;
- repository writes;
- branch/tag operations;
- official GitLab MCP backend adapter;
- GraphQL optimization;
- richer code search.

Each advanced operation requires an explicit threat review and policy addition. Do not inherit `api` scope as implicit permission to expose everything.

---

## 36. Acceptance criteria for read-only MVP

The provider is MVP-ready only when all are true:

- [ ] User connects GitLab via OAuth + PKCE without exposing token to the browser after callback.
- [ ] Credential is encrypted at rest outside the DSH session store.
- [ ] DSH/model never receives credential material.
- [ ] Every call resolves identity from trusted `qa-surface`/DSH session ownership.
- [ ] No provider tool accepts another user's account/credential identifier.
- [ ] GitLab.com works if configured.
- [ ] At least one administrator-configured self-managed instance works.
- [ ] User can restrict AI access to selected numeric project/group IDs.
- [ ] Project boundary is enforced before content reaches the model.
- [ ] Projects/repository/issues/MRs/CI read tools are implemented with pagination and size limits.
- [ ] Global search cannot bypass selected-resource policy.
- [ ] Cache is namespaced by principal/account/boundary revision.
- [ ] Token refresh is race-safe and fail-closed.
- [ ] Disconnect revokes local access and deletes/invalidates stored credential material.
- [ ] Audit logs identify operations without logging secrets/content unnecessarily.
- [ ] Alice/Bob cross-tenant negative tests pass.
- [ ] SSRF tests for self-managed instance routing pass.
- [ ] Prompt-injection content cannot bypass identity, resource boundary, or action policy.

---

## 37. Open questions

These should be decided before Phase 2, but do not block read-only MVP:

1. Should one `qa-surface` user be allowed to connect multiple GitLab identities to the same configured instance?
2. Should resource selection support group inheritance automatically or require explicit project expansion?
3. Should repository content be cached at all, or only metadata/search results?
4. Should write confirmation be mandatory for every comment, or can users opt into auto-approve for low-risk writes?
5. Should pipeline retry/cancel ever support user-level auto-approval?
6. Should subagents inherit GitLab capability by default from their parent, or require an explicit delegation grant?
7. Should scheduled/background jobs be allowed to use user OAuth credentials, and how should reauthorization failures surface?
8. Should GitLab webhook configuration be automatic for selected projects or remain administrator/manual setup?
9. Should GitLab MCP become an optional backend when it exits Beta, or remain only a separately managed MCP integration?

Recommended defaults:

- multiple identities: data model yes, UI later;
- group inheritance: explicit and visible;
- repository cache: minimal/short TTL;
- comments: confirmation by default;
- CI writes: confirmation always in early versions;
- subagents: explicit principal inheritance only;
- scheduled jobs: disabled until a dedicated delegated-execution model exists;
- webhooks: opt-in;
- official MCP: optional future backend, never automatic full tool exposure.

---

## 38. Reference documentation

GitLab official documentation used for this specification:

- OAuth 2.0 identity provider API: https://docs.gitlab.com/api/oauth2/
- GitLab as OAuth provider: https://docs.gitlab.com/integration/oauth_provider/
- OAuth/token scopes: https://docs.gitlab.com/security/tokens/access_token_scopes/
- REST authentication: https://docs.gitlab.com/api/rest/authentication/
- REST API and pagination: https://docs.gitlab.com/api/rest/
- Projects API: https://docs.gitlab.com/api/projects/
- Repository Files API: https://docs.gitlab.com/api/repository_files/
- Search API: https://docs.gitlab.com/api/search/
- Issues API: https://docs.gitlab.com/api/issues/
- Notes API: https://docs.gitlab.com/api/notes/
- Merge Requests API: https://docs.gitlab.com/api/merge_requests/
- API rate limits: https://docs.gitlab.com/rate_limits/api/
- Webhooks: https://docs.gitlab.com/user/project/integrations/webhooks/
- GitLab MCP server: https://docs.gitlab.com/user/model_context_protocol/mcp_server/

---

## 39. Final implementation principle

The core security invariant is:

> Every GitLab operation is attributable to the authenticated `qa-surface`
> principal. The upstream GitLab identity is selected only by trusted
> server-side credential policy, and is either the principal's own identity or
> an administrator-managed service identity. Neither the model nor tool
> arguments can select or substitute that identity, and neither mode falls back
> to the other.

Everything else in the provider should preserve this invariant even if transports, APIs, caching, subagents, MCP support, or UI behavior change later.
