# Configuration reference

Defaults and constraints are documented in the root README. Important runtime
rules are:

- `route.path` starts with `/`, has trailing slashes removed, and cannot claim
  `/`, `/api` or `/plugins`;
- `fixed` requires `fixedSessionId`;
- `provider` and `model` are either both absent or both present;
- `minContentWidth` is an integer from 480 through 1600 and floors the
  user-resizable transcript/composer width; the page is the only ceiling (the
  content grows until its drag handles reach the edge budget), and each QA
  route persists its chosen width in browser storage;
- duplicate/blank suggested questions are removed;
- duplicate/blank running phrases are removed, each phrase is at most 120
  characters, and an empty list restores the built-in phrases;
- approval and question policies are fixed to safe blocking behavior;
- reasoning and tool details are opt-in through `ui.showReasoning` and
  `ui.showToolActivity`; enable them only where those contents are appropriate
  for the QA audience;
- accounts default to disabled; when enabled, `sessionTtlDays` is an integer
  from 1 through 365, and other users' chats stay hidden unless an admin view
  explicitly enables `accounts.showOtherUsersChats`;
- lockdown defaults to enabled and requires a non-empty permission preset;
- the preset must resolve on the Host to the configured sandbox
  (`read-only`, or `workspace-write` for per-user space) + `never`;
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

`accounts.perUserWorkspace: true` changes the `workspaceId` behavior: the Host
uses the registered Workspace path only as a trusted base, creates
`.qa-users/<account UUID>` below it, and passes that child as the Session cwd.
It does not register or attach the child as a Workspace, so the operator sees
all chats in the normal global DSH session list. This mode requires accounts,
`workspaceId`, fixed-workspace enforcement, lockdown, and `workspace-write`;
`fixed` session policy and a bare `workspace-write` configuration are rejected.

The per-user guard canonicalizes paths (including the deepest existing parent
of a new file), blocks traversal and symlink escape for `read`, `read_image`,
`glob`, `grep`, `write`, `edit`, and `str_replace_editor`, propagates the root
to subagents, and rejects process/LSP/git tools that can discover an ancestor
repository. A write payload is capped at 10 MiB and total scratch usage at
256 MiB. Use reviewed `web_fetch` plus `write` for research downloads; no
general shell or arbitrary URL-to-file capability is enabled.

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
`adoption-refused`, `agent-unavailable`, `proof-mismatch` or `attestation-failed`) plus an operator
hint, so a refused surface can be diagnosed without Host log access.

`agent-unavailable` means the Host could not put a live agent behind the chat:
attestation resumes a session the Host has not materialized in this process —
DSH builds an agent on demand, so a chat restored from an earlier Host run has a
transcript but no agent — and the resume composes the composition that session
recorded. The refusal therefore reports a session whose recorded preset no
longer mounts (or whose log the Host refuses to read); the composition detail is
in the Host logs under `session.agent-resolve-rejected`.

The built-in branding, controls, status messages and accessibility labels are
Russian. The default quick questions are rendered directly above the composer
only while the current chat is empty. Set `suggestedQuestions: []` to hide
them, or provide a deployment-specific list to replace them.

While a turn runs, both the work block and the composer hint show one of the
`thinkingPhrases` and advance together every four seconds. Replace the list to
match the deployment's vocabulary; the indicator always needs a label, so an
empty list falls back to the built-in phrases rather than silencing it. The
settings card's "Фразы ожидания" field starts from the list currently in effect,
so an untouched deployment edits its running phrases rather than an empty box.

When adding tools, update the deployment's reviewed capability inventory as
part of the same change. The package's
[default inventory](../capability-policy.json) is intentionally empty, matching
the default `toolPolicy.allow`.

## Attachments

A visitor can attach images and, with `attachments.textFiles` (default true),
text files. Images ride the prompt inline; a file is uploaded to the Host
first and the prompt cites the receipt, so the durable copy is stored verbatim
under the Host's attachment root. Prompt assembly then hands the model that
copy's path instead of its contents. **`read` therefore has to stay in
`lockdown.toolPolicy.allow`** for an attached file to be usable — without it
the model learns the file exists but cannot open it. The composer hint and the
transcript show the same handle: extension badge, name, size. A file is never
readable back through the browser (that route serves images).

