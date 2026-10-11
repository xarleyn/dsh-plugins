## 0.3.1 (2026-10-08)

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

## 0.3.0 (2026-10-04)

### 🚀 Features

- The gate's configuration becomes live Host configuration, and its card moves to ([#517](https://github.com/xarleyn/dsh-plugins/issues/517), [#507](https://github.com/xarleyn/dsh-plugins/issues/507), [#508](https://github.com/xarleyn/dsh-plugins/issues/508), [#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#513](https://github.com/xarleyn/dsh-plugins/issues/513), [#509](https://github.com/xarleyn/dsh-plugins/issues/509))
  the surface that still exists on a 0.1.7-rc.2 host.

  On 0.1.5 the plugin installed a `model-safety-gate` settings namespace of its
  own and the card edited that. `0.1.7` deleted the namespace surface: a field is
  editable while the plugin runs iff its schema node is declared volatile, and the
  settings namespace of a form is the profile entry id. So the twelve nodes the
  card edits are now declared `.volatile()`, the card binds to
  `dsh-model-safety-gate`, and the gate reads its configuration through the
  references the Host resolves — `snapshotSafetyGateConfig` takes one snapshot per
  reload, and `loader/volatile-update` is what announces a committed edit. **A
  configuration the operator stored under the old `model-safety-gate` namespace is
  not read by this version**: the Host imports legacy settings by entry id, and the
  gate's own namespace was never one. The deployment keeps whatever its profile
  patch declares and re-applies the rest from the card.

  The write path changed shape with it. `SettingsRegisterOptions.validate` is gone
  and the Host enforces only the schema, so a combination the schema cannot say —
  a `dsh` backend without a provider, a `customBlockPatterns` entry that does not
  compile — is stored, then refused where it matters: the gate keeps running its
  last workable configuration, logs `safety.config.rejected`, and reports the
  refusal as `configRejected` on the `safetyGate` Remote, which the card now shows
  next to the controls. A silently ignored policy would be the failure mode worth
  avoiding in a safety gate, so nothing is swallowed and nothing is blocked.

  The card itself keeps its shell and moves to `Settings → Plugins → Model Safety
  Gate` (the surviving `settings.plugins.tab`), the placement `AGENTS.md`
  prescribes for a feature-owned page backed by a Remote; `settings.plugin.item`
  no longer exists. Its list element keeps a list of the plugin's own, and writes
  carry the revision the card read, so an edit that raced the surface is refused
  rather than overwritten.

- The Safety Gate card opens from the plugin's own row in the Plugins panel now, ([#653](https://github.com/xarleyn/dsh-plugins/issues/653), [#646](https://github.com/xarleyn/dsh-plugins/issues/646))
  not from a tab of the Settings "Built-in plugins" section.

  The card edits exactly one thing — this bundle's own Config — and the Plugins
  panel declares a configuration seat for that: `plugins.row.config`, keyed by
  `<package name>#<row id>`. The row this bundle's patch declares is
  `dsh-model-safety-gate`, the same string the Host has resolved the gate's live
  Config under since `0.1.7`, so the seat moved and the namespace did not: a mode,
  a threshold or an audit switch saved before this release is read back by the card
  after it. The tab's own seat id `model-safety-gate` was the only name left
  behind, and it named nothing but the seat.

  The row page renders this entry in two views. As the row's one-line description
  it answers with the sentence the card's header already carries, because mounting
  the form there would draw a page inside a line of text and start a second poll of
  the running gate. The form belongs to the page view, and it keeps resolving its
  own live configuration through the settings domain rather than taking the page's
  `{ state, mutate }` view, which can neither be subscribed to nor written field by
  field; that form arrives as `settingsForm` now, since the page hands its
  registrant a prop called `form`.

  The card renders the body only: the row page already draws the card surface, the
  heading and the expand control, so the plugin's own shell — border, chevron and open
  state — is gone rather than nested inside the Host's, and the focus ring now comes
  from the Host's `--dsw-focus-ring-*` tokens. The package gate reads the seat from the
  built bundle and holds a card seated here to that rule.


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

