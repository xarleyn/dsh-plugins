## 0.10.3 (2026-10-08)

### 🩹 Fixes

- read a refused credential as one: a sign-in redirect and an HTML answer fold into `CredentialRevoked`, the binding records the refusal, and a live failure logs what the upstream answered with ([#767](https://github.com/xarleyn/dsh-plugins/issues/767))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.15.7

### ❤️ Thank You

- qoder-bot

## 0.10.2 (2026-10-08)

### 🩹 Fixes

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

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.15.2

### ❤️ Thank You

- xarleyn

## 0.10.1 (2026-10-05)

### 🩹 Fixes

- A provider that stops answering now says so. ([7417b460](https://github.com/xarleyn/dsh-plugins/commit/7417b460))

  A read that timed out against Jira, Confluence, TeamCity, TestIT, Bitrix24 or
  the others left no trace: the plugin logged credential events and address-policy
  warnings only, so an operator looking at the stand's journal could not tell a
  slow tracker from a broken one, and the conversation showed neither a tool
  timeout nor an upstream failure.

  Every error the retry loop gives up with now carries the budget it spent — the
  per-attempt timeout, the retries, the attempts actually made — and the broker
  warns once, with `transport.timeout`, naming the provider and the operation.
  Nothing upstream is written to the log: no address, no query, no body, no
  credential. The tools also declare a ceiling of their own (300 s), computed from
  that retry budget and below the answer budget the QA surface owns, so the harness
  can end a stalled call instead of waiting for the caller to give up.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.15.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.10.0 (2026-10-04)

### 🚀 Features

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

- `jira_search_issues` can now search a field's history, not only the values an issue ([#211](https://github.com/xarleyn/dsh-plugins/issues/211))
  carries right now.

  «Побывали ли задачи в In Progress», «двигали ли статус за две недели», «переназначали
  ли их на вот этого человека» were questions the tool could not answer: the filter
  vocabulary read the current value of every field, and the only way to reach the past
  was to read the changelog of one issue at a time — a question about a hundred issues
  became a hundred reads. Jira answers these directly, with the `WAS` and `CHANGED`
  history operators.

  The operators arrive as a typed filter, `history`, because the rule that kept JQL out
  of the model's hands was never about which operators are expressible: a clause is
  still assembled by the provider from validated parts. `{ field, op, value, from, by,
  on, after, before }` builds `status WAS "In Progress" AFTER -2w BEFORE -1w` or
  `resolution CHANGED FROM "Отклонено" TO "Fixed" BY currentUser()`, and every part is
  checked before it reaches the string — the field is one of the six Jira keeps a
  searchable history for (a custom field is refused and pointed at `customFields`,
  whose history belongs to the instance, not to this package), the operator is `was` or
  `changed`, `was` needs the value it asks about, `from` belongs to `changed` alone, and
  a single day (`on`) alongside a window (`after`/`before`) is a contradiction rather
  than a preference. Values are quoted and escaped like every other filter, so an `OR
  project = SECRET` written into a history value stays text inside quotes. A person in a
  history clause is `me` or the identifier this product filters on — the change log of
  the issue already shows it, so no user-directory read sits behind this path, which
  keeps the service credential's resource boundary intact.

  Nothing is assembled from a partially parsed entry: an unreadable clause is refused
  with the keyword that broke it, because a quietly dropped bound answers a different
  question and its answer reads like a fact about the issues. At most three clauses per
  search, ANDed with the rest of the filters.

  The other half of the finding this card carried is a limit of Jira rather than of the
  provider, and is now stated as such: a Server / Data Center instance pages a search by
  position and reports the size of the result, so `pagination.total` reaches the model
  along with the offset to continue from, while Atlassian Cloud's `/search/jql` reports
  no count at all — there the answer carries `nextCursor` and `isLast`, and the provider
  invents no estimate to fill the gap. Raw JQL stays refused for the same reason it was
  before: the one vocabulary gap that motivated asking for it is closed by a typed
  filter, and the advanced mode the specification describes would need Jira's own parser,
  width limits and an audit of the original string.


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

- A provider that answers with its headers and then stops sending its body is ([#433](https://github.com/xarleyn/dsh-plugins/issues/433))
  refused by the request's own budget instead of being waited on forever.

  `timeoutMs` was the deadline of the headers. The transport loop armed its timer
  for an attempt and cleared it the moment a `Response` arrived, and the `Response`
  was handed back unread — so the body was read after the budget had already
  expired, and nothing in that read observed the deadline at all. A slow or stalled
  upstream therefore outlived the timeout it was supposed to be bounded by, and the
  call stayed pending: the model waited on a request this deployment had already
  given up on. Seven transports went through the one loop, so all seven had it; the
  three that kept a private copy of the loop had it along with the rest of what a
  copy drifts into — Confluence folded its own timeouts into
  `ProviderUnavailable` and never learned the `UpstreamTimeout` its siblings
  report, and Bitrix24 folded a body that stopped arriving into
  `ProviderUnavailable` too, which reads as "the portal is down" where the truth is
  "this call is over its budget".

  The deadline now covers the whole exchange. The loop reads the answer through a
  callback it holds itself, so its timer is cleared in the outer `finally`, after
  the body is done, and each chunk is raced against the attempt's own signal;
  whatever ends the read — the cap, the deadline, a transfer that broke halfway —
  releases the stream, so no body keeps a connection open past the request it
  belongs to. A read cut by the deadline is `UpstreamTimeout`, in words that name
  neither the address nor the credential, and a refusal the read made on its own
  (too large, not JSON) stays what it was named as: it is an answer, not a fault.
  A fetch that answered is still not re-sent, so one attempt's budget is the whole
  cost. Confluence's private loop is gone — it goes through the shared one now,
  with its own status map expressed as the policy parameters the shared folding
  takes, which is the shape `providers/README.md` asks for and one copy of the
  retry rule instead of two.

  The behaviour is pinned in the shared conformance suite, so every provider is
  held to the same deadline over its own body read, and additionally at the level
  of the reader and the loop themselves; Bitrix24 keeps a test of its own that its
  stalled body is told apart from a refused operation, since it answers both
  through one `catch`.

- The operator card's settings tests now cost what they assert, not what the runner can spare. ([#411](https://github.com/xarleyn/dsh-plugins/issues/411), [#406](https://github.com/xarleyn/dsh-plugins/issues/406))

  Six of them reached a control by searching the whole rendered card, and this card is a thousand nodes — seven providers, two hundred labelled controls. Those six were the only tests in the package that cost a second or more, so this one file outweighed the other one hundred and eleven put together: green on a developer machine, a timeout on the shared runner, and the pull requests that inherited the red were mostly branches that never touched this package. The file's previous answer had been a widened per-test budget, which moved the ceiling further away without removing the cost.

  Scoping a lookup to the provider section that owns the knob did not remove it either, because the price is not in the tree the query is given but in how a label gets resolved: the testing library asks every form control for its labels, and jsdom answers that by scanning all two hundred `<label>` elements of the card once per control. The first lookup into a section then costs 40–150 ms whatever subtree it was scoped to, and a role query by name is worse still — it computes the accessible name of every button on the page before it answers. The card's tests now read the binding from the label's side, which is what a click on a caption uses, and find a button by its caption. The `get` contract is kept: a caption that binds nothing, or binds two controls, fails the test.

  The heaviest case went from 1.7 s to 0.03 s. What is left per test is one render of the card — the thing under test — rather than a lookup priced by the controls of this card times its labels, so a busier or slower runner changes the duration of this file and not its verdict. The Weblate catalog test rebuilt all one hundred and thirty-two tool schemas about ten times inside a single test; the surface is static, so it is built once.

- The sections of the operator card are now addressable by a stable hook. ([#463](https://github.com/xarleyn/dsh-plugins/issues/463))

  Every section and group the operator card renders from `client/operator-sections`
  carries a `data-testid`: one zone per provider (`qa-integrations-jira`,
  `qa-integrations-gitlab`, …), the blocks inside it by what they hold
  (`-provider`, `-connection`, `-capabilities`, `-limits`), and the same shape for
  the `general`, `service-access` and per-provider credential-help sections. The
  zone is derived from the provider key the section already declares, so a new
  provider inherits its hooks instead of naming them again, and no two ids in the
  package collide.

  The card's own tests now reach a section, a group and a profile row through those
  ids rather than through the Russian caption or the BEM class that used to identify
  it, so rewording a heading or restyling a block no longer blinds a test that was
  asserting something else. What a test asserts about a caption — the group titles
  of a provider, the collapsed state line — is still asserted by role and accessible
  name. No markup and no style changed: an attribute was added.

- The operator's «Провайдер включён» switch now reaches the model. A provider this ([#283](https://github.com/xarleyn/dsh-plugins/issues/283))
  deployment switched off keeps neither its tools mounted nor its names admitted
  as principal-scoped, so a disabled integration takes its tool surface away
  instead of leaving `testit_*`-style names that every call can only refuse with
  «Integration provider is unavailable».

  The client `Интеграции` page re-reads what the service offers when the provider
  cards mount, and a card whose provider is gone stops rendering — an open
  settings dialog no longer keeps offering «Подключить сервисный токен» for an
  integration the operator has just switched off. A read that has not answered or
  has failed keeps every card, so no form disappears on a transport problem.

- The client Integrations page now says how to connect with your own token. A ([#283](https://github.com/xarleyn/dsh-plugins/issues/283))
  deployment that manages a service credential switches that mode on by default,
  and until now the personal token field appeared only after the user guessed to
  uncheck «Использовать сервисный токен»; the connect form offers «Ввести свой
  токен» beside the checkbox instead, on every provider that has a managed
  credential.

  The «оператор ничего не настроил» note is gone from the Jira, Confluence, Test
  IT and Weblate cards whose sites the operator did configure. It used to render
  whatever the deployment listed, so a connected card could claim there was
  nothing to connect to.

- The plugin's own provider cards are addressable by a stable hook. ([#464](https://github.com/xarleyn/dsh-plugins/issues/464))

  Every block a card renders from `src/client` now carries a `data-testid`: one
  zone per card (`qa-integrations-provider-card-jira`,
  `qa-integrations-provider-card-gitlab`, …) named from the provider key the card
  already declares, and inside it the blocks by what they hold — `-error`,
  `-summary`, `-credential`, `-instance-picker`, `-deployment`, `-capabilities`,
  `-capability-issues-read`, `-service-option`, `-boundary-summary`,
  `-disconnect-confirm`. The two mounts of the same cards are named too: the QA
  settings page (`qa-integrations-page`) and the host's plugin tab
  (`qa-integrations-host-tab`). The `provider-card-` segment keeps these hooks
  apart from the operator card's sections, which own `qa-integrations-<provider>`,
  so the two surfaces never answer to the same id.

  The card tests that used to reach one of these blocks through its Russian
  caption or its BEM class now reach it through the id, so rewording a heading or
  restyling a block no longer blinds a test that was asserting something else.
  What a test asserts about a caption or a control — that the site picker is
  labelled, that the connect button is named "Сохранить и проверить", that the
  disconnect confirmation is an `alertdialog` carrying the provider in its name —
  is still asserted by role and accessible name, and one test now checks that a
  mount of two cards repeats no id and that every id is ASCII kebab-case. No
  markup and no style changed: an attribute was added.

- The rules a provider kept for itself are the kernel's now: one address policy ([#295](https://github.com/xarleyn/dsh-plugins/issues/295), [#433](https://github.com/xarleyn/dsh-plugins/issues/433))
  for every endpoint list, and two named retry budgets instead of a lambda per
  transport.

  **An address rule that only one provider had.** Test IT refused a `baseUrl`
  carrying a fragment; the other six folded one away in silence. A fragment never
  reaches the server, so what an operator pastes — the browser URL of the page they
  were reading — became an endpoint that meant something else, and the row looked
  accepted. The refusal now lives in `providers/kernel/address.ts` beside the
  credentials and query rule, with a knob for the one word a provider cannot share:
  an installation that legitimately has no certificate is called *internal*, not
  *development*, and the operator reading the refusal looks for the word their own
  product uses. Confluence, Test IT and Weblate resolve their lists through that
  policy now, so their three copies of `normalizeInstance` are gone; the row members
  a provider carries beyond the shared shape come from its own `extra`.

  **Two retry budgets, named.** The deadline over the whole exchange is the shared
  loop's; what a deployment still chooses is whether a request that never answered
  is asked again. Jira, TeamCity and Confluence re-send it, so one read can cost
  `retries × timeoutMs`; GitLab, Test IT and Weblate hold one `timeoutMs` as the
  whole budget. Both rules existed, as an inline lambda in each transport, beside a
  comment that in places described the other one — which is how the mismatch
  between the words and the behaviour survived review once already.
  `DEADLINE_IS_THE_BUDGET` and `RESEND_AFTER_EVERY_FAULT` are now the kernel's two
  names for the choice, the default is the shorter one, and a provider either names
  its rule or takes the default: three transports no longer restate a predicate, and
  three say in the kernel's words which of the two waits the operator gets. What the
  choice does *not* cover is pinned too: a body this deployment stopped reading is
  the read's own refusal, so neither rule buys it a second attempt, and GitLab
  asserting one attempt after a timeout beside Jira asserting the re-send is what
  keeps the asymmetry a decision rather than an accident.

  The client operator card kept one duplicate through its own split:
  `resourceRecord` was defined in `operator-sections/shared.tsx` and again in
  `service-profiles.tsx`. The shared one is kept. The kernel contract is now tested
  where it is written — `tests/kernel/`, the read-budget cases against a real socket
  rather than a hand-built `Response`, because the thing under test is whether an
  abort reaches a body still being read — and `scripts/verify-package.mjs` asserts
  the address policy and the two named budgets on the kernel, instead of on
  whichever provider happened to hold a copy.

  What is unchanged: the package's `exports`, the settings slot the card registers
  in, and the DOM the operator's tests read. Hence `patch` — no consumer of this
  plugin calls anything differently. What an operator can notice is a config that
  used to load and is now refused at startup, naming the endpoint entry whose
  `baseUrl` carries a pasted browser URL — the list is theirs, so it is the load
  and the card's instance list that say so, not the user's connect form — and a
  stalled upstream that costs the timeout this deployment configured rather than
  the longer wait its provider's comment had promised, which every provider card
  now words on its own.

  **The host side of the same copying.** `src/index.ts` kept the connect card's
  plumbing seven times over: each provider restated, in its own body, how a summary
  is read, how a credential is spent, how a policy is patched and how a connection
  is let go. Those bodies are the composition root's helpers now and a provider
  names its id to them, so the acceptance the kernel was written for holds on the
  host side too: a new provider adds its own module, its row in the endpoint list
  and its thin remote methods, without re-writing the rules beside them. The list of
  names the package publishes moved out of the composition root into
  `public-api.ts`, re-exported by the entry, so the file answering «what does this
  deployment mount» no longer also answers «what may another plugin import»;
  `verify-package.mjs` asserts the entry keeps carrying that surface. The
  composition root went from 1537 lines to 1052 and left the budget allowlist, which
  is the list that only shrinks. The 49 `@Remote` members keep their names and
  parameter shapes, so the generated client is untouched.

- The tests this package had not yet filed by domain now sit in the folder of the ([#496](https://github.com/xarleyn/dsh-plugins/issues/496), [#295](https://github.com/xarleyn/dsh-plugins/issues/295), [#319](https://github.com/xarleyn/dsh-plugins/issues/319))
  module they drive, following the shape `dsh-qa-surface` got in #224.

  Sixty files still lay directly under `tests/` on this slice — fifty-five test
  files and five fixtures. The provider folders, `kernel/` and the seven
  provider suites had already been sorted out by #295 and #319; what was left was
  the part of the package that is not a provider: the client cards, the service
  credential broker and its policy, rate limit and configuration, the shared
  provider machinery, the storage layer, the model-visible tool surface, the
  plugin entry and the probe script. One column of sixty names carried that
  information in a prefix, and the prefix had begun to lie: `catalog.test.ts` is
  mostly a Bitrix24 suite, `provider-http.test.ts` reads the kernel's read policy,
  and `broker-isolation.test.ts` belongs with the broker suites it is named after
  nothing of.

  The domain folders now say it instead — `client`, `service-credentials`,
  `shared`, `kernel`, `helpers`, `storage`, `tools`, `utils`, `host`, `scripts`,
  each mirroring a boundary in `src/`, and the four `*-catalog`,
  `*-service-boundary`, `*-service-credentials` and `*-service.helpers` files
  joined the provider folder whose name they repeated. Nothing was re-asserted:
  no test body, fixture or expectation was rewritten, only paths and the relative
  specifiers that resolve them, plus the depth of the two paths these suites build
  at run time (`REPOSITORY_ROOT` of the probe suite and `lib/client.js` of the
  bundle suite). The suite runs the same before and after — one hundred and
  nineteen files, nine hundred and ten cases, two hundred and eighty-two describe
  blocks — and a json snapshot compared by full case title reports no difference,
  which is the measure this card was opened with: no file is left at the top level
  of `tests/`.

  Three source comments and the paths in `README.md` and `docs/specs/` that point
  at a test file were repointed at its new home; no identifier, no `data-testid`
  and no public API changed, so the curated changelog is untouched and this change
  is not user-visible.

- Two ways an integration kept behaving like a connection it no longer had. ([#343](https://github.com/xarleyn/dsh-plugins/issues/343), [#433](https://github.com/xarleyn/dsh-plugins/issues/433))

  A capability the deployment withdrew is no longer served. The broker used to
  answer a call from what the account was granted when it connected — the stored
  capability list crossed with the user's own policy — and never compared the
  request to what the provider offers today. A deployment that narrowed a provider
  (an integration scope dropped from its config, write operations turned off) went
  on serving the withdrawn capability to every account that had connected while it
  was still offered, until each person reconnected. The allowance is now
  intersected with the live provider set as well, and the refusal lands where it
  has to: before the secret is decrypted and before a single byte reaches the
  vendor. The card decides through the same intersection, so a withdrawn
  capability stops being offered to the operator at the same moment it stops being
  served to a call. Its row stays in the list the operator sees, because that list
  is drawn from the provider's catalog rather than from this connection's grant,
  but it is shown unchecked, cannot be switched on, and carries no policy entry —
  which is the honest shape of the withdrawal: the operator still sees what the
  provider could do, and sees that this connection may not. Writing an allowance
  goes through it too: a policy for a capability the deployment does not offer is
  refused rather than stored, because a row saved while the capability is away
  would wake up the moment it returns —
  a permission nobody asked for, which is what a newly detected capability is kept
  from by starting denied.

  A verdict about an old credential can no longer rewrite the current one. A
  validation probe outlives its own connection whenever the account is re-saved
  while the vendor is being reached — the probe started against one token, another
  took its place, and the first answer arrives last. That answer used to be
  written to the row by its id, over whatever it found there, so the card kept the
  new account's name while its capabilities became the old token's: a list
  describing rights nobody holds any more. The write is now compare-and-swapped
  against the binding the probe started from — the row itself, its revision, its
  secret reference and its service profile together — and a verdict that no longer
  matches is dropped and logged as `credential.validation-stale` instead of
  stored — under a separate key, `credential.validation-unbound`, when the
  connection has been deleted outright, because whoever reads the log is asking
  two different questions and one key would answer neither.
  Wrapping the write in a transaction would not have helped: the gap the old answer
  falls through is the await in front of it, so only the generation of the
  connection decides which verdict still belongs to the row.

  Comparing the revision is not enough on its own, because a disconnect deletes the
  binding and the connection made afterwards numbers its revisions from one again.
  A service binding that holds no personal credential is then indistinguishable from
  the one it replaced on every field but the id — no secret reference, the same
  profile, revision 1 — so the verdict of a probe started before the disconnect
  landed on the healthy connection that followed it and filed an error status and an
  error code that connection had never earned. The row id is part of the generation
  for that reason: an answer may only touch the binding it was produced from. The
  same window was left open on the way back to a personal credential, which reaches
  upstream before it writes: the account reconnecting inside that probe used to leave
  the replaced token's identity and grant on the live row, moving its revision past
  the reconnect's own and recording a mode switch in the trail that the store never
  applied. That write is compare-and-swapped the same way now, and a switch that
  lost its binding answers `IntegrationNotConnected` and logs
  `credential.switch-stale` — nothing is written, so the trail keeps no success.

  Two things had to change for that guard to actually catch a reconnect. Every
  reconnect now opens a new binding generation, not only one that changes the
  credential source: an operator re-saving the same managed profile from Settings
  leaves the source, the profile and the stored credential exactly where they
  were, so a generation that moved only on a mode switch kept that reconnect
  invisible, and a verdict taken from the credential before it — an expired
  service token, say — still overwrote the status of the live connection. And a
  probe unlocks the credential its own binding names rather than whatever the row
  points at when the read happens, so the answer it produces and the generation
  the verdict is filed against are the same connection by construction, not
  because nothing happened to intervene. That read starts from the principal that
  asked and the provider being reached, like every other lookup in the store, and
  the reference only selects which generation of that connection is unlocked: a
  bare reference would hand any account's credential to whoever quoted its id. A
  read that loses that credential to the reconnect says so as the missing
  connection it is: the operation is recorded as a failure rather than among the
  calls policy declined, and the user is not told to store a token they just
  replaced.

  Both are pinned by tests: a stored grant the provider no longer offers is
  refused without unlocking the secret and is no longer offered by the card that
  describes the connection — its row stays, drawn from the catalog, with nothing
  granted behind it — an allowance for it is refused while it is away, including
  when the provider itself has left the configuration, and still does
  not serve when it returns, a validation that lands after the account moved is
  discarded — in either completion order, after a re-save of the very profile the
  binding already ran under, and after the binding was disconnected and made again
  with that same profile — a credential switch whose probe outlived its binding is
  refused while the live connection keeps what its own reconnect wrote, and a secret
  reference resolves only for the account and provider whose live binding still
  carries it.

- A service credential that refuses a build log now says which rule refused it, ([#285](https://github.com/xarleyn/dsh-plugins/issues/285), [#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#295](https://github.com/xarleyn/dsh-plugins/issues/295), [#514](https://github.com/xarleyn/dsh-plugins/issues/514), [#393](https://github.com/xarleyn/dsh-plugins/issues/393), [#463](https://github.com/xarleyn/dsh-plugins/issues/463), [#464](https://github.com/xarleyn/dsh-plugins/issues/464), [#584](https://github.com/xarleyn/dsh-plugins/issues/584))
  and the operator's capability switch says so beforehand.

  `qa-integrations.teamcity.logsRead: true` really does grant the capability, and
  a tester reading the operator's card has no way to learn that the managed
  service credential still cannot read the log: the ceiling keeps the text a build
  printed away from a shared account on purpose. The refusal arrived as «This
  operation can return personal or otherwise sensitive data», which reads like a
  fault in the stand's integration, so the operator's tick and the user's answer
  never met. (Issue #285.)

  The sensitive-read refusal now names the capability it refused
  (`teamcity.logs.read`), the account that can read it, and that the switch and
  the user's token are not at fault; the provider's own second lock words the same
  distinction between a write, a personal read and a denied read, and answers with
  the broker's code for every operation of every catalog. Every tool the ceiling
  refuses as a reading says so in its description — the sentence being composed
  from the operation's own classification, so the model knows the condition before
  it tries. The description carries it only while the deployment hands out managed
  credentials, because on a stand without a shared token the warning would withhold
  a reading the personal connection answers. The operator card marks each
  capability switch the managed credential does not reach — TeamCity logs and
  artifacts, the GitLab CI job trace, Jira and Test IT attachments, the Bitrix24
  reads of people and their text — with whether it escapes the credential whole or
  in part, and stays quiet while the deployment hands out no managed credential;
  the note comes off the toggle's own configuration path, so the card holds no copy
  of a flag name to mistype. GitLab's CI is now the two switches the resolver
  answers with (`ciMetadataRead` and `ciLogsRead`), each read in the resolver's own
  order — the half, else the pre-split `ciRead`, else the default: one handle could
  neither show a half switched off on its own nor set one without overriding the
  alias it still displayed. Tests recompute the card's table from every provider catalog and count
  the notes in the rendered card, compare every mounted description with its
  operation's classification under each provider's real tool-name prefix, and check
  that a stand with no managed credential carries no note at all — so none of it
  drifts away from what the ceilings actually enforce.

- The QA changelog names what #286 actually shipped, and the guards #286 added ([#286](https://github.com/xarleyn/dsh-plugins/issues/286))
  gain the regression tests that hold them.

  Version 0.13.0 described three of its own capabilities — the one-request
  `/no-review` waiver, the automatic managed service profile for a new account,
  and `web_fetch_file` for non-graphic attachments — nowhere, although the plan
  that released them named all three; the curated list now carries them.

  Documentation search pins the grep syntax it promises the model (character
  classes and anchors) and its pattern budget, and `docs_read` refuses an
  absolute path that leaves the documentation tree the way `docs_search` already
  did. Automatic service binding is tested against both of the shapes it has to
  stand down for: a deployment that offers no default profile, and one that
  publishes several. Downloaded attachments test their leaf-only filename
  directly, so a percent-encoded path cannot reach the store with separators.

- `src/config.ts` now matches the repository's Prettier style. ([#603](https://github.com/xarleyn/dsh-plugins/issues/603))

  `pnpm format` — and with it `pnpm check` — reported this one file red on an
  untouched train base, so every lane had to work out for itself that the failure
  was not its own. The schema and the snapshot type are reflowed only: the
  `maxResponseBytes` builder chain fits one line and the optional mapped-type
  union no longer breaks. No literal, no default, no `.volatile()` marker moved,
  and the resolved config the Host reads is byte-identical.

  Nothing user-visible changed, so no release note is added.

- The deferred scope of the GitLab and Weblate providers now reads out of one place: ([#213](https://github.com/xarleyn/dsh-plugins/issues/213))
  `docs/specs/providers-deferred.md` lists every item the two providers left out,
  one row each, with what the code does today, the default already on record for it,
  and what actually blocks it.

  Until now the same unfinished business was written in three places that overlap and
  each disagree: the «Чего в …-провайдере ещё нет» list in README, the `Deferred` and
  `Non-goals` sections of each specification, and Weblate's `Future work`, which mixes
  what is missing with what was built differently on purpose. Nothing in them said
  whether a row waited for a decision or merely for somebody to write it, so the size
  of the volume could not be measured without re-reading six documents.

  Rows were measured against the code, not against the prose. The measurement closes
  the read surface of both providers — 23 of 23 read tools GitLab's §14 names, 19 of 19
  Weblate's Tool surface names, all `GET` — so what is deferred is not more reading but
  four other things: writes and the single confirmation framework every provider waits
  for, an identity-and-boundary choice, the size-and-paging knobs a deployment can set
  for Weblate but not for GitLab, and a tail of items that were never going to be
  built. The shared blockers are named S1–S4 with the scope each card would carry.

  The lane decides nothing here. The OAuth-versus-PAT fork and the nine open questions
  of GitLab §37 stay in the `owner-decision` bucket, collected with the recommended
  default §37 already carries and with what that default does not settle.

  Recording the volume also surfaced five discrepancies between the prose and the code,
  each with the symbol that shows it: GitLab hard-codes `LIST_MAX_PER_PAGE` and
  `DIFF_BUDGET` where its §18 names config keys; §36's read-only acceptance checklist
  still boxes OAuth, resource restriction, cache namespacing and token refresh; §28's
  per-instance `oauth.*`, `tls.caBundle` and `network.*` keys are implemented nowhere and
  were listed as deferred nowhere until now; Weblate's `CONTEXT_HINT` promises the model
  a search of the developer comment that `note` — unreachable from any argument — is the
  one that would perform it; and the pending-action expiry is written twice, 5–15 minutes
  in `SPEC.md` §18 and 10–30 in GitLab §15. Three of the five are now named by the README
  list and a fourth was already in it, so the document records per item where the finding
  is written today and what only it states, rather than filing the same finding twice.

  Documentation only: no source file, tool schema or gate changed. README and `SPEC.md`
  point at the new document, and each specification's deferred section links to it.

- Test coverage now comes from the shared Vitest preset, so `pnpm run ([#291](https://github.com/xarleyn/dsh-plugins/issues/291))
  test:coverage` measures the same tree in every package and writes the same
  machine-readable `coverage/coverage-summary.json` beside the printed table.

  Until this release the preset carried no coverage block at all, so whatever a
  package listed as its `include` was the whole denominator. That choice is gone:
  `mergeConfig` concatenates arrays instead of replacing them, so a re-declared
  `include` can only widen the tree and `exclude` is the only way left to measure
  less. The blocks are dropped rather than rewritten, which means a package that
  used to measure part of its sources now measures all of them, client code
  included. Where that happens the percentage falls with the wider denominator
  while not a single test changed, and the number is comparable with the other
  packages of this workspace but not with what the same package printed before.
  Neither is it comparable with the older test-lines-per-source-lines ratio, which
  counted words instead of executed statements.

  No thresholds on purpose: the percentage is a measurement to read before a
  refactor, not a gate that competes with the per-file size budget. No runtime
  change.

- The shell of the operator card and every shared control it mounts now name ([#462](https://github.com/xarleyn/dsh-plugins/issues/462), [#463](https://github.com/xarleyn/dsh-plugins/issues/463))
  themselves, so a check reaches a knob by the settings key it writes rather than
  by the caption printed above it.

  The sections of the card already answer to a zone id; the fields inside them did
  not. A field was found by the text of its label, an override mark by a BEM
  class, the reset button and the layer badge by the exact sentence they render.
  That copy is the operator's own handle — it is Russian, and a reworded hint is
  an ordinary documentation change — so each such edit silently broke a check that
  had nothing to do with the wording. Epic #453 asks for a handle that survives
  both a rewritten caption and a switched language.

  A control's id is derived from the path the Host stores its value under and the
  card mutates by: `qa-integrations-enabled`, `qa-integrations-gitlab-max-file-bytes`,
  `qa-integrations-bitrix24-crm-read`. The zone sits in the prefix and the keys
  follow it, spelled one way for every segment: camelCase comes apart, an acronym
  run belongs to the word after it, and any other run of non-alphanumerics
  collapses to a single dash, so `issues.read` is `issues-read` and no key can
  hand back a selector the harness cannot quote. A provider's key already starts
  with the provider, so those knobs land in the zone their section uses; a
  top-level key (`timeoutMs`, `allowedPortalSuffixes`) sits right after the zone
  and belongs to the general section by the schema, not by its name.

  The parts of a field hang off that id with a suffix (`-field`, `-row`,
  `-remove`, `-add`, `-overridden`, `-deployment-select`), and a node a field
  repeats keeps the id of its template — the convention does not bake a row's
  value into a name. A concrete row is the one carrying `data-dsh-row-key`, the
  attribute the epic points a check at: the row of a stored instance is the node
  keyed `corp`, not the first of however many the deployment happens to keep. A
  field that has to share its path with a sibling names itself through the
  `testId` prop instead of colliding with it, and the profile editor of the
  service-access section is that field: its resource map and its deny map are
  `qa-integrations-service-access-profile-<row>-resources` and `-policy`. The
  badge, the loading line, the write error, the read-only banner, the toolbar and
  the reset button of the card body answer to `qa-integrations-<what-it-shows>`.

  Only attributes were added — every element, `className`, role and aria
  attribute of the touched files is what it was, so the card looks and reads
  exactly as before. The card's own tests moved to the new handles where they had
  used a caption or a class as the locator, and each assertion on a role or an
  accessible name stayed and tightened: a field is checked to carry exactly its
  label, not a prefix of it, so an id and a caption cannot drift apart unnoticed,
  and a run asserts that the ids answer once per scope and stay ASCII kebab-case.
  The change is not user-visible, so the patch plan carries no new QaChangelog
  section.

- The plugin configures its own profile entry and builds against a 0.1.7-rc.2 host. ([#514](https://github.com/xarleyn/dsh-plugins/issues/514), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  `0.1.7-rc.2` rewrote the settings subsystem: `settings.installSection` and the
  `settings.plugin.item` slot are gone, the settings namespace of a plugin is its
  profile entry id, and a field is editable from the browser only if its schema
  node carries `.volatile()`. The package kept a namespace beside its entry and
  registered its operator card into the deleted slot, so it neither compiled nor
  found its surface against an rc.2 host.

  The composition root now marks every knob the card reaches `.volatile()`, the
  service reads those references once per operation instead of holding a snapshot
  from mount, and a committed edit reaches the running service through
  `loader/volatile-update` — the same live re-apply as before, with the provider
  registry, the instance lists and the tool mount rebuilt from the current value.
  The plugin declines the generated settings page for its own entry, because it
  ships its own card, and the card is now a page of the Plugins settings tab strip
  (`settings.plugins.tab`) that resolves its `ConfigForm` through `configForms` and
  mounts only while the Host really serves the entry. Its card shell is unchanged,
  and so is the boot-path exception: storage and master-key paths are edited,
  logged and applied on the next restart.

  One behaviour moved. Write-time validation of constraints a schema node cannot
  express (a TeamCity host pattern matching nothing, a duplicated instance id) is
  no longer refused before persistence: the Host validates against the schema, the
  value is stored, and the resolvers keep the running service on its previous
  state and log `config.rejected` instead of half-applying it.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.14.0
- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.9.0 (2026-09-24)

### 🚀 Features

- Service-mode calls now stop at a ceiling the operator sets, before they reach the vendor. ([412a5d9](https://github.com/xarleyn/dsh-plugins/commit/412a5d9))

  A managed credential is one upstream identity shared by every account that points
  at it, so the old failure shape was collective: one chatty principal spent the
  quota the whole deployment runs on, and the vendor saw only the credential, not
  who asked. The service mode gained two token buckets —
  `managedServiceCredentials.rateLimit.perPrincipal.requestsPerMinute`, what one
  account may ask of one provider through any managed credential, and
  `perCredential`, which carries both `requestsPerMinute` and `maxConcurrent` for
  the shared upstream identity itself. Buckets refill continuously at their own
  rate rather than on a wall-clock minute, so a burst may take a full minute of
  requests and is then held to the steady rate; a dimension set to `0` is unbounded.

  The ceiling is two-sided on purpose, and both sides are read before either is
  written: a call the shared bucket refuses leaves the user's own balance untouched,
  and a call the user's bucket refuses leaves the shared balance untouched. Without
  that order a noisy account would pay for the bottleneck it creates with everybody
  else's allowance. A refusal answers `RateLimited` with a retry-later notice, is
  audited against the real principal — the limit is decided here, so upstream never
  learns the request existed — and costs nothing to the vendor.

  Nothing is configured, because an unconfigured deployment is the case that needs
  the limit most: the shipped default is the request ceiling the design document
  already named, 120 requests a minute per principal and 1000 a minute with 16
  calls in flight per credential. A deployment that wants a looser or a harder
  ceiling sets `rateLimit`; one that wants a dimension unbounded sets it to `0`.
  Personal-mode calls stay unthrottled — there the user's own credential already
  carries the frequency, and the vendor sets that limit itself.


### 🩹 Fixes

- QA conversations now render Mermaid diagrams with secure source fallback, ([aafad8b](https://github.com/xarleyn/dsh-plugins/commit/aafad8b))
  documentation search accepts safe grep-style alternatives and canonical paths,
  and the role-change dialog uses the surface's normal controls.

  Managed integration defaults are provisioned for new users without overriding
  an explicit disconnect, the structured `/no-review <request>` command bypasses
  the automatic review gate for exactly one durably linked request, and
  authenticated fetching can retain arbitrary successful responses as durable
  file attachments while keeping grants administrator-controlled.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.13.0
- Updated @yadsh/dsh-plugin-kit to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.3 (2026-09-23)

### 🩹 Fixes

- Domain expert execution now fails closed when the runtime cannot enforce an ([7843693](https://github.com/xarleyn/dsh-plugins/commit/7843693))
  explicitly denied tool. A refusal no longer retries with a list that accidentally
  puts the denied name back into the worker's allowed set.

  The integrations operator card keeps new instance and service-credential rows
  as local drafts until they are complete. Controlled profile fields no longer
  snap back to the stored value, and deleting a stored instance cannot shift an
  unfinished draft into the payload sent to the Host.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.12.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.2 (2026-09-22)

### 🩹 Fixes

- The operator card keeps what was typed, and a provider problem is visible. ([0a70f14](https://github.com/xarleyn/dsh-plugins/commit/0a70f14))

  Two halves of one complaint: the card is where a deployment's shared connection
  settings are edited, and it lost work while the roster refreshed — a half-typed
  base URL or token was gone the moment the list re-rendered, so a slow provider
  made the card feel like it was fighting the operator. Drafts are now kept per
  provider and survive a refresh and a switch between rows.

  The other half is silence: a provider that answered with a shape the plugin did
  not expect, or refused the credential, left its row looking configured, and the
  operator only found out from a chat that could not read anything. The row now
  carries the failure it produced, with the provider's own words, so a bad
  credential reads as a bad credential rather than as a plugin that does nothing.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.2

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.1 (2026-09-22)

### 🩹 Fixes

- Ручная приёмка провайдеров перестала быть разовой раскопкой. ([a9c00d2](https://github.com/xarleyn/dsh-plugins/commit/a9c00d2))

  Пакет везёт регрессионный тест инструмента `scripts/probe-provider.mjs` из
  корня репозитория: он держит два правила, на которых стоит ручная проверка
  провайдера против живого инстанса, — что каждый провайдер объявляет чтение
  идентичности, которым можно подключиться, и что проба не печатает секрет,
  который ей передали. Сам ход ручной проверки (пошаговый плейбук, матрица
  продуктов Atlassian, негативные случаи и чек-лист «второй продукт у того же
  провайдера») описан в `docs/MANUAL_VERIFICATION.md`.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.8.0 (2026-09-22)

### 🚀 Features

- Jira и Confluence теперь работают не только с Atlassian Cloud, но и с ([c10fd19](https://github.com/xarleyn/dsh-plugins/commit/c10fd19))
  самохостящимися Server / Data Center. Тип развёртывания объявляет оператор в
  конфиге сайта (`jira.sites[].deploymentType`, `confluence.instances[].deploymentType`:
  `cloud`, `server` или `data-center`); значение по умолчанию — `cloud`, поэтому
  существующие конфиги продолжают работать без правок.

  Для Jira Server / Data Center провайдер ходит по `/rest/api/2` с личным токеном
  доступа (Personal Access Token) в заголовке `Bearer`, без почты аккаунта; поиск
  задач идёт через классический `/search` с пагинацией по offset, а справочник
  людей — через `username=`, потому что эта Jira фильтрует по логину, а не по
  accountId. Для Confluence Server / Data Center — свой v1 API под `/rest/api` (в том
  числе если вики живёт за контекстным путём: он задаётся в `baseUrl`), тела страниц
  приходят в storage-разметке и рендерятся в текст, комментарии обоих видов лежат в
  одной коллекции и различаются по маркеру места.

  Конфигурация, которая объявила сайт одним продуктом, а он отвечает другим,
  отклоняется на подключении с подсказкой, какое значение поставить, — вместо
  прежнего отказа «Data Center не поддерживается». В карточке подключения для
  такого сайта спрашивают личный токен доступа и не спрашивают почту, а в
  операторском редакторе у каждого сайта появился выбор типа развёртывания.


### 🩹 Fixes

- The integration store is closed when the plugin goes away. ([e03a44b](https://github.com/xarleyn/dsh-plugins/commit/e03a44b))

  `IntegrationRepository.close()` existed and nothing called it: the plugin's
  teardown removed the tools and closed the logger, leaving the SQLite handle and
  its WAL open for whatever ran next. A reload therefore handed the new instance
  a database that was still held — the stray `qa-integrations.db`, `-shm` and
  `-wal` files a local run leaves in the plugin directory are what that looks
  like from the outside.

  Disposal now closes the store, so a reload re-opens the file instead of
  inheriting the previous instance's lock.

- One owner per shared provider policy, and no empty continuation cursor. ([06d6635](https://github.com/xarleyn/dsh-plugins/commit/06d6635))

  The seven integrations used to carry their own copy of the same helpers: reading
  a field out of an upstream answer, refusing a malformed argument, the retry loop
  and bounded read of a transport, classifying a failure, naming a configuration
  error. The copies had already drifted — the ones that read a string field
  disagreed about an empty one — so the same question now has a single answer per
  policy, in `providers/shared/` for upstream payloads, paths, HTTP and health,
  and in `coerce.ts`/`errors.ts` for arguments and errors. Integrations that
  genuinely differ pass a parameter or keep their own named helper; the package
  gate refuses a provider that declares a shared policy again.

  The behaviour a caller sees: an empty continuation token from Jira is no longer
  answered as a cursor. Jira can send `nextPageToken` present but empty, and the
  cursor a tool accepts is validated as non-empty, so an answer carrying `""` handed
  a caller a value whose only possible use was an `InvalidRequest`; the page is
  simply the last one now. The same emptiness rule covers every provider.

  While the policies were moving, the integration's specifications moved from
  `docs/SPEC-<topic>.md` to `docs/specs/<topic>.md`, and `SPEC.md` — the document
  meant to be the single entry point — now links all of them.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.7.0 (2026-09-21)

### 🚀 Features

- Give `bitrix_search_crm` the filters the audit kept reaching for, and pin the page order so offset paging stops repeating rows. ([20eea44](https://github.com/xarleyn/dsh-plugins/commit/20eea44))

  The tool could only narrow by title substring and assignment, so typical questions ("open deals in this funnel", "what moved recently") degenerated into paging through the archive from the first page of ten thousand. The schema now carries `stageId`, `categoryId`, `openOnly` (deals only — the universal item API exposes `closed` for deals), `createdSince`, `updatedSince`, `orderBy` (`id`/`createdTime`/`updatedTime`) and `orderDir`. Every search now sends an explicit deterministic order: offset paging over an unspecified order is what produced identical pages at different offsets. An empty `query` now fails with the repair named in the message — `query is invalid: a non-empty title substring …` — instead of a bare `query is invalid` that one session retried verbatim; the tool description also points at `bitrix_get_crm_stage_history` for the "sitting in a stage too long" question the search could not express.

- Add `bitrix_add_crm_timeline_comment`, the provider's first write tool, behind an operator switch that defaults to off. ([609d60d](https://github.com/xarleyn/dsh-plugins/commit/609d60d))

  QA tasks kept asking the agent to "add a note to the deal", and the agent — holding only read tools — promised a write it could not perform. The new tool adds exactly one comment to the timeline of a lead, deal, contact or company (`crm.timeline.comment.add`); smart processes and every other mutation stay out of the surface. It mounts only when the deployment sets `bitrix24.crmCommentWrite: true`, rides the new `crm.comment.write` capability, and even then starts policy-denied until the capability is explicitly allowed for the integration. Three gates, because Bitrix24 has no read-only webhook scope: a `crm`-scoped webhook can write on its own, so the flag — not the scope probe — is what bounds the deployment, and the policy is what bounds the user. The read catalog of thirty-nine tools is unchanged and stays mounted whatever the flag says.

- An operator card for the deployment configuration, live in "Plugins → Plugin ([1a921b5](https://github.com/xarleyn/dsh-plugins/commit/1a921b5))
  configuration".

  Until now every deployment knob — provider switches, instance and site lists,
  the TeamCity address with its network policy, managed service credentials —
  lived only in the profile's composition row, and the Host settings page showed
  a card that asked for a QA sign-in, because connections belong to accounts. An
  operator who just wanted to flip a capability had to edit yaml and restart.

  The plugin now installs its configuration as a real settings namespace and
  mounts an operator card on it, beside the user surfaces. The card covers the
  whole resolved configuration: the general knobs (enabled, timeouts, response
  and audit budgets, the Bitrix24 portal suffixes), every provider's capability
  switches and limits, the instance and site lists with id/label/address rows,
  the TeamCity server address and its address policy, managed service credential
  profiles with their resource boundaries and deny policy, and the per-provider
  credential-help overrides. Every field shows whether the user layer overrides
  the composition row, one button clears the layer back to yaml, and a refused
  value is reported on the card instead of stored.

  Edits apply to the running service as they are committed: the broker is
  re-pointed at the freshly resolved provider set, and the tool mount follows the
  enabled flag and the one write capability. The connection store and its master
  key are the deliberate exception — connections and wrapped secrets belong to
  the boot path, so re-pointing them warns and waits for a Host restart instead
  of reopening the store under running connections. A deployment without a
  settings provider behaves exactly as before, booting on the composition row.

- Managed service credentials for every provider, not just GitLab and TeamCity. ([aaa1420](https://github.com/xarleyn/dsh-plugins/commit/aaa1420))

  The deployment-managed shared read-only account existed for two of the seven
  integrations: a contractor without a corporate GitLab account, or an intern no
  one issued a TeamCity token, could not connect at all. The provider contract
  was already generic — the broker resolved the mode and the boundary for anyone
  — but only two providers classified their operations, so only two offered the
  checkbox.

  Bitrix24, Jira, Confluence, Test IT and Weblate now implement the full
  provider side: per-operation security classification (effect, sensitivity,
  service-safety, resource boundary), capability service states, instance
  portal resolution, a probe-only credential health check, and execute-time
  enforcement that runs the ceiling first, then the boundary, then the
  provider-specific filters. Each provider names its own boundary vocabulary:
  `projects` for Jira (project keys), Test IT (project ids) and Weblate (project
  slugs), `spaces` (space keys) for Confluence, and `portals` for Bitrix24,
  which has no project tree at all — a service webhook must answer on the portal
  the profile names, and the profile's secret there is a full incoming-webhook
  URL whose host the broker derives itself. The connect cards gained the shared
  service UI: the pre-checked "use the service token" box when the deployment
  defaults to it, a connect form without a secret field, the mode row with the
  switch buttons, and the seven service error explanations.

  Sensitive reads stay personal everywhere: CI logs and artifact bodies on
  GitLab/TeamCity as before, and now the Bitrix24 people directory, chats,
  open lines, call transcripts, calendars and Drive files, the Test IT
  attachments (metadata included — a global attachment id cannot be mapped to a
  boundary project, so it fails closed), and Jira attachment listings. Catalogs
  without a log-like read (Confluence, Weblate) report no sensitive capability.
  Everything a provider update adds without an explicit classification stays
  denied, as before.


### 🩹 Fixes

- The operator card reads as grouped blocks instead of one flat run of fields. ([945ac51](https://github.com/xarleyn/dsh-plugins/commit/945ac51))

  Every provider section used to be a single grid of fourteen to twenty-three
  controls in source order: the provider switch, the instance editor, the
  capability toggles and the numeric limits all carried the same weight, so a two
  column layout could put an instance row next to "Профиль: чтение" and the
  knobs a reader rarely touches sat between the ones they came for. Each section
  now has four labelled blocks — «Провайдер», «Подключение» (connection editors
  own the full width), «Что доступно агенту» as a checklist whose box leads the
  label, and «Ограничения и повторы» folded away until someone asks for it.
  Capability keys and their defaults are unchanged, only the headings that say
  what belongs with what are new.

  A collapsed section also says what it holds: `включён · 1 инстанс · доступно
  7 из 7`, computed from the same values the toggles show, so a reader can see
  which provider is off or half-open without expanding seven sections. Field
  captions are now real `<label>`s tied to their inputs, which makes a caption
  click land in the field and lets assistive technology name it.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.10.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.6.0 (2026-09-18)

### 🚀 Features

- Managed service credentials for GitLab and TeamCity. ([bc39062](https://github.com/xarleyn/dsh-plugins/commit/bc39062))

  A deployment can now publish one read-only credential it owns, so a user who
  cannot mint a personal access token — or does not want to — can still work
  through the integration layer. A profile is deployment configuration: the
  provider instance it belongs to, the label users see, the mounted secret, and
  the resources it may read. A new connection starts on that credential when the
  deployment says so; an existing connection keeps the credential it already had,
  because an upgrade must never move somebody onto a shared account.

  The shared credential is not simply read-only. Every operation carries security
  metadata — effect, sensitivity, and whether the managed credential may reach it —
  and service mode runs only what is a read, of normal sensitivity, explicitly
  classified as safe. Writes, admin actions, permission and credential management
  stay unreachable even when the service token upstream allows them, and sensitive
  reads stay personal-only: GitLab CI job logs, TeamCity build logs and text
  artifacts. A confidential GitLab issue is never returned through the shared
  account — not by id, not in a listing, and not in a search — and a search of
  notes, where the parent's confidentiality cannot be checked at all, stays
  personal. An operation the provider does not classify is denied, so a tool added
  by a later provider update is not reachable through the shared credential until
  someone classifies it on purpose. An administrator can narrow the ceiling, never
  widen it.

  Because the shared account sees far more than one user should, every profile
  carries a resource allowlist that is a hard upper bound. A service-mode call
  resolves the project it names against that list, a build addressed by its id is
  first resolved to its owning project, and a listing that names no resource is
  refused rather than answered with the whole instance view. Expanding a GitLab
  group asks for the group's own projects and checks every one that comes back, so
  a project shared into it from elsewhere stays out. A user may narrow the list
  further from the card; a selection outside it is dropped rather than stored.

  There is no fallback in either direction: a `403` in personal mode is a denial
  and is not retried with the service account, and the reverse holds too. A stored
  personal credential stays inactive while a connection runs on the service
  credential, and either side can be chosen later — switching bumps the binding
  revision that everything derived from the previous identity is keyed by. The
  secret is read from its file on each call and identified by a content hash, so
  rotating a mounted secret takes effect on the next call without anyone
  reconnecting. Upstream only ever sees the service account, so every audit row
  records the authenticated QA user, the operation, the credential source and the
  service profile.

  GitLab's single `ci.read` capability split in two: `ci.metadata.read` for
  pipelines, jobs and statuses, and `ci.logs.read` for what a job printed, which
  is personal-only. The deployment switches follow (`ciMetadataRead`,
  `ciLogsRead`); the pre-split `ciRead` still works and governs both halves, and a
  connection that stored the old capability id is repaired at startup with the
  policy it had set.

  Bitrix24, Jira, Confluence, Test IT and Weblate are unchanged: they offer no
  service mode, and their cards show nothing about it.

- Give `bitrix_search_crm` the filters the audit kept reaching for, and pin the page order so offset paging stops repeating rows. ([6a8d677](https://github.com/xarleyn/dsh-plugins/commit/6a8d677))

  The tool could only narrow by title substring and assignment, so typical questions ("open deals in this funnel", "what moved recently") degenerated into paging through the archive from the first page of ten thousand. The schema now carries `stageId`, `categoryId`, `openOnly` (deals only — the universal item API exposes `closed` for deals), `createdSince`, `updatedSince`, `orderBy` (`id`/`createdTime`/`updatedTime`) and `orderDir`. Every search now sends an explicit deterministic order: offset paging over an unspecified order is what produced identical pages at different offsets. An empty `query` now fails with the repair named in the message — `query is invalid: a non-empty title substring …` — instead of a bare `query is invalid` that one session retried verbatim; the tool description also points at `bitrix_get_crm_stage_history` for the "sitting in a stage too long" question the search could not express.

- Add `bitrix_add_crm_timeline_comment`, the provider's first write tool, behind an operator switch that defaults to off. ([7e70a4f](https://github.com/xarleyn/dsh-plugins/commit/7e70a4f))

  QA tasks kept asking the agent to "add a note to the deal", and the agent — holding only read tools — promised a write it could not perform. The new tool adds exactly one comment to the timeline of a lead, deal, contact or company (`crm.timeline.comment.add`); smart processes and every other mutation stay out of the surface. It mounts only when the deployment sets `bitrix24.crmCommentWrite: true`, rides the new `crm.comment.write` capability, and even then starts policy-denied until the capability is explicitly allowed for the integration. Three gates, because Bitrix24 has no read-only webhook scope: a `crm`-scoped webhook can write on its own, so the flag — not the scope probe — is what bounds the deployment, and the policy is what bounds the user. The read catalog of thirty-nine tools is unchanged and stays mounted whatever the flag says.

- Explain the credential field: where each provider's token comes from, what to ([4561073](https://github.com/xarleyn/dsh-plugins/commit/4561073))
  grant it, and where the deployment can point somewhere else.

  Every provider card ends in a secret field, and until now each one explained
  itself in its own words — a sentence in the card, or nothing at all where the
  answer was long. That copy is now metadata declared next to the provider
  (`src/providers/<id>/credential-help.ts`): the credential mechanism, the page
  that issues the credential, the vendor documentation, the required permissions
  and the steps, with the trigger wording picked from the mechanism, so an OAuth
  connection is not told to "create a token" and a Bitrix24 incoming webhook says
  what it actually needs. The cards lost the guidance that duplicated it; the
  sentence about how the secret is stored stays where it was.

  The help reaches the browser on the authenticated `qaIntegrations/providers`
  call, already merged with the deployment's overrides. It is metadata only: no
  credential value, snapshot or authorization result travels in the payload, and
  the credential architecture is untouched — secrets stay write-only, encrypted
  at rest and invisible to the browser. Because the addresses live in the Host,
  a deployment can replace any of them per provider through
  `credentialHelp.<id>` in its config — corporate GitLab, Jira Data Center, an
  internal wiki, a proxy gateway — or turn the help off for one provider without
  touching the field.

  Failure stays proportionate. Metadata is never a runtime dependency: without it
  the card renders the plain field; an unusable address hides only its own link
  and is reported once at startup as `credential-help.override`; an unknown
  mechanism degrades to `custom`; and a vendor page that moved cannot fail a
  connection. Only `http(s)` renders — `http:` only for loopback, private and
  self-hosted hosts — and external links open with `noopener noreferrer`.

  The gate follows the same line: `verify:package` asserts that every provider
  ships its declared help and that no declared address reaches the client bundle,
  and the bundle's design tokens are checked against the tokens the Host actually
  defines.

- Add a sixth provider to the integrations plugin: Test IT, read as the connected ([383878b](https://github.com/xarleyn/dsh-plugins/commit/383878b))
  QA user through their own API token. It ships twenty-two read-only tools — the
  projects and sections of the test library, test cases, checklists and shared
  steps with their steps, attributes and tags, the change log and comments of a
  case, test plans with their per-plan summary, runs with the test points and
  results inside them, single results with their messages and traces, attachment
  metadata, a bounded text read of a small attachment, autotests and the
  configurations a result is recorded against.

  A Test IT installation is operator configuration: `testit.instances` lists the
  Cloud tenants and on-premise TMS servers this deployment allows, the connect form
  only picks from that list, and the address is re-resolved from config on every
  call, so removing or repointing an instance closes existing connections too. The
  token travels as the `PrivateToken` authorization header and nowhere else.

  The catalog holds GET endpoints only, which is what this package's read-only
  guarantee is written as: Test IT's search and statistics endpoints are all POSTs,
  so the provider reaches the same ground through the GET surface — a run's test
  points instead of its statistics, a plan's summary instead of a filtered
  aggregate — and the tools it cannot back that way are listed as missing in the
  README rather than smuggled in. Three of the reads it does use are the endpoints
  Test IT marks deprecated; they are the only GET reads of those collections, and a
  version that drops them answers an honest "not available here".

  Test IT text is untrusted content: descriptions, steps, comments, messages and
  traces reach the model as bounded blocks under `untrustedContent`, and an
  attachment is described by Test IT itself before a byte is requested, so archives,
  images and oversized files are refused by the server's own account of the file.

- Add a sixth provider to the integrations plugin: Weblate, the localization ([0a50bde](https://github.com/xarleyn/dsh-plugins/commit/0a50bde))
  platform, read as the connected QA user. It ships nineteen read-only tools —
  the connection itself, projects, components, languages of a component, string
  search, a single string with every plural form and its state, the comments and
  suggestions left on it, checks that fail, statistics and change history — and
  the catalog carries no operation that could change Weblate state, so
  suggestions, comments, edits, approvals, translation files and the repository
  stay out until the confirmation framework exists.

  A connection is one of the operator's configured instances plus a Weblate API
  token, kept in one encrypted credential; the connect form picks the instance
  and never types a host, and the address is re-resolved from deployment config
  on every call, so an instance the operator removes fails closed instead of
  moving a token somewhere else. Token prefixes (`wlu_`, `wlp_`) reach the user
  as a label — personal or project-scoped — and are never treated as a permission
  check.

  Weblate's search grammar is composed by the provider from validated filters
  rather than accepted from the model: values are quoted and escaped, states come
  from Weblate's own `is:` vocabulary, and a follow-up request is reconstructed
  from the page number of the upstream `next` link, only when that link points at
  the configured instance. Every answer that carries upstream-authored text — a
  source string, a translation, a comment, a change — is marked as untrusted
  external content, and localization strings handed to the model are bounded and
  say when they were cut.


### 🩹 Fixes

- Expose account integrations as a feature-owned Plugins tab so the original DSH ([84b3c4c](https://github.com/xarleyn/dsh-plugins/commit/84b3c4c))
  settings UI can open them from authenticated LAN browsers without depending on
  loopback-only settings discovery.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.9.0
- Updated @yadsh/dsh-plugin-kit to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.0 (2026-09-17)

### 🚀 Features

- Keep connections and their audit trail in a database instead of one JSON ([e9a1e66](https://github.com/xarleyn/dsh-plugins/commit/e9a1e66))
  document.

  The store was read, parsed and rewritten whole on every operation, and it held
  the audit trail — the part that grows with usage — inside the same document as
  the connections: every lookup parsed every audit row ever written, and the
  broker appends a row per tool call. A store with a working audit trail made
  each call more expensive than the last. Connections, encrypted credentials,
  per-operation policies and the audit trail are tables now, so a lookup reads the
  row it asks for and a call appends the row it produces.

  Two bounds keep the audit trail finite: `auditRetentionDays` (90 by default,
  0 to keep by age only) and a hard cap of the newest 5000 rows whatever the age
  bound says. Both are applied as rows are written.

  The pre-0.8.0 `qa-integrations.json` is imported on first use — connections,
  credentials, policies and audit — verified inside the transaction, and renamed
  to `qa-integrations.json.migrated-<ISO>`. A leftover file never overwrites a
  live connection: the operator's working credential wins, and the file is left
  where it is.

- Add a sixth provider to the integrations plugin: Test IT, read as the connected ([6ef77da](https://github.com/xarleyn/dsh-plugins/commit/6ef77da))
  QA user through their own API token. It ships twenty-two read-only tools — the
  projects and sections of the test library, test cases, checklists and shared
  steps with their steps, attributes and tags, the change log and comments of a
  case, test plans with their per-plan summary, runs with the test points and
  results inside them, single results with their messages and traces, attachment
  metadata, a bounded text read of a small attachment, autotests and the
  configurations a result is recorded against.

  A Test IT installation is operator configuration: `testit.instances` lists the
  Cloud tenants and on-premise TMS servers this deployment allows, the connect form
  only picks from that list, and the address is re-resolved from config on every
  call, so removing or repointing an instance closes existing connections too. The
  token travels as the `PrivateToken` authorization header and nowhere else.

  The catalog holds GET endpoints only, which is what this package's read-only
  guarantee is written as: Test IT's search and statistics endpoints are all POSTs,
  so the provider reaches the same ground through the GET surface — a run's test
  points instead of its statistics, a plan's summary instead of a filtered
  aggregate — and the tools it cannot back that way are listed as missing in the
  README rather than smuggled in. Three of the reads it does use are the endpoints
  Test IT marks deprecated; they are the only GET reads of those collections, and a
  version that drops them answers an honest "not available here".

  Test IT text is untrusted content: descriptions, steps, comments, messages and
  traces reach the model as bounded blocks under `untrustedContent`, and an
  attachment is described by Test IT itself before a byte is requested, so archives,
  images and oversized files are refused by the server's own account of the file.

- Add a sixth provider to the integrations plugin: Weblate, the localization ([8a92740](https://github.com/xarleyn/dsh-plugins/commit/8a92740))
  platform, read as the connected QA user. It ships nineteen read-only tools —
  the connection itself, projects, components, languages of a component, string
  search, a single string with every plural form and its state, the comments and
  suggestions left on it, checks that fail, statistics and change history — and
  the catalog carries no operation that could change Weblate state, so
  suggestions, comments, edits, approvals, translation files and the repository
  stay out until the confirmation framework exists.

  A connection is one of the operator's configured instances plus a Weblate API
  token, kept in one encrypted credential; the connect form picks the instance
  and never types a host, and the address is re-resolved from deployment config
  on every call, so an instance the operator removes fails closed instead of
  moving a token somewhere else. Token prefixes (`wlu_`, `wlp_`) reach the user
  as a label — personal or project-scoped — and are never treated as a permission
  check.

  Weblate's search grammar is composed by the provider from validated filters
  rather than accepted from the model: values are quoted and escaped, states come
  from Weblate's own `is:` vocabulary, and a follow-up request is reconstructed
  from the page number of the upstream `next` link, only when that link points at
  the configured instance. Every answer that carries upstream-authored text — a
  source string, a translation, a comment, a change — is marked as untrusted
  external content, and localization strings handed to the model are bounded and
  say when they were cut.

- Add a fourth provider to the integrations plugin: Confluence Cloud, read as the ([1abee9d](https://github.com/xarleyn/dsh-plugins/commit/1abee9d))
  connected QA user. It ships eight read-only tools — the connected account and
  site, typed CQL search, a page with its body rendered from Atlassian Document
  Format, page comments with replies, attachment metadata, page versions and
  spaces — and the catalog carries no operation that could change Confluence
  state.

  A connection is an operator-configured site plus an Atlassian API token and the
  account e-mail, kept together in one encrypted credential, and a model tool can
  never name a site, an account or a credential. The site address is re-resolved
  from deployment config on every call, the space allowlist
  (`confluence.allowedSpaces`) is enforced on search and on direct reads alike,
  and every page or comment body reaches the model as untrusted content under its
  own key.

  A search accepts its modification window either as an absolute day or as a span
  counted back from today (`-7d`, `-2w`, `-1m`, `-1y`), resolved against the
  provider's own clock, so an agent whose prompt carries no clock can still ask
  what changed this week.

- Stop retrying GitLab calls the deployment itself timed out, and name a TLS refusal as such. ([3030464](https://github.com/xarleyn/dsh-plugins/commit/3030464))

  The GitLab transport folded every failed fetch — including the abort of its own
  per-request deadline — into a single `ProviderUnavailable` error and spent a
  retry on it. A slow GitLab therefore waited for `timeout × (retries + 1)`
  before the user saw anything, and an untrusted certificate surfaced under the
  same "provider is unavailable" reason as a network outage, sending the operator
  to check reachability instead of the trust store.

  The transport now shares the TeamCity transport's failure classification: an
  aborted deadline is reported as `UpstreamTimeout` and is never re-sent, a
  failed TLS handshake is reported as `TlsFailure`, and only genuinely transient
  network faults are retried. The GitLab settings card carries the same
  human-readable explanations for the two new reasons that the TeamCity card
  already showed. The TeamCity provider's behavior is unchanged.

- Add a fourth integration provider, `jira`. A QA user connects their own ([4183b83](https://github.com/xarleyn/dsh-plugins/commit/4183b83))
  Atlassian account with an API token and gets a read-only catalog of eight tools:
  the connected identity and site; issue search over projects, statuses,
  assignee/reporter, labels and dates; one issue with its description, relations,
  attachment metadata, a comment count and its custom fields; the comments of an
  issue with their visibility; attachment metadata; the transitions available to
  the connected user; one project; and the site's field catalog.

  Sites are operator configuration, never user input: the connect form picks from
  the configured list and sends the e-mail and the token alone, so an arbitrary
  hostname can never reach the broker. A site address is validated at config load
  (HTTPS unless a deployment opts into plain HTTP for a lab, no credentials or
  query in the URL, stable id) and is not stored in the credential — it is
  re-resolved on every call, so removing or repointing a site closes the
  connections made against it instead of silently redirecting a token. The token
  travels as HTTP Basic over `email:token` in the `Authorization` header of a GET
  that never follows a redirect, and the credential is refused outright when it is
  not an Atlassian API token — a pasted URL, a `email:token` pair or a YAML snippet
  never leaves the process.

  The model gets no JQL. Every tool carries typed filters, and the provider builds
  one query from them: values are quoted as JQL string literals with the quote and
  the backslash escaped, control characters are refused, project and issue keys are
  shape-checked, a name where Jira needs an account id is refused (Jira would
  answer an empty page instead), labels are ANDed, and a search without a single
  filter is refused rather than turned into "every issue of the site". Search reads
  the enhanced endpoint Jira Cloud serves today (`/rest/api/3/search/jql`) with
  Jira's own continuation token as the cursor, keeps the page inside the
  deployment's ceiling and Jira's own 100 rows, and never walks pages by itself.
  Issue bodies arrive as Atlassian Document Format and are rendered to bounded
  markdown-like text (headings, lists, code, links, mentions, tables, media
  markers) — a JSON tree and an embedded card are never handed to the model, and
  nothing a node points at is fetched. Custom fields are named from the site's
  field schema, read after the issue answered and never cached, because the same
  site answers a different field list to two users with different permissions.

  The filter vocabulary is the one a corporate Jira is actually asked about, so a
  search can move off a query-string engine without losing questions: project, issue
  type, status and its category (`Done` covers every terminal status, whatever the
  workflow calls it), priority, resolution, components, labels (all of them, not
  any), fix and affected versions including "none set" and "set", assignee and
  reporter, created/updated bounds in both directions, and custom fields either by
  the id the field catalog reported or by an alias the deployment declared. Dates
  take absolute values and Jira's own relative
  tokens (`-3w`, `-2d`), a free-text query is either every word or the exact phrase
  (with each term its own escaped clause, so an `OR` inside a phrase stays a word),
  and the history of one issue is readable through `include: ["changelog_summary"]`
  — bounded to twenty field changes and honest about which of the two cuts
  happened. A person is accepted as `me`, as an account id, or as a name: the name
  is resolved through the site's own user directory, and a name nobody matches or
  several people share is refused with what to do next instead of being spent on a
  query that quietly answers "no such issues".

  `jira.fieldAliases` is where an instance's custom fields get their names: which
  of a site's fields carries "the product" is knowledge about that site, so this
  package carries no field id at all, the mapping is validated when the config is
  resolved (a typo fails the load rather than answering nothing), an unknown name
  is refused together with the aliases that do exist, and `jira_get_fields` hands
  the model the aliases it may use.

  The catalog is an explicit allow-list of Jira Cloud read endpoints, asserted by
  the package gate along with the `GET` method of every entry, the absence of the
  legacy `/search` endpoint Atlassian removed, and the absence of any JQL argument
  in a tool schema. The reads the provider makes beside an operation — the
  deployment type at connect and the people directory behind a name filter — are
  declared in the same allow-list. A deployment type check refuses a Data Center
  instance at connect instead of pretending the Cloud API is compatible.
  Capabilities are bounded by the deployment switches alone (`identity.read`,
  `issues.read`, `comments.read`, `attachments.read`, `transitions.read`,
  `projects.read`, `fields.read`): Jira reports no granted scopes for an API token
  and probing with a write is not an option, so the site's own permissions decide
  upstream and a refusal stays a refusal.

  OAuth 2.0 3LO with rotating refresh tokens, the shared Atlassian
  account/resource layer the specification describes, the workspace-to-project
  binding, the pending-action confirmation flow every write needs, attachment
  content download, a typed filter over the change history (`WAS`/`CHANGED`), the
  caching and per-principal rate limiting stay out of this release; the provider's
  README states each deferred item and what stands in for it today.


### 🩹 Fixes

- Align provider examples and fixtures with the documented public placeholder ([dc105c7](https://github.com/xarleyn/dsh-plugins/commit/dc105c7))
  conventions. No runtime behavior changes.

- Expose account integrations as a feature-owned Plugins tab so the original DSH ([9bc334e](https://github.com/xarleyn/dsh-plugins/commit/9bc334e))
  settings UI can open them from authenticated LAN browsers without depending on
  loopback-only settings discovery.

- Write the operator-configured TeamCity address down where the deployment's ([66a4430](https://github.com/xarleyn/dsh-plugins/commit/66a4430))
  configuration is documented. The "how TeamCity connects" section, the TeamCity
  config example and the end-to-end deployment example all show
  `teamcity.serverUrl` now, and the walkthrough no longer tells users to type the
  server into the connect form — the address is one per stand and comes from the
  deployment, while the form asks for the token alone.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.8.0
- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-16)

### 🚀 Features

- Move the TeamCity address out of the connect form and into the deployment's ([4694ade](https://github.com/xarleyn/dsh-plugins/commit/4694ade))
  configuration. One TeamCity serves the whole stand, so asking every user to type
  the same host only invited a broker pointed at a host of the caller's choosing;
  `teamcity.serverUrl` is now operator input, canonicalized and checked against
  the address policy while the config is resolved, re-checked on every call, and
  never stored in the credential. Repointing or removing it closes every
  connection made against the old value.

  The card shows the configured address as a line of text and asks for the token
  alone. A deployment that mounts TeamCity without an address is valid but inert:
  the card says there is nothing to connect to instead of offering a form whose
  save would be refused. Existing connections keep working — a credential stored
  with the address the old form collected is accepted and read for its token, and
  the token is now spent against the deployment's address.

  `teamcityServer` joins the plugin's RPCs so a card can learn the address without
  one; it is token-gated like the GitLab instance list, because the address of a
  stand's CI is not something an unauthenticated caller needs.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.4

## 0.3.2 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.3

## 0.3.1 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.2

## 0.3.0 (2026-09-16)

### 🚀 Features

- Mount the integrations as a card of the host's "Plugin configuration" tab. A ([3b2f09b](https://github.com/xarleyn/dsh-plugins/commit/3b2f09b))
  connection belongs to a QA account, and until now the only surface that could
  carry it was the `Интеграции` page inside the QA settings dialog: the card of
  the plugins list is dispatched by a settings namespace, and this plugin served
  none. The deployment now installs a mount-only `qa-integrations` section (the
  provider switches, the address policy and the vault path stay composition-time
  decisions, so the section carries nothing an operator could edit), and the
  browser half registers the card under that namespace through the shared
  `dsh-plugin-card` shell.

  The card renders one provider card per mounted provider, exactly as the QA page
  does — both mounts share the component — and reads the account through the new
  `qaUserSession` client service of `@yadsh/dsh-qa-surface`. Without a signed-in
  QA account it says so instead of showing connect forms whose every call would be
  refused, and it stays closed (and therefore reads nothing) until it is opened.

  The credential forms gained the fix they needed to be usable at all: the primary
  button asked for `--dsw-alias-label-on-brand`, a token the DSH theme does not
  define, so the label inherited the card's own colour and the button rendered as
  a grey pill with no text. The status badge and the danger action were painted
  with two more non-existent tokens (`--dsw-alias-success-primary`,
  `--dsw-alias-error-primary`) that cost the status its green and the error box its
  border. All three now use the tokens the first-party cards use, and the package
  gate rejects the dead names.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-16)

### 🚀 Features

- Add a second integration provider, `gitlab`, and turn the settings section into ([50f0737](https://github.com/xarleyn/dsh-plugins/commit/50f0737))
  one card per mounted provider. The provider connects a QA user to their own
  GitLab identity with a personal access token and exposes a read-only catalog of
  23 tools: connection identity; project search and project cards; repository tree,
  file reads with metadata, commit lists, single commits and ref comparison;
  cross-GitLab search over projects, issues, merge requests, commits, code and
  comments; issues with their notes; merge requests with changed files,
  discussions, approvals and attached pipelines; and pipelines with their jobs and
  logs.

  Instances are operator configuration, never a user input: the connect form picks
  from the configured list, so an arbitrary hostname can never reach the broker.
  The instance address is validated at config load (HTTPS unless a deployment
  opts into plain HTTP for a lab, no credentials or query in the URL, stable id)
  and is not stored in the credential — it is re-resolved on every call, so
  removing or repointing an instance closes access to tokens minted for it instead
  of silently redirecting them. Requests are GET-only, never follow redirects, and
  carry the token in the `PRIVATE-TOKEN` header alone.

  Capabilities follow the scopes the token really reports: on connect and on every
  connection test the provider asks GitLab what the token holds
  (`/personal_access_tokens/self`) and offers `identity.read`, `projects.read`,
  `repository.read`, `search.read`, `issues.read`, `merge_requests.read` and
  `ci.read` only where the deployment switch and the token agree. A token that
  cannot read itself costs precision, not safety, because the deployment switches
  still bound the surface. Repository files and CI logs are size-bounded before
  they reach the model, binaries and oversized bodies answer with metadata and a
  truncation marker instead of raw bytes, diff text spends a shared character
  budget, and job logs pass through secret redaction — GitLab's own masking is a
  filter, not a promise.

  The write surface, OAuth with PKCE, the user-selectable project boundary, the
  pending-action confirmation flow, caching and webhooks stay out of this release;
  the provider's README states each deferred item and what stands in for it today.

  The shared engine stays provider-agnostic: `parseCredential` gained an optional
  non-secret options map so a connect form can name the instance a token belongs
  to, the error model gained `ResourceNotFound`, `RateLimited` and
  `ResultTooLarge`, and redaction learned the `glpat-` token shape. Package
  verification now asserts the GitLab catalog is read-only, that no tool schema
  carries a user, credential or instance selector, and that neither provider's
  name leaks into the shared modules.

- Extend the Bitrix24 integration from four tools to a read-only catalog of 39, ([a882f1e](https://github.com/xarleyn/dsh-plugins/commit/a882f1e))
  covering CRM context, employees and departments, chats and open lines, tasks,
  calendar and Drive. Each tool is one catalog operation with a validated,
  read-only argument set: CRM schema and funnels, stages and status dictionaries,
  activities with deadlines, timeline comments, stage history, product rows,
  duplicate lookup by phone or e-mail, requisites and AI call transcriptions;
  employee search by name, e-mail or department and the readable employee field
  list; chat search, recent dialogs, message search inside a chat, the chat
  attached to a CRM entity, task or calendar event, its participants and their
  profiles, and open-line dialog history; task search, single task cards, task
  change history, results and logged time; calendar events and free/busy lookup;
  and Drive full-text search, file metadata, storages and folder contents.

  Replace the two capabilities with one per Bitrix24 webhook scope — `crm.read`,
  `chat.read`, `openlines.read`, `user.read`, `department.read`, `tasks.read`,
  `calendar.read`, `disk.read` — and read the scopes the connected webhook was
  actually granted (`scope` method) on connect and on every connection test. The
  Settings card therefore lists a capability as available only when both the
  deployment switch and the portal agree, and a scope granted later in Bitrix24
  appears as a detected but disabled capability that the user enables themselves.
  Owner-scoped reads default to the connected Bitrix24 user, resolved server-side
  from the stored integration, never from a model argument.

  List operations now answer with a uniform `{ items, pagination }` envelope, so
  the model sees one response shape instead of six, and id-keyed responses such as
  open-line history are projected into ordered arrays. Capability labels come from
  the provider at runtime and the effective policy arrives as capability/mode
  pairs, so the Settings card renders a provider it has never heard of.

  The plugin is laid out as one directory per integration under
  `src/providers/`, with the shared engine — broker, repository, secret store,
  tool plumbing — naming no integration at all, which is what the next provider
  (Jira, GitLab, TeamCity) plugs into.

  Three Bitrix24 documentation ambiguities shape the surface: `user.search` is not
  called because its parameter table and its examples disagree about where filter
  keys belong, while `user.get` with `FILTER.NAME_SEARCH` is documented in one
  shape; tasks use the classic methods because REST 3.0 moved to `/rest/api` and
  filters tasks by id only, which cannot express "my open tasks"; and
  `imopenlines.session.open` is not exposed because its page never certifies it as
  read-only, the same dialog lookup being a documented get on
  `imopenlines.dialog.get`.

- Add a third integration provider, `teamcity`, as a read-only catalog of 13 ([83a4760](https://github.com/xarleyn/dsh-plugins/commit/83a4760))
  tools: server identity and version; project search; build configurations; build
  search by project, configuration, branch, status, state and date; one build in
  full; its version control changes; its failures — failed tests and build
  problems in one answer, because "why did this break" is one question; a bounded
  window of its build log; the build queue; investigations; agents; artifact
  metadata; and small text artifacts. Nothing in the catalog can change TeamCity
  state: trigger, retry, cancel, comment and tags wait for the pending-action
  confirmation the specification requires for them, and the parameters endpoints
  are never called, so secret build parameters cannot reach the model at all.

  Unlike GitLab's operator-declared instances, the TeamCity address is user input
  — the server is usually self-hosted — so it is governed by a deployment address
  policy instead of a list: `allowlist` mode with `allowedHosts`, `allowedCidrs`
  and `allowedPorts`, or `trusted-private` for a company network that trusts its
  own DNS. The policy is checked when the connection is stored and again on every
  call, so tightening it closes existing connections rather than only new ones;
  plain HTTP needs an explicit opt-in, ports are explicit (TeamCity's own 8111
  included), redirects are never followed, and the token travels only in the
  `Authorization` header. An empty policy is inert rather than fatal — the plugin
  logs it at startup instead of failing to load — while a typo in it fails loudly,
  because a silently dropped host pattern would leave users with no explanation.

  Log text and artifact text are treated as untrusted external content: the log is
  downloaded up to a byte budget, stripped of terminal control sequences and
  repaired Unicode, redacted, and cut to the requested lines, with `truncated` and
  `logTruncated` telling apart "the window was cut" from "the log is longer than
  what was downloaded". Artifacts are refused by name before a byte is requested
  when they are archives, images, binaries, documents or key material, binary
  bodies answer with metadata instead of bytes, and paths with `..`, absolute
  paths, backslashes, control characters and archive components (`a.zip!/b`) are
  rejected. Lists answer with the same `{ items, pagination }` envelope the other
  providers use, and the provider never follows `nextHref`: `pagination.hasMore`
  says the page was cut, page sizes stay inside the specification's caps, and a
  model that asks for more than the cap gets the cap rather than an error.

  The shared engine gained what this provider needed and nothing else: the error
  model learned `UpstreamTimeout` (a server that did not answer in time is worth
  retrying as it is) and `TlsFailure` (an untrusted certificate is an operator
  problem, not a user one), and redaction learned the shapes a CI job actually
  prints — `password=…`, `api_key: …`, `--token …` — because log text arrives as a
  plain string, where a field-name rule can never see it. Package verification now
  asserts the TeamCity catalog is read-only, that no tool schema carries a user,
  credential or server selector, and that the address policy is enforced on every
  call.

  TeamCity cannot report what a token was restricted to, so capabilities are
  bounded by the deployment switches and by TeamCity's own permissions, which
  surface as `ProviderPermissionDenied` — the provider never tries another
  credential. The address policy, rate limiting, caching, webhooks, automatic
  multi-page aggregation and the write surface stay out of this release; the
  provider's README states each deferred item and what stands in for it today.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-15)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.1

## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce principal-scoped user integrations for QA Surface with an initial ([0bf810f](https://github.com/xarleyn/dsh-plugins/commit/0bf810f))
  read-only Bitrix24 provider. The plugin adds a first-class Russian Integrations
  settings page, write-only manual webhook setup, envelope-encrypted secret
  storage, per-user policy and audit records, and four narrowly scoped CRM/chat
  tools whose schemas cannot select a user or credential.

  QA Surface gains a public client settings-section registry and owner-attested
  integration principal binding. Admin cross-user viewing, unowned sessions and
  subagents do not inherit access to another account's integration.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn
