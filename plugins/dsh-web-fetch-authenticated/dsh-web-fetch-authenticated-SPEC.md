# dsh-web-fetch-authenticated — SPEC & Implementation Plan

## 1. Summary

`dsh-web-fetch-authenticated` is a DeepSeek Harness plugin that provides an authenticated `WebFetchProvider` for `ctx.web`.

Its purpose is to let the existing model-facing `web_fetch(url)` tool retrieve content from approved authenticated HTTP(S) resources — for example corporate Jira, Confluence, GitLab, internal documentation, or other intranet services — without exposing credentials to the model, tool arguments, session logs, prompts, or normal plugin configuration.

The plugin should be configurable primarily through the DeepSeek Harness Web UI, with declarative configuration remaining available as a fallback for reproducible deployments.

The core design principle is:

> The model chooses a URL. The plugin decides whether that URL is allowed, which credential may be used for it, how authentication is attached, and whether redirects are safe. The model never supplies or receives secrets.

---

## 2. Goals

The plugin must:

- register an authenticated fetch provider in `ctx.web`;
- work transparently with the existing `@deepseek-ai/dsh-tool-web` `web_fetch` tool;
- support per-origin authentication rules;
- keep secrets outside model-visible state;
- integrate with DSH credentials storage / credential references;
- provide a Web UI for creating, editing, testing, enabling, disabling, and deleting rules;
- prevent credential leakage across hosts, origins, redirects, logs, errors, and tool output;
- provide explicit SSRF/network access policy;
- support common authentication types used by enterprise services;
- support optional service-specific adapters, starting with Jira-friendly extraction as an extension rather than a hard requirement for MVP;
- remain compatible with the DSH `ctx.web` provider-selection model.

---

## 3. Non-goals

The initial plugin should not:

- expose arbitrary request headers to the LLM;
- allow the LLM to choose credentials;
- emulate a full browser;
- bypass CAPTCHA, anti-bot controls, MFA, or access restrictions;
- store browser cookies copied from a user's active session by default;
- support arbitrary POST/PUT/PATCH/DELETE operations through `web_fetch`;
- become a generic HTTP mutation tool;
- automatically trust all internal network addresses;
- automatically discover credentials from the host environment and send them to matching URLs;
- forward authentication across cross-origin redirects;
- silently broaden access when a rule does not match.

Write operations should remain the responsibility of dedicated Jira/GitLab/etc. tools or plugins.

---

## 4. Upstream DSH integration model

Current DSH separates web access into three layers:

1. `@deepseek-ai/dsh-web`
   - owns `ctx.web`;
   - owns provider registration and selection;
   - supports separate `searchProvider` and `fetchProvider` selection.

2. Fetch provider implementations
   - e.g. `@deepseek-ai/dsh-web-fetch-http`;
   - retrieve a URL and return a normalized `WebFetchResult`;
   - do not register model-facing tools.

3. `@deepseek-ai/dsh-tool-web`
   - registers `web_search` and `web_fetch`;
   - calls `ctx.web.fetch()`;
   - converts HTML to Markdown and handles model-facing presentation.

`dsh-web-fetch-authenticated` should therefore implement `WebFetchProvider`, not create a competing model-facing fetch tool.

Suggested provider id:

```text
authenticated
```

Suggested package name:

```text
@<scope>/dsh-web-fetch-authenticated
```

Suggested Cordis/plugin name:

```text
web-fetch-authenticated
```

Example selection:

```yaml
- id: web
  config:
    searchProvider: searxng
    fetchProvider: authenticated

- id: web-fetch-authenticated
  name: '@xarleyn/dsh-web-fetch-authenticated'

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    search: true
    fetch: true
```

---

## 5. User experience

### 5.1 Expected agent behavior

The agent sees only the normal DSH tool:

```text
web_fetch({
  url: "https://jira.example.corp/browse/MDC-123"
})
```

The agent does not see:

- the token;
- the credential id;
- the Authorization header;
- cookies;
- the rule definition;
- internal matching diagnostics unless explicitly exposed through admin UI.

The plugin internally performs:

```text
URL
  -> normalize
  -> policy match
  -> network policy check
  -> credential lookup
  -> auth injection
  -> request
  -> redirect validation
  -> bounded response read
  -> WebFetchResult
  -> existing dsh-tool-web HTML -> Markdown presentation
```

### 5.2 Example workflow

1. `web_search` returns:

```text
https://jira.example.corp/browse/MDC-123
```

2. Agent calls `web_fetch`.
3. The authenticated provider matches rule `Corporate Jira`.
4. It resolves credential `jira-prod-token` from DSH credential storage.
5. It adds the configured authentication internally.
6. It fetches the page/API resource.
7. It returns the body without exposing the credential.

---

## 6. UI requirements

UI configuration is a first-class requirement.

Suggested location:

```text
Settings
  -> Web
     -> Authenticated Fetch
```

Alternative if DSH plugin settings cannot inject into the Web section cleanly:

```text
Settings
  -> Plugins
     -> Authenticated Web Fetch
```

### 6.1 Overview screen

Show:

- provider status;
- whether `ctx.web.fetchProvider` currently points to `authenticated`;
- whether `web_fetch` is enabled in `tool-web`;
- rule count;
- enabled rule count;
- configuration errors;
- last test status per rule;
- security warning when broad/private-network access is enabled.

Suggested rule table columns:

| Field | Example |
|---|---|
| Name | Corporate Jira |
| Origin | `https://jira.example.corp` |
| Paths | `/browse/**`, `/rest/api/**` |
| Auth | Bearer token |
| Credential | `jira-prod-token` |
| Status | Enabled |
| Last test | Success |

Secret values must never appear in this table.

### 6.2 Add/Edit Rule dialog

Sections:

#### Identity

- Rule name
- Description
- Enabled toggle

#### Match

- Scheme: HTTPS only by default
- Hostname / origin
- Optional port
- Allowed path patterns
- Optional denied path patterns
- Optional query policy

#### Authentication

Authentication type selector:

- None
- Bearer token
- Basic auth
- API key header
- API key query parameter — disabled or strongly discouraged by default
- Cookie header — advanced / opt-in
- Custom static headers — advanced, secret values only through credential refs
- OAuth 2.0 client credentials — later phase

#### Credential

Secret entry should use DSH's existing credential UX semantics:

- write-only secret field;
- stored in `$DSH_HOME/.credentials.yaml` or the current credential backend;
- ordinary settings store only a credential reference;
- UI returns only a redacted descriptor;
- replacing a credential should not reveal the previous value.

Support:

- Create new credential
- Select existing credential
- Replace credential
- Remove credential reference

#### Network policy

- Allow public IPs
- Allow private networks
- Allow loopback
- Allow link-local
- Allow Docker/internal ranges
- Allowed CIDRs
- Denied CIDRs
- Resolve hostname before every request
- Re-check every redirect target

Defaults should be restrictive.

#### Redirect policy

Default:

```text
same-origin only
```

Options:

- no redirects;
- same-origin only;
- explicit origin allowlist.

Authentication must never be forwarded to an origin that is not explicitly authorized by the same rule.

#### Response limits

- timeout;
- max redirects;
- max response bytes;
- max decoded body chars;
- accepted MIME types;
- custom User-Agent.

### 6.3 Test Connection

Each rule should have a `Test` action.

Test inputs:

- URL
- optionally a safe default URL configured for the rule

Test output:

- matched rule;
- DNS/IP classification;
- final origin;
- HTTP status;
- content type;
- response size;
- redirect count;
- elapsed time;
- auth applied: `yes/no` only;
- credential state: `configured/missing/invalid`;
- a short sanitized response preview.

Never display:

- Authorization header;
- Cookie header;
- API key;
- raw credential values.

### 6.4 Diagnostics

Provide an optional admin/debug view:

```text
URL: https://jira.example.corp/browse/MDC-123
Matched rule: Corporate Jira
Credential: jira-prod-token (configured)
Resolved addresses: 10.20.14.18
Network class: private
Private access permitted by rule: yes
Redirects: 0
HTTP status: 200
Content-Type: text/html; charset=utf-8
Bytes: 48123
```

This output must remain sanitized.

---

## 7. Configuration model

Suggested TypeScript model:

```ts
interface Config {
  rules: AuthenticatedFetchRule[]
  defaultPolicy?: DefaultPolicy
  limits?: GlobalLimits
  audit?: AuditConfig
}

interface AuthenticatedFetchRule {
  id: string
  name: string
  description?: string
  enabled: boolean

  match: {
    schemes?: Array<'https' | 'http'>
    hosts: string[]
    ports?: number[]
    allowPaths?: string[]
    denyPaths?: string[]
  }

  auth: AuthConfig
  networkPolicy?: NetworkPolicy
  redirectPolicy?: RedirectPolicy
  limits?: FetchLimits
  headers?: HeaderRule[]
}
```

Example declarative config:

```yaml
- id: web-fetch-authenticated
  name: '@xarleyn/dsh-web-fetch-authenticated'
  config:
    rules:
      - id: corp-jira
        name: Corporate Jira
        enabled: true

        match:
          schemes: [https]
          hosts:
            - jira.example.corp
          allowPaths:
            - /browse/**
            - /rest/api/**

        auth:
          type: bearer
          credential: jira-prod-token

        networkPolicy:
          allowPrivate: true
          allowLoopback: false
          allowLinkLocal: false

        redirects:
          mode: same-origin
          maxRedirects: 3
```

The UI should edit the same underlying model instead of maintaining a separate hidden config representation.

---

## 8. Authentication types

### 8.1 Bearer token — MVP

```ts
{
  type: 'bearer'
  credential: CredentialRef
}
```

Runtime header:

```text
Authorization: Bearer <secret>
```

### 8.2 Basic auth — MVP

Preferred representation:

```ts
{
  type: 'basic'
  username: string
  passwordCredential: CredentialRef
}
```

or both fields as credentials if usernames should also be secret.

### 8.3 API key header — MVP

```ts
{
  type: 'header'
  headerName: 'X-API-Key'
  credential: CredentialRef
  prefix?: string
}
```

Header name must be validated against a denylist to prevent configuration of dangerous transport headers.

Disallow at minimum:

- Host
- Content-Length
- Transfer-Encoding
- Connection
- Proxy-Authorization
- Proxy-Authenticate

### 8.4 Cookie auth — Phase 2 / advanced

```ts
{
  type: 'cookie'
  credential: CredentialRef
}
```

This mode should display a strong warning because copied browser session cookies are often short-lived and high privilege.

### 8.5 OAuth 2.0 — Phase 2

Support initially:

- client credentials grant;
- token endpoint;
- client id;
- client secret credential;
- scope;
- audience where applicable;
- cached access token with expiry.

OAuth refresh/access tokens must remain internal and never enter model output.

Interactive SSO/device authorization should be a later feature due to significantly greater complexity.

---

## 9. Rule matching

Rules must be deterministic and fail closed.

Recommended matching order:

1. scheme;
2. normalized hostname;
3. port;
4. path deny patterns;
5. path allow patterns;
6. optional query policy.

Rules must not match via substring.

Bad:

```text
host.includes('jira.example.com')
```

Good:

```text
normalized hostname exact match
```

Optional wildcard support may be added later:

```text
*.example.corp
```

If wildcard hosts are supported, their semantics must be explicit and tested against lookalike domains.

Example:

```text
*.example.corp
```

may match:

```text
jira.example.corp
wiki.example.corp
```

but must not match:

```text
example.corp.attacker.com
fooexample.corp
```

---

## 10. SSRF and network security

This is the most important security component of the plugin.

Unlike the upstream anonymous fetch provider, this plugin is explicitly intended to access authenticated internal systems. Therefore it cannot simply deny all private addresses; instead access must be controlled per rule.

### 10.1 Address classification

Classify resolved destinations at least as:

