## 0.1.2 (2026-10-04)

### 🩹 Fixes

- Every publishable library under packages/ now carries a gate of its own. ([#293](https://github.com/xarleyn/dsh-plugins/issues/293))

  Each of the four gained a `verify` target that holds the promises packing cannot
  check: `main` and `types` name the same file as the root export, every declared
  subpath is built, and every published dependency range resolves for a consumer
  that installs from the registry — a `workspace:` range never names a private or
  missing member, a `catalog:` range never names a member at all, and a member is
  never declared as a plain range. `README.md` and `LICENSE` are pinned on disk,
  because the tarball gate that asks for them by name covers plugins only. The
  package hygiene gate requires the target to stay and reads the call itself, so a
  library that loses its gate — or keeps the script while dropping one of the two
  checks — fails locally and in CI instead of shipping unchecked.

- The settings card now opens from the plugin's own row in the Plugins panel, not from a tab of the Settings "Built-in plugins" section, and it paints only its body there. ([#659](https://github.com/xarleyn/dsh-plugins/issues/659))

  The Plugins page draws the heading of a row's page itself — the crumb, the artwork and the title — and seats the bundle's configuration under it, so the card no longer competes for a place in the Settings dialog's tab strip. The card registers into the page's `plugins.row.config` slot under `@yadsh/dsh-qa-surface#dsh-qa-surface`, the package-and-row key the page builds from this bundle's patch, so the row itself gains the configure control that opens the page.

  The page seats one entry in two views, and this entry answers them differently. As the page it renders the card; where the page wants the row's one-liner — the seat it falls back to for a row carrying no description — it returns a sentence, because a card mounted inside a line of text draws a page within a line and starts a second poll of the Remote. That sentence is the manifest's own `description`, which is where the page reads the row's paragraph from: one row that reads two ways is a defect, so the two are kept equal and a test and the package gate read the manifest rather than repeating the words. An entry the page renders without naming a view is that page rather than an empty column. The seat also hands its registrant a `form` of its own — the page's `ConfigPageForm`, which is `{ state, mutate }` alone, so it can neither be subscribed to nor written field by field — and the renderer spreads it after the injected face. The card therefore keeps resolving the full `ConfigForm` of this namespace through the settings domain, and that form crosses the boundary as `settingsForm`, where the owner prop cannot shadow it. The seat also hands its registrant a `form` of its own — the page's `ConfigPageForm`, which is `{ state, mutate }` alone, so it can neither be subscribed to nor written field by field — and the renderer spreads it after the injected face. The card therefore keeps resolving the full `ConfigForm` of this namespace through the settings domain, and that form crosses the boundary as `settingsForm`, where the owner prop cannot shadow it.

  The row's page draws the card surface, the heading and the expand control, so the bundle stopped drawing them: the plugin's own shell — the 12 px frame, the header with the badge, and the chevron of the card contract — is gone rather than nested inside the Host's 20 px one, and the configuration sections mount directly; the 16 px the body used to keep under its own header went with that header, because the page's own configuration column already spaces what it holds (`detailSections` carries a 32 px margin and gap in the installed build, and the Host's own section beside ours sits on that rhythm alone). The route and the on/off state the header badge repeated are already in the status section, so nothing is lost with it. Focus rings now come from the Host's `--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, with each rule's own colour as the fallback, instead of a hard-coded outline the Host's `focus.css` outranks: this reaches every control the bundle paints, the row's body and the assistant's own pages alike. The disclosure arrows of the message queue, the administrator's tool list and the audit JSON tree left the card shell's chevron for one arrow drawn on the 16 by 16 grid, each inside the box its own stylesheet already gave it; the audit tree's `viewBox` moved together with its path, since a 16-grid path inside a 14 box renders larger than the arrows beside it. A namespace the Host does not serve answers with the reason in one sentence rather than with an empty column — the row's heading and its configure control are already drawn, so silence would carry no explanation — and the poll that would feed a status section nobody mounts stays off while the namespace is unreachable.

  Nothing about the stored settings moves: the configuration namespace stays `dsh-qa-surface`, and the card keeps reading and writing through the Host form for exactly that namespace, so a value saved before this release is still there after it.

  `@yadsh/dsh-audit-ui` changes for one rule of its own — the tree disclosure arrow and the focus ring of its tab strip, both of which travel inside the `@yadsh/dsh-qa-surface` bundle and are held to the row card's contract there.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-audit-core to 0.1.1

### ❤️ Thank You

- qoder-bot

## 0.1.1 (2026-09-22)

### 🩹 Fixes

- The error state's retry button is now asserted through its accessible name. ([5993522](https://github.com/xarleyn/dsh-plugins/commit/5993522))

  The rendering test reached the button by tag and position, which keeps passing
  after the label is gone or moved and says nothing about how a screen reader or a
  role query finds the control. It now asks for `button` by the name `Try again`
  in both directions: the state without a retry callback offers no such button,
  and the state with one offers exactly that button. A change that leaves the
  control unnamed fails the test instead of passing it.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-18)

### 🚀 Features

- Initial release: the shared audit presentation layer. ([0573d64](https://github.com/xarleyn/dsh-plugins/commit/0573d64))

  The components render an audit they are handed. They never fetch, never
  subscribe, and never import a DSH client package, which is what lets a full
  conversation page and a modal dialog share them: the shell differs, the content
  does not. That split is the reason the session-audit plugin and the QA Surface
  can show the same audit record without either one owning it.

  The package ships its own report renderer rather than borrowing a plugin's,
  because an audit report is untrusted text — a model wrote it — and the
  guarantees that make it safe to render belong next to the code that relies on
  them. Raw HTML has no path to the DOM at all: a tag line is a paragraph whose
  inline text leaves the tag as characters, and there is no `innerHTML` anywhere
  in the package. Link and image destinations pass a protocol allowlist, so
  `javascript:` and `data:` are text rather than a click target, and a refused
  image degrades to its alt text instead of disappearing.

  The report format depends on tables, so the parser is GFM: headings become the
  table of contents with matching anchors, and tables, nested lists, task items,
  blockquotes, fenced code and inline code all render. A construct the grammar
  does not recognise stays visible as text, so an unexpected report never loses
  content. The findings list groups by severity, most severe first, and a
  severity this build does not know gets its own group under the producer's own
  word rather than being dropped or silently reclassified.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-audit-core to 0.1.0

### ❤️ Thank You

- xarleyn @xarleyn