## 0.2.2 (2026-10-04)

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

- Three fixes to how the audit reader trusts what it finds on disk. ([#355](https://github.com/xarleyn/dsh-plugins/issues/355))

  An audit directory swapped for a link is no longer read through. Containment was
  a comparison of two path strings plus one `lstat` of the artefact, so replacing a
  registered audit directory with a symlink or a Windows junction sent the next
  read to whatever a neighbour kept under the same name — a report the session was
  shown that its own audit root never held. Every step from the audit root down is
  now walked and no link is followed, and the bytes handed back are the ones the
  opened handle was proved to be, matched against that walk by file identity rather
  than by name.

  A last-good audit stays readable, not merely summarised. When a producer left an
  `analysis.json` truncated, the summary of the last valid version survived while
  the detail view went back to the broken file and returned nothing, so the session
  offered an Audit tab with nothing in it. The bytes a record was registered from
  are now held with it: the report, the structured findings and the raw document
  stay the version the summary describes, and a replacement that validates still
  takes the view over. The holding is bounded in total, not per file — together the
  snapshots hold what the size caps allow two audits to be, and the one no reader
  asked for longest is dropped first.

  An audit waits for its session only as long as the session list says it should.
  A binding decided by the directory name — or by a session id the harness would
  spell with its own prefix — was settled once and cached together with the
  artefact's content, so a session created later never collected its audit: the
  record stayed `unresolved` while its bytes sat unchanged. The binding keeps its
  own state now, and a session list that grew re-opens every binding the list
  itself made: an audit no session claimed, one whose id is missing the prefix the
  harness would spell it with, and one the list settled on a name or a unique
  prefix — a session appearing later can turn that prefix into an ambiguous one,
  and an ambiguous prefix binds to no session at all. Re-deciding costs no re-read
  while the answer holds, a list that did not change costs nothing at all, and an
  audit whose own analysis named its session is never looked at again. A list that
  cannot be read is reported — once per run of failures, rather than silently
  parking every binding that waits on it.

- The refresh tests now stamp the artefacts they compare, so the suite stops ([#314](https://github.com/xarleyn/dsh-plugins/issues/314))
  measuring the resolution of the filesystem it runs on.

  One test rewrote `analysis.json` and asked whether the audit's modification
  stamp had moved. Two writes in the same millisecond leave a stamp where it was,
  so the assertion could fail on a service that had done everything right: it
  re-reads the artefact on a change of size, reports the new verdict, and only the
  stamp stays behind because a stamp is the newest of the two artefacts' mtimes.
  The modified artefact is now pinned to an instant the test chooses and compared
  to that instant exactly, which says at least as much as the inequality did and
  nothing about the clock beneath it.

  A second test carried the same assumption without yet failing on it. It lists a
  session's audits newest first, and two audits stamped in one millisecond are not
  ordered by arrival — the tie breaks on the audit id, which would have made the
  older audit the active one. The newer audit is stamped explicitly now, and the
  test asserts the order its name promises rather than a count.

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

- The session audit view carries stable `data-testid` selectors. ([#472](https://github.com/xarleyn/dsh-plugins/issues/472))

  The page, its tab panel and the notice about audits that are attached to no
  session can now be addressed by a test id instead of by the wording of a
  sentence or by a CSS class, so a browser test of the audit view survives a
  change of copy. The notice's rows and their reason lines are labelled as
  templates, so a test names the row it reads instead of searching the page for
  the sentence inside it. The view's own suite moved to those ids and still
  asserts the wording and the list semantics it checked before. Nothing moved and
  no existing class changed: the ids are an addition to the same elements.

  The page's id names the container, not the branch that rendered: a session with
  an audit and a session without one both answer to `audit-page`, and the notice
  inside the second is `audit-page-empty` — the shape the log panel already uses,
  where `log-panel` stays put and its own note is `log-panel-empty`. So a test
  reaches the page the same way whichever state it is in. Loading and error still
  render the shared audit components, whose markup this package does not own, so
  they carry no id from here.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0
- Updated @yadsh/dsh-audit-core to 0.1.1
- Updated @yadsh/dsh-audit-ui to 0.1.2

### ❤️ Thank You

- qoder-bot

## 0.2.1 (2026-09-24)

### 🩹 Fixes

- An audit is bound to its session again when its producer wrote the session id ([fe81057](https://github.com/xarleyn/dsh-plugins/commit/fe81057))
  without the harness' prefix.

  `analysis.json → trajectory.sessionId` decides which session an audit belongs to,
  and the host used to take the string exactly as written. Session ids are spelled
  `session-<uuid>`; a producer that recorded the bare `<uuid>` named a session the
  host has never heard of. The audit registered cleanly and then sat under a key no
  view asks with — no badge, no report, and a listing of the audits no session can
  show that said nothing was wrong with it. On a stand fed by such a producer,
  every audit after the first looked as though it had never been written.

  A declared id that lacks the prefix is now matched as the complete prefixed id it
  would become, against the sessions the host actually has. The prefix is put back
  only on an exact hit, so the repair corrects a spelling without ever choosing a
  session the analysis did not name: a truncated id is left alone rather than
  snapped to the nearest one, an id the corpus does not carry is bound exactly as
  before, and a session corpus that cannot be listed costs nothing. An audit whose
  producer wrote the id correctly never pays for the lookup.

  The audit's own two files are now compared through the session it ended up bound
  to. Previously the bare id was held against the directory name beside it, so a
  repaired audit arrived carrying a warning about a disagreement between files that
  in fact meant the same session.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-22)

### 🚀 Features

- An audit that belongs to no session is now reported instead of disappearing. ([94000f9](https://github.com/xarleyn/dsh-plugins/commit/94000f9))

  Copying an audit into the audit root and seeing nothing anywhere was the whole
  failure mode: an artefact no session claims (`unresolved`) and a directory that
  is not a readable audit (`invalid`) are both held by the registry and both shown
  in no session, so the only way to tell "the audit never arrived" from "the
  registry is holding it" was to read the host log.

  The registry gains `unattached()`, the service exposes it as the `unattached`
  remote, and the Audit view lists what it returns above its empty state — the
  directory name and one sentence naming the reason. Beside a session's own audit
  the same notice still appears, because the question it answers is about the
  audit root rather than about the session being read.

  The wire carries the diagnostic's stable code and never its message: those
  messages quote the artifact's path, and the browser is told why an audit is not
  attached and never where it sits. A code this build does not know degrades to a
  sentence that is still true rather than to an empty list.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.1.1 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the host pipeline test monolith is split into registry, ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  scanner, security and service domains with shared helpers, and the package gains
  a design note for its QA-surface integration. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-18)

### 🚀 Features

- Initial release: session audits as a first-class part of a DSH session. ([296e3be](https://github.com/xarleyn/dsh-plugins/commit/296e3be))

  A session now has a fourth view — `Chat | Trajectory | Audit` — that shows the
  audit of the conversation you are reading. An audit is a pair of files an
  auditor writes into `${DSH_HOME}/audits/<session>/`: `analysis.json` with the
  verdict, scores, findings and recommendations, and `REPORT.md` with the full
  human-readable review. Drop a directory in and it appears, without restarting
  DSH and without configuring anything.

  The plugin owns the only audit registry there is. It scans the audit root at
  startup, watches it while DSH runs, and reconciles on a timer, so an audit that
  arrives through Docker, a network share or a `scp` is picked up even where
  native filesystem events never reach the process. A pass re-reads a file only
  after its size or mtime moved and reloads the registry only when the content
  hash changes, which is what makes a 30-second reconciliation affordable. A
  producer rewriting a file in place passes through an empty state; the audit a
  reader has open stays on screen until its replacement validates.

  The report tab renders `REPORT.md` with tables, a table of contents and
  sanitized Markdown; the findings tab shows the structured findings, missed
  opportunities and recommended changes; the JSON tab shows `analysis.json` as a
  tree or raw text, with a filter that prunes rather than highlights. The status
  bar leads with the verdict and the finding counts, and re-reads them on a timer,
  so an audit that lands mid-session appears on its own.

  An audit binds to a session through `trajectory.sessionId`, which is
  authoritative; only when the analysis cannot say — an unknown schema — is the
  directory name consulted, as an exact id and then as a unique prefix. A prefix
  matching more than one session resolves to nothing, because an audit attached
  to the wrong session is worse than one shown nowhere.

  The plugin also serves other plugins: `ctx.get("sessionAudit")` answers with the
  same summary, the full audit, the list of audits for a session and a change
  subscription, so a QA surface can badge a chat without owning a second scanner.
  An audit whose `schemaVersion` this build does not know is not an error — its
  report and raw document stay readable, and the semantic view says why it is
  empty.

  Audit content is treated as untrusted throughout: size caps are checked before
  a read, bytes must decode as UTF-8, symlinks in the audit root are refused
  rather than followed, no filesystem path ever crosses the wire, and the
  Markdown renderer has no HTML path at all.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-kit to 0.3.0
- Updated @yadsh/dsh-audit-core to 0.1.0
- Updated @yadsh/dsh-audit-ui to 0.1.0

### ❤️ Thank You

- xarleyn @xarleyn