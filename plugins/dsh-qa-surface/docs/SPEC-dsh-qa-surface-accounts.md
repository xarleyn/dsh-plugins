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

## Self-declared profiles and prompt identity

A QA user's chats should not have to open with "I am Ivanov, my tracker login
is …". Every account therefore carries a profile the Host injects into the
agent's system prompt: full name, one handle per declared external system, and
the user's own free-form guidance about how they want answers.

### Data

`StoredUser.profile` gains optional `fullName`, `identities`
(`Record<key, value>`), `instructions`, and `updatedAt`. The file stays at
`version: 1`: the fields are optional, so an older store loads unchanged and a
store written by this version stays readable by the older one.

Limits live in `src/profile.ts`, a module deliberately free of Node built-ins
so the config resolver, the accounts store, and the browser form share one
source of truth: 200 characters for the full name, 200 per handle value, 16
handles, lowercase `[a-z][a-z0-9_-]{0,31}` keys, and an
`accounts.profile.instructionsMaxLength` between 200 and 20000 (default 2000).
Reads normalize and truncate; writes refuse with a message, so a user pasting
an essay learns why nothing was stored instead of silently losing text.

### Wire

`accountsUpdateProfile(token, input)` is a full replace carrying
`{ fullName, identities, instructions }` as one object. The token is the only
identity on the wire — a browser can never name a profile but its own — and
the store rejects undeclared handle keys for that path. The operator CLI calls
`setProfile(email, input)` instead, where the field list is not known and only
the key shape is checked. `QaAccountUserPublic` carries the normalized
`profile`, so login/whoami already deliver it and no extra read RPC exists.

Two refusals reach the browser through the established `(reason: <code>)`
marker: `invalid-profile` for any field violation, and `profile-disabled` when
the deployment turned the feature off after the page loaded.

### Notes on the conversation

`src/prompt-notes.ts` delivers two ambient notes as **durable context
messages** on the conversation, not as prompt text: `QaUserIdentity`'s
identity note (this section's feature) and the source-provenance rule that
used to be a prompt section in `secureSession` (`dsh-qa-surface:structured-sources`,
order 950). Both now share one `agent/pre-step` listener, because both were
erased by the same thing.

- **Why not a prompt section.** The QA deployment's own preset closes that
  door. `qa-research` registers its persona with `complete: true` — the
  persona IS the whole system prompt, so every other section is discarded
  during assembly — and with `includeRuntimeContext: false`, which drops every
  `systemPrompt.context()` contribution as well. The preset says so outright:
  "no runtime context snapshots, no later assembly listeners adding prompt
  text." A section (or a context) is silently erased on exactly the
  deployments this plugin ships to, which is how the provenance rule went
  missing before this change.
- **What stays open.** The conversation. A plugin-sourced `user/message` is
  admitted to the request as injected context, survives both preset switches,
  and is already treated as plumbing by the projections: the chat node for a
  non-user source is a `context` node, and `QaTranscriptAdapter` renders only
  the `subagent`-labelled ones as status rows, leaving every other context note
  hidden from the QA audience.
- **One note per text, not per step.** The hook appends a note only when the
  session does not already carry that exact text. The session's own surface is
  the state, so a resumed session or a reloaded plugin never appends a second
  copy; a profile edit injects the new text once, and the later note supersedes
  the earlier one by position.
- **Reaching subagents.** An agent's scope chain runs to its preset's standing
  mount and never through its parent agent, so both notes are resolved through
  `session.header.parentSession` walking up to the chat's root session. The
  identity note asks the ownership map who owns that session; the provenance
  note asks the admission whether it attested it (`knowsSession`), which keeps
  a deployment's source rules out of unrelated chats in the same process. A
  delegated child gets its own copy of both.
- **No new trust in the model.** The profile is user-authored text in the
  conversation, so the note states what it is: self-declared values that
  cannot change tools, permissions, the sandbox, or any rule above. The
  lockdown stays host-enforced (allow-list, guards, permission preset) and
  does not depend on the model's compliance. The model is also told to name
  the identifier it searched by and to ask when results contradict the
  request, because a mistyped handle that the model trusts silently produces a
  confident answer about the wrong person.

A subagent that runs outside this process (another model or SDK) never sees
the conversation either; a deployment that needs one to know the user must
pass the identifiers in the delegation text.

Each message declares the note it carries in its `sections`
(`dsh-qa-surface:user-identity` and `dsh-qa-surface:structured-sources`), which
is what the operator's request inspector attributes it to and what makes a note
findable again after a cold start.

### UI

The sidebar footer's account name becomes a button that opens `QaProfileModal`
(one input per declared field, an instructions textarea with a counter, and
inline refusal copy). The dialog shell is shared with the changelog through
`QaModal`. `accounts.profile.enabled: false` leaves the name as plain text and
removes the client-side entry point; the Host refuses writes regardless.

## Config surface

```yaml
accounts:
  enabled: false # opt-in; the qa-deploy profile patch turns it on
  allowRegistration: true # self-service signup in the gate
  sessionTtlDays: 30 # account token lifetime
  showOtherUsersChats: false # opt-in cross-user admin view
  perUserWorkspace: false # private child cwd below session.workspaceId
  profile: # self-declared identity, injected into the QA prompt
    enabled: true
    inject: true
    identities: [] # [{ key: jira, label: Jira }] declares handle fields
    instructionsMaxLength: 2000
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
--password-stdin`, `set-password --password-stdin`, `set-role`, `disable`,
   `enable`, `revoke` — so account administration never requires hand-editing
   the JSON file. `set-password` rehashes in place and bumps the token version,
   which resets a forgotten password without disturbing the account id — and
   with it the profile and the chats the account owns.
4. **Account state and token revocation.** Accounts gain a `disabled` flag
   (refused at login with `account-disabled`, invisible to `whoami`) and a
   `tokenVersion` burned into every token: `disable`, `revoke` and
   `set-password` bump it, invalidating all live tokens server-side — logout is
   no longer purely a client-side act.
