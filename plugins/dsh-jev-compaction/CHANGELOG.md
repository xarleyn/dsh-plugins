## 0.2.0 (2026-10-04)

### 🚀 Features

- The settings card opens from the Plugins page now, from the row of the plugin it configures. ([#654](https://github.com/xarleyn/dsh-plugins/issues/654), [#646](https://github.com/xarleyn/dsh-plugins/issues/646))

  The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
  where a plugin puts a page the Host does not own. This card edits exactly one
  thing — the bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
  page declares `plugins.row.config`, a keyed seat rendered on the bundle's page as
  the configuration section that the row's own configure control opens. The page
  draws the heading of that section itself: the contract heads the entry's page with
  the plugin's display title and description, and the row's title resolves out of the
  row's Host-supplied metadata with the row's full module specifier as the final
  fallback (`presentation.d.ts`, `rowText`). This bundle's `cordis.patch.yml` declares
  an `id` and a `name` and no title, and the row's module is the package itself, so the
  words above the card are `@yadsh/dsh-jev-compaction` — the host's fallback rather than
  text this card supplies. Making that heading human-readable is package metadata's
  job, which is the route `#675` opens; it is not a card edit.
  Registering here is the difference between a settings page a user has
  to know the name of and a configure control on the row they were already looking
  at.

  The key is `@yadsh/dsh-jev-compaction#dsh-jev-compaction` — the package name joined
  to the row id `cordis.patch.yml` declares. That join is what makes the move cheap
  and what makes it safe: the row id is the same string the Host resolved this
  plugin's volatile Config under since `#515`, so the namespace the page derives its
  form from and the namespace this plugin reads are one namespace. **Nothing about
  where values are stored changed**, and a threshold, a provider or an archive knob
  saved by an older build is read back by this one; the tab's own seat id
  `dsh-jev-compaction` and its `label`/`order` were the only names left behind, and
  they named nothing but the seat.

  What the card renders is the body of a card the page frames, and the same controls, the
  same write-on-change behavior and the same rule that the API key never crosses to the
  browser. A row on the Plugins panel sits inside the page's own card: the page paints the
  surface (a 20 px `--dsw-radius-xl` one), the row title, the row id, the module name and
  the description line, and mounts the registrant's `page` view under them. This bundle
  drew a second card inside that — a 12 px rounded rectangle with our heading, our
  chevron and a show/hide button duplicating the page's own toggle — which is the nesting
  `#646` was opened for and the maintainer settled on 01.10 as option 1 of
  `docs/DSH-0.1.7-MIGRATION.md` §4.3, in the line as `#684`. `CardShell` and the
  plugin-owned `<ul>` that kept its `<li>` a list item are gone, the header badge that
  summarized the same enabled and shaping state the status block carries went with the
  header, and the configuration sections mount directly.

  The focus rings of the controls this plugin paints come from the Host's design system
  (`--dsw-focus-ring-width` / `--dsw-focus-ring-color`) rather than a hard-coded outline,
  and each half carries its own fallback: an undeclared token invalidates the whole
  `outline` shorthand, so the ring would disappear instead of degrading, while a hard-coded
  outline of our own loses to the Host's `focus.css` under pointer modality at 0-3-2 against
  our 0-2-0 — raising specificity to win that fight is the wrong repair, and no rule here
  raises it. Every control the bundle renders gets the ring, not one of them: the fields,
  the toggle, the chip-remove button, the buttons, and the Advanced disclosure.

  Which seat a configuration card belongs in is answered — `AGENTS.md` names the row
  seat as the registration point since `#660`, and this card had been sent
  to the Settings dialog by the rule that text replaced. What the move does prove is that
  enforcement survives it: `scripts/verify-package-hygiene.mjs` has fired the card contract
  on `plugins.row.config` since `#510`, and since `#684` the half that contract applies is
  decided by the seat the *built bundle* registers on — the shell it requires of a
  settings-surface card is exactly what it forbids on the row. That is why the seat is now
  stated as a literal inside the `slots.register` call instead of behind the
  `SETTINGS_CARD_SLOT` constant it used to sit in front of: a constant still resolves, but a
  positional registration leaves the gate falling back on every seat name the bundle quotes,
  where a surviving comment could decide the contract after all. Stating it in the call is
  what keeps the row's half of the contract in charge of this bundle. The failure
  `docs/DSH-0.1.7-MIGRATION.md` §10 records — enforcement keyed off one slot literal, so a
  card that renamed its seat used to fall out of the contract quietly — was closed by `#510`
  and is now closed by the seat-aware gate itself.

  Three details follow from the new seat rather than from a redesign. The page hands its
  registrant a `ConfigPageForm`, which is `{ state, mutate }` — no subscription, no
  single-field read — so the card keeps resolving its own `ConfigForm` through
  `configForms`. That form arrives through the injected face under the name
  `settingsForm`, which the slot's own owner prop cannot collide with, and the entry no
  longer declares `form` in its props at all: a prop the code accepts and ignores reads
  as a card that binds to the page's values but does not. The seat also accepts the entry
  as `view: 'summary'`, the row's one-liner, and asks for it only when the row carries no
  display description of its own: that description is Host inventory data, resolved out of
  the row's supplied metadata (`presentation.d.ts`, `rowText`), so nothing in this bundle
  decides whether the fallback ever fires and this change neither claims nor needs that
  answer. What the bundle owns is the answer's shape — the sentence, never a second body —
  and two tests pin it, one against the entry and one against the compiled bundle. The
  sentence lives in `JEV_COMPACTION_ROW_SUMMARY`, exported so the bundle test compares the
  compiled answer against the source rather than against a copy of it. And with no header of
  ours left to hide, an unavailable namespace no longer renders nothing: a card that owns its
  shell can stay invisible, while this one sits inside a row the page has already expanded,
  so leaving its section empty would tell the reader nothing. It answers with the line that
  says why no values show.

  The manifest followed the surface: the client half type-imports the Plugins page's
  slot contract instead of the settings-plugins one, so
  `@deepseek-ai/dsh-client-ui-plugin-manager` replaces
  `@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
  entry — which is why this is `minor` rather than `patch`: a browser running a host
  without the Plugins page loses the card, and `compatibility.json` says so, its
  required client features naming `plugins.row.config` where it named
  `settings.plugins.tab`. `scripts/verify-package.mjs` asserts the new pair (the seat named
  inside the bundle's `name:` and the `@yadsh/dsh-jev-compaction#` key prefix in the shipped
  bundle, the new package in the inject list) and then runs the shared card contract over
  `lib/client.js`, which on this seat means the bundle must carry no `dsh-plugin-card`
  class, no chevron path, and a ring built from both Host tokens. The client tests now
  cover the seat from both sides: the keyed registration and the namespace it resolves, the
  card rendered out of the registration with a decoy `form` handed to the seat whose `mutate`
  is watched — arriving after the injected face, which is the order the seat really renders
  its owner props in — which pins that the writes go to the injected `settingsForm` and not
  to the page's form, the body mounted with no expand step and no list item or disclosure
  control of ours around it, the `summary` view answering with the sentence and no body, once
  out of the entry and once out of the compiled `lib/client.js` against a section that serves
  no values at all, and — against that compiled text — the seat named inside the registration
  and the shell and chevron absent from it.
  The plugin's own design docs moved with the card: `docs/specs/result-shaping.md` and
  `docs/RESULT_SHAPING_SPIKE.md` still described the browser seat as
  `settings.plugin.item` — a slot `0.1.7` deleted, so a reader following them registers
  into a surface the compiler rejects — and named the namespace by the pre-`#515`
  `jev-compaction` spelling rather than the entry id the Host actually serves,
  `dsh-jev-compaction`.

- The settings card edits the plugin's own configuration, and lives in a Plugins tab. ([#515](https://github.com/xarleyn/dsh-plugins/issues/515), [#508](https://github.com/xarleyn/dsh-plugins/issues/508), [#509](https://github.com/xarleyn/dsh-plugins/issues/509), [#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#510](https://github.com/xarleyn/dsh-plugins/issues/510), [#513](https://github.com/xarleyn/dsh-plugins/issues/513), [#514](https://github.com/xarleyn/dsh-plugins/issues/514), [#516](https://github.com/xarleyn/dsh-plugins/issues/516), [#524](https://github.com/xarleyn/dsh-plugins/issues/524))

  Before `0.1.7` a plugin held its configuration twice: the profile entry the
  runtime read, and a separately installed settings section the browser card wrote,
  glued together by `installSection` callbacks that pushed one into the other. The
  rewrite deleted that seam — `ctx.settings` is now `SettingsForms`, with no section
  to install — and unified the two: a field is editable live exactly when its
  schema node carries `.volatile()`, and the namespace the Host serves it under is
  the plugin's own profile entry id.

  So the thirty-one fields this card edits are volatile now, the plugin reads one
  detached snapshot of them at the start of each operation instead of keeping a
  copy, and a committed change reaches the running plugin through
  `loader/volatile-update` rather than through an `onChange` hook the plugin handed
  to the Host. The section install is gone, and what replaces it is the presentation
  choice the Host stopped making for us: the plugin declines the automatically
  generated page, because it ships a card of its own.

  Two visible consequences. The card is a tab of **Settings → Plugins** now, since
  the `settings.plugin.item` slot it registered in was deleted; it keeps our shell
  (decision D1 of the cutover). And the stored namespace is `dsh-jev-compaction`,
  the entry id from `cordis.patch.yml`, instead of the invented `jev-compaction` —
  a user override written under the old name is not carried over, because the Host
  never stored it in the place the new model reads from.

  The card's write path is otherwise the same card: the same controls, the same
  per-field override markers and resets, the same claim that only the *name* of the
  API key variable crosses to the browser. `ConfigFormSnapshot` exposes the three
  layers `SettingsScope` did, so the card body kept its reads and swapped only the
  mutation call.

  The block taxonomy moved too, and this part the compiler was willing to describe.
  A `tool/result` message no longer wraps its blocks in one tool-result block: the
  blocks sit directly under the message and the call identity and outcome flag
  became message fields, which simplifies the single-node replacement the plugin
  writes. The `0.1.7` host also started *emitting* `tool-addition` and
  `tool-removal` blocks, and no type error announces those: a replacement built
  from the first block alone could silently discard a registry change. A new test
  records why it cannot — the Host admits those blocks on developer messages only,
  so they are unreachable from the mutation domain — and another that a developer
  message sitting on the surface is skipped by collection and state building rather
  than misread.

  Separately, the backend-mode entry now forwards `headroomTokens` to the compaction
  engine it extends. Its `Config` is deliberately `z.any()` — the inherited schema
  would strip the companion sections — which meant a key that belongs to the
  inherited engine was unreachable in a profile. `0.1.7`'s engine validates the
  headroom against the routed model's context window, so a small-window deployment
  could no longer compact at all and had no way to say so.


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

- The plugin's configuration is a directory now, and a reader can walk it instead of scrolling it. ([#427](https://github.com/xarleyn/dsh-plugins/issues/427), [#292](https://github.com/xarleyn/dsh-plugins/issues/292), [#515](https://github.com/xarleyn/dsh-plugins/issues/515))

  `src/config.ts` had grown to 1347 lines: presets, both shapes, the shipped defaults, the clamping primitives, the resolver, the live-configuration helpers and the schema — one file the line budget had been warning about since the threshold moved. It is now `src/config/`: `constants.ts` (endpoint presets, the default-shaped tool names, and the literal unions derived from those same tuples), `types.ts` (the raw and the resolved shape, plus the live one), `defaults.ts`, `validation.ts` (the clamping primitives), `resolve.ts` (normalization), `live.ts` (detaching the loader's volatile references) and `schema.ts` (the Schemastery schema). `index.ts` is the barrel.

  The move is line-for-line. Every declaration body is what it was, including the resolver, which was explicitly not rewritten — the only delta is which lines say `export` and which file a name is imported from. Visibility follows the boundary rather than the old file: `detach` and `LiveNodes` never leave their module and stayed private, the clamping primitives are consumed by the resolver and are exported from `validation.ts`. The barrel hands out exactly the names the old file did.

  What is unchanged is the whole contract: `src/index.ts`, `src/service.ts` and the browser card import the same identifiers, the schema validates and defaults exactly as before, and `package.json` `exports` never named the old path, so no consumer of the published package calls anything differently. The tarball does carry the new shape — `lib/config/` in place of the single `lib/config.js` — which is the only thing a release diff can point at. Hence `patch`.

- The settings card names its own markup, so a test stops depending on its wording. ([#470](https://github.com/xarleyn/dsh-plugins/issues/470))

  Every control the card renders now carries a `data-testid`: the five sections,
  the status read-outs (enabled, provider, model, mode), each toggle, number
  field, select and text field under the settings path it writes, the Advanced
  disclosure, the two archive warnings, the read-only notice, each field's own
  override mark and the Reset overrides button. The ids are ASCII kebab-case under
  the card's own `jevc-` zone and unique in the package; the tag-list control
  derives `-list`, `-tag`, `-remove`, `-add` and `-empty` from the id of the list
  it belongs to, so the two tool lists on the card never claim the same hook.

  Nothing about the card changed for a reader. Only the attribute was added — no
  class, no copy, no layout, and the shell contract from `AGENTS.md` (the
  `dsh-plugin-card` BEM classes, the SVG chevron, the design tokens) is exactly as
  it was. The `id` attributes the labels point at stayed, so a screen reader still
  names each field by its caption.

  The card's own tests were the reason: they reached a field through its English
  caption, its placeholder or a positional index over the two Add buttons, so a
  reworded label failed a test that had nothing to do with the label. They now go
  through the id, and the helper that resolves one still asserts that the caption
  labels that very node — the accessibility wiring stays under test, only the
  locator is stable.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.1.1 (2026-09-22)

### 🩹 Fixes

- A missing-credential key stays one key, and the file stays text. ([0a70f14](https://github.com/xarleyn/dsh-plugins/commit/0a70f14))

  The dedupe key for "this provider has no credential configured" joined the
  provider and the variable name with a literal NUL byte, which made git treat
  `service.ts` as binary — no diff, no review — and the separator is now written
  as an escape. The key a running plugin compares is unchanged, so a deployment
  that already reported the missing variable once still reports it once.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-21)

### 🚀 Features

- New plugin: Jev-powered, replay-safe semantic pruning of stale tool results. On `agent/pre-step` — at a configurable context pressure — historical `tool/result` surface nodes are scored by the Jev decision model and replaced through replay-safe single-node replacements (truncated head/tail or a neutral stub), while conversation text stays verbatim and the original full results remain in the append-only session log. Includes `/jev-compact` and `/jev-compact --dry-run` commands, automatic pressure triggering with cooldown and a minimum-savings gate, strict response validation with fail-open behavior, a fake decision backend for tests, and decision-endpoint presets (TypeSafe System One, a local System One-compatible server, or a custom endpoint). A `./backend` entry extends `BasicCompactionEngine` to provide the `ctx.compaction` service itself — semantic pruning runs at the early threshold and the conventional summary above `summaryRatio` — while `/compact` and overflow recovery keep working through the official seam. Ships a twelve-scenario offline evaluation corpus (`pnpm run eval`) with a zero-dangerous-prune release gate. ([b69409f](https://github.com/xarleyn/dsh-plugins/commit/b69409f))
- Immediate result shaping and a real settings card. On the `tools/post-execute` waterfall — before DSH persists the final `tool/result` — large repetitive command output is reduced to the lines that still matter: the text is segmented into line shapes, the head, tail, conclusions, failures and diagnostics are pinned, contiguous repetitive runs are classified by Jev with two questions ("is this routine repetition", "would removing it materially hurt the next decision"), and a run collapses only when both answers are decisively apart. Shaped text keeps its original ordering and is marked with neutral facts ("collapsed 97 repetitive lines"), never a claim that the output was irrelevant. The layer is opt-in and off by default, leaves errors untouched, skips results another layer already bounded, preserves every other post-execute decision (blocks, value replacements, additionalContexts), and fails open on timeout, transport error or cancellation. ([eca8de0](https://github.com/xarleyn/dsh-plugins/commit/eca8de0))

  Because shaping happens before persistence, the original rendered result is not recoverable from session replay; a content-addressed archive (sha256, deduplicated, retention window and size ceiling) keeps it by default, and turning the archive off while shaping is on is answered with a visible warning rather than silence. Historical compaction recognizes already-shaped results, leaves their markers alone, and carries the archive reference into a later stub.

  The plugin also gains a first-class settings card: **Settings → Plugins → Jev Compaction** edits the plugin's `jev-compaction` namespace through the host settings service — enable/disable, the shaping thresholds and tool allow/deny lists, the archive policy, the historical thresholds and the decision endpoint — applying to the running plugin without a restart and marking which values the user layer overrides. The card never receives an API key: it edits the name of the environment variable holding it. Configuration is documented in full in `docs/configuration.md`, and the API findings behind the layer are recorded in `docs/RESULT_SHAPING_SPIKE.md`.


### 🩹 Fixes

- A self-hosted backend is reached again, and an unset key is reported at startup. ([503cbc3](https://github.com/xarleyn/dsh-plugins/commit/503cbc3))

  `decision.<provider>` — the shape the README documents and the profiles use —
  was shadowed by the legacy flat `jev` block. The settings service hands the
  resolver a configuration with every shipped default filled in, so that block
  was always present, and `resolveEndpoint` let it win over the provider: a
  deployment configured for a local System One server on `decision.jeff.*` asked
  for `TYPESAFE_API_KEY` and refused every prune with "is not configured" before
  a single request left the host, while the local scorer sat idle. The legacy
  block is now an override only for values that differ from the shipped defaults,
  so it still serves deployments that wrote it and stops shadowing the provider
  they selected.

  Two smaller things around the same failure: a base URL that names only a host
  (`http://jeff:8000`, which is what the preset, the README and a deployment's
  own row said) is completed with the `/v1/systemone` route the System One
  contract defines — the client POSTs to the configured URL as it stands, so a
  bare host used to answer `404 Not Found`; and a backend whose key variable is
  empty at startup is reported once in the plugin log
  (`jev-compaction/credential-missing`, with the provider, the variable and the
  endpoint), because the environment is not part of the configuration and the
  first symptom would otherwise be a prune refused minutes later. The refusal
  itself now names the backend and the endpoint it tried to reach.

### ❤️ Thank You

- xarleyn @xarleyn