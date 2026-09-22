# SPEC — `@yadsh/dsh-openviking-memory`

Product contract for the OpenViking memory integration. Behaviour, not
implementation.

The original fork specification — the upstream import plan, the port strategy and
the phased roadmap this package was built from — is archived at
[docs/specs/fork.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/docs/specs/fork.md).
Where the two disagree, this file and the repository guidelines win.

## 1. Product contract

Numbered, checkable guarantees:

1. **One installable bundle.** Installing the package into a DSH profile adds one
   host plugin row (`dsh-openviking-memory`) that connects to one OpenViking
   server. No other package has to be installed for tools or skills to work.
2. **Five independent capabilities.** Tools, skills, capture/commit, the
   `viking://` guard and automatic context presentation can each be reasoned
   about — and the first four enabled — without the fifth.
3. **`autoInject: false` presents nothing automatically.** As long as it is set,
   no startup profile block, no per-step profile block and no automatic recall
   block ever enters the conversation.
4. **`autoInject: false` also *works* nothing.** No profile request and no recall
   request is issued. The runtime is not invoked and left to discard a result.
5. **Disabling presentation disables nothing else.** With `autoInject: false`:
   conversation turns are still captured, commits still happen, `mcp__openviking__*`
   tools are still mounted, the `openviking-memory` skill is still served, the
   `viking://` guard still denies, and the model can still call OpenViking tools
   itself.
6. **The defaults are upstream-compatible.** Installing the package and setting
   nothing but an endpoint reproduces the upstream plugin's memory semantics,
   request for request.
7. **Granular knobs narrow, never widen.** `injectStartupProfile`,
   `injectStepProfile` and `autoRecall` are each ANDed with `autoInject`.
8. **`skipSubagentSessions: true` excludes a delegated session entirely.** A
   subagent's session registers no listeners, captures nothing, commits nothing
   and receives no context.
9. **Out-of-range configuration fails loudly.** A value outside a documented
   range or outside an enum stops the plugin from loading, with a validation
   error naming the field. It is never silently replaced.
10. **Credentials stay out of the conversation and out of the log.** An API key
    is sent as an authorization header and nowhere else; the plugin log records
    booleans, never secret values.
11. **The `viking://` guard is mode-independent.** It is registered in every
    configuration, including `autoInject: false` and `syncTurns: false`.
12. **A restart is not needed to recover a transient outage.** Failed writes
    queue locally and drain in-process; capture and commit resume on their own.
13. **The integration never takes the host down.** Every failure at a plugin
    boundary (health probe, session ensure, capture, commit, MCP mount, skill
    mount, drain tick) is contained: the plugin logs it and the rest of the
    session keeps working.
14. **Removing the plugin is safe.** It owns only its own state: the pending
    queue under `~/.openviking/pending` and its log directory. It never mutates
    OpenViking data on shutdown that it would not mutate on a normal commit.

## 2. Configuration model

Configuration is a Schemastery schema (`src/config.ts`) with a matching
TypeScript `Config` interface. Every field is optional and documented; every
range and enum is part of the contract, not an implementation detail.

Two mechanisms worth stating:

- **Defaults resolve to upstream values.** A key the user omits behaves exactly
  as it did upstream, including the four knobs that only send their request
  field when the user names them (`recallLimit`, `recallQueryExpansion`,
  `recallMaxTokens`, `recallCompressMaxBullets`). Those four carry no schema
  default precisely so that "the user asked for this" stays distinguishable from
  "a default filled it in".
- **Environment variables remain a fallback channel.** `OPENVIKING_*` values are
  applied after the schema and are normalized the way upstream normalized them
  (clamped), because they bypass validation by construction. Schema-validated
  config is never clamped.

### 2.1 Settings namespace and the Web GUI card

The schema registers under the settings namespace `dsh-openviking-memory` — the
Cordis plugin id. The package ships a browser client bundle that registers as
`@yadsh/dsh-openviking-memory` and mounts a card into the shared
`settings.plugin.item` slot, so the plugin appears in **Settings → Plugins**
like every first-party plugin.

Two halves have to meet for that card to be rendered, and only one of them is
the bundle: the Host serves a card only for a namespace that a *live* plugin
registered in its settings directory, so `src/settings.ts` calls
`installSection` for this namespace (a `static Config` declaration does not
register anything). The section is also the plugin's configuration source: the
service hands over a reader over the merged layers and reports every committed
change, and `reapplySettings()` re-resolves the configuration and hands it to
the running runtime. Everything the plugin decides per request follows
immediately; the bridged MCP tools are a child process with a transport fixed at
start and follow on the next reload, which is logged as
`settings_applied.connectionChanged`. A profile without a settings provider
keeps running on its composition entry.

The card is an editor over that namespace, nothing more:

- Sections mirror the contract: automatic context presentation (the four
  injection knobs), connection, peer identity, recall, capture and commit, and
  an advanced group (`skipSubagentSessions`, the two timeouts, the deprecated
  `captureMode`).
- Writes are immediate scalar `set`s; a cleared field becomes an `unset`, which
  drops the user-layer override and re-inherits the composition layer. Every
  field shows an **override** marker while the user layer carries a value, and
  a reset action clears all overrides in one mutation.
- An emptied connection field is an `unset`, not a written empty string — so a
  blank key never hides a credential arriving from `OPENVIKING_*` or the
  credential files.
- Fields the schema leaves without a default (`recallLimit`,
  `recallQueryExpansion`, `recallMaxTokens`, `recallCompressMaxBullets`) render
  their upstream fallback as a placeholder and write only when the user names a
  value, preserving the "configured" vs "defaulted" distinction of §2.
- The card is config-only: it has no Remote face, and the header badge
  projects the master switch (`Auto-inject` / `Manual recall`), not live
  runtime state.

### 2.2 Per-account scoping and the account-scoped page

One plugin instance serves every chat on a deployment, so a multi-user
deployment has to split the OpenViking space per account. Two mechanisms do it,
and both depend on QA Surface (`@yadsh/dsh-qa-surface`), which is optional:

- **Attribution.** With a QA surface mounted and `qaUserScoping` on (the
  default), every session is attributed through
  `ctx.qaSurface.principalForSession`: a chat root resolves to the account that
  attested it, a delegated child inherits the chat it descends from (recorded
  from `session/created`), and a session nobody has claimed resolves to
  *nothing*. The runtime sends `X-OpenViking-User: <account>` on every request
  the session issues, so recall, profile and capture all live in that account's
  space. A session that resolves to nothing is skipped entirely — no profile, no
  recall, no capture — which is what keeps a conversation out of a space it does
  not belong to. Without a QA surface, or with `qaUserScoping: false`, the
  deployment-wide identity of §2 is unchanged.
- **The account-scoped page.** The card of §2.1 is discovered from the Host
  settings directory, which a browser reaching the deployment over the network
  never gets, and a QA overlay does not render the native settings tree at all.
  What ships in that browser's place is a `qaUserSettingsSections` registration
  in the signed-in user's QA settings dialog: a **read-only** overview of what
  the memory holds about that account — the profile file, the sections under
  `memories/` with their entries, and the conversations the store has under
  `sessions/` — backed by one `@Remote` method of the `openvikingMemory`
  namespace (`userMemoryOverview`). Callers are resolved from a bearer token
  (`principalForToken`); no method accepts an account id, and no method writes.
  The reading client is the account's own (`MemoryOverviewSource`), so the page
  reads the space that account's chats read; with scoping off it is the
  deployment's client, because a shared space is what its chats use.
