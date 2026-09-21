# @yadsh/dsh-qa-surface

A focused, responsive QA/chat page for DeepSeek Harness at `/qa`. It replaces
the presentation, not the harness: prompts, streaming, tools, skills, MCP,
memory, persistence, permissions and telemetry continue through the native DSH
Session and Agent Loop.

## What it does

- contributes one root-scoped entry to the additive `shell.overlay` slot;
- stays invisible outside the configured route;
- creates or restores one real DSH Session;
- renders only user text, assistant-visible text and safe status messages;
- supports streaming, Stop, optional New chat, safe Markdown, copy actions and
  a responsive first-party-style conversation layout;
- renders assistant Markdown with this plugin's own GFM grammar — headings
  through `######`, nested and task lists, tables, quotes, images, autolinks,
  reference links, TeX math (`$…$`, `$$…$$`, ```math fences, through a bundled
  self-contained KaTeX) and footnotes (`[^label]` with the trailing section) —
  inside an HTML-free renderer, and relays the host theme's
  own typography and syntax colors (`--dsw-font-markdown-*`,
  `--dsw-alias-markdown-*`, `--shiki-token-*`) so a fenced block here reads
  like one in DSH's own transcript, in either theme and at any font-size
  preference. A fence carries the language banner, a copy button and a built-in
  highlighter for the languages answers use; an unknown or absent language
  stays plain monospace;
- optionally shows a minimal per-browser chat-history sidebar
  (`ui.showSessionList`) whose switching re-runs policy attestation;
- blocks unsupported approvals/questions instead of auto-approving them, and can
  park them for the operator to answer (`interaction.approvals: interactive`,
  `interaction.questions: interactive`) instead of refusing or stalling on a
  card the QA view cannot show; a parked question takes the composer's place
  until it is answered or its turn ends;
- pins locked sessions to the configured `read-only` or isolated
  `workspace-write` policy plus `approval=never` before Send is enabled;
- applies a Host-side tool allow-list plus a monotonic execution guard;
- separates account authorization (`admin`/`user`) from the QA agent's active
  subrole, with server-owned Common, per-role Tools and Skills, immutable
  session snapshots, and a dedicated administration page at `/qa/admin`;
- attaches its own QA tool catalog per agent only after the activation skill
  loads (`tools.dynamicActivation`), keeping every QA schema out of the initial
  request and restoring the catalog on resume from the session's own journal;
- ships a destructive-but-fenced `file_delete` tool in that catalog: it removes
  one regular file strictly inside the chat's workspace and refuses
  directories, missing paths and anything that leaves the root — symlink
  escapes included — with an explicit, path-safe reason; every call answers
  `ask`, so the interactive approval card parks it for the operator and
  nothing is ever deleted without a person's answer;
- optionally gates the surface behind email + password accounts
  (`accounts.enabled`) with server-side session ownership, a first-login
  migration of the browser's existing chats, a `qa-accounts` management CLI
  (list/add/set-password/set-role/disable/revoke), and a coarse honest boundary:
  accounts identify QA users, they do not fence the harness root;
- gives each account a `Настройки` dialog — profile, starter messages,
  integration tokens, general, and **personal skills**: ordinary Agent Skills stored as `SKILL.md` in the account's own
  directory (`accounts.skills`), edited with a catalog, an invocation-flag
  form, a Markdown body, a tool picker over the deployment's registry, and a
  preview of the exact file a save writes. Skills reach the model through a
  provider this plugin registers instead of the filesystem one, so no account
  can see another's, and `allowed-tools` is stored as declared but never
  grants anything the session does not already allow;
- optionally redirects non-loopback hostnames from the harness root into the
  QA route (`entry.redirectNonLoopback`), keeping the operator's localhost
  harness UI untouched;
- ships an operator settings card (Settings → Plugins → plugin configuration →
  «Помощник QA») that edits the `qa-surface` namespace in place — route,
  branding, session, interface, lockdown, accounts, sources, attachments,
  embedding — and reports the configuration the running Host
  resolved;
- no longer owns the document pipeline: `document_create`,
  `document_to_markdown`, `document_from_url`, `document_convert` and
  `document_inspect` come from [`@yadsh/dsh-documents`](https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-documents#readme),
  which a QA chat reaches exactly as before — same tool names, same allow-list
  entry, same artifact layout. What moved with it is the configuration: the
  pipeline is configured in that plugin's own `documents` namespace and card
  (`QA_DOCUMENTS_*` environment variables became `DSH_DOCUMENTS_*`), and a
  leftover `documents:` section under `qa-surface` is ignored with a
  `documents.moved` warning in the Host log;
- uses the existing same-origin DSH connection and trust boundary.

It does not add another HTTP server, provider proxy, permissive CORS rule, or
custom session persistence.

## Install

Install the package where the DSH Host can resolve it, then compose its Loader
row. The included `cordis.patch.yml` is a minimal example:

```yaml
- insert:
    - id: dsh-qa-surface
      name: "@yadsh/dsh-qa-surface"
      config:
        enabled: true
        route:
          path: /qa
          matchChildren: true
```

Some DSH patch operations replace a row's complete `config` instead of deeply
merging it. When editing an existing row, provide every value that deployment
needs.

Tested DSH releases serve unknown frontend paths as 404 rather than falling
back to `index.html`. The Host half therefore claims only the configured QA
navigation path and redirects it through the canonical `/` document with a
short-lived query marker. The browser restores the requested `/qa` URL with
`history.replaceState` before mounting the overlay. No second server, duplicate
HTML document, permissive route, or unauthenticated config endpoint is added.

## Configure

Configuration is registered under the Host settings namespace `qa-surface`.
Composition values form the base layer; normal DSH user settings can override
them when the deployment provides writable settings.

The browser half carries a settings card for that namespace: **Settings →
Plugins → plugin configuration → «Помощник QA»**. It writes the user layer of
`qa-surface` — so every change is revertible through the card's own reset — and
shows the configuration the running Host resolved next to it. Combinations the
Host refuses are either written together in one mutation (a provider with its
model, per-user workspaces with the `workspace-write` sandbox) or disabled with
the reason stated. The card renders only where the settings namespace is
readable, which the DSH gateway pins to loopback; a browser served over the LAN
reads the same configuration read-only through `qaSurface/describe` on the QA
page itself.

```yaml
config:
  enabled: true
  route:
    path: /qa
    matchChildren: true
  branding:
    title: Внутренний помощник
    subtitle: Отвечает на вопросы о внутренней платформе
    welcomeMessage: Чем могу помочь?
    placeholder: Задайте вопрос…
    logoUrl: null
  session:
    # Pin every chat to a directory (optional, one of):
    # cwd: "D:/qa-docs"        # direct absolute directory pin
    # workspaceId: "<uuid>"    # or a registered DSH workspace
    policy: browser-persistent
    storageKey: dsh-qa-surface.session
    workspaceId: company-knowledge
    fixedSessionId: null
    agentPreset: qa-assistant
    provider: null
    model: null
    reasoningEffort: null
  ui:
    showHeader: true
    showReset: false
    showStop: true
    showTimestamps: false
    showToolActivity: false
    showReasoning: false
    renderMarkdown: true
    minContentWidth: 650
    showSessionList: false
  accounts:
    enabled: false
    allowRegistration: true
    sessionTtlDays: 30
    # Login/registration attempts accepted per rolling minute, store-wide
    # (optional). The limit backs the password checks; raise it only when a
    # shared kiosk genuinely needs the headroom.
    maxAuthAttemptsPerMinute: 30
    showOtherUsersChats: false
    perUserWorkspace: false
    profile:
      enabled: true
      inject: true
      identities: [] # e.g. [{ key: jira, label: Jira }]
      instructionsMaxLength: 2000
    # Per-account starter buttons above an empty composer (optional).
    starters:
      enabled: true
  suggestedQuestions:
    - Как запросить доступ?
    - Где лежит инструкция?
  # Phrases the running indicator cycles through (optional). An empty list
  # restores the built-in ones.
  thinkingPhrases:
    - Уточняю по регламенту…
    - Сверяюсь с инструкцией…
  # What a visitor may attach (optional). Files are staged on the Host and
  # read from the stored copy, so keep `read` in lockdown.toolPolicy.allow.
  attachments:
    textFiles: true
    pastedTextLines: 200
    maxFileBytes: 10485760
    maxPending: 8
    extensions: [md, txt, log, json, yaml, csv, sql]
  interaction:
    # blocked: refuse a composed gate's `ask` with the QA reason.
    # interactive: park it over the composer for the operator to answer.
    approvals: blocked
    # unsupported: refuse ask_user_question with an actionable reason.
    # interactive (or enabled): park the request over the composer as an
    # answerable form, which owns the composer until it is answered or the
    # turn ends.
    questions: unsupported
  # Root-page entry behavior (optional; see "Serving the QA rig over the LAN").
  entry:
    # Inject the root → /qa redirect for non-loopback hostnames.
    redirectNonLoopback: true
    # Let the /qa route run the one-time ?token= host-cookie exchange itself,
    # so transparent entry works without the deploy proxy.
    cookieBootstrap: true
  lockdown:
    enabled: true
    enforceFixedAgentPreset: true
    enforceFixedWorkspace: true
    enforceFixedModel: true
    sandboxMode: read-only
    approvalPolicy: never
    permissionPreset: qa-read-only
    allowPermissionChanges: false
    allowSlashCommands: false
    allowSettingsMutation: false
    allowSessionReset: false
    allowSessionRename: false
    allowSessionDelete: false
    allowArbitrarySessionOpen: false
    toolPolicy:
      mode: allow-list
      allow: []
  sources:
    enabled: true
    collect:
      parentAgent: true
      subagents: true
      persistTurnEvent: true
    display:
      sidebar: true
      footer: true
      groupByKind: true
      showDiscovered: false
      showOriginBadges: false
      maxInitiallyVisiblePerGroup: 8
    webSearch:
      promoteSearchResultsWithoutFetch: true
      maxPromotedPerSearch: 5
    dedupe:
      normalizeUrls: true
      stripTrackingParams: true
      mergeFileRanges: true
    filePreview:
      enabled: true
      markdownRenderedByDefault: true
      allowRawToggle: true
      maxBytes: 2000000
      maxMarkdownRenderBytes: 1000000
    subagents:
      inheritSources: true
      enableReportToolFallback: true
      markIncompleteOpaqueRuns: true
      validateReportedSources: true
    legacy:
      parseAssistantSourcesBlock: false
  # QA tool delivery (optional). The plugin's own tool catalog stays out of the
  # model request until the activation skill has actually been loaded.
  tools:
    dynamicActivation: true
    activationSkill: qa-surface
    activationMode: all
    # Presets whose sessions may unlock the catalog. Empty leaves the gate open:
    # only do that when this Host serves one agent composition.
    activationPresets: []
```

`workspaceId` is recommended for a deterministic assistant. Without it, DSH
uses the Host's normal default working directory. Put the system prompt, tools,
skills, knowledge connections and permission policy in `agentPreset`, not in
this UI plugin.

### Dynamic QA tools

A QA deployment tends to grow a large toolset, and attaching all of it at boot
puts every schema into every request — including the first small talk of a chat
that will never use them. `tools.dynamicActivation` (the default) inverts that:
the plugin's catalog is registered into the agent's own scope only after the
model successfully loads `tools.activationSkill`, and `qa_tools_selfcheck`
reports the resulting state.

As of catalog version 3 the shipped catalog carries four tools:
`qa_tools_selfcheck`, the activation diagnostic; `docs_search` and
`docs_read`, the documentation surface; and `file_delete`, the one destructive
capability — it deletes a single regular file strictly inside the calling
chat's workspace and refuses directories, missing paths and anything that
escapes the root, symlink escapes included, with an explicit reason that never
echoes a host path. Every `file_delete` call is answered `ask` by an
inner gate that sits inside the approval flow, so on a deployment with
`interaction.approvals: interactive` the interactive approval card parks the
call for the operator, and on `blocked` the call is refused outright: nothing
is deleted without a person. Like every catalog tool it is admitted as a
dynamic name at execution time — it needs no `lockdown.toolPolicy` entry —
and a role-managed deployment grants it through the same Tools baskets as any
other tool.

`docs_search` and `docs_read` are the documentation surface. Documentation is
published into the `docs/` directory of the chat's workspace and the tools read
exactly that tree: `docs_search` matches a phrase inside single lines and
reports every hit with its path and line number, tagged with the module and
version parsed out of the layout `docs/<module>/<version>/…`; both names are
also accepted as filters, so a chat that was told "3.8" stops sweeping every
edition, and `path` narrows a search to one subtree. `docs_read` opens one file
at a bounded window of lines. Both stay inside the tree — a path outside it, a
`docs/` that is missing or is not a real directory, a directory passed to a
read, a binary file and a link that leaves the tree are refused with an
explicit reason that never echoes a host path — and both bound what they
return: `limit` and a byte budget on the reported hits, a line budget on a
read, and a truncated answer says so instead of quietly dropping matches. The
tool descriptions carry the routing rule the catalog exists for: documentation
is looked up here, not in memory and not by sweeping guessed paths.

The trigger is the authoritative result of the built-in `skill` tool, not the
model's attempt, not a keyword in the transcript, and not a coincidentally
matching skill description. A failed or refused load activates nothing, loading
an unrelated skill activates nothing, and loading the same skill again is a
no-op. If one tool fails to register, the whole attempt is unwound and the agent
stays inactive — a half-attached surface would leave the model with a tool it
cannot rely on. Registrations live exactly as long as the agent that owns them,
so disposal and plugin unload leave no scoped tool behind.

A resumed chat is restored from its own journal: the successful `skill` load is
already recorded there as a standard `tool/call`/`tool/result` pair, so the
current catalog is re-attached before the first model step. The plugin appends
no session event of its own — an unknown event type without an `ignorable`
marker makes the whole log unreadable to a harness that does not mount this
plugin.

Set `tools.activationPresets` to the preset your QA surface pins (`qa-research`
in the deploy kit) in any Host that composes more than one agent type. With an
empty list the catalog is reachable by any agent that loads a skill of the same
name. `tools.dynamicActivation: false` restores the always-on behaviour and
attaches the catalog to every managed agent at creation — useful for a
deployment that would rather debug the tool surface than the trigger.

These tools are not `lockdown.toolPolicy.allow` entries, and cannot be: that
list is validated against the mounted catalog at attestation time, and a tool
that only appears later would fail the check. The QA execution guard authorizes
exactly the names the activation manager reports for the calling agent, so a
dynamically attached tool gets the same scrutiny as an allow-listed one. Tool
visibility is not an authorization boundary — a QA tool that writes must still
enforce its own permissions.

### Writable per-user research space

Set `accounts.perUserWorkspace: true` only together with accounts, a registered
`session.workspaceId`, `lockdown.enforceFixedWorkspace: true`, and a
`workspace-write` + `never` permission preset:

```yaml
session:
  workspaceId: "<registered-workspace-uuid>"
accounts:
  enabled: true
  perUserWorkspace: true
lockdown:
  enabled: true
  enforceFixedWorkspace: true
  sandboxMode: workspace-write
  approvalPolicy: never
  permissionPreset: qa-workspace-write
  toolPolicy:
    mode: allow-list
    allow:
      [
        read,
        read_image,
        glob,
        grep,
        write,
        edit,
        web_search,
        web_fetch,
        dsh_git_context,
        dsh_git_history,
        dsh_git_show,
        dsh_git_blame,
      ]
  sharedReadOnlyRoots:
    - E:/qa-assistant/workspaces/docs
    - E:/qa-assistant/workspaces/code
```

The Host resolves that Workspace record's path and creates
`<workspace>/.qa-users/<account UUID>` with private Unix directory mode. It
passes the child as session `cwd` but deliberately does not register or attach
it as another DSH Workspace. Chats therefore remain ordinary entries in the
global DSH session list rather than creating one Workspace row per account.

That choice has one visible consequence: in the host's workspace browser these
chats sit under `Ungrouped`. DSH grants Workspace membership only to a session
whose stored cwd IS the Workspace path - `Workspace.attachSession` compares the
two after `realpath`, and the browser derives its groups from
`workspace.sessionIds` alone - so a per-account child directory can never be a
member, and no later action can make it one: the contract has no attach or
membership request for an existing session, and dragging a session never
crosses groups. Registering a Workspace per account directory would group them,
at the cost of putting every visitor's scratch root into the operator's global
workspace registry; this plugin does not do that.

Chats left outside every workspace for a repairable reason - created while the
deployment pinned `session.cwd`, or through `workspaceId` with the same
directory spelled differently (`E:/base` against `E:\base`) - can be adopted
while DSH is stopped:

```bash
qa-attach-sessions                    # dry run against $DSH_HOME
qa-attach-sessions --write            # adopt; registry backed up first
```

The command adopts only sessions whose canonical cwd IS a registered Workspace
path, prepends them newest first, and refuses anything below a Workspace path,
because the Host drops those from membership again on the next read. Per-user
chats are therefore never touched.

The boundary combines DSH `workspace-write` with a Host tool guard for both
read and write paths, canonicalizes existing ancestors to reject symlink
escapes, propagates the root to subagent sessions, rejects shell/process/LSP
escape hatches, permits filesystem reads in explicitly configured shared
read-only roots, and leaves repository selection to the separately configured
read-only Git plugin. Writes remain confined to the account directory. The
guard limits one model-controlled write to 10 MiB,
and limits an account directory to 256 MiB. `web_fetch` plus `write` is the
intended bounded research-download path; there is no unrestricted URL-to-disk
or shell downloader. Account directories are persistent scratch space and are
not deleted automatically.

For the layout above, configure `@yadsh/dsh-git-readonly` separately with
`repositoryRoots: ["E:/qa-assistant/workspaces/code"]`. That plugin is the
single repository-selection authority and exposes no mutating Git operation.

Model override is opt-in: `provider` and `model` must be set together. Slash
commands are rejected as plain QA input. Reasoning and tool details remain
hidden by default. Enabling `ui.showReasoning` and `ui.showToolActivity` adds a
turn-scoped work disclosure: it stays open while the assistant is working,
then collapses to `Worked for ...` before the final answer. Tool capability is
still controlled exclusively by `lockdown.toolPolicy.allow`; the display flags
do not grant tools.

### User profile

Clicking the account name in the sidebar footer opens the signed-in user's
profile: full name, one handle per external system the deployment declares,
and free-form instructions about how they want answers. The Host hands both
to the QA agent as a note in the conversation, so "покажи мои задачи" resolves
to a tracker lookup with the right login instead of a question. Because a QA
preset can declare its persona the complete system prompt (the shipped
`qa-research` one does, which discards every plugin prompt section), the note
travels as injected context on the conversation instead of as prompt text. It
is written once per profile, and subagents of the chat get their own copy.
Values are self-declared and the note says so: the agent names the identifier
it searched by and asks when the results contradict the request. The feature
needs no switch beyond accounts, though `accounts.profile.enabled` and
`inject` exist for deployments that want the form without the note, or
neither:

```yaml
accounts:
  enabled: true
  profile:
    identities:
      - key: jira
        label: Jira
      - key: gitlab
        label: GitLab
    instructionsMaxLength: 2000
```

`qa-accounts profile <email>` fills the same fields from an operator shell
(`--identity jira=i.ivanov`, `--instructions-file`, `--clear-identity`), which
is how a fresh deployment gets everyone's handles in place before users log
in. See
[Configuration](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-surface/docs/CONFIGURATION.md)
for the limits and the prompt's exact wording.

The wording of that note — and of the source-provenance, delegation-naming and
attached-documents notes — is editable without touching the source: the
«Заметки модели» section of the settings card (the `notes` config block) mutes
each note and rewords its text, keeping the generated parts (`{identity}`,
`{instructions}`, `{reportTool}`) as placeholders. The attached-documents note
is the one that sends a `.docx` or `.pdf` from the chat to the document
pipeline instead of the plain file reader, which refuses those formats as
binary.

### Starter messages

The same `Настройки` dialog carries a «Быстрые сообщения» section where the
signed-in user defines their own starter buttons: each entry is a label (what
the button reads) and a prompt (what pressing it sends), so a button can say
«Мои задачи» while sending a full tracker request. The deployment's
`suggestedQuestions` stay visible next to the user's own buttons unless the
user hides them with the section's toggle. The list is stored on the account
(next to the profile, in the accounts file), replaces wholesale on save, and
is pure UI preference — none of it reaches the agent prompt.
`accounts.starters.enabled` (default `true`) turns the section off for
deployments that want the buttons to stay operator-defined.

### Integration tokens

The same `Настройки` dialog carries an «Интеграционные токены» section, so the
account that runs an integration issues and revokes its own credential instead
of asking the operator to run the CLI. It lists the tokens that account owns —
label, scopes, creation and expiry dates, use count and last use — mints a new
one, shows its secret exactly once (with a copy button and the warning that it
is never recoverable, because only the digest is stored), and revokes one with
a second confirming click. A revoked or expired token stays in the list as a
record, with its revoke button gone.

Creating is offered only where the credential has somewhere to go: with
`integration.enabled: false` the section explains that the API is off and hides
the form, while listing and revoking keep working — a credential that already
exists has to remain revocable. The section is part of the accounts domain, so
it appears wherever `accounts.enabled` is on, and the same self-service rules
apply: the token always belongs to the signed-in account, and one account never
sees another's tokens. The CLI (`qa-accounts token create|list|revoke`) remains
the operator's path, including issuing a token for somebody else.

Session policies:

- `browser-persistent` restores the id stored in this browser, replacing stale
  ids with a new session;
- `new-on-load` creates a session each time the QA surface mounts;
- `fixed` requires `fixedSessionId`, never creates a replacement, and is meant
  only for controlled single-user deployments.

New chat is disabled by default. To expose it, set `lockdown.allowSessionReset:
true` plus either `ui.showReset: true` (header button) or `ui.showSessionList:
true` (sidebar button). Pressing it opens a draft composer and creates nothing:
the DSH Session is materialized lazily by the first prompt, so the chat list
stays quiet until a message is actually sent, and the old session stays intact
for operator inspection. The sidebar orders chats by the host's last update,
so merely opening a chat never moves it.

Regeneration: the last committed answer offers a retry action. The session log
is append-only, so "regenerate" sends a hidden instruction as an ordinary
prompt and the answer arrives as a follow-up turn; the projection hides that
instruction and the consecutive turns read as variants of one question,
navigable with a `< 2/2 >` switcher (newest shown by default).

Sources are structured Host-owned provenance, independent of
`ui.showToolActivity`. Successful reads/fetches, bounded web-search evidence,
Jira/Confluence/knowledge results, and inherited subagent sources are
normalized and deduplicated into one turn bundle. That exact bundle feeds the
answer footer and the right rail's sources tab and is persisted in the
plugin-owned `$DSH_HOME/qa-sources.json`, so reload does not rerun tools and
no custom event enters the Harness session journal. Search-only discovery
stays hidden by default.

Legacy sessions written by earlier releases can be repaired while DSH is
stopped. Preview changes first, then apply them with an automatic backup:

```bash
qa-repair-sessions
qa-repair-sessions --write
```

The repair only marks legacy `safety-gate/*` and `qa/sources` records as
ignorable; it does not delete them. Each changed session file is backed up as
`*.pre-plugin-event-repair.bak` before atomic replacement.

Local file cards open a source-scoped, read-only preview after Host-side real
path validation against the roots the QA read policy opens: the chat's own
directory, the configured shared read-only directories, and the attachment
store. Markdown opens rendered by default with an HTML-free renderer and offers
`Rendered / Raw`; raw mode jumps to recorded line ranges. The endpoint cannot
browse or write files and refuses paths that are not evidence in the canonical
bundle.

Observable local subagents are inherited recursively. The internal
`qa_report_sources` tool covers opaque delegated providers and is admitted as
a provenance-only capability even when it is not listed among ordinary QA
tools. A provider that neither exposes events nor reports sources marks the
turn provenance incomplete. A note in the conversation tells the model not to
append a manual `Sources`/`Источники` bibliography.

Images: the composer accepts PNG/JPEG/WebP/GIF via drag & drop onto the
composer, paste, and the picker button, several at once (soft client caps:
8 images, 15 MB each). Images ride the prompt as base64 uploads the Host
promotes to durable attachments, so they survive reloads; sent images
render as clickable thumbnails on the message. Whether the model can see
them depends on the deployment's model (vision).

Attachments: the same picker, drop zone and paste path also take text files
(`md`, `txt`, `log`, and the other extensions in `attachments.extensions`), and
pasted text longer than `attachments.pastedTextLines` (default 200) becomes an
attachment named after its line count instead of filling the input field. A
file is staged on the Host through the browser upload service and the prompt
cites the returned receipt, so the durable copy survives reloads; the transcript
shows it as an extension badge, its name and its size. Unlike an image, a file
reaches the model as the path of that stored copy rather than as content, so
`lockdown.toolPolicy.allow` has to keep `read` for an attachment to be usable.
`attachments.textFiles: false` restricts the composer to images again, while
`maxFileBytes` and `maxPending` cap one file and the combined number of images
plus files per message.

The right rail is the chat's side panel, mirroring the Harness right Sidebar's
pattern: a tab strip is the panel's whole top edge, and the strip's close
control collapses the column. The sources tab carries the grouped list and
preview the sources drawer used to render — a message footnote opens it pinned
to that answer's subset, and «Все источники» returns to the whole chat. The
«Файлы» tab (header button with a live count) lists every attachment this chat
sent, grouped per message newest first, with the same file handles the
transcript shows and image thumbnails resolved from the session's asset
repository; each group jumps back to its message. Below 600px the rail goes
full-bleed. The agents drawer keeps its own header drawer for now.

### Slash commands and skills

Off by default. Typing `/` in the composer normally gets the same refusal it
always did («Команды со слешем недоступны в режиме помощника»), and nothing
about that changes for a deployment that upgrades.

Turn it on with the master switch, then say exactly what it admits:

```yaml
lockdown:
  allowSlashCommands: true

slashCommands:
  skills:
    mode: allow-list      # deny-all | allow-list | all
    allow:
      - generate-tkp
      - generate-tz
      - gap-analysis
  commands:
    mode: deny-all        # deny-all | allow-list | all
    allow: []
  palette:
    enabled: true
    fuzzySearch: true
    maxVisible: 12
    showDescriptions: true
    showKindBadge: true
```

The switch and the policy are two separate decisions: turning slashes on opens
the palette, and the palette offers only what the two lists name. A deployment
that enables the switch and declares nothing gets the legacy behaviour — every
user-invocable skill of the chat, no commands at all — and the Host says so once
in its log (`slash.legacy-defaults`) rather than silently behaving as if it had
been configured.

The two kinds behave differently, and the difference is the point:

```text
Skill                                    Human command
  /generate-tkp Сделай ТКП                 /compact
  → ordinary model turn                    → the Host runs it
  → the native skill consumer injects      → the model never sees it
    the skill's instructions               → command/run + command/done land
  → QA reads no SKILL.md and injects       in the session log, projected as a
    nothing itself                           control row, not an answer bubble
```

A skill with `user-invocable: true` and `disable-model-invocation: true` shows up
in the palette and runs; the model still cannot see it. A skill with
`user-invocable: false` never appears. `/name` typed inside an ordinary sentence
still works the way it does everywhere else in the Harness — QA does not
rewrite that path — but when the deployment withholds that particular skill, the
composer says so before the turn runs instead of letting the user believe it
took effect.

Keyboard and touch: `/` opens the palette above the composer and it closes as
soon as a space is typed (you are writing arguments by then). `↑`/`↓` move,
`Tab` and `Enter` insert the invocation **without running it** — the second
Enter sends — and `Escape` closes. Clicking or tapping a row inserts it and
leaves the caret in the field. A skill and a command that share a name are two
separate rows, and a hand-typed `/plan` when both exist asks which one you
meant rather than guessing.

Admission is the Host's, not the browser's. The catalog arrives already filtered
by the policy and by the chat's role, and `/compact` typed by hand is re-checked
against the same policy before the native runtime is allowed near it. The slash
interface changes nothing about tools, the sandbox, the permission preset or
approvals: a skill invoked by hand carries exactly the permissions it carries
when the model loads it.

The settings card carries the same policy under «Слеш-действия», with the
allow lists as plain name lists — the config stores names, never ids.

### Panel extensions

QA Surface can host optional feature panels without importing those features.
The shell owns the launcher, side-by-side/fullscreen layout, resizing and
generic close chrome; an extension owns its feature state and controls. No
panel is shown, and no launcher space is reserved, when no extension is
installed.

An external client plugin uses two registrations. Metadata and navigation go
through the `qaSurfacePanels` service; the React body is registered separately
in the keyed `qa.surface.panel` slot under the same implementation id:

```ts
import type { Context } from "@deepseek-ai/cordis"
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots"
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client"
import { QA_SURFACE_PANEL_SLOT } from "@yadsh/dsh-qa-surface/client/panels"

const id = "@example/dsh-qa-browser"

function BrowserPanel(props: PropsRuntime<typeof QA_SURFACE_PANEL_SLOT>) {
  // panelId, panelKind, sessionId, visible, presentation, params,
  // actions and a registration-lifetime AbortSignal arrive in props.
  return null
}

export const inject = ["slots", "qaSurfacePanels"]

export function apply(ctx: Context) {
  ctx.effect(() => ctx.qaSurfacePanels.register({
    id,
    kind: "browser",
    title: () => "Browser",
    icon: "browser",
    order: 100,
    keepMounted: true,
  }))

  ctx.slots.inject(QA_SURFACE_PANEL_SLOT, () =>
    ctx.slots.register(
      { name: QA_SURFACE_PANEL_SLOT, key: id },
      BrowserPanel,
    ),
  )

  ctx.qaSurfacePanels.open("browser", {
    reason: "extension",
    focus: false,
  })
}
```

The extension should declare both `slots` and `qaSurfacePanels` in its client
`inject` list instead of polling for load order. `keepMounted: true` preserves
local/continuous UI state while another panel is active; hidden retained bodies
are removed from keyboard navigation. Presentation state is browser-local and
never enters the DSH Session log. Browser processes, tools, security policy and
artifacts remain the responsibility of the Browser plugin, not QA Surface.

### User Settings extensions

An optional client plugin can add a first-class page to the signed-in user's
existing `Настройки` dialog through the published
`@yadsh/dsh-qa-surface/client/settings` contract. Register the page with the
`qaUserSettingsSections` service; QA Surface owns the navigation and supplies
only the current account token to the selected page. The extension must still
authorize every Host call server-side and must not persist credentials in the
browser.

```ts
import type { Context } from "@deepseek-ai/cordis"

export const inject = ["qaUserSettingsSections"]

export function apply(ctx: Context) {
  ctx.effect(() => ctx.qaUserSettingsSections.register({
    id: "integrations",
    title: "Интеграции",
    order: 40,
    component: IntegrationsPage,
  }))
}
```

### The signed-in account outside the dialog

A card mounted in the host's own settings (`settings.plugin.item`) has no panel
props to read the account from, so the same contract also publishes the session
as the `qaUserSession` client service: `checking`, `anonymous` or `authed` with
the bearer credential the principal-scoped QA remotes authorize with. It follows
the same account controller the pages use, so a card and the dialog never
disagree. Subscribe to it with `useSyncExternalStore` and render account-bound
controls only for `authed` — without an account every call would be refused, and
the credential is transport authentication only: never persist it, log it, or
put it in a URL, a tool argument or any model-visible value.

```ts
import type { Context } from "@deepseek-ai/cordis"

export const inject = ["qaUserSession", "slots"]

export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.slots.inject("settings.plugin.item", () =>
      ctx.slots.register(
        { name: "settings.plugin.item", key: "my-namespace" },
        MyCard,
      )))
}
```

Subagents: the deployment may opt the delegation family (`subagent`,
`subagent_fork`, `send_message`, `list_agents`, `interrupt_agent`) into the
lockdown allow-list; the preset must mount them. Launches then render as
first-class work items (description, background flag, durable child id),
settlement notices appear as status rows, an "Агенты" header drawer lists the
chat's subagents with live status, and any subagent opens as a read-only
live transcript (composer disabled, one click back to the chat) - viewing
never attests or writes.

`ui.showSessionList: true` renders a minimal chat-history sidebar beside the
conversation. By default it lists only the current user's chats: the
client keeps a per-browser id index under
`<storageKey>:v1:<route>:chats` in localStorage (capped at 50, most recently
used first) and intersects it with the Host session list, so users sharing the
deployment never see each other's chats. An admin can explicitly enable
`accounts.showOtherUsersChats: true` to add chats owned by other QA accounts,
grouped by owner. Switching re-runs the full policy
attestation, and that attestation materializes the chat's agent when the Host
does not hold one: DSH builds an agent on demand, so a chat restored after a
Host restart still opens (its composition is resumed from what the session
recorded) instead of failing as unavailable. If that recorded agent preset,
workspace or model belongs to an older deployment configuration, the history
still opens in an explicit compatibility read-only mode. Send, stop, approvals
and questions stay disabled so the historical session cannot bypass the
current workspace or permission boundary; use New chat to continue under the
current configuration. A chat the Host no longer lists is pruned from the
index, and so is a delegated subagent session: the rows, the chat counter in
the account settings and the first-login claim batch all read the same lineage
marks the host list carries, so a subagent's transcript can never be reopened,
counted or migrated as a chat. Each
row carries a two-click delete control that removes the chat from this
browser's index; deleting the chat that is currently open continues in a
fresh attested session. Host-side sessions are not deleted — DSH 0.1.x
exposes no session-deletion seam. The sidebar hides below 600px viewports.

The sidebar footer shows the deployed plugin version. Clicking it opens a
changelog dialog with a curated per-version summary (features and fixes);
Escape or a backdrop click closes it.

On `/qa`, the plugin shadows DSH's stock `welcome-notice` onboarding entry and
renders a route-owned Russian testing disclosure. Keeping the visible dialog
in the QA overlay prevents DSH's blank-session onboarding lifecycle from
dismissing it when a question is submitted. It explains the DeepSeek Harness
preview foundation, QA review of questions and answers, the work-related
scope, and local in-contour model processing. Explicit acknowledgement is
stored as a versioned browser-local flag; changing the disclosure version
shows it again. Other DSH routes retain the stock onboarding entry.

The default locked mode requires a deployment permission preset named
`qa-read-only`. Per-user writable mode uses a separate preset such as
`qa-workspace-write`.
`interaction.approvals: interactive` does not change this requirement: it
parks an `ask` returned by a composed tool gate in the QA view, while the
permission preset must keep `approval: never` as the independent fail-closed
backstop. Setting the preset itself to `approval: ask` fails deployment
preflight with `(reason: permission-preset)` before a Host session is created.
Extend the existing `@deepseek-ai/dsh-permission-presets` row without changing
its process-wide default:

```yaml
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
      qa-read-only:
        sandbox: read-only
        approval: never
        name: QA Read Only
        description: No filesystem mutations and no permission escalation.
      qa-workspace-write:
        sandbox: workspace-write
        approval: never
        name: QA User Workspace
        description: Writes only inside the attested per-user workspace.
```

The shipped tool allow-list is empty. Add only reviewed tool names
from the actual deployment. A name that is not registered fails closed. The
Host restriction retains exact allow-listed tools from the agent preset's
ancestor scope, and the additional execution guard also denies session-scoped
tools and `run_code` unless their exact names are allowed.
Host-installed integration plugins may add their own narrowly scoped tool names
through the QA Surface service; those executors must independently resolve the
owner-attested root principal and fail closed for unowned or child sessions.

## Subroles and capability policies

With `accounts.enabled: true`, every QA session has exactly one active agent
subrole. The Host resolves its effective capabilities as the union of the
minimal system-required set, Common capabilities, and that one subrole; it
never unions all roles assigned to the user. The chosen role and effective
snapshot are stored with session ownership. Existing conversations never gain
new capabilities after an administrator edits a role, while a capability that
disappears from the running registry is revoked immediately.

Administrators manage subroles, Common Tools/Skills, user assignments and the
audit trail at `/qa/admin`. Capability choices come from the live tool and
skill registries; configured-but-missing entries remain visible and are not
deleted. Admin authorization affects only the management API and never grants
agent capabilities. `Preview as role` creates an ordinary session using the
selected role's real server-enforced policy and shows the preview banner, which
carries the way out. The preview belongs to the navigation that opened it: it
ends when that entry is left, and an ordinary account never holds it, so a chat
started later in the same tab runs under the account's own default profile.
A user page reports each assigned profile's effective capabilities the way a
session resolves them: the deployment's pinned tools plus Common and the role,
the skill-grantable ceiling separately, and declared audiences among the
skills.

The configuration lives in `$DSH_HOME/qa-capability-policies.db` (a pre-0.8.0
`qa-capability-policies.json` beside it is imported on first use); user
assignments and session snapshots stay with the existing account store. Tools
are filtered with an agent-scoped restriction and a pre-execution gate. Skills
use an agent-scoped `skill` consumer that publishes only the allow-listed
catalog and rejects direct out-of-policy loads with `SKILL_NOT_AVAILABLE`.
The browser selector is hidden for a single assigned role. Switching roles
after a meaningful turn requires confirmation and creates a new conversation.

### Tools that arrive with a skill, and tools taken away

A role's tools are split into three classes. `always` tools are visible from
the first model step. `skillGrantable` tools are a ceiling, not a grant: they
stay out of the model's tool list until an activated skill requires them, which
keeps a large catalog such as browser automation out of every step of every
conversation. An older flat `tools: []` list is read as `always`, so an
upgraded deployment never hands out more than it did before.

`deny` withdraws a tool. The deployment's pinned `toolPolicy.allow` reaches
every profile, so a pinned name cannot simply be unchecked in a role; a denial
beats it, beats the Common layer and beats every skill, and it narrows the
ceiling below. Because the ceiling is a property of the conversation rather
than of one agent, the agents a chat delegates to — subagents and the named
domain experts — are held to it as well: they may reach anything the role can
reach, including tools a skill would grant, and nothing beyond it. Withdrawing
`dsh_git_*` from a role therefore withdraws it from that role's experts too.

### Skills declare their own audience

A skill describes itself inside the ordinary `metadata` block of its
`SKILL.md`, so the file stays a valid Agent Skill outside a QA deployment and
no upstream schema is forked:

```yaml
---
name: browser-research
description: Research websites through browser automation

metadata:
  qa-surface:
    version: 1
    audience:
      type: subroles        # or: type: common
      include: [analyst, presales]
    tools:
      requires: [browser_open, browser_click]
      grant:
        lifecycle: session  # the only lifecycle in v1
        requireAll: true
---
```

The audience decides visibility; the role ceiling decides what a skill may ever
receive. A load intersects the two, so a skill cannot widen its own access. A
skill that declares nothing stays `Unassigned` until an administrator assigns
it, which is safer than treating every new skill as Common.

Loading the instructions and widening the toolset is one operation. A strict
skill (`requireAll: true`) refuses to activate when one of its tools is
unavailable, and a best-effort skill activates with a visible warning that
names what it did not receive. The model's `skill` call and a typed
`/skill-name` activate the same grant; a `/name` naming a skill outside the
subrole is withdrawn before the step is assembled. Grants last for the current
agent, and several loaded skills union their tools — activating a second skill
never revokes what the first one still holds.

Administrators edit assignments as an overlay, never by rewriting `SKILL.md`: a
role can be added to or withdrawn from a declared audience, a skill can be
forced on for every role or disabled outright, and the Skills page shows the
declared audience next to the effective one with a
`Healthy`/`Degraded`/`Blocked` state. Every activation is recorded on the
session record with the requested, granted and denied tools, so a later review
can see what a conversation actually gained.
## Administrative console

`/qa/admin` is the review and administration surface. It is part of the QA page
itself, not a separate application, and it is open to `admin` and `reviewer`
accounts. Reviewer sees conversations, the review queue, feedback and
analytics; only an administrator sees users, capability policies and audit.

The console covers the quality loop end to end:

- **Overview** — conversation, rating and review counters, the items that need
  attention, and the newest signals.
- **Users** — authorization role, enabled/disabled status, assigned QA subroles
  and the default one, plus per-account activity. Disabling an account is the
  operation to reach for: historical conversations, feedback and reviews stay
  attributed to their author, and the last enabled administrator cannot be
  demoted, disabled or removed.
- **Conversations** — every conversation the deployment knows, filterable by
  user, subrole, date range, rating and review state, with a viewer that reads
  the stored transcript: messages in recorded order, tool calls with their
  arguments, results and errors, per-message feedback, and the capability
  snapshot frozen when the session started. A link can point at one message
  (`/qa/admin/conversations/<id>/<seq>`). An administrator can also delete the
  conversation from its own page: that removes the chat itself — its stored
  log, the sessions delegated from it, its ownership record, its ratings,
  reviews, queue entries and collected sources — unlike the sidebar's "delete
  chat", which hides a row in one browser. The Host refuses while the Harness
  still holds the session open or when the deployment stores sessions
  somewhere directories cannot express, and audits the act.
- **Review queue** — what needs attention, derived from unanswered negative
  feedback, explicitly queued conversations and failed tool calls. A reviewer
  classifies issues across answer, context, tools, skills and access, sets a
  severity, writes notes and names the remediation target.
- **Feedback** — every rating against the exact answer it judged, with the
  optional reason and comment the user gave.
- **Analytics** — rating coverage, positive share overall and per subrole,
  issue distribution and a daily trend. These are user-satisfaction signals;
  the console never presents them as accuracy.
- **Audit** — one timeline of authorization changes, account status, subrole
  assignments, policy edits and review verdicts, each with its before/after
  image.

Authorization is a permission table, not an `isAdmin` flag, and every
administrative entry point names the permission it needs; the Host re-checks it
on the call it serves, so a hidden control is convenience rather than the
boundary. Review material is the most sensitive data the package handles, so
tool arguments and results are bounded previews with credential shapes masked,
behind a redactor a deployment can replace.

## Integration API (HTTP)

Another application — a ticket-system bridge, a bot, a script — can ask the same
assistant questions over HTTP, with its own credential instead of a browser
session, and read its own conversations back. The endpoints are **off by
default**.

```yaml
integration:
  enabled: true          # requires accounts.enabled: true
  basePath: /qa/api      # POST {basePath}/ask, GET {basePath}/session, GET {basePath}/health
  tokenTtlDays: 90
  requestTimeoutMs: 90000
  maxConcurrent: 4
  requestsPerMinute: 60
  maxAnswerCharacters: 4096   # the answer the ticket comment can hold
```

The API needs accounts: a caller is an account, and the credential it presents
is that account's integration token. Switching it on without
`accounts.enabled: true` is refused at configuration time rather than served
without authentication.

### Issuing a token

```bash
# the secret is printed exactly once and is never recoverable
qa-accounts token create bridge@example.corp --label "ticket bridge" --scopes ask --days 90
qa-accounts token list bridge@example.corp     # ids, scopes, expiry, last use
qa-accounts token revoke bridge@example.corp <token-id>
```

An integration token is a **separate credential** from the browser token:

- it survives a password change, because a service that is already integrated
  must not be logged out by a person editing their own profile;
- it stores only a SHA-256 digest of its secret, so a copied database is not a
  copied credential;
- it carries scopes (`ask`, `sessions:read`), an independent expiry and its own
  revocation;
- it stops with the account: disabling the account refuses it, and
  `qa-accounts revoke <email>` revokes it together with every browser session.

Use one token per integration and revoke it when the integration is retired.
Treat the secret like a password: it is a bearer credential with no second
factor.

### Asking a question

```bash
curl -sS https://dsh.example.local/qa/api/ask \
  -H "Authorization: Bearer qsat.<id>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{
        "message": "TEST получения задач для ИИ Агента\n\nКомпоненты: MDC",
        "version": "3.8",
        "session_id": null,
        "context": {
          "ticket_key": "PROJ-123",
          "reporter": "user@example.corp",
          "reporter_name": "Демо-пользователь"
        }
      }'
```

```json
{
  "chat_id": "session-1f0c…",
  "answer": "**Ответ**\n\nТекст ответа в Markdown…",
  "sources": ["Документация_v3.8.pdf#стр.12"],
  "confidence": "medium",
  "escalate": false,
  "reason": ""
}
```

Send `chat_id` back as `session_id` to continue the same conversation. The chat
belongs to the token's account: a token can only continue chats its own account
owns, and a chat an integration opened keeps its own workspace, subrole and
capability snapshot like any other QA chat.

`multipart/form-data` is accepted with the same fields (`message`, `version`,
`session_id`, `context` as a JSON **string**) plus repeated `files` parts (at
most five, 10 MiB each by default).

| Attachment | What the model receives |
| --- | --- |
| `image/png`, `image/jpeg`, `image/webp`, `image/gif` | the image itself |
| `text/plain`, `text/csv`, `text/markdown` | its text, under a heading with the file name |
| `application/pdf`, Word, Excel, PowerPoint | text extracted by the deployment's document pipeline |
| anything else | `415` — the fallback the bridge already implements |

A file the Host cannot read refuses the whole question with `415` rather than
being skipped: an answer produced without the material it was asked about is
worse than asking again without it. Documents need the `documents` plugin
installed; without it PDF and Office attachments take the same `415` path, and
images and text keep working. Attachments are read, not stored: the bytes live
in a temporary directory for the length of one extraction, and the text is
bounded (60 000 characters per file, 120 000 per question, truncated with a
marker). Everything the bridge's own filter lets through is accepted; archives,
executables and media are not.

A `answer` longer than `maxAnswerCharacters` is cut before it is published, at
the last paragraph break (then the last line, then the last sentence) and marked
with an ellipsis, so the ticket shows a readable head instead of a comment the
ticket system silently truncates mid-sentence. The cut is logged with the chat
id; it is still a normal answer, not an escalation.

`confidence` is `medium` for a published answer and `low` for an escalated one.
`high` is deliberately never claimed: nothing in the deployment judges an
answer, and a field that always said `high` would train the operator to ignore
it. `escalate: true` means the assistant produced nothing publishable — an
interrupted turn, an empty answer, or a question that did not finish inside
`requestTimeoutMs` (the `chat_id` is still returned, so a retry continues the
same chat instead of starting a second one).

### Reading a conversation back

```bash
# after=0 reads from the start; limit is clamped to 200
curl -sS 'https://dsh.example.local/qa/api/session?chat_id=session-1f0c…&after=0&limit=50' \
  -H "Authorization: Bearer qsat.<id>.<secret>"
# {"chat_id":"session-1f0c…",
#  "messages":[{"seq":1,"role":"user","text":"…","at":"2026-09-21T10:00:00.000Z"},
#              {"seq":2,"role":"assistant","text":"**Ответ**…","at":null}],
#  "last_seq":2,"truncated":false}
```

This is what the `sessions:read` scope is for, and it is a separate scope rather
than part of `ask`: a bridge that escalates a ticket, or opens the question in a
review screen for a specialist, has to show what was already said. Without the
endpoint such a bridge could only ask the same question again — spending a turn
to answer a question that already has an answer.

The read is the same conversation the account owns, in the same words: `text`
is the flattening the answer itself uses, so a message reads the same whether it
was received as an answer or fetched here. Only the prompts the person sent and
the assistant's answers are published — injected context, reasoning and tool
traffic are not, because those are model input the caller never wrote.

`after` is the caller's own cursor: pass the `last_seq` of the previous read,
and the next call returns only what was written since. `limit` bounds the page
(default 50, at most 200) and the window is always the **newest** messages, so a
long conversation costs one page rather than one transcript per call; when older
messages were left below the window, `truncated` says so. `at` is the instant
the log recorded, or `null` when it recorded none — a timestamp is never
invented.

An unknown `chat_id` and another account's chat answer the same `404`, so an id
alone never confirms that somebody else's conversation exists.

Reading is cheap enough to poll: the newest messages of a conversation are kept
warm, and a chat this Host is holding is checked against its own memory, so a
page costs neither a stored read nor a walk through the whole history — a page
of a long conversation is a page. The first read of an old chat is the
expensive one, and a chat this Host does not hold is re-read after 30 seconds at
the latest, which is the same budget the review console gives its transcripts.

### Health

```bash
curl -sS https://dsh.example.local/qa/api/health \
  -H "Authorization: Bearer qsat.<id>.<secret>"
# {"ok":true,"version":"0.11.0","models":["gpt-4o-mini"],"uptime_s":86400}
```

### Statuses

| Status | Meaning |
| --- | --- |
| 200 | Answered, or escalated with an empty `answer` |
| 400 | Malformed body (no `message`, broken JSON or `context`), a missing `chat_id`, or a cursor that is not a whole number |
| 401 | Missing, expired, revoked or unknown token |
| 403 | Valid token without the scope the call needs (`ask`, `sessions:read`) |
| 404 | A chat the token's account does not own (or that does not exist); also `integration.enabled` is false: no route is registered, and the request reaches whatever the deployment serves for unknown paths |
| 413 | Body or attachment over the configured limit |
| 415 | Unsupported content type, or a non-image attachment |
| 429 | Per-token rate limit or the deployment's concurrency limit |
| 503 | The QA assistant failed before it could answer; retry |

Response bodies carry `{ "error": "…", "code": "…" }` with the same reason
vocabulary, so a client can branch on the code instead of parsing prose.

### What to watch

- Every request that reaches a turn is logged on the Host with the token id,
  the chat id and the ticket key — never the question or the answer. A read is
  logged the same way, with the cursor it asked from and the number of messages
  it got.
- `maxConcurrent` bounds how much of the deployment a bridge can occupy;
  `requestsPerMinute` bounds one token. Both answer `429`, which retries well.
- `maxAnswerCharacters` bounds one answer. A question that produced more is
  logged as truncated, with the chat id and the published length — never the
  text.
- The endpoint is a network surface: publish it only where the integration
  runs, keep TLS in front of it, and remember that the token's scopes are the
  only limits on what it can ask.

## Security and deployment

`/qa` is a presentation boundary, not an authentication boundary. Protect it
with the same deployment authentication and DSH browser trust policy as the
operator UI. The plugin never auto-approves a permission request or answers an
interactive agent question. Configure a least-privilege, non-interactive agent
preset for end-user deployments. On a shared Host, a user who can open `/`,
call the normal DSH APIs, or use another authenticated client can bypass the
QA presentation. Use a dedicated DSH process/identity and network boundary
when `/qa` must be a strong security boundary.

The `embedding.frameAncestors` field is reserved deployment metadata in 0.1.x;
the plugin does not mutate CSP headers. Configure `frame-ancestors` at the
trusted reverse proxy if iframe embedding is required.

### Serving the QA rig over the LAN

The plugin itself needs no changes to be reachable from other machines; the
web server's bind address is a deployment composition decision. DSH refuses
`dsh --host 0.0.0.0` on the command line on purpose, so network exposure is
expressed with the shipped patch overlay instead:

```bash
pnpm dsh --profile qa-surface --no-open --port 3082 \
  --patch plugins/dsh-qa-surface/deploy/qa-lan.patch.yml
```

The overlay sets the `webserver` row to `0.0.0.0` while keeping the `--port`
flag working. On an all-interfaces bind DSH derives trusted `/api` authorities
from the machine's LAN IPv4 addresses, so `http://<lan-ip>:3082/qa` works
without extra configuration; users reaching a DNS name instead of an IP
literal need `--trusted-host <name>` on the same command line.

LAN browsers cannot read the DSH settings namespace (settings RPCs are pinned
to loopback by the gateway). The plugin covers this itself: a browser that
sees the namespace as unavailable reads the effective configuration through
the `qaSurface/describe` Host Remote, so branding, session pinning and
lockdown UI switches keep working over the LAN. Host-side enforcement was
never dependent on that read path.

`describe` takes no token on purpose — the browser needs the configuration
before it can render anything — so treat its answer as public deployment
metadata: any `/qa` visitor can read the full resolved configuration, not
only the audience-facing projection, including operator-side values such as
the `lockdown.sharedReadOnlyRoots` paths. Keep credentials and secrets out of
the `qa-surface` configuration entirely; the plugin declares no field for
them, and nothing in the channel redacts the resolved values.

What a LAN deployment does not change:

- DSH has no authentication or TLS on this port; anyone who can reach it can
  drive the harness, and the full operator UI at `/` stays reachable next to
  `/qa`. Scope the port's reachability (subnet-limited firewall rule, VPN or
  tailnet, authenticating reverse proxy) and use a dedicated process identity.
- Loopback-only settings, directory picking and credential RPCs stay refused
  for LAN clients. On `/qa`, the plugin replaces DSH's non-persistent welcome
  step with a QA-specific testing disclosure and remembers its exact copy
  version in that browser's local storage. The stock DSH notice remains
  unchanged on operator routes.

See [Configuration](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-surface/docs/CONFIGURATION.md) for the config-channel details.

See [Architecture](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-surface/docs/ARCHITECTURE.md),
[Configuration](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-surface/docs/CONFIGURATION.md), and
[Compatibility](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-qa-surface/docs/COMPATIBILITY.md).

## Develop

```text
pnpm --filter @yadsh/dsh-qa-surface check
```

The package publishes a classic DSH browser module whose loader id is the full
package name, `@yadsh/dsh-qa-surface`.
