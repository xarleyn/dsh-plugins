# SPEC: dsh-cas-results

Product contract for `@yadsh/dsh-cas-results`. This file is the canonical
statement of the behavior the plugin guarantees; the original design document
lives in `SPEC-dsh-cas-results.md` and the implementation status table at the
bottom of this file must always reflect reality.

## 1. Product contract

1. A successful tool result containing a textual field at or above its class
   threshold (default 16 KiB text/log, 8 KiB HTML) is stored in the CAS and
   the model-facing content is replaced by a bounded deterministic preview
   (≤ `preview.maxChars` characters) that carries the complete
   `sha256:<64 hex>` reference.
2. For every textual payload, the bytes read back from the CAS equal the
   original UTF-8 bytes; `SHA-256(retrieved) === reference` is verified on
   every verified read.
3. Ten identical tool outputs produce exactly one physical blob; reuse
   increments an advisory hit counter on the object metadata.
4. The same payload always produces the same `sha256:<64 hex>` reference;
   hashing never normalizes whitespace, line endings, or Unicode.
5. Equivalent accepted base64 representations of one binary payload (data URI
   and raw base64) resolve to the same binary SHA-256 and one CAS object.
   Alphabet-conforming random text is not decoded when strong detection is
   required.
6. `dsh_cas_retrieve` never returns more than the configured retrieval
   maximum (`retrieval.maxBytes`, default 256 KiB) regardless of the
   requested `limit`; truncation is reported with the next offset.
7. When CAS storage is unwritable, corrupted, or the plugin is disabled, the
   original tool result passes through unchanged — content is never lost or
   replaced by a reference that cannot be read back.
8. Failed tool results are never transformed unless `includeErrors` is
   explicitly enabled.
9. Output of the plugin's own `dsh_cas_*` tools is never offloaded again;
   every tool bounds its own response internally.
10. Concurrent writes of identical data cannot corrupt the blob: writers
   stage into `tmp/`, commit with an exclusive hard link (atomic rename
   fallback), and losing writers keep the winning identical blob.
11. GC enforces `storage.maxBytes`: expired objects are deleted first,
   oldest-accessed objects are evicted under quota pressure, and objects
   younger than `gc.minAgeMs` are protected until routine collection cannot
   reach the quota.
12. A missing or garbage-collected object produces an explicit "no longer
   available, re-run the original tool" answer — never empty content and
   never a silent failure.
13. README and NOTICE visibly credit `dsh-funnel` and YuanyuanMa03.

## 2. Data model

- Store root: `<storeDir>` or `<$DSH_HOME>/storages/dsh-cas-results/`.
- Layout (SPEC §14):
  - `blobs/sha256/<ab>/<cd>/<hash>.blob` — payload, optionally gzip-compressed.
  - `meta/sha256/<ab>/<cd>/<hash>.json` — versioned informative metadata
    (`version: 1`): sizes, kind, media type, codec, timestamps, first tool,
    advisory hit counter.
  - `tmp/` — staging area for atomic writes; stale files older than one hour
    are removed on startup and during GC.
- Identity: SHA-256 over logical (uncompressed) payload bytes. The storage
  codec is recorded in metadata and never participates in identity.
- Blob path is derived solely from a validated `^sha256:[a-f0-9]{64}$` hash;
  no user-controlled string reaches a filesystem path.
- Corruption policy: unreadable metadata, missing blobs, decompression
  failures, and hash mismatches surface as typed `CasError`s
  (`CAS_OBJECT_MISSING`, `CAS_INTEGRITY_FAILED`, `CAS_STORE_IO`,
  `CAS_INVALID_REF`, `CAS_INVALID_ARGUMENT`) — the store never silently
  resets or rewrites foreign state.
- POSIX permissions are requested where honored (directories `0700`, files
  `0600`); blobs are never served over HTTP.

## 3. Lifecycle

```text
tool executes
  → tools/post-execute (plugin listener)
      ├─ own tool / parent dispatch / disabled / excluded → passthrough
      ├─ failure result → passthrough (unless includeErrors)
      └─ success value → recursive scan
            ├─ string over threshold (text/log/html) → CAS put → preview
            ├─ confident base64 → decode → binary CAS put → marker
            └─ unchanged value → passthrough
  → accepted decision replaces only the model-facing content
  → canonical value stays execution-local; durable events never carry it

agent needs details
  → dsh_cas_retrieve / dsh_cas_search / dsh_cas_info / dsh_cas_stats
      → bounded verified reads against the store

background / startup / dsh_cas_gc
  → TTL + quota collection, orphan staging cleanup
```

Plugin load resolves config (loud failure on impossible config), opens the
filesystem store, registers the listener and retrieval tools through the
`tools` service, runs one best-effort GC pass, and starts the interval timer
when `gc.enabled`. Dispose clears the timer and closes the plugin logger.

## 4. Scope

### Included (v1)

- `tools/post-execute` interception with content replacement.
- Recursive string scanner with per-class thresholds and per-tool overrides.
- Filesystem CAS with storage deduplication, atomic writes, metadata.
- text/log/HTML previews plus binary markers.
- Conservative base64 decoding and binary deduplication.
- `dsh_cas_retrieve`, `dsh_cas_search`, `dsh_cas_info`, `dsh_cas_stats`,
  opt-in `dsh_cas_gc`.
- TTL + quota GC with startup orphan cleanup.
- Runtime counters and derived ratios through `dsh_cas_stats`.
- Optional gzip storage codec (`none`/`gzip`/`auto`).
- Shared service surface `ctx.casResults` (`put`/`read`/`search`/`stat`/
  `stats`/`gc`) for future consumer plugins.

### Deferred

- Repeat-aware context offloading (requires a verified session identity at
  the seam; storage-level dedup already covers the global case).
- Semantic compression (Headroom/Kompress-style preview engines can sit on
  top of the CAS service later).
- S3/MinIO backends (the `CasStore` interface is the contract).
- Mark-and-sweep GC driven by durable session references.
- UI browser for stored objects; OTel export; regex search; advanced MIME
  detection.

### Composition notes

`dsh-cas-results` decides where bulky data lives, not what is semantically
important. It detects its own markers to stay idempotent, but stacking it
with `dsh-funnel`, `dsh-headroom`, or `dsh-compressor` over the same results
is ordering-dependent and should be avoided (see the design document, §27).

## 5. Required end-to-end scenarios

1. **Large offload** — a `bash` tool returns a 2 MiB log → the model sees a
   marker + bounded preview → the store holds one gzip-compressed object.
2. **Exact retrieval** — the agent calls `dsh_cas_retrieve` with the marker
   reference → joined chunks reproduce the original bytes; the hash matches
   the reference.
3. **Search instead of reinjection** — `dsh_cas_search` finds one
   `AssertionError` line with context in a 20 MiB log without the log
   entering the conversation.
4. **Binary dedup** — the same PNG arrives as a data URI in one turn and as
   raw base64 in the next → one binary object, two preview markers.
5. **Failure passthrough** — the store directory is replaced by a file →
   every large result keeps its original content, warnings are logged.
6. **GC expiry** — an object untouched for longer than `ttlMs` disappears at
   the next collection → retrieval answers "no longer available".

## 6. Implementation status

| Area | Status |
| --- | --- |
| `tools/post-execute` interception | Implemented |
| Recursive scanner + thresholds + per-tool policies | Implemented |
| Filesystem CAS (atomic writes, dedup, metadata) | Implemented |
| text/log/HTML previews + binary markers | Implemented |
| Conservative base64/binary dedup | Implemented |
| `dsh_cas_retrieve` / `search` / `info` / `stats` | Implemented |
| `dsh_cas_gc` (opt-in tool + service method) | Implemented |
| TTL + quota GC, orphan cleanup | Implemented |
| gzip/`auto` storage codec | Implemented |
| Runtime counters + derived ratios | Implemented |
| Shared `ctx.casResults` service surface | Implemented |
| Repeat-aware offloading | Deferred |
| S3/MinIO backend | Deferred |
| Session-driven mark-and-sweep GC | Deferred |
| UI browser / OTel export / regex search | Deferred |
