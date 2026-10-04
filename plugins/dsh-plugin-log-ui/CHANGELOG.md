## 0.5.0 (2026-10-04)

### 🚀 Features

- The logging settings open from the Plugins page now, next to the plugin they ([#651](https://github.com/xarleyn/dsh-plugins/issues/651), [#646](https://github.com/xarleyn/dsh-plugins/issues/646))
  configure, inside the page's own card rather than a second one.

  The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
  where a plugin puts a page the Host does not own. But this card edits exactly one
  thing — the bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
  page declares `plugins.row.config`, a keyed seat whose entry opens as the row's
  configuration section, headed by the page's own chrome. Registering there is the
  difference between a settings page a user has to know the name of and a configure
  control on the row they were already looking at.

  The key is `@yadsh/dsh-plugin-log-ui#dsh-plugin-log-ui` — the package name joined
  to the row id `cordis.patch.yml` declares. That join is what makes the move cheap
  and what makes it safe: the row id is the same string the Host resolved this
  plugin's volatile Config under since `#521`, so the namespace the page derives its
  form from and the namespace this plugin reads are one namespace. **Nothing about
  where values are stored changed**, and a level or format saved by an older build is
  read back by this one. The tab left three names behind — its seat id `plugin-log`,
  the `<ul>`'s class `plu-tab`, and its test id `log-tab`, now `log-card-section` — and
  none of them named a stored value.

  What the bundle renders on that seat is the body, not a card. The page draws the
  surface, the row title, the row id and the description line before it mounts an
  entry, so the shell this card carried — its `dsh-plugin-card*` classes, its header
  with the chevron, and the plugin-owned `<ul>` that header's `<li>` needed — is gone,
  together with the disclosure a user found inside the page's own expander. That is
  decision D1 of §10 of `docs/DSH-0.1.7-MIGRATION.md`, reversed to "as the host does"
  on 01.10 and landed through `#684`; the gate reads the seat off the built bundle and
  holds a row card to the opposite half of the shell contract, so the classes that a
  settings-surface card must show are the ones this bundle must not. What the chrome
  used to carry still has somewhere to live: the live consumer count rides the heading
  of the list it counts, and a namespace that answers `unavailable` says so in one
  sentence instead of leaving an already-opened row with nothing in it.

  The controls keep their behaviour and change their ring. Focus comes from the Host's
  `--dsw-focus-ring-width` and `--dsw-focus-ring-color`, each half with a fallback: a
  hard-coded outline of ours loses to the page's `focus.css` on specificity (0-3-2
  against 0-2-0) under pointer modality, so the ring vanishes after a mouse click, and
  raising specificity is the wrong repair — while a token without a fallback drops the
  whole declaration where the Host has not declared it. Every control this package
  draws takes the pair, the settings selects and the log panel's level chips, action
  buttons, source filter and search field alike. While the namespace is unreachable the
  panel no longer polls the registry either: the body that state renders shows the
  reason, and nothing reads what the poll returns.

  Two details follow from the new seat rather than from a redesign. The page hands its
  registrant a `ConfigPageForm`, which is `{ state, mutate }` — no
  subscription, no single-field write — so the card keeps resolving its own
  `ConfigForm` and that form arrives through the injected face under the name
  `settingsForm`, where the owner prop called `form` cannot shadow it. The same entry
  is also *offered* a second render, as `view: 'summary'`: the contract lets a row
  that declares no description fall back to its seat for the page's one-liner, and the
  seat's published contract names exactly the two `view` values this card answers. This
  bundle never takes that offer — the row's description
  comes from the installed manifest's `description`, which the package declares — so
  the answer is kept equal to that field and the body is mounted only for `page`.

  The manifest followed the surface: the client half type-imports the Plugins page's
  slot contract instead of the settings-plugins one, so
  `@deepseek-ai/dsh-client-ui-plugin-manager` replaces
  `@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
  entry — which is why this is `minor` rather than `patch`. The `inject` entry is an
  activation dependency of the whole client bundle, not of the card alone: a host
  without the Plugins page loses the panel too, exactly as the settings-plugins entry
  it replaced coupled both to that page. `compatibility.json` says which feature is
  required, naming `plugins.row.config` where it named `settings.plugins.tab`.
  `scripts/verify-package.mjs` asserts the new pair (the seat
  literal and the `@yadsh/dsh-plugin-log-ui#` key prefix in the shipped bundle, the
  new package in the inject list and on the peer list) and now asserts the chrome the
  other way: the ring tokens present, and `dsh-plugin-card`, the chevron path, the
  left-over list class and the old tab seat all absent. The client tests cover both
  halves of the seat: the wiring suite asserts the keyed registration, the one
  resolved namespace, the form arriving under a name the slot cannot overwrite, and
  the ring each injected sheet puts on its controls; a rendering suite mounts the
  component `apply()` registered with the page's own two prop shapes, so a level and a
  format stored before the move are read back, a change is written through that
  namespace's form, and the body is caught arriving with no button, no chevron and no
  shell class of ours anywhere in the section. A third suite reads the seat out of the
  installed host package — both of its call sites, the `view` union, the key join, and
  the `description ?? …` guard that makes the `summary` call a fallback rather than the
  row's normal line — so the card's answers are pinned to the host that owns the seat
  instead of to a test that hands it the shape itself.


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

- A `redact` path hides the field from the console mirror and the live log panel, ([#341](https://github.com/xarleyn/dsh-plugins/issues/341))
  not only from the log file; the logger stops freezing the caller's object, and
  retention sweeps on every rollover instead of once per logger.

  Redaction used to be a property of the pino instance alone, so it guarded the one
  sink that serializes through pino. The console mirror printed the fields as they
  arrived, and the record bus published them to the log panel the same way — a
  plugin that configured `redact: ["apiKey"]` kept its key out of `<day>.log` while
  the operator's terminal and the **Plugin logs** sidebar both showed it. The
  bus was documented as raw, and the panel was documented as the place where
  sanitizing happens, but the panel only bounds what it renders: depth, cycles,
  length. Nothing between the logger and the screen was ever asked to cut a secret.
  The paths now run once in `write`, through the same `@pinojs/redact` pino uses,
  before the sinks branch: a record the level keeps out of the file is redacted on
  its way to the mirror too, and a record whose fields throw when read — a getter, a
  Proxy — is dropped rather than handed out unredacted, since reading them is the
  caller's own code. The paths address the fields object; pino keeps its own pass,
  which is what additionally covers the `msg`, `plugin` and `module` keys of its line.

  A published record also used to freeze the object it was handed, so a plugin that
  logged a field object it still owned got a `TypeError` on its next assignment. The
  record now carries a frozen top-level copy instead, so the caller keeps writing to
  its own object while the keys a subscriber was given stay put. Nested values remain
  the caller's objects: a record is not a deep snapshot, and only a value a `redact`
  path cloned is cut off from the caller for good.

  Retention ran only once for the life of a logger: the sweep promise was kept
  forever as the guard against overlapping passes, and every later rollover saw it
  still set and skipped its own. On a long-running host the window therefore
  stopped being enforced the day after startup, and daily logs kept accumulating
  however short `retentionDays` was. Sweeps are now chained behind one another —
  still never overlapping, still awaited by `close()` — so each rollover prunes the
  files the window covers.

- The logging card survives a 0.1.7-rc.2 host, and its settings now live with its config. ([#521](https://github.com/xarleyn/dsh-plugins/issues/521))

  The card mounted in the Host's `settings.plugin.item` seat, and `0.1.7` deleted
  that slot: the rewrite folded a plugin's browser-editable settings into its
  profile Config, so a field is editable exactly when its schema node carries
  `.volatile()` and the namespace the browser reads is no longer a name the plugin
  invents but the profile entry it was loaded under. For this package the settings
  move from the section `plugin-log` to the entry `dsh-plugin-log-ui`, which means
  levels recorded under the old section are not read back — the Host logs one
  warning and starts from the defaults.

  The card now sits as its own tab on the Settings → Plugins page, because that is
  the slot which survived; it keeps the shell every DSH configuration card uses,
  and gains the list element that page does not supply, since the shell's root is
  an `<li>`. The tab hands a registrant nothing, so the card resolves its own form
  and reads it through the same three-state snapshot as before. What the card
  offers is unchanged: the default level, the per-plugin overrides, the file
  format, and the count of live consumers.

  The service lost its registration call and its pushed value source with it. It
  now reads each field through its live reference at the moment it applies the
  policy, so an edit reaches the loggers on the next poll of the card that made it
  rather than through a callback the Host no longer offers — and a Config captured
  once at construction, which is the bug that callback existed to hide, fails a
  test instead of passing quietly.

- Both Integrations cards open from the Plugins panel now, beside the plugin they ([#658](https://github.com/xarleyn/dsh-plugins/issues/658), [#646](https://github.com/xarleyn/dsh-plugins/issues/646))
  configure. What is proven here is the registration against the contract the panel
  ships and the bundle's own renders; the click-through on a live stand stays #646's
  acceptance item, because the locked QA stand answers the panel's own
  `pluginManager/list*` reads with 403.

  The plugin drew two cards in *Settings → Plugins* (`settings.plugins.tab`): the
  operator's configuration card and the account card that holds the user's own
  connections. `0.1.7` grew the surface those two belong on — the Plugins panel
  declares a configuration seat for a bundle (`plugins.bundle.config`) and one for
  each row the bundle declares (`plugins.row.config`) — and both cards are exactly
  that: one edits this bundle's own Config, the other is this bundle's page for the
  signed-in account.

  The row seat is keyed `@yadsh/dsh-qa-integrations#qa-integrations`, the package
  name joined to the row id `cordis.patch.yml` declares. That join is what makes the
  move safe: the row id is the same string the Host has resolved this plugin's
  volatile Config under, and the account seat is keyed by the package name alone, so
  **no settings namespace moved**. A provider switch, a TeamCity address or a
  service-credential profile saved by an older build is read back by this one. The
  only names left behind are the tab's own seat ids, `qa-integrations-config` and
  `qa-integrations`, which named nothing but the seat.

  What the cards render is the body of the same two cards — the same sections, the
  same write-on-change behavior — and nothing around it. Decision D1 of the cutover
  was reversed on 01.10 and the contract has landed since (#684): on a panel seat the
  row-detail page draws the card surface, the row title, the row id and the
  description line before it mounts the registrant's `page` view, so our shell, our
  `<li>` in a plugin-owned `<ul>`, our header with its chevron and its show/hide
  label were a second frame and a second heading beside the first-party rows. They are
  gone; the override marker moved from the header into the section's own toolbar,
  where the reset button already counts the same keys. Two details follow from the new
  seats rather than from a redesign. The row seat hands its registrant a
  `ConfigPageForm` — `{ state, mutate }` only, no subscription and no single-field
  write — so the operator card keeps resolving its own `ConfigForm` through
  `ctx.configForms.get(namespace)` and that form now arrives through the injected
  face under the name `settingsForm`, where the owner prop called `form` cannot
  shadow it. And the same entry answers `view: 'summary'` with a sentence rather than
  with a card, because that is where the panel puts the answer: the row's description
  paragraph. The contract the panel ships names it a fallback ("`summary` for an
  official card's one-liner or a row's missing-description fallback", closing the row
  entry with "An absent description falls back to the entry's `view: 'summary'`"), and
  which side of the fallback a live row sits on is the Host's to decide, not this
  bundle's: the page takes the description from `rowText(row)` over the `row.meta` the
  Host reports, so a published bundle whose package text the Host does resolve shows a
  description and never dispatches the view. The branch stays for the case where
  nothing resolves, and it stays a sentence there too — the *same* sentence the
  manifest's `description` gives the Host, so the row reads one line whichever way the
  page reaches it. `dsh-plugin-log-ui` (#651) does the same and the equality is drawn
  from `package.json` by a test rather than restated as a literal, because a manifest
  edit is invisible to a test that repeats the string. The bundle seat is documented as
  `page`-only, which is why the account card has no such branch. The account card
  needs no form at all — it reaches the account through the `qaUserSession` service —
  so it takes the bundle's own seat, and the signed-in user's QA settings section is
  untouched.

  One answer the old chrome used to give is now the plugin's own work. The
  credential-help note comes from `@yadsh/dsh-plugin-kit`, and its disclosure is the
  card shell's inline chevron — the same path the panel contract forbids a row bundle
  to carry, and the same block whose focus rules state a hard-coded outline that
  `focus.css` out-specifies under pointer modality. Both halves therefore moved here:
  the note renders from a local component that reuses the kit's
  `credentialHelpView`, so the metadata shaping and the second pass over every
  address stay shared and only the markup is repeated, with the disclosure drawn as
  the border triangle this card's own collapsibles already use; its stylesheet is the
  plugin's copy with the rings retargeted. The copy dresses **its own** class names
  (`dsh-qa-integrations-help*`) rather than the kit's, because the kit's
  `.dsh-credential-help*` rules are a public selector: two bundles injecting equal
  specificity for one element settle whose ring and whose glyph win by the order their
  `<style>` tags happen to reach `document.head`, which no gate can see. That the two
  copies still *say* the same thing is pinned by a test that renders the kit's note and
  this one over the same metadata and compares text, element order and link targets, so
  a drift in the wording — including the labels the copy repeats — goes red in the
  suite rather than silently. A migrated plugin that wants the shared note has to do the
  same until the kit gives the note a glyph of its own — the twelve rows still on a
  settings seat are unaffected either way.

  The rings are the Host's pair written out with a fallback on each half —
  `--dsw-focus-ring-width` as well as `--dsw-focus-ring-color`, because a `var()` that
  resolves to nothing invalidates the whole `outline` shorthand and the ring vanishes
  instead of degrading — and they are on every control this bundle draws itself: the
  provider fields and buttons, the service-credential checkboxes, the capability
  checkboxes under their own label class, the list rows' remove buttons, the section
  and group summaries, and the note's trigger and links. Nothing raises specificity
  to win a ring fight. The body also stops being silent when the Host takes the
  namespace away: a card that owns its shell may render nothing, but inside the page's
  card an empty section is a reader with no answer, so it says so, and the row's own
  `Configure` control — drawn from the inventory, not from this entry — stays
  clickable.

  The manifest followed the surface: the client half type-imports the Plugins
  panel's slot contract instead of the settings-plugins one, so
  `@deepseek-ai/dsh-client-ui-plugin-manager` (new to both catalogs) replaces
  `@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
  entry, and `compatibility.json` names `plugins.row.config` and
  `plugins.bundle.config` among its required client features where it named the tab.
  That is why this is `minor` rather than `patch`: a browser running a host without
  the Plugins panel loses both cards. `scripts/verify-package.mjs` now pins the two
  slot literals in the shipped bundle and refuses the tab, and it glues the seat to
  the patch: the namespace the operator form resolves under, the row id
  `cordis.patch.yml` declares, and the key the row seat is built from must stay one
  string, because a drift there is a seat with no form and a stand that reads its
  saved values back as defaults — with every type check green. The client tests
  assert the keyed registrations, the namespace the operator form is resolved under,
  and both views of the row entry — and render the components the two seats register
  out of `lib/client.js`, so a card that mounts in the source tree but not from the
  bundle fails here. One of those renders answers the question the first draft left
  implicit: the Plugins page spreads its own `form` *after* the injected face, so a
  test clicks a switch with a decoy `{ state, mutate }` in place and asserts the write
  lands on the form this entry resolved, not on the page's. The chrome is pinned the same way it is refused: the bundle must name both seats at
  its `register` calls **and** the key each seat is registered under, as literals in the
  call rather than as constants the module assembles. The contract reads the place off
  `name:`, a positional or helper-passed seat leaves it only the bundle's scattered
  citations to decide from, and a pin that reaches for an identifier —
  `const ROW_CONFIG_KEY = ...` — proves a bundler's choice to keep a name rather than
  anything about the card, so the gate reads strings now. The pair it cannot read off the
  artifact, the settings namespace and the row id the patch declares, is read off
  `src/shared/settings.ts` and `cordis.patch.yml` the way #653 reads its own, which keeps
  the join that protects a stand's saved values pinned without parsing source syntax out
  of a build. The script also refuses the shell's show/hide labels and the plugin-owned
  `host-tab` list that used to hold the shell's `li` root outright, and refuses the kit's
  `.dsh-credential-help*` selectors in this bundle's sheet.

  What the shared gate cannot see is a control left with no focus rule at all, which is
  the same user-visible failure as a hard-coded outline and a cheaper way to reach it. A
  hand-written list of selectors would promise more than it proves — a control missing
  from the list passes while the comment claims everything is named — so both sides are
  read instead: every `:focus-visible` rule of the plugin's stylesheet has to reach the
  artifact with its selector intact, and every ring rule of the sheet the build ships has
  to state the Host's token pair with a fallback on each half. The sheet is read out of
  the artifact rather than the artifact out of the sheet, because the JavaScript around it
  is full of braces and colons that are not CSS, and scoring those as rules would fail the
  package for a `querySelector` string.

  The seat facts themselves are read off the installed
  `@deepseek-ai/dsh-client-ui-plugin-manager` rather than restated in a comment, and they
  are read in one place now: `@yadsh/dsh-test-kit` exposes `readHostSeats` with
  `expectRowSeatContract`, `expectRowSeatKeyJoin`, `expectBundleSeatContract` and
  `expectBundleSectionUntitled`, and this package's
  `tests/client/host-seat-contract.test.ts` is a thin consumer that adds only what
  belongs to this bundle — that its row entry answers both views, and that its bundle
  body is the only heading of a section the page leaves untitled. `dsh-plugin-log-ui`
  (#651) carried the same probe as its own file; it reads the helper now, which is why
  its package is in this plan. The point of reading them once is that one host move
  produces one diagnosis rather than one red file per migrated card.
  `tests/client/*.test.tsx` can prove this bundle answers a `view` well; only the host's
  own bytes prove the page still asks for it — a branch nobody dispatches passes every
  test written against it, and a host that stopped passing `form` would leave the
  operator card resolving a namespace its seat never mentions. So a host that moves
  either seat fails this suite on the version bump instead of in a browser.

  `docs/DSH-0.1.7-MIGRATION.md` follows the diff: §4.2 says the `summary` dispatch is
  **conditional** on the description the Host reports for the row — the page renders
  `description ?? renderSlot(… "summary" …)`, and that description is `rowText(row)` over
  `row.meta`, the Host's inventory, not `cordis.patch.yml` — and names each of those
  sites by the expression that holds it rather than by a line number, since the artifact
  renumbers between release candidates and a citation would rot while the fact it
  describes holds. §3's row for this package, which the same paragraph sits in, is back
  on **one** physical line: split across thirteen, GFM ends the table at the first
  unpiped row and the rest of «Per package» renders as prose, and no gate covers `.md`
  because prettier is told to leave it alone. §10 carries the line's own D1 as option 1.
  The comments in `src/client/index.tsx` and in the package gate no longer claim the
  panel cards dropped their dependence on the settings *service*: `configForms` is
  `@deepseek-ai/dsh-client-ui-settings`, which stays a peer, an injection and a line of
  `docs/COMPATIBILITY.md`, and what the move left behind is the Settings *surface* — the
  dialog and the loopback-only directory — not the module that hands a card its form.

- The plugin's browser markup carries stable `data-testid` selectors. ([#472](https://github.com/xarleyn/dsh-plugins/issues/472))

  Both of the plugin's browser surfaces — the right Sidebar's log panel and the
  settings card — are now addressable by a test id rather than by a CSS class or
  the wording of a label, so a browser test that clicks Pause or reads a log line
  no longer breaks when the copy around it is rephrased. No existing `data-plu-*`
  hook was renamed, nothing moved and nothing changed colour: the ids are an
  addition to the same elements.

  One id carries a behaviour change rather than a test handle. A line of the log
  buffer is named `log-panel-line`, and that name sits on the DOM translator's
  protected-surface table in `@yadsh/dsh-l10n-overrides`, so from this release
  machine translation leaves logged text alone and a line reaches the panel as the
  plugin that wrote it phrased it. This package's `verify-package.mjs` gate pins
  the id: renaming it fails the gate instead of quietly lifting that protection.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.4.2 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.1 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-13)

### 🚀 Features

- A **Plugin logs** panel in the host's right Sidebar, next to the settings card ([9a7536b](https://github.com/xarleyn/dsh-plugins/commit/9a7536b))
  it already shipped. The panel streams what the plugins are writing right now:
  a source filter over every registered plugin logger, level filters from `trace`
  to `fatal`, and a text filter over the whole line, with severity colouring that
  keeps quiet levels quiet and puts the warn, error, and fatal inks where a reader
  looks for them. Output follows the newest line until the reader scrolls up, can
  be paused, and says so explicitly when the host buffer dropped lines the panel
  never read, instead of leaving a silent gap.

  The panel's stylesheet is injected under its own key rather than the card's:
  `injectCardStyles` treats a key it has already seen as injected, so sharing one
  key between two sheets drops the second one — the settings card rendered with no
  rules of its own until each sheet got its own tag.

  The host half subscribes to the record bus of `@yadsh/dsh-plugin-log` and serves
  `pluginLogUi.tail(cursor, limit)` from a 2000-record ring buffer, rendering each
  record's fields to bounded strings because the Remote boundary carries plain
  JSON. The panel opens from the right Sidebar's guide page, which is how a tab
  type is reached, and needs the `sidebarRightTabs` service and the
  `sidebar.right.pane.tab` seat, both now declared as required client features.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-12)

### 🚀 Features

- Migrate to the 0.1.5 settings surface (SettingsProvider.installSection) and ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  declare the gateway remote and renderer slot Context merges in the client
  half. The supported host range moves to >=0.1.5-rc.2 <0.2.0, dropping
  0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-06)

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

## 0.2.0 (2026-08-31)

### 🚀 Features

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn