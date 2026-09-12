# SPEC / Implementation Plan: `dsh-qa-surface`

**Status:** Draft / implementation-ready  
**Date:** 2026-09-05  
**Last updated:** 2026-09-08 — added locked-down / read-only QA execution policy  
**Target:** DeepSeek Harness Web  
**Artifact type:** external DSH UI plugin with a dedicated `/qa` browser surface

---

## 1. Goal

Create a DeepSeek Harness plugin named **`dsh-qa-surface`** that exposes a minimal, embeddable QA/chat interface at:

```text
/qa
```

The page must look like a standalone assistant rather than the standard DSH developer UI:

- one conversation;
- user and assistant messages;
- text input;
- Send / Stop;
- optional reset/new chat;
- optional welcome text and suggested questions;
- no workspace tree;
- no settings;
- no model picker by default;
- no tool-call tree;
- no reasoning/trajectory UI;
- no developer-oriented DSH controls.

At the same time, the assistant must continue to run through the **real DSH runtime** and retain DSH capabilities such as:

- Sessions;
- Agent / Agent Loop;
- model providers and routing;
- system prompt and agent preset;
- tools;
- skills;
- MCP;
- memory/knowledge plugins;
- subagents;
- persistence;
- telemetry;
- permission policy;
- other Host-side plugins composed into the selected agent/session.

The plugin must **not** create a second agent runtime or proxy prompts to an LLM directly.

---

## 2. Primary design decision

### 2.1 MVP implementation

Implement `/qa` as a **full-screen browser UI plugin occupying the additive `shell.overlay` slot** when `window.location.pathname` matches the configured QA route.

The normal DSH Web application continues to boot underneath it.

```text
GET /qa
   │
   ▼
DSH frontend-static SPA fallback
   │
   ▼
standard DSH index.html + window.__DSH_BOOT__
   │
   ▼
normal browser plugin graph
   │
   ├── ui-layout
   ├── ui-conversation
   ├── client-runtime
   ├── connection
   └── dsh-qa-surface
          │
          └── shell.overlay → fullscreen QA surface
```

This is intentionally preferred over replacing DSH's entire `root`, `sidebar`, or `conversation` slots.

### Why

Current DSH layout exposes the frame-level seats:

- `sidebar` — `single`, root scope;
- `conversation` — `single`, session-maybe scope;
- `details` — `single`, session scope;
- `shell.overlay` — additive `list`, root scope.

There is currently no first-class generic "global page" route/slot for third-party plugins. Replacing `sidebar`, `conversation`, or the entire root would make the plugin compete with first-party occupants and is more likely to break on DSH updates.

`conversation.session` is useful for replacing the body of a selected session, but by itself it does not provide a top-level page and does not remove the surrounding frame.

Therefore MVP should use the additive full-frame overlay and keep all host/runtime services native.

### 2.2 Future implementation

Once the plugin stabilizes, optionally add a second delivery mode:

```text
qa profile / bundle
  ├── dsh-base
  ├── web transport
  ├── client runtime
  └── qa-only browser roster
```

That profile can remove unused first-party UI plugins entirely. It is **not required for MVP**.

---

## 3. Verified DSH architecture assumptions

The implementation plan below relies on the following current DSH behavior as of 2026-09-05.

### 3.1 DSH client UI is plugin-based

A browser UI plugin is a dual-face package:

```text
src/index.ts          Host / Node half
src/client/index.ts   Browser half
```

The package declares a `dsh.client` manifest and exports `./client`.

The Host-side client module registry discovers enabled Loader entries with `dsh.client`, serves their bundles under `/plugins/...`, and injects the client module graph into `window.__DSH_BOOT__`.

### 3.2 `/qa` does not need a separate static server

The shipped `dsh-host-frontend-static` owns the webserver fallback seat.

For GET/HEAD requests, a missing static path falls back to `index.html` with HTTP 200. Therefore:

```text
GET /qa
```

can already boot the same DSH SPA shell without adding a new Vite server or replacing the fallback handler.

### 3.3 Session Controller remains authoritative

Session lifecycle, prompt execution, history and live events remain Host-owned. The client runtime mirrors them and exposes session objects/snapshots.

The QA surface must use this existing object/API layer instead of inventing a second transcript state machine.

### 3.4 Do not import private first-party React components

Cross-plugin cooperation should happen through:

- Cordis services;
- typed slots;
- public client/runtime contracts;
- public Session/Conversation faces.

Do **not** deep-import internal DSH components such as private `MessageItem`, private composer internals, or AppFrame implementation files.

### 3.5 DSH is still developer-preview software

Compatibility-breaking changes are expected upstream.

All DSH-specific calls must therefore be isolated behind small adapter/controller modules inside this plugin.

---

## 4. User-facing behavior

### 4.1 `/`

Normal DSH Web remains untouched.

```text
https://dsh.example.com/
```

shows the standard DSH developer UI.

### 4.2 `/qa`

```text
https://dsh.example.com/qa
```

shows only the QA assistant surface.

Example:

```text
┌───────────────────────────────────────────────┐
│ Acme Assistant                               │
│ Ask a question about the internal platform.  │
├───────────────────────────────────────────────┤
│                                               │
│  Assistant                                    │
│  Hi. How can I help?                          │
│                                               │
│                         User                  │
│                         How do I reset...?    │
│                                               │
│  Assistant                                    │
│  To reset...                                  │
│                                               │
├───────────────────────────────────────────────┤
│ Ask a question...                      Send   │
└───────────────────────────────────────────────┘
```

No first-party DSH navigation or admin controls should be visible through the QA surface.

---

## 5. Scope

### MVP must include

- `/qa` route recognition;
- full-screen QA overlay;
- responsive layout;
- automatic creation/restoration of one DSH Session;
- text prompts;
- streamed assistant text;
- persisted transcript through DSH Session persistence;
- loading/running state;
- Stop/Cancel;
- New Chat / Reset;
- Markdown rendering;
- basic errors and reconnect states;
- configurable title/welcome/placeholder;
- configurable fixed workspace/session target policy;
- configurable agent preset;
- configurable model override if explicitly set;
- **locked-down QA mode enabled by default**;
- fixed agent preset with no QA-user agent switching;
- `read-only` by default, with an opt-in fenced per-account
  `workspace-write` mode;
- forced `approval=never` / no permission escalation;
- allow-list based tool exposure for QA sessions;
- no model/workspace/permission/mode/settings switching from the QA surface;
- safe handling of unsupported interactive states;
- no leakage of tool calls/reasoning into the QA transcript by default;
- same-origin use of the normal DSH connection/API stack;
- desktop and mobile layout;
- package build/install instructions;
- tests.

### Post-MVP candidates

- image/file attachments;
- suggested-question chips;
- source/citation cards;
- compact tool-status indicators;
- explicit `ask_user_question` support;
- explicit approval UI;
- conversation rating/feedback;
- custom branding/logo;
- iframe embedding helper;
- embeddable JS launcher/widget;
- richer per-user session hierarchy;
- anonymous guest sessions behind a dedicated auth gateway;
- dedicated `qa` DSH profile/bundle;
- multiple assistant presets selected by URL;
- public conversation links.

---

## 6. Non-goals

The MVP must **not**:

