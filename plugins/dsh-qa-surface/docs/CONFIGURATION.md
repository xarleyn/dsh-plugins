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
- the transcript's gutter is shared: fenced code blocks alone may break up to
  32px per side out of the text column, never further than the live gutter and
  never into the drag handles' lane, while markdown tables stay in the column,
  sized to their content (`max-content`) with per-cell ceilings computed from
  the chat width — a wider table scrolls inside its own frame instead of
  stretching the column;
- duplicate/blank suggested questions are removed;
- duplicate/blank running phrases are removed, each phrase is at most 120
  characters, and an empty list restores the built-in phrases;
- approvals default to refusing a composed tool gate's `ask`;
  `interaction.approvals: interactive` parks it for the operator instead, and no
  mode approves anything without a person;
- user questions default to refused (`unsupported`);
  `interaction.questions: interactive` parks `ask_user_question` as an
  answerable form, and needs the tool mounted by the deployment preset plus its
  name in `lockdown.toolPolicy.allow`;
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
- `lockdown.sharedReadOnlyRoots` contains only absolute paths. It widens the
  per-user path guard for reviewed filesystem read tools, and it is the second
  root group of the source preview, but it does not grant a
  tool that is absent from the allow-list.

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
to subagents, and rejects process and LSP tools that can escape it. Paths in
`sharedReadOnlyRoots` are available
only to `read`, `read_image`, `glob`, `grep`, and the `view` operation of
`str_replace_editor`; writes stay inside the user's cwd. The guard does not
reinterpret `dsh_git_*` paths: the separately configured read-only Git plugin
owns that boundary. A write payload is capped at 10 MiB and total scratch usage at
256 MiB. Use reviewed `web_fetch` plus `write` for research downloads; no
general shell or arbitrary URL-to-file capability is enabled.

For the common three-directory deployment, use:

```yaml
lockdown:
  sharedReadOnlyRoots:
    - E:/qa-assistant/workspaces/docs
    - E:/qa-assistant/workspaces/code
```

Here `work/.qa-users/<account UUID>` is private writable scratch, `docs` and
`code` are shared read-only, and only `code` is Git-readable. Also configure
the independent `@yadsh/dsh-git-readonly` plugin with
`repositoryRoots: ["E:/qa-assistant/workspaces/code"]`. It is the single
repository-selection authority and has no mutation-capable tool surface.

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

An existing indexed chat rejected as `composition-mismatch`,
`agent-unavailable` or `adoption-refused` is retained as a historical
read-only transcript. This compatibility path never marks the session
attested: Send, stop, approvals and questions remain disabled, while New chat
creates a session from the current deployment configuration. Other refusals
(including authentication, ownership, permission-preset and unknown-tool
failures) remain fail-closed errors.

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
The defaults collect parent and subagent results, persist a turn snapshot in
the plugin-owned `$DSH_HOME/qa-sources.json`, hide discovery-only candidates,
group visible evidence by kind, and promote at most five substantive
`web_search` results when no fetch occurs. URL tracking parameters and
overlapping file ranges are normalized during deduplication.

