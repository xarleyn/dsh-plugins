---
"@yadsh/dsh-session-audit": minor
---

Initial release: session audits as a first-class part of a DSH session.

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