| Field                         | Default                                               | Meaning                                                                       |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `attachments.textFiles`       | `true`                                                | Accept text files next to images. `false` restricts the composer to images.   |
| `attachments.pastedTextLines` | `200`                                                 | Pasted plain text longer than this becomes an attachment; `0` never converts. |
| `attachments.maxFileBytes`    | `10485760`                                            | Byte ceiling for one file (integer from 1024 through 52428800).               |
| `attachments.maxPending`      | `8`                                                   | Images plus files on one message (integer from 1 through 40).                 |
| `attachments.extensions`      | see [attachment-rules.ts](../src/attachment-rules.ts) | Accepted text extensions, lowercase, without the dot.                         |

Pasted text has no name of its own, so the attachment is named after its line
count, for example `Вставленный текст (312 строк).txt`. Shortening the list of
extensions narrows the picker but never blocks a file the browser reports as
`text/*`; set `attachments.textFiles: false` to stop file intake entirely.
The composer enforces these ceilings before the upload, and the Host stays
authoritative at admission.

In [`accounts.perUserWorkspace`](#accounts-and-the-qa-gate) mode the monotonic
path guard allows reading one file under the mounted attachment store's root,
because that copy lives outside every workspace. Directory-wide tools stay
confined to the user's directory, and writes are never exempted.

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
incomplete. Every attested QA session receives one note that says so — that
the surface collects provenance itself, that a manual bibliography is not
wanted, and, when `sources.subagents.enableReportToolFallback` is on, that an
opaque delegated provider must call `qa_report_sources`. The note travels as
injected context on the conversation (see the profile notes below), so a QA
preset cannot suppress it.

A report is checked before it is recorded, in two places. The caller must be
a delegated run — a report from anywhere else is refused, because provenance
is collected rather than authored. And every entry must carry a path or a URL
that survives normalization, so an entry describing a fact is dropped and the
tool answers with a lower count.
`sources.subagents.validateReportedSources` (default true) turns both checks
off: a report from the QA agent itself is recorded into that session's current
turn, and an entry with no address keeps its `kind`, title and snippet instead
of being rejected. A URL the normalizer cannot parse is then kept verbatim,
and a missing title falls back to the last path or URL segment; an entry with
neither a title nor an address is still dropped, because there would be
nothing to show. Use it while testing a provider whose sources are facts
rather than documents; the prompt note that tells the QA agent to collect
provenance rather than write a bibliography is unchanged either way.

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
- `accounts.perUserWorkspace` (default false) enables the bounded per-account
  scratch directory described above. The account UUID, never email or display
  name, is used as the directory component.
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

### User profile and prompt identity

`accounts.profile` gives every account a self-declared profile and hands it to
the QA agent as a note in the conversation. The switch is on by default and
stays inert while accounts are off:

```yaml
accounts:
  enabled: true
  profile:
    enabled: true # the profile form in the sidebar footer
    inject: true # the conversation note described below
    identities: # external systems to collect a handle for
      - key: jira
        label: Jira
      - key: gitlab
        label: GitLab
    instructionsMaxLength: 2000
```

- Fields: full name, one handle per declared field, and free-form "general
  instructions for the agent". The owner edits them by clicking the account
  name in the sidebar footer. The Host accepts only declared keys and caps the
  instruction text, and the account token is the only identity on the wire, so
  a browser can never write another account's profile.
- What the model receives: a note with the user's name, email and handles,
  plus their own instructions framed as preferences that cannot change tools,
  permissions, the sandbox, or any rule the deployment set. It arrives as an
  injected context message on the conversation rather than as prompt text,
  because a QA preset may (and the shipped `qa-research` one does) declare its
  persona the complete system prompt, which discards every section and runtime
  context a plugin contributes. The note is written once per profile — again
  only after an edit — so it never repeats per step and never grows with the
  conversation.
- Delegated subagents receive their own copy. The note is resolved by walking
  `session.header.parentSession` up to the chat's root session, because an
  agent's scope chain runs to its preset and never through its parent. A
  subagent that runs outside this process (another model or SDK) never sees
  the DSH conversation at all; a deployment that needs one to know the user
  has to pass the identifiers in the delegation text.
- The values are self-declared, not verified. The note therefore instructs the
  model to name the identifier it searched by and to ask when results
  contradict the request, so a mistyped handle surfaces as a question instead
  of a confident answer about the wrong person.
- Operator-side management:

  ```sh
  qa-accounts show user@example.com
  qa-accounts profile user@example.com --full-name "Иван Иванов" \
      --identity jira=i.ivanov --identity gitlab=@iivanov
  qa-accounts profile user@example.com --instructions-file ./tone.md
  qa-accounts profile user@example.com --clear-identity gitlab
  ```

  `--instructions-file -` reads that text from stdin. The CLI accepts any
  shape-valid handle key; only keys declared in `accounts.profile.identities`
  ever reach the prompt.

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