- The card body is several modules now, and nothing the shell sees changes. ([#428](https://github.com/xarleyn/dsh-plugins/issues/428))

  `src/client/sections.tsx` was one 875-line file holding every settings plane of
  the Safety Gate card together with the read-only status and verdict views, so a
  change to the streaming window sat in the same file as a change to the audit
  disclosure. It is now a `src/client/sections/` directory built by the same
  tsdown entry: one module per settings plane (`gate`, `input`, `output`, `tools`,
  `classifier`, `audit`, `advanced`), `status.tsx` and `verdicts.tsx` for the two
  views that only read the running gate, `controls.tsx` for the props and the
  clearing button the planes share, and `index.ts` for the surface `card.tsx`
  imports. The option lists moved next to the plane that owns them, so an added
  mode is edited in the file that renders it. The largest module is 185 lines.

  Every choice a section makes is unchanged: the same settings paths are written
  and cleared, the same defaults stand in for an absent snapshot, the override
  marker and its reset still cover `enabled` with `mode` and `tools` with
  `toolResults`, and the remote-classifier and raw-content disclosures appear under
  the same conditions. The shell keeps the shared `dsh-plugin-card*` classes and
  the SVG chevron, and the built bundle is asserted by `pnpm verify` — no test was
  edited.

- Buffered output releases only what a check has actually examined, and the gate ([#354](https://github.com/xarleyn/dsh-plugins/issues/354))
  profile now decides on every surface.

  The streaming quarantine sized each classifier snapshot from the newest end of
  the buffer and then released all of it. A chunk wider than `output.windowChars`
  was therefore shipped on the strength of its tail: the oldest quarantined text
  never once reached a scan, yet reached the consumer — and the same gap opened
  whenever `output.minCheckIntervalMs` let several chunks pile up behind one check.
  A window now fills from the oldest quarantined text, and a flush hands back no
  further than the head the passing check covered, so a buffer larger than one
  window drains window by window. The released prefix stays in front of the next
  window as its context, so nothing slips through the seam between two.

  The output guard read the pipeline's raw decision while the input, tool-call and
  tool-result guards all capped theirs through the shared mode mapping, so a gate
  set to `audit` — the profile that records findings without acting on them —
  cancelled the turn and withheld text, and `warn` blocked exactly like `enforce`.
  Streamed output now answers the same question as every other surface: `audit`
  records and releases, `warn` reports without withholding, and only `enforce`
  stops a generation.

- The Safety Gate settings card now takes the frame the Plugins page already draws. ([01f985b1](https://github.com/xarleyn/dsh-plugins/commit/01f985b1))

  Its row on the Plugins panel is seated inside the page's own card: the page paints the
  surface, the heading, the row id and the expand control, and only then mounts the
  bundle's body. Until now the bundle drew a second card around its own settings — a
  12 px rounded rectangle with our chevron, inside the page's 20 px one — so the gate's
  row read as a nested panel next to first-party rows. The body arrives directly: the
  configuration sections are mounted without a shell of ours, without the injected shell
  stylesheet, and without a show/hide button that duplicated the page's own toggle. The
  live mode and the block counters were already in the status section, so the header
  badge that repeated them is gone with the header.

  Focus rings come from the Host's design system now
  (`--dsw-focus-ring-width` / `--dsw-focus-ring-color`) instead of a hard-coded outline.
  `focus.css` of the Host suppresses an outline under pointer modality at a higher
  specificity than our rule, so the previous ring could paint transparent after a mouse
  click; taking the tokens is what the first-party cards do.

  Nothing about the settings themselves moved. The row seat stays keyed
  `@yadsh/dsh-model-safety-gate#dsh-model-safety-gate`, and that key is also the namespace
  the Host resolves the volatile Config under, so every value saved before this change
  still reads back and writes to the same path.

  Decided by the maintainer on 2026-10-01 as option 1 of the card-shell question in
  `docs/DSH-0.1.7-MIGRATION.md` §4.3; the same change is being applied to the other plugin
  cards that register on this row.

  `@yadsh/dsh-plugin-kit` ships unchanged code — its shell and chevron stay for the cards
  that still own one — but its package gate now calls `verifyCanonicalShell` instead of the
  seat-aware dispatcher, because the kit publishes the shell that others inline and
  registers on no seat itself. The bump is for that gate change, matching how
  `shared-package-verify-gates` treated the same situation.

- The Safety Gate settings card is now addressable by a stable hook. ([#469](https://github.com/xarleyn/dsh-plugins/issues/469), [#428](https://github.com/xarleyn/dsh-plugins/issues/428), [#517](https://github.com/xarleyn/dsh-plugins/issues/517), [#514](https://github.com/xarleyn/dsh-plugins/issues/514), [#522](https://github.com/xarleyn/dsh-plugins/issues/522))

  Every section of the card — Gate, Input guard, Output stream, Tools and results,
  Classifier, Audit, Advanced, and the read-only Status and Recent verdicts views —
  carries a `data-testid`, as do its toggles, selects, inputs and textareas, the
  per-section reset, the status chips and counters, the banner of each state the
  card reports, and the cells of a verdict row. The ids are ASCII kebab-case under
  the `safety-` zone (`safety-gate-mode`, `safety-classifier-notice-remote`,
  `safety-audit-notice-raw-content`, `safety-gate-session-override`), 104 distinct
  values, none reused by a second kind of node. A state gets its own id rather
  than a shared one whose text differs. A repeated node of one template — a row of
  the verdict table — holds that template's id and no row index, while a counter
  tile, which counts a different figure from its neighbours, carries an id of its
  own. A browser check can now reach a control without reading its English
  label, the class of a banner, or a walk up to the enclosing `<section>`.

  Only attributes were added: the markup, the card shell and the rendered text are
  unchanged. The card's own suite finds its nodes by id now, and every assertion
  that was about a role or an accessible name stayed in place.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot
- xarleyn @xarleyn

## 0.2.6 (2026-09-22)

### 🩹 Fixes

- One helper builds the gate the tests exercise. ([89470e0](https://github.com/xarleyn/dsh-plugins/commit/89470e0))

  Every gate test assembled its own stub of the surrounding host, which is how a
  test quietly stops testing the thing it names: the helper now builds the gate
  the same way for all of them, so a surface the plugin gains is exercised by the
  whole suite rather than by whichever test remembered to add it.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.5 (2026-09-22)

### 🩹 Fixes

- A disposed gate stays disposed, even when its services resolve late. ([a3294a6](https://github.com/xarleyn/dsh-plugins/commit/a3294a6))

  `ctx.inject` resolves whenever the service appears — and a service can appear
  while the host is tearing the plugin down. Both injections ignored that: the
  tool runtime's callback pushed its two listeners into a disposer list that had
  already been emptied, so a reload left a gate deciding behind a plugin that no
  longer existed, and the settings provider's callback installed a namespace whose
  card would edit a gate that was gone. The same shape sat in `reapply`: a
  committed settings change arriving after disposal rebuilt the pipeline and
  re-opened a logger that had already been closed.

  Disposal is now a one-way door: the tool injection, the settings installation
  and the configuration rebuild each answer a disposed service by doing nothing.

- `enabled: false` and `mode: off` now silence the whole gate, not three surfaces ([38a8214](https://github.com/xarleyn/dsh-plugins/commit/38a8214))
  out of four.

  The master switch and the `off` profile were honoured on the streaming-output
  surface alone. An off gate still scanned every user prompt, every tool call and
  every tool result, still ran the classifier when one was configured (one model
  request per prompt, since the input surface asks for a classifier call on every
  check), and still wrote its audit records — it only declined to act on what it
  found. A deployment that had turned the gate off paid the cost and kept the log
  of a running gate, and `mode: off` could still reject a prompt through the input
  surface, because the mode cap table did not know the value and passed a `block`
  straight through.

  Every surface now asks the same question — is this gate off? — before it does
  anything else, and returns the call untouched when it is. The input surface also
  honours its own `input.enabled` switch, which the schema accepted and the guard
  ignored, and a gate switched off at runtime through the settings card stops the
  very next check, without re-registering a listener.

- A blocked call no longer claims the user rejected it when nobody was asked. ([ce28d32](https://github.com/xarleyn/dsh-plugins/commit/ce28d32))

  The gate's tool-call guard escalates a call to `ask` when the turn's accumulated
  risk demands confirmation. That decision is not the gate's to keep: the tool
  runtime resolves it through the `approval` service, and the outcome vocabulary
  carries no reason — the runtime writes its own sentence, so a refusal reads
  `the user rejected tool "X"` and the categories the gate reported are dropped.
  On a session whose effective approval policy is `never` that is the only
  possible outcome, decided before any answerer runs.

  A locked-down deployment therefore turned every escalation into a phantom human
  refusal: the model learned that an operator said no, and never learned which
  rule fired. The gate now reads the same policy the approval service reads — the
  session's logged override first, else the deployment default — and refuses the
  call itself:

  ```text
  Blocked by dsh-model-safety-gate (unsafe_tool_intent): this call needs
  confirmation, but the session's approval policy is "never", so the request
  could only ever be refused without asking anyone
  ```

  Nothing about the outcome changes: under that policy the runtime's own answer
  was the same refusal, decided before any answerer could run. Only the sentence
  changes — it now attributes the refusal to the gate and keeps the categories.

  The read is deliberately narrow: only a policy the gate actually read can turn
  an ask into a refusal, so a host that composes no approval service, a session it
  cannot read, and a value outside the published vocabulary all keep the native
  ask. `tools.unanswerableAsk: ask` restores that flow for a deployment whose own
  gate answers asks ahead of the policy.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.2.4 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the output-stream quarantine integration test is split into a ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  domain file with shared helpers. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-09-15)

### 🩹 Fixes

- Keep plugin-specific records out of Harness session journals so sessions remain ([82d5890](https://github.com/xarleyn/dsh-plugins/commit/82d5890))
  readable after a DSH restart even when linked packages resolve separate module
  instances. Safety audit records now use the plugin logger with explicit session
  ids, QA source snapshots use plugin-owned durable storage, and the QA package
  ships a dry-run-first repair command for legacy journals with automatic backups.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-14)

### 🩹 Fixes

- Keep tool-call checks strictly observational in audit mode. Findings are still ([d50922f](https://github.com/xarleyn/dsh-plugins/commit/d50922f))
  scanned and recorded, but accumulated turn risk can no longer turn an audited
  tool call into an approval request or denial.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-13)

### 🚀 Features

- Add the operator surface the gate was missing: a settings card under ([dc86bcf](https://github.com/xarleyn/dsh-plugins/commit/dc86bcf))
  `Settings → Plugins → Plugin configuration`. The plugin now owns the live
  `model-safety-gate` settings namespace, so the card's sections — gate, input,
  output stream, tools and results, classifier, audit, and advanced patterns —
  re-resolve the running gate on the spot instead of requiring a restart, and a
  value the gate could not act on (a `dsh` classifier backend without a provider,
  an uncompilable custom pattern) is refused when it is written rather than
  stored and ignored.

  The card also reports what the gate is actually doing through the `safetyGate`
  Typert Remote: the effective mode, whether the classifier is genuinely wired,
  the process counters, and the last 50 sanitized verdicts. The classifier key is
  declared a secret slot and never returned to a browser, and the card states in
  place that an OpenAI-compatible classifier sends prompts, output, and reasoning
  to the endpoint it names.

  Configuration changes are live from either side. `ModelSafetyGate` now reads
  its configuration, pipeline, and scanner through a stable guard handle, so a
  committed settings write swaps the policy behind listeners the host already
  holds. `classifier.apiKey` is a `role("secret")` field; the internal audit
  record now carries only declared error codes.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  compatibility contract and README requirements move to
  `>=0.1.5-rc.2 <0.2.0`.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-10)

### 🚀 Features

- Add the two-layer safety gate: a deterministic L0 scanner plus an isolated ([96ec692](https://github.com/xarleyn/dsh-plugins/commit/96ec692))
  small-model L1 classifier now evaluate user prompts (`agent/pre-step`),
  streamed text and reasoning (`llm/stream` with buffered quarantine, rolling
  windows, and provider cancellation), tool calls (`tools/pre-execute` with
  native allow/ask/deny), and tool results (`tools/post-execute` feeding a
  per-turn risk state). Includes the strict verdict schema, classifier backends
  for a DSH provider/model pair or an OpenAI-compatible endpoint, timeout and
  failure modes (`closed` / `open` / `rules-only` / `ask`), monotonic safety
  merging that cannot be weakened by the model verdict, sanitized session-event
  audit with content hashes only by default, and safety counters.

### ❤️ Thank You

- xarleyn @xarleyn