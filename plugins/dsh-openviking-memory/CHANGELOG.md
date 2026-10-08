## 0.5.1 (2026-10-08)

### 🩹 Fixes

- A refusal block reads as a refusal again, and a token the Host never declares ([#717](https://github.com/xarleyn/dsh-plugins/issues/717))
  cannot be written down unnoticed.

  Unknown `var(--dsw-…)` is not a missing colour: the substitution yields the
  guaranteed-invalid value, so the browser drops the whole declaration at
  computed-value time and says nothing. `--dsw-alias-bg-error` and
  `--dsw-alias-label-error` are named by no theme sheet — the error ramp is
  `--dsw-alias-state-error-primary` — so every block of refusal text written with
  them lost its fill and its ink together and rendered as ordinary small text,
  which is how issue #717 looked on the Memory tab of a stand with no access to
  the service. The same mechanic had already cost `dsh-sleev` its focus and
  invalid borders (`--dsw-alias-border-brand`, `--dsw-alias-border-error`) and
  `dsh-session-scope` its chip fill (`--dsw-alias-fill-tsp-secondary`).

  Text and borders now take `--dsw-alias-state-error-primary` with a `#b3261e`
  fallback. The theme declares no error *surface* alias — `state-success` and
  `state-warn` have a tint, `state-error` does not — so a block mixes the state
  token the way the Host's own danger control does,
  `color-mix(in srgb, … 8%, transparent)`, and keeps its soft red in both themes.
  Three names that only ever survived behind a fallback are retired where a live
  token exists (`--dsw-alias-bg-elevated` → `--dsw-alias-button-elevated-fill`,
  `--dsw-alias-label-inverse` → `--dsw-alias-label-primary-foreground`), and
  `--dsw-font-family-mono`, for which the theme offers no alias at all, becomes
  the `ui-monospace` stack the other bundles already write. No computed value
  changes except where a dead name had been silently winning.

  `pnpm verify:tokens` (`scripts/verify-design-tokens.mjs`) is the class turned
  into a gate: it collects every `--dsw-*` name substituted under any package's
  `src/` and refuses one the installed `@deepseek-ai/dsh-client-ui-theme` does not
  declare — a dead name behind a fallback included, because the fallback paints a
  colour the Host never chose. The vocabulary comes from the pinned package rather
  than a hand-kept list, so the check needs no harness checkout and reads the same
  version the plugins build against; where the theme cannot be found the gate
  reports that instead of passing. `dsh-plugin-log-ui`'s own bundle pin flips from
  requiring `--dsw-alias-bg-error` to forbidding the dead error names.

- Every plugin row on the Host's Plugins page is named in words. ([fff88762](https://github.com/xarleyn/dsh-plugins/commit/fff88762))

  The page titles a bundle's row and fills its description line from the package's
  exported `locale/en.json`, which the Host resolves through the package's `exports`
  map without activating the plugin (`@deepseek-ai/dsh-app-boot` `package-meta.ts`).
  Only `dsh-documents` shipped that file, so the other twenty-five rows were signed by
  their full package specifier — an operator read `@yadsh/dsh-jev-compaction` where a
  first-party row read a phrase. Each package now exports `./locale/en.json`, publishes
  `locale/*.json`, and carries English `meta.title` and `meta.description`; where the
  package already had a configuration card, its `summary` one-liner and the row's
  description are one string, pinned by a test against the shipped file rather than
  against a copy in the test. `pnpm verify:packages` asks all three halves of every
  plugin package, so a row cannot fall back to a specifier unnoticed.

  Two pages still seated on the deleted-in-spirit `settings.plugins.tab` move to the
  panel with them. `dsh-prompt-firewall` edits its own Config namespace, so it takes the
  row seat keyed `@yadsh/dsh-prompt-firewall#dsh-prompt-firewall` — the row id is the
  namespace the Host serves the form under, so no saved value is orphaned — and with the
  seat it gives up its shell, its header badge and its show/hide labels, taking the
  Host's `--dsw-focus-ring-*` pair for every control it draws and answering the
  unavailable namespace with a sentence instead of an empty section.
  `dsh-domain-experts` owns no form — it edits domains through its Remote services — so
  it takes the bundle-level seat `plugins.bundle.config`, keyed by the package name, and
  drops the `<h2>` heading and the intro line the panel already draws from the row's own
  display metadata.

- The memory page of the QA settings dialog answers a failed read in the reader's ([#716](https://github.com/xarleyn/dsh-plugins/issues/716))
  own words instead of repeating the transport's line.

  A deployment that does not let this browser session reach the memory service
  answered the «Память» tab with `client api: openvikingMemory/userMemoryOverview
  failed: transport failure for /api/openvikingMemory/userMemoryOverview: HTTP 403`.
  The page printed whatever the wire carried: an RPC method, an endpoint and a
  status code — the inside of the surface, and a sentence nobody can act on,
  because `HTTP 403` answers neither "is my memory switched off" nor "is the stand
  broken". The store's own socket sentence reached the dialog the same way, from
  the overview the plugin reads on the page's behalf.

  Now a failure crosses that boundary as a kind, and each kind has its own copy:
  a session the deployment does not let through is named as the operator's
  allow-list, a store that does not answer is separated from one that refuses this
  deployment, an expired sign-in tells the reader to sign in again, and a call the
  transport could not complete reads as a stand that says nothing. What a page
  cannot classify gets the one generic sentence — never the string it could not
  classify. The method, the endpoint, the status and the store's own message are
  not thrown away: they go to `console.debug` in the browser and to
  `qa_memory_overview_failed` in the plugin log, where an operator greps them. That
  is how the rest of the dialog already answers — the QA surface and the
  Integrations page both map a failure to authored copy — and the memory tab was
  the section that had not.

  Nothing about where memory is stored or read changed, and the switches that
  decide whether the assistant uses memory at all stay out of this page: it reads
  and only reads.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.15.2

### ❤️ Thank You

- qoder-bot
- xarleyn

## 0.5.0 (2026-10-04)

### 🚀 Features

- Per-account memory becomes the operator's switch, and the account boundary is stated where it can be read. ([#172](https://github.com/xarleyn/dsh-plugins/issues/172))

  The card gains a **Multi-user memory** section carrying `qaUserScoping` — the
  option the schema has had since 0.4.0 with nothing in the settings surface able
  to set it. Like every other knob, a committed change is re-resolved and reaches
  sessions that are already open.

  A session that was left alone for want of an account now answers a second time:
  `qa_memory_attributed`, with the delay it took. A chat is claimed when its
  browser half opens it, which trails the session start, so the lone
  `qa_memory_unattributed` line read as lost memory when it was usually only
  early; the pair separates the two, and the map behind it is now released with
  the session.

  SPEC §2.2 and the README name the one path that is **not** per account — the
  bridged `mcp__openviking__*` tools run in one child mounted for the process, so a
  model-initiated `remember`, `search` or `read` works on the deployment space and
  is shared by every account — pin that with a request-level test, and write out
  the migration path for memory filed under the deployment identity before
  scoping was turned on. §6 gains the scenarios: the master switch pulled live on
  an open session, a chat claimed late, a model-initiated write on a scoped
  deployment, and the card on the stand's loopback face.

- The OpenViking Memory card is opened from the Plugins page now, on the row of the ([#652](https://github.com/xarleyn/dsh-plugins/issues/652), [#646](https://github.com/xarleyn/dsh-plugins/issues/646))
  plugin it configures.

  The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
  where a plugin puts a page the Host does not own. This card edits exactly one
  thing — this bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
  page declares `plugins.row.config`, a keyed seat whose entry opens as the row's
  configuration section, headed by the page's own chrome. Registering there is the
  difference between a settings page a user has to know the name of and a configure
  control on the row they were already looking at.

  The key is `@yadsh/dsh-openviking-memory#dsh-openviking-memory` — the package name
  joined to the row id `cordis.patch.yml` declares. That join is what makes the move
  cheap and what makes it safe: the row id is the same string the Host has resolved
  this plugin's volatile Config under since `#516`, so the namespace the page derives
  its form from and the namespace this plugin reads are one namespace. **Nothing about
  where values are stored changed**, and an endpoint, a peer rule or a recall budget
  saved by an older build is read back by this one; the tab's own seat id
  `openviking-memory` was the only name left behind, and it named nothing but the seat.

  The card keeps its six sections and its write-on-change behavior, and gives up the
  frame around them. Its row is seated inside the page's own card: the page paints the
  surface, the heading, the row id, the description line and the expand control, and only
  then mounts this body. Until now the bundle drew a second card inside that one — a 12 px
  rounded rectangle with our chevron, our open state and a badge repeating the master
  switch, all of it inside the page's 20 px surface — so this plugin's row read as a
  nested panel next to first-party rows. The body arrives directly now, and with the
  header gone the description sentence is printed once, by the page, from this entry's
  `summary` answer. The focus ring on each control the bundle draws comes from the Host's
  `--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, each with its fallback,
  because `focus.css` of the Host suppresses a hard-coded outline under pointer modality
  at a higher specificity than our rule had. A row whose namespace is not served to the
  client says so in a sentence rather than leaving the opened section blank: a card that
  owns its shell may stay invisible, one inside the page's frame may not. The owner
  settled this on 2026-10-01 in #646, it landed as the contract in #684, and the
  card-contract gate reads the seat off the built bundle and holds a card seated on the
  row to that half.

  Two details follow from the new seat rather than from a redesign. The seat spreads its
  own owner prop `form` after the injected face: a `ConfigPageForm` of
  `{ state, mutate }`, this same namespace's form seen through two members (`state` is
  one snapshot, refreshed when the page owner renders, and there is no subscription to
  take). So the full `ConfigForm` this entry resolves enters the card as `settingsForm`,
  where that prop cannot overwrite it, and it is what the card follows for the values it
  shows — while the writes themselves go through the page's `mutate` wherever the seat
  supplies one, and through the resolved form on a seat that supplies none. `set` and
  `unset` are one-op `mutate`s, so a field change keeps the revision fence, the ordering
  and the recovery read it had. And the seat hands the same entry two views: `page` is
  the body, `summary` is the row's one-liner, which the entry answers with the sentence
  rather than with the card, because the fallback lands inside a line of the page's own
  text.

  The account-scoped page is untouched: it is a feature-owned QA page reached by a
  browser over the network, so it keeps mounting through `qaUserSettingsSections` and
  keeps the Remote namespace it reads. Only the operator's card changed seats.

  The manifest followed the surface: the client half type-imports the Plugins page's
  slot contract instead of the settings-plugins one, so
  `@deepseek-ai/dsh-client-ui-plugin-manager` replaces
  `@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
  entry — which is why this is `minor` rather than `patch`: a browser running a host
  without the Plugins page loses the card, and `compatibility.json` says so, its
  required client features naming `plugins.row.config` where it named
  `settings.plugins.tab`. `scripts/verify-package.mjs` asserts the new pair (the slot
  literal and the `@yadsh/dsh-openviking-memory#` key prefix in the shipped bundle, the
  new package in the inject list), asserts the `summary` answer ships in the same
  bundle, refuses the old slot name, and refuses the shell: a built bundle that still
  carries a `dsh-plugin-card` class or the shell stylesheet fails the gate. The client
  tests assert the keyed registration, the namespace the form is resolved under, the two
  views of the entry, which `mutate` a field change reaches the Host through, and that
  every control this body draws takes the Host's ring from both tokens with their
  fallbacks.


### 🩹 Fixes

- Every plugin declares the `0.1.7-rc.2` host — the metadata wave of the cutover. ([#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#509](https://github.com/xarleyn/dsh-plugins/issues/509))

  `compatibility.json` carries `>=0.1.7-rc.2 <0.2.0` and `0.1.7-rc.2` as its tested
  release, and the Requirements/Compatibility lines of the README and SPEC that
  restate that pair moved with it, so a package page and its manifest agree. The
  checks that hard-code the pair moved in the same change: two `deepEqual`
  assertions in the package verifiers, one bundle test, the plugin generator's
  scaffold defaults with its test, and the fixtures of the repository gates that
  read them.

  Dated records keep the version they were written against. Phase 0 and spike
  findings documents, `SPEC` baseline tags and permalinks into the harness tree,
  and a released QA changelog entry still name `0.1.5-rc.2`, because each reports
  what was observed on that host rather than what the package supports now.

- Automatic recall is unchanged; the module behind it is now eight, each with one ([#426](https://github.com/xarleyn/dsh-plugins/issues/426))
  reason to change.

  `src/openviking/recall-core.ts` had grown past a thousand lines while carrying
  three jobs that move separately — what is asked of the memory backend, which of
  the retrieved items a turn is shown, and how those are rendered into the prompt.
  A change to the server's request contract, to the ranking rule, and to the shape
  of the injected block all landed in the same file, and none of them could be
  reviewed as one subject.

  The parts now live in `src/openviking/recall/`: `request-body.ts` (the bodies of
  the two search faces, the quota arithmetic behind them, and the per-stage HTTP
  deadlines), `source-search.ts` (the raw `find` sweep and the user space its URIs
  resolve against), `server-assembled.ts` (the context face, the deprecated
  `/recall` preset behind it, and the rejections that mean a server predates a
  field), `rank.ts` (the query profile, the boosts, the dedup), `format.ts` (the
  token estimate, the per-item content, the envelope), `state-files.ts` (what one
  turn leaves on disk for the next), `pipeline.ts` (the order those paths are
  tried, including the second pass for a workspace's former peer), and `types.ts`
  for the vocabulary they share. `docs/upstream-sync.md` points a sync at the
  directory, and at the one file that carries this fork's type widenings.

  Nothing a caller can see moves. `recall-core.ts` stays as the re-export, so the
  import path, the twelve public names, and their types are what they were; the
  lines were moved as written, with `export` and `import` as the only additions;
  and the module's load-time effects — no I/O, one mutable cache — are unchanged.

- The user space a profile is read from is now resolved per OpenViking identity ([#352](https://github.com/xarleyn/dsh-plugins/issues/352))
  instead of once per process, so the second account of a shared deployment reads
  its own `viking://user/<space>` rather than whatever the first account resolved.
  Re-pointing the endpoint asks the new server again instead of reusing the old
  answer.

  A queued write now carries the identity it was queued as, so the offline queue
  replays after the server recovers. A deployment that allows memory without
  naming a per-account user used to refuse every replay, and its backlog aged out
  of the queue unsend; an entry whose account space is genuinely unknown still
  waits instead of guessing.

- OpenViking memory links can no longer escape into local filesystem tools. ([cc49668c](https://github.com/xarleyn/dsh-plugins/commit/cc49668c))

  The `viking://` execution guard is now registered globally, so calls routed
  through an agent scope are denied before `read`, `glob`, `grep`, shell, or edit
  tools can reinterpret a memory URI as a workspace path. The denial points the
  agent to the matching `mcp__openviking__*` tool instead.

- Both OpenViking Memory settings surfaces carry stable `data-testid` selectors. ([#468](https://github.com/xarleyn/dsh-plugins/issues/468))

  The configuration card names its seven sections (`openviking-card-recall`,
  `openviking-card-capture`, …) and every control inside them by the section that
  owns it and the settings key it writes
  (`openviking-card-recall-token-budget`), so a browser test reaches a field
  without reading the hint under its label. The override marker derives its id
  from the control it marks
  (`openviking-card-connection-endpoint-override`), the badge and
  the loading and write-error lines are named for the state they project, and the
  reset action is one hook rather than a hunt for a button whose caption counts
  overrides. The account-scoped memory page is `openviking-memory-*`: the page,
  its totals and the three notices that qualify them, the profile, group and
  session rows, the line that says which space is being shown, and the refresh
  control. A repeated node holds the id of its template, so no index is baked
  into a name.

  The two client suites now ask for those ids where they used to search the card
  for a sentence or a BEM class, and each keeps the assertion it was really
  making: the section heading is still checked as the heading it announces, the
  reset and refresh controls as buttons named by their caption, and every field's
  label as the accessible name that still points at the node the id found. The
  card shell itself is the shared `AGENTS.md` contract and was left alone, so its
  class queries stay where they are.

  Nothing moved and no existing class changed: the ids are an addition to the same
  elements, and the markup of the three files is identical to the previous one
  once the added attributes are removed.

- The memory plugin configures itself live on harness 0.1.7-rc.2. ([#516](https://github.com/xarleyn/dsh-plugins/issues/516), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  The 0.1.7 settings rewrite folded a plugin's profile configuration and its
  browser-editable namespace into one thing: a field is an editable form field
  exactly when its schema node is marked volatile, and the settings namespace is
  the profile entry id. Every knob of this plugin's `static Config` carries that
  mark, so the Host now serves the namespace on its own and the plugin's
  registration call — the settings section it installed through a host service
  that no longer exists — is gone. The consequence for an operator is the same
  promise, kept a different way: a switch edited in the card is re-read at the
  start of the next thing a session asks, reaches the sessions that are already
  open, and lands in the running runtime. Clearing a field still falls back to the
  composition entry rather than to a built-in default.

  The card moved with the surface it sits on. `settings.plugin.item` was deleted
  with no replacement slot of the same shape, so the card registers as a tab of the
  Plugins settings section instead — which is also where the plugin's own shell
  belongs, since that section hands a registrant an empty column: the card keeps
  the `dsh-plugin-card` shell and the `<li>` root now sits in a list the plugin
  owns. Nothing about the controls, the override markers or the write path changed.

  Session start moved too. The `agent/session-start` event no longer exists; the
  startup profile is delivered from `agent/created`, whose listeners the host
  awaits and where a throw rolls agent creation back. The plugin now reports every
  failure of that read in its log instead of raising it, so an unreachable
  OpenViking server cannot stop a chat from opening — and because the host awaits
  the listener, the profile is in the context before the first step rather than
  racing it.

  Injected context finally names its producer the way the host asks: the catch-all
  `plugin` source kind was removed and the source map is open for each producer to
  extend, so the plugin's profile and recall blocks are attributed to
  `openviking-memory`. Sessions whose history was written before this release carry
  the old attribution, and the "this chat already has its profile" check still
  recognises it — a resumed chat does not get a second profile. Capture reads only
  what the source map says is conversation, so a `developer/message` carrying the
  `tool-addition` / `tool-removal` blocks the host started emitting at `rc.2`
  neither reaches memory nor pollutes a recall query; those three rules are pinned
  by tests.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.14.0
- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.4.0 (2026-09-23)

### 🚀 Features

- The account-scoped page shows what the memory holds instead of switching it. ([453acbd](https://github.com/xarleyn/dsh-plugins/commit/453acbd))

  The "Память" page in the QA settings dialog was a copy of the deployment's own
  switches, handed to whoever opened it. Those switches decide whether the
  assistant uses the memory at all, which is the deployment's decision, taken
  where the deployment's configuration lives — so the page no longer writes
  anything. What it does instead is answer the question a person actually has
  about their memory: the profile the store keeps about the account, the sections
  it files memories under, and the conversations it learned from, all read
  through the client that speaks as that account.

  The account boundary now fails closed. The account travels as
  `X-OpenViking-User`, and a store in API-key mode strips that header and answers
  as its own user; if the store does not confirm the requested account, the Remote
  returns no profile, memories or session summaries and the page explains why the
  content is hidden. A stale response for a previous account can no longer replace
  the current page, and unloading or hot-reloading the client releases its Remote
  mount. Totals are calculated before the browser list is shortened and say when
  the server-side listing limit prevents an exact total.

  The Remote surface shrinks to one read-only method (`userMemoryOverview`);
  `setUserMemorySettings` and `resetUserMemorySettings` are gone, and the
  per-account plan overrides they wrote are now an operator's lever in
  `openviking-memory-qa-users.json` only. The operator's own configuration card is
  untouched.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.12.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.1 (2026-09-22)

### 🩹 Fixes

- The account-scoped memory page composes again, and the plugin stops disappearing ([176edb5](https://github.com/xarleyn/dsh-plugins/commit/176edb5))
  from the settings UI.

  The browser half read the Remote gateway off its own context, and a Cordis
  property read of a service the client face did not declare does not answer
  `undefined` — it throws `cannot get property "remote" without inject`. A
  throwing entry is a dead entry: the client loader reported
  `failed to apply loader entry (@yadsh/dsh-openviking-memory)`, the plugin's
  native card went away with it, and the whole plugin tree failed to load in the
  UI. The same held one level down, for the `openvikingMemory` namespace, which is
  a service of its own that only a scope that declared it may read.

  The bundle now declares the gateway client in `dsh.client.inject`, so the loader
  brings the gateway up before this entry applies — the ordering every other
  Remote plugin in this repository declares — and it waits for the gateway service
  instead of reading it, so a client that mounts no gateway keeps the native card
  and a gateway that arrives later still gets its page. The mounted namespace is
  read from inside the inject callback that owns it, which is also where the page
  and its stylesheet are registered and torn down.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.2

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-22)

### 🚀 Features

- Memory is kept per QA account, and each account can switch automatic context ([d0873e9](https://github.com/xarleyn/dsh-plugins/commit/d0873e9))
  off for itself.

  One plugin serves every chat on a deployment, so until now every account read
  from and wrote into the same OpenViking space: recall handed one user another
  user's memories, and capture filed one user's conversation where the next user's
  recall would find it. With a QA surface mounted the plugin now asks it who owns
  the session (`principalForSession`) and sends that account as
  `X-OpenViking-User`; a delegated child inherits the chat that created it, and a
  session no account has claimed yet is left entirely alone — it issues no request
  at all until its browser half claims it. Deployments without a QA surface keep
  the single deployment-wide identity, and `qaUserScoping: false` restores it
  explicitly.

  The settings card now actually appears. It never did, anywhere: a card is
  rendered only for a namespace the live plugin registered in the Host's settings
  directory, and this plugin only declared its schema — `static Config` publishes
  nothing. The host half now installs its section (the same shape the first-party
  cards use), which makes the namespace discoverable in a local installation, and
  adopts the section as its configuration source: a committed change is
  re-resolved and handed to the running runtime, so a switch reaches sessions that
  are already open, while the bridged MCP tools follow on the next reload.

  The switches a user owns moved to where that user can reach them. The Host's
  "Plugin configuration" card is discovered from the settings directory, which a
  browser reaching a deployment over the network never gets — and a QA overlay
  does not render the native settings tree at all — so on a QA deployment the card
  was unreachable for everybody even once it registered. The plugin now also registers a page in the
  signed-in user's QA settings dialog ("Память"), backed by three Remote methods
  that authenticate the caller by token and store the answer per account in
  `openviking-memory-qa-users.json` under `$DSH_HOME`. The page narrows the
  deployment's plan and can never widen it: `autoInject` off silences the profile
  and the recall for that account, capture and the memory tools keep working, and
  one reset hands every knob back to the deployment.


### 🩹 Fixes

- Memory stops presenting itself as the first source, and stops repeating itself. ([fa564fb](https://github.com/xarleyn/dsh-plugins/commit/fa564fb))

  The skill's trigger claimed the tools for any task that lacked context — "or when
  the task needs context this session does not have, even if nobody says the word
  memory" — which is every task that has not read its file yet. A model that could
  not read an attached document therefore had a description telling it that memory
  was the tool for the gap, and answered with a series of `find` → `search` →
  `read` → `glob` calls against the store while the document sat in the session.

  The description now owns memory-specific questions only (earlier sessions, "like
  last time", remembering and forgetting, where memories are filed), and the skill
  carries the order of sources it was missing: the conversation and this workspace
  first — attachments and documents are read with the file and document tools —
  then the product documentation and the domain expert, and only then memory. Two
  habits follow, matched to the failure: a miss in memory is not an answer, so a
  chain of searches is not a way to find a document; and one memory round per
  question is enough, because a reworded repeat returns what the first round did.

  The injected block says the same thing in its own words. `RECALL_FRAMING` in the
  runtime is the copy that travels with every recall envelope, whether or not the
  skill was activated, and the session now delivers a block once: an identical
  assembled block the conversation still carries is not injected again on the next
  step. The retrieval itself is unchanged — the plugin still asks the server per
  step, and the model can still search memory freely; what changed is that nothing
  in the plugin recommends memory as the default place to look.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.2.0 (2026-09-21)

### 🚀 Features

- The plugin gets a settings card, so its configuration is editable from ([80e928f](https://github.com/xarleyn/dsh-plugins/commit/80e928f))
  **Settings → Plugins** in the DSH web UI instead of a patch file.

  The card edits the plugin's `dsh-openviking-memory` settings namespace
  directly. Sections follow the configuration contract: the four automatic
  context presentation knobs with the master-switch semantics spelled out, the
  connection fields, peer identity, the recall knobs, capture and commit, and an
  advanced group for `skipSubagentSessions`, the two timeouts and the deprecated
  `captureMode`.

  Writes are immediate scalar sets, and clearing a field drops the user-layer
  override so the value re-inherits the composition layer — which for the
  connection fields means the `OPENVIKING_*` environment variables and credential
  files stay in charge. Fields marked as overridden by the profile's user layer
  carry an override marker, and one reset action clears all of them. The four
  knobs the schema deliberately leaves without a default render their upstream
  fallback as a placeholder and write only when a value is named, so the
  "configured" and "defaulted" cases stay distinguishable.

  The card is configuration-only: the header badge projects the master switch
  (`Auto-inject` / `Manual recall`), not live runtime state — diagnostics remain
  in the plugin log.


### 🩹 Fixes

- Reject an empty `grep` pattern or `search`/`find` query as invalid parameters instead of forwarding it to the OpenViking server. ([9c78405](https://github.com/xarleyn/dsh-plugins/commit/9c78405))

  The upstream server answers a retrieval call whose free-text parameter carries no non-whitespace character with a plain "no matches" result. That reads as a real, negative answer, so a model that sent an empty argument once kept resending it — one audited QA-stand session logged seventeen byte-identical empty `grep` calls in a row, each answered the same way. The stdio proxy now answers such calls itself with a JSON-RPC invalid-params error naming the parameter, and rewrites the upstream `tools/list` schemas so `grep.pattern`, `search.query` and `find.query` are advertised as required with a minimum length — the contract is visible before the model's first call, and `grep`'s list form of `pattern` gets `minItems` instead. `grep` keeps accepting either a single pattern or a list; only the all-empty shapes are refused.

  Both checks ride on two new proxy-core seams (`requestGuard`, `adjustUpstreamTool`) supplied by the harness entrypoint, so the vendored core stays free of OpenViking tool knowledge; see UPSTREAM.md.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-18)

### 🩹 Fixes

- Reject an empty `grep` pattern or `search`/`find` query as invalid parameters instead of forwarding it to the OpenViking server. ([942d68d](https://github.com/xarleyn/dsh-plugins/commit/942d68d))

  The upstream server answers a retrieval call whose free-text parameter carries no non-whitespace character with a plain "no matches" result. That reads as a real, negative answer, so a model that sent an empty argument once kept resending it — one audited QA-stand session logged seventeen byte-identical empty `grep` calls in a row, each answered the same way. The stdio proxy now answers such calls itself with a JSON-RPC invalid-params error naming the parameter, and rewrites the upstream `tools/list` schemas so `grep.pattern`, `search.query` and `find.query` are advertised as required with a minimum length — the contract is visible before the model's first call, and `grep`'s list form of `pattern` gets `minItems` instead. `grep` keeps accepting either a single pattern or a list; only the all-empty shapes are refused.

  Both checks ride on two new proxy-core seams (`requestGuard`, `adjustUpstreamTool`) supplied by the harness entrypoint, so the vendored core stays free of OpenViking tool knowledge; see UPSTREAM.md.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-15)

### 🚀 Features

- Initial @yadsh distribution derived from OpenViking's Apache-2.0 licensed ([1c0a9cb](https://github.com/xarleyn/dsh-plugins/commit/1c0a9cb))
  `@openviking/dsh-memory-plugin`, adding controllable automatic profile/recall
  injection.

  The plugin connects one DSH profile to an OpenViking server and keeps five
  capabilities independent: the `mcp__openviking__*` MCP tools, the
  `openviking-memory` skill, conversation capture and commit, the `viking://` URI
  guard, and automatic context presentation. Only that last capability is governed
  by the new `autoInject` switch and its three granular knobs
  (`injectStartupProfile`, `injectStepProfile`, `autoRecall`).

  Setting `autoInject: false` disables every automatic profile and recall
  injection *and* the requests behind them — no profile read and no recall search
  is issued, rather than a request whose result is discarded. Tools, skills,
  capture, commit and the URI guard keep working, so an agent can still learn from
  the conversation and still call OpenViking itself when it decides memory is
  worth the latency. The default configuration reproduces upstream semantics.

  The package also modernizes the port to this monorepo: TypeScript under `src/`,
  a typed Schemastery schema that rejects out-of-range values instead of silently
  clamping them, structured logs under `<$DSH_HOME>/logs/dsh-openviking-memory/`,
  and the standard build/release tooling. Upstream provenance, the dropped
  cross-harness helpers and the upstream-sync process are recorded in `UPSTREAM.md`
  and `docs/upstream-sync.md`.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn