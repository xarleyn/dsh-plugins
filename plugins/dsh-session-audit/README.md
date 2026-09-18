# @yadsh/dsh-session-audit

Session audits as a first-class part of a DeepSeek Harness session: an `Audit`
view beside Chat and Trajectory, driven by audit artifacts on disk.

An audit is a pair of files an auditor writes into `$DSH_HOME/audits`:

```
$DSH_HOME/audits/session-41b4e63f/
├── analysis.json     verdict, scores, findings, recommendations
└── REPORT.md         the full human-readable review
```

Copy a directory in and it appears in the session it names — no restart, no
command, no configuration. Modify it and the view follows. Remove it and the
view goes back to its empty state.

## Features

- **A fourth session view.** `Chat | Trajectory | Audit`, with three tabs: the
  report rendered from `REPORT.md` (tables, lists and a table of contents), the
  structured findings from `analysis.json`, and the raw document as a tree or
  text.
- **Nothing to configure.** `trajectory.sessionId` in the analysis decides which
  session an audit belongs to. The directory name is only a fallback, and a
  name that could mean two sessions attaches to neither.
- **It works while DSH runs.** A startup scan, a filesystem watcher and a
  periodic reconciliation: an audit that arrives through a Docker bind mount, a
  network share or a `scp` is picked up even where native events do not reach
  the process.
- **Cheap to leave on.** A check reads a file only after its size or mtime
  moved, and reloads the view only when the content actually changed.
- **A future schema is not an error.** An audit whose `schemaVersion` this build
  does not know still shows its report and its raw JSON.
- **Untrusted content, treated as such.** Size caps before a read, strict UTF-8,
  symlinks refused rather than followed, no filesystem path on the wire, and a
  Markdown renderer with no HTML path at all.
- **Other plugins can read it.** `ctx.get("sessionAudit")` returns the same
  record this plugin's own view shows, so
  [`@yadsh/dsh-qa-surface`](https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-qa-surface#readme)
  badges an audited chat without owning a second scanner.
- **Optional in both directions.** The plugin needs no other plugin, and a
  surface that consumes it renders unchanged when it is absent.

## Install

```bash
dsh plugin --profile web add @yadsh/dsh-session-audit
```

From a checkout of this repository:

```bash
pnpm nx run @yadsh/dsh-session-audit:build
dsh plugin --profile web add ./plugins/dsh-session-audit
```

`--profile` is required: `dsh plugin add <package>` rejects a call without one.

## Configuration

Configure the plugin under the `session-audit` key in the DSH profile.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Scan, watch and serve audits at all |
| `auditRoot` | string | `""` | Blank resolves from `$DSH_AUDIT_ROOT`, then `$DSH_HOME/audits` |
| `watch` | boolean | `true` | Watch the audit root; off leaves the reconciliation timer only |
| `watchMode` | `auto` \| `events` \| `poll` | `auto` | `poll` for a bind mount, a network share or a Syncthing folder |
| `settleMs` | number | `1000` | Quiet period after a change before the root is re-read |
| `rescanIntervalMs` | number | `30000` | Reconciliation interval; `0` disables the timer |
| `allowDirectoryPrefixMatch` | boolean | `true` | Allow the fallback binding by directory-name prefix |
| `maxAnalysisBytes` | number | `10485760` | Refuse a larger `analysis.json` before reading it |
| `maxReportBytes` | number | `5242880` | Refuse a larger `REPORT.md` before reading it |
| `exposeHeaderBadge` | boolean | `true` | Reserved for a session-header badge |

`$DSH_AUDIT_ROOT` overrides `$DSH_HOME/audits` when `auditRoot` is blank.
`$DSH_HOME` itself defaults to `~/.dsh`.

## Writing an audit

A producer may write its own files, and the watcher's settle window exists for
that case. The reliable path is to let
[`@yadsh/dsh-audit-core`](https://github.com/xarleyn/dsh-plugins/tree/main/packages/audit-core#readme)
publish it: it validates the exact bytes it writes, stages both files inside the
audit root, and moves the directory into place with a single rename, so a reader
never sees a half-copied audit.

```ts
import { publishAudit } from "@yadsh/dsh-audit-core/producer";

await publishAudit({
  auditRoot,
  analysis,
  report,
});
```

A re-audit of the same session publishes beside the previous one rather than
over it: the newest valid audit is the active one, and the earlier ones are
kept.

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0`, tested against `0.1.5-rc.2`.
- Node.js `^22.19.0` or `>=24.0.0`.
- See [`compatibility.json`](./compatibility.json).

## Development

```bash
pnpm build       # typert artifacts, declarations and the client bundle
pnpm test
pnpm typecheck
pnpm lint
pnpm check       # the full pipeline, then verify:package
```

## License

MIT
