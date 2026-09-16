# SPEC: dsh-cas-results

## 1. Summary

**Working name:** `dsh-cas-results`

**Alternative names:**

- `dsh-result-store`
- `dsh-tool-result-store`
- `dsh-result-vault`
- `dsh-content-addressed-results`

**Recommended:** `dsh-cas-results`

### Short description

DeepSeek Harness plugin that automatically offloads large and redundant tool results into a local content-addressed blob store.

Large tool outputs, logs, HTML, base64 payloads and other bulky content are stored by their SHA-256 content hash. The session/model receives only a bounded preview plus a stable retrieval reference.

Identical content is stored once regardless of how many tools, turns or sessions produce it.

Example:

```text
[dsh-cas-results]
Large tool output offloaded: 2.7 MiB → 3.9 KiB preview
type: text/html
ref: sha256:ac7819...e029
retrieve: dsh_cas_retrieve(ref="sha256:ac7819...e029")
```

The plugin is primarily an **ingestion-time storage/deduplication layer**, not another general-purpose context compressor.

---

# 2. Attribution / origin

The project is conceptually based primarily on:

**dsh-funnel**
by **YuanyuanMa03**

Repository:

```text
https://github.com/YuanyuanMa03/dsh-funnel
```

`dsh-funnel` established several important ideas that this plugin extends:

- intercept tool results before they enter model context;
- operate on canonical successful `result.value`;
- recursively inspect textual fields;
- replace oversized fields with a bounded model-facing representation;
- preserve access to the complete original content;
- keep errors untouched by default.

`dsh-cas-results` expands this model from simple file spilling into:

- SHA-256 content addressing;
- storage deduplication;
- binary/base64 awareness;
- cross-tool deduplication;
- optional cross-session deduplication;
- stable retrieval references;
- range retrieval;
- search inside stored results;
- GC and quotas;
- storage statistics;
- pluggable storage backend architecture.

## Mandatory credit

README must contain a visible section similar to:

```markdown
## Credits

dsh-cas-results is inspired by
[dsh-funnel](https://github.com/YuanyuanMa03/dsh-funnel)
by [YuanyuanMa03](https://github.com/YuanyuanMa03).

dsh-funnel pioneered the ingestion-time tool-result curation approach
used as the conceptual and implementation starting point for this plugin.
```

If source code from `dsh-funnel` is copied or modified rather than independently rewritten:

1. Preserve the applicable MIT copyright notice.
2. Preserve the MIT license text.
3. Add `NOTICE.md` explaining which portions originated from `dsh-funnel`.
4. Prefer retaining attribution comments in substantially derived source files.

The original license states:

```text
Copyright (c) 2026 YuanyuanMa03
```

If code is directly copied from Headroom or its ports rather than merely taking architectural inspiration, their applicable license/NOTICE requirements must also be checked separately.

---

# 3. Problem

Tool results in an agent harness often contain large amounts of data with poor context value:

- build logs;
- test output;
- repeated CLI output;
- web pages;
- HTML;
- JSON dumps;
- generated files represented as base64;
- screenshots/images serialized into strings;
- embedded binary data;
- stack traces;
- API responses;
- search responses;
- repeated tool calls returning the same content.

Once such output lands in a conversation, it can be replayed to the model over many following turns.

There are actually two independent forms of waste.

### Context waste

A 500 KiB tool result does not need to occupy 500 KiB of model-visible context indefinitely.

### Storage duplication

If the exact same 500 KiB value appears ten times, timestamp/path-based spilling may create ten copies of the same content.

The desired model is:

```text
content
   │
   ▼
SHA-256
   │
   ├── blob already exists ──► reuse
   │
   └── new hash ─────────────► store once
                                  │
                                  ▼
session/model gets
preview + hash reference
```

---

# 4. Goals

The plugin MUST:

1. Intercept large successful tool results before they enter normal session/model history.
2. Detect offload candidates recursively inside structured tool values.
3. Compute SHA-256 over the actual stored payload.
4. Store identical payloads only once.
5. Replace large values with small deterministic previews.
6. Add a stable content reference.
7. Allow the agent to retrieve stored data on demand.
8. Handle text, logs, HTML and base64/binary-like strings.
9. Never lose a tool result merely because CAS storage fails.
10. Be safe against recursive offloading of its own retrieval tools.
11. Support bounded storage through garbage collection and quotas.
12. Work without modifying DSH core.
13. Remain deterministic and model-independent.
14. Make storage behavior inspectable through statistics.

---

# 5. Non-goals

Version 1 SHOULD NOT attempt to become a full replacement for:

- DSH conversation compaction;
- semantic summarization;
- Headroom/Kompress;
- source-code AST compression;
- general-purpose RAG;
- arbitrary file storage;
- attachments;
- external object storage;
- secret detection/redaction;
- lossless archival of the entire DSH session database.

Semantic compressors may operate alongside or on top of the CAS architecture later.

The core invariant should remain:

> `dsh-cas-results` decides **where bulky data lives**, not what information is semantically important.

---

# 6. Relationship with existing DSH components

## dsh-funnel

Closest conceptual predecessor.

It should be treated as the initial implementation reference.

Main extension:

```text
dsh-funnel

large output
    ↓
timestamp file
    ↓
path pointer
```

becomes:

```text
dsh-cas-results

large output
    ↓
SHA-256
    ↓
content-addressed blob
    ↓
stable hash reference
```

Identical data therefore converges onto the same blob.

## dsh-headroom / dsh-compressor

These solve a partially overlapping but different problem.

They attempt to produce a smarter compressed representation of tool results while retaining the ability to retrieve original content.

`dsh-cas-results` should initially use simpler deterministic previews.

A future integration can let Headroom/Funnel-style preview engines use the CAS service as their backing store.

## Official tool-result-pruner

The official DSH pruner operates during compaction and rewrites over-budget model-facing tool-result surfaces.

`dsh-cas-results` acts earlier.

Desired composition:

```text
Tool executes
     │
     ▼
dsh-cas-results
     │
large original → CAS
     │
small preview
     ▼
session/model
     │
     │ many turns later
     ▼
DSH tool-result-pruner / compaction
```

CAS therefore prevents the large payload from entering ordinary context in the first place.

---

# 7. High-level architecture

```text
                  Tool Runtime
                       │
                       ▼
                tools/execute
                       │
                       ▼
               original result
                       │
              ┌────────┴────────┐
              │                 │
          error result     success result
              │                 │
           passthrough           ▼
                         Result Scanner
                               │
                      recursive strings
                               │
                               ▼
                        Candidate Detector
                               │
              ┌────────────────┼───────────────┐
              │                │               │
             text             HTML           base64
              │                │               │
              └────────────────┼───────────────┘
                               ▼
                           CAS Store
                               │
                       SHA-256(payload)
                               │
                     ┌─────────┴─────────┐
                     │                   │
                 already exists        new
                     │                   │
                     └─────────┬─────────┘
                               ▼
                         Preview Builder
                               │
                               ▼
                         modified value
                               │
                               ▼
                       DSH session/model


Agent needs details
       │
       ▼
dsh_cas_retrieve / dsh_cas_search
       │
       ▼
    CAS Store
```

---

# 8. DSH integration

## Primary integration point

Use the same general seam proven by `dsh-funnel`:

```javascript
ctx.on('tools/execute', async (exec, next) => {
  const result = await next()

  // inspect successful canonical result.value
})
```

The plugin SHOULD operate on canonical `result.value`, rather than trying to edit an already persisted session event afterwards.

Pseudo implementation:

```javascript
ctx.on('tools/execute', async (exec, next) => {
  const result = await next()

  if (result.isError) {
    return result
  }

  if (isOwnTool(exec.name)) {
    return result
  }

  try {
    const transformed = await transformValue(
      result.value,
      buildPolicy(exec),
    )

    return transformed.changed
      ? { ...result, value: transformed.value }
      : result
  } catch (error) {
    logger.warn('CAS transformation failed; returning original result', error)
    return result
  }
})
```

Important invariant:

> Storage/transformation errors MUST cause passthrough of the original value, never disappearance of content.

---

# 9. CAS service

Storage logic SHOULD be separated from the DSH integration code.

Suggested interface:

```typescript
interface CasStore {
  put(input: PutInput): Promise<CasObject>
  has(hash: string): Promise<boolean>
  stat(hash: string): Promise<CasMetadata | null>

  read(
    hash: string,
    options?: ReadOptions
  ): Promise<ReadResult>

  search(
    hash: string,
    query: SearchQuery
  ): Promise<SearchResult>

  touch(hash: string): Promise<void>

  gc(options?: GcOptions): Promise<GcResult>

  stats(): Promise<CasStats>
}
```

This separation allows a future alternative backend without touching result interception.

Possible future implementations:

```text
CasStore
 ├── FilesystemCasStore       # v1
 ├── S3CasStore               # future
 └── MinioCasStore            # future
```

Only the filesystem implementation belongs in v1.

---

# 10. Content identity

## Text

For normal textual content:

```text
payload = UTF-8 bytes of exact original string
hash = SHA-256(payload)
```

Do NOT normalize:

- CRLF/LF;
- whitespace;
- Unicode normalization;
- trailing newlines;
- JSON formatting.

Two values are identical only if their original byte representation is identical.

This guarantees exact text retrieval.

Example:

```text
sha256:ac78199a1c8f...
```

## Binary/base64

Base64 is special.

Consider:

```text
data:image/png;base64,iVBOR...
```

and:

```text
iVBOR...
```

The same underlying PNG should ideally be stored only once.

For confidently detected base64:

```text
decode base64
     ↓
binary bytes
     ↓
SHA-256(binary)
     ↓
CAS
```

Metadata stores:

```json
{
  "kind": "binary",
  "sourceRepresentation": "base64",
  "mediaType": "image/png"
}
```

Retrieval can regenerate canonical base64 when requested.

### Invariant

For text:

```text
retrieved bytes === original UTF-8 bytes
```

For decoded base64:

```text
retrieved binary payload === original decoded binary payload
```

Exact whitespace/padding formatting of the original base64 representation is not required unless an explicit future `preserveBase64Representation` mode is enabled.

---

# 11. Base64 detection

Base64 detection MUST be conservative.

A long random-looking string should not automatically be decoded merely because its alphabet happens to match base64.

Detection pipeline:

```text
candidate string
     │
     ├─ data:*;base64,... ? ───── yes
     │
     └─ raw base64 candidate
              │
              ▼
       validate alphabet
              │
       validate length
              │
      attempt strict decode
              │
       re-encode canonical
              │
       compare semantics
              │
              ▼
          binary payload
```

Suggested defaults:

```yaml
base64:
  enabled: true
  minChars: 8192
  requireStrongDetection: true
```

Common data URI formats should receive stronger confidence.

---

# 12. Candidate selection

The plugin should not hash/offload every tiny string.

Suggested candidate rules:

```yaml
thresholds:
  textBytes: 16384
  htmlBytes: 8192
  logBytes: 16384
  base64Chars: 8192
```

Strings below these limits pass through byte-identical.

The scanner SHOULD recursively traverse JSON-like canonical result values:

```javascript
{
  stdout: "...",
  stderr: "...",
  response: {
    html: "..."
  }
}
```

Each large string can become an independent CAS object.

This preserves the shape of structured results.

---

# 13. Repeated results

There are two distinct forms of deduplication.

## Storage deduplication — required in v1

Every candidate receives a SHA-256.

If the blob already exists:

```text
do not write it again
```

Example:

```text
10 tool calls
10 × identical 5 MiB output
```

Expected storage:

```text
1 blob ≈ 5 MiB
not
10 blobs ≈ 50 MiB
```

Metadata may record:

```json
{
  "writeCount": 1,
  "hitCount": 9
}
```

`hitCount` is advisory and does not need to be transactional in v1.

## Repeat-aware context offloading — phase 2

Moderately sized results may be acceptable once but wasteful when repeated.

Future policy:

```yaml
repeats:
  enabled: true
  minBytes: 2048
  after: 2
  scope: session
```

Example:

```text
first appearance:
full 4 KiB result

second appearance:
full 4 KiB result

third+:
short preview + existing CAS reference
```

Default repeat scope SHOULD eventually be `session`, not global, so a new unrelated session does not unexpectedly see reduced output merely because another previous session encountered the same value.

If DSH's execution metadata does not expose a reliable session identifier at the chosen seam, global repeat-aware transformation SHOULD be deferred rather than approximated incorrectly.

Storage-level CAS deduplication remains global regardless.

---

# 14. Blob layout

Default root:

```text
<DSH_HOME>/storages/dsh-cas-results/
```

Suggested structure:

```text
dsh-cas-results/
├── blobs/
│   └── sha256/
│       ├── ac/
│       │   └── 78/
│       │       └── ac7819...e029.blob
│       └── ...
├── meta/
│   └── sha256/
│       ├── ac/
│       │   └── 78/
│       │       └── ac7819...e029.json
│       └── ...
├── tmp/
└── state.json
```

Two-level prefix sharding prevents giant directories.

Blob path is derived solely from validated SHA-256.

Never interpolate arbitrary user strings into filesystem paths.

---

# 15. Blob metadata

Example:

```json
{
  "version": 1,
  "algorithm": "sha256",
  "hash": "ac7819...e029",
  "size": 2871934,
  "storedSize": 381044,
  "kind": "html",
  "mediaType": "text/html",
  "encoding": "utf8",
  "storageCodec": "gzip",
  "createdAt": "2026-08-30T18:42:00.000Z",
  "lastAccessedAt": "2026-08-30T18:45:11.000Z",
  "firstTool": "web_fetch",
  "hits": 4
}
```

Metadata is informative.

The blob's hash remains the authoritative identity.

---

# 16. Atomic writes

Concurrency is important because multiple agents/tools may produce the same result simultaneously.

Required sequence:

```text
hash content
     │
     ▼
does blob exist?
     │
     ├─ yes → reuse
     │
     └─ no
         │
         ▼
      write temp
         │
      fsync/close
         │
      atomic rename/create
         │
    another writer won?
         │
         ├─ yes → discard temp
         └─ no  → blob committed
```

Alternative implementation using exclusive file creation is acceptable.

The design MUST tolerate two processes attempting to commit the same hash simultaneously.

---

# 17. On-disk compression

SHA-256 should be computed over the **logical uncompressed payload**.

Storage representation may optionally be compressed afterwards.

Example:

```text
raw log
   │
   ├─ SHA-256(raw)
   │
   ▼
gzip(raw)
   │
   ▼
<hash>.blob
```

Suggested configuration:

```yaml
storage:
  compression: auto
```

Modes:

```text
none
gzip
auto
```

`auto` should compress textual content when worthwhile and leave already-compressed formats alone.

Do not recompute identity from compressed bytes.

---

# 18. Preview generation

Previewing must be deterministic, cheap and independent of an LLM.

## Generic text

Keep:

- beginning;
- ending;
- omission marker.

Example:

```text
[first 40 lines]

[dsh-cas-results: 18,421 lines omitted]

[last 40 lines]
```

## Logs

Prefer:

- first N lines;
- last N lines;
- lines matching important patterns;
- short context around failures.

Default patterns:

```text
error
warn
fail
fatal
exception
assert
panic
denied
timeout
```

Patterns should be configurable.

This behavior may reuse/adapt the proven approach from `dsh-funnel`, subject to attribution/license requirements.

## HTML

Default model preview:

```text
HTML document
title: Example
size: 842 KiB

[text-only beginning...]

[...]

[text-only ending...]

Full source: sha256:...
```

Do not include huge inline scripts/styles in the preview.

The original raw HTML remains in CAS.

## Base64/binary

Never include a large portion of base64 in the preview.

Example:

```text
[dsh-cas-results]
Binary payload offloaded
media-type: image/png
decoded-size: 2.4 MiB
sha256: 9f023e...
retrieve: dsh_cas_retrieve(...)
```

---

# 19. Marker format

Markers should be recognizable but compact.

Recommended human-readable form:

```text
[dsh-cas-results: 2871934B html → 4096B preview; sha256=ac7819...e029; use dsh_cas_retrieve]
```

For maximum agent reliability, include an explicit tool hint:

```text
Full content:
dsh_cas_retrieve(ref="sha256:ac7819...e029")
```

The hash MUST always be the complete SHA-256 in machine-readable metadata or tool arguments, even if UI text displays a shortened hash.

---

# 20. Retrieval tools

## `dsh_cas_retrieve`

Retrieve a bounded portion of an object.

Schema conceptually:

```typescript
{
  ref: string

  offset?: number
  limit?: number

  encoding?: "auto" | "utf8" | "base64" | "hex"
}
```

Default:

```text
limit = 32768 bytes
```

Maximum configurable hard limit:

```text
256 KiB
```

The tool SHOULD NOT dump a 100 MiB blob back into context merely because the model asked to retrieve it.

Response:

```text
CAS object sha256:...
type: text
bytes: 0..32767 / 2481933

<content>

More available.
Call dsh_cas_retrieve with offset=32768.
```

## `dsh_cas_search`

Very useful for large logs/HTML.

Arguments:

```typescript
{
  ref: string
  query: string
  maxMatches?: number
  contextLines?: number
  caseSensitive?: boolean
}
```

Example:

```text
dsh_cas_search(
  ref="sha256:...",
  query="AssertionError",
  contextLines=4
)
```

This is preferable to reinjecting a 20 MiB log simply to find one error.

For v1, plain substring search is sufficient.

Regex can be added later.

## `dsh_cas_info`

Arguments:

```typescript
{
  ref: string
}
```

Returns:

- size;
- detected type;
- MIME;
- creation time;
- last access;
- storage codec;
- hit count;
- whether object currently exists.

## `dsh_cas_stats`

Returns aggregate statistics.

Example:

```text
objects:             1,842
logical bytes:       12.8 GiB
stored bytes:         3.1 GiB
deduplicated writes: 7,921
CAS hit rate:         81.1%
largest object:       84 MiB
```

## Optional `dsh_cas_gc`

May be exposed to the model only if explicitly enabled.

Prefer an admin/command path eventually rather than encouraging ordinary agents to delete retrieval data.

---

# 21. Self-tool recursion protection

All plugin tools MUST bypass CAS transformation:

```text
dsh_cas_retrieve
dsh_cas_search
dsh_cas_info
dsh_cas_stats
dsh_cas_gc
```

Otherwise:

```text
retrieve huge object
     ↓
result considered huge
     ↓
offloaded again
     ↓
agent receives another pointer
```

would create a useless retrieval loop.

Retrieval results are instead bounded at the tool implementation itself.

---

# 22. Tool policies

Config should allow tool-specific behavior.

Example:

```yaml
tools:
  bash:
    thresholdBytes: 8192
    preview: log

  web_fetch:
    thresholdBytes: 8192
    preview: html

  read:
    thresholdBytes: 65536

  screenshot:
    base64: true
```

Also:

```yaml
excludeTools:
  - edit
  - write
```

Source/editing tools need conservative defaults because replacing source snapshots can interfere with read → edit workflows.

The exact default exclusion list should be validated against current DSH tool behavior during implementation.

---

# 23. Default configuration

Suggested initial config:

```yaml
- id: dsh-cas-results
  name: dsh-cas-results
  config:
    enabled: true

    storeDir: null

    thresholds:
      textBytes: 16384
      htmlBytes: 8192
      logBytes: 16384

    preview:
      maxChars: 4096
      keepHeadLines: 20
      keepTailLines: 30
      keepPatterns:
        - error
        - warn
        - fail
        - fatal
        - exception
        - assert
        - panic
        - denied
        - timeout

    base64:
      enabled: true
      minChars: 8192
      requireStrongDetection: true

    storage:
      compression: auto
      maxBytes: 10737418240   # 10 GiB

    retrieval:
      defaultBytes: 32768
      maxBytes: 262144

    gc:
      enabled: true
      intervalMs: 3600000
      ttlMs: 2592000000       # 30 days
      minAgeMs: 86400000

    includeErrors: false

    excludeTools: []

    tools: {}
```

`storeDir: null` resolves to:

```text
<DSH_HOME>/storages/dsh-cas-results
```

---

# 24. Garbage collection

CAS creates an important lifecycle problem:

Session logs can retain:

```text
sha256:abc...
```

long after the original tool call.

Deleting that blob breaks exact historical retrieval.

Therefore GC must be explicit and predictable.

## V1 policy

Use bounded LRU/TTL-like retention:

```text
eligible if:
age > ttl
OR
store exceeds maxBytes
```

When over quota:

```text
oldest lastAccessedAt first
```

Objects younger than `minAgeMs` should not be deleted merely due to routine GC unless a hard emergency limit is exceeded.

## Missing/expired objects

Retrieval must produce a clear result:

```text
CAS object sha256:... is no longer available.
It may have expired or been garbage-collected.

If possible, re-run the original tool call.
```

Never silently return empty data.

## Future improvement

A later DSH-specific GC implementation may scan durable session references and implement mark-and-sweep:

```text
session logs
    ↓
collect live SHA references
    ↓
CAS objects
    ↓
delete only unreachable objects
```

This should be Phase 3+, because coupling v1 tightly to DSH persistence internals would make the plugin much more fragile across upstream updates.

---

# 25. Security

The CAS may contain highly sensitive information because tool output itself may contain:

- API keys;
- environment variables;
- source code;
- private HTML;
- logs;
- credentials accidentally printed by commands.

Therefore:

### Filesystem permissions

On POSIX:

```text
store directory: 0700
blob/meta files: 0600
```

where possible.

### No implicit HTTP serving

Blobs MUST NOT automatically be made accessible through:

```text
/api/cas/<hash>
```

or other browser routes in v1.

Only DSH-side retrieval tools should access them.

### Hash validation

Accepted refs:

```regex
^sha256:[a-f0-9]{64}$
```

No arbitrary filesystem path may be accepted by retrieval tools.

### Limits

Retrieval must have hard byte limits.

Search must have:

- max matches;
- max line length;
- max output bytes.

### Exclusions

Users need `excludeTools` and per-tool policies for data they do not want persisted to CAS.

---

# 26. Failure handling

CAS must always fail open with respect to the original result.

### Disk full

```text
put() fails
→ log warning
→ leave original tool result untouched
```

### Permission denied

Same.

### Hashing failure

Same.

### Metadata write failure after committed blob

Blob may remain orphaned.

GC should eventually handle it.

Tool output must still either:

1. reference a confirmed readable blob; or
2. remain original.

Never replace the result with a CAS reference before durable storage succeeds.

### Corrupt stored blob

On retrieval:

1. decompress;
2. optionally re-hash;
3. compare with expected SHA-256.

If verification fails:

```text
CAS object integrity check failed
```

Do not return corrupted content as valid.

---

# 27. Compatibility with dsh-funnel / Headroom plugins

Running two independent ingestion transformers over the same tool result can create ordering-dependent behavior.

Example:

```text
original
→ dsh-funnel truncates
→ dsh-cas-results stores truncated result
```

or:

```text
original
→ CAS preview
→ Headroom compresses CAS preview
```

Neither is ideal.

## V1 recommendation

Document that:

```text
dsh-funnel
dsh-headroom
dsh-compressor
dsh-cas-results
```

may overlap in responsibilities and should not blindly be enabled simultaneously.

The plugin should detect its own marker to prevent repeated processing.

## Long-term solution

Expose a reusable service:

```typescript
ctx.casResults
```

or equivalent plugin-local capability.

Then another compression plugin could do:

```text
original
   │
   ├─ smart preview from Headroom/Funnel
   │
   └─ original stored through dsh-cas-results
```

This produces clean separation:

```text
Preview policy
≠
Storage policy
```

That is likely the best long-term architecture.

---

# 28. Observability

Track at least:

```text
resultsScanned
stringsScanned
objectsStored
casHits
logicalBytesSeen
logicalBytesOffloaded
physicalBytesWritten
previewBytes
retrievalCalls
searchCalls
retrievalBytes
gcObjectsDeleted
gcBytesFreed
storageErrors
```

Derived metrics:

```text
dedupRatio =
logicalBytesOffloaded / physicalBytesWritten

contextReduction =
1 - previewBytes / logicalBytesOffloaded
```

Statistics should be available through `dsh_cas_stats`.

If a stable DSH/OpenTelemetry metrics extension point is available, exporting the same counters to OTel can be added separately.

Do not make OTel a v1 requirement.

---

# 29. Suggested repository structure

