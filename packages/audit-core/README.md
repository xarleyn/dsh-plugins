# @yadsh/dsh-audit-core

The audit artifact domain layer for DeepSeek Harness: one definition of what a
session audit *is*, shared by the things that produce them and the things that
display them.

A session audit is two files — `analysis.json` (semantic source) and `REPORT.md`
(human-readable source) — kept together in one directory. This package knows how
to read them, validate them, summarise them, and publish them atomically. It
knows nothing about who wrote them or who is going to render them.

It is **not** a DSH plugin and depends on no harness package: no Cordis, no
React, no DOM. The main entry is safe to import from a browser bundle; the only
module that touches the filesystem lives behind `./producer`.

## Install

```bash
pnpm add @yadsh/dsh-audit-core
```

## Reading an audit

```ts
import { parseAuditAnalysis, buildAuditSummary } from "@yadsh/dsh-audit-core";

const parsed = parseAuditAnalysis(await readFile("analysis.json", "utf8"));

// Fails only when the artefact cannot be bound at all: no schemaVersion, no
// trajectory.sessionId, or bytes that are not JSON. Everything else is read
// best-effort, and an unknown schemaVersion stays viewable.
if (!parsed.ok) {
  for (const error of parsed.errors) console.warn(error.code, error.message);
} else {
  const summary = buildAuditSummary({
    analysis: parsed.analysis,
    auditId: "session-41b4e63f",
    sessionId: "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
    modifiedAt: new Date().toISOString(),
  });
}
```

Two guarantees shape every reader in this package:

- **A malformed artefact never throws.** Wrong types are dropped, absent fields
  are absent, and the view degrades field by field.
- **A future schema is not an error.** `schemaVersion: 2` parses to
  `{ kind: "unknown" }` with an `UNSUPPORTED_SCHEMA` *warning*, so the report and
  the raw JSON remain readable while the semantic view waits for a newer build.

## Publishing an audit

```ts
import { publishAudit } from "@yadsh/dsh-audit-core/producer";

const { directory, auditId } = await publishAudit({
  auditRoot: "/home/user/.dsh/audits",
  analysis,
  report,
});
```

`publishAudit` serialises the analysis, validates exactly those bytes, writes
both files into a staging directory inside the audit root, flushes them, and
moves the directory into place with a single rename. A reader watching the root
therefore never observes a half-copied audit, and a producer has no reason to
write into the root directly.

An existing audit of the same session is never destroyed: by default the new one
publishes beside it under `session-41b4e63f-2` and the consumer treats the
newest valid audit as active. Pass `onConflict: "replace"` to opt into replacing
it instead.

## API

| Export | Purpose |
| --- | --- |
| `parseAuditAnalysis(text)` | Decode and validate `analysis.json` text |
| `validateAuditAnalysis(value)` | Validate an already-decoded value |
| `getAuditSessionId(analysis)` | The authoritative `trajectory.sessionId` |
| `buildAuditSummary(input)` | Materialise the per-session summary |
| `countFindings(findings)` | Count findings into the badge's buckets |
| `normalizeVerdict` / `normalizeSeverity` / … | Map a producer's vocabulary onto a styled one |
| `isPathContained` / `auditDirectoryName` | Path arithmetic shared by reader and producer |
| `publishAudit` | Atomic publish (`/producer` subpath) |

## Compatibility

- Node.js `^22.19.0` or `>=24.0.0`.
- Understands audit `schemaVersion: 1`; any other version is kept viewable as an
  unknown schema.

## Development

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## License

MIT
