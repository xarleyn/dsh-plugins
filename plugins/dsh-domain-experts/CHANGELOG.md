## 0.4.1 (2026-10-08)

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

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.4.0 (2026-10-04)

### 🚀 Features

- An expert's memory now belongs to the account that learned it. Where the ([#369](https://github.com/xarleyn/dsh-plugins/issues/369), [#366](https://github.com/xarleyn/dsh-plugins/issues/366))
  deployment has accounts, the writable namespace of a run is
  `domain/payments/u/<account>`, and the domain's own namespace joins the
  read-only tier every account of that domain shares — so a note one account's
  expert wrote stops being a rule another account inherits. An account is read
  from the caller's own session on the host, never from a tool argument, and a
  delegated run keeps the account of the run that spawned it. With no accounts
  surface mounted, or with `perUserMemory: false`, one namespace per domain stays
  exactly as it was.

  What that namespace is for is now said out loud. The composed policy tells the
  expert to decide who a note is true for before recording it: a tool that was
  refused, a source that was not mounted, a path that could not be read describes
  this caller's access, not the domain, so it belongs in the answer and not in
  memory that outlives the run. A run no account has claimed reads as before and
  is refused a write, because the only namespace left to it is the one every
  account reads — `MEMORY_SCOPE_DENIED` with the reason, instead of a note that
  reads as domain truth tomorrow.

  The inspector gained the note each memory namespace carries, the Memory tab says
  which namespace a run of an account-scoped deployment really writes, and
  `domain_memory` states the same rule in its own description.