- public;
- loopback;
- RFC1918/private;
- link-local;
- carrier-grade NAT;
- IPv6 unique-local;
- IPv6 loopback;
- multicast;
- unspecified;
- metadata/service ranges where known.

### 10.2 DNS rebinding protection

For every request:

1. resolve hostname;
2. classify all resolved addresses;
3. ensure every candidate address satisfies the rule;
4. connect in a way that does not allow re-resolution to bypass policy where feasible;
5. repeat checks for redirects.

Do not authorize based only on the hostname string.

### 10.3 Cloud metadata

Block common metadata targets by default, including:

```text
169.254.169.254
```

and equivalent IPv6/link-local metadata endpoints.

Metadata ranges should require an explicit dangerous override and ideally should never be supported in the first release.

### 10.4 Credential boundary

A credential belongs to a matching rule, not to the entire fetch provider.

Authentication may be attached only after:

- URL validation;
- rule matching;
- network-policy approval.

### 10.5 Redirect handling

For each redirect:

1. parse target;
2. normalize;
3. match redirect policy;
4. re-run network checks;
5. decide whether auth may be attached.

Default behavior:

```text
same-origin redirect -> keep auth
cross-origin redirect -> reject
```

Do not implement browser-like automatic credential forwarding.

---

## 11. Header security

The plugin should construct headers itself.

Suggested flow:

```text
base headers
  + configured non-secret headers
  + User-Agent
  + authentication
```

The model must not be able to supply headers.

Before logging a request, sanitize at least:

- Authorization
- Proxy-Authorization
- Cookie
- Set-Cookie
- configured secret header names
- OAuth token fields

Use centralized redaction utilities rather than manual redaction at individual log calls.

---

## 12. Credential storage

Follow the existing DSH credential pattern.

Desired properties:

- secret values stored in DSH credential storage;
- config contains only references;
- UI treats secrets as write-only;
- reading settings returns redacted descriptors;
- secret replacement supported;
- deleting a rule should optionally leave or delete its credential;
- credential names should be stable IDs, not secret-derived values.

Suggested API abstraction inside the plugin:

```ts
interface CredentialResolver {
  resolve(ref: CredentialRef): Promise<string>
  available(ref: CredentialRef): boolean
}
```

The exact integration should reuse upstream DSH credential services rather than introduce a separate plaintext secrets file.

---

## 13. Provider availability

`available()` should return true when the provider itself is operational, not only when every configured rule has valid credentials.

Individual requests should fail with structured errors such as:

```text
AUTH_FETCH_NO_MATCHING_RULE
AUTH_FETCH_RULE_DISABLED
AUTH_FETCH_CREDENTIAL_MISSING
AUTH_FETCH_CREDENTIAL_INVALID
AUTH_FETCH_NETWORK_DENIED
AUTH_FETCH_REDIRECT_DENIED
AUTH_FETCH_RESPONSE_TOO_LARGE
AUTH_FETCH_UNSUPPORTED_CONTENT
AUTH_FETCH_TIMEOUT
AUTH_FETCH_DNS_POLICY_DENIED
```

The existing `ctx.web` / `WebError` taxonomy should be reused where possible; plugin-specific reason codes may be embedded in safe error details if upstream types do not support extension codes cleanly.

Error messages exposed to the model must not contain credentials.

---

## 14. Fetch behavior

The implementation should reuse as much semantics as possible from upstream `dsh-web-fetch-http`:

- URL validation;
- HTTP(S) only;
- timeout handling;
- AbortSignal propagation;
- bounded byte reads;
- charset detection;
- text MIME classification;
- binary rejection;
- same-origin redirect semantics;
- non-2xx responses represented as fetch results rather than transport exceptions where appropriate.

Do not fork large upstream files unless necessary.

Preferred implementation options, in order:

1. Extract/reuse public helpers exported by upstream if available.
2. Depend on the upstream package where stable APIs permit composition.
3. Copy a small, clearly attributed subset of policy logic if no reusable API exists.
4. Avoid monkey-patching the existing provider.

---

## 15. Jira support

### 15.1 MVP

Jira should work as a normal authenticated HTTP endpoint.