- **The page reports the space it is actually showing.** The account is
  asserted with `X-OpenViking-User`, and a store is free to ignore that header:
  OpenViking's `api_key` auth mode strips it and resolves the key's own user
  instead. `userMemoryOverview` therefore compares the identity it asked for
  with the one `/api/v1/system/status` reports and answers `accountApplies:
  false` when they differ, which is what makes the page say "this is the shared
  space" rather than present someone else's memory as the reader's own.
- **Overrides are narrowed, and operator-managed.** `effectiveInjectionPlan`
  intersects the account's stored overrides with the deployment's plan, so
  `autoInject: false` silences the profile and the recall for one account, a
  granular override never widens the master one, and no account can switch on a
  path its deployment disabled. Capture, commit, the MCP tools and the skills
  are untouched by these overrides, exactly as with the deployment-level knobs
  of §2. They live in `openviking-memory-qa-users.json` under `$DSH_HOME`
  (`qaUserSettingsPath` overrides the path) and nothing in the browser writes
  that file: the switches that decide whether the assistant uses the memory at
  all belong to the deployment, configured on the card of §2.1 or in the
  profile patch.

## 3. Lifecycle

```
install → plugin row created
        → connect (client built; no request yet)
        → mount MCP bridge + skill provider
        → register listeners (agent/*, session/*, tools/pre-execute)
        → start the pending-queue drainer (one per process)

agent/session-start (not a subagent session)
        → register per-session disposal
        → [autoInject && injectStartupProfile] initialize + deliver profile

agent/pre-step (not a subagent session, decision = enter)
        → [autoInject && injectStepProfile] profile task
        → [autoInject && autoRecall]        recall task
        → append the resolved blocks to the step's messages

session/event
        → capture (turn → OpenViking session), commit on turn/end past the threshold

session/flush
        → await the session's pending writes

dispose
        → drain per-session writes, commit each live session, close the logger
```

Session-state removal is idempotent and happens once per session; a runtime
holds one entry per live session and drops it on disposal.

## 4. Data model

The plugin stores no OpenViking data of its own. Two local artefacts:

| Artefact | Location | Format | Failure policy |
| --- | --- | --- | --- |
| Pending writes | `$OPENVIKING_PENDING_DIR` (default `~/.openviking/pending`), mode `0700`, files `0600` | one JSON file per queued operation: `{ type, sessionId, payload, createdAt, retries, dedupKey }` | corrupted entries are skipped, never rewritten; exhausted or non-retryable entries are deleted |
| Plugin log | `<$DSH_HOME>/logs/dsh-openviking-memory/<date>.log` | NDJSON | best effort; logging never affects protocol or plugin behaviour |

Two memo files under the OpenViking state dir (`context-face.json`,
`peer-scope.json`) remember capability downgrades for six hours so a deployment
without the context face is not re-probed on every turn.

## 5. Scope

**Included**

- The upstream OpenViking integration: endpoint/credential resolution, workspace
  peer derivation, MCP bridge, skill provider, capture, commit, flush, offline
  queue and drainer, `viking://` guard.
- The four injection controls and their zero-work semantics.
- A typed, validated configuration schema with per-field documentation.
- A settings card in the DSH Web GUI that edits the plugin's
  `dsh-openviking-memory` settings namespace (SPEC §2.1).
- Structured file logging.
- Tests for the injection matrix, manual-only mode, capture, config, the guard,
  the runtime write paths, the proxy core and the settings card.

**Deferred**

- Upstream-sync tooling (`scripts/check-openviking-upstream.mjs`). The manual
  process is documented and sufficient until the first stable release.
- Optional live E2E against a real OpenViking server. Upstream's opt-in test is
  not ported; there is no server in CI to point it at.
- A live-browser pass of the settings card on a rig (the card is covered by
  jsdom interaction tests and packaged-bundle gates; nobody has clicked it on a
  running host yet).

**Explicitly out of scope for v1**

A bundled OpenViking server; a second memory backend; data migration between
backends; a change to OpenViking's storage format; an alternative RAG engine; a
Web UI dashboard; automatic rewriting of upstream sources; running alongside the
official plugin; any change to the MCP tool contracts.