- fork DeepSeek Harness;
- modify DSH built frontend files after every update;
- start a second Vite/React server for production;
- implement its own LLM provider calls;
- duplicate DSH Agent Loop;
- duplicate DSH Session persistence;
- bypass DSH browser trust/auth mechanisms;
- enable unrestricted CORS;
- automatically approve permission requests;
- automatically answer agent questions;
- expose admin/settings APIs to unauthenticated users;
- rely on hidden/disabled UI controls as the only security boundary;
- allow the QA user to switch agent preset, workspace, model, sandbox mode, approval policy, or permission preset;
- expose a general-purpose shell/terminal/code-execution tool in the default locked-down preset;
- expose mutable external-service tools by default;
- expose raw reasoning by default;
- expose raw tool arguments/results by default;
- depend on private DSH component implementation details;
- take over first-party `sidebar`, `conversation`, `details`, or `root` seats globally.

---

## 7. Package name

Preferred npm/package name:

```text
dsh-qa-surface
```

If using an npm scope:

```text
@<scope>/dsh-qa-surface
```

Repository topic:

```text
dsh-plugin
```

---

## 8. Proposed repository structure

```text
dsh-qa-surface/
├── package.json
├── README.md
├── LICENSE
├── CHANGELOG.md
├── tsconfig.json
├── tsconfig.host.json
├── tsconfig.client.json
├── tsdown.config.ts
├── cordis.patch.yml              # example install/composition patch
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   ├── EMBEDDING.md
│   └── COMPATIBILITY.md
├── src/
│   ├── index.ts                   # Host half
│   ├── config.ts
│   ├── settings.ts
│   ├── invariant.ts
│   └── client/
│       ├── index.ts               # browser apply()/inject
│       ├── QaSurface.tsx
│       ├── QaSessionController.ts
│       ├── QaRouteController.ts
│       ├── QaConfigController.ts
│       ├── QaTranscriptAdapter.ts
│       ├── components/
│       │   ├── QaHeader.tsx
│       │   ├── QaTranscript.tsx
│       │   ├── QaMessage.tsx
│       │   ├── QaComposer.tsx
│       │   ├── QaStatus.tsx
│       │   ├── QaError.tsx
│       │   └── SuggestedQuestions.tsx
│       ├── stores/
│       │   ├── qa-route-store.ts
│       │   ├── qa-session-store.ts
│       │   └── qa-config-store.ts
│       ├── styles/
│       │   └── qa-surface.module.css
│       └── types.ts
└── test/
    ├── config.test.ts
    ├── route.test.ts
    ├── session-controller.test.ts
    ├── transcript-adapter.test.ts
    ├── client-smoke.test.tsx
    └── e2e/
        ├── qa-route.spec.ts
        ├── qa-stream.spec.ts
        ├── qa-reload.spec.ts
        └── qa-error.spec.ts
```

The exact external-build tsdown setup may need to mirror DSH's lazy-CJS client bundle format because DSH does not currently publish a general external client build preset.

---

## 9. `package.json` requirements

The package must expose both halves.

Conceptual shape:

```json
{
  "name": "dsh-qa-surface",
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-theme"
      ]
    }
  }
}
```

The exact dependency edge list must be verified against the installed DSH version during implementation.

Do not add dependencies merely to obtain private UI components.

---

## 10. Host half

The Host half should be intentionally small.

Responsibilities:

1. declare and validate plugin config;
2. register a DSH settings namespace for user-configurable values;
3. expose only the sanitized config required by the browser through supported DSH settings/client mechanisms;
4. optionally register plugin diagnostics/invariant information;
5. do not create sessions at startup;
6. do not create another HTTP server;
7. do not register a second SPA fallback;
8. do not change `/api` transport security.

### 10.1 Config source

Use standard DSH/Cordis composition config as defaults and integrate with the DSH settings subsystem where practical.

Preferred namespace:

```text
qa-surface
```

The browser boot graph itself contains package ids/URLs/dependency edges, not arbitrary plugin config. Therefore do **not** assume Host Cordis config magically arrives as arguments to the browser half.

Preferred config transport:

- Host registers a normal settings namespace;
- Browser reads it through the supported DSH settings/client service;
- settings writes remain subject to normal DSH permissions/trust.

Avoid creating an unauthenticated `/qa-config.json` endpoint.

### 10.2 LAN config channel

DSH pins settings RPCs to loopback (`settings.*` sits in the gateway's
privileged method set), so a browser served from a non-loopback bind always
sees the namespace as `unavailable`. The Host half therefore exposes one
additional read-only Remote, `qaSurface/describe`, returning the effective
resolved configuration — the same projection `secureSession` attests against.
It is the network-neutral answer to responsibility 3: still plugin-scoped,
still no arbitrary Host config, no secrets, no file paths beyond the
configured ids, and no admission authority (enforcement stays in
`secureSession`).

Client contract: when the settings namespace is `unavailable` — and only
then — the browser calls `describe` once per controller lifetime, waits in
`loading`, and adopts the returned configuration as `ready`; a rejected or
invalid answer falls back to the client defaults under `unavailable`. A
readable namespace always wins and keeps delivering live updates.

LAN serving itself is a deployment composition concern, not plugin config:
the shipped `deploy/qa-lan.patch.yml` overlay binds the `webserver` row to
`0.0.0.0`, and the DSH `/api` browser-trust fence derives the LAN authorities
on its own. See the README "Serving the QA rig over the LAN" section for the
deployment responsibilities this creates.

---

## 11. Configuration model

Proposed initial schema:

```yaml
enabled: true

route:
  path: /qa
  matchChildren: true

branding:
  title: Помощник
  subtitle: ""
  welcomeMessage: "Чем могу помочь?"
  placeholder: "Задайте вопрос…"
  logoUrl: null

session:
  policy: browser-persistent
  storageKey: dsh-qa-surface.session
  workspaceId: null
  fixedSessionId: null
  agentPreset: null
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

suggestedQuestions:
  - "Что ты умеешь?"
  - "С чего начать?"
  - "Помоги разобраться с ошибкой"

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

embedding:
  frameAncestors: null
```

### 11.1 `route.path`

Default:

```text
/qa
```

Normalize:

- must start with `/`;
- remove trailing slash except root;
- reject `/api` and `/plugins` prefixes;
- reject empty strings.

### 11.2 Session policies

Support three policy names in schema, but MVP only needs to fully implement the first two.

#### `browser-persistent` — default

- first visit creates a DSH Session;
- store its id in browser storage;
- reload/revisit restores it if the Host still knows the Session;
- invalid/missing session id creates a replacement;
- Reset creates a new Session and replaces the stored id.

#### `new-on-load`

- every fresh page load creates a new Session;
- SPA navigation within the same page may keep it until leaving `/qa`;
- suitable for kiosk/demo use.

#### `fixed`

- use `fixedSessionId`;
- intended only for controlled internal deployments;
- must never silently create that id if access policy refuses it;
- not recommended for multiple independent users.

### 11.3 Workspace binding

For a deterministic QA assistant, a configured workspace is preferred.

MVP config:

```yaml
session:
  workspaceId: <configured DSH workspace id>
```

If `workspaceId` is absent, implementation may fall back to DSH's normal recent/current workspace logic only when that behavior is explicitly documented in the README.

Do not silently bind to an arbitrary workspace if multiple are present.

### 11.4 Agent preset

If configured:

```yaml
session:
  agentPreset: qa-assistant
```

new QA sessions must use that preset.

This is the preferred place to encode:

- QA system prompt;
- skills;
- tools;
- knowledge integrations;
- permission policy;
- model policy.

Do not stuff all assistant behavior into the UI plugin.

### 11.5 Model selection

Default:

```yaml
provider: null
model: null
```

means use DSH deployment/session defaults.

If both are configured, apply the model selection to the QA session through the public session model-selection path.

