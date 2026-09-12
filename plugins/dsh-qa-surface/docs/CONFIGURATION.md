# Configuration reference

Defaults and constraints are documented in the root README. Important runtime
rules are:

- `route.path` starts with `/`, has trailing slashes removed, and cannot claim
  `/`, `/api` or `/plugins`;
- `fixed` requires `fixedSessionId`;
- `provider` and `model` are either both absent or both present;
- `maxContentWidth` is an integer from 480 through 1600 and caps the
  user-resizable transcript/composer width; each QA route persists its chosen
  width in browser storage;
- duplicate/blank suggested questions are removed;
- approval and question policies are fixed to safe blocking behavior;
- reasoning and tool details are opt-in through `ui.showReasoning` and
  `ui.showToolActivity`; enable them only where those contents are appropriate
  for the QA audience;
- accounts default to disabled; when enabled, `sessionTtlDays` is an integer
  from 1 through 365, and other users' chats stay hidden unless an admin view
  explicitly enables `accounts.showOtherUsersChats`;
- lockdown defaults to enabled and requires a non-empty permission preset;
- the preset must resolve on the Host to exactly `read-only` + `never`;
- permission, slash-command, settings, rename, delete and arbitrary-open
  capability flags cannot be enabled;
- `showReset` requires the independent `allowSessionReset` opt-in;
- the tool policy is an allow-list; unknown configured tool names fail closed.
  A name only resolves while its tool is actually mounted: MCP tools
  (`mcp__<server>__*`) exist only while their server is reachable, so keep
  them out of the allow list on hosts that cannot reach the server. Tools
  mounted by an agent preset live in that preset's ancestor scope; the Host
  validates and restricts the complete agent-scoped view, not just globals.

## Pinning chats to a directory

By default a QA chat is created against the Host working directory. Two
mutually exclusive pins anchor every new chat (and its subagents) to the
deployment's own directory:

- `session.cwd: "D:/qa-docs"` - an absolute directory used directly as the
  session cwd; no registration needed. Attestation compares the session's
  recorded cwd case- and separator-insensitively on Windows.
- `session.workspaceId: "<uuid>"` - a registered DSH workspace (created in
  the web UI or via the workspace API; the id is a generated uuid, not the
  path). Sessions attach to the workspace, so they group under it in the
  host UI. When the id does not resolve, attestation refuses with
  `reason: workspace-unavailable` instead of an opaque mismatch.

With `lockdown.enforceFixedWorkspace: true` (the default) a chat created
anywhere else refuses to attest, so the QA audience can never pull the
assistant out of the pinned directory.

Browser persistence stores only the DSH session id under
`<storageKey>:v1:<route>:session`, plus — when `ui.showSessionList` is
enabled — a per-browser chat index under `<storageKey>:v1:<route>:chats`
(session ids only, capped at 50). Transcript content, credentials and tool
results remain in the Host-owned DSH Session and are never copied to browser
storage.

When either work-detail flag is enabled, the QA transcript groups reasoning,
intermediate assistant progress, and tool rows by DSH turn. Running work is
expanded. Completed work is collapsed behind a duration summary and can be
reopened; each tool row can separately reveal its formatted input and output.
These controls change presentation only and never widen the Host allow-list.

The browser cannot override lockdown settings. Before binding and immediately
before every prompt, it requests a Host attestation for the selected session.
Any unproved agent preset, workspace, model, permission bundle or tool policy
disables Send with the generic message `Настройки помощника недоступны.`
Detailed mismatch facts are written only to Host logs; the
browser console additionally prints one line with a stable coarse reason code
(`reason: unknown-tools`, `workspace-unavailable`, `composition-mismatch`, `permission-preset`,
`adoption-refused`, `proof-mismatch` or `attestation-failed`) plus an operator
hint, so a refused surface can be diagnosed without Host log access.

The built-in branding, controls, status messages and accessibility labels are
Russian. The default quick questions are rendered directly above the composer
only while the current chat is empty. Set `suggestedQuestions: []` to hide
them, or provide a deployment-specific list to replace them.

When adding tools, update the deployment's reviewed capability inventory as
part of the same change. The package's
[default inventory](../capability-policy.json) is intentionally empty, matching
the default `toolPolicy.allow`.

## Structured sources

The `sources` block controls provenance independently from Activity rendering.
The defaults collect parent and subagent results, persist a `qa/sources` event,
hide discovery-only candidates, group visible evidence by kind, and promote at
most five substantive `web_search` results when no fetch occurs. URL tracking
parameters and overlapping file ranges are normalized during deduplication.

`sources.filePreview` is a narrow read capability, not a filesystem browser.
The Host serves only a path already present in the attested session's canonical
evidence bundle, resolves symlinks with `realpath`, rejects root escape, and
applies `maxBytes` plus `maxMarkdownRenderBytes`. Markdown uses the client's
HTML-free renderer; relative links and executable raw HTML are not activated.

