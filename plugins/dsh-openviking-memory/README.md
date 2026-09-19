# @yadsh/dsh-openviking-memory

OpenViking memory for DeepSeek Harness: durable memory tools, skills, conversation
capture and commit — with automatic profile/recall injection you can switch off
entirely.

> This package is a community-maintained derivative of OpenViking's official
> [`@openviking/dsh-memory-plugin`](https://www.npmjs.com/package/@openviking/dsh-memory-plugin).
> It is not maintained or endorsed by the OpenViking project.

Original upstream: <https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin>.
Provenance is recorded in
[UPSTREAM.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/UPSTREAM.md).

## What it is

A DSH bundle that connects one agent to an [OpenViking](https://github.com/volcengine/OpenViking)
server and keeps five capabilities independent of each other:

| Capability | What it does |
| --- | --- |
| **Tools** | Mounts DSH's MCP bridge against the OpenViking stdio proxy, publishing `mcp__openviking__*` |
| **Skills** | Serves the `openviking-memory` skill so the model knows how to search, read and write memory |
| **Capture / commit** | Mirrors conversation turns into an OpenViking session and commits it once it grows past a token threshold |
| **`viking://` guard** | Denies any filesystem or shell tool call that is handed an OpenViking URI, with a hint naming the right tool |
| **Automatic context presentation** | Injects the stored profile at session start and/or before each step, and runs semantic recall per step |

The first four are always on. The fifth is what this fork adds control over.

## Why this fork exists

Upstream always injects: every session gets the stored profile, and every step
gets a recall round-trip. That is the right default, and it stays the default
here. It is the wrong behaviour when you want the model to decide *when* memory
is worth the latency and the tokens:

> Now I need memory → call the OpenViking search/read tools.

`autoInject: false` gives exactly that. It is not "memory disabled": tools,
skills, capture, commit and the URI guard all keep working, so the agent still
learns from the conversation and can still recall on demand. Only the automatic
*context presentation* branch is switched off — and with it, every profile and
recall HTTP request (not "the request is made and the result dropped").

## Differences from upstream

- **`autoInject` plus three granular knobs** — `injectStartupProfile`,
  `injectStepProfile`, `autoRecall`. See the behaviour matrix below.
- **Zero-work when disabled.** With `autoInject: false` the plugin never calls
  into the profile or recall machinery, so no profile or recall request is
  issued at all.
- **Typed, validated configuration.** A Schemastery schema declares ranges and
  enums, and DSH refuses to load the plugin when a value is out of range instead
  of silently clamping it. Out-of-range defaults still resolve to the upstream
  behaviour.
- **A settings card in the web UI.** The plugin ships a browser bundle, so its
  configuration is editable from **Settings → Plugins** without touching a
  patch file. See [Settings card](#settings-card).
- **Repository-conventional package layout.** The upstream `.mjs` sources are
  ported to TypeScript under `src/`, with a Cordis service, a `@yadsh`
  structured log file under `<$DSH_HOME>/logs/dsh-openviking-memory/`, and the
  monorepo's build/release tooling.
- **No bundler group wrapper.** Upstream's bundle patch nested the runtime in a
  `@deepseek-ai/cordis-plugin-group` row with `isolate: { openvikingMemory: true }`.
  This fork uses the canonical single-row patch and provides the service from a
  Cordis `Service` subclass instead. See
  [docs/upstream-sync.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/docs/upstream-sync.md)
  for what that means when syncing upstream changes.
- Dropped upstream code that no DSH caller used (cross-harness session bypass
  helpers, rollout-log ingestion, the doctor surface). The complete list is in
  [SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/SPEC.md).

## Do not run both plugins at once

Remove or disable the official `@openviking/dsh-memory-plugin` before enabling
this package. Running both in one profile means duplicate capture, duplicate
recall, duplicate MCP registrations, conflicting services and duplicate skill
providers.

## Install

```bash
dsh plugin --profile <profile> add @yadsh/dsh-openviking-memory
```

`--profile` is required. From a checkout instead:

```bash
pnpm nx run @yadsh/dsh-openviking-memory:build
dsh plugin --profile <profile> add ./plugins/dsh-openviking-memory
```

## Quick start

Point the plugin at your OpenViking server and keep the upstream defaults:

```yaml
- insert:
    - id: dsh-openviking-memory
      name: "@yadsh/dsh-openviking-memory"
      config:
        endpoint: http://openviking:1933
```

Credentials are resolved in upstream's order: explicit config → `OPENVIKING_URL`
/ `OPENVIKING_API_KEY` / `OPENVIKING_ACCOUNT` / `OPENVIKING_USER` /
`OPENVIKING_PEER_ID` → `~/.openviking/ovcli.conf` → `~/.openviking/ov.conf`.

## Manual-only mode

Let the model ask for memory instead of injecting it every step:

```yaml
- insert:
    - id: dsh-openviking-memory
      name: "@yadsh/dsh-openviking-memory"
      config:
        endpoint: http://openviking:1933

        # No automatic profile or recall injection.
        autoInject: false

        # Keep learning from the conversation.
        syncTurns: true
        captureAssistantTurns: true
        captureToolResults: false
```

| | Manual-only (`autoInject: false`) |
| --- | --- |
| Automatic startup profile | off |
| Automatic per-step profile | off |
| Automatic semantic recall | off |
| Conversation capture | **on** |
| Memory commit | **on** |
| OpenViking MCP tools | **on** |
| Skills | **on** |
| `viking://` guard | **on** |
| Model-initiated recall | **on** |

Upstream-compatible mode — the default, and what you get by not writing any of
these keys:

```yaml
config:
  autoInject: true
  injectStartupProfile: true
  injectStepProfile: true
  autoRecall: true
```

## Behaviour matrix

| Configuration | Startup profile | Per-step profile | Automatic recall |
| --- | ---: | ---: | ---: |
| defaults | yes | yes | yes |
| `autoInject: false` | no | no | no |
| `injectStartupProfile: false` | no | yes | yes |
| `injectStepProfile: false` | yes | no | yes |
| `autoRecall: false` | yes | yes | no |
| all three granular `false` | no | no | no |

Each granular knob is gated by `autoInject`, so it can narrow the master switch
but never widen it. When a capability is off, the plugin issues no request on
its behalf.

## Configuration

Every key is optional; the default column is what `resolveConfig` uses when the
key is absent, and it matches upstream.

## Settings card

The package ships a browser bundle, so the plugin gets a card under
**Settings → Plugins** in the DSH web UI. It edits the plugin's
`dsh-openviking-memory` settings namespace directly — no patch file required:

- **Sections** follow the reference tables below: automatic context
  presentation, connection, peer identity, recall, capture and commit, plus an
  advanced group with `skipSubagentSessions`, the timeouts and the deprecated
  `captureMode`.
- **Writes are immediate.** Toggles and selects apply on change; text and
  number fields commit on blur or Enter. Emptying a field clears the override,
  so the value falls back to the profile's composition layer — and for the
  connection fields that means the `OPENVIKING_*` environment variables and
  credential files stay in charge.
- **Overrides are visible.** A field the profile's user layer carries is
  marked, and a reset action clears every override in one step.
- **The badge is configuration, not status.** It shows `Auto-inject` or
  `Manual recall` from the master switch. Runtime diagnostics live in the
  plugin log under `<$DSH_HOME>/logs/dsh-openviking-memory/`.

### Injection

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `autoInject` | boolean | `true` | Master switch for automatic context presentation |
| `injectStartupProfile` | boolean | `true` | Inject the stored profile once at session start |
| `injectStepProfile` | boolean | `true` | Inject the profile before a step while undelivered |
| `autoRecall` | boolean | `true` | Run automatic semantic recall before each step |

### Connection

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | string | (from credentials, else `http://127.0.0.1:1933`) | OpenViking base URL |
| `apiKey` | string | `""` | Bearer token |
| `account` | string | `""` | `X-OpenViking-Account` header |
| `user` | string | `""` | `X-OpenViking-User` header |
| `peerId` | string | `""` | Explicit actor peer id; skips workspace derivation |
| `workspacePeer` | boolean | `true` | Derive a peer id from the workspace |
| `peerSource` | string | `"git"` chain | Peer preset (`git`, `cwd`, `none`) or a template such as `team-{dir}` |

### Recall and profile

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `recallPeerScope` | `"all"` \| `"actor"` | `"all"` | Search every peer of the user, or only the caller's |
| `recallQueryExpansion` | `"auto"` \| `"off"` | `"auto"` | Server-side query expansion (sent only when you name it) |
| `recallTokenBudget` | integer 200–50000 | `2000` | Token budget for one recall block |
| `recallMaxContentChars` | integer 100–5000 | `500` | Per-entry character cap |
| `recallPreferAbstract` | boolean | `true` | Use the stored abstract instead of reading the body |
| `recallLimit` | integer 1–50 | `10` | Maximum entries per step (naming it switches the server to the client's quota table) |
| `scoreThreshold` | number 0–1 | `0.35` | Minimum relevance score |
| `minQueryLength` | integer 1–64 | `3` | Shortest prompt that triggers a recall |
| `profileTokenBudget` | integer 500–50000 | `10000` | Token budget for the profile block |
| `recallRewrite` | `"off"` \| `"auto"` \| `"client"` \| `"server"` | `"off"` | Who builds the digest |
| `recallDedupTurns` | integer 0–1000 | `5` | Turns the server de-duplicates against (`0` disables) |
| `recallContextTimeoutMs` | integer 0–600000 | `0` | Hard deadline for one context request (`0` derives it) |
| `recallMaxTokens` | integer 64–1000000 | `1600` | Token ceiling for a server-assembled block |
| `recallCompressMaxBullets` | integer 1–50 | `6` | Bullet cap when a digest is produced |

### Capture and commit

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `syncTurns` | boolean | `true` | Capture conversation turns into the OpenViking session |
| `captureToolResults` | boolean | `false` | Capture tool results as well |
| `captureMode` | `"semantic"` \| `"keyword"` | `"semantic"` | Accepted for compatibility; not consumed by this plugin |
| `captureMaxLength` | integer 200–100000 | `24000` | Character cap per captured turn |
| `captureToolMaxChars` | integer 200–1000000 | `1000000` | Character cap per captured tool payload |
| `captureAssistantTurns` | boolean | `true` | Capture assistant turns as well as user turns |
| `captureFilters` | string[] | `[]` | Sed-style filters: `s/pat/rep/`, `d\|pat\|` (drop), `k\|pat\|` (keep only), optionally prefixed `user:` / `assistant:` |
| `skipSubagentSessions` | boolean | `false` | Leave delegated subagent sessions entirely alone |
| `commitTokenThreshold` | integer 1000–1000000 | `20000` | Commit once the session's pending tokens reach this |
| `commitKeepRecentCount` | integer 0–1000 | `10` | Recent turns a commit keeps unsummarized |

### Transport

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `requestTimeoutMs` | integer 1000–120000 | `10000` | Timeout for one OpenViking request |
| `mcpToolCallTimeoutMs` | integer 1000–600000 | `60000` | Timeout for one bridged MCP tool call |

Out-of-range or unknown enum values are rejected by DSH with a validation error
rather than silently coerced. Values supplied through `OPENVIKING_*` environment
variables keep upstream's clamping behaviour, because they bypass the schema.

## OpenViking setup

The plugin talks to a running OpenViking server over HTTP and starts the
bundled stdio MCP proxy as a child process (`process.execPath`, so it works
inside DSH Desktop where Electron is the executable). Nothing else needs
installing: the MCP bridge itself ships with DSH.

Where memories are filed is OpenViking's decision, not this plugin's. A git
repository derives its peer from `origin`, so every clone and worktree of one
repository shares one memory; a directory that is neither a repository nor
marked gets no peer of its own. Upstream's `~/.openviking/ovcli.conf` is the
usual place to pin `actor_peer_id` if you want a fixed identity.

## Security and privacy

- **Credentials never enter agent messages or the log file.** API keys and
  bearer tokens are only ever sent as request headers; the plugin log records
  booleans (`hasApiKey`) and never the values.
- **Capture is a write path, not a read grant.** `syncTurns` and its companions
  control what this plugin sends to *your* OpenViking; they never widen what a
  tool call may do.
- **`viking://` is still guarded.** The guard is registered in every mode,
  including `autoInject: false`, and denies filesystem or shell calls handed an
  OpenViking URI.
- **`viking_forget` and the other destructive tools are unchanged.** This fork
  does not add, weaken or auto-approve any tool contract.
- **`autoInject: false` is not "memory disabled"** — it turns off automatic
  context presentation only. Treat a profile you no longer want injected as
  something to remove in OpenViking, not something this knob hides.
- The offline pending queue writes raw conversation payloads to
  `~/.openviking/pending` with `0700`/`0600` permissions; point
  `OPENVIKING_PENDING_DIR` elsewhere if that location does not suit your threat
  model.

## Upstream & attribution

This package is derived from OpenViking's `@openviking/dsh-memory-plugin`
(Apache License 2.0), imported from a pinned upstream commit:

- Project: [OpenViking](https://github.com/volcengine/OpenViking)
- Original package: `@openviking/dsh-memory-plugin` (path `examples/dsh-memory-plugin`)
- Original authors: OpenViking / Volcengine contributors
- Upstream revision: `688f78e923d2269d96c27096fe2dad10156ebdb8` (version `0.3.2`)
- License: Apache License 2.0 — see [LICENSE](./LICENSE)
- Full provenance and the list of local modifications:
  [UPSTREAM.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/UPSTREAM.md)
- Upstream sync process:
  [docs/upstream-sync.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/docs/upstream-sync.md)

Files ported from upstream keep an attribution header naming the original
project, and no upstream copyright or attribution notice was removed.

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`

See `compatibility.json` in the installed package for the machine-readable form.

## Development

```bash
pnpm nx run @yadsh/dsh-openviking-memory:build
pnpm nx run @yadsh/dsh-openviking-memory:lint
pnpm nx run @yadsh/dsh-openviking-memory:typecheck
pnpm nx run @yadsh/dsh-openviking-memory:test
pnpm nx run @yadsh/dsh-openviking-memory:verify
```

The product contract lives in
[SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/SPEC.md).

## License

Apache License 2.0, inherited from the upstream package this fork is derived
from. See [LICENSE](./LICENSE).
