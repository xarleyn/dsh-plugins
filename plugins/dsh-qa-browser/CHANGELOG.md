## 0.4.1 (2026-10-08)

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

- xarleyn @xarleyn

## 0.4.0 (2026-10-04)

### 🚀 Features

- The Browser runtime can now drive a Chromium it did not start. ([#202](https://github.com/xarleyn/dsh-plugins/issues/202))

  `runtime.mode` chooses where the browser comes from. `launch` — still the
  default, and still the shape DOCKER.md puts first, the image that carries its
  own Chromium — owns one process: it starts it for the first session and closes
  it on teardown. `attach` joins a browser that is already up, through its DevTools
  endpoint, and the runtime's own teardown drops the link and the contexts it
  created while leaving the process and a person's own tabs alone. The provider
  seam existed for exactly this, so the SPEC's "remote CDP" landed as a second mode
  of the Playwright provider instead of a third provider or a new package.

  The endpoint is a control handle — whoever holds it drives that browser, past
  this plugin's own network policy — so `runtime.cdpEndpoint` names this machine
  by default and any other host needs `runtime.allowRemoteCdpEndpoint: true`
  written next to it. The default is read exactly: `localhost`, `127.0.0.1`, `::1`,
  and the forms the URL parser itself resolves into those (`http://127.1`,
  `http://2130706433`). A `*.localhost` name counts as another host, and so does
  `localhost.` with its trailing dot, which is a DNS query rather than the literal:
  the runtime never resolves the endpoint itself, so a name whose answer a search
  domain or a resolver can change proves nothing. For an `http` endpoint what the
  gate bounds is the first hop — that server replies with the `ws` URL Playwright
  then dials — so a deployment that must pin the dialled address writes a `ws` URL.
  What the gate opens is not a browser that answers, either: Chromium replies to a
  DevTools request only when its `Host` header is an IP address or `localhost`, on
  the `/json/version` question and on the `ws` upgrade alike, so a container's
  service name is refused by the browser itself and DOCKER.md now names an address.
  The opt-in run puts that question to a live browser rather than taking the shape
  on faith, and puts it to one started with `--remote-allow-origins` too. That flag
  guards the other header, and the run reads both directions of it: an upgrade
  carrying a page's `Origin` is refused by a browser started without the flag and
  carried through by one started with `--remote-allow-origins=*`, while a name in
  `Host` is refused with it set just as it is without it — which is why the guide
  names an address rather than a switch to reach for, and why it calls that switch
  not neutral: what the flag gives up is the endpoint's own guard against a page the
  browser loads dialling back into it.
  Attach mode owns no process, and the config says so rather than quietly ignoring
  the keys that would shape one — `headless: false`, an `executablePath`, a
  `browserChannel` other than `chromium`, and `chromiumSandbox: false` are each
  refused when the config resolves, as are `cdpEndpoint` and
  `allowRemoteCdpEndpoint: true` under `launch`, where there is no endpoint for them
  to open. A mode outside `launch` and `attach` is refused too, instead of falling
  into `launch` while the resolved config still carries the word that was written.

  Losing the browser now says which kind of loss it was. A dropped CDP connection
  reports `BROWSER_CONNECTION_LOST`, the panel reads "the connection to the
  browser was lost" instead of claiming a crash it cannot observe, and the host
  logs `browser.connection-lost`; our own process dying keeps `BROWSER_CRASHED`.
  Both rebuild the session on the next action, and both wait for the link or the
  process with mode-accurate wording while a first page opens.

  The launch path is not merely unbroken by this: both modes are pinned by the
  suite that runs on every `pnpm test`. Each one names the Playwright entry point
  it expects, the context options and network gates it builds on top of that
  browser — attached ones included —, what it reports when the browser goes away
  and under which log key each of the two losses reaches the operator, that an
  attached browser is never asked for the context it came with (`contexts()`
  is the one route a `Browser` handle offers to it, and the provider never calls
  it), where a session close stops and the runtime's own stop begins — closing the
  last of this runtime's contexts leaves the borrowed browser linked for the next
  session —, and what the config accepts, endpoint forms included. The opt-in
  Chromium run then covers what only a real browser can answer: it starts a
  Chromium outside the plugin, drives it over CDP, screenshots it, and checks that
  the plugin's teardown left that process running with its owner's page still in
  it — and, in a second
  case, kills the browser mid-session and reads the session back as a lost link
  rather than a crash. The network gates are exercised on that attached browser
  too, in both directions — the refused navigation, the refused socket handshake,
  the socket they permit still arriving at its server, and the service worker that
  reaches no address outside the gate — since a request path only a launched browser
  walked through would prove nothing about the mode this card ships, and a borrowed
  context that intercepted requests merely to drop them would answer every refusal
  correctly while leaving a session unable to hold a live connection. The `http` and
  the `ws` form the mode accepts are both dialled there: the deployment
  writes the address itself instead of asking a server for one, Playwright connects to
  it without asking anything where to go next, and an `http`-only run would have left
  that form untried against a real browser. The two secure spellings ride the same
  two branches, and the suite that runs on every `pnpm test` holds a case for each of
  the four, so a scheme dropped from the gate reddens the case standing for it rather
  than quietly turning a documented form into a refusal. The run also puts a second
  driver on that endpoint, the shape the Harness's own browser tool makes of a shared
  Chromium: a page opened through another connection, in the context the browser
  arrived with, neither lends its cookies and storage to a session of this plugin nor
  takes one, and the origin this plugin's policy refuses for a session is served to
  it — the two promises about coexisting drivers, read off a live browser instead of
  asserted. Each attach case finds its
  browser through the same search the launch path uses, so a
  run that was asked for and found nothing fails saying so — an attach case that
  quietly skipped would be the one result nobody could read. That run needs one
  variable, `DSH_QA_BROWSER_E2E=1`. This
  project's own CI job sets it, so the run belongs to what checks a change rather
  than to what someone runs when they remember.

  The network policy keeps running on an attached browser, with its premise moved:
  the gate resolves and classifies a destination in the Host process, while the
  browser dials from wherever the deployment started it. Where the two are one
  machine there is one answer, and that is every deployment that starts its own
  browser; a Chromium in its own container — the sidecar DOCKER.md draws for this
  mode — has its own resolver and its own `/etc/hosts`, so an allow-list written
  for the Host is a judgment about a name that browser may read differently.


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

- A page's WebSockets now pass the network policy, a stopped runtime stops for ([#344](https://github.com/xarleyn/dsh-plugins/issues/344))
  good, and a disposal finishes the session it was still building.

  The policy gate was installed on the request route, and a WebSocket handshake is
  never a request that route sees: a page could open a socket to any host the
  operator had blocked, and the refusal the panel shows for every other kind of
  destination simply never happened. A context now carries a socket route as well,
  installed while it still has no page — Playwright only routes sockets created
  after the registration — and a handshake the policy refuses is ended before the
  destination is offered one. Since the default `allowedSchemes` lists `http` and
  `https`, sockets are refused by that same default rather than quietly allowed;
  `ws` and `wss` open them deliberately. A service worker dials from outside every
  page, which puts its traffic past any route that covers pages, so a Browser
  context blocks workers instead of leaving that way out unattributed.

  A browser that finished starting after its runtime had been stopped was a
  process nobody owned: `stop()` looked at what existed at the moment it was
  called, so a launch still in flight published itself into a provider that had
  already closed, and a context built that late was listed after the list was
  emptied. Stopping is now a state the provider waits in — it drains the launch
  and the context builds it already admitted, closes what they produced, and turns
  away anything new until it is done — and a disposal joins the sessions still
  being created before it sweeps the map, so a session that finishes building
  during a shutdown is closed by that shutdown.

- Every part of the Browser panel now carries a `data-testid`, so a test can name ([#467](https://github.com/xarleyn/dsh-plugins/issues/467))
  the node it means instead of guessing it from the Russian text beside it.

  The panel's chrome is drawn from a handful of repeating classes — three nav
  buttons share one, the device and menu toggles share another, and both tab and
  stage use the same empty-state class — which left an automated check nothing
  stable to point at: it had to match a visible string, and a reworded label broke
  the test rather than the feature. Each zone of the panel now says what it is:
  `panel-*` for the container, `tabs-*` for the strip, `toolbar-*` for navigation
  and the address, `device-*` for the viewport row, `stage-*` for the page,
  `menu-*` for the actions popover and `status-*` for the footer. The values are
  ASCII kebab-case and unique in the package, and the menu entries carry the id of
  the action they offer.

  Nothing else moved: no class, no attribute the user sees, no layout — only the
  test attribute. The panel's own tests now reach the viewport readout, the
  blocked-tab marker, the stage canvas and the pointer-input chip by id, and keep
  asserting every control through its role or accessible name.

- The browser panel survives a 0.1.7-rc.2 host. ([#526](https://github.com/xarleyn/dsh-plugins/issues/526), [#509](https://github.com/xarleyn/dsh-plugins/issues/509), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  Every call the panel makes to its own `qaBrowser` Remote crosses a typert
  boundary, and those boundaries changed shape: a strict codec used to carry the
  shared schema as a `schema` field, and now carries a `create` factory that
  materialises the schema in the realm that needs it. The panel still handed over
  the field, so the host reached a codec with no `create`, and the first
  serialised argument — a click, a URL, a screenshot request — threw a `TypeError`
  instead of moving. Against an rc.2 host the panel was therefore not merely
  typewrong: it did not work.

  All seven descriptors now contribute a factory, and the tests that assert the
  chrome's own field requirements parse through it the way the runtime does. The
  schemas themselves are untouched, so nothing a panel accepts or refuses changed
  — the same tab fields, the same mouse buttons, the same click counts. What
  changed is that the host can read them.

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

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.14.0
- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.3.1 (2026-09-22)

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

- The product contract names the drafted evidence layer instead of leaving it unreachable. ([9e55443](https://github.com/xarleyn/dsh-plugins/commit/9e55443))

  `docs/specs/evidence.md` (Status: Draft) plans screenshots, console/network/
  trace capture, evidence bundles, automatic capture on failure and visual
  comparison, but nothing linked it from `SPEC.md`, so the plan behind the
  `vision`, `devtools`, `network` and `trace` capability groups could only be
  found by already knowing the path. §15.8 now points at it and says exactly how
  much of it ships: the viewport `browser_screenshot` slice, with the capture
  modes, the layers, the bundle and the comparison still unimplemented — which is
  why those groups default to off.

- The Browser panel reads one state instead of agreeing with itself. ([0e98bc7](https://github.com/xarleyn/dsh-plugins/commit/0e98bc7))

  Three facts the panel showed could disagree with the state behind them, because
  the render and the code that re-read the frame each worked them out separately:

  - the address field synced from the selected tab in an effect, so it settled one
    flush after the frame it belonged to and could show the previous tab's URL
    (this is the drift that flaked on CI, patched then on the test side only);
  - the frame memo remembered a revision without the tab it came from, and a
    revision is per tab, so two pages that were both never scrolled shared one
    number and switching between them kept the other page's image;
  - the heartbeat interval was rebuilt whenever a poll advertised a different
    lease length, which ran the teardown that hands the page back — the operator
    lost a lease they were still holding.

  All three are gone with the same change: the panel's derived view — the selected
  tab, this panel's lease, the refusals with the entry that explains them, the
  status line, the two control entries and the address — is computed once, in
  `panel-view.ts`, from the polled state and the operator's own draft. The
  container keeps what no pure function can own: the remotes, the polling, the
  frame memo keyed by tab and revision, and the draft in the address field.

  The status bar, the stage chip, the refusal banner and the address field render
  exactly what they rendered before; what changed is that they can no longer
  render a different answer than the one the panel acted on.

- Two more package gates become manifests for the shared runner instead of copies ([c3ea6d9](https://github.com/xarleyn/dsh-plugins/commit/c3ea6d9))
  of it (#231).

  `packages/plugin-scripts` has carried `runVerifyPackage` since the generator was
  folded in, and 20 of the 26 `plugins/*/scripts/verify-package.mjs` already pass
  their identity and expectations to it. The two largest scripts that still
  hand-rolled the same manifest, patch, file, export and bundle-registration
  checks - `dsh-qa-browser` and `dsh-documents` - now declare that contract as
  options and keep only what their own package can promise in the `extra` hook:
  the tool inventory and the defaults the browser runtime reads, and for the
  document pipeline the installed subsystem, the in-process `documents` face, the
  comparison tools, the skills that ship with it and the source scan that keeps
  `comparison/` away from a process or a socket.

  The runner gained the check those scripts kept re-writing: `exportsBuilt` makes
  every export subpath point at a file that exists, so a declaration the build
  never wrote fails here rather than only in a packing run. It also covers the
  export `types`/`default` conditions, which is what the hand-rolled loops in
  `dsh-documents`, `dsh-qa-integrations` and `dsh-qa-surface` did one by one.

  Because a manifest now satisfies the card contract through
  `clientBundle.cardContract` rather than by importing the module by path,
  `verify-package-hygiene`'s client-contract gate learns that form too - it
  accepts a script that reaches the runner with the option, and still refuses one
  that only mentions the word.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.2

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.3.0 (2026-09-22)

### 🚀 Features

- A refused destination reaches the operator, not only the model. ([076c518](https://github.com/xarleyn/dsh-plugins/commit/076c518))

  When the URL and DNS policy refused a request, only the model saw why: the
  refusal travelled back as a tool result, the tab did not load, and the person
  looking at the Browser panel had no way to tell a broken page from a deployment
  that will not reach an intranet host. The panel now carries it.

  The session keeps what the policy refused for the page it is on — the policy
  code, whether the refused request was the page itself or something the page
  asked for, the refused host, how many requests were refused, and the refusal
  text, which already names the class of address and the setting that lifts the
  block — and the panel renders it above the status line, with the part the
  refusal cannot know: that `security.network.allowHosts` opens one host while
  `security.network.allowPrivateNetworks` opens every private range to whatever
  the model asks for, so the choice between them is the operator's. The same
  facts are logged as `browser.policy-refused`.

  The two kinds are kept apart because they are different problems. A refused
  navigation means nothing opened. A refused request means the page did open and
  is quietly missing an asset or an API answer — the page that looks broken
  rather than the one that was blocked — and the banner says exactly that before
  it names hosts. The gates that record are the ones whose refusal nobody sees:
  the agent's `browser_navigate` and its history moves, plus the provider's
  pre-dial validation of every request Chromium dials, told what it is gating so
  the two kinds stay distinct. The panel's own navigation keeps answering in its
  error line, where the person who typed the address is already looking.

  The notice belongs to the tab whose page dialled the request, because that is
  the page the operator is looking at: the banner explains the selected tab, the
  strip marks the other tabs that carry entries, and a refusal with no page
  behind it — a service worker's request — is shown beside the selected tab's own
  entries. The attribution holds from the first request a page makes: its
  identity is minted by a registry on the first question about that page rather
  than when the handle is created, and both the session record and the tab are
  registered before anything can be waiting on them, so a refusal that arrives
  while a tab is still being built lands on that tab instead of nowhere. Per tab it is a list: one entry per destination, repeats counted
  instead of appended, at most eight destinations, and a navigation empties the
  notice of the tab that navigates without touching a second tab's explanation of
  the page it is still showing. A page that keeps retrying a blocked endpoint is
  one thing to fix, and a list that reshuffles as the page fails reads as noise
  rather than a cause.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.11.0

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.2.2 (2026-09-21)

### 🩹 Fixes

- The browser panel's page preview renders again, and the panel stops ([adb1c74](https://github.com/xarleyn/dsh-plugins/commit/adb1c74))
  spamming frame requests.

  The frame poll effect invalidated its own in-flight work: its cleanup
  bumped the request sequence, while its dependency list contained the tabs
  array — a fresh object on every poll — so the effect re-ran each tick and
  every arriving `panelFrame` response was discarded as stale before it
  reached the stage. The visible result was a panel frozen on «Получаем
  изображение…» forever while the network log filled with half-megabyte PNG
  responses nobody rendered.

  The effect now depends on a boolean busy flag (any tab loading or the
  panel holding the lease) instead of the array, and the cleanup no longer
  bumps the sequence — superseded responses are still dropped by the
  per-refresh guard, but a frame that settles after a re-run mounts. The
  idle poll interval is raised from two to five seconds; the frame itself is
  fetched only when the selected tab's revision changes, so an idle panel
  costs one small `panelState` call instead of repeated image transfers. A
  frame-carrying screencast channel remains the structural fix and stays a
  documented non-goal of this release.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.10.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-18)

### 🩹 Fixes

- Say why a host was blocked, and what lifts the block. ([f2e677b](https://github.com/xarleyn/dsh-plugins/commit/f2e677b))

  `Private-network destinations are blocked by Browser policy.` was the whole answer a model and an operator got for a corporate hostname the deployment's DNS resolves into an internal range — which is the ordinary shape of an intranet Jira or wiki, not an attack. The refusal now names the host, the class of the address it resolved to (RFC1918, carrier-grade NAT, IPv6 unique-local) and the setting that allows it: `security.network.allowHosts` for one host, `security.network.allowPrivateNetworks` for the deployment. The loopback and link-local refusals carry the same detail. No address is disclosed in the message: the class is what a fix depends on.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.9.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-17)

### 🚀 Features

- Re-check DNS immediately before the browser dials a host. ([f887079](https://github.com/xarleyn/dsh-plugins/commit/f887079))

  The Browser network policy resolved every destination host server-side and
  refused private, link-local and metadata answers, but the connection itself is
  made by Chromium, which resolves through its own recursive resolver. An
  authoritative DNS answerer under an attacker's control is free to hand the two
  resolvers different answers, so a hostname that checked out cleanly could still
  land the browser on an internal address.

  Every request now passes a double resolve just before Playwright lets it
  continue: the host is resolved a second time and compared with the address set
  the policy check just verified, and a divergence — including a host that stops
  resolving — is refused with the same `BROWSER_HOST_BLOCKED` taxonomy as the
  original check, so redirects and subresource requests surface the stable
  security error as before. A residual TOCTOU remains, because a DNS that pins
  its answers per resolver can still serve Chromium a different answer after the
  gate; the check narrows the rebinding window to hostile answerers that are
  additionally inconsistent under rapid repetition, and this limit is documented
  in the plugin's implementation note.

- Give the QA panel a browser's chrome instead of a preview. ([5693f36](https://github.com/xarleyn/dsh-plugins/commit/5693f36))

  The panel had a row of tab buttons, an address field, one image and a footer, so
  the operator could see which page the agent was on but could not act on it: the
  tabs could not be opened or closed, the address was the only way to go
  somewhere, and the browser's own three controls — back, forward, reload — had no
  Host path at all. The panel is now the browser it was showing: a tab strip with
  selection, a close button and a `+`, back/forward/reload, an address field that
  completes a bare host, a device row with width, height, presets and a
  fit/scale control, and a `⋯` menu for everything that does not deserve a
  permanent button.

  Back and forward are drawn from what the Host watched the tab visit — every
  navigation it performed and every one it saw committed through the page-change
  listener — because Chromium exposes no "is there an entry behind this page"
  question. The depth travels with each tab in the panel's state, the arrows grey
  out when there is nowhere to go, and a page that arrived through a redirect is
  recorded as a fresh entry rather than guessed at.

  Two facts divide the chrome, deliberately separately: the lease says who is
  driving, and the deployment's `capabilities.coordinateInput` switch says whether
  pointer gestures may be forwarded at all. A panel without the lease renders a
  disabled chrome and can still copy the address or refresh the image; clicks and
  context menus additionally need the switch, and the panel says so instead of
  failing one click at a time. Taking the lease on a chat whose browser has not
  started yet starts it, so the panel is not a dead end on a chat nobody has
  browsed in. The device row is clamped by the same bounds the agent's
  `browser_viewport` tool uses — one home for them now, in the Host.


### 🩹 Fixes

- Show the browser the agent is actually driving instead of an error line. ([70f3a3d](https://github.com/xarleyn/dsh-plugins/commit/70f3a3d))

  The QA panel authorizes every request against the admission boundary QA Surface
  publishes as the `qaSurface` service, but the Host read that service as a plain
  property while the plugin declares only `agents`, `attachments`, `tools` and
  `webServer` in its injection. Cordis refuses an undeclared service read, so every
  panel request — the two-second state poll, and with it the screenshot the poll
  would have asked for — failed with `cannot get property "qaSurface" without
  inject` before it ever reached the browser runtime. The agent kept working,
  because browser tools take their session id from the execution context and never
  touch that boundary; only the preview the operator watches was dead, and its
  error box was the one place the refusal showed up.

  QA Surface is not a declared dependency of this runtime by design — the plugin
  also loads on Hosts that never mount it — so the boundary is now resolved softly
  per request. A Host without QA Surface still refuses the panel, with the message
  that names the missing boundary, and a Host that mounts it later is honored
  without a reload.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.8.0
- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.6 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.4

## 0.1.5 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.3

## 0.1.4 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.2

## 0.1.3 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.1

## 0.1.2 (2026-09-16)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.7.0

## 0.1.1 (2026-09-15)

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.1

## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce a session-scoped Playwright Browser runtime for DeepSeek Harness and ([3312277](https://github.com/xarleyn/dsh-plugins/commit/3312277))
  its QA Surface panel extension. The initial release provides isolated persistent
  BrowserContexts, semantic ref-based tools, durable screenshots, server-enforced
  network policy, automatic panel reveal, and explicit leased human takeover of
  the same agent tab.

  Chromium starts lazily and is never downloaded from `postinstall`. Container
  deployments can point at a managed browser executable while retaining the
  Chromium sandbox by default.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn