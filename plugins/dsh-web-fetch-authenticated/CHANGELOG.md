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
