# SPEC — dsh-qa-surface accounts and entry routing

Status: implemented (this document is the design record).
Scope: `plugins/dsh-qa-surface` plus the external `qa-deploy` kit
(proxy + launcher). The DSH harness itself is not modified.

## Goals

1. A LAN visitor who opens the server root lands on the QA surface, not the
   full harness UI; the loopback operator keeps the harness root as-is.
2. A LAN visitor without the host browser-auth cookie is transparently sent
   through the one-time `?token=` exchange and returned to `/qa` without ever
   handling the launch token manually.
3. QA users identify themselves with an email + password account. Existing
   per-browser chats migrate to the account on first login. Session ownership
   is enforced server-side on the plugin's admission boundary.

## Non-goals / honest boundary

- The host launch token remains a master key: `/api` RPC requires the
  host-auth cookie (`rpc-host.ts` rejects 401 without it), so every QA user
  must hold it, and with it the full harness UI is technically reachable.
  Accounts gate the QA surface and the plugin's own remotes server-side; they
  do not isolate a determined user from the harness. This is documented in the
  deployment kit and the disclaimer stays visible in the UI.
- No email verification (no SMTP): the email is an identifier, not a contact
  channel.
- No admin UI for user management in this phase; the first registered account
  becomes `admin`, later roles change via the accounts file.

## Wire design: explicit account token, not cookies

Typert remotes receive only `(endpoint, payload, signal)` — the HTTP request
never reaches a remote method (`packages/client/connection/src/rpc-host.ts`,
`rpcFetchHandler`), so a cookie-based gate inside remotes is impossible
without harness changes. Named plugin routes do see `req`/`res`, but keeping
auth on a parallel HTTP surface would leave the existing typert remotes
unguarded.

Therefore the account credential is an explicit first argument on every
gated remote, and login/register return it in the value:

- `accountsLogin(email, password)` → `{ token, user }`
- `accountsRegister(email, password, displayName?)` → `{ token, user }`
- `accountsWhoami(token)` → `{ authenticated: true, user } | { authenticated: false }`
- `accountsClaimSessions(token, sessionIds)` → `{ claimed, conflicts }`
- `accountsOwnedSessions(token)` → `{ ids }`
- `accountsListOwnership(token)` → `{ entries: [{ sessionId, userId,
displayName, claimedAt }] }` — admin-only (`admin-required` refusal for
  ordinary accounts, `auth-required` for anonymous)
- `secureSession(token, sessionId)` — now requires a valid token when
  accounts are enabled
- `sources(token, sessionId)`, `readSourceFile(token, sessionId, path)` — same

`createSession(token)` is the only QA creation path. It returns a session id;
ownership reservation, Workspace resolution, cwd, preset, model, and first
attestation are all Host-owned.

The token is an HMAC-SHA256-signed `v1.<payload>.<sig>` string
(payload `{ uid, exp }`) keyed by a secret generated once and persisted in
the accounts file. The browser keeps it in `localStorage` under the
deployment's per-route key. Login/register failures are coarse (same message
for unknown email and wrong password); registration rejects duplicate emails;
a per-store in-memory counter rate-limits auth attempts.

## Server: accounts store and admission

- File: `$DSH_HOME/qa-accounts.json` (env fallback: process cwd). Shape:
  `{ version, secret, users: [{ id, email, displayName, role, passwordHash,
createdAt, lastLoginAt }], ownership: { [sessionId]: { userId, claimedAt } } }`.
  Written atomically (temp file + rename), all mutations synchronous.
- Passwords: scrypt with per-user salt, timing-safe comparison.
- Roles: `user` | `admin`. The first registered user becomes `admin`.
  Admins bypass the ownership refusal; per-user workspace attestation still
  resolves the chat owner's directory rather than the admin's. Non-admins get
  a coarse `session-owned-elsewhere` refusal for another user's session.
- Claim rule (first come, first served): attesting an _unowned_ session claims
  it for the requesting user (this is how pre-accounts sessions migrate when
  an old browser re-opens its `activeId` without a bulk claim). Bulk claims
  from the client's local index follow the same rule; conflicting ids are
  reported back and dropped from that browser's index.
- `QaPolicyAdmission.secureSession` gains an optional accounts gate: when
  `accounts.enabled`, an invalid/expired token refuses with
  `auth-required` before any policy work.

With `accounts.perUserWorkspace`, the registered `session.workspaceId`
resolves the base path and each account receives `.qa-users/<account UUID>`.
These children are not registered DSH Workspaces. The effective
`workspace-write` sandbox is supplemented with a canonical read/write path
guard, subagent inheritance, process/git/LSP denial, and fixed 10 MiB
per-write / 256 MiB total limits.

## Entry redirect (host-injected script)

The plugin listens to the `webserver/index-inject` event and pushes one
inline `script` row into the served root `index.html` (config
`entry.redirectNonLoopback`, default true):

- Skip when the navigation marker (`__dsh_qa_route`) is present — the `/qa`
  route hands off through `/?__dsh_qa_route=…` and a naive redirect would
  loop.