Example:

```text
https://jira.example.corp/browse/MDC-123
```

The provider authenticates and returns HTML, while `dsh-tool-web` converts it to Markdown.

### 15.2 Jira-aware adapter — Phase 2

Add optional per-rule adapter:

```yaml
adapter: jira
```

When a URL matches:

```text
/browse/<ISSUE-KEY>
```

plugin may internally fetch Jira REST API instead:

```text
/rest/api/2/issue/<ISSUE-KEY>
```

or the appropriate API version configured for that Jira instance.

Return normalized textual content containing:

- issue key;
- summary;
- status;
- description;
- assignee;
- reporter;
- priority;
- labels;
- components;
- selected custom fields;
- comments when enabled;
- links/relationships when enabled.

Benefits:

- less HTML noise;
- fewer tokens;
- more stable parsing;
- easier access-control diagnostics.

The adapter must be optional because Jira Server/Data Center/Cloud instances differ.

Suggested UI:

```text
Content adapter:
  [ Raw HTTP/HTML ]
  [ Jira ]
```

With Jira-specific fields shown only when selected.

---

## 16. Rule routing vs provider routing

The plugin should be a single `ctx.web` fetch provider capable of selecting authentication rules internally.

Do not register one `WebFetchProvider` per credential or per origin unless DSH later exposes provider selection based on URL.

Recommended:

```text
ctx.web.fetchProvider = authenticated
                     |
                     v
        AuthenticatedFetchProvider
                     |
              internal rule router
             /        |        \
          Jira     Confluence   GitLab
```

This keeps `web_fetch` unchanged and avoids forcing the model to know provider ids.

---

## 17. Fallback behavior

A key product decision is what happens when no authenticated rule matches.

Recommended modes:

### Strict — recommended default

```text
No rule match -> fail
```

This is safest and predictable.

### Public fallback — optional

```text
No auth rule match -> delegate to anonymous fetch provider
```

This is convenient but requires careful architecture because `ctx.web` normally selects one fetch provider.

If implemented, the authenticated plugin should internally compose/delegate to a public transport implementation rather than recursively call `ctx.web.fetch()`.

UI option:

```text
Unmatched URLs:
  (*) Block
  ( ) Fetch anonymously
```

For the MVP, use `Block` only.

---

## 18. Permissions and approvals

Optional but desirable integration:

Authenticated fetches represent access to privileged systems and may deserve stronger visibility than public web fetches.

Possible policy metadata:

```text
Public fetch          -> normal web permission
Authenticated fetch   -> authenticated-network-read permission
```

If DSH exposes extensible permission categories, consider registering:

```text
web.authenticated.read
```

UI can then support:

- always allow;
- ask;
- deny;
- per-origin approval.

If upstream permission hooks do not permit this cleanly, leave it for Phase 2 rather than inventing a parallel confirmation system.

---

## 19. Audit logging

Authenticated fetches should be auditable without logging secrets or full sensitive response content.

Suggested audit record:

```ts
{
  timestamp,
  ruleId,
  origin,
  path,
  status,
  contentType,
  responseBytes,
  redirectCount,
  durationMs,
  credentialRefId,
  outcome
}
```

Do not log:

- credential value;
- Authorization header;
- Cookie value;
- full response body by default;
- sensitive query values when query redaction is configured.

UI should allow audit logging to be disabled or restricted.

---

## 20. Observability

Optional OTel metrics:

```text
dsh.auth_fetch.requests
dsh.auth_fetch.errors
dsh.auth_fetch.duration
dsh.auth_fetch.response_bytes
dsh.auth_fetch.redirects
dsh.auth_fetch.policy_denied
dsh.auth_fetch.credential_missing
```

Attributes should be low-cardinality:

- rule id;
- outcome;
- auth type;
- status class;
- network class.

Avoid raw URLs as metric labels.

Traces may include sanitized host/path if policy permits.

---

## 21. UI data safety

The UI backend must enforce the same secrecy guarantees as the fetch runtime.

A frontend should never receive the stored secret merely because a settings form is opened.

