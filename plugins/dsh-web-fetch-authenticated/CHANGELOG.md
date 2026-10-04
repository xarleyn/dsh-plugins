## 0.7.0 (2026-10-04)

### 🚀 Features

- The settings card now opens from the plugin's own row on the host **Plugins** ([#648](https://github.com/xarleyn/dsh-plugins/issues/648))
  page, not from a tab of the Settings "Built-in plugins" section.

  The card edits exactly one thing — this bundle's own configuration — and the
  Plugins page declares a seat for that: `plugins.row.config`, keyed by
  `<package name>#<row id>`. The row this bundle's patch declares is
  `web-fetch-authenticated`, the same string the Host files this plugin's live
  Config under, so the seat moved and the namespace did not: a rule, a credential
  ref, a limit or a policy saved before this release is read back by the card
  after it.

  The row's **Configure** control arrives with the seat. The page offers that
  control only for a row whose configuration somebody registered, and until this
  release no bundle registered one for this row, so the page had no way into its
  settings either. The tab strip in Settings loses the tab this card added.

  The chrome above the card belongs to the page. It reads the row's display
  metadata from this bundle's own manifest, so the row is headed
  `@yadsh/dsh-web-fetch-authenticated` with this package's description under it,
  and the page draws the surface and the control that expands the section. The
  card stopped drawing a second one: its border, header, chevron and open state
  went, so the seat's page view is the configuration body, mounted as soon as the
  page opens the row.

  Whether the provider is enabled stays readable, but from another source and on
  another clock than the header's badge had. The badge read the saved setting and
  flipped in the same click; the pill in the status section states what the
  provider itself reports, and the card asks for that report on a five-second poll
  rather than after a write. So between a toggle and the next tick the pill is the
  half that is behind, and while the page sits in the background — where the poll
  waits for the page to become visible again — it stays behind until the reader
  returns. The **Provider enabled** switch remains the immediate reading of the
  setting. Where a row carries no description of its own, this seat's fallback line
  is the same sentence as the package's description rather than a second one, so
  editing the description cannot leave the row with two.

  The keyboard still reaches every control this card draws. The page dresses its
  own elements and leaves a plugin's to the plugin, so each field, button, icon
  button, switch and fold of the body takes its ring from the Host's
  `--dsw-focus-ring-width` and `--dsw-focus-ring-color`. Both halves carry a
  fallback: where a token is undeclared the whole `outline` shorthand would
  otherwise be dropped, which is the ring vanishing rather than a plain one.

  An unavailable configuration now explains itself. The Plugins page is not the
  settings directory, so it keeps answering from a browser the directory is not
  served to; there the card used to render nothing, which on the old tab was an
  absent row but on the page's frame is an opened section that is blank for no
  stated reason. The card answers that state with a sentence instead, and with no
  controls, because there is no configuration here to present read-only.

  What the card shows is unchanged: the rule list, its write-only credential
  fields, the network policy and limits, the connection tester, and the diagnostic
  runner.


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

- The plugin's redirect suite stops losing to its own timeout on a loaded Windows ([#290](https://github.com/xarleyn/dsh-plugins/issues/290))
  run.

  Vitest gives a test five seconds and this package re-exported the shared preset
  with no override. The suite drives a local HTTP fixture and costs 55ms on an
  idle machine, but a full `nx run-many -t test` runs eight projects at once, and
  one redirect test was then observed hitting the five-second cap on a loopback
  round-trip it normally finishes in milliseconds. The package now budgets 30
  seconds per test, the allowance the browser plugin already gives its I/O-bound
  suites.

  No runtime behavior changed: the fix is test configuration.

- Nothing the settings card does changed; what changed is how its source is cut, ([#423](https://github.com/xarleyn/dsh-plugins/issues/423), [#292](https://github.com/xarleyn/dsh-plugins/issues/292))
  and which REST hops now have a test.

  `src/client/sections.tsx` was 1632 lines — the one file of this package above
  the fail threshold the repository is settling on, and the whole card body in a
  single module: the provider overview, the global limits, the rule table, the
  editor, the credential control, the tester and the diagnostics view. Each of
  those now owns a file under `src/client/sections/`, the largest of them 335
  lines, with the controls and the injected client face they share in
  `sections/common.tsx` and the draft conversions in `sections/rule-draft.ts`.
  `sections.tsx` stayed as the barrel the card imports, so the client entry and
  the published contract are untouched and the built bundle still registers
  itself under the package's full name.

  The adapter's REST hop is now tested on the transport it actually uses. The
  seam tests stub the transport and the provider tests walk happy paths, so the
  request the adapter builds for itself — the rewritten `/rest/api/...` URL — was
  the one hop no test ran through policy: a redirect that leaves the origin is
  denied and the credential is never dialed there, a redirect that stays inside
  the rule's paths is followed with the rule's own auth, a body larger than the
  rule's cap is refused before it is read, an answer that is a login page rather
  than JSON fails as an adapter failure instead of a parsed issue, and an
  under-reported body that is cut mid-stream is refused rather than half-read.
  Everything listens on loopback, so the suite reaches no network.

- An IPv4 address written inside IPv6 no longer slips past the network classification. ([#335](https://github.com/xarleyn/dsh-plugins/issues/335))

  `::ffff:7f00:1` is 127.0.0.1 — the same host in the other syntax, and the address both Node and the browser's URL parser connect to. The IPv6 branch of the classifier read its top bits instead, found no IPv4 range there, and called it `public`. A rule that denied loopback, the RFC1918 ranges, link-local and the cloud metadata endpoint `169.254.169.254` accepted every one of them as soon as the URL, or a DNS answer, used the mapped spelling. The dotted spelling `::ffff:127.0.0.1` did not parse at all, which made every IPv6 literal ending in a dotted quad unparseable.

  An address is now judged by the bytes a connection reaches. A mapped literal collapses into its IPv4 before classification, takes the IPv4 class and the IPv4 verdict, and the socket is pinned to that IPv4 text instead of to a second spelling of it, so the address the policy approved and the address it judged cannot differ. A denied CIDR matches either byte form of the host and an allowed CIDR matches only the destination it names, so a rule that already blocked `::ffff:0:0/96` keeps blocking it. The deprecated IPv4-compatible block (`::x.y.z.w`) and the NAT64 well-known prefix (`64:ff9b::/96`) reach their embedded address only through a translation router this plugin cannot verify, so both fail closed as `reserved` and no allow-flag opens them, while `::`, `::1` and genuine IPv6 addresses keep their own classes.

  What this does not claim: it is a classification bypass, not a demonstrated open proxy. No request reached these addresses while the bypass was being measured, and reaching them still needs a rule whose host, port and path patterns accept the URL.

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

- The card keeps editing the live profile, now through the host's own mechanism. ([#524](https://github.com/xarleyn/dsh-plugins/issues/524), [#508](https://github.com/xarleyn/dsh-plugins/issues/508), [#523](https://github.com/xarleyn/dsh-plugins/issues/523), [#512](https://github.com/xarleyn/dsh-plugins/issues/512), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  Under `0.1.5` this plugin installed its own settings namespace from the host
  half and pushed committed edits back into the running provider. `0.1.7` removed
  that installation, and with it the slot the card was mounted into. What replaces
  both is a marker on the schema: a field belongs to a live form while its node
  carries `.volatile()`, and the namespace of such a profile is the profile entry
  id. The six nodes the card edits — `enabled`, `rules`, `defaultPolicy`, `limits`,
  `documents`, `audit` — now carry that marker, and only at the top level, because
  the host rejects a live node nested inside a rule. The namespace stays
  `web-fetch-authenticated`, which is the id `cordis.patch.yml` already declares, so
  a policy written for the previous build is still read by this one.

  The card moved to a tab of its own under Settings → Plugins, and keeps drawing
  its own shell. Reading changed shape on the host side: the profile arrives as
  stable references, so the provider takes one snapshot per operation instead of
  cloning the entry config once at startup — a clone would have made the values it
  logged permanent. Nothing about what an operator can change moved: the same rule
  list, the same limits, the same write-only credential control, and an edit still
  reaches the next request without a restart.

  One log line moved. `auth_fetch.config_errors` used to be re-emitted on every
  committed edit, because that was the only moment the plugin learned of one; it is
  now emitted once, at startup. The card's Provider section has always listed the
  same reasons live, and still does, so an invalid rule is reported where it is
  edited rather than only in the log.

- The settings card is addressable by a stable id. ([#466](https://github.com/xarleyn/dsh-plugins/issues/466), [#423](https://github.com/xarleyn/dsh-plugins/issues/423), [#560](https://github.com/xarleyn/dsh-plugins/issues/560))

  Every section of `src/client`, the controls inside them and the states they
  report now carry `data-testid` (epic #453): 84 ASCII kebab-case values, one zone
  per section in the prefix — `wfa-card`, `wfa-status`, `wfa-global`, `wfa-rules`
  with the rule row and its editor, advanced block, credential control and tester
  under the same `wfa-rule` zone, and `wfa-diagnostics`. A browser run reaches the
  provider pill, a config error or warning block, a rule row and its four actions,
  the write-only credential pair and its save/remove, an editor field, a tester or
  diagnostics report without naming any of them by the English copy they render or
  by the `wfa-*` class they share with their siblings. A shared control (`Pill`,
  `ToggleRow`, `IconButton`) takes its id from the call site that places it, so the
  enabled pill of a row and the state pill of the credential block never answer to
  one selector; a repeated node keeps the id of its template and no index is baked
  into a name, while the six network checkboxes name the policy field they write.
  The summary that expands the collapsed advanced block is named too, so the fields
  behind it are reachable without clicking a phrase, and the block still opens
  closed — nothing here moved but attributes. Layout wrappers, `MetaLine` facts and
  the explanatory notes stay unnamed: an id marks a control, a state or a shell.

  Nothing moved but attributes — every `className`, `role`, `aria-*`, placeholder
  and text node of the card is what it was, and the settings-card shell contract of
  `AGENTS.md` is untouched. No test located these nodes by class or copy, so none
  had to be rewritten; the card has no DOM-rendering test, so the contract is
  pinned against the source instead — `tests/client-testids.test.ts` reads the
  client tree and holds the ids to their shape, their zone, their uniqueness and
  their coverage, so an unnamed control fails a gate rather than a browser run.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.6.0 (2026-09-24)

### 🚀 Features

- QA conversations now render Mermaid diagrams with secure source fallback, ([aafad8b](https://github.com/xarleyn/dsh-plugins/commit/aafad8b))
  documentation search accepts safe grep-style alternatives and canonical paths,
  and the role-change dialog uses the surface's normal controls.

  Managed integration defaults are provisioned for new users without overriding
  an explicit disconnect, the structured `/no-review <request>` command bypasses
  the automatic review gate for exactly one durably linked request, and
  authenticated fetching can retain arbitrary successful responses as durable
  file attachments while keeping grants administrator-controlled.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.3 (2026-09-22)

### 🩹 Fixes

- The rule row reads as a row of facts, and its four actions are icons with names. ([c999275](https://github.com/xarleyn/dsh-plugins/commit/c999275))

  Four text actions — enable/disable, test, edit, delete — plus three status pills
  filled the row's whole right-hand side, so a rule with a long origin wrapped onto
  a second line. The actions are icon buttons now, each one carrying its label in
  `aria-label` and `title` and hiding the glyph from the accessibility tree, so the
  row keeps its width without the icon becoming the only thing that says what the
  button does; the text-button style the four used is gone with them.

  The origin column printed a rule's scheme in full, and a rule that accepts either
  scheme spelled both of them (`https/http://jira.example.corp`). The scheme is a
  token now: `https://jira.example.corp`, `http://…`, or `http(s)://…` when both
  are accepted — the host, which is the part an operator reads, gets the width the
  schemes were eating.

  The tester report and the provider overview joined their facts with middle dots.
  Dots as separators are decoration: they cost a glyph per item and say nothing a
  gap does not. Each fact is its own labelled item on a line that separates them by
  layout, so the report reads as a list of measured values instead.

  The package gate asserts all three: the four actions resolve through the named
  icon button, the compact scheme token is in the bundle, and neither a middle-dot
  separator nor the old text-button class can come back.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.2 (2026-09-22)

### 🩹 Fixes

- The Russian Jira/Confluence walkthrough works through its scenario with ([06d6635](https://github.com/xarleyn/dsh-plugins/commit/06d6635))
  synthetic placeholders — project keys, hosts, page and attachment ids and
  document names are the demo values the rest of the documentation uses. A reader
  can follow it without substituting their own deployment, and every example in it
  is safe to copy into an issue or a chat.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.1 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the package's oversized test files are split into adapter, ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  provider and security domains with shared helpers. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.0 (2026-09-18)

### 🚀 Features

- Read a Jira issue's description and attachments, and give images a download path that does not stop at the text seam. ([7c7b79c](https://github.com/xarleyn/dsh-plugins/commit/7c7b79c))

  The Jira REST request never asked for `description`, so the adapter's own description renderer had nothing to render: an issue reached the model as a title, a status row and a comment list, and the body it was opened to read stayed invisible. The same request now asks for `attachment` and the card renders a `## Attachments` list — name, size, media type and the download URL — the way the Confluence adapter already does, so a file a sentence refers to is reachable instead of being a name with nothing behind it.

  Images had no path at all: `web_fetch` carries the `html | text` body union of `@deepseek-ai/dsh-web` and no provider can put bytes in it, so an image attachment failed as `unsupported content type "image/png"`, while the browser refused the same URL under its network policy. The plugin now registers a second tool, `web_fetch_image`, beside the provider: it travels the same rule match, network policy, credentials and redirect validation, reads a bounded body, decides the format from the file signature (`image/png`, `image/jpeg`, `image/webp`, `image/gif` — a Jira attachment is served as `application/octet-stream`), commits the bytes through `ctx.attachments.saveImage` and hands the model the image block itself. A body that is not a raster image fails with `AUTH_FETCH_NOT_AN_IMAGE` naming the HTTP status and content type that arrived; an oversized one fails with `AUTH_FETCH_IMAGE_TOO_LARGE`. The tool exists only where a durable attachment store is mounted, and a route whose model declares no image input is refused before the download starts.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.1 (2026-09-17)

### 🩹 Fixes

- Align authenticated-fetch examples with the repository-standard placeholder ([dc105c7](https://github.com/xarleyn/dsh-plugins/commit/dc105c7))
  hosts. No runtime behavior changes.

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.4.0 (2026-09-16)

### 🚀 Features

- Serve Confluence attachments as links, and read Word/OpenDocument attachments ([67ac3ff](https://github.com/xarleyn/dsh-plugins/commit/67ac3ff))
  as text.

  A storage body names an attachment by filename and nothing else, so a page that
  says "see the attached regulation" used to reach the model as a bare name it
  could do nothing with. The Confluence adapter now resolves every attachment
  reference — a linked file, an embedded image, and the embedded Office/PDF viewer
  macros (`view-file`, `viewpdf`, `viewdoc`, `viewppt`, `viewxls`) — into its
  download URL, and appends the page's own attachment collection as an
  `## Attachments` list with name, media type, size and link. `adapter.cleanup:
  strict` still serves neither, and `adapter.maxAttachments` (default 50, `0`
  disables the list) caps how many entries one page reports; a failed collection
  request never costs the page.

  Downloading an attachment as bytes is impossible by construction: the harness
  body union is `html | text`, so the plugin extracts the document's text inside
  the provider and returns that. Word (`.docx`/`.docm`/`.dotx`) and OpenDocument
  (`.odt`) files are inflated in memory — no external binary, no temporary file —
  and rendered as Markdown with headings, paragraphs, list items and tables; field
  codes, deleted revisions, comments, drawings and footnotes are left out. The
  per-rule `documents` section bounds it: `maxBytes` (default 4 MiB) caps the
  download, `maxChars` (default 40000) caps what a document may add to the
  conversation, and both are overridable from the top-level `documents` defaults.
  A format the plugin does not read (PDF, legacy `.doc`, spreadsheets,
  presentations, archives) is refused by name instead of as an unknown content
  type, and bytes that only claim to be a document are refused too rather than
  returned as mojibake. `documents.enabled: false` restores the previous behavior
  exactly, and the connection tester runs the same extraction so Test on an
  attachment URL shows what the model would receive.

- Serve the Confluence page links Confluence itself hands out. A rule with the ([8dc89ce](https://github.com/xarleyn/dsh-plugins/commit/8dc89ce))
  Confluence adapter now recognizes `<context>/pages/viewpage.action?pageId=<id>`
  — the URL in the browser bar and in every "copy link" action — plus its legacy
  `?spaceKey=<key>&title=<title>` form, and resolves them through the same REST
  API as the `/pages/<id>/…` and `/display/<SPACE>/<Title>` forms. Until now only
  those two path shapes were recognized, so a page opened through a view-page
  link fell through to raw HTTP/HTML and the model received the whole wiki page:
  masthead, space menus, breadcrumbs, page tools, comment box, and the Atlassian
  footer, with the actual article buried in the middle. Whether a URL is served
  by the adapter is now decided by the one function that reads page references,
  so the route and the conversion can no longer drift apart.

  Give Confluence rules a `cleanup` level and stop the adapter from burying page
  content in macro noise. Layout macros (`section`, `column`, `div`) used to be
  reported as one placeholder line that flattened everything they wrapped into a
  single paragraph; they now unwrap, so the headings, paragraphs, lists, and
  tables inside keep their block structure. Task lists become `- [x]` checkboxes,
  status badges keep their label, panels keep their callout, a bare user mention
  reads `@user` instead of leaving the sentence that introduced it dangling, and
  list items and table rows stay in one block instead of being separated by blank
  lines (which broke Markdown tables).

  What survives beside that content is now the rule's choice:
  `adapter.cleanup` is `off` (keep every `_[macro: …]_` and `_[file.png]_` marker),
  `balanced` (the default — navigation and aggregation macros are dropped, links,
  attachments, and emoticons stay), or `strict` (readable content only, no
  markers). The rule editor exposes it as "Page cleanup" next to the adapter
  type; an omitted value resolves to `balanced`. The configuration warning for
  two rules that can match the same URL now names the shared scheme, host, and
  port instead of only naming the rules, and the overlap check no longer reports
  two rules that restrict themselves to disjoint ports.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.2 (2026-09-14)

### 🩹 Fixes

- Read the credential provider per operation, so authentication works at all in a ([7b59536](https://github.com/xarleyn/dsh-plugins/commit/7b59536))
  real Host. The plugin captured `ctx.get('credentials')` in its constructor, and
  cordis' strict `Reflect.get` reports a service whose providing fiber is not
  ACTIVE yet as absent: `@deepseek-ai/dsh-credentials-local` reaches ACTIVE only
  after its asynchronous document load and watcher setup, while profile bundles —
  this one included — are applied earlier. The captured value stayed `undefined`
  for the whole process lifetime, so every rule whose auth is not `none` failed
  with `AUTH_FETCH_CREDENTIAL_MISSING` while the DSH credentials page showed the
  stored secret as configured, and the settings card's Test reported `missing`
  next to a reference the Host itself could describe.

  `createCredentialResolver` now takes a source callback and reads the provider on
  every `resolve`/`describe`; the exported signature changed, so embedders pass
  `() => ctx.get('credentials')` instead of an instance. A regression test proves
  the wiring under a real Cordis context — a provider mounted after the plugin is
  constructed still authorizes a test fetch — beside unit coverage for a provider
  that appears late, a rotated value, an empty stored value, and a malformed
  reference name.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.1 (2026-09-13)

### 🩹 Fixes

- Fix the settings card never mounting in the web UI. The 0.1.5 client runtime ([ed36855](https://github.com/xarleyn/dsh-plugins/commit/ed36855))
  exposes `remote.credentials` as its own Cordis service key (owned by
  `dsh-api-settings-controller`), separate from `remote`, and reading a service
  that is not declared in `inject` throws `cannot get property
  "remote.credentials" without inject`. The client half read the namespace
  without declaring it, so the whole browser-side plugin failed to apply — the
  Plugins page rendered no Authenticated Web Fetch card, and the loader error
  took the entire plugin list down with it. The client now declares
  `remote.credentials` beside `remote` and `settingsScope`, matching the
  first-party settings plugins, and the package contract asserts the
  declaration in the built bundle so the omission cannot come back.

  The release also removes an internal project key from every example in the
  package: the Diagnostics and rule-tester placeholders in the shipped client
  bundle, the Jira adapter's key-format comment, the SPEC and the test fixtures
  now use the neutral `PROJ-123` shape.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-12)

### 🚀 Features

- Migrate to the DSH 0.1.5-rc.2 client surface: credentials move from the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  removed IApiClient carrier to the `remote.credentials` Typert remote
  (describe/set/unset RemoteResults), the settings section installs via
  SettingsProvider.installSection, and the supported host range moves to
  `>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.

  Content adapters (SPEC §29 phase 4): a rule can select a `jira` or
  `confluence` content adapter. Recognized URLs (`/browse/ISSUE-KEY`,
  `/issues/KEY`, `/pages/<id>`, `/display/SPACE/Title`) are re-fetched from the
  product REST API through the same authenticated transport and normalized into
  compact Markdown — issue fields plus optional comments/links (Server wiki
  markup and Cloud ADF both convert), page metadata plus a storage-format XHTML
  to Markdown conversion with code/panel/expand macros handled. Unrecognized
  URLs fall back to raw HTTP/HTML; the connection tester runs the adapter too;
  malformed REST bodies fail with the new `AUTH_FETCH_ADAPTER_FAILED` code.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-10)

### 🚀 Features

- Initial release: authenticated `WebFetchProvider` for `ctx.web` with per-origin ([58320f3](https://github.com/xarleyn/dsh-plugins/commit/58320f3))
  rules, Bearer/Basic/API-key-header auth backed by DSH credential references,
  SSRF network policy with DNS pinning, same-origin redirect enforcement, response
  limits, centralized secret redaction, and a settings card with a rule editor,
  write-only credential fields, a connection tester, and sanitized diagnostics.

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

## 0.1.0 (2026-09-09)

### 🚀 Features

- Initial release: authenticated `WebFetchProvider` for `ctx.web` with
  per-origin rules, Bearer/Basic/API-key-header auth backed by DSH credential
  references, SSRF network policy with DNS pinning, same-origin redirects,
  response limits, centralized redaction, and a settings-UI card with rule
  editor, write-only credential fields, connection tester, and diagnostics.
