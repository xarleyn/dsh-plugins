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
the row id `cordis.patch.yml` declares. The card renders the body and nothing around
it: the page draws the row's card — its surface, its heading, the `<code>` lines of
the row id and the module specifier, and the expand control — before this entry is
mounted, so a shell of ours would be a second frame inside the first. That is the
owner's decision of 01.10 in #646, landed as the contract in #684; the plugin-owned
`dsh-plugin-card` shell with its chevron and open state stays only for
`settings.section` and `settings.plugins.tab`.

The page seats the same entry twice. The shipped contract of `plugins.row.config`
says so in prose — "An absent description falls back to the entry's
`view: 'summary'`" (`lib/types/client/slot-contract.d.ts:105-116` of
`@deepseek-ai/dsh-client-ui-plugin-manager` `0.1.7-rc.2`) — and `RowDetail` is the
page that does it: the row's description line is `description ??
renderSlot('plugins.row.config', { view: 'summary' }, { entryKey: key })`
(`lib/client.js:1841`), while the configuration body renders the same entry with
`{ view: 'page', form }` (`:1852`). §7.1 carries the commands that print both sites
from the package this plugin installs. `AGENTS.md` states the rule the entry obeys:
answer the summary with the sentence and mount the card only for `page`, because the
fallback lands inside the page's own `<p>` — a card there would draw a page within a
line of text.

Whether the page asks *this* row for the line is the Host's inventory, and this
checkout cannot read it. `description` comes from `rowText`, which folds in
`row.meta?.description` and nothing else (`lib/client.js:211-215`), and the reader
that fills `row.meta` lives in `@deepseek-ai/dsh-package-manifest` — a package none
of this repository's plugins installs. What this bundle controls is the patch: it
declares its row as `id` + `name`, no description, and `tests/bundle.test.ts` holds
it there, so closing this branch would take a row description, and that is the edit
the test turns red on. The live pass §7 names is what sees the line rendered. What
*this* checkout can prove is the other half — that the answer ships — and
`scripts/verify-package.mjs` holds it: the built bundle has to carry both the
`view === "summary"` branch and the sentence it returns.

With the shell gone, the page prints each of its lines once. The description sentence
comes from this entry's `summary` answer and appears nowhere else — the card has no
header of its own to repeat it in — and the heading is `rowText`'s title, which falls
back to the row's module specifier `@yadsh/dsh-openviking-memory` where the inventory
hands no `title` (`lib/client.js:1826-1828`, `:213`), followed by the two `<code>`
lines of the row id and the module specifier (`:1831-1838`). What the row title reads
as on a live stand — the module specifier rather than the plugin's own wording — is
the page's inventory, not this bundle's, and §7 states what the browser pass owes.
The seat moved and the namespace did not, so a value saved before the move is read
back after it.

Since the 0.1.7 settings rewrite nothing registers a namespace: a field is a
settings-form field exactly when its schema node is `.volatile()`, every knob of
`static Config` carries it, and the namespace is the profile entry. The card
reaches that namespace through `ctx.configForms.get(namespace)`, and the same
references are the plugin's configuration source — the Host keeps them current
as the document changes. The row seat hands its registrant a `form` of its own: the
`ConfigPageForm` of `{ state, mutate }` (`lib/types/client/slot-contract.d.ts:150-155`),
which the page builds by resolving `configForms.get(rowId)` down to those two
members (`lib/client.js:2690` over the same service at `:538`) and spreads over the
injected face. So the full `ConfigForm` enters under another name — `settingsForm` —
because that is the half the page's prop cannot carry: a subscription the card can
follow, where `state` is one snapshot refreshed when the page owner renders. Writes
are the other half, and the card does take the seat's form for them: the page's
`mutate` is this very form's `mutate`, and `set`/`unset` are one-op `mutate`s
(`@deepseek-ai/dsh-client-ui-settings` `lib/client.js:1152-1170`), so a field change
goes through `form.mutate([{ op: 'set' | 'unset', … }])` when the seat supplies a
form and through the face's form when it supplies none — `form` is `undefined` on a
Host that serves no page form for the row. Because a volatile
namespace would otherwise also get a generated form page, the plugin registers
`configure({ auto: false })` on its entry (`src/index.ts:339`): the card is the one
editor of that document.
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
- Writes are immediate and one field at a time — one `set` op, or one `unset` op for
  a cleared field, which drops the user-layer override and re-inherits the
  composition layer — handed to the seat's `form.mutate` wherever the page hands a
  form. Every
  field shows an **override** marker while the user layer carries a value, and
  a reset action clears all overrides in one mutation.
- An emptied connection field is an `unset`, not a written empty string — so a
  blank key never hides a credential arriving from `OPENVIKING_*` or the
  credential files.
- Fields the schema leaves without a default (`recallLimit`,
  `recallQueryExpansion`, `recallMaxTokens`, `recallCompressMaxBullets`) render
  their upstream fallback as a placeholder and write only when the user names a
  value, preserving the "configured" vs "defaulted" distinction of §2.
- The card is config-only: it has no Remote face and projects no runtime state.
  The master switch reads from its own toggle in the first section rather than
  from a header badge, because the row's header is the page's to draw.

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
    **What a browser over the network gets:** nothing to click, and for a reason the
    move did not change. One sentence of the Host's published contract decides it:
    `ConfigFormSnapshot.status` is `unavailable` when "the namespace is not exposed
    to this client or the connection keeps preferences process-local (memory mode)",
    and `writable` is false because "memory mode never" accepts writes
    (`@deepseek-ai/dsh-client-ui-settings` `0.1.7-rc.2`,
    `lib/types/client/config-form-types.d.ts:7-12` and `:28-31`). The provider picks
    the mode from the face — `isLoopback ? 'host' : 'memory'` (`lib/client.js:1509`)
    — and a `memory` controller opens at `unavailable`, never subscribes to the
    describe mirror, and turns every queued write into a refusal at the door
    (`:1118`, `:1126`, `:1213`). This card answers that state with one sentence
    instead of a form (`src/client/card.tsx:189-197`, `openviking-card-unavailable`),
    so on that face the row's configuration section is that line of explanation
    while the page's description line above it still
    prints — whether that line comes from the row's metadata or from this entry's
    `summary` answer, which needs no form. It behaved the same way on the tab
    this card left, because the provider is shared: `docs/DSH-0.1.7-MIGRATION.md`
    records memory mode as byte-identical across `rc.1..rc.2`, the Host's own reason
    being that "a non-loopback browser already got read-only settings at 0.1.5".
    `AGENTS.md` has since been rewritten (#660) to seat configuration cards on the
    Plugins panel and to tell a card seated there to disable its write controls off
    `state.writable` instead of hiding itself — which this card cannot do on that
    face, because memory mode is reported as `unavailable` rather than as
    `ready`-and-not-writable. "Render no card" is what the rulebook answers with for
    a card that owns its shell; a card seated inside the page's frame that returns
    nothing leaves an opened row with no section and no reason, so this one owes a
    sentence — the same choice the pilot row card of #646 and #653 makes. So
    the earlier sentence of this item — "a browser reaching the same deployment over
    the network gets no card at all: the Host serves its settings directory to a
    loopback page only" — named the mechanism wrongly, and the visible half of its
    conclusion has now changed with the shell: what that face shows is the row's own
    section saying there is nothing to read or write yet, not an empty column. What stays **[unverified]** is one layer
    further out: whether the deployed Host serves the Plugins page's inventory
    Remotes (`pluginManager` / `pluginInventory`, read at `client.js:646,781`) to a
    non-loopback connection at all — no client bundle answers it, so the browser pass
    owes two statements, not one: the card on the loopback face, and what the network
    face shows. Either way the operator configures on the machine that serves the
    installation, which is why the switches are the operator's and the account face
    stays read-only (§2.2). Recording the card as "missing on a stand" is therefore a
    statement about which face was opened, not about the registration: the
    registration is what §2.1 covers, and it is asserted by a test.

## 7. Implementation status

| Area | Status |
| --- | --- |
| Upstream behavioural port (client, runtime, capture, commit, flush, queue, drainer, MCP, skills, URI guard, peer identity, credentials) | Implemented |
| Typed Schemastery configuration with fail-loud validation | Implemented |
| Injection controls (`autoInject`, `injectStartupProfile`, `injectStepProfile`, `autoRecall`) with zero-work semantics | Implemented |
| Structured file logging | Implemented |
| Injection matrix / manual-only / capture / config / guard / runtime / queue / proxy tests | Implemented |
| Settings card in the Web GUI | Implemented (it is the configuration of this bundle's own row on the Plugins page, §2.1). Nothing registers a namespace since 0.1.7: the Host serves `dsh-openviking-memory` because every node of `static Config` is `.volatile()` (`src/config.ts`), and the entry declines the page the Host would generate for it with `settings.configure({ auto: false })` (`src/index.ts:339`), so the card is the one editor. On a face where the client is not served the namespace, the row's section says so in one sentence instead of drawing controls (§6.17). |
| Live re-apply of a committed settings change | Implemented (the bridged MCP tool surface follows on reload) |
| Per-account scoping and the account-scoped QA settings page (read-only overview) | Implemented (unit + request-level tests; the `mcp__openviking__*` bridge keeps the deployment space by design, §2.2; no live multi-account run yet) |
| Upstream-sync tooling | Deferred |
| Live OpenViking E2E | Deferred |
| Visual/browser verification of the settings card on a rig | Deferred for the render half — the jsdom tests and the bundle gates pass, and no live click-through has happened yet. The stored-value half of the acceptance needs no browser and the diff settles it: the branch touches no host-side source and nothing under `src/shared/`, so the namespace an older build wrote under (`OPENVIKING_MEMORY_SETTINGS_NAMESPACE`, still `dsh-openviking-memory`) and the schema read back through it are the same ones, and only the render site moved. The browser pass did not run because the only rig reachable on this machine installs the released `0.4.0` bundle, which still registers the tab this card left; seating this build there is a spec-line swap plus a restart of a stand this lane did not bring up, and `qa-stand-run` §1 hands that step to the rig's owner rather than taking it. What that pass will see is named from the shipped page, not guessed, and §7.1 gives the commands that print it: above the card, an `<h3>` carrying `rowText`'s title (`lib/client.js:1826-1828`, with `:211-216` — `row.meta?.title ?? row.moduleName`, and this patch declares no `title`), so the heading is the module specifier `@yadsh/dsh-openviking-memory`, which is what the row is named by when the inventory hands nothing of its own and the bundle prints no title at all; then the `<p><code>` lines of the row id and the module specifier (`:1831-1838`, the first skipped only when the title already *is* the row id); then the description line (`:1839-1842`), which the page fills from the row's metadata and, where the inventory hands none, from this entry's `summary` answer — the only place this bundle's sentence is printed now, since the card draws no header of its own, and `tests/bundle.test.ts` is the guard that says when the row would gain a description of its own. Below that chrome the bundle mounts its body with no frame of ours: the page's surface (its `--dsw-radius-xl` 20px and `0.5px` settings stroke) is the card, our 12px shell, its chevron and its badge are gone, and the ring on each control this package draws comes from the Host's `--dsw-focus-ring-*` tokens rather than the hard-coded outline that `focus.css`'s `html[data-input-modality='pointer'] body :focus-visible:not(:read-write)` (0-3-2 against our 0-2-0) used to suppress. The owner settled that on 01.10 in #646 and it landed as the contract in #684; this package now obeys it. What the live pass still owes is the look of the result next to a first-party row — collapsed, expanded, and focused after a mouse click — which no jsdom test can report. |

### 7.1 Reading the seat from the installed package

Every claim §2.1 and §7 make about the host page is reproducible from the installed
package, so a reader does not have to trust a line number quoted in a plugin's own
SPEC. From this package's directory:

```sh
grep -n "renderSlot(" node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js
grep -n "summary" node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/types/client/slot-contract.d.ts
sed -n '206,216p;1794,1800p;1818,1856p' node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js
sed -n '534,540p;2686,2694p' node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js
grep -n "unavailable\|memory" node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/config-form-types.d.ts
sed -n '1108,1132p;1140,1180p;1205,1216p;1505,1512p' node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js
```

At `0.1.7-rc.2` the first command lists four configuration sites:
`plugins.item` at `:1717` and `:1773` (`{ view: "summary" }`) and `:1781`
(`page` with a `form`); `plugins.row.config` at `:1841` (`{ view: "summary" }`, the
`??` fallback) and `:1852` (`{ view: "page", form }`); and
`plugins.bundle.config` at `:1973` — `{ view: "page" }`, no `form`, which is §4.2's
trap. The second command prints the contract's own sentences, including "An absent
description falls back to the entry's `view: 'summary'`" for this slot. The third
prints `rowText`, the key join and `RowDetail`. The fourth prints how the page builds
the prop it spreads over the face: `configForm: (id) => this.ctx.configForms.get(id)`
at `:538`, narrowed at `:2688-2694` to `formFor`, which answers `undefined` when the
described namespaces do not carry the row id and otherwise hands
`{ state: form.getSnapshot(), mutate }` — the same form object this entry resolves,
seen through two members. The fifth prints the
`ConfigFormSnapshot` prose §6.17 quotes — `unavailable` for a memory-mode
connection, and `writable` false because "memory mode never" accepts writes — and
the sixth its implementation: the persistence choice from the face at `:1509`, the
controller that opens at `unavailable` and only subscribes when the mode is `host`
(`:1118`, `:1126`), `enqueue` refusing every write in `memory` mode (`:1213`), and
`set`/`unset` at `:1152-1170` — each one a `mutate` of a single op, which is why the
card can hand the page's `mutate` a field change and keep the fence, the ordering and
the recovery read of the method it replaces.

This route was walked on 2026-10-01 against the `0.1.7-rc.2` install: the commands
above printed every line quoted here. Nothing §2.1 or §7 claims about the host page
rests on a source file of the harness repository; where a claim needs the Host's
inventory rather than its bundle — whether the page asks this row for its one-liner,
what `row.meta` carries — SPEC says so and leaves it to the live pass.

The rulebook caught up while this card was in review: #660 rewrote
`AGENTS.md` §"Plugin configuration card UI", `docs/PLUGIN_GUIDELINES.md` and the
`create-plugin` skill's client reference to name the row seat of the Plugins panel
as where a configuration card registers, to require the `summary` answer this entry
gives, and to record the two traps of the seat — the owner prop `form` spread after the
face, and the panel being open to a non-loopback browser. The card now registers where
that rulebook sends it; `docs/DSH-0.1.7-MIGRATION.md` §4.2 carries the seat recipe the
same wave wrote. The shell followed in the same series: the owner's decision of 01.10
gave the panel's row the page's own chrome and left the plugin-owned shell to
`settings.section` and `settings.plugins.tab`, it landed as the contract in #684 —
`AGENTS.md` and `packages/plugin-scripts/verify-plugin-card-contract.mjs`, measured
against the built bundle by the seat it registers on — and this package obeys it now:
no shell, no chevron, no badge, the ring from the Host's tokens. Nothing about this
card waits on the wave any more; what is left open is the live look of it, §7 item
for the browser pass.