`sources.filePreview` is a narrow read capability, not a filesystem browser.
The Host serves only a path already present in the attested session's canonical
evidence bundle, resolves symlinks with `realpath`, rejects root escape, and
applies `maxBytes` plus `maxMarkdownRenderBytes`. The readable roots are the
ones the per-user execution guard already opens for the model: the chat's own
`cwd`, every `lockdown.sharedReadOnlyRoots` entry, and the mounted attachment
store. A deployment that keeps shared documents beside the per-account scratch
directory therefore previews the files its assistant cites, while a path
recorded from anywhere else is refused with `(reason: outside-roots)`. Markdown
uses the client's HTML-free renderer; relative links and executable raw HTML
are not activated.

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
  qa-accounts set-password user@example.com --password-stdin
  qa-accounts set-role user@example.com admin
  qa-accounts disable user@example.com   # blocks logins, revokes live tokens
  qa-accounts revoke user@example.com    # invalidates every issued token
  ```

  `disable` bumps the account's token version, so all outstanding tokens die
  server-side; `enable` requires a fresh sign-in. After a secret rotation
  suspicion, `revoke` is the single-step response. `set-password` is the
  forgotten-password path: the account keeps its id, its profile and its chats,
  while the password it replaces and every token minted under it stop working,
  so the QA user signs in again. Passwords are always read from stdin (one
  line), which keeps them out of shell history.

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

### Starter messages

`accounts.starters` (default `enabled: true`) lets each signed-in user define
their own starter buttons above an empty composer. The «Быстрые сообщения»
section of the `Настройки` dialog edits two fields per entry — the label the
button shows and the prompt pressing it sends — plus a toggle that hides the
deployment's `suggestedQuestions` for that account alone:

- Storage and write path are the profile's: the record lives in the accounts
  file next to the profile, `accountsUpdateStarters` is token-scoped, and a
  write replaces the whole list. Limits: at most 12 entries, labels up to 80
  characters, prompts up to 2 000; an entry missing either field is refused.
- The buttons are UI only. Nothing from this record reaches the agent prompt,
  the tool allow-list, or any other authority.
- Turn the switch off to keep the buttons operator-defined: the section
  disappears and the wire write is refused with `starters-disabled`, while the
  deployment's `suggestedQuestions` keep working unchanged.

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

`interaction.approvals` decides what happens to a tool call a composed plugin
gate (a safety classifier, a hook rule) answers with `ask`:

This is separate from the permission preset's approval policy. Even in
`interactive` mode, the preset named by `lockdown.permissionPreset` must
resolve to `approval: never`; the QA gate parks a composed `ask` before the
native approval service, and `never` remains the fail-closed backstop. A preset
with `approval: ask` is rejected during deployment preflight before a Host
session is created.

- `blocked` (default) — enforced on the attested agent before the approval
  service runs. If any composed policy asks for approval, the QA pre-execute
  listener returns a denial that says approval interactions are unavailable; no
  prompt is shown and no rejection is attributed to the user.
- `interactive` — the call is parked instead: it appears as a request card over
  the composer (the gate's own reason, the tool, Reject / Allow once) and the
  operator's answer becomes the decision. A request is Host state, so it survives
  a page reload and is polled while a turn runs; an unanswered request waits
  until the turn is stopped, which settles it. A delegated child's call is listed
  under the chat that made it.

Neither mode approves anything on its own — a person answers, or the call is
refused. The sibling `interaction.questions` knob works the same way for
`ask_user_question`: `unsupported` refuses the request with a reason the model
can act on, `interactive` parks it as a form the operator fills in (options,
free text, explicit skip and cancel); a skipped question is reported as skipped,
never guessed. The QA listener is owned by the plugin context, so it wraps every
composed gate for attested chats (delegated children included) and leaves every
other session's approval flow untouched. The required `approvalPolicy: never`
remains an independent fail-closed backstop for asks that reach the approval
service directly, and the tool allow-list, workspace fence and read-only sandbox
still run on the resolved call.

## Documents

`documents` configures the document pipeline that backs the five agent tools
`document_create`, `document_to_markdown`, `document_from_url`,
`document_convert` and `document_inspect`. Markdown is the canonical source: the
agent writes Markdown, the pipeline renders DOCX and/or PDF from it, it can read
either format back out as Markdown, and `document_from_url` stores the text of an
online source — a wiki attachment, a document behind an authenticated fetch
provider — as an artifact. The full design is in
[`document-pipeline.md`](./specs/document-pipeline.md).

The tools are registered by the plugin, not by a preset, so they exist in the
Host as soon as `documents.enabled` is true (the default). They become visible
to a QA chat only when the deployment opts in:

```yaml
# profile settings of the QA deployment
lockdown:
  toolPolicy:
    allow:
      - document_create
      - document_to_markdown
      - document_from_url
      - document_convert
      - document_inspect
