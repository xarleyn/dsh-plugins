# Collecting CAS objects referenced by saved chats

**Decision, 2026-11-18.** Defer collection based on chat references until
Harness can identify every retained reference to a CAS store and coordinate
deletion with writers. Today a saved chat retains its preview and digest. The
underlying bytes can still expire under the plugin's existing TTL or quota.

## What Harness exposes

We checked the repository's tested Harness release `0.2.2-rc.3`, the published
`0.2.2-rc.5` and upstream `master` at `2e39e70496`. That revision lets a storage
backend share a fork's stored prefix with its parent. This makes fork ownership
relevant even when a child has no physical copy of the marker. [Fork persistence contract](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/packages/session/session-persistence/src/index.ts#L69-L95)

| Public API | What a collector can establish |
| --- | --- |
| `sessionPersistence.list()`, `open(id, 'read')`, `handle.read()` | The caller can list visible session headers and revisions, then read a contiguous prefix of one log. A flush makes acknowledged writes durable. Other writers can still append or create sessions between calls. [Persistence contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/session/session-persistence/src/index.ts) · [Handle contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/session/session-persistence/src/handle.ts) |
| `sessionQuery.listSessions()`, `readSession(id)` | These combine live and persisted sessions, preferring the live copy, and can replay one cold log. With persistence unavailable the list can contain only live sessions. Session projections also have a per-session read boundary. [Query corpus](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/session-query/session-query/src/corpus.ts) · [Projection contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/session/session-projection/src/index.ts) |
| Session references and attachments | These services resolve cross-chat snapshots and Host-owned file or image references, respectively. The CAS plugin writes its own digest into tool-result text and also exposes `casResults.put()` to other plugins. [Session references](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/context/session-reference/src/index.ts) · [Attachments](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/attachment/attachment/src/index.ts) |

An empty listing can coexist with data on disk. In the JSONL backend's test
for a future-format header, opening the saved session by ID raises
`SessionFormatUnsupportedError`, yet `list()` succeeds with `[]`. Even with
readable headers, a writer can reuse an old digest after its chat has been
scanned and before the collector unlinks it. Searching transcripts or tailing
live events cannot establish that deletion is safe. [Upstream regression test](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/session/session-persistence-jsonl/tests/jsonl.spec.ts#L564-L580)

## Contract needed from Harness

1. **Durable ownership.** Let a producer record a typed reference identifying
   the store and digest with the session event that retains it. Keep it across
   restart, archival and any compaction that preserves replayable history.
   A fork or another chat retains its own claim, including an inherited history
   prefix. A committed permanent deletion releases only that chat's claim.
   Any other consumer sharing the store needs a way to retain its objects too.
2. **Complete inventory.** Offer a consistent snapshot of those references for
   every session and writer sharing the store. Pages must belong to the same
   generation and the last page must attest to complete coverage. Report
   unavailable storage, unreadable formats and unfinished migrations explicitly.
   Existing chats with text markers need a verified backfill or continued
   protection for the affected store.
3. **Safe handoff from a writer to GC.** Protect a new or reused digest from
   `put` until its reference commits durably or the write aborts. At deletion,
   Harness and the store must jointly exclude a concurrent owner acquiring the
   same digest. A snapshot alone leaves this race open. The store must also
   protect an in-flight retrieval until it finishes.

## Collection and recovery under that contract

Only a complete inventory can authorize reclaiming committed objects.
A missing page, stale generation, interrupted pass or unavailable index
suspends deletion. Recover by rebuilding or obtaining a fresh complete
inventory and revalidating candidates. An interrupted pass must be repeatable,
including when another writer has since recreated a candidate. The current
staging cleanup removes files in the store's own `tmp/` older than one hour.
Keep that cleanup separate and protect active staging writes even when a
writer outlives the age threshold.

In a future reference-aware mode, startup, timer, manual and quota-triggered
collection must all honor active claims. Report an unmet quota when retained
bytes alone exceed the limit. Before enabling the mode, verify on a disposable
store that an archived chat survives restart, a fork keeps a shared digest
after parent deletion, the final release permits reclamation, and partial
listings, concurrent put/read/save and retries after a crash preserve every
protected object.