Set `sources.display.showOriginBadges: true` while auditing inheritance. Local
subagent sources carry run/session origins automatically. An opaque provider
can call the internal `qa_report_sources` tool; if it does not, and
`markIncompleteOpaqueRuns` remains enabled, the bundle is explicitly marked
incomplete.

See [Structured sources migration](SOURCES-MIGRATION.md) before removing an
older prompt-authored bibliography convention.

## Accounts and the QA gate

`accounts.enabled: true` mounts the login/registration gate in front of the
QA surface and turns on server-side session ownership:

- The store lives at `$DSH_HOME/qa-accounts.json` (created on first use). It
  holds scrypt password hashes, a persisted HMAC secret for the account
  tokens, and the session ownership map. The path is not configurable and no
  secret ever reaches `describe()`.
- `accounts.allowRegistration` (default true) controls self-service signup
  in the gate; the first account ever registered becomes `admin`.
- `accounts.sessionTtlDays` (default 30) is the account token lifetime. The
  token is an HMAC-signed value the browser keeps in `localStorage`; logout
  or expiry returns the browser to the gate, and the Host re-derives the
  identity on every attestation.
- `accounts.showOtherUsersChats` (default false) lets admins load and display
  chats owned by other QA accounts. It has no effect for ordinary users.
- Session ownership is first come, first served: attesting or bulk-claiming
  an unowned session binds it to the caller's account (this is how existing
  per-browser chats migrate on the first login). Sessions owned by another
  user are refused with the coarse `session-owned-elsewhere` reason and
  hidden from the sidebar; admins are not refused.
- Manage accounts with the bundled CLI (no hand-editing of the JSON):

  ```sh
  qa-accounts list
  qa-accounts add user@example.com --password-stdin --role user
  qa-accounts set-role user@example.com admin
  qa-accounts disable user@example.com   # blocks logins, revokes live tokens
  qa-accounts revoke user@example.com    # invalidates every issued token
  ```

  `disable` bumps the account's token version, so all outstanding tokens die
  server-side; `enable` requires a fresh sign-in. After a secret rotation
  suspicion, `revoke` is the single-step response.

- Honest boundary: accounts identify QA users and gate the QA surface and
  its remotes. They do not fence the harness: every QA user also holds the
  host launch-token cookie, with which the full root UI stays technically
  reachable. Keep the network scoping advice from the deployment kit.

## Entry redirect

`entry.redirectNonLoopback: true` (default) injects one script into the
served root `index.html`: browsers whose URL host is not loopback
(`localhost`, `127.0.0.1`, `::1`, `*.localhost`) continue into the QA route,
so LAN visitors never see the full harness root. The check is client-side on
`location.hostname` on purpose - behind a local reverse proxy every request
looks loopback to the server. The navigation hand-off `/?__dsh_qa_route=…`
is never redirected (that would loop), `/?ui=admin` bypasses the redirect
and is remembered for the browser, and `/?ui=qa` clears the bypass.

`entry.cookieBootstrap: true` (default) additionally lets the `/qa` route
itself bootstrap the host cookie: a browser without any `dsh-auth-` cookie is
sent to the one-time `/?token=…` exchange (relative redirect, token resolved
from the host connection service) before the marker hand-off. This makes the
transparent entry work without the deploy proxy; with the proxy in front,
either side may perform the exchange and the other becomes a no-op.

## Configuration channel over the LAN

The browser normally reads the effective configuration from the Host-owned
`qa-surface` settings namespace. DSH pins settings RPCs to loopback, so a
browser served over the LAN always sees that namespace as unavailable. In
that case the client calls the plugin's `qaSurface/describe` Host Remote and
uses the returned effective configuration; a rejected call falls back to the
client defaults with the same `unavailable` status as before. Only one
describe request runs per page load, and a settled answer survives scope
updates — the namespace (when readable) stays the authority and keeps
delivering live changes.

Host-side enforcement never depended on the browser's read path: `secureSession`
attestation re-derives everything from the Host-owned configuration on every
bind and every prompt.

## Skill catalog scope

The deployment's agent preset controls which skills the QA assistant sees.
The shipped `qa-research` preset mounts the skill filesystem with
`includeDefaultRoots: false`: project-root skills (for example the harness
checkout's own `.dsh/skills`) and user-home skills stay out of the catalog,
and skills enter only through plugin providers or an explicit
`customSkillDirs` list in the preset. Keep the QA catalog to exactly the
skills the audience is meant to use.

## Deleting chats

The sidebar delete control removes a chat from this browser's index only;
the Host session stays on disk. Deleting the chat that is currently open
continues in a fresh attested session when `lockdown.allowSessionReset` is
enabled. There is no Host session-deletion API in DSH 0.1.x for the plugin
to call.
