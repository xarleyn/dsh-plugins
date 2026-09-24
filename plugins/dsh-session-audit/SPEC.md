# dsh-session-audit

## Session audit registry and viewer

## 1. Product contract

`dsh-session-audit` makes a session audit a first-class part of a DSH session:
an audit appears in the session it belongs to, and it appears on its own.

An **audit** is a directory under the audit root holding exactly two files:

```
${DSH_HOME}/audits/session-41b4e63f/
├── analysis.json     the semantic source
└── REPORT.md         the human-readable source
```

Numbered guarantees:

1. A session shows an `Audit` view among its views. The view is present for
   every session, whether or not an audit exists.
2. An audit directory copied into the audit root becomes visible without a DSH
   restart, without a plugin reload, and without any command.
3. An audit binds to the session its `analysis.json` names in
   `trajectory.sessionId`. Nothing else outranks that. A declared id missing the
   harness' `session-` prefix is read as the prefixed id when the corpus holds
   exactly that one — the spelling is corrected, the choice of session never is.
4. Only when the analysis cannot name a session is the directory name
   consulted — as an exact session id, then as a unique prefix. A prefix
   matching more than one session binds to none.
5. The view shows the audit's report, its structured findings and its raw
   `analysis.json`, the last as both a tree and raw text.
6. Modifying an audit's files updates the view. Replacing the bytes with
   identical bytes does not.
7. Removing an audit directory returns the view to its empty state.
8. An audit whose `schemaVersion` this build does not know is still shown: its
   report and raw document render, and the semantic tabs say why they are
   empty.
9. A malformed, oversized, non-UTF-8 or symlinked audit never affects another
   audit, the session list, or plugin startup.
10. The plugin works with no other plugin installed, and no part of it requires
    `dsh-qa-surface`.
11. Another plugin reads the same registry through the `sessionAudit` service
    and gets the same record this plugin's own view shows.
12. Nothing rendered from an audit can execute: the report renderer has no HTML
    path, and link and image destinations pass a protocol allowlist.
13. An audit no session can show — one whose binding is unresolved, or one that
    is not a readable audit — is reported to the view with the reason it is
    unattached. An audit is never silently absent, and the reason crosses the
    wire as a stable code rather than as a host path.

## 2. Data model

### 2.1 The artifact

| File | Role |
| --- | --- |
| `analysis.json` | Semantic source. `schemaVersion: 1` carries `trajectory`, `verdict`, `taskOutcome`, `evidenceSufficiency`, `scores`, `findings`, `missedOpportunities`, `userCorrections`, `betterTrajectory`, `recommendations`, `limitations`. |
| `REPORT.md` | Presentation source. Markdown; the report tab renders it and nothing is derived from it. |

The semantic minimum for a valid audit is `schemaVersion`, `trajectory` and
`trajectory.sessionId`. Every other field may be absent, and what is absent
degrades the view rather than failing the audit.

### 2.2 The record

The registry keeps one `AuditRecord` per audited directory:

| Field | Meaning |
| --- | --- |
| `auditId` | The directory basename, or `audit.id` when a schema states one |
| `sessionId` | The bound session, or `null` while unresolved |
| `status` | `ready` \| `pending` \| `invalid` \| `unresolved` |
| `fingerprint` | SHA-256 over both files' bytes |
| `summary` | Present when `ready`; the materialised per-session view |
| `errors` | Diagnostics with stable codes |

A session may own several audits. The **active** audit is the newest by
artifact mtime; the rest are retained, so history is a presentation decision
rather than a re-architecture.

### 2.3 Statuses

| Status | Shown to a session | Cause |
| --- | --- | --- |
| `pending` | no | one of the two files has not arrived |
| `unresolved` | no | valid artefact, no session to bind it to |
| `invalid` | no | unreadable, oversized, undecodable or schema-invalid |
| `ready` | **yes** | valid and bound |

The two statuses a session never shows share a fact: the record is bound to no
session. They are therefore listed together by the `unattached` remote — the
audits that exist and are visible nowhere — and the view says so in its empty
state (§6, scenario 10). Each entry carries the code of the record's blocking
diagnostic and not its message: the message is written for the host log and
quotes the artifact's path.

### 2.4 Damage policy

The filesystem is the source of truth and the registry is derived from it; there
is no database, and a restart rebuilds the registry with one scan. A registry
that cannot read a directory records a diagnostic and keeps going. An audit that
is being rewritten in place never replaces a valid record with a broken one: the
failure is logged and the previous record survives until its replacement
validates.

## 3. Lifecycle

```
plugin start
    ↓
scan the audit root          (metadata only: readdir + lstat)
    ↓
build the registry           (read, validate, resolve, fingerprint)
    ↓
start the watcher            (chokidar + reconciliation timer)
    ↓
serve the provider and the Remote surface
    ↓
filesystem event → settle → re-check → reload changed audits only
```

A check compares size and mtime first and content hash second, so a pass costs a
directory listing in the common case.

## 4. Configuration

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Scan, watch and serve audits at all |
| `auditRoot` | string | `""` | Blank resolves from `$DSH_AUDIT_ROOT`, then `$DSH_HOME/audits` |
| `watch` | boolean | `true` | Watch the root; off leaves reconciliation only |
| `watchMode` | `auto` \| `events` \| `poll` | `auto` | `poll` for a bind mount, network share or sync folder |
| `settleMs` | natural | `1000` | Quiet period after an event before re-reading |
| `rescanIntervalMs` | natural | `30000` | Reconciliation interval; `0` disables it |
| `allowDirectoryPrefixMatch` | boolean | `true` | Allow the fallback binding by directory-name prefix |
| `maxAnalysisBytes` | natural | `10485760` | Refuse a larger `analysis.json` before reading it |
| `maxReportBytes` | natural | `5242880` | Refuse a larger `REPORT.md` before reading it |
| `exposeHeaderBadge` | boolean | `true` | Reserved for a session-header badge |

`DSH_AUDIT_ROOT` overrides `$DSH_HOME/audits` when `auditRoot` is blank.

## 5. Scope

### Included

- The audit root, its layout, and the atomic publish protocol for producers
- Startup scan, filesystem watcher, periodic reconciliation
- Session binding, including unique-prefix resolution
- Reporting the audits no session can show, so that an audit invisible in
  every session is still an audible one
- The `Audit` conversation view: report, findings and JSON
- Live add, update and delete, without restart
- The `sessionAudit` service for other plugins
- Sanitized Markdown and a JSON view over the raw document

### Deferred

- Audit **history and diff** in the UI — several audits per session are already
  stored and served, but only the active one is shown
- Editing or deleting an audit from DSH
- A session-header badge (`exposeHeaderBadge` is reserved, not implemented)
- A global audit browser and cross-session analytics
- Deep links from a finding's `seq:` evidence into the trajectory
- Producer metadata (schema v2's `audit.producer`/`auditor` blocks are read but
  not yet shown)

## 6. Required end-to-end scenarios

1. **An audit appears.**
   Given a running DSH with no audit for a session,
   when `${DSH_HOME}/audits/session-41b4e63f/{analysis.json,REPORT.md}` is
   copied in,
   then the session's Audit view shows the report, the findings and the JSON
   without a restart, and the status bar shows the verdict and the counts.

2. **An audit changes.**
   Given a visible audit,
   when its `analysis.json` is replaced with a different verdict,
   then the status bar shows the new verdict within one check.

3. **An audit is removed.**
   Given a visible audit,
   when its directory is removed,
   then the session's Audit view returns to "No audit available for this
   session".

4. **A half-copied audit is ignored.**
   Given a directory containing only `analysis.json`,
   when a check runs,
   then nothing appears in any session; when `REPORT.md` arrives, the audit
   appears without another intervention.

5. **An ambiguous directory is not attached.**
   Given a directory named `session-41b4e63f` with no session id in its
   analysis, and two sessions whose ids both start with that string,
   then the audit is shown in no session.

6. **A future schema stays readable.**
   Given an audit with `schemaVersion: 2`,
   then its report and raw JSON are viewable and the semantic tabs explain
   that the schema is newer than the build.

7. **A hostile report is inert.**
   Given a `REPORT.md` containing a `<script>` element and a `javascript:`
   link,
   then neither executes: the tag renders as text and the link is not a link.

8. **Another plugin sees the same audit.**
   Given `dsh-qa-surface` with the audit plugin installed,
   when an audit appears,
   then the chat list badges its session and the dialog shows the same
   `auditId`, verdict and findings the session view shows.

9. **Without the provider nothing changes.**
   Given `dsh-qa-surface` installed and `dsh-session-audit` absent,
   then the chat list renders exactly as it does without either plugin — no
   badge, no empty state, no error.

10. **An audit no session can show is still reported.**
    Given an audit directory that names no session, or whose `analysis.json`
    cannot be parsed,
    then no session claims it, and every session's Audit view lists its
    directory name with the reason it is not attached — the reason and never a
    host path.

## 7. Implementation status

| Area | Status |
| --- | --- |
| `@yadsh/dsh-audit-core` (schema, parser, validation, summary, publish) | Implemented |
| Config, env resolution | Implemented |
| Scanner, loader, fingerprint, session resolver, registry | Implemented |
| Watcher, settle, reconciliation | Implemented |
| `sessionAudit` service and Typert Remote surface | Implemented |
| `Audit` conversation view (report, findings, JSON) | Implemented |
| Unattached-audit report (remote `unattached`, notice in the view) | Implemented |
| `@yadsh/dsh-audit-ui` shared components | Implemented |
| QA Surface badge and dialog | Implemented |
| Multi-audit history in the UI | Deferred |
| Session-header badge | Deferred |
| Producer metadata display | Deferred |

## 8. Where the rest is written down

The original design document — the architecture, the phases, the invariants and
the QA Surface integration as it was specified — lives in
[docs/specs/design.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-session-audit/docs/specs/design.md).

The DSH surfaces this plugin is built on, and the two places where the design
document's assumptions did not survive contact with DeepSeek Harness 0.1.5-rc.2,
are recorded in
[docs/ARCHITECTURE-NOTES.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-session-audit/docs/ARCHITECTURE-NOTES.md).
