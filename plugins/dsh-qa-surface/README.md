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
- blocks unsupported approvals/questions instead of auto-approving them;
- pins locked sessions to `read-only` + `approval=never` before Send is enabled;
- applies a Host-side tool allow-list plus a monotonic execution guard;
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
    maxContentWidth: 900
    showSessionList: false
  suggestedQuestions:
    - Как запросить доступ?
    - Где лежит инструкция?
  interaction:
    approvals: blocked
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
    legacy:
      parseAssistantSourcesBlock: false
```

`workspaceId` is recommended for a deterministic assistant. Without it, DSH
uses the Host's normal default working directory. Put the system prompt, tools,
skills, knowledge connections and permission policy in `agentPreset`, not in
this UI plugin.

Model override is opt-in: `provider` and `model` must be set together. Slash
commands are rejected as plain QA input. Reasoning and tool details remain
hidden by default. Enabling `ui.showReasoning` and `ui.showToolActivity` adds a
turn-scoped work disclosure: it stays open while the assistant is working,
then collapses to `Worked for ...` before the final answer. Tool capability is
still controlled exclusively by `lockdown.toolPolicy.allow`; the display flags
do not grant tools.

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
answer footer and grouped drawer and is persisted as `qa/sources`, so reload
does not rerun tools. Search-only discovery stays hidden by default.

Local file cards open a source-scoped, read-only preview after Host-side real
path validation against the attested session root. Markdown opens rendered by
default with an HTML-free renderer and offers `Rendered / Raw`; raw mode jumps
to recorded line ranges. The endpoint cannot browse or write files and refuses
paths that are not evidence in the canonical bundle.

Observable local subagents are inherited recursively. The internal
`qa_report_sources` tool covers opaque delegated providers and is admitted as
a provenance-only capability even when it is not listed among ordinary QA
tools. A provider that neither exposes events nor reports sources marks the
turn provenance incomplete. The QA prompt tells models not to append a manual
`Sources`/`Источники` bibliography.

Images: the composer accepts PNG/JPEG/WebP/GIF via drag & drop onto the
composer, paste, and the picker button, several at once (soft client caps:
8 images, 15 MB each). Images ride the prompt as base64 uploads the Host
promotes to durable attachments, so they survive reloads; sent images
render as clickable thumbnails on the message. Whether the model can see
them depends on the deployment's model (vision).

Subagents: the deployment may opt the delegation family (`subagent`,
`subagent_fork`, `send_message`, `list_agents`, `interrupt_agent`) into the
lockdown allow-list; the preset must mount them. Launches then render as
first-class work items (description, background flag, durable child id),
settlement notices appear as status rows, an "Агенты" header drawer lists the
chat's subagents with live status, and any subagent opens as a read-only
live transcript (composer disabled, one click back to the chat) - viewing
never attests or writes.

`ui.showSessionList: true` renders a minimal chat-history sidebar beside the
conversation. It lists only the chats this browser has actually used: the
client keeps a per-browser id index under
`<storageKey>:v1:<route>:chats` in localStorage (capped at 50, most recently
used first) and intersects it with the Host session list, so users sharing the
deployment never see each other's chats. Switching re-runs the full policy
attestation; a chat the Host no longer lists is pruned from the index. Each
row carries a two-click delete control that removes the chat from this
browser's index; deleting the chat that is currently open continues in a
fresh attested session. Host-side sessions are not deleted — DSH 0.1.x
exposes no session-deletion seam. The sidebar hides below 600px viewports.

Locked mode requires a deployment permission preset named `qa-read-only`.
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
```

The shipped tool allow-list is empty. Add only reviewed read-only tool names
from the actual deployment. A name that is not registered fails closed. The
Host restriction retains exact allow-listed tools from the agent preset's
ancestor scope, and the additional execution guard also denies session-scoped
tools and `run_code` unless their exact names are allowed.

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
  for LAN clients; the first-load welcome notice re-appears on reload because
  remote browsers have no settings persistence.

See [Configuration](docs/CONFIGURATION.md) for the config-channel details.

See [Architecture](docs/ARCHITECTURE.md),
[Configuration](docs/CONFIGURATION.md), and
[Compatibility](docs/COMPATIBILITY.md).

## Develop

```text
pnpm --filter @yadsh/dsh-qa-surface check
```

The package publishes a classic DSH browser module whose loader id is the full
package name, `@yadsh/dsh-qa-surface`.
