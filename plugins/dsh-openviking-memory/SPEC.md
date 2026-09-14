# SPEC — `@yadsh/dsh-openviking-memory`

Product contract for the OpenViking memory integration. Behaviour, not
implementation.

The original fork specification — the upstream import plan, the port strategy and
the phased roadmap this package was built from — is archived at
[docs/SPEC-dsh-openviking-memory-fork.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-openviking-memory/docs/SPEC-dsh-openviking-memory-fork.md).
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
- Structured file logging.
- Tests for the injection matrix, manual-only mode, capture, config, the guard,
  the runtime write paths and the proxy core.

**Deferred**

- A settings card in the DSH Web GUI. The typed config is the v1 contract; a
  card would need a separate client bundle and is not a release blocker.
- Upstream-sync tooling (`scripts/check-openviking-upstream.mjs`). The manual
  process is documented and sufficient until the first stable release.
- Optional live E2E against a real OpenViking server. Upstream's opt-in test is
  not ported; there is no server in CI to point it at.

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

## 7. Implementation status

| Area | Status |
| --- | --- |
| Upstream behavioural port (client, runtime, capture, commit, flush, queue, drainer, MCP, skills, URI guard, peer identity, credentials) | Implemented |
| Typed Schemastery configuration with fail-loud validation | Implemented |
| Injection controls (`autoInject`, `injectStartupProfile`, `injectStepProfile`, `autoRecall`) with zero-work semantics | Implemented |
| Structured file logging | Implemented |
| Injection matrix / manual-only / capture / config / guard / runtime / queue / proxy tests | Implemented |
| Settings card in the Web GUI | Deferred |
| Upstream-sync tooling | Deferred |
| Live OpenViking E2E | Deferred |
| Visual/browser verification of the Web GUI | Not applicable (host-only plugin, no client bundle) |