Credential field state should look like:

```json
{
  "configured": true,
  "credentialRef": "jira-prod-token",
  "display": "••••••••"
}
```

not:

```json
{
  "value": "actual-secret"
}
```

Browser devtools/network inspection must not reveal stored secrets after they are saved.

---

## 22. Suggested repository structure

```text
dsh-web-fetch-authenticated/
├── package.json
├── README.md
├── LICENSE
├── CHANGELOG.md
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── provider.ts
│   ├── errors.ts
│   │
│   ├── auth/
│   │   ├── index.ts
│   │   ├── bearer.ts
│   │   ├── basic.ts
│   │   ├── header.ts
│   │   └── oauth2.ts
│   │
│   ├── policy/
│   │   ├── match.ts
│   │   ├── url.ts
│   │   ├── network.ts
│   │   ├── dns.ts
│   │   ├── redirect.ts
│   │   └── headers.ts
│   │
│   ├── credentials/
│   │   └── resolver.ts
│   │
│   ├── transport/
│   │   ├── fetch.ts
│   │   ├── body.ts
│   │   └── charset.ts
│   │
│   ├── adapters/
│   │   ├── index.ts
│   │   └── jira.ts
│   │
│   ├── audit/
│   │   ├── logger.ts
│   │   └── redact.ts
│   │
│   └── ui/
│       ├── index.ts
│       ├── routes.ts
│       ├── schemas.ts
│       └── components/
│           ├── AuthenticatedFetchSettings.tsx
│           ├── RuleList.tsx
│           ├── RuleEditor.tsx
│           ├── CredentialField.tsx
│           └── RuleTestDialog.tsx
│
└── test/
    ├── provider.test.ts
    ├── matching.test.ts
    ├── redirects.test.ts
    ├── network-policy.test.ts
    ├── dns-rebinding.test.ts
    ├── credential-redaction.test.ts
    ├── response-limits.test.ts
    ├── ui-api.test.ts
    └── fixtures/
```

If the DSH plugin repository architecture prefers client/server packages, split into:

```text
packages/core
packages/ui
```

only when required; avoid premature monorepo complexity for a single plugin.

---

## 23. Suggested configuration schema defaults

Security-oriented defaults:

```yaml
httpsOnly: true
allowPrivate: false
allowLoopback: false
allowLinkLocal: false
allowCGNAT: false
allowIPv6ULA: false
maxRedirects: 3
redirectMode: same-origin
timeoutMs: 30000
maxResponseBytes: 5242880
maxBodyChars: 100000
unmatchedPolicy: block
```

A rule for corporate Jira can explicitly enable private destinations:

```yaml
networkPolicy:
  allowPrivate: true
  allowedCidrs:
    - 10.20.0.0/16
```

Prefer narrow CIDRs over `allowPrivate: true` where practical.

---

## 24. UI validation rules

Reject configuration when:

- rule has no hosts;
- auth mode requires a missing credential;
- HTTPS is disabled without an explicit advanced acknowledgement;
- path pattern is malformed;
- CIDR is malformed;
- redirect allowlist is broader than intended;
- secret header name is unsafe;
- two rules have ambiguous equal-priority matches;
- Jira adapter is selected without a valid Jira base origin.

Warn, but optionally allow, when:

- entire RFC1918 space is allowed;
- `http://` is allowed;
- cookies are used;
- wildcard host matching is enabled;
- broad path `/**` is configured;
- raw HTML mode is used for Jira/Confluence;
- anonymous fallback is enabled.

---

## 25. Rule priority

MVP recommendation: prohibit ambiguous matches rather than invent implicit priority.

Later option:

```ts
priority?: number
```

Then select:

1. highest priority;
2. most-specific host;
3. most-specific path;
4. fail if still ambiguous.

Configuration UI should detect ambiguity before saving.

---

## 26. Testing plan

### 26.1 Unit tests

Cover:

- exact host matching;
- path allow/deny matching;
- HTTPS-only behavior;
- header creation;
- Bearer auth;
- Basic auth;
- API-key auth;
- redaction;
- size limits;
- timeout handling;
- malformed URLs;
- unsupported schemes.