In locked-down mode, never render a model picker and do not expose a controller action for model switching. If provider/model are left `null`, operator deployment defaults may still determine the model for newly created sessions; that is an operator-side policy change, not a QA-user choice.



### 11.6 Locked-down execution policy

`/qa` must default to a **capability-reduced execution profile**, not merely a visually simplified UI.

The desired invariant is:

```text
QA user can:
  - submit text questions;
  - receive assistant answers;
  - stop the current turn;
  - optionally start a fresh QA session.

QA user cannot:
  - change the agent preset;
  - change workspace/cwd;
  - change model/provider/reasoning mode;
  - change permissions/sandbox/approval policy;
  - invoke DSH slash commands;
  - mutate settings;
  - open arbitrary existing sessions;
  - rename/delete sessions;
  - gain a shell/terminal merely because it exists globally;
  - trigger write-capable Jira/GitHub/Confluence/Slack/email/etc. actions;
  - escalate from the configured sandbox mode to a wider mode.
```

This must be enforced in layers. Hiding selectors is only the presentation layer.

#### Layer 1 — fixed session composition

For every newly created QA session:

- use exactly the configured `session.agentPreset`;
- use exactly the configured `session.workspaceId`; in per-user mode resolve
  its path and use only `.qa-users/<account UUID>` below it as cwd;
- if model/provider are configured, use exactly those values;
- refuse to silently fall back to another agent/workspace when the configured value is missing;
- persist the selected QA session id, but do not persist user-selectable composition overrides.

DSH currently treats the agent preset as a per-session composition fact. Existing upstream behavior already prevents changing the preset after a session has produced history; blank sessions may still have a preset choice before the first turn. Therefore the QA controller must create/bind the session with the configured preset and never expose the blank-session preset selector.

Reference:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-agent-preset/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md

#### Layer 2 — force `read-only` + `approval=never`

The locked-down QA policy must pin both independent DSH permission knobs:

```yaml
sandbox: read-only
approval: never
```

Prefer defining a named deployment preset:

```yaml
permissionPresets:
  presets:
    qa-read-only:
      sandbox: read-only
      approval: never
      name: QA Read Only
      description: No filesystem mutations and no permission escalation.
```

On a **shared operator + QA DSH instance**, do not make `qa-read-only` the process-wide `defaultPreset` merely for this plugin, because that would also change the default permissions of ordinary operator-created sessions. Instead, the QA bootstrap path must select/pin `qa-read-only` on the freshly created blank QA session **before the first prompt is accepted**, then verify the effective sandbox/approval facts.

On a **dedicated QA DSH instance**, setting `defaultPreset: qa-read-only` is recommended as an additional fail-safe.

The exact surrounding Cordis row/config syntax must be adapted to the target deployment.

The only wider supported policy is `workspace-write`, and only when
`accounts.perUserWorkspace` is enabled. That mode requires accounts, a
registered `workspaceId`, fixed-workspace enforcement, Host-owned session
creation, canonical read/write path checks, subagent root propagation, and
fixed storage quotas. Child account directories are not registered as DSH
Workspaces.

Important: DSH's shipped permission preset table normally contains `workspace-write` and `danger-full-access`; `qa-read-only` is an explicit custom table entry for this deployment. The underlying knobs are the authoritative enforcement facts.

`approval=never` is required because it deterministically rejects operations that request approval instead of presenting an approval UI. The QA surface must never implement an auto-approve path.

References:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-policy/README.md

#### Layer 3 — tool allow-list, not a deny-list

`read-only` is **not equivalent to “no side effects.”** It governs file effects enforced by the DSH file sandbox; network and process visibility are outside that sandbox vocabulary. A shell command can still make network requests or trigger external side effects even when filesystem writes are denied.

Therefore the default QA preset must use an explicit **allow-list of reviewed tools**.
The writable per-user mode may add `write`/`edit`; process, LSP, ancestor-git,
and unrestricted downloader tools remain denied.

Conceptual policy:

```yaml
lockdown:
  toolPolicy:
    mode: allow-list
    allow:
      - knowledge.search
      - knowledge.read
      - web.search
      - web.fetch
```

The actual names must come from the composed DSH deployment. Do not copy these illustrative names blindly.

Prefer allow-list semantics because newly installed global tools are then excluded automatically. DSH has a scoped `ToolRestriction.allow` mechanism for inherited global tools. Note that tools registered directly inside the agent's own scope are intentionally exempt from inherited restrictions, so **the QA agent preset itself must also be reviewed and must not register write-capable tools**.

References:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts

Default deny category examples:

| Capability | Default QA policy | Reason |
|---|---|---|
| generic shell / bash / terminal | deny | can create non-filesystem side effects and broad host visibility |
| generic code runtime | deny | same reason unless a separately constrained pure-compute runtime exists |
| fs write/edit | deny by default; allow only in fenced per-user mode | direct mutation |
| git commit/push/checkout/reset | deny | repository mutation / remote side effects |
| Jira create/update/comment/transition | deny | external mutation |
| Confluence create/update/delete | deny | external mutation |
| Slack/email send | deny | external mutation |
| browser/computer-use click/type/submit | deny | arbitrary external side effects |
| settings/plugin management | deny | can expand capabilities |
| permission/preset management | deny | can expand capabilities |
| agent-preset management | deny | can change composition |
| read-only KB/search/fetch tools | allow only after review | intended QA capability |

For MCP, allow-list at the **tool level**, not merely at the server name. A server may expose both read and write actions.

#### Layer 4 — no mutation commands or alternate control paths

The QA composer must call the plain public prompt path directly and must not expose the general DSH command dispatcher.

Default:

```yaml
lockdown:
  allowSlashCommands: false
```

At minimum prevent QA-side use of control paths equivalent to:

```text
/permission ...
/permissionPresets ...
agent/preset selectors
model selectors
workspace selectors
settings mutation
plugin management
```

Do not rely only on filtering strings that start with `/` if the DSH prompt API already provides a command-free prompt submission method. Prefer bypassing command adjudication entirely.

#### Layer 5 — controller-side invariant checks

`QaSessionController` must verify its effective session state before enabling Send.

Conceptual check:

```ts
interface QaLockdownInvariant {
  agentPresetMatches: boolean
  workspaceMatches: boolean
  modelMatches: boolean
  sandboxModeMatches: boolean
  approvalIsNever: boolean
  toolPolicyLoaded: boolean
}
```

If a required invariant cannot be proven, fail closed:

```text
Assistant configuration is unavailable.
```

and disable the composer. Do not continue under a wider or unknown policy.

A mismatch should be operator-visible in logs with the expected and actual policy identifiers, but the QA page should not expose sensitive details.

#### Layer 6 — host-side guard where public DSH seams allow it

UI/controller checks protect normal use but are not enough against another client using the same authenticated DSH APIs. During implementation, use public Host-side DSH enforcement seams where available to bind QA-marked sessions to the locked policy.

Preferred mechanisms, in order:

1. compose the QA preset so forbidden tools are not mounted at all;
2. apply scoped tool restrictions to inherited tools;
3. pin sandbox and approval facts before the first QA prompt;
4. prefer a Host-side QA session bootstrap operation that creates/binds the session and pins the QA permission facts in one controlled flow, if DSH exposes a clean public seam;
5. otherwise create a blank session, immediately select `qa-read-only`, verify it, and keep Send disabled until verification succeeds;
6. add a monotonic `tools/pre-execute` / execution guard for QA sessions if a second server-side side-effect check is needed;
7. never implement capability expansion through the QA plugin.

Do not monkey-patch private RPC handlers merely to create a guard. If DSH has no public seam for a particular mutation path, document that limitation and move the boundary to deployment isolation rather than pretending the browser UI makes it secure.