- Expert memory can be maintained, and junk stops being recorded. ([1c783708](https://github.com/xarleyn/dsh-plugins/commit/1c783708))

  The QA admin console gained a "Expert memory" section: the records an expert
  wrote to itself, listed per domain, searchable, correctable and deletable one at
  a time or as a selection. A reviewer reads it; only an administrator writes it,
  and every write is audited with the line as it was before.

  On the write path, the `domain_memory` tool now refuses a note that records
  nothing — an acknowledgement, a placeholder, an echoed command, or "nothing was
  found" — and answers with the reason, so a wrong line stops being injected into
  every later answer of that domain by the same expert that wrote it. Operators
  are not gated: correcting or emptying a record from the console stays allowed.


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

- The degradation codes a run records are documented one by one, with what each of them costs the expert. ([#305](https://github.com/xarleyn/dsh-plugins/issues/305))

  `TOOL_UNVERIFIED` is the code an operator meets on every deployment: the resolver grades an allow-list name as unverifiable whenever it is neither a plugin alias nor a registered worker of this plugin, which is the case for an ordinary tool such as `read` or `grep`. It had no description anywhere, so a `degraded` chip or a `domain-expert/degraded` warning sitting next to `status="completed"` read as a fault in a run that had finished normally.

  SPEC §2 now carries a table: for each of the six codes, when it is emitted and what the expert loses. `TOOL_UNVERIFIED` loses nothing — the name is passed to the harness unchanged and stays in the child's tool filter, which the resolution test now asserts next to the code. `TOOL_UNFILTERABLE` is the code that can name a tool the expert did not get, and it names that tool. The informational status is a property of the resolution, not an oversight: this plugin's worker registry is not the host's global tool registry and no seam asks the latter before the child starts, so the resolver can neither confirm nor deny such a name and says so instead of quietly dropping it and narrowing the expert.

  The operator-facing half is in the README, all three languages, in the section that already separates `enforced` from `advisory`: the chip is not a broken expert and the codes are not equally severe. `docs/architecture.md` records the same trade-off where the tool mask is described. The machine-readable half — a severity carried by the degradation record rather than read off this table — would change the `DomainDegradation` contract and every surface that reads it, so it is written into SPEC §4 as deferred and the published contract is untouched.

- The plugin's own configuration is edited live on a 0.1.7-rc.2 host. ([#529](https://github.com/xarleyn/dsh-plugins/issues/529), [#598](https://github.com/xarleyn/dsh-plugins/issues/598))

  It published its knobs through a settings section it had installed itself, and the
  `0.1.7` settings rewrite deleted that seam: a field belongs to the form the Host
  serves exactly when its schema node carries `.volatile()`, and the settings
  document of a profile is keyed by the profile entry id rather than by a name the
  plugin invented. All ten knobs are volatile now, which is what keeps them
  editable from the browser, and the `domain-experts` namespace goes with the
  section that created it — an operator edits the `dsh-domain-experts` entry.

  Reading moved with it. A volatile field is a stable reference, so the service
  takes one plain snapshot per operation instead of holding the entry it was
  composed with, and a value committed after startup is the value the next
  operation sees. Turning `enabled` off still withdraws the three agent tools at
  once: that is the one knob with an effect beyond the next read, and it is now
  re-applied on the loader's volatile-update event rather than on the installation's
  callback. `defaultMemoryProvider`, `memoryDbPath` and `auditLimit` keep the
  restart caveat their descriptions already state — the provider set and the audit
  ring are built once, when the plugin loads.

- Every element the domain experts page renders can now be addressed by a stable test id. ([#465](https://github.com/xarleyn/dsh-plugins/issues/465), [#453](https://github.com/xarleyn/dsh-plugins/issues/453))

  The browser half of the plugin carried no `data-testid` at all, so an automated
  check could only reach a control through the caption it happened to show or the
  class that painted it, and renaming a button or restyling a card broke checks
  that never cared about either. Each control, state and shell the client owns now
  carries an id prefixed with its zone — `domain-experts-page-*` for the list,
  `domain-experts-editor-*` for the editor, `domain-experts-inspector-*` for the
  resolved scope — and a shared control takes its id from the call site that
  places it, so the same field in two tabs never answers to one selector. A row of
  a table holds the id of its template rather than a number, so no index is baked
  into a name. 337 distinct values, none of them reused by a second kind of node.

  Nothing is displayed differently: only attributes were added, and the plugin's
  own checks now find their nodes by id instead of by text, class or placeholder,
  while the assertions that were about a role or an accessible name stayed as they
  were.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.3.0 (2026-09-24)

### 🚀 Features

- An expert's memory can live in a database of its own instead of a rewritten document. ([2cc0023](https://github.com/xarleyn/dsh-plugins/commit/2cc0023))

  The carrier was never the problem at three domains and a handful of notes. It
  became one on a working stand: 30 memory records, 103 KB of JSON, a doubling in
  24 hours, and every `remember` re-serialising and replacing the whole unit —
  because that is what the storage backend does with a snapshot it holds in memory.
  A measured 5 000-record table costs 14.8 ms per write against 0.05 ms for the row
  the same write is in SQLite, and clearing a namespace costs one delete per record
  rather than one statement.

  So the plugin gained a second memory provider, `sqlite`, chosen in deployment the
  same way the subagent provider is: `defaultMemoryProvider: sqlite`, with
  `memoryDbPath` naming the file (`<DSH_HOME>/domain-experts-memory.db` by
  default). It is built on the repository's own SQLite plumbing, so it inherits WAL,
  `BEGIN IMMEDIATE`, the schema version and the refusal to open a database a newer
  build wrote — the same ground `qa-accounts.db` and `qa-quality.db` already stand
  on. Namespaces and keys became columns, so a record of one domain can no longer
  be addressed through a crafted key of another.

  The switch is the part an operator will not notice, and that is the requirement:
  memory that had already been written is still there, and it answers the same way.
  The first time a `sqlite` deployment opens its storage, it copies what the unit
  holds in one transaction and compares every copied row against its original
  field by field — text, tags, both timestamps. A row that does not match rolls the
  copy back, leaves the unit holding everything, and fails the open with
  `STORAGE_UNAVAILABLE` naming what disagreed, rather than starting an expert
  against a database that might be missing something. The unit is never emptied by
  the plugin: it stays as the way back.

  Ranking moved with the data because both providers now share one scorer, and the
  SQLite one pushes it into SQL: substring matches over a stored search text, then
  the newest update, then namespace and key. The last term is new and deliberate —
  records written in one session really do tie to the millisecond, and an order
  that then depends on insertion history makes a migration look like it changed an
  answer. FTS5 was tried on paper and rejected for exactly this reason: it is a
  different notion of a match, and a stand that gets other notes back after a
  storage change has lost something no test complained about.

  Nothing is removed from the built-in provider, and no record format changed: the
  unit stays at version 1. Deployments that keep their memory where it was are
  unaffected — they never open the new file.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-09-23)

### 🩹 Fixes

- Domain expert execution now fails closed when the runtime cannot enforce an ([7843693](https://github.com/xarleyn/dsh-plugins/commit/7843693))
  explicitly denied tool. A refusal no longer retries with a list that accidentally
  puts the denied name back into the worker's allowed set.

  The integrations operator card keeps new instance and service-credential rows
  as local drafts until they are complete. Controlled profile fields no longer
  snap back to the stored value, and deleting a stored instance cannot shift an
  unfinished draft into the payload sent to the Host.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-22)

### 🩹 Fixes

- Five client bundles stop letting a literal decide a surface, a status or an ([54c2bcc](https://github.com/xarleyn/dsh-plugins/commit/54c2bcc))
  elevation (#254).

  The audited rule is the one the guidelines state: UI is built from
  `--dsw-alias-*` tokens, and a literal may only carry a narrow semantic accent.
  Outside `dsh-qa-surface` (excluded by the card), the sweep found two statuses
  and two elevations that broke it:

  - `dsh-domain-experts` defined its own `--dx-ok/--dx-warn/--dx-danger` with hex
    literals, so enforced, advisory and error text kept a fixed green, amber and
    red in every theme. They now resolve to the host's
    `--dsw-alias-state-{success,warn,error}-primary`, which the rest of the
    repository already uses; the local names stay, so no rule changed shape.
  - `dsh-qa-browser`'s canvas and its tab menu carried literal `box-shadow`
    values. They now ask for `--dsw-shadow-lv2`/`--dsw-shadow-lv3` - the tokens
    `dsh-qa-surface` and `dsh-draft-sessions` already use - and keep the previous
    value as the fallback, so an older host renders exactly as before.
  - `dsh-draft-sessions` wrote the same idea as `--dsw-shadow-l2`, a name no host
    defines; the literal fallback hid it, which is why it survived. Corrected to
    `--dsw-shadow-lv2`.
  - `dsh-documents` asked for `--dsw-label-tertiary` first and only fell back to
    the token that exists; the dead first name is gone.
  - `dsh-doc-impact`'s transparent button border was spelled `#0000`; the keyword
    `transparent` says the same thing without a color literal.

  What stayed is what the rule allows: the remaining literals in these bundles are
  all fallbacks inside `var(<token>, <literal>)`, never the value a themed host
  would resolve. Typography literals were deliberately not touched - the canonical
  card shell in AGENTS.md hardcodes its own 15/13/11px sizes, so font sizes are
  the repository's convention rather than a token-governed surface.

- An expert starts even when its tool policy names a tool the filter may not name. ([0d69f88](https://github.com/xarleyn/dsh-plugins/commit/0d69f88))

  A domain's `tools.allow` became the child's tool filter verbatim, and the
  runtime refuses a whole composition over one name it cannot resolve: a child
  composes its parent's preset into its own scope, so every tool that preset
  mounts — the filesystem readers, the skill catalog, the web tools — is a name
  `restrict()` rejects, and a single one of them took the run down. Two failures
  came from that: the product experts, whose policies list `glob`, `grep`, `read`
  and `skill`, died as `WORKER_UNAVAILABLE` on a deployment that mounts those on
  the agent plane, and the answer reviewer did the same whenever the
  `mcp__openviking__*` tools its policy lists were not yet registered.

  The start is now a two-step: the runtime's own refusal names exactly the
  entries it could not resolve, and the run is retried once without the ones the
  filter actually carried. Dropping such a name costs nothing when the expert's
  preset provides the tool — an own-layer tool stays visible whatever the filter
  says — and costs that single tool when nothing mounts it; either way the audit
  records a `TOOL_UNFILTERABLE` degradation naming it, so the inspector shows what
  went missing instead of the expert being lost with the complaint that its policy
  names a tool. A refusal that names nothing the filter carried is unchanged: it
  is not this plugin's to explain and it stays loud.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-22)

### 🚀 Features

- A domain expert's run history is visible again, on the domain's own page. ([8af757b](https://github.com/xarleyn/dsh-plugins/commit/8af757b))

  Every run was recorded — the host keeps an audit ring and mirrors each entry to
  the plugin log — but no surface ever showed it, so an expert opened from a
  conversation through the agents panel left its domain page looking untouched.
  The domain editor now has a `Runs` tab. It lists the runs the process still
  holds, newest first, one row each: when the run started, its mode and outcome,
  the duration, the caller session and the delegation path behind it, and the
  child session that ran it. A run started from a chat and one started from the
  test screen therefore appear in the same list, which is the equality a domain
  page could not show before. `Refresh` re-reads the ring, and a run the page
  itself starts lands in the list the moment it finishes.

  The memory half was checked and left alone: an expert's notes are read and
  written through the same provider and the same `domain/<id>` namespace whichever
  entry point started the run, so nothing was hiding memory from the page. The
  list is the ring, not a durable log — it is what the running process still
  holds, and the tab says so instead of implying a longer memory.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.1.4 (2026-09-21)

### 🩹 Fixes

- The child's system section carries the policy, not the task. ([edaa55b](https://github.com/xarleyn/dsh-plugins/commit/edaa55b))

  Splitting the prompt from the persona was only half of it: the persona the
  runtime installs still ended with its own `## Task` section, so the caller's
  request travelled twice — as the child's first message and inside the system
  text. For the review gate that is the worst of both: the candidate answer
  being reviewed, wrapped in its `<candidate_answer>` fences, sat in the system
  prompt as though it were deployment instruction, while the same material also
  arrived as the user turn.

  `composePolicy` now builds the policy without the task section (base policy,
  domain, scope, memory, delegation, domain instructions, answer contract), and
  that is what the runtime receives as `persona`; `composePersona` keeps the
  full document, task included, for the composed preview an operator reads in
  the domain view. Background and continuable runs inherit the same policy. A
  test pins both directions: the delivered text has no task section and no task
  text, and the preview still shows them.

- An expert's first message is the request, not the policy document. ([3f756fc](https://github.com/xarleyn/dsh-plugins/commit/3f756fc))

  The composed persona — base policy, domain, scope, memory, instructions and
  the task — was handed to the subagent twice: once as `persona`, which the
  runtime installs as a system-prompt section, and once verbatim as the child's
  first `prompt`. The child therefore opened with several thousand characters of
  deployment instruction reading as something the user had said, and an expert
  whose whole job is separating what the caller asked from what a source claims
  — the answer reviewer — had exactly the wrong material seeded as the user turn.

  The profile now carries the caller's request on its own (`task`, composed by
  the new `composeTask`), and the runtime receives the policy as `persona` and
  the request as `prompt`. The composed preview keeps its `## Task` section, so
  what an operator reads in the domain view is unchanged; only the delivery to
  the child is. Background and continuable runs inherit the same split.

- The built-in expert policy tells experts how to work tools without looping. ([d12f363](https://github.com/xarleyn/dsh-plugins/commit/d12f363))

  Every domain inherits one base policy, and it said what to do with evidence
  but nothing about the way a run goes wrong: an expert that hits a refused,
  timing-out or unavailable tool kept retrying it — and near-variants of it —
  burning the steps it was given instead of moving to another source. A live
  review run showed exactly that: two calls to an MCP endpoint that answers with
  a timeout, then more attempts of the same tool, and a `grep` without a path
  that searched an empty working directory and reported "no matches" as though
  the corpus were empty.

  The policy now carries three rules: a call that errors, times out or is
  refused has already answered (record it, change the source or the query, never
  repeat the call); read tools take an explicit path, so a bare pattern proves
  nothing about the sources the expert was pointed at; and a source that is
  unavailable for the run is reported as unavailable rather than replaced with a
  guess. Domain instructions still append to this text — it is a floor, not a
  replacement.

- Editing a domain is discoverable, and leaving the editor no longer drops unsaved edits. ([186f977](https://github.com/xarleyn/dsh-plugins/commit/186f977))

  The tab rendered its list and its editor as two wrapping flex columns. The
  settings dialog is narrower than their combined minimum, so the editor wrapped
  *under* a list of eight cards: clicking a domain appeared to do nothing, and the
  only control a card offered was `Disable`, which reads as "this record cannot be
  changed".

  The list and the editor now share one pane, so opening a domain replaces the
  list, and an explicit `Edit` button sits next to `Enable`/`Disable` on every card
  instead of the card body being the only, unlabelled way in. `All domains` above
  the form returns to the list, and it asks before discarding when the draft
  differs from the definition it was loaded from — including when the header starts
  another domain while an edited one is open.

  A domain that disappeared while the list was open reports that on the list now,
  instead of a message that had nowhere left to render.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.3 (2026-09-18)

### 🩹 Fixes

- The first `domain_expert` call after a plugin start no longer refuses with "Domain storage is not open yet". ([cd4ee96](https://github.com/xarleyn/dsh-plugins/commit/cd4ee96))

  The storage open is lazy and memoized, and the tools resolved their definition through a synchronous handle check: the one call that raced the open was refused, and because models rarely retry, a restart silently cost the first delegation. The tool dependencies now await the one-time open, so the racing call waits and proceeds; a storage failure that already happened surfaces its underlying `STORAGE_UNAVAILABLE` cause ("Domain storage could not be opened: …") instead of the misleading "not open yet".

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: tests share the `fixedClock` fixture from `@yadsh/dsh-test-kit`, and package verification gates run through the shared runner. No runtime changes. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-13)

### 🚀 Features

- Initial release of the Domain Experts plugin. A domain is a persisted expert ([dc6ad70](https://github.com/xarleyn/dsh-plugins/commit/dc6ad70))
  profile — persona, filesystem and knowledge scope, memory namespace, tool
  policy, cross-domain policy and model policy — created in a new
  `Settings → Plugins → Domain Experts` tab. Experts run as ordinary DSH
  subagents through the native runtime, so the plugin composes the request
  instead of re-implementing agent execution. The plugin reports every
  restriction as either enforced or advisory, so a filesystem rule is never
  presented as isolation it does not have. Cross-domain questions go through the
  owning expert, with a machine-enforced mode, target list, depth cap and
  parallel budget; memory is partitioned by namespace at the storage-key level.
  Scope providers, memory backends and workers are public extension seams.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn