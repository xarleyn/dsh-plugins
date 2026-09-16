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
- optionally shows a minimal per-browser chat-history sidebar
  (`ui.showSessionList`) whose switching re-runs policy attestation;
- blocks unsupported approvals/questions instead of auto-approving them, and can
  park them for the operator to answer (`interaction.approvals: interactive`,
  `interaction.questions: interactive`) instead of refusing or stalling on a
  card the QA view cannot show;
- pins locked sessions to the configured `read-only` or isolated
  `workspace-write` policy plus `approval=never` before Send is enabled;
- applies a Host-side tool allow-list plus a monotonic execution guard;
- separates account authorization (`admin`/`user`) from the QA agent's active
  subrole, with server-owned Common, per-role Tools and Skills, immutable
  session snapshots, and a dedicated administration page at `/qa/admin`;
- attaches its own QA tool catalog per agent only after the activation skill
  loads (`tools.dynamicActivation`), keeping every QA schema out of the initial
  request and restoring the catalog on resume from the session's own journal;
- optionally gates the surface behind email + password accounts
  (`accounts.enabled`) with server-side session ownership, a first-login
  migration of the browser's existing chats, a `qa-accounts` management CLI
  (list/add/set-password/set-role/disable/revoke), and a coarse honest boundary:
  accounts identify QA users, they do not fence the harness root;
- gives each account a `Настройки` dialog — profile, starter messages,
  general, and **personal skills**: ordinary Agent Skills stored as `SKILL.md` in the account's own
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
    # interactive: park the request over the composer as an answerable form.
    questions: unsupported
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
index. Each
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
selected role's real server-enforced policy and shows a persistent preview
banner.

The configuration lives in `$DSH_HOME/qa-capability-policies.json`; user
assignments and session snapshots stay with the existing account store. Tools
are filtered with an agent-scoped restriction and a pre-execution gate. Skills
use an agent-scoped `skill` consumer that publishes only the allow-listed
catalog and rejects direct out-of-policy loads with `SKILL_NOT_AVAILABLE`.
The browser selector is hidden for a single assigned role. Switching roles
after a meaningful turn requires confirmation and creates a new conversation.

### Tools that arrive with a skill

A role's tools are split into two classes. `always` tools are visible from the
first model step. `skillGrantable` tools are a ceiling, not a grant: they stay
out of the model's tool list until an activated skill requires them, which
keeps a large catalog such as browser automation out of every step of every
conversation. An older flat `tools: []` list is read as `always`, so an
upgraded deployment never hands out more than it did before.

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
  (`/qa/admin/conversations/<id>/<seq>`).
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