#### Layer 7 — deployment isolation for strong guarantees

A `/qa` overlay on the same fully privileged DSH Host is **not a security boundary by itself**. If the same authenticated user can navigate to normal `/`, call privileged DSH APIs, or use another DSH client, hiding controls on `/qa` does not revoke those Host capabilities.

For an internal convenience UI, the layered session/tool policy above may be enough.

For untrusted or semi-trusted QA users, prefer one of:

```text
Best isolation:
  dedicated QA DSH instance/container
  + only QA preset/tools mounted
  + read-only corpus mounts
  + no developer credentials
  + restricted network egress

Good isolation:
  separate QA auth role/gateway
  + Host-side API authorization for mutable capabilities
  + locked QA preset/tool registry

Weakest:
  same privileged DSH Host/browser identity
  + UI controls merely hidden
```

DSH upstream explicitly warns that it is developer-preview software and sandbox/approval controls are risk reducers, not a complete isolation boundary.

Reference:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md

#### Read isolation caveat

Current `read-only` means “no filesystem mutation,” not “the agent can only read its workspace.” Upstream discussion notes that read isolation outside the workspace is not currently guaranteed. Therefore a high-assurance QA deployment should avoid exposing generic shell/fs inspection tools and should mount only the data the QA runtime is intended to read.

Reference:

- https://github.com/deepseek-ai/deepseek-harness/discussions/492

---

## 12. Browser-side plugin activation

### 12.1 Dependencies

The browser half should depend only on public DSH services required for:

- slots;
- client runtime/sessions;
- connection state;
- theme tokens;
- settings/config projection;
- optionally locale.

Conceptual Cordis inject list:

```ts
export const inject = [
  'slots',
  'sessions',
  'connection',
  'theme',
  // settings service used for qa-surface config
]
```

Exact service names must be resolved against the target DSH release.

### 12.2 Slot registration

Register one root-scoped entry into:

```text
shell.overlay
```

Conceptually:

```ts
ctx.slots.inject('shell.overlay', () =>
  ctx.slots.register(
    {
      name: 'shell.overlay',
      key: 'dsh-qa-surface'
    },
    QaSurfaceEntry,
  ),
)
```

The entry remains mounted but returns `null` whenever the route is not active.

Do not register into `root`, `sidebar`, or `conversation` as the default implementation.

---

## 13. Route handling

Create a small `QaRouteController`.

Responsibilities:

- read `window.location.pathname`;
- normalize route prefix;
- publish `active: boolean`;
- react to browser history changes;
- react to `popstate`;
- optionally wrap `pushState`/`replaceState` only if DSH provides no public navigation event;
- restore patches on disposal.

Matching rules for default `/qa`:

```text
/qa       → active
/qa/      → active
/qa/foo   → active when matchChildren=true
/qabc     → inactive
/         → inactive
/api/...  → never intercepted
```

### 13.1 Important routing property

Do not register a Host exact `/qa` route just to return HTML.

DSH frontend-static already performs SPA fallback to `index.html` for unknown GET paths.

A dedicated Host route is only justified later if `/qa` needs special HTTP headers or a different document.

---

## 14. Full-screen overlay behavior

When QA route becomes active:

1. render a fixed full-viewport surface above AppFrame;
2. assign a high but locally-scoped z-index compatible with DSH overlays;
3. cover the full viewport including the native sidebar rail;
4. prevent background pointer interaction;
5. lock background scrolling;
6. ensure focus starts in the QA composer when appropriate;
7. restore all modified document state when route deactivates or plugin disposes.

Recommended DOM marker:

```text
body[data-dsh-qa-surface="active"]
```

Use this marker for route-scoped global corrections only.

Do not permanently patch DSH CSS.

### 14.1 Accessibility

The hidden native UI below the overlay must not remain meaningfully keyboard-accessible.

Preferred order:

1. if a stable AppFrame root can be addressed through a public contract, set it inert while QA is active;
2. otherwise implement focus containment inside the QA surface and prevent background pointer events;
3. document any remaining limitation.

Do not depend on brittle generated CSS class names to find native UI.

---

## 15. Session controller abstraction

Create a plugin-owned adapter:

```text
QaSessionController
```

This is the only module allowed to know detailed DSH Session/Runtime method names.

UI components consume a plugin-owned interface such as:

```ts
interface QaSessionState {
  phase:
    | 'idle'
    | 'creating'
    | 'ready'
    | 'running'
    | 'reconnecting'
    | 'blocked'
    | 'error'

  sessionId: string | null
  messages: readonly QaMessage[]
  error: string | null
  canSend: boolean
  canStop: boolean
}

interface QaSessionActions {
  ensureSession(): Promise<void>
  send(text: string): Promise<void>
  stop(): Promise<void>
  reset(): Promise<void>
  retryConnection(): void
}
```

Benefits:

- isolates upstream DSH API changes;
- keeps React components DSH-version-agnostic;
- easy unit testing;
- avoids private component imports.

---

### 15.1 Optional chat-history sidebar

`ui.showSessionList` (default `false`) renders a minimal sidebar beside the
conversation. Contract:

- the index is per browser: localStorage `<storageKey>:v1:<route>:chats`,
  session ids only, most recently used first, capped at 50;
- rows are the index intersected with the Host session list, so shared-host
  users never see each other's chats;
- switching goes through the same bind + `secureSession` attestation path as
  restore; a missing id is pruned and reported; an attestation failure keeps
  the index entry and surfaces the generic configuration error;
- `New chat` in the sidebar follows the same `allowSessionReset` gate as the
  header control; the previous chat stays in the index;
- each row carries a two-click delete control: the first click arms it, the
  second removes the chat from this browser's index (the Host session stays —
  DSH 0.1.x has no session-deletion seam); deleting the open chat continues
  in a fresh attested session when resets are allowed;
- the sidebar hides below 600px viewports and under `fixed` policy it renders
  without the new-chat control and never switches.

## 16. Session creation / restore algorithm

### 16.1 `browser-persistent`

Pseudo-flow:

```text
activate /qa
   │
   ▼
load stored session id
   │
   ├── exists ──► resolve/open through DSH runtime
   │                │
   │                ├── valid ─► use it
   │                └── gone/forbidden ─► clear local id
   │
   └───────────────────────────────────────┐
                                           ▼
                                   create DSH Session
                                           │
                                           ▼
                                  apply preset/model
                                           │
                                           ▼
                                 persist session id
                                           │
                                           ▼
                                        ready
```

### 16.2 Storage

Use a versioned key:

```text
dsh-qa-surface:v1:<route>:session
```

Do not persist:

- prompt text after send;
- raw credentials;
- provider secrets;
- tool results;
- transcript copies.

The DSH Session is the authoritative transcript store.

### 16.3 Reset

In default locked-down mode:

```yaml
lockdown:
  allowSessionReset: false
ui:
  showReset: false
```

so the QA user gets one persistent conversation and cannot create arbitrary additional sessions from the surface.

If an operator explicitly enables Reset, it means:

- stop active generation if needed;
- create a fresh DSH Session using the configured workspace/preset;
- apply and verify the locked QA permission policy before enabling Send;
- switch controller binding to it;
- replace stored session id;
- do not delete the old DSH Session automatically.

Old sessions can remain available to operators in normal DSH Web.

---

## 17. Prompt sending

The QA surface needs **plain text prompt submission**, not the full DSH developer composer.

Preferred implementation:

- use the public Session/client runtime prompt method;
- use Host-authoritative acceptance;
- disable duplicate sends while the submit request is unresolved;
- rely on DSH session events/snapshots for resulting user/assistant messages;
- do not optimistically fabricate an assistant message.

Conceptual flow:

```text
QaComposer
   │ send(text)
   ▼
QaSessionController
   │
   ▼
public DSH Session.prompt(...)
   │
   ▼
Host Session Controller
   │
   ▼
Agent Loop
   │
   ├── LLM
   ├── tools
   ├── MCP
   └── subagents
   │
   ▼
Session events
   │
   ▼
Client Session snapshot
   │
   ▼
QaTranscriptAdapter
   │
   ▼
QaTranscript
```

### 17.1 Slash commands

MVP QA input must treat normal text as text.

Do not expose the DSH slash-command menu.

If the public `Session.prompt()` path bypasses slash-command adjudication, that is desirable for the QA surface.

If the selected DSH API automatically interprets slash commands, document it and either:

- escape/disable them for QA;
- or explicitly allow them through config.

Default must favor predictable QA text behavior.

---

## 18. Transcript projection

Create:

```text
QaTranscriptAdapter
```

Input:

- public DSH Session conversation snapshot/event projection.

Output:

```ts
type QaMessage =
  | {
      id: string
      role: 'user'
      text: string
      status: 'committed'
    }
  | {
      id: string
      role: 'assistant'
      text: string
      status: 'streaming' | 'committed' | 'failed'
    }
  | {
      id: string
      role: 'system'
      text: string
      status: 'info' | 'error'
    }
```

### 18.1 Visible by default

Render:

- user text;
- assistant visible text;
- generation failure summary;
- plugin-owned status notices.

### 18.2 Hidden by default

Unless the corresponding operator-controlled work-detail option is enabled, do
not render:

- reasoning chunks;
- tool call arguments;
- tool results;
- execution trajectory;
- subagent internals;
- system prompt;
- hidden metadata;
- raw event JSON;
- token usage.

The events may still exist in the Session and normal DSH operator UI.

### 18.3 Tool activity

Optional config:

```yaml
ui:
  showToolActivity: true
  showReasoning: true
```

projects one work disclosure for each DSH turn. While the turn is running the
disclosure is expanded and streams available reasoning/tool state. Once the
turn completes it collapses before the final answer to a duration summary such
as:

```text
Worked for 1m 24s
```

Expanding it shows reasoning, intermediate assistant progress, and tool rows.
Tool rows may independently reveal their formatted arguments and results.
These flags are presentation-only: they must not add tools, weaken
`lockdown.toolPolicy`, or expose system/context events and raw Host failures.

---

## 19. Streaming

Assistant text should update from the same Session client snapshot used by normal DSH.

Requirements:

- do not create a second SSE/WebSocket connection;
- do not parse provider streams directly;
- use existing DSH connection generation/reconnect path;
- preserve partial assistant text while running;
- on reconnect, converge to Host/session history;
- no duplicated chunks after reconnect;
- scrolling should follow the latest assistant output only while the user remains near the bottom.

---

## 20. Composer behavior

### Default UX

- multiline textarea;
- Enter → send;
- Shift+Enter → newline;
- disable Send for empty/whitespace-only draft;
- while running, show Stop;
- optionally allow another prompt only after current turn finishes in MVP;
- restore draft on transport error when submission was not accepted;
- clear draft only after Host accepts the prompt.

### Accessibility

- textarea has explicit label/aria-label;
- Send and Stop are real buttons;
- busy status uses `aria-live` where appropriate;
- keyboard behavior documented;
- focus returns to composer after assistant completion unless the user moved focus intentionally.

---

## 21. Interactive tools, approvals and user questions

This is a critical safety/UX area.

DSH agents can enter states that require human interaction, for example:

- permission approval;
- plan review;
- `ask_user_question` / interactive question.

The QA surface must **not silently auto-approve** these states.

### MVP policy

Default config:

```yaml
interaction:
  approvals: blocked
  questions: unsupported
```

Recommended deployment architecture:

- force the QA session to the dedicated `qa-read-only` permission bundle;
- force `approval=never`;
- remove tools that require escalation rather than allowing an approval flow;
- use an allow-list of reviewed read-only tools;
- grant no mutable external-service permissions to the QA agent.

In locked-down mode, an approval request is treated as a policy/configuration failure or an unsupported operation, not as something the QA user may approve.

If the Session enters an unsupported pending interaction state:

1. stop accepting new text prompts;
2. display a generic message such as:

```text
This request requires an interaction that is not available in this assistant view.
```

3. provide Reset or Retry where sensible;
4. keep the detailed interaction visible to an operator in normal DSH Web;
5. never resolve the approval automatically.

### Post-MVP

Add dedicated compact UI for:

- questions/options;
- explicit allow/deny approval;
- plan review.

These should use the public DSH interaction APIs, not DOM automation against native dialogs.

---

## 22. Connection and reconnect states

Use DSH's existing browser-host connection.

QA UI states:

### Initial connecting

```text
Connecting…
```

### Reconnecting

Keep transcript on screen and show a non-blocking banner:

```text
Connection lost. Reconnecting…
```

### Restored

Remove banner after Host state converges.

### Fatal connection error

Show:

- concise error;
- Retry button if the DSH connection layer supports it;
- no raw stack trace to QA user.

Raw errors should still be logged for operators/development.

---

## 23. Error handling

Map internal failures to QA-safe UI errors.

Examples:

| Internal class | QA message |
|---|---|
| session creation rejected | "Unable to start a chat." |
| prompt rejected | "Your message could not be sent." |
| model route unavailable | "The assistant is temporarily unavailable." |
| connection lost | "Connection lost. Reconnecting…" |
| unsupported approval | "This request requires operator interaction." |
| malformed persisted session id | silently clear and create a new session |

Never render:

- local filesystem paths;
- credentials;
- stack traces;
- raw model/provider payloads;
- internal tool arguments.

Add structured client logging behind a debug flag.

---

## 24. Styling

Follow DSH Web styling conventions where practical:

- CSS Modules;
- reuse DSH semantic theme variables/tokens;
- no Tailwind dependency;
- no global CSS framework;
- no hardcoded assumption that DSH runs dark-only or light-only.

QA surface may define local layout variables such as:

```css
.qaSurface {
  --qa-max-content-width: 900px;
}
```

Shared color/typography values should derive from DSH theme tokens when available.

### 24.1 Responsive requirements

Desktop:

- centered content column;
- configurable max width;
- sticky composer bottom.

Mobile:

- full width;
- safe-area padding;
- textarea remains visible above virtual keyboard as far as browser allows;
- buttons remain touch-sized;
- no horizontal scroll.

---

## 25. Theme behavior

The plugin should automatically follow DSH's resolved theme.

Do not independently implement another dark/light preference system in MVP.

Optional future config may force a branded theme, but normal DSH semantic variables should remain the base.

---

## 26. Security model

### 26.1 Same-origin only by default

Preferred deployment:

```text
https://assistant.example.com/qa
https://assistant.example.com/api/...
```

or a reverse proxy exposing DSH under the same public origin.

Do not implement cross-origin API calls merely for the QA page.

### 26.2 Preserve DSH trust fence

Do not:

- forge Host/Origin;
- disable browser trust globally;
- add permissive CORS;
- bypass signed browser-session/auth checks.

### 26.3 Authentication is deployment-owned

`dsh-qa-surface` is primarily a **surface plugin**, not a full identity provider.

For remote/public deployment, place it behind the deployment's intended auth layer, for example:

- an existing DSH Web auth plugin;
- reverse-proxy SSO/OIDC;
- another explicitly configured access gateway.

The plugin must document that the DSH Host webserver itself is not a complete internet-facing authentication boundary.

### 26.4 Embedding

If iframe embedding is later enabled:

- require explicit operator opt-in;
- use CSP `frame-ancestors` at the reverse proxy or supported Host layer;
- do not blindly set `*`;
- preserve same-site/session-cookie requirements.

---

### 26.5 Capability-change endpoints

The QA browser bundle must not intentionally call mutable control-plane APIs for:

- settings writes;
- plugin enable/disable/config changes;
- agent preset authoring/deletion/default changes;
- permission preset switching;
- sandbox mode changes;
- approval policy changes;
- workspace rebinding;
- model/provider switching;
- arbitrary session deletion/rename/import.

If a public read API is needed to verify the effective state, use it read-only and project only the minimum information required by the QA controller.

### 26.6 UI disabled state is defense-in-depth only

For every forbidden control that might accidentally appear because of future DSH composition changes:

- do not render it in the QA component;
- if inherited UI becomes reachable, make it inaccessible/inert;
- keep controller actions absent, not merely disabled;
- add E2E tests proving no selector/menu/command can alter the locked policy.

The absence of a button is not considered enforcement.

---

## 27. Operator vs QA-user separation

Desired deployment:

```text
/       → operator/developer DSH Web
/qa     → end-user QA surface
```

Both may use the same Host/runtime and the same persisted Sessions.

A QA-created session should remain inspectable by an authorized operator in normal DSH Web.

The plugin must not try to hide the Session from the Host/operator data model.

---

## 28. Session naming / discoverability

QA sessions should be recognizable in normal DSH Web.

Options, in preference order:

1. use an agent preset dedicated to QA;
2. set a title prefix when the public Session rename/title API makes this safe;
3. add plugin metadata only if DSH offers a public extension point.

Suggested title:

```text
QA: <auto-generated title>
```

Do not mutate raw Session log files directly.

---

## 29. Configuration UI

MVP does not require a custom rich settings page.

Preferred progression:

### Phase A

Config through `cordis.patch.yml` / plugin config.

### Phase B

Register the `qa-surface` settings namespace so values are manageable through normal DSH settings mechanisms.

### Phase C

Optionally contribute a settings card under the DSH Plugins settings section.

Fields suitable for UI editing:

- enabled;
- route path;
- title;
- subtitle;
- welcome message;
- placeholder;
- workspace;
- agent preset;
- provider/model;
- reset visibility;
- suggested questions;
- interaction policy.

Do not expose secrets in this settings namespace.

---

## 30. Example composition

Illustrative only; exact Loader syntax must match the deployment.

```yaml
- insert:
    - id: qa-surface
      name: dsh-qa-surface
      config:
        enabled: true
        route:
          path: /qa
          matchChildren: true
        branding:
          title: Internal Assistant
          welcomeMessage: Ask a question about the platform.
          placeholder: Ask a question...
        session:
          policy: browser-persistent
          workspaceId: company-knowledge
          agentPreset: qa-assistant
          provider: null
          model: null
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
          allowArbitrarySessionOpen: false
          toolPolicy:
            mode: allow-list
            allow:
              - <reviewed-read-only-tool>
        ui:
          showReset: false
          showStop: true
          showToolActivity: false
          showReasoning: false
```

If DSH patch semantics replace a row's entire config rather than merge fields, example docs must explicitly warn users to provide the complete config object required by that row.

---

## 31. Agent preset example

The UI plugin should not own the assistant's domain prompt.

Prefer a DSH agent preset conceptually like:

```text
qa-assistant
├── system prompt / persona
├── reviewed read-only knowledge/search tools only
├── read-only Jira/Confluence MCP actions only, if needed
├── selected skills
├── no shell / terminal / generic code runtime by default
├── no mutating external-service actions
├── qa-read-only permission policy
└── fixed model policy, if deployment requires it
```

This makes the same assistant reusable from:

- `/qa`;
- normal DSH Web;
- automation;
- future APIs.

---

## 32. Browser route lifecycle

Expected transitions:

### `/` → `/qa`

1. route store becomes active;
2. QA overlay mounts;
3. background interaction is disabled;
4. config loads;
5. session is restored/created;
6. transcript loads;
7. composer becomes available.

### `/qa` → `/`

1. QA overlay unmounts/returns null;
2. document scroll/focus modifications are restored;
3. background DSH UI becomes interactive again;
4. do not destroy the DSH Session;
5. do not dispose global DSH runtime services.

### Browser reload on `/qa`

1. frontend-static returns index;
2. normal DSH boot occurs;
3. plugin activates;
4. persisted QA Session is restored.

---

## 33. Native DSH UI interaction underneath overlay

Because the normal DSH app remains mounted, the plugin must avoid accidental duplicate user interaction.

Required:

- overlay captures pointer events;
- native UI not visible;
- focus cannot casually tab into background;
- document shortcuts from native DSH should not unexpectedly trigger while typing in QA.

If DSH exposes no public API to suspend global keyboard handlers, investigate whether:

- stopping propagation from the QA surface is sufficient;
- AppFrame can be made `inert` through a stable public/semantic selector;
- a minimal route-scoped document guard is needed.

Do not bind to minified/generated class names.

---

## 34. Observability

The plugin should remain observable through the existing DSH/OTel stack where possible.

Add lightweight plugin metrics/events only if DSH exposes a suitable seam.

Useful dimensions:

- QA surface opened;
- session created/restored;
- prompt accepted/rejected;
- turn completed/failed;
- reconnect;
- unsupported interaction encountered.

Do not record prompt/message content in telemetry by default.

Do not duplicate token/model telemetry already emitted by DSH.

---

## 35. Compatibility strategy

DSH currently warns that it is in developer preview and may make breaking changes.

The plugin must isolate DSH coupling.

### Adapter boundaries

Keep these modules small:

```text
QaSessionController.ts     DSH session runtime coupling
QaTranscriptAdapter.ts     DSH conversation projection coupling
QaConfigController.ts      DSH settings coupling
QaRouteController.ts       browser navigation coupling
```

UI components should depend on plugin-local types only.

### Version support

In README maintain a matrix:

```text
Plugin version   Tested DSH versions
0.1.x            ...
0.2.x            ...
```

At startup, fail gracefully when a required client service/slot is absent.

Do not silently mutate DSH internals to "repair" an unsupported version.

---

## 36. External client bundle compatibility

An external DSH browser plugin must produce the module format expected by the DSH Web client module loader.

The implementation agent must verify the current DSH external plugin build pattern before finalizing `tsdown.config.ts`.

Requirements:

- `./client` export resolves;
- package declares `dsh.client`;
- React/ReactDOM use DSH's shared runtime instances rather than bundling incompatible duplicates;
- client plugin bundle passes DSH's module/bundle purity expectations;
- CSS Modules are included correctly;
- source map optional but recommended;
- installation does not require rebuilding DSH's main frontend.

Use an existing external browser UI plugin as a packaging reference if necessary, but keep runtime integration based on official DSH contracts.

---

## 37. Testing plan

### 37.1 Unit tests

#### Config

- default config validates;
- route normalization;
- invalid `/api` route rejected;
- invalid session policy rejected;
- fixed policy requires session id;
- empty title/placeholder behavior defined;
- lockdown defaults to enabled;
- locked-down default disables session reset;
- `qa-read-only` selection is required before first prompt when lockdown is enabled.

#### Route controller

