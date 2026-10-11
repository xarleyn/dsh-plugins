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

### ❤️ Thank You

- qoder-bot
- xarleyn

## 0.5.0 (2026-10-04)

### 🚀 Features

- The settings card opens from the Plugins page now, as the configuration of its own row. ([#657](https://github.com/xarleyn/dsh-plugins/issues/657), [#530](https://github.com/xarleyn/dsh-plugins/issues/530))

  The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), the surface
  a plugin claims when the Host owns no place for its page. But this card edits exactly
  one thing — the bundle's own live Config — and `0.1.7` grew a surface for that: the
  Plugins page declares `plugins.row.config`, a keyed seat whose entry opens as the
  row's configuration section, under the page's own chrome. Registering there is the
  difference between a settings page whose name an operator has to know and a configure
  control on the row they were already looking at.

  The key is `@yadsh/dsh-doc-impact#dsh-doc-impact` — this package's name joined to the
  row id `cordis.patch.yml` declares. That join is what makes the move cheap and what
  makes it safe: the row id is the same string the Host has filed this plugin's volatile
  Config under since `#530`, so the namespace the page derives its form from and the
  namespace this card reads are one namespace. **Nothing about where values are stored
  changed**, and a mode, a template or a cap saved through the old tab is read back by
  this build. What did leave are the names of the surface the card stopped occupying:
  the tab's seat id, its `order` and its `label` — a keyed seat carries a `key` and
  those three belong to list seats — and the page titles the row from the row's own
  metadata (its `meta.title`, else the module name the patch names), so the label this
  entry used to hand the tab is now dead weight rather than a second title.

  What the card renders follows the seat, because the seat decides who draws the frame. On
  the row the page draws the card surface, the title, the row id and the expand control
  before it mounts this view, so the bundle renders a body: our shell, our 14×14 chevron
  and the `<ul>` that carried the shell's `<li>` are gone rather than nested inside the
  Host's card, which is the second frame next to a first-party row that this decision
  removes. The fields mount as soon as the row opens; the `unsaved` marker moved with the
  header that used to hold it and now stands beside Save and Discard. The staged drafts,
  the field-granular writes fenced by the revision read at the moment of writing, and the
  per-field reset to the composition layer are unchanged. An unresolved namespace no longer
  renders nothing: a card that owns its shell can stay invisible, while a body in the page's
  frame would leave the reader inside an opened row with no section and no reason, so it
  answers with one status line. And the focus ring is built from the Host's
  `--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, each with a fallback, on every
  control this bundle draws — the Host's `focus.css` suppresses a hard-coded outline under
  pointer modality at a specificity a rule of ours cannot answer without fighting it, and
  raising ours is the wrong repair.

  Three further details follow from the new seat rather than from a redesign. The seat is
  entitled to two views: `{ view: 'page', form }` for the
  configuration section, and `{ view: 'summary' }` for the row's one-liner. The second is a
  fallback, and for a published bundle it is normally not reached: the page writes
  `description ?? renderSlot(…)` into the row's `<p>`, and the row's description comes from
  the installed manifest's `description` field, which this package declares — as
  `docs/DSH-0.1.7-MIGRATION.md` §4.2 records at both render sites
  (`PluginManagerPage.tsx:495` and `:491`). The answer is kept because a row that declares
  nothing is owed one, and it is kept *equal to that manifest field*, so the same row cannot
  read one way from the inventory and another from its card; the two tests that drive this
  entry compare the reply against the manifest rather than against a copied literal, so a
  manifest edit reddens them instead of leaving the two sentences apart. What the entry does
  with the page view is pick a component per view where it registers, rather than returning
  early inside the card: that is what keeps each view its own hook order, and what keeps the
  one-liner a line of text that reads no settings state and mounts no element instead of a
  second live copy of the form in the page's heading. The card's own text
  still arrives through the translate function the page binds for the locale namespace this
  entry declares — and that is the only copy this entry used to hold itself: the tab's
  `label` was the one string this bundle translated outside the card, so the bundle stopped
  binding its own translator and the fallback dictionary it kept for that label went with
  it. The seat and the join key are spelled as literals in the registration call rather than
  reached through a constant, because the card contract reads which surface a bundle sits on
  off the built bundle, and a registration that names its seat in the call is the statement it
  can read; the same contract is what now holds this bundle to *no* shell, where it once
  required one.

  The seat hands over three things the entry used to spell by hand, and the manifest now
  carries the packages that say them: `@deepseek-ai/dsh-client-ui-plugin-manager` merges
  the row seat's owner contract into the slot table, `@deepseek-ai/dsh-client-ui-slots`
  composes the entry's props from it, and `@deepseek-ai/dsh-client-ui-renderer` is the
  half that assembles them at render time. All three arrive as peer and dev dependencies
  in the shape `dsh-model-safety-gate` (#653) already uses, and none of them is a runtime
  import: the card's props are now `PropsRuntime<"plugins.row.config"> & InjectFace<…> &
  PropsLocale<"dsh-doc-impact">` rather than an interface this package wrote, so the
  `view` discriminator, the page's `form`, the bound `useDocImpactCard` hook and the `t`
  seat are read from the declarations that hand them out. That closes the question this
  review round kept open — whether the page really delivers a translator to a keyed seat.
  It does, and not by hope: the renderer synthesizes `t` for exactly those entries whose
  registration declares a `locale:` namespace, and refuses the slot assembly with a
  `SlotAssemblyError` when no locale face stands (`dsh-client-ui-renderer/lib/client.js`,
  `standardKit`). A fallback translator would therefore be unreachable code standing in
  for a failure the Host already reports, so the entry takes `t` as the definite prop the
  composition says it is, and the dictionary's keys are merged into `LocaleNamespaceMap`,
  which makes the key domain of `t` this card's own dictionary rather than any string.

  The browser half does now depend on the Plugins page existing, and says so —
  `compatibility.json` lists `plugins.row.config` among the required client features,
  which is why this is `minor` rather than `patch`: a browser on a host without that page
  loses the card. The losing is quiet, and that is the registration seam's doing rather
  than the card's: `slots.inject` runs its callback when the slot already stands and
  otherwise inside the declaring `register()` (`registry.d.ts`), so on a host that never
  declares this page the callback is never reached and the `register` that would throw on
  an undeclared slot is never called.
  `tests/client-bundle.test.ts` reads the seat key and the settings
  namespace from `cordis.patch.yml` rather than repeating them, so a row id that moves in
  the patch reddens the test instead of quietly dropping the configure control, and it
  drives the entry through both views the page asks this seat for — the page view mounting
  the body and reading settings exactly once, the summary view answering as text with no
  settings read at all. The page view is rendered with the page's own `form` prop present
  and poisoned on both of its halves, because the card deliberately takes nothing from it:
  the seat hands a `{ state, mutate }` whose `state` is one snapshot the page took while it
  rendered, and a card that has to follow a write it did not make reads and fences the
  document through the `ConfigForm` it resolves itself. The same test asserts the injected
  face carries no member named `form`, which is the sentence the previous paragraph
  argued for and nothing pinned until now: the renderer spreads the owner props after the
  face, so a face member of that name would be shadowed by the page's narrower form and
  the card would stop seeing its own without going red anywhere. The same file now records
  the calls the entry makes against the Host's services and holds that the dictionary is
  filed with the locale service under exactly the namespace the registration declares, and
  *before* the seat is handed over: the card keeps no fallback translator, so a
  `locale.register(…)` that went missing or moved behind the registration would show the
  operator raw keys — `enabledLabel`, `saveFailed` — while every string the bundle gates on
  still matched.
  `tests/client-render.test.ts` runs
  its field-by-field render through that registered entry as well as through the card, so
  an entry that stopped forwarding the props the card draws with is a missing control on a
  screen, not a comment, and both files fail if the body grows a frame or a toggle of its
  own again.
  `scripts/verify-client-bundle.mjs` checks values, not the spellings of the constants
  that spell them: the slot literal, the full joined key the patch composes, the
  `view === "summary"` branch the page depends on, the Host's ring token on the
  controls this bundle draws, this package's own retired shell classes, and the absence of
  the `settings.plugins.tab` seat this card vacated. Whether the bundle carries a shell it
  no longer owns is the shared contract's rule to enforce, and it picks that rule from the
  seat it reads off the bundle — which is why the seat is named in the registration. Both
  that gate and the test now reach the patch through one parser, `scripts/patch-row.mjs`,
  which parses the YAML instead of matching it and requires the one row every bundle patch
  in this repository declares: two copies of a first-`id:`-wins pattern were two chances
  for a second row to shift the key out from under a check that would still have gone
  green.

  One thing the card does differently from the first card on this seat. `#653` claims its
  row unconditionally; this bundle used to claim its seat only while
  `configForms.whileServed([SETTINGS_NS], …)` reported the namespace served, and it now
  claims it unconditionally too. The watch is built for a page editing a namespace
  *another* plugin owns — its callback fires from the `settings.describe` mirror — and that
  mirror answers `unavailable` as the terminal state of a non-loopback page, where the
  settings directory is deliberately not exposed. So gating on it hid the row's configure
  control in exactly the browser AGENTS.md names for a card seated on the Plugins panel
  ("keeps answering from a non-loopback browser, where the settings directory is
  intentionally unavailable … disable the write controls instead of hiding the card"). Per-
  namespace reads do not pass through that directory: `get` answers a form for any entry
  id, and the form's own snapshot says whether a document stands under it, which is where
  the body already answers — a status line for a namespace nothing resolved, disabled
  controls for a connection that keeps preferences process-local. `tests/client-bundle.test.ts`
  holds this by never serving the namespace and expecting the seat anyway.

  What the acceptance rests on, and what it does not. "The card opens from the Plugins panel
  and saves" is proven by the built bundle and by the two tests that drive the entry it
  registers — the seat key, both views, one settings read — and by a value read back under
  the same namespace it was written in before the move. It is not proven by a click on the
  operator's stand, and on a locked QA stand it cannot be: that page calls
  `pluginInventory/list` and `pluginManager/listBundles|listPlugins`, and all three answer
  403 there, because `pluginManager` also exposes `inspect`/`installBundle`/
  `setPluginEnabled` to the remote surface, and opening those is the owner's call rather
  than a plugin's (`docs/DSH-0.1.7-MIGRATION.md` §4.3). The focus ring is answered the same
  way — in code, every control this bundle draws taking the Host's token pair with a
  fallback on each half — and a browser still has to confirm it.


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

- A pending impact of a rule that left the configuration stops interrupting the turn. ([#364](https://github.com/xarleyn/dsh-plugins/issues/364))

  `ImpactState.reconcile` retired a pending record only when its rule was still
  present in the fresh detection. That covered the rule that changed shape — the
  new fingerprint replaced the old one — but left the other case unhandled: after
  the operator switched the rule off (`enabled: false`, or `disabledRules` in
  `.dsh/doc-impact.local.yml`) or deleted it, nothing produced that impact any
  more, so it stayed pending for the rest of the turn. The turn kept getting
  steered to update a document no active rule asks about, the reminder rounds
  were spent on it, and the status command and the resolve tool went on listing
  a rule the workspace no longer has.

  The retirement condition is now the detection itself: a pending impact that the
  current rules do not reproduce becomes `superseded`, whichever reason removed
  it. Because the rule is gone, no resolve call and no edited target can satisfy
  it, so the alternative to retiring it is interrupting the turn forever.

  Switching the rule back on within the same turn resumes the impact. A
  reappearance of the same fingerprint means the same detection is current again,
  so `reconcile` adopts the fresh record instead of keeping the retired one —
  while a status the agent or the operator earned (`updated`,
  `reviewed-current`, `not-applicable`) still survives, exactly as it did before.
  The end-to-end test switches a rule off mid-turn and reverts the file, which is
  the sequence the previous behavior got wrong in both directions.

- `changeDetection.maxSnapshotFiles` bounds the reading a snapshot does, not only ([#349](https://github.com/xarleyn/dsh-plugins/issues/349))
  the report it prints.

  The limit was applied to the list of dirty paths after every one of them had
  already been read and hashed, so a turn in a workspace with a large dirty tree
  paid for the whole tree while the card reported a capped, degraded snapshot.
  The cap now stops the work: paths are read in the sorted order the report
  already used and reading stops at the limit, which makes a degraded snapshot
  the same bounded prefix across the two captures of a turn instead of a full
  read followed by a different trimmed list.

  Resetting a text or number field in the settings card drops the override
  instead of writing the current base into it.

  Reset staged the value the field would fall back to, and Save committed that
  value as a user override. The card showed a reset field while the layer behind
  it kept a new override: a later change to the composition base — the entry
  config or the value the host declares — no longer reached the field, because
  the number the reset had just written kept winning. Reset now means one thing
  for every field kind, templates and selects included: the user layer loses the
  key and the field follows the base again.

- The settings card edits a 0.1.7-rc.2 host's live configuration, and its reminders name their own producer. ([#530](https://github.com/xarleyn/dsh-plugins/issues/530), [#508](https://github.com/xarleyn/dsh-plugins/issues/508), [#531](https://github.com/xarleyn/dsh-plugins/issues/531), [#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#512](https://github.com/xarleyn/dsh-plugins/issues/512), [#519](https://github.com/xarleyn/dsh-plugins/issues/519), [#523](https://github.com/xarleyn/dsh-plugins/issues/523))

  The host rewrote its settings subsystem under this release: a namespace is no
  longer a section a plugin installs but the profile entry id the loader already
  gave the plugin, and a field is editable without a remount exactly when its
  schema node is marked volatile. The plugin therefore declares its `Config` — the
  same nested document a profile patch row already carried (SPEC §37), so an
  operator's existing profile lines are untouched — with every card field on a
  volatile node, and reads one plain snapshot per operation instead of merging an
  entry config under an installed section. A change saved in the card now moves the
  running behaviour directly: the reminder text, the strictness mode, the steering
  switch, without the second document the old registration kept.

  The namespace an operator edits is the entry id `dsh-doc-impact` rather than the
  `doc-impact` label the deleted settings section carried, so values saved through
  the old card do not migrate; the profile patch remains the base they fall back to.

  The card was registered into `settings.plugin.item`, and that slot no longer
  exists. Following the owner's decision on the card shell (D1, option 2), it is a
  tab of the Settings → Plugins page now, where it keeps the shared card shell and
  edits the same document through the host's configuration form — a field is
  addressed by where it stands in the document (`defaults.mode`,
  `changeDetection.maxSnapshotFiles`), written with the revision read at the moment
  of the write, so a stale view cannot overwrite a newer one. Clearing a field
  still re-inherits the composition layer instead of freezing today's value, and a
  read-only browser still gets disabled controls plus the notice that says why.

  The steered reminder message was attributed to a catch-all `plugin` source kind
  that rc.2 does not define, which was the package's one compile error. The plugin
  now declares `doc-impact` as its own producer kind and keeps the `notice` form it
  already used, so the row in the transcript reads as before.

  `Session.snapshotEvents` reads are kept: the host marks them deprecated without a
  replacement for a fold over the whole event log, which is what resolving the
  current turn is (see the migration map, §5).

- The settings card reads a settings document that is not what its fields promise ([#497](https://github.com/xarleyn/dsh-plugins/issues/497))
  without showing a value it cannot edit.

  The card edits ten fields through one nested namespace document, and until now
  the address of each field, the kind of control it draws and the draft it may hold
  were carried by untyped values: `any` at the read, `any` at the staged operation.
  A staged `clear` for a text field and a staged text for a choice field looked the
  same to the compiler, so the mistake an edit could introduce would only show up
  when Save wrote it. Every field now carries one discriminated spec — its kind
  decides the draft the field can stage, and the draft decides the value type — so
  an operation that cannot belong to its field stops at the type check instead of
  reaching the Host. The faces the form reaches the Host through are the settings
  package's own types now, not a mirror written out by hand: nothing could check
  such a mirror, since the client entry declares its own context, and this one had
  already lost the `mode` the Host puts in every snapshot and the `set`/`unset` it
  answers with. The package is declared as a peer dependency for that type check;
  the shipped bundle still requires nothing but react, because the import carries no
  value.

  Two readings of the Host document became honest readings. The document is raw
  profile JSON, and the field specs only describe its shape: where a field promises
  a scalar and the layer holds an object or an array instead, the card now shows the
  default the field would fall back to rather than carrying that node into the
  field's value (an unchecked cast used to do the latter). A choice additionally
  refuses a value outside the vocabulary its spec offers: such a value used to reach
  the select, which then has no `option` to mark selected and reads back as an empty
  box — so the operator saw nothing where the Host held a string. The field now
  stands on its fallback like any other unset one, keeps its override badge, and can
  still be written over. And the Host hands out a settings form for any name asked
  of it, served or not, so the card asks the service that knows instead: the tab is
  claimed only while the namespace is served, where before it was claimed
  unconditionally and an unserved namespace left an empty tab on the Plugins page.

  What the card writes is unchanged. Drafts still never write before Save, Save
  still commits field-granular path operations in staging order, a save that did not
  land keeps its drafts, and a reset still drops the user layer instead of copying
  the composition base into it — that last one is now pinned for every kind of
  field, and the defaults and vocabularies the card repeats are pinned against the
  plugin's own configuration schema. Which field the card draws is pinned too: every
  spec must reach exactly one control of the kind it declares, and a default the card
  repeats by hand has to be the one its spec carries, so a field that joins the
  schema and the specs without joining the screen is now a failing test rather than
  an invisible gap.

  One thing the entry owed and did not keep. The Host answers a disposer for the
  watch on a namespace and for the listener on the settings controller, and the entry
  threw both away as soon as they were handed to it, keeping nothing to roll back on
  teardown. It now answers the rollback the client contract asks for: the watch and
  the card's listener are ended together, and a test over the built bundle holds the
  Host to the shape it declares — the tab is gone and the controller has no listener
  left after the entry is disposed.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.4.1 (2026-09-22)

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

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-21)

### 🚀 Features

- The steering messages and the steering itself are operator-configurable. ([f946a3d](https://github.com/xarleyn/dsh-plugins/commit/f946a3d))

  The reminder the plugin steers into the turn and the final limit notice were
  literal strings in the source, so rewording one meant editing the package.
  Both texts are now settings: `reminderTemplate` with the `{intro}`, `{count}`,
  `{body}` and `{tail}` placeholders (the generated impact list stays `{body}`
  and is required), and `limitTemplate` with `{rounds}` and `{impacts}`. An
  empty template or one that dropped the required placeholder falls back to the
  built-in wording, which reproduces the previous messages exactly, and the
  settings card edits both texts in textareas with the placeholders documented
  inline.

  The new `steer` switch (default `true`) stops the plugin from steering
  reminders while everything else keeps working: impacts are still detected and
  reported through the tools and `/doc-impact`, reminder rounds are not spent,
  and re-enabling starts from a clean slate instead of instantly hitting the
  round limit.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: the client-bundle gate now asserts the ModuleLoader registration (window.__ModuleLoader__.load) explicitly next to the factory id. No runtime changes. ([73113f3](https://github.com/xarleyn/dsh-plugins/commit/73113f3))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.2 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.1 (2026-09-13)

### 🩹 Fixes

- Fix the settings card never mounting in the web UI. The 0.1.5 client ([39d397b](https://github.com/xarleyn/dsh-plugins/commit/39d397b))
  runtime exposes only the services a module declares in `inject`, and the
  client bootstrap still read `settingsScope` and `locale` through the
  0.1.1-era `ctx.get` indirection, saw them as absent, and silently skipped
  the `settings.plugin.item` card registration. The services are now
  declared and read as context properties like every other card.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-12)

### 🚀 Features

- Port to the DSH session format v3: the tool context now derives from the ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  host ToolRunContext and reads the raw log via session.snapshotEvents()
  instead of the removed session.events. The supported host range moves to
  >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.4 (2026-09-06)

### 🩹 Fixes

- Prevent slot mutation while inference streams are active, validate llama.cpp ([f97114e](https://github.com/xarleyn/dsh-plugins/commit/f97114e))
  management responses, use the shared DSH home, make correction truncation
  Unicode-safe, bound miner retention and pending state, restore strict host
  type checking for session scope, pause UI polling in hidden tabs, and align
  published package metadata, compatibility declarations, and build lifecycle
  gates.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.3 (2026-08-31)

### 🩹 Fixes

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

- Build the browser client from TypeScript with tsdown while preserving the ([3e0ac46](https://github.com/xarleyn/dsh-plugins/commit/3e0ac46))
  classic ModuleLoader bundle and plugin settings-card contract.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn