# SPEC — dsh-kv-persist

> Persistent KV-cache/session-state manager for DeepSeek Harness.
> Full design document: [`docs/dsh-kv-persist.md`](./docs/dsh-kv-persist.md)
> (section references below use its numbering, e.g. «§68»).

**Status:** MVP / v0.1 (Phase 1 of the design roadmap §83)
**Type:** Host-service plugin (guidelines §2) — no client/UI surface
**Backend:** llama.cpp `llama-server` slot save/restore API (§6)

---

## 1. Product contract

Numbered, verifiable guarantees for release `0.1.0` (acceptance criteria §74):

1. **A1 — Session mapping.** The plugin associates persistent cache
   snapshots with a DSH `sessionId` plus the request route
   (`provider` + `model`, §13, §56). A snapshot is never keyed by
   `sessionId` alone.
2. **A2 — Lazy restore.** Opening or resuming a session restores nothing;
   the snapshot is restored lazily on the session's first actual managed
   `llm/stream` request (§51).
3. **A3 — Resident fast path.** A request whose session already owns the
   slot triggers **zero** save/restore/erase management calls and **zero**
   disk I/O (§69, Invariant 6).
4. **A4 — Save before evict.** A dirty slot is checkpointed before being
   reassigned to another session, unless `checkpoint.onSwitch: false`
   (§52, Invariant 3).
5. **A5 — Checkpoint policy.** Checkpoints fire on slot switch, idle
   (`idleMs`, rechecking ownership before saving, §71), session flush,
   session disposal, turn end (opt-in), and shutdown (§26, §50).
6. **A6 — Dirty generations.** Dirty state is a monotonic generation pair
   (`dirtyRevision` / `persistedRevision`), not a boolean; concurrent saves
   of the same generation coalesce (§27, §28).
7. **A7 — Compatibility gate.** A snapshot is restored only when its
   runtime identity matches (server instance, provider, model,
   `runtimeKey`-derived compatibility version, §13-§15, Invariant 4).
   Incompatible snapshots are marked invalid (`MODEL_FINGERPRINT_CHANGED`),
   never deleted (§31).
8. **A8 — Verified restore.** An HTTP 200 is not enough: when the server
   reports `n_restored <= 0` and `restore.verify` is on, the restore counts
   as failed (§24, Invariant 10).
9. **A9 — Cold fallback.** Every persistence failure (save, restore, erase,
   unreachable backend, malformed manifest) degrades to ordinary cold
   inference; the model-visible conversation never depends on snapshots
   (§23, §32, §53, Invariants 1, 5). Only `failure.strict: true` turns a
   failed restore into a request failure.
10. **A10 — Circuit breaker.** `maxConsecutiveFailures` consecutive
    persistence failures open the circuit for `cooldownMs`; requests pass
    through to ordinary inference while it is open (§33).
11. **A11 — Auxiliary isolation.** Requests with a `purpose` (compaction,
    session-title) or without a `sessionId` checkpoint the current dirty
    owner, never acquire slot ownership, and never become authoritative
    conversation state (§22, §72, Invariant 7).
12. **A12 — Provider filter.** Only explicitly configured `providers` are
    coordinated; everything else passes through untouched (§37, §74.19).
13. **A13 — Stream-scoped slot lease.** Preparation, restore, erase, save,
    the complete inference stream, and terminal dirty-state bookkeeping share
    one exclusive lease per physical slot (§20, Invariant 8). llama.cpp
    `--parallel 1` does not replace this local management serialization.
14. **A14 — Opaque filenames.** Snapshot filenames are plugin-generated
    sha256 identifiers; non-plugin-shaped names never reach the backend
    (§16, §44, Invariant 9).
15. **A15 — Atomic metadata.** Manifest writes are temp-file + rename; a
    crash cannot leave half-written metadata that parses as valid (§40).
16. **A16 — Clean unload.** Hot unload/dispose stops timers, stops new
    persistence work, and performs the shutdown checkpoint when configured
    (§58, §74.20).

## 2. Data model

- **Metadata** (plugin-owned, `<DSH home>/cache/dsh-kv-persist/`, §39; DSH
  home is non-blank `$DSH_HOME`, otherwise `~/.dsh`):
  `instances/<serverInstanceKey>/sessions/<sha256>.json` — manifest schema
  version 1 with `sessionId`, route, compatibility version, slot id,
  timestamps, token/byte counters, filename, `state: ready | invalid`, and
  an invalidation reason. Corruption fails loudly (`KV_MANIFEST_INVALID`) —
  the plugin never silently resets metadata (guidelines §3.5).
- **Binary snapshots** (server-owned, llama.cpp `--slot-save-path`, §17):
  the plugin only generates filenames; it never reads or deletes binaries.
  One rolling snapshot per (session, route) pair (§41).
- **Runtime state** (in memory, per session): route, `dirtyRevision`,
  `persistedRevision`, in-flight save handle (§27, §28).

## 3. Lifecycle

Session state machine (§18): `none → cold → active-dirty → saving → saved`
and `saved → restoring → active-clean → active-dirty` on resume; `invalid`
on incompatibility or failed restore. Slot state machine (§19):
`unknown → idle → ready → inference → dirty → saving`, `restoring` while a
restore is in flight, `broken` on unusable server state. Ownership is a
single `(slot → session)` association; auxiliary requests leave the slot
unowned (§72).

## 4. Scope

### Included (v0.1, §68)

llama.cpp backend · single server · single slot · explicit managed provider
list · `sessionId → snapshot` mapping · save on switch · idle save · save on
shutdown/flush · lazy restore · restore fallback · metadata manifests ·
global slot mutex · structured logging · status API · basic doctor/probe ·
fake-backend test suite (§75-§77).

### Deferred (§68, roadmap §83)

Multi-slot, managed-slots mode, UI, disk GC/retention, multiple servers,
snapshot migration, Prometheus metrics, custom llama transport adapter,
automatic server startup, snapshot fingerprinting of request content (§30).

## 5. Required end-to-end scenarios (§69-§72, §75)

| Scenario | Steps | Expected |
| --- | --- | --- |
| Cold start | request A, no snapshot | erase → owner A → inference → A dirty, no save |
| Resident reuse | A, A again | no management calls at all |
| Switch | A, B | save A → owner B |
| Restore | A, B, A | save A → restore A → owner A |
| Corrupt snapshot | restore fails | snapshot invalid → erase → cold, request succeeds |
| Backend down | `/slots` unreachable | inference continues (cold) |
| Save failure | save A fails, B requested | warning logged, B runs (non-strict) |
| Auxiliary | A dirty, session-title | A saved → slot unowned → next A restores |
| Cancellation | stream aborted | lock released, no dirty mark, next session works |
| Hot reload | plugin disposal | no orphan timers, shutdown checkpoint per config |

## 6. Implementation status

| Area | Status |
| --- | --- |
| Cordis service `ctx.kvPersist` (§11) | Implemented |
| llama.cpp client, probe (§6, §34) | Implemented |
| Single-slot coordinator, lazy restore, save-before-switch (§23, §51, §52) | Implemented |
| Idle / flush / disposed / shutdown checkpoints (§26, §50) | Implemented |
| Dirty generations + save coalescing (§27, §28) | Implemented |
| Snapshot identity, naming, manifests, atomic repo (§13-§17, §39-§41) | Implemented |
| Circuit breaker (§33) | Implemented |
| Restore verification `n_restored` (§24) | Implemented |
| Structured logging, metrics counters, status, doctor (§45-§48) | Implemented (in-memory counters) |
| `sessionSeq` metadata (§29) | Field present, not yet populated |
| Request fingerprints (§30) | Planned (0.2) |
| Snapshot rotation `<hash>.a/.b.bin` (§41) | Planned (0.2) |
| Shared-filesystem binary cleanup (§42) | Planned (0.2) |
| Disk quota / GC (§43) | Deferred |
| Multi-slot, multi-server, transport adapter (§63-§66) | Deferred (0.3) |
| CLI (`dsh kv …`, §48), UI (§81) | Deferred |
| Prometheus export (§46) | Deferred |