- `/qa` activates;
- `/qa/` activates;
- `/qa/foo` activates when configured;
- `/qabc` does not activate;
- popstate updates state;
- disposal restores any wrapped history functions/listeners.

#### Session controller

- restore valid session;
- missing session creates new;
- forbidden/stale stored id clears storage;
- reset creates new id;
- send rejects empty string;
- accepted send clears draft at correct time;
- rejected send preserves draft;
- stop calls public DSH cancellation path;
- unsupported pending interaction blocks composer;
- agent/workspace/model mismatch blocks composer;
- non-`read-only` sandbox state blocks composer;
- approval policy other than `never` blocks composer;
- lockdown config cannot be weakened through browser-local state.

#### Transcript adapter

- user event → user QA message;
- assistant chunks coalesce correctly;
- reconnect replay does not duplicate text;
- tool calls excluded;
- reasoning excluded;
- assistant failure projected safely.

### 37.2 Component tests

- composer keyboard rules;
- Stop replaces Send while running;
- reset confirmation if desired;
- reconnect banner;
- Markdown rendering;
- scroll-follow behavior;
- accessibility labels.

### 37.3 DSH integration tests

Boot actual DSH Web with plugin mounted.

Verify:

1. `/` still shows normal DSH UI;
2. `/qa` returns 200 through SPA fallback;
3. plugin client bundle appears in DSH client module graph;
4. `/qa` renders full-screen QA UI;
5. sending text creates/uses a real DSH Session;
6. assistant streaming works;
7. tool execution can occur without tool details becoming visible;
8. reload restores the same session under browser-persistent policy;
9. normal DSH UI can inspect the QA-created session;
10. `/qa` does not open a second server/connection stack;
11. every QA session starts with the configured agent preset;
12. every QA session runs in its configured, Host-attested sandbox; writable
    mode uses only the owning account's child cwd;
13. approval policy is `never`;
14. model/workspace selectors are absent;
15. permission selectors/commands are absent;
16. a denied write attempt cannot escalate;
17. a newly installed global tool not present in the allow-list is not visible to the QA agent.

### 37.4 Security / lockdown tests

- route does not weaken `/api` trust checks;
- config endpoint/settings do not leak secrets;
- raw tool result not visible;
- stack traces not visible;
- unsupported approval not auto-approved;
- `approval=never` rejects escalation deterministically;
- sandbox effective mode exactly matches the configured QA permission preset;
- QA user cannot invoke `/permission` or equivalent command dispatch;
- QA user cannot change agent preset, workspace, provider, model, or reasoning mode;
- QA user cannot mutate DSH settings/plugin config;
- QA user cannot reset/start additional sessions when `allowSessionReset=false`;
- QA user cannot open arbitrary existing sessions when `allowArbitrarySessionOpen=false`;
- write/edit/delete tools are absent or denied outside fenced per-user mode;
- shell/terminal/code-runtime are absent by default;
- mutable MCP actions are absent;
- allow-listed MCP read actions still work;
- adding a new global write-capable tool does not implicitly expose it to QA;
- a preset-local tool is reviewed separately because scoped registrations may bypass inherited `ToolRestriction`;
- direct malformed/browser-local attempts to weaken lockdown fail closed;
- cross-origin behavior remains blocked unless deployment explicitly changes it.

### 37.5 Side-effect regression suite

Maintain a table of every tool visible to `qa-assistant` and classify it:

```text
read-only / pure
external-read
filesystem-write
external-write
privilege/control-plane
unknown
```

CI must fail when a visible QA tool is `filesystem-write`, `external-write`, `privilege/control-plane`, or `unknown` unless the spec/config is intentionally updated and reviewed.

This guards against future plugin installs silently expanding the QA agent's capability surface.

### 37.5 Mobile tests

At minimum test:

- 375px width;
- 430px width;
- landscape small viewport;
- virtual keyboard/composer visibility manually.

---

## 38. Acceptance criteria

MVP is complete when all are true.

### Routing

- [ ] `GET /qa` loads successfully using the normal DSH Web server.
- [ ] `/` remains unchanged.
- [ ] `/qa` shows no visible normal DSH navigation/settings UI.
- [ ] leaving `/qa` restores normal UI without reload when SPA navigation is used.

### Runtime

- [ ] QA messages are sent through a real DSH Session.
- [ ] normal DSH tools/skills/MCP remain usable by the configured agent.
- [ ] no direct provider API call exists in the plugin.
- [ ] transcript persists through DSH.
- [ ] browser-persistent session survives reload.

### UI

- [ ] streaming assistant text works.
- [ ] Send works.
- [ ] Stop works.
- [ ] Reset works.
- [ ] Markdown works.
- [ ] mobile layout is usable.
- [ ] tool calls/reasoning are hidden by default.

### Safety/security

- [ ] no auto-approval.
- [ ] no raw internal errors in QA UI.
- [ ] no trust-fence bypass.
- [ ] no permissive CORS added.
- [ ] no secrets stored in localStorage.

### Maintainability

- [ ] no DSH core patch required.
- [ ] no DSH frontend rebuild required for plugin installation.
- [ ] DSH-specific API coupling isolated behind adapters.
- [ ] compatibility matrix documented.

---

## 39. Implementation phases

### Phase 0 — Compatibility spike

Goal: prove the external browser plugin packaging and public APIs before building UI.

Tasks:

1. create package skeleton;
2. build Host and `./client` halves;
3. mount plugin through DSH config;
4. register trivial `shell.overlay` entry;
5. prove it appears only on `/qa`;
6. inspect available public client runtime Session APIs;
7. prove one session can be created/restored;
8. prove one plain-text prompt can be sent;
9. prove assistant text can be observed from a public snapshot;
10. record exact tested DSH commit/version in `docs/COMPATIBILITY.md`.

**Exit condition:** a hardcoded QA overlay can send `hello` through DSH and render the assistant reply without importing private components.

### Phase 1 — MVP surface

Tasks:

1. route controller;
2. full-screen shell.overlay surface;
3. QA layout/components;
4. session controller;
5. transcript adapter;
6. plain text composer;
7. streaming;
8. stop;
9. reset;
10. browser-persistent session id;
11. errors/reconnect;
12. Markdown;
13. basic responsive CSS.

### Phase 2 — Configuration

Tasks:

1. Schemastery config;
2. settings namespace;
3. browser config controller;
4. branding values;
5. workspace binding;
6. preset/model selection;
7. suggested questions;
8. README config examples.

### Phase 3 — Hardening

Tasks:

1. focus containment/background inert behavior;
2. unsupported interaction handling;
3. sanitization/error mapping;
4. reconnect/replay tests;
5. mobile fixes;
6. accessibility pass;
7. security test suite;
8. compatibility guards.

### Phase 4 — Deployment/embedding

Tasks:

1. Docker/local-plugin installation docs;
2. reverse-proxy example;
3. auth prerequisite docs;
4. iframe notes;
5. CSP/frame-ancestor guidance;
6. production smoke test.

### Phase 5 — Optional native QA profile

Only after plugin MVP is stable.

Create a separate bundle/profile that composes:

```text
base runtime
+ webserver
+ connection/API
+ client runtime
+ theme
+ qa surface
```

and omits unnecessary standard DSH UI packages.

The existing `dsh-qa-surface` UI/controller code should be reusable without substantial rewrite.

---

## 40. Coding-agent instructions

The implementation agent should follow these rules.