### 26.2 Security tests

Mandatory cases:

```text
https://jira.example.corp.attacker.com
https://jira.example.corp@attacker.com
https://attacker.com/?next=https://jira.example.corp
http://127.0.0.1
http://[::1]
http://169.254.169.254
http://10.0.0.1
mixed public/private DNS answers
DNS rebinding simulation
cross-origin redirect
same-origin redirect
redirect to private address
redirect to metadata address
credential redaction in thrown errors
credential redaction in debug logs
```

### 26.3 Integration tests

Run local fixture servers for:

- public endpoint;
- Basic auth endpoint;
- Bearer auth endpoint;
- redirect endpoint;
- oversized response;
- slow response;
- Jira-like API endpoint.

Verify full path:

```text
dsh-tool-web -> ctx.web -> authenticated provider -> fixture
```

### 26.4 UI tests

Verify:

- create rule;
- edit rule;
- save secret;
- reload UI without secret disclosure;
- replace secret;
- test connection;
- validation errors;
- delete rule;
- disabled rule behavior.

---

## 27. Compatibility strategy

Avoid reliance on undocumented internals when possible.

Primary stable dependencies should be:

```text
@deepseek-ai/dsh-web
DSH credential service/public credential abstractions
Cordis plugin configuration API
official Web UI/plugin extension API
```

The coding agent should inspect the exact DSH version before implementation and document every non-public integration point.

If UI settings require internal Web UI APIs, isolate them behind a small compatibility layer:

```text
src/dsh-compat/
```

Example:

```text
src/dsh-compat/credentials.ts
src/dsh-compat/settings-ui.ts
src/dsh-compat/plugin-routes.ts
```

This minimizes breakage during DSH upgrades.

---

## 28. Migration and persistence

Rules should have stable UUID/string ids independent of display names.

Configuration migration mechanism:

```ts
configVersion: 1
```

Future loaders can migrate:

```text
v1 -> v2
```

without forcing manual edits.

Credentials should not be duplicated during migrations.

---

## 29. Initial implementation phases

### Phase 0 — DSH API investigation

Before coding:

- inspect current `WebFetchProvider` interface;
- inspect `WebFetchRequest` / `WebFetchResult`;
- inspect `WebError` extension possibilities;
- inspect `dsh-web-fetch-http` helpers and determine reuse strategy;
- inspect DSH credential service and `CredentialRef` APIs;
- inspect current plugin UI extension points;
- inspect settings persistence APIs;
- inspect permission system hooks;
- produce a short `INVESTIGATE.md` with exact APIs/version assumptions.

Exit criterion:

> No core architectural dependency remains based on guesswork.

### Phase 1 — Core provider MVP

Implement:

- provider registration;
- exact host/path rules;
- Bearer auth;
- Basic auth;
- API-key header auth;
- credential resolution;
- HTTPS-only default;
- same-origin redirects;
- timeout/body limits;
- centralized redaction;
- strict unmatched-URL rejection.

No UI required to validate core behavior initially.

### Phase 2 — Network security

Implement:

- IP classification;
- private CIDR policy;
- loopback/link-local denial;
- DNS checks;
- redirect re-checking;
- metadata protection;
- DNS-rebinding-oriented tests.

Do not release publicly before this phase is complete.

### Phase 3 — Settings UI

Implement:

- rule list;
- rule editor;
- credential picker/write-only secret field;
- network policy editor;
- redirect settings;
- connection tester;
- validation;
- provider status card.

At the end of this phase, a normal user should not need to edit YAML.

### Phase 4 — Jira adapter

Implement optional Jira mode:

- `/browse/KEY` recognition;
- REST API retrieval;
- Markdown normalization;
- field selection;
- optional comments;
- Jira Server/Data Center/Cloud configuration differences.

### Phase 5 — OAuth and advanced auth

Implement:

- OAuth client credentials;
- token cache;
- expiry/refresh;
- optional cookie mode;
- advanced custom headers.