```text
dsh-cas-results/
├── src/
│   ├── index.ts
│   │
│   ├── integration/
│   │   ├── tools-execute.ts
│   │   └── policies.ts
│   │
│   ├── cas/
│   │   ├── store.ts
│   │   ├── filesystem-store.ts
│   │   ├── hash.ts
│   │   ├── metadata.ts
│   │   ├── compression.ts
│   │   └── gc.ts
│   │
│   ├── transform/
│   │   ├── scan-value.ts
│   │   ├── candidate.ts
│   │   ├── base64.ts
│   │   ├── classify.ts
│   │   └── marker.ts
│   │
│   ├── preview/
│   │   ├── index.ts
│   │   ├── text.ts
│   │   ├── log.ts
│   │   ├── html.ts
│   │   └── binary.ts
│   │
│   └── tools/
│       ├── retrieve.ts
│       ├── search.ts
│       ├── info.ts
│       └── stats.ts
│
├── tests/
│   ├── unit/
│   │   ├── hash.test.ts
│   │   ├── store.test.ts
│   │   ├── dedup.test.ts
│   │   ├── base64.test.ts
│   │   ├── preview.test.ts
│   │   └── gc.test.ts
│   │
│   ├── integration/
│   │   ├── plugin.test.ts
│   │   ├── retrieve.test.ts
│   │   └── concurrency.test.ts
│   │
│   └── fixtures/
│
├── scripts/
│   ├── benchmark.ts
│   └── inspect-store.ts
│
├── dsh.plugin.json
├── cordis.patch.yml
├── package.json
├── README.md
├── NOTICE.md
├── LICENSE
└── CHANGELOG.md
```

If the implementation remains plain JS like `dsh-funnel`, the same module split can use `.mjs`.

---

# 30. Implementation plan

## Phase 0 — baseline and licensing

Start from understanding/reusing the smallest useful parts of `dsh-funnel`.

Tasks:

- document source attribution;
- copy MIT license requirements if source is reused;
- create `NOTICE.md`;
- establish plugin skeleton;
- verify current DSH `tools/execute` behavior;
- make a minimal integration test proving transformation of `result.value`.

Deliverable:

```text
tool executes
→ wrapper sees canonical result.value
→ test can replace one string
```

No CAS yet.

---

## Phase 1 — filesystem CAS

Implement:

- SHA-256 hashing;
- filesystem layout;
- atomic writes;
- exact reads;
- metadata;
- duplicate detection;
- concurrent writer safety.

Tests:

```text
put(A) → blob created

put(A) again
→ same hash
→ no second blob

put(B)
→ different hash

read(hash(A))
→ exact A
```

Acceptance target:

```text
100 concurrent put(A)
→ exactly one valid CAS blob
```

---

## Phase 2 — result scanner and previews

Implement recursive scanning based on the `dsh-funnel` approach.

Add:

- candidate thresholds;
- tool exclusions;
- generic text preview;
- log preview;
- HTML preview;
- marker generation.

Critical sequence:

```text
store original successfully
        ↓
build preview
        ↓
replace canonical value
```

Never the reverse.

---

## Phase 3 — retrieval

Implement:

```text
dsh_cas_retrieve
dsh_cas_search
dsh_cas_info
dsh_cas_stats
```

Add:

- byte bounds;
- pagination;
- search limits;
- strict hash parsing;
- missing blob messages;
- own-tool bypass.

Acceptance:

A middle line omitted from a 10 MiB log must be obtainable without reinjecting the entire 10 MiB result.

---

## Phase 4 — base64 and binary deduplication

Implement:

- data URI recognition;
- conservative raw-base64 recognition;
- strict decode;
- binary hashing;
- MIME metadata;
- canonical base64 retrieval.

Tests need fixtures where:

```text
same PNG
represented through equivalent base64 payloads
→ one binary CAS object
```

Also fuzz/random-string tests to avoid false base64 detection.

---

## Phase 5 — GC and quotas

Implement:

- last-access tracking;
- TTL;
- max storage size;
- LRU-ish eviction;
- GC statistics;
- orphan temp cleanup on startup.

GC MUST never race with currently open retrieval in a way that returns partial content.

---

## Phase 6 — optional storage compression

Implement:

```text
none
gzip
auto
```

Hash logical raw content.

Verify after decompression.

Benchmarks should compare:

- hashing cost;
- compression cost;
- disk reduction;
- retrieval latency.

---

## Phase 7 — repeat-aware offload

Only after a reliable notion of session identity has been verified.

Implement:

```yaml
repeats:
  enabled: true
  after: 2
  minBytes: 2048
  scope: session
```

This extends CAS from pure storage deduplication into context-level repeat suppression.

Keep this separate from the core CAS implementation.

---

# 31. Test matrix

## Text

- short text unchanged;
- large text offloaded;
- Unicode;
- CRLF;
- huge individual line;
- NUL-containing string.

## Logs

- error in middle retained in preview;
- repeated lines;
- giant stack trace;
- ANSI escape sequences.

## HTML

- title extraction;
- huge `<script>`;
- huge `<style>`;
- malformed HTML.

## JSON-like tool values

- nested object;
- array;
- multiple large strings;
- null;
- primitive values;
- object with no large fields.

## Base64

- valid data URI;
- valid raw base64;
- invalid padding;
- random alphanumeric string;
- same binary through different accepted representations.

## CAS

- duplicate writes;
- concurrent duplicate writes;
- interrupted write;
- corrupt compressed blob;
- missing metadata;
- missing blob;
- store directory permission failure.

## Retrieval

- first chunk;
- middle chunk;
- last chunk;
- beyond EOF;
- invalid hash;
- deleted object;
- text;
- binary/base64.

## GC

- expired object;
- recently accessed object;
- over quota;
- concurrent retrieval;
- orphan temp file.

---

# 32. Benchmarks

Include a reproducible benchmark script.

Example workload:

```text
100 × identical 1 MiB log
100 × unique 1 MiB log
20 × 5 MiB HTML
20 × identical 4 MiB PNG as base64
```

Measure:

```text
input bytes
model-visible bytes
logical CAS bytes
physical disk bytes
unique blob count
CAS hit count
hashing time
preview time
storage write time
retrieval latency
```

Expected repeated case:

```text
100 × same 1 MiB result

logical output:
100 MiB

CAS:
≈1 MiB before optional compression

session-visible:
100 × small preview
```

---

# 33. Acceptance criteria for v1

The first stable release is complete when all of the following hold.

### AC1 — large result offloading

A successful tool result containing a >16 KiB textual field is stored in CAS and replaced by a bounded preview.

### AC2 — exact text retrieval

For textual payloads:

```text
SHA256(retrieved) === stored reference
```

and retrieved content is byte-identical to the original UTF-8 payload.

### AC3 — deduplication

Ten identical tool outputs create one physical blob.

### AC4 — stable reference

The same payload always produces the same:

```text
sha256:<64 hex>
```

reference.

### AC5 — binary dedup

Equivalent supported base64 representations of the same binary payload resolve to the same binary SHA-256.

### AC6 — context safety

Default retrieval never returns more than the configured retrieval chunk limit.

### AC7 — failure safety

Unwritable CAS storage causes the original tool result to pass through unchanged.

### AC8 — error safety

Tool errors remain untouched by default.

### AC9 — recursion safety

`dsh_cas_retrieve` output is never automatically offloaded again.

### AC10 — concurrency

Concurrent writes of identical data cannot corrupt the blob.

### AC11 — bounded storage

GC can enforce the configured maximum storage size.

### AC12 — attribution

README and NOTICE visibly credit `dsh-funnel` and YuanyuanMa03.

---

# 34. Recommended v1 scope

Do NOT attempt every feature in the initial implementation.

The cleanest useful v1 is:

```text
tools/execute interception
        +
recursive string scanner
        +
SHA-256 filesystem CAS
        +
storage dedup
        +
text/log/HTML previews
        +
base64 decoding
        +
dsh_cas_retrieve
        +
dsh_cas_search
        +
basic GC
        +
stats
```

Leave these for later:

```text
semantic compression
cross-session repeat policy
S3/MinIO
UI browser
session-aware mark-and-sweep
advanced MIME detection
OTel integration
```

---

# 35. Future architecture: CAS as shared DSH capability

The most interesting long-term direction is to separate result storage from result presentation entirely.

Conceptually:

```text
                     ┌─ Funnel preview
                     │
tool result ──► CAS ─┼─ Headroom preview
                     │
                     ├─ custom JSON preview
                     │
                     └─ plain head/tail preview
```

`dsh-cas-results` could eventually expose something like:

```typescript
ctx.casResults.put(...)
ctx.casResults.read(...)
ctx.casResults.search(...)
```

Then other plugins would no longer need to invent their own:

- spill directories;
- CCR JSON stores;
- retrieval IDs;
- TTL systems;
- duplicate storage.

This would turn `dsh-cas-results` into a small storage primitive for the wider DSH plugin ecosystem rather than merely one more context-management plugin.

That direction should influence internal interfaces from day one, even if the service is initially only consumed by the plugin itself.

---

# 36. One-sentence product definition

> **dsh-cas-results keeps bulky tool output out of the model context without throwing it away: content is stored once by SHA-256, the session keeps only a useful preview and stable reference, and the agent can retrieve or search the original on demand.**