1. **Read current upstream source first.** DSH is moving quickly; verify all slot/service/method names against the installed version.
2. **Do not deep-import private DSH React components.** If a needed behavior is not exposed publicly, implement a plugin-local presentation over the public object layer.
3. **Do not patch DSH core for MVP.** Escalate instead if a true public extension point is missing.
4. **Do not claim root/sidebar/conversation single slots globally.** MVP surface is additive `shell.overlay`.
5. **Use the normal DSH Session Controller/client runtime.** No direct provider requests.
6. **Treat Host state as authoritative.** Client-local state is UI/draft/session-id reference only.
7. **Never auto-approve an interaction.** Unsupported interaction blocks safely.
8. **Keep DSH-specific APIs behind adapter modules.**
9. **Add tests together with each adapter.**
10. **Record every upstream contract relied on in `docs/COMPATIBILITY.md`.**
11. **Prefer same-origin.** Do not solve embedding by weakening Host/Origin checks.
12. **Keep configuration declarative.** Support Docker/self-hosted deployment without manual post-update patching.

---

## 41. Suggested first implementation commits

Recommended sequence:

```text
1. chore: bootstrap dsh-qa-surface dual-face package
2. feat: register route-aware shell.overlay entry
3. feat: add qa full-screen layout and theme integration
4. feat: add DSH session adapter and session restore/create
5. feat: add transcript adapter and streaming assistant messages
6. feat: add composer send/stop/reset flows
7. feat: add plugin settings/config projection
8. feat: add unsupported-interaction and reconnect states
9. test: add DSH integration and route/session coverage
10. docs: add install, configuration, security and compatibility docs
```

---

## 42. Known risks

### Risk: upstream DSH client contracts change

Mitigation:

- adapter boundary;
- compatibility matrix;
- integration CI against pinned DSH version(s).

### Risk: `shell.overlay` is semantically a floating layer

It is currently the safest additive frame-wide seat, but it is not a true global-page primitive.

Mitigation:

- treat it as MVP transport only;
- keep QA component independent of overlay mechanics;
- future migration to dedicated `qa` profile/global-page extension requires changing only the mount adapter.

### Risk: background DSH UI still exists

Mitigation:

- full viewport pointer capture;
- focus containment/inert where stable;
- route-scoped keyboard handling tests.

### Risk: hidden interactive approval blocks the agent

Mitigation:

- QA-specific permission preset;
- explicit pending-interaction detection;
- fail closed;
- later implement real compact interaction UI.

### Risk: multi-user use with browser-persistent sessions

Browser-local session mapping is not an identity system.

Mitigation:

- MVP intended for authenticated/internal deployments;
- later add per-user mapping only when a stable authenticated user identity is available.

### Risk: workspace coupling

QA agent may accidentally gain access to an overly broad workspace.

Mitigation:

- configure a dedicated QA workspace/preset;
- minimum permissions;
- do not automatically choose arbitrary workspaces.

---

### Risk: `read-only` is mistaken for “no side effects”

DSH's read-only sandbox covers file mutation, not all process/network effects.

Mitigation:

- deny generic shell/terminal/code runtime by default;
- explicit tool allow-list;
- tool-by-tool MCP review;
- `approval=never`;
- optional network egress restrictions at container/proxy level.

### Risk: QA user can reach normal DSH Web

If `/` and `/qa` share the same privileged identity, the user may bypass UI lockdown by opening the normal operator surface.

Mitigation:

- do not claim `/qa` alone is an authorization boundary;
- for untrusted users use separate auth roles/gateway or a dedicated QA DSH instance;
- preferably expose only the QA surface to the QA audience.

### Risk: global plugin installation expands tool surface

Mitigation:

- allow-list inherited tools;
- inspect preset-local registrations separately;
- CI capability inventory;
- fail closed on unknown tools where practical.

### Risk: read access is broader than intended

DSH sandbox mode alone does not imply workspace-only read isolation.

Mitigation:

- no generic shell/fs browsing in the default QA preset;
- dedicated read-only corpus/workspace;
- minimal container mounts;
- dedicated QA container for high-assurance deployments.
- for writable per-user mode, canonicalize every model-controlled file path
  and deny process/LSP/ancestor-git escape hatches in addition to
  `workspace-write`.

---

## 43. Future evolution

Potential roadmap:

```text
0.1  full-screen /qa overlay + one DSH session + hard lockdown
0.2  settings + branding + suggested questions + capability inventory
0.3  read-only sources/citations + optional supported questions UI
0.4  attachments + feedback (without capability escalation)
0.5  iframe/embed SDK + auth-role integration
1.0  dedicated qa profile/bundle / isolated QA deployment option
```

Long term the project can become a reusable **DSH-powered assistant frontend** rather than merely an alternative theme.

Possible future modes:

```text
/qa
/qa/<assistant-id>
/embed/qa/<assistant-id>
```

Each assistant id could map to a configured DSH agent preset, while the underlying runtime remains shared.

---

## 44. Research references

Current architecture was checked against upstream DeepSeek Harness sources/docs on 2026-09-05.

Key references:

- DeepSeek Harness repository / developer-preview status  
  https://github.com/deepseek-ai/deepseek-harness

- Web app bundle composition (`dsh-base` + browser roster)  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/cordis.patch.yml

- Web app bundle README  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md

- Client modules / `dsh.client` / `window.__DSH_BOOT__`  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md

- Host webserver route/fallback model  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/webserver/README.md

- SPA frontend-static fallback  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/frontend-static/README.md

- Client runtime / Host-born sessions  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/runtime/README.md

- Session Controller  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.md

- Sandbox policy / `read-only` semantics  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-policy/README.md

- Approval policy / `never` fail-closed behavior  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md

- Permission presets (`sandbox` + `approval`)  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md

- Tool restrictions / allow-list semantics  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md

- Agent preset session semantics  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-agent-preset/README.md

- DSH safety limitations  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md

- Current read-isolation limitation discussion  
  https://github.com/deepseek-ai/deepseek-harness/discussions/492


- Web client slots  
  https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots

- Conversation slot contract / `conversation.session`  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/contract/slots.ts

- UI layout shell / `shell.overlay`  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-layout/README.md

- Web client package rules / new UI plugin checklist  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md

- Settings-card cookbook / external dual-face plugin pattern  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md

### Upstream limitation worth tracking

At the time of writing there is no generic first-class global-page extension contract in the normal DSH shell; community discussion exists around this missing surface. The plugin should therefore keep its QA UI mount mechanism replaceable so it can migrate from `shell.overlay` if DSH later adds a proper global-page/work-area API.

---

## 45. Final architecture summary

```text
                         ┌──────────────────────────────┐
                         │      DeepSeek Harness        │
                         │                              │
                         │ Agent / Session / Tools      │
                         │ Skills / MCP / Models        │
                         │ Memory / Persistence / OTel  │
                         └──────────────┬───────────────┘
                                        │
                                  Session Controller
                                        │
                                  API / connection
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
          Normal DSH Web                                  /qa route
                 │                                             │
       standard AppFrame                           dsh-qa-surface client
                 │                                             │
      sidebar/conversation                          shell.overlay (full)
      settings/tools/etc.                                    │
                                                   QaSessionController
                                                             │
                                                   QaTranscriptAdapter
                                                             │
                                                        QA React UI
                                                             │
                                                    textarea / Send
```

The core architectural principles are:

> **Replace the presentation, not the harness.**

> **Remove capabilities at the runtime/tool-policy layer; hiding buttons is only defense in depth.**

`dsh-qa-surface` should be a thin QA/browser surface over the existing DSH runtime, with `/qa` acting as a dedicated end-user presentation while `/` remains the full operator/developer interface. In locked-down deployments, QA sessions must be bound to a fixed composition and a fail-closed read-only capability set.
