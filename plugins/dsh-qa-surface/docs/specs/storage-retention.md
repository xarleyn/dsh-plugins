# SPEC — qa-surface durable storage: retention, sharding and SQLite

Status: in progress (this document is the design record).
Scope: `plugins/dsh-qa-surface`, `plugins/dsh-qa-integrations`, the
`@yadsh/dsh-qa-surface` CLI, and the external deploy kits (`qa-deploy`,
`qa-deploy-docker`) whose config comments name the store files.

## Problem

Five JSON stores under `$DSH_HOME` are owned by the QA surface. Every one of
them is written as *read the whole file → parse → rewrite the whole file*,
synchronously, on a path that runs often. Cost therefore grows with the whole
accumulated history rather than with the operation, and two of the stores have
no retention at all.

Measured on the live stand on 2026-09-16 (13.09–16.09, three days):

| File | Size | Composition | Bound today |
| --- | --- | --- | --- |
| `qa-accounts.json` | 84 KB | 9 users, 87 ownership records, 25 frozen capability snapshots = 37.6 KB (45%) | none — an ownership record is never removed |
| `qa-sources.json` | 54 KB | 29 sessions, 50 turn bundles, 47 of them empty | none |
| `qa-integrations.json` | 18.6 KB | 53 audit rows in 17 h | cap 5 000 rows, whole file rewritten per tool call |
| `qa-capability-policies.json` | 568 B | empty config | cap 1 000 events, each holding a full config before+after |
| `qa-quality.json` | 84 B | empty | caps 20 000 / 5 000 / 2 000, audit snapshots truncated at 20 000 chars |

`FileQaProvenanceSnapshotStore.put()` measured against the built module, one
write per turn:

| Bundles in file | File size | `put()` |
| --- | --- | --- |
| 50 | 121 KB | 7.0 ms |
| 200 | 482 KB | 9.0 ms |
| 1 000 | 2.4 MB | 21.6 ms |
| 5 000 | 12 MB | 106.1 ms |

The trigger is `agent/turn-stopping` with `global: true` — every turn of every
agent *and every subagent* rewrites the file that holds all sessions of all
users. A chat with four subagents performs five whole-file rewrites of the
arena-wide store per user turn. Because the calls are synchronous
(`readFileSync`/`writeFileSync`/`JSON.stringify` plus a zod `safeParse` of the
entire file), the cost is paid by the host's event loop: one growing file
stalls every user on the deployment, not only the chat that grew it.

Two secondary findings:

- `qa-accounts.json` and `qa-integrations.json` are not covered by the deploy
  kit's `.gitignore` (only `data/` and `.env` are), so a `git add -A` in the
  kit would stage password hashes, e-mail addresses, session ownership and
  wrapped DEK secrets. Tracked nowhere today, but one command away.
- `JSON.stringify(file, null, 2)` costs 36–37% of the volume of these files
  (54 KB → 34.2 KB for sources, 84 KB → 54 KB for accounts).

## Goals

1. Every durable store has an explicit, enforced bound on what it keeps.
2. The cost of one write stops depending on the accumulated history: no store
   rewrites data it did not change.
3. No information a deployment currently relies on is lost by the change;
   the frozen capability snapshot survives, without being duplicated per chat.
4. Existing stands migrate in place, without re-registering accounts and
   without a window in which the accounts store is unreadable.
5. Rollback is a file operation, not a code change.

## Non-goals

- Chats are not deleted by this change. Retention removes *records of chats
  that no longer exist*, never the auth boundary of a live chat (see
  "Ownership eviction" below).
- The Harness session journals (`$DSH_HOME/sessions`) are not touched; they
  have their own lifecycle.
- No new external dependency: `node:sqlite` is a Node builtin and the plugin
  already declares `engines: ^22.19.0 || >=24.0.0`; the deployment kit runs
  `node:24-bookworm-slim`.

## Design

### Sources: shard per session (`qa-sources/`)

`qa-sources.json` becomes a directory `$DSH_HOME/qa-sources/` holding one file
per session: `<sha1(sessionId).slice(0,16)>.json`. The store's read API is
already per-session (`list(sessionId)`), and nothing enumerates all sessions,
so the shard boundary matches the access pattern exactly: a write rewrites one
chat's history, not the arena's.

Shard format:

```json
{
  "version": 1,
  "sessionId": "session-…",
  "updatedAt": "2026-09-16T07:20:24.665Z",
  "turns": { "2": { /* QaTurnSources, verbatim */ } },
  "emptyTurns": [3, 4, 5]
}
```

A turn whose bundle carries no sources, no `discovered` entries and no
incomplete origins is recorded as its turn number in `emptyTurns` instead of
a 111-byte frame; `list()` reconstructs it as
`{version: 1, sessionId, turn, sources: [], complete: true}`. This keeps the
"collected, nothing found" distinction the UI relies on while removing 94% of
the frames observed on the stand. Non-empty bundles are stored verbatim, so
the on-disk shape stays recognisable and the zod schema keeps its guarantee.

Retention, applied inside the shard on write plus a directory sweep at most
once per hour:

| Knob | Default | Meaning |
| --- | --- | --- |
| `sources.retention.maxTurnsPerSession` | 200 | newest turns kept per shard |
| `sources.retention.maxSessions` | 500 | shards kept, most recently updated first |
| `sources.retention.maxAgeDays` | 30 | shards untouched for longer are dropped |
| `sources.retention.sweepIntervalMinutes` | 60 | how often the directory sweep may run |

`0` disables a bound. The sweep runs on a write, never on every read: a read
path that can delete files is a surprise, and the read path is the hot one.

Legacy migration: on first construction, if `$DSH_HOME/qa-sources.json`
exists it is split into shards and renamed to
`qa-sources.json.migrated-<ISO>`; the store refuses to read the monolith
afterwards, so a second process cannot resurrect stale bundles.

### Ownership eviction (variant A, the accounts store)

An ownership record is the auth boundary of a chat: `ensureSessionAccess`
claims an unowned session for whoever asks first. Retention therefore may only
drop records whose session **no longer exists in the Harness**, with a grace
period:

- `accounts.retention.ownershipGraceHours` (default 24) — a record younger
  than this is never considered, so a creation race cannot lose a claim.
- `accounts.retention.sweepIntervalMinutes` (default 60).
- The sweep drops ownership whose session is absent from `ctx.sessions`, and
  whose `claimedAt` is older than the grace period.

The frozen `capabilitySnapshot` is not dropped but **deduplicated**: it is a
function of the installed policy, and on the stand 25 snapshots held the same
content. Snapshots move to their own table keyed by the SHA-256 of their
canonical JSON, and ownership keeps a foreign key. 37.6 KB of the 84 KB file
becomes one row plus 25 hashes, losslessly.

### SQLite for the remaining four stores

`qa-accounts`, `qa-integrations`, `qa-capability-policies` and `qa-quality`
are keyed records with append-only audit logs — the shape SQLite is for. Each
becomes a `<name>.db` file (mode 0600) opened through one shared helper
(`SqliteDatabase` in `packages/plugin-kit`) that owns:

- `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`
  — WAL is what lets the `qa-accounts` CLI work against the same database from
  a second process, which the current stamp-and-reread dance
  (`reloadAccountsFileIfChanged`) exists to emulate.
- a `meta` table with the schema version and a one-time migration runner.
- a `withTransaction` helper so a read-modify-write is atomic by construction,
  retiring the temp-file-plus-rename ritual in each store.

Audit retention becomes a `DELETE` with a `LIMIT`-bounded keep instead of
`slice(-N)` over an array, and each store gains an age bound
(`*.retention.auditDays`, default 90) so a burst of tool calls cannot pin the
maximum row count forever.

**Where the helper lives.** Two plugins need this plumbing —
`dsh-qa-surface` for its accounts, roles and quality stores, and
`dsh-qa-integrations` for its registry and audit trail — so it is
`SqliteDatabase` in `packages/plugin-kit`, the shared home §27.1 of the
monorepo spec names for `packages/*`. Runtime imports need it to be resolvable
from `node_modules` at install time, so the kit is now a publishable package in
the release projects instead of a private one; its first release must reach the
registry before a plugin that imports it at runtime is deployed.

`qa-integrations` additionally stops writing an audit row for every successful
read call in the same transaction as the call itself: the row is buffered and
flushed in batches, so a 30-call minute costs one write, not thirty.

Because these stores are read by a second process (the CLI) and by operators,
losing hand-editability is a real cost. The design pays it back with the CLI:
`qa-accounts` keeps its surface, and a new `qa-storage` maintenance command
reports row counts, applies retention on demand and exports a store back to
JSON for inspection.

## Migration and rollback

For each store, on first open:

1. If `<name>.db` does not exist and `<name>.json` does, import the JSON into a
   fresh database.
2. Verify the import (row counts per table, and for accounts that the token
   secret and every user id survived) before the database is considered good.
3. Rename the JSON to `<name>.json.migrated-<ISO>`; never delete it.
4. If the database exists and the JSON does too, the JSON is left alone and
   reported by the maintenance command as a stale leftover.

Rollback: stop the host, delete `<name>.db` (plus `-wal`/`-shm`) and rename
the `.migrated-*` file back. Documented in the deployment kit, together with
the `.gitignore` fix that stops any of these files from being staged.

## Verification

- Unit tests per store: retention bounds actually bound (write N+1, assert N),
  shard isolation (one session's rewrite does not read another's), legacy
  migration is idempotent and preserves every bundle, import verification
  refuses a truncated JSON, rollback path (JSON restored) still opens.
- A scaling test asserting the per-write cost no longer grows with the number
  of *other* sessions: N sessions of history, one `put()`, assert the number of
  bytes written is bounded by one shard.
- `qa-accounts` CLI test against a migrated database.
- Repo gates: `pnpm check` for the affected projects, package verification for
  `dsh-qa-surface` and `dsh-qa-integrations`, and the client bundle check
  (the SQLite helper is host-only and must not reach the browser bundle).
- Deployment: `qa-drop-chats.mjs` updated for the new accounts store, and the
  deploy kits' config comments and README updated.

## Phases

| Phase | Content | State |
| --- | --- | --- |
| 1 | Sources: shard per session, retention, legacy split | landed (`36fdb91`) |
| 2a | `SqliteDatabase` helper in `packages/plugin-kit` + tests | landed (`015af1c`, `0d40aa5`) |
| 2b | Accounts: ownership eviction, snapshot dedup | landed (`09bebd9`) |
| 2c | Accounts: move the store onto SQLite | next |
| 3 | Integrations: SQLite, batched audit, retention | |
| 4 | Capability policies and quality: SQLite, retention | |
| 5 | CLI, ops script, deploy kits, changelog, docs | |

## Measurements after phase 2b

Applied to the live stand's own `qa-accounts.json` (3 days, 9 accounts, 87
ownership records, 25 of them carrying a frozen snapshot):

| | before | after |
| --- | --- | --- |
| file size | 84.3 KB | 26.8 KB (−68%) |
| snapshots stored | 25 inline copies (37.6 KB) | 2 distinct |

The 25 snapshots were 45% of the file and only two distinct policies; the
rewrite is lossless, and every ownership record still reads its snapshot
inline.