- Skip when `?ui=admin` is set (also persists the choice under the
  deployment's storage key); `?ui=qa` clears the choice.
- Skip when the persisted choice is `admin`.
- Otherwise redirect non-loopback hostnames (`localhost`, `127.0.0.1`,
  `::1`, `*.localhost`) to `/qa`. The check is client-side on
  `location.hostname` **on purpose**: behind the qa-deploy proxy every
  request appears loopback to the server, and the operator convention is
  "operator uses localhost, QA users use the LAN address".

The script is defensive (try/catch, no dependency on bundle load) and never
redirects when the plugin is disabled or the flag is off.

## Client: accounts controller and auth gate

- `QaAccountsController` owns the state machine
  `checking → anonymous → authed`, the token persistence, login/register
  calls, the one-shot migration claim (local chat index → `claimSessions`)
  after each successful login/registration, and the owned-session id list
  that backs the sidebar.
- `QaSurface` renders a full-frame `QaAuthGate` (login/register tabs, email +
  password, coarse errors, busy state) instead of the chat while accounts are
  enabled and the user is anonymous; the session controller is not created
  until `authed`, so nothing attests or sends before login.
- `QaSessionController` threads the token into `secureSession`/`sources`/
  `readSourceFile` calls and merges the owned-session list into the chat
  index; newly created chats are claimed at creation time. When accounts are
  disabled the controller behaves exactly as before.
- An attestation refusal with reason `auth-required` re-opens the gate
  (token expired/rotated) instead of surfacing the generic configuration
  error.
- A small account chip (email, role, logout) lives in the sidebar footer;
  logout clears the token and returns to the gate.

## Admin ownership views

When `accounts.showOtherUsersChats: true`, the admin sidebar switches from the
flat list to per-owner sections. The option defaults to false, so admins see
only their own chats unless the deployment explicitly opts in.
`accountsListOwnership` returns every ownership entry with the owner's
display name resolved at read time (disabled accounts still name their
chats), the controller merges those session ids into the visible list, and
`QaSidebar` renders one section per owner ordered by its freshest chat, with
unclaimed chats trailing under "Без владельца". Search filters rows first,
so empty sections disappear while searching. Ordinary accounts and
deployments with accounts disabled keep the exact flat list as before.

The same data drives author labels: user messages carry an `author` byline
with the chat owner's display name, but only for an admin reading a foreign
chat — the owner themself sees no label, and authorship is chat-level (the
ownership map), not per-message. Admins replying inside someone else's chat
are therefore labeled with the chat owner, not with their own name; the
per-message identity channel (the client-minted `requestId` on
`session/prompt`) is a possible future refinement.

## Config surface

```yaml
accounts:
  enabled: false # opt-in; the qa-deploy profile patch turns it on
  allowRegistration: true # self-service signup in the gate
  sessionTtlDays: 30 # account token lifetime
  showOtherUsersChats: false # opt-in cross-user admin view
  perUserWorkspace: false # private child cwd below session.workspaceId
entry:
  redirectNonLoopback: true # the root → /qa script above
```

No file paths or secrets are configurable through the schema: the store path
is derived from `DSH_HOME` internally, and `describe()` (the LAN config
channel) keeps projecting only client-safe values.

## qa-deploy kit (external repo)

- `run-qa.sh` extracts the launch token from the boot banner
  (`dsh web: …?token=…`) and starts `proxy.mjs` in front of the harness
  (default proxy port 8088, `DSH_QA_PROXY=0` to disable). LAN visitors are
  pointed at the proxy address; the operator keeps the direct loopback URL.
- `proxy.mjs` gains the transparent exchange: a GET/HEAD page navigation to
  `/` or `/qa…` without a `dsh-auth-` cookie and without `?token=` gets a 302
  to `/?token=<TOKEN>`; the harness exchanges it (server-side 303) and the
  injected script finishes the trip to `/qa`. Everything else passes through
  unchanged (Host/Origin rewrite, polyfill, WS splice).
- The profile patch (`profile/cordis.patch.yml`) enables
  `accounts.enabled`, keeping self-registration on.

## Testing

- Store: scrypt round-trip, duplicate-email rejection, first-user-admin,
  atomic persistence, token sign/verify/expire, ownership claim/conflict.
- Admission: token-less refusal when enabled, ownership refusal, admin
  bypass, unowned auto-claim, disabled passthrough.
- Entry redirect: script text guards (marker, `ui=admin`/`?ui=qa`,
  loopback hostnames, disable flag), injection through the index-inject
  event.
- Client: controller state machine, migration claim, token threading,
  auth-required recovery; auth gate rendering in the component suite.
- Admin views: ownership listing (display-name resolution, admin/anonymous
  refusals), the visible-id merge, author-label rules, owner section
  ordering and rendering.
- Packed verification keeps asserting the standard card shell and now the
  auth gate markup.

## Follow-ups adopted from dsh-auth-gate (same release)

A review of the independent `dsh-auth-gate` plugin yielded four additions,
folded into this spec rather than shipped as a separate design:

1. **Proxy-side config-plane deny list** (qa-deploy kit). The deploy proxy
   rewrites Host/Origin to loopback, which makes the `/api` trust fence treat
   every proxied request as loopback — including the privileged methods
   (`settings.*`, `credentials.*`, `host.*`, `llm.*`). The proxy now answers
   403 for those method prefixes when the caller is not loopback. The QA
   surface never calls them (its configuration rides `qaSurface/describe`);
   the operator on the serving machine keeps the full plane.
2. **Plugin-side launch-token bridge.** The `/qa` route handler defers the
   marker hand-off for cookie-less browsers: it 302s to a relative
   `/?token=…` first (token resolved once per process from
   `connection.authenticatedUrl`, the dsh-auth-gate pattern), so the
   transparent entry works without the proxy. `entry.cookieBootstrap`
   (default true) turns it off. Presence of any `dsh-auth-` cookie skips the
   bridge; a token-less bridge or a disabled flag falls back to the marker
   hand-off.
3. **`qa-accounts` management CLI** (`bin` entry). `list`, `add
--password-stdin`, `set-role`, `disable`, `enable`, `revoke` — so account
   administration never requires hand-editing the JSON file.
4. **Account state and token revocation.** Accounts gain a `disabled` flag
   (refused at login with `account-disabled`, invisible to `whoami`) and a
   `tokenVersion` burned into every token: `disable` and `revoke` bump it,
   invalidating all live tokens server-side — logout is no longer purely a
   client-side act.