```

`document_from_url` opens no socket of its own: it asks the deployment's web
provider for the URL, so the fetch rules, credentials, address policy and
byte/char caps configured there decide what may be read (in practice
`@yadsh/dsh-web-fetch-authenticated` plus its Confluence attachment support).
Without a web provider the tool answers `BACKEND_UNAVAILABLE` instead of
guessing. What it stores is bounded by `documents.limits.maxMarkdownChars` and
what it returns inline by `documents.extraction.maxInlineChars`; the artifact
always keeps the full text the fetch layer returned.

One consequence is worth stating plainly: the pipeline writes its bundle with
its own file-system calls, so `lockdown.sandboxMode: read-only` does not stop a
document from being created. The allow-list is the switch that decides whether
a chat can write documents at all, and the artifact root decides where they
land.

What the defaults assume:

- `pandoc` and a headless `libreoffice` exist in the deployment image (or in
  the container the plugin runs in). Missing executables are reported as
  `BACKEND_UNAVAILABLE`, never worked around;
- `docling` is reachable at `http://docling:5001` — the default of the
  `docling-serve` container in `deploy/`, and the only backend that reads PDFs
  and DOCX into Markdown. `documents.docling.enabled: false` turns extraction
  off; a deployment that also enables `documents.markitdown` keeps a fast
  fallback for text documents;
- `typst` and `markitdown` are disabled. Requesting `pdfMode: typst` without
  `documents.typst.enabled` is refused instead of silently rendering another
  layout.

Layout and storage:

- artifacts are bundles under `<session workspace>/.qa/artifacts/documents/<id>`
  and carry `manifest.json`, the Markdown source, the assets and the produced
  files. With `accounts.perUserWorkspace` on, that directory is already inside
  the user's own workspace, so one account cannot read another's documents;
- `documents.storage.root` pins one absolute root instead (a mounted volume).
  Retention cleanup only runs in that layout: with per-session directories the
  plugin knows nothing about other workspaces and must not guess;
- `documents.templates.root` points at a directory with a `manifest.yml`
  listing reference DOCX files and Typst directories. A requested template that
  is not registered fails the call — there is no silent fallback to another
  layout.

Security posture:

- the agent chooses intent only. No tool parameter reaches a backend's command
  line: the orchestrator builds every argv itself, so options such as
  `--lua-filter`, an arbitrary `--resource-path` or `--pdf-engine-opt` are not
  reachable at all;
- inputs and assets are read only from the session workspace, the artifact root
  and `documents.storage.allowedInputRoots`, after resolution and containment
  checks (traversal, symlink escapes and `file://` references are refused);
- remote image references are rejected rather than fetched, so a document
  cannot make the renderer perform a network request;
- macro-enabled documents (`.docm`, macro content types) and encrypted PDFs
  are refused with their own codes;
- the backends run with a filtered environment: ambient secrets and proxy
  variables are not passed to them.

Environment overrides apply on the way into the plugin and touch only the
documented variables — `QA_DOCUMENTS_ENABLED`, `QA_DOCUMENTS_STORAGE_ROOT`,
`QA_DOCUMENTS_TEMPLATES_ROOT`, `QA_DOCLING_BASE_URL`, `QA_DOCLING_TIMEOUT_MS`,
`QA_PANDOC_EXECUTABLE`, `QA_LIBREOFFICE_EXECUTABLE`,
`QA_MARKITDOWN_EXECUTABLE`, `QA_DOCUMENTS_OCR_LANGUAGES` and
`QA_DOCUMENTS_MAX_INPUT_BYTES`. Everything else stays in the settings
namespace, where the card's «Документы» section edits it.

## Agent subroles and capability policies

Subroles are available when `accounts.enabled` is on. Account authorization
(`admin` or `user`) controls only administrative operations; the QA agent gets
the capabilities of exactly one assigned subrole. An administrator configures
the policy at `/qa/admin`:

```text
effective = system required + Common + active subrole
```

Both Tools and Skills are allow-lists. The server validates role selection,
freezes the effective set on the session ownership record, restricts the
agent-visible tool registry, gates direct execution, and installs a scoped
skill catalog/loader. A newly installed capability is therefore unavailable
until explicitly selected. Missing capability IDs remain in the policy file
and appear with a warning in the editor.

Policy definitions and the compact audit trail are stored atomically in
`$DSH_HOME/qa-capability-policies.json`. User assignments and the selected
subrole/capability snapshot remain in `$DSH_HOME/qa-accounts.json`. Do not edit
either file while the Host is running; use the administration UI. Policy
changes apply to new conversations. Existing conversations retain their
snapshot, except that a tool or skill removed from the live registry is no
longer usable.

The default migration creates one enabled `general` subrole and assigns users
only that role. Administrators do not implicitly receive all QA capabilities;
use `Preview as role` for a real-policy test session. If a user has more than
one assigned role, the header shows a selector. Changing it after conversation
content exists requires confirmation and starts a new session.