### Phase 6 — Observability and audit

Implement:

- sanitized audit events;
- OTel metrics;
- optional traces;
- UI diagnostics/history.

---

## 30. MVP acceptance criteria

MVP is complete when all of the following are true:

1. DSH can select provider id `authenticated` as `ctx.web.fetchProvider`.
2. Existing `web_fetch(url)` can retrieve an authenticated test endpoint.
3. Agent/model never sees the secret.
4. Bearer, Basic, and API-key-header auth work.
5. An unconfigured origin is rejected.
6. Cross-origin redirect with auth is rejected.
7. Loopback/link-local/private destinations are denied unless explicitly permitted.
8. Response size and timeout limits are enforced.
9. Logs/errors are credential-redacted.
10. Rules can be created and edited through the DSH Web UI.
11. Credentials can be entered through write-only UI fields and survive restart.
12. Opening the settings page after restart does not return secret values to the browser.
13. Connection test is available from UI.
14. Automated security tests cover SSRF and redirect credential leakage.

---

## 31. Recommended first real-world rule

Example corporate Jira rule:

```yaml
id: jira-corp
name: Corporate Jira
enabled: true

match:
  schemes:
    - https
  hosts:
    - jira.company.internal
  allowPaths:
    - /browse/**
    - /rest/api/**

auth:
  type: bearer
  credential: jira-company-token

networkPolicy:
  allowPrivate: true
  allowedCidrs:
    - 10.40.0.0/16
  allowLoopback: false
  allowLinkLocal: false

redirectPolicy:
  mode: same-origin
  maxRedirects: 3

limits:
  timeoutMs: 30000
  maxResponseBytes: 5242880
  maxBodyChars: 100000
```

The UI should be able to produce this effective configuration without asking the user to touch YAML.

---

## 32. Security invariants

These should be documented in code and tested as invariants:

1. **A model-visible value must never contain an authentication secret.**
2. **Credentials are selected only by trusted configuration, never by model input.**
3. **No credential is attached before origin and network policy pass.**
4. **Credentials never cross an unauthorized origin boundary.**
5. **Redirect targets undergo the same security evaluation as initial URLs.**
6. **Rules fail closed when ambiguous or invalid.**
7. **UI reads never return stored secret values.**
8. **Logs and telemetry are treated as potential exfiltration channels and are redacted centrally.**
9. **Private-network access is explicit per rule, not globally implied by authenticated mode.**
10. **`web_fetch` remains a read-only capability.**

---

## 33. Decisions recommended for v1

Use these defaults unless implementation constraints in current DSH require otherwise:

- provider id: `authenticated`;
- existing `web_fetch` tool, no new LLM-facing tool;
- strict no-match behavior;
- exact hosts only;
- HTTPS only;
- GET only;
- same-origin redirects only;
- Bearer + Basic + API-key-header auth;
- DSH credential references only;
- UI-first configuration;
- declarative YAML supported as fallback;
- deny private/loopback/link-local by default;
- allow private ranges only per rule;
- no browser-session auth in v1;
- no OAuth interactive SSO in v1;
- no anonymous fallback in v1;
- Jira adapter after generic authenticated fetching is stable.

---

## 34. Sources / upstream assumptions checked when writing this spec

This plan is based on the current DeepSeek Harness architecture where:

- `@deepseek-ai/dsh-web` owns `ctx.web` and independently selects search/fetch providers;
- `@deepseek-ai/dsh-web-fetch-http` is an anonymous HTTP(S) provider that intentionally carries no browser cookies or ambient credentials;
- the upstream HTTP provider enforces same-origin redirects and acquisition limits but explicitly notes that private-network/SSRF protection is not implemented;
- `@deepseek-ai/dsh-tool-web` exposes `web_fetch` over `ctx.web` and handles HTML-to-Markdown presentation;
- DSH's model provider UI already follows a write-only credential pattern where literal secrets are kept in the credential store and settings retain references/redacted descriptors.

Before implementation, Phase 0 must re-check these APIs against the exact DSH version used by the target deployment.