## 6. Required end-to-end scenarios

1. **Default install.** Add the plugin with only `endpoint` set, start a session.
   → A profile read is issued during session start; a recall request is issued
   before the first step; both blocks are appended when non-empty.
2. **Manual-only.** Set `autoInject: false` and `syncTurns: true`, start a
   session, send a turn.
   → Zero profile requests, zero recall requests, zero injected messages; the
   turn is captured with `POST /api/v1/sessions/<id>/messages`; the MCP and skill
   mounts are present; the `viking://` guard still denies.
3. **Profile deferred to the step.** Set `injectStartupProfile: false`.
   → Session start issues nothing; the first pre-step performs the profile read
   and delivers the block.
4. **Recall off only.** Set `autoRecall: false`.
   → No `/api/v1/search/search` request is ever issued; the profile path is
   unchanged.
5. **Subagent.** Set `skipSubagentSessions: true` and start a session whose
   header origin is `subagent`.
   → No listener registers that session, no request mentions it, and the runtime
   tracks zero sessions for it.
6. **Server outage.** Stop OpenViking mid-session, send turns, restart it.
   → The turns queue locally; the drainer replays them once health returns
   without restarting DSH; a commit follows.
7. **Invalid configuration.** Set `scoreThreshold: 2`.
   → DSH refuses to load the plugin and reports a validation error for that
   field.
8. **Two accounts, one deployment.** With a QA surface mounted, start a chat as
   account A and one as account B.
   → Every request of each chat carries its own `X-OpenViking-User`, and no
   request carries an account that does not own its session.
9. **Unclaimed session.** Start a session the QA surface does not attribute.
   → Zero requests: no profile read, no recall search, no capture, no commit.
10. **Account page reads the account.** Open the **Память** page of account A
    while A's space holds a profile, a couple of sections and several chats.
    → The page shows A's profile text, those sections with their entries and the
    newest conversations, and it issues no request that writes; B's page, if B's
    space is empty, says the memory is empty rather than showing A's.
11. **Shared space is reported.** Run the same page against a store whose
    `api_key` mode strips `X-OpenViking-User`.
    → `accountApplies` is false, the page names the identity the store answered
    with, and it says the space is shared instead of presenting it as A's own.
12. **Refused credential.** Call the remote with no account behind the token.
    → The call is refused and no file is written.
13. **Committed settings change.** With a chat open, switch `autoRecall` off in
    the card and start a turn.
    → The next step of that session issues no recall request; the log records
    `settings_applied`. A connection change is applied to the plugin's own
    requests on the same step and logged with `connectionChanged`, while the
    bridged MCP tools keep the endpoint they were mounted with until the plugin
    reloads.

## 7. Implementation status

| Area | Status |
| --- | --- |
| Upstream behavioural port (client, runtime, capture, commit, flush, queue, drainer, MCP, skills, URI guard, peer identity, credentials) | Implemented |
| Typed Schemastery configuration with fail-loud validation | Implemented |
| Injection controls (`autoInject`, `injectStartupProfile`, `injectStepProfile`, `autoRecall`) with zero-work semantics | Implemented |
| Structured file logging | Implemented |
| Injection matrix / manual-only / capture / config / guard / runtime / queue / proxy tests | Implemented |
| Settings card in the Web GUI | Implemented (the namespace is registered by `src/settings.ts`; a card without that registration renders nowhere) |
| Live re-apply of a committed settings change | Implemented (the bridged MCP tool surface follows on reload) |
| Per-account scoping and the account-scoped QA settings page (read-only overview) | Implemented (unit + request-level tests; no live multi-account run yet) |
| Upstream-sync tooling | Deferred |
| Live OpenViking E2E | Deferred |
| Visual/browser verification of the settings card on a rig | Deferred (jsdom tests + bundle gates pass; no live click-through yet) |