The first version reserves structured fields for MCP servers, knowledge
sources, and prompt additions, while enforcement and the administration picker
currently cover Tools and Skills.

## Personal skills

Every account can own skills, and they are ordinary Agent Skills: one
directory per skill below the account's own workspace, with a `SKILL.md` the
harness itself can read.

```text
<registered workspace>/.qa-users/<account UUID>/.dsh/skills/<name>/SKILL.md
```

```yaml
accounts:
  enabled: true
  perUserWorkspace: true
  skills:
    enabled: true # on by default wherever it can work
    relativeRoot: .dsh/skills # below the personal root; relative only
    watch: true # follow hand edits and refresh the catalog
    maxSkillBytes: 262144
    allowResourceEditing: false # reserved; v1 edits SKILL.md only
```

- The section is off unless the deployment has accounts _and_
  `perUserWorkspace`: the personal root is the account's own directory, so
  there is no shared fallback to fall back to. The resolver reports the
  effective value, and the settings dialog simply has no Навыки section when
  it is off.
- The account's skill tree is materialized as soon as the account works in its
  own directory: the first chat opened in a fresh `.qa-users/<uuid>` directory,
  and the editor's first read, both leave `<personal root>/.dsh/skills` behind.
  A hand-made skill directory therefore lands in a root that already exists,
  and the watcher below never meets a missing directory to report. The
  `skills-trash` directory still appears only on the first deletion.
- Two deployment facts decide whether the model ever sees a personal skill.
  The preset must mount the skill tool package (`dsh-tool-skill`), and
  `lockdown.toolPolicy.allow` must list `skill`: the harness publishes the
  model-facing catalog only while that tool is visible in the agent's scope.
  Invoking a skill as `/name` does not depend on the tool being allowed, so a
  deployment that skips that entry sees the command work and the catalog stay
  empty — the half-working state this paragraph exists to prevent.
- The user edits skills in the same Настройки dialog as the profile: a
  catalog with search, an editor with name, description, "when to use",
  invocation flags, declared tools and a Markdown body, a tool picker over the
  deployment's registry, and a preview of the exact file a save writes.
- Skills reach the model through a provider this plugin registers
  (`qa-user-skills`) rather than through the filesystem provider, whose
  project root is the nearest `.git` and would climb above an account inside a
  larger checkout. Discovery reads exactly `<cwd>/.dsh/skills` for a cwd that
  matches the `.qa-users/<uuid>` layout, so no account can see another's
  skills and an arbitrary cwd names nothing.
- `allowed-tools` is stored as declared and never granted. A tool the QA scope
  excludes is shown as unavailable and stays in the file; the effective set is
  the intersection of what the session allows with what the skill declares.
  Nothing in this plugin widens the session's own restriction.
- `relativeRoot` may only be a relative path below the personal root; an
  absolute one, a `..` segment or a drive letter is refused at configuration
  time, and a symlinked skills directory is refused at use.
- Saving is atomic (temporary file plus rename) and carries the revision the
  editor read, so an edit made in another tab or by hand is never overwritten
  in silence: the save is refused and the editor offers to reload. A manual
  edit outside the editor is picked up by the watcher, and a deletion moves
  the whole directory to `<personal root>/.dsh/skills-trash/`, keeping the
  skill's resources with it.
- The account id is hashed in the audit lines (`skill.create`,
  `skill.update`, `skill.delete`, `skill.validation-failed`,
  `skill.provider.invalidate-failed`); skill bodies never reach the log.

## Skill catalog scope

The deployment's agent preset controls which skills the QA assistant sees.
The shipped `qa-research` preset mounts the skill filesystem with
`includeDefaultRoots: false`: project-root skills (for example the harness
checkout's own `.dsh/skills`) and user-home skills stay out of the catalog,
and skills enter only through plugin providers or an explicit
`customSkillDirs` list in the preset. Keep the QA catalog to exactly the
skills the audience is meant to use. For a deployment with accounts, the
personal skills above are the provider such a preset relies on.

## Deleting chats

The sidebar delete control removes a chat from this browser's index only;
the Host session stays on disk. Deleting the chat that is currently open
continues in a fresh attested session when `lockdown.allowSessionReset` is
enabled. There is no Host session-deletion API in DSH 0.1.x for the plugin
to call.
