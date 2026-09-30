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

The settings namespace is `dsh-openviking-memory` — the Cordis plugin id, which on
0.1.7 is also the profile entry the Host serves this plugin's configuration
under. The package ships a browser client bundle that registers as
`@yadsh/dsh-openviking-memory` and mounts the card as the configuration of its own
row on the **Plugins** page — the keyed `plugins.row.config` seat
`@yadsh/dsh-openviking-memory#dsh-openviking-memory`, the package name joined to
the row id `cordis.patch.yml` declares. The card keeps the canonical
`dsh-plugin-card` shell, and because that seat hands a registrant an empty column,
the card owns the `<ul>` its `<li>` root sits in. The page seats the same entry
twice, and both sites are measured in the shipped `0.1.7-rc.2` client
bundle rather than asserted: `RowDetail` fills the row's description line with
`description ?? renderSlot("plugins.row.config", { view: "summary" }, …)`
(`lib/client.js:1841`) and renders the entry again as the configuration body,
`{ view: "page", form }` (`:1852`); that `description` is `row.meta?.description`
alone (`rowText`, `:211-215`), which this bundle's patch declares no key for, so
the row's line is genuinely this entry's `summary` answer. Seating a self-shelled
card on that page is what costs it a title and a description line of its own drawn
directly above the header repeating both — §7 names that cost, and decision D1 of
the cutover rules on it. The seat moved and the
namespace did not, so a value saved before the move is read back after it.

Since the 0.1.7 settings rewrite nothing registers a namespace: a field is a
settings-form field exactly when its schema node is `.volatile()`, every knob of
`static Config` carries it, and the namespace is the profile entry. The card
reaches that namespace through `ctx.configForms.get(namespace)`, and the same
references are the plugin's configuration source — the Host keeps them current
as the document changes. It does not take the `form` the row seat hands its
registrant: that is the Host's page view, `{ state, mutate }` only, which can
neither be subscribed to nor written field by field, so the resolved `ConfigForm`
arrives through the injected face under the name `settingsForm`. Because a volatile
namespace would otherwise also get a generated form page, the plugin registers
`configure({ auto: false })` on its entry: the card is the one editor of that
document.
`refreshConfig()` re-reads the references at the start of an
operation, and when a value actually moved `reapplySettings()` re-resolves the
configuration and hands it to the running runtime. Everything the plugin decides
per request follows immediately; the bridged MCP tools are a child process with a
transport fixed at start and follow on the next reload, which is logged as
`settings_applied.connectionChanged`.

The card is an editor over that namespace, nothing more:

- Sections mirror the contract: automatic context presentation (the four
  injection knobs), connection, peer identity, recall, capture and commit,
  multi-user memory (`qaUserScoping`, §2.2), and an advanced group
  (`skipSubagentSessions`, the two timeouts, the deprecated `captureMode`).
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
  not belong to. Without a QA surface, or with `qaUserScoping` off, the
  deployment-wide identity of §2 is unchanged. The switch is the card's
  (`qaUserScoping`, §2.1) and a committed change follows the live re-apply of
  §2.1, so it takes effect for sessions that are already open.
  Attribution is asked for, never received: a chat is claimed when its browser
  half opens it, which trails the moment the session starts. So the plugin logs
  `qa_memory_unattributed` the first time it asks about a session nobody has
  claimed, and `qa_memory_attributed` — with the delay it took — when that same
  session resolves later. The pair is what separates a chat that merely started
  early from one no account is ever going to claim, and only the second case
  keeps a deployment's memory permanently out of every account space.
  not belong to. Without a QA surface, or with `qaUserScoping: false`, the
  deployment-wide identity of §2 is unchanged. Which `viking://user/<space>` the
  profile is read from is remembered per identity — endpoint, account and user —
  and never process-wide: the header alone does not redirect a path that was
  resolved for somebody else, and a re-pointed endpoint is asked again.
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
- **The scope is per request path, and the boundary is named.** The account
  travels as one header on a per-account client, so separation is only real
  where the plugin itself speaks for a session: profile reads, recall searches,
  capture, commit, the replay of a queued turn (which refuses to send a turn
  whose owner has not come back) and the account page's reader are all scoped,
  and a test keeps two accounts' requests apart. The bridged
  `mcp__openviking__*` tools and the skill prompts that name them are not: they
  run in one stdio child mounted for the whole process, whose identity is fixed
  in its environment (`OPENVIKING_USER`) before any session exists. A
  model-initiated `remember`, `search` or `read` therefore works on the
  deployment space, not the account's — so a fact the model stored through a
  tool is shared by every account even on a scoped deployment, and the card's
  multi-user section says so. Closing the gap needs a per-session identity in
  DSH's MCP client or native tool implementations in this plugin; neither is a
  change of header.
- **What was written before scoping stays where it was.** The space is chosen by
  the header, so memory filed under the deployment identity — `OPENVIKING_USER`,
  or the store's own user when that is empty — appears in no account's space
  after the switch is turned on. The migration path is:
  1. read the identity the store answers with (`userMemoryOverview` →
     `serverIdentity`, which the account page shows). With scoping off this is
     the deployment space everything shares; with it on it is the account's.
  2. confirm the store honours the header before moving anything: a store whose
     `api_key` mode strips it answers `accountApplies: false`, and every write
     lands in its single space whatever this plugin sends, so re-filing would
     relocate nothing.
  3. list what the shared space holds — the deployment's own page reads it, and
     the bridged tools see it as their caller — then re-file what matters into
     the owning account's space. This plugin exposes no move operation and the
     QA page is read-only by design, so re-filing is an operator's act against
     the memory API, not a button.
  4. leave the remainder in place. Turning `qaUserScoping` off again returns
     every chat to the deployment space, which makes the old memory reachable
     as it was without merging two accounts' histories together.

## 3. Lifecycle

```
install → plugin row created
        → connect (client built; no request yet)
        → mount MCP bridge + skill provider
        → register listeners (agent/*, session/*, tools/pre-execute)
        → start the pending-queue drainer (one per process)

agent/created (not a subagent session)
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
| Pending writes | `$OPENVIKING_PENDING_DIR` (default `~/.openviking/pending`), mode `0700`, files `0600` | one JSON file per queued operation: `{ type, sessionId, payload, createdAt, retries, dedupKey, user }` | `user` is the identity the replay sends as, so a backlog survives a restart whose sessions are not back; an entry older than that field is replayed only to a session this process has attributed, or to a deployment that has never spoken as an account; corrupted entries are skipped, never rewritten; exhausted or non-retryable entries are deleted |
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
   without restarting DSH, each write to the space it was queued in; a commit
   follows.
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
14. **Master switch pulled live.** With a chat open and injecting, set
    `autoInject: false` in the card's automatic-context section and start another
    turn of that same session.
    → `injection` is all-false and the step issues neither a profile read nor a
    recall search; the turn is still captured under
    `/api/v1/sessions/<id>/messages`, because the switch governs automatic
    context and not the memory itself.
15. **Chat claimed late.** Start a session the QA surface does not yet
    attribute, let a turn pass, then have its account claim it.
    → The first turn issues nothing and logs `qa_memory_unattributed`; after the
    claim (past the window an unresolved answer is trusted for) the session's
    requests carry that account's `X-OpenViking-User` and the log records
    `qa_memory_attributed` with the delay.
16. **A model-initiated write on a scoped deployment.** With a QA surface and
    scoping on, have the model store a fact through `mcp__openviking__remember`.
    → The bridge was mounted with the deployment identity, so the write is
    filed in the deployment space and no account's page claims it as its own;
    the plugin's own requests for that session keep using the account space.
17. **Card on the operator face.** On the machine that serves the deployment,
    open its loopback URL — with the QA kiosk overlay off, that port serves the
    native UI — and open **Plugins → this plugin's row**.
    → The OpenViking Memory card renders as that row's configuration, including its
    multi-user section. The seat is the keyed `plugins.row.config` entry of §2.1,
    not a tab of *Settings → Plugins*.
    **What a browser over the network gets:** the sentence this item used to carry —
    "A browser reaching the same deployment over the network gets no card at all:
    the Host serves its settings directory to a loopback page only" — was never
    about this card. The loopback-only rule is the settings *directory*, the surface
    that discovers `settings.plugin.item` cards (`AGENTS.md`); this card sat on
    `settings.plugins.tab`, the slot `AGENTS.md` keeps precisely because a
    non-loopback browser must still reach it. The rule does not follow the card to
    its new seat either: nothing in the Plugins page's shipped `0.1.7-rc.2` client
    half consults the loopback fact at all (`@deepseek-ai/dsh-client-ui-plugin-manager`
    `lib/`: zero matches), and the form provider mounts the same mirror for every
    face, choosing only persistence (`@deepseek-ai/dsh-client-ui-settings`
    `lib/client.js:1509` — `isLoopback ? 'host' : 'memory'`). So a network browser
    that reaches the row gets a card that renders and writes, into a process-local
    copy that never touches the Host's file. **[unverified]** whether the deployed
    Host serves that page's inventory Remotes (`pluginManager` / `pluginInventory`,
    read at `client.js:646,781`) to a non-loopback connection — no client bundle
    answers it, so the browser pass owes two statements, not one: the card on the
    loopback face, and what the network face shows. Either way the operator
    configures on the machine that serves the installation, which is why the
    switches are the operator's and the account face stays read-only (§2.2).
    Recording the card as "missing on a stand" is therefore a statement about which
    face was opened, not about the registration: the registration is what §2.1
    covers, and it is asserted by a test.

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
| Per-account scoping and the account-scoped QA settings page (read-only overview) | Implemented (unit + request-level tests; the `mcp__openviking__*` bridge keeps the deployment space by design, §2.2; no live multi-account run yet) |
| Upstream-sync tooling | Deferred |
| Live OpenViking E2E | Deferred |
| Visual/browser verification of the settings card on a rig | Deferred (jsdom tests + bundle gates pass; no live click-through yet). What that pass will see is named from the page's source rather than guessed: the row page draws its own title (`<h3 className={css.detailTitle}>`, `@deepseek-ai/dsh-client-ui-plugin-manager` `lib/client.js:1828`) and its own description line (`:1841`, the seat §2.1 cites) immediately above a card that keeps the AGENTS.md shell, whose header repeats that title and — from the same constant — that sentence. That repetition is what seating a self-shelled card on a page that draws its own chrome costs, and it is the live pass that decides whether it reads as a defect. §4.3a's two remaining items come with it: our 12px/1px shell against the host card's `--dsw-radius-xl` 20px and `0.5px` settings stroke, and `focus.css`'s `html[data-input-modality='pointer'] body :focus-visible:not(:read-write)` at 0-3-2, able to paint our 0-2-0 ring transparent after a mouse click. Removing the outer shell is D1 option 1 — it rewrites `AGENTS.md`'s card rules and `packages/plugin-scripts/verify-plugin-card-contract.mjs` for every card of the wave at once, so it is #646's call, not this card's to pre-empt by diverging one package. |
