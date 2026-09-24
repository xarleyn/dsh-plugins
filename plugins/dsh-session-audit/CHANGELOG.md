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