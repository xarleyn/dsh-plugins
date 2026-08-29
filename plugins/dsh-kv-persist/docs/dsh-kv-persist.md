# dsh-kv-persist

> Persistent KV-cache/session-state manager for DeepSeek Harness.

**Status:** Draft / Initial Specification  
**Target:** DeepSeek Harness + llama.cpp `llama-server`  
**Initial version:** `0.1.0`  
**Primary backend:** llama.cpp slot save/restore API  
**Future backends:** vLLM / SGLang / other providers exposing reusable prefix/session state

---

## 1. Summary

`dsh-kv-persist` is a DeepSeek Harness infrastructure plugin that persists LLM runtime cache state between sessions and process restarts.

The first implementation targets `llama-server` and its slot persistence API:

- `GET /slots`
- `POST /slots/{id}?action=save`
- `POST /slots/{id}?action=restore`
- `POST /slots/{id}?action=erase`

llama.cpp can persist a slot's prompt/KV state into a file under `--slot-save-path`, then restore that state later.

The plugin maps:

```text
DSH session
    ↓
provider + model + server instance
    ↓
llama.cpp slot
    ↓
persistent snapshot
```

Its main purpose is to avoid re-prefilling tens or hundreds of thousands of tokens whenever:

- the user switches between DSH sessions;
- `llama-server` evicts a session from its active slot;
- DSH is restarted;
- `llama-server` is restarted;
- another request temporarily pollutes the active slot;
- multiple projects share the same local model server.

For a large agent prompt this can turn:

```text
restore session
→ process 40K–100K prompt tokens again
→ wait tens/hundreds of seconds
```

into:

```text
restore session
→ load KV snapshot
→ process only changed suffix
```

---

# 2. Goals

The plugin MUST:

1. Associate persistent cache snapshots with DSH `session.id`.
2. Automatically restore the appropriate snapshot before a session resumes.
3. Automatically save dirty cache state according to a configurable checkpoint policy.
4. Prevent one DSH session from accidentally reusing another session's slot as authoritative state.
5. Detect incompatible or stale snapshots and fail safely.
6. Never make the model-visible conversation depend on the snapshot.
7. Treat KV persistence purely as an optimization.
8. Fall back to normal cold prompt processing whenever persistence is unavailable.
9. Work with a normal OpenAI-compatible `llama-server`.
10. Provide useful observability:
   - restore hit/miss;
   - bytes saved/read;
   - save/restore latency;
   - cache tokens;
   - slot ownership;
   - snapshot age;
   - cold fallback count.
11. Survive plugin hot reload and normal Cordis disposal cleanly.
12. Be backend-agnostic internally even though llama.cpp is the first backend.

DeepSeek Harness already treats sessions as append-only durable state and derives LLM messages from that state, so persisted KV MUST remain a disposable acceleration layer rather than a second source of truth.

---

# 3. Non-goals

Initial versions MUST NOT:

- replace DSH session persistence;
- store actual conversation history as the authoritative state;
- attempt to reconstruct missing DSH events from KV;
- modify model-visible prompts to improve cache hits;
- expose KV management as an LLM tool;
- assume snapshots are portable between different models;
- assume snapshots are portable between arbitrary llama.cpp builds;
- manage llama-server process startup itself;
- transparently migrate a snapshot between machines;
- promise persistence support for every recurrent/hybrid model;
- require DSH UI modifications.

The model should ideally never know this plugin exists.

---

# 4. Core design principle

The following relationship is fundamental:

```text
DSH session log = truth
KV snapshot     = derived cache
```

A snapshot can always be deleted.

Deleting:

```text
$DSH_HOME/cache/dsh-kv-persist/...
```

must never destroy the conversation.

The worst possible consequence of missing or invalid KV state must be:

```text
cold prefill
```

not:

```text
corrupted conversation
wrong session
missing messages
incorrect continuation
```

---

# 5. Relevant DSH architecture

DSH exposes an in-memory `ctx.sessions` service.

A `Session` has a stable `session.id` and an append-only sequence of `SessionEvent`s. LLM history is derived from those events rather than stored as a separate mutable chat history. DSH persistence plugins can observe `session/event`, `session/flush`, `session/created`, and `session/disposed`.

Model calls eventually pass through:

```text
agent loop
    ↓
agent/request
    ↓
prepareCall()
    ↓
llm/stream
    ↓
LLM adapter
    ↓
llama-server
```

`llm/stream` is explicitly intended to support infrastructure such as caching/logging/routing. Loop-generated `GenerateOptions` are deep-frozen and must be observed rather than mutated.

`GenerateOptions` also carries:

```ts
sessionId?: SessionId
purpose?: 'compaction' | 'session-title'
```

which gives the plugin enough information to distinguish ordinary session inference from auxiliary LLM requests.

---

# 6. llama.cpp backend

## 6.1 Server requirements

The llama server should be started with at least:

```bash
llama-server \
  ... \
  --slots \
  --slot-save-path /some/path
```

For the initial MVP:

```bash
--parallel 1
```

is strongly recommended.

Example:

```bash
./llama-server \
  -m Qwen3.8-27B-GSQ-RCO-IQ2_XS.gguf \
  --ctx-size 131072 \
  --parallel 1 \
  --flash-attn on \
  --cache-type-k q4_0 \
  --cache-type-v q4_0 \
  --n-gpu-layers all \
  --slot-save-path E:/LLM/kv-cache \
  --host 127.0.0.1 \
  --port 8080
```

---

# 7. Why the MVP should use one slot

With:

```text
--parallel 1
```

there is one inference slot:

```text
slot 0
```

Therefore the plugin doesn't need to modify OpenAI request bodies.

It can treat slot `0` as an expensive hardware-backed working register:

```text
                 ┌──────────────┐
session A ─────► │              │
session B ─────► │    slot 0    │
session C ─────► │              │
                 └──────────────┘
                         ↕
                   snapshots
```

Switching A → B becomes:

```text
save A if dirty
restore B
run B
```

Switching B → A:

```text
save B if dirty
restore A
run A
```

This makes an excellent first implementation because:

- there is no slot allocator;
- there are no slot races;
- no llama-specific fields have to enter DSH `GenerateOptions`;
- the existing DSH LLM adapter can remain untouched.

---

# 8. Multi-slot limitation

llama.cpp supports specifying:

```json
{
  "id_slot": 2
}
```

on inference requests, allowing a client to explicitly select a slot.

However DSH's `GenerateOptions` deliberately contains provider-neutral fields and loop requests are immutable. `llm/stream` middleware therefore cannot safely do:

```ts
options.id_slot = 2
```

or otherwise inject arbitrary llama.cpp transport fields.

Consequently:

```text
v0.1:
parallel=1
generic middleware
slot 0

v0.2+:
managed multi-slot mode
custom llama.cpp transport adapter
```

This separation should be intentional.

---

# 9. High-level architecture

```text
┌──────────────────────────────────────────────────────┐
│                DeepSeek Harness                      │
│                                                      │
│  ctx.sessions                                        │
│      │                                               │
│      ├──── session lifecycle ───────┐                │
│      │                              │                │
│  ctx.llm                            │                │
│      │                              │                │
│      └──── llm/stream ──────────────┤                │
│                                     ▼                │
│                           KvPersistService           │
│                          /        │        \          │
│                         /         │         \         │
│                  Coordinator   Metadata   Metrics     │
│                       │                              │
│                       ▼                              │
│                 KvBackend interface                 │
│                       │                              │
│                       ▼                              │
│                LlamaCppBackend                      │
└───────────────────────┼──────────────────────────────┘
                        │ HTTP
                        ▼
                 ┌───────────────┐
                 │ llama-server  │
                 │               │
                 │ slot 0        │
                 │ /slots API    │
                 └───────┬───────┘
                         │
                         ▼
                 --slot-save-path
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   session-A.bin    session-B.bin    session-C.bin
```

---

# 10. Package layout

Recommended repository structure:

```text
dsh-kv-persist/
├─ src/
│  ├─ index.ts
│  ├─ config.ts
│  ├─ service.ts
│  │
│  ├─ coordinator/
│  │  ├─ coordinator.ts
│  │  ├─ slot-lease.ts
│  │  ├─ state-machine.ts
│  │  └─ checkpoint-policy.ts
│  │
│  ├─ backends/
│  │  ├─ types.ts
│  │  └─ llama-cpp/
│  │     ├─ backend.ts
│  │     ├─ client.ts
│  │     ├─ discovery.ts
│  │     ├─ compatibility.ts
│  │     └─ types.ts
│  │
│  ├─ snapshots/
│  │  ├─ manifest.ts
│  │  ├─ naming.ts
│  │  ├─ fingerprint.ts
│  │  └─ repository.ts
│  │
│  ├─ observability/
│  │  ├─ metrics.ts
│  │  └─ diagnostics.ts
│  │
│  └─ errors.ts
│
├─ test/
│  ├─ unit/
│  ├─ integration/
│  └─ fixtures/
│
├─ cordis.patch.yml
├─ package.json
├─ tsconfig.json
├─ README.md
└─ SPEC.md
```

Do not put the entire implementation into `index.ts`.

---

# 11. Public service

The plugin SHOULD expose:

```ts
ctx.kvPersist
```

through a Cordis `Service`.

Approximate API:

```ts
interface KvPersistService {
  status(): Promise<KvPersistStatus>

  getSessionState(
    sessionId: string,
  ): Promise<SessionKvState | undefined>

  save(
    sessionId: string,
    options?: SaveOptions,
  ): Promise<SnapshotResult>

  restore(
    sessionId: string,
    options?: RestoreOptions,
  ): Promise<RestoreResult>

  invalidate(
    sessionId: string,
    reason?: string,
  ): Promise<void>

  purge(
    sessionId: string,
  ): Promise<void>

  flush(): Promise<void>
}
```

The service makes future UI/CLI plugins possible without depending directly on llama.cpp.

---

# 12. Backend abstraction

Core code must NOT contain direct `/slots` HTTP calls.

Define:

```ts
interface KvPersistenceBackend {
  readonly kind: string

  probe(signal?: AbortSignal): Promise<BackendCapabilities>

  inspectSlots(
    signal?: AbortSignal,
  ): Promise<BackendSlot[]>

  saveSlot(
    slotId: number,
    snapshotKey: string,
    signal?: AbortSignal,
  ): Promise<BackendSaveResult>

  restoreSlot(
    slotId: number,
    snapshotKey: string,
    signal?: AbortSignal,
  ): Promise<BackendRestoreResult>

  eraseSlot(
    slotId: number,
    signal?: AbortSignal,
  ): Promise<BackendEraseResult>
}
```

Initial implementation:

```text
KvPersistenceBackend
└── LlamaCppBackend
```

Potential future implementations:

```text
KvPersistenceBackend
├── LlamaCppBackend
├── SglangBackend
├── VllmBackend
└── CustomGatewayBackend
```

---

# 13. Snapshot identity

A snapshot must never be identified by `sessionId` alone.

Conceptual key:

```text
SnapshotKey =
  server instance
+ provider
+ model
+ DSH session
+ compatibility generation
```

Example:

```ts
interface SnapshotIdentity {
  sessionId: string

  provider: string
  model: string

  backend: 'llama.cpp'

  serverInstanceKey: string
  modelFingerprint: string

  compatibilityVersion: number
}
```

---

# 14. Snapshot metadata

The plugin keeps its own small metadata record independently from the potentially huge `.bin` file.

Example:

```json
{
  "schemaVersion": 1,

  "sessionId": "01991d...",
  "sessionSeq": 341,

  "provider": "local-qwen",
  "model": "Qwen3.8-27B-GSQ-RCO-IQ2_XS.gguf",

  "backend": "llama.cpp",
  "serverInstanceKey": "local-3060",
  "serverEndpointHash": "sha256:...",

  "modelFingerprint": "sha256:...",
  "runtimeFingerprint": "sha256:...",

  "slotId": 0,

  "createdAt": "2026-08-29T20:00:00Z",
  "updatedAt": "2026-08-29T20:42:00Z",

  "tokens": 48321,
  "bytes": 2384203912,

  "snapshotFilename": "b3-c5-....bin",

  "state": "ready"
}
```

---

# 15. Runtime fingerprint

Restoring arbitrary binary model state is dangerous.

Snapshots should therefore have a compatibility fingerprint.

Suggested fingerprint inputs:

```text
backend type
llama.cpp server/build version, when discoverable
model identifier
model file fingerprint/configured model key
context size
KV K type
KV V type
parallel/slot geometry
relevant recurrent/hybrid mode
LoRA configuration
speculative decoding configuration
plugin snapshot schema generation
```

For values the server cannot expose reliably, configuration should allow an explicit:

```yaml
runtimeKey: qwen38-27b-iq2xs-ctx128k-q4kv-v1
```

Changing `runtimeKey` makes old snapshots invisible.

This provides a simple manual escape hatch.

---

# 16. Filename generation

Raw session IDs or titles SHOULD NOT become filenames.

Use:

```text
sha256(
  backendInstanceKey +
  provider +
  model +
  sessionId
)
```

Example:

```text
7c/7c856dc594.........bin
```

Benefits:

- fixed filename length;
- no unsafe characters;
- no path traversal;
- no leaking chat titles;
- no collisions in normal operation.

---

# 17. Snapshot storage

Important distinction:

```text
metadata storage
≠
KV binary storage
```

The KV binary is created by `llama-server` itself inside:

```text
--slot-save-path
```

The DSH plugin may not even have filesystem access to that directory.

Therefore the architecture must support:

### Metadata

Stored locally by the plugin:

```text
$DSH_HOME/cache/dsh-kv-persist/
```

### Binary

Stored by llama-server:

```text
<LLAMA_SLOT_SAVE_PATH>/
```

The plugin communicates using only the generated filename.

This allows:

```text
DSH in container A
llama-server in container B
```

provided the server owns its snapshot directory.

---

# 18. Session state machine

Each session can be:

```text
NONE
    no known snapshot

COLD
    session exists but no state loaded

RESTORING
    snapshot restore in progress

ACTIVE_CLEAN
    current server slot corresponds to snapshot

ACTIVE_DIRTY
    model has advanced beyond saved snapshot

SAVING
    persistence operation in progress

SAVED
    latest runtime state has durable snapshot

INVALID
    snapshot exists but is incompatible/corrupted
```

Typical transitions:

```text
NONE
 ↓ first request
COLD
 ↓ normal prefill
ACTIVE_DIRTY
 ↓ checkpoint
SAVING
 ↓
SAVED
```

Resume:

```text
SAVED
 ↓ session request
RESTORING
 ↓
ACTIVE_CLEAN
 ↓ inference
ACTIVE_DIRTY
```

Session switch:

```text
A ACTIVE_DIRTY
 ↓
save A
 ↓
A SAVED
 ↓
restore B
 ↓
B ACTIVE_CLEAN
```

---

# 19. Slot state

The coordinator separately tracks the physical slot.

```ts
interface ManagedSlot {
  id: number

  ownerSessionId?: string

  snapshotRevision?: string

  state:
    | 'unknown'
    | 'idle'
    | 'restoring'
    | 'ready'
    | 'inference'
    | 'dirty'
    | 'saving'
    | 'broken'

  lastUsedAt?: number
}
```

For v0.1 there is simply:

```ts
slot[0]
```

---

# 20. Critical concurrency rule

No two operations may concurrently mutate the same llama slot.

The following must share one lock:

```text
restore
erase
inference
save
```

For MVP:

```ts
serverMutex.runExclusive(...)
```

is sufficient.

Conceptually:

```text
acquire slot lease
      ↓
prepare slot
      ↓
run inference
      ↓
update dirty state
      ↓
optional checkpoint
      ↓
release slot lease
```

This lock is absolutely critical.

Without it:

```text
session A restoring
        +
session B starting request
        =
undefined cache ownership
```

---

# 21. Request interception

The plugin listens to:

```text
llm/stream
```

For each request:

```ts
if (!isManagedProvider(options.provider)) {
  return next()
}

if (!options.sessionId) {
  return handleAuxiliaryRequest(...)
}

return coordinator.runSessionRequest({
  sessionId: options.sessionId,
  provider: options.provider,
  model: options.model,
  purpose: options.purpose,
  next,
})
```

`llm/stream` is an appropriate seam because it wraps every actual streaming model invocation, including adapter dispatch.

---

# 22. Auxiliary requests

DSH may make model calls for:

```text
session-title
compaction
other future purposes
```

They can pollute slot 0.

Therefore they must explicitly participate in coordination.

Default:

```yaml
auxiliaryRequests: isolate
```

In single-slot mode:

```text
main session dirty
   ↓
save current main session
   ↓
auxiliary request
   ↓
slot becomes unowned
   ↓
next main request restores its snapshot
```

Do NOT accidentally assign an auxiliary request to the currently active DSH session snapshot.

`GenerateOptions.purpose` exists specifically to identify current auxiliary call categories.

---

# 23. Restore algorithm

Pseudo-code:

```ts
async function prepareSession(sessionId, route) {
  const slot = slot0

  if (
    slot.ownerSessionId === sessionId &&
    slot.state !== 'broken'
  ) {
    return { kind: 'already-active' }
  }

  if (slot.ownerSessionId) {
    await checkpointIfNeeded(slot.ownerSessionId)
  }

  const snapshot = await repository.findCompatible(
    sessionId,
    route,
  )

  if (!snapshot) {
    await backend.eraseSlot(slot.id)

    slot.ownerSessionId = sessionId
    slot.state = 'idle'

    return { kind: 'cold' }
  }

  try {
    const result = await backend.restoreSlot(
      slot.id,
      snapshot.filename,
    )

    verifyRestore(result, snapshot)

    slot.ownerSessionId = sessionId
    slot.state = 'ready'

    return {
      kind: 'restored',
      tokens: result.tokens,
      bytes: result.bytes,
      durationMs: result.durationMs,
    }
  } catch (error) {
    markSnapshotInvalid(snapshot, error)

    await backend.eraseSlot(slot.id)

    slot.ownerSessionId = sessionId
    slot.state = 'idle'

    return {
      kind: 'cold-fallback',
      error,
    }
  }
}
```

The key policy:

> Restore failure is never fatal to ordinary inference unless strict mode is explicitly enabled.

---

# 24. Post-restore validation

An HTTP `200` from llama.cpp is not enough.

The plugin should validate:

```text
n_restored > 0
expected snapshot existed
slot endpoint remains healthy
reported token count is plausible
```

Optionally inspect:

```text
GET /slots
```

after restore.

For hybrid/recurrent models, introduce:

```yaml
restoreVerification: strict
```

which can require slot state to reflect restored token count before considering restore successful.

This is useful because persistent state support can vary by llama.cpp model architecture/build.

---

# 25. Inference algorithm

After preparing the slot:

```text
slot owner = session
        ↓
call downstream LLM adapter
        ↓
consume stream normally
        ↓
terminal successful finish
        ↓
mark slot dirty
```

Important:

The plugin MUST preserve streaming.

It must not buffer the full model response merely to implement persistence.

Conceptually:

```ts
const downstream = next()

return async function* () {
  let succeeded = false

  try {
    for await (const chunk of downstream) {
      if (
        chunk.type === 'finish' &&
        chunk.reason.kind !== 'error' &&
        chunk.reason.kind !== 'aborted'
      ) {
        succeeded = true
      }

      yield chunk
    }
  } finally {
    if (succeeded) {
      markDirty(sessionId)
    }
  }
}
```

Care must be taken with Cordis waterfall semantics: resolve `next()` at the correct point and don't accidentally call a consumed waterfall continuation lazily.

---

# 26. Checkpoint strategy

Saving a multi-gigabyte KV file after every generation can destroy the performance win.

Therefore checkpointing must be configurable.

Supported strategies:

```text
switch
turn
step
idle
shutdown
manual
```

### `switch`

Save only when the physical slot must be reassigned.

This should be the primary default.

Example:

```text
A → A → A → A
```

No disk writes.

Then:

```text
A → B
```

causes one save of A.

### `turn`

Persist after every completed user turn.

Higher durability, much more disk I/O.

### `step`

Persist after every successful agent model step.

Useful for crash-sensitive long autonomous jobs.

Potentially very expensive.

### `idle`

Save dirty state after N seconds without another request.

Recommended:

```yaml
idleCheckpointMs: 30000
```

### `shutdown`

Attempt a final checkpoint during normal Cordis disposal.

### Recommended default

```text
switch + idle + shutdown
```

This provides a good balance between speed and durability.

---

# 27. Checkpoint coalescing

Multiple save requests for the same revision should collapse.

Example:

```text
turn/end
idle timer
session/flush
plugin shutdown
```

may all happen near one another.

Use:

```ts
interface SaveGeneration {
  dirtyRevision: number
  persistedRevision: number
  inFlight?: Promise<SnapshotResult>
}
```

If:

```text
dirtyRevision === persistedRevision
```

do nothing.

If a save is already running for the current revision:

```text
await existing save
```

rather than starting another.

---

# 28. Dirty generations

Never use a single boolean if avoidable.

Use monotonic generations:

```text
dirtyRevision = 31
savedRevision = 30
```

Then:

```text
dirtyRevision > savedRevision
```

means dirty.

If inference completes while a save is in progress:

```text
save revision 30
new inference → revision 31
save finishes
savedRevision = 30
```

and state correctly remains dirty.

---

# 29. Session sequence tracking

Snapshot metadata SHOULD include the latest known DSH:

```text
session.seq
```

Example:

```json
{
  "sessionSeq": 482
}
```

This does NOT mean KV state is equivalent to every event through seq 482.

It is primarily:

- diagnostic metadata;
- freshness information;
- useful for invalidation;
- useful for future exact request fingerprinting.

---

# 30. Prompt/request fingerprints

Future versions SHOULD record a fingerprint of the request that produced the snapshot.

Conceptually:

```text
hash(
  provider
  model
  system prompt
  normalized messages
  tool schemas
  relevant template configuration
)
```

However this SHOULD NOT be mandatory in v0.1.

Why?

Because llama.cpp itself compares the restored prompt cache with the next incoming prompt and can reuse the common prefix while processing the changed suffix.

The plugin mainly needs to prevent gross incompatibility.

---

# 31. Snapshot invalidation

Snapshots must become invalid when any important runtime identity changes.

Examples:

```text
model changed
model GGUF replaced
KV layout changed
runtimeKey changed
llama backend changed
LoRA changed
server instance changed incompatibly
snapshot restore failed
manifest malformed
snapshot file missing
```

Invalidation must NOT delete data immediately.

Prefer:

```text
state = invalid
reason = MODEL_FINGERPRINT_CHANGED
```

Cleanup can happen separately.

---

# 32. Failure policy

Persistence is an optimization.

Default failure behavior:

```text
save failed
→ log warning
→ continue session

restore failed
→ mark snapshot invalid
→ erase slot
→ cold prefill
→ continue session

server /slots unavailable
→ disable persistence temporarily
→ continue ordinary inference
```

Only configuration:

```yaml
strict: true
```

should turn persistence failure into request failure.

Default:

```yaml
strict: false
```

---

# 33. Circuit breaker

If llama slot persistence is broken, we don't want every request to waste seconds retrying it.

Backend state:

```text
HEALTHY
DEGRADED
OPEN
HALF_OPEN
```

Suggested behavior:

```text
3 consecutive persistence failures
→ disable save/restore for 60s

after 60s
→ probe

probe successful
→ resume

probe fails
→ backoff
```

Inference itself remains active.

---

# 34. Backend health probe

At plugin initialization:

```text
GET /slots
```

Validate:

```text
server reachable
slots endpoint available
expected slot count
slot 0 exists for single-slot mode
```

Optionally test persistence capability using a non-destructive mechanism where possible.

The plugin SHOULD clearly distinguish:

```text
LLM endpoint alive
```

from:

```text
KV persistence supported
```

---

# 35. Configuration

Initial configuration proposal:

```yaml
kv-persist:
  enabled: true

  backend:
    type: llama.cpp
    baseURL: http://127.0.0.1:8080

  providers:
    - local-qwen

  mode: single-slot
  slotId: 0

  runtimeKey: qwen38-27b-iq2xs-ctx128k-q4kv

  checkpoint:
    onSwitch: true
    onShutdown: true
    onSessionFlush: true

    idleMs: 30000

    onTurnEnd: false
    onStepEnd: false

  restore:
    enabled: true
    verify: true

  failure:
    strict: false
    maxConsecutiveFailures: 3
    cooldownMs: 60000

  metadata:
    path: ${DSH_HOME}/cache/dsh-kv-persist

  logging:
    level: info
```

---

# 36. Config schema

Using Schemastery-style validation:

```ts
interface Config {
  enabled?: boolean

  backend: {
    type: 'llama.cpp'
    baseURL: string
    apiKey?: string
    requestTimeoutMs?: number
  }

  providers?: string[]

  mode?: 'single-slot' | 'managed-slots'

  slotId?: number

  runtimeKey?: string

  checkpoint?: {
    onSwitch?: boolean
    onShutdown?: boolean
    onSessionFlush?: boolean

    idleMs?: number

    onTurnEnd?: boolean
    onStepEnd?: boolean
  }

  restore?: {
    enabled?: boolean
    verify?: boolean
  }

  failure?: {
    strict?: boolean
    maxConsecutiveFailures?: number
    cooldownMs?: number
  }

  metadata?: {
    path?: string
  }
}
```

Recommended defaults:

```text
enabled = true

mode = single-slot
slotId = 0

onSwitch = true
onShutdown = true
onSessionFlush = true
idleMs = 30000

onTurnEnd = false
onStepEnd = false

restore.enabled = true
restore.verify = true

strict = false
```

---

# 37. Automatic provider filtering

The plugin MUST NOT touch cloud providers by default.

Example:

```yaml
providers:
  - local-qwen
  - local-coder
```

A request to:

```text
deepseek
openai
anthropic
```

passes straight through.

Future configuration may support:

```yaml
providers:
  local-qwen:
    backend: local-llama
```

for multiple servers.

---

# 38. Multiple llama servers

Architecture should support this eventually:

```yaml
servers:
  rtx3060:
    type: llama.cpp
    baseURL: http://127.0.0.1:8080
    runtimeKey: qwen38

  rtx4090:
    type: llama.cpp
    baseURL: http://192.168.1.42:8080
    runtimeKey: qwen-coder

routes:
  local-qwen:
    server: rtx3060

  local-coder:
    server: rtx4090
```

Internally:

```text
Coordinator
    ↓
ServerRuntime[]
    ↓
independent slot pools + locks
```

Do not use one global mutex across different servers.

---

# 39. Metadata repository

Suggested path:

```text
$DSH_HOME/cache/dsh-kv-persist/
```

Layout:

```text
dsh-kv-persist/
├─ instances/
│  └─ local-3060/
│     └─ sessions/
│        ├─ 7c856d....json
│        └─ d084fd....json
│
├─ index.json
└─ plugin-state.json
```

Binary KV files SHOULD NOT be copied here automatically.

---

# 40. Atomic metadata writes

Manifest updates should use:

```text
write temp
fsync/close
rename
```

rather than overwriting JSON directly.

Example:

```text
session.json.tmp
      ↓
rename
      ↓
session.json
```

A crash must not leave half-written metadata treated as valid.

---

# 41. Snapshot naming generations

Default strategy:

```text
one rolling snapshot per session
```

rather than:

```text
snapshot-000001.bin
snapshot-000002.bin
snapshot-000003.bin
...
```

because KV snapshots can be enormous.

Conceptually:

```text
<sessionHash>.bin
```

If llama.cpp cannot safely atomically replace an existing file in a particular build/backend, support two rotating names:

```text
<hash>.a.bin
<hash>.b.bin
```

Manifest points to the latest completed generation.

This prevents an interrupted write from destroying the previous valid checkpoint.

---

# 42. Local vs remote server cleanup

The llama slots API manages save/restore/erase of slot state, but binary file lifecycle may not always be remotely manageable.

Therefore define:

```text
snapshotBinaryManagement:
  server-owned
  shared-filesystem
```

### `server-owned`

Plugin only knows filenames.

No direct delete.

Use rolling filenames to limit growth.

### `shared-filesystem`

Plugin is configured with the same physical save directory and may:

- inspect file size;
- delete invalid snapshots;
- enforce disk quota;
- perform atomic rotation.

This mode MUST be opt-in.

---

# 43. Disk quota

Future version:

```yaml
retention:
  maxTotalBytes: 100GB
  maxSessions: 50
  maxAgeDays: 30
```

Eviction policy:

```text
invalid first
then oldest unused
then LRU
```

Never remove the active slot state as part of disk cleanup.

Only stored snapshots.

---

# 44. Security

The plugin MUST assume the llama management endpoint is privileged.

Recommended setup:

```text
127.0.0.1
or
trusted private network
or
authenticated reverse proxy
```

Do not expose slot management APIs publicly.

Snapshot filenames must be generated by the plugin and sanitized.

Never accept:

```text
../../foo
C:\whatever
/etc/passwd
```

as a raw snapshot filename.

Only backend-generated opaque keys may reach:

```text
action=save
action=restore
```

---

# 45. Logging

Recommended structured events:

```text
kv.backend.ready
kv.backend.unavailable

kv.slot.acquire
kv.slot.release

kv.session.cold
kv.session.restore.start
kv.session.restore.success
kv.session.restore.failed

kv.session.save.start
kv.session.save.success
kv.session.save.failed

kv.session.switch

kv.snapshot.invalidated

kv.persistence.circuit_open
kv.persistence.circuit_recovered
```

Example:

```text
[kv-persist] restored
session=7c856d
slot=0
tokens=48192
bytes=2.31GiB
duration=418ms
```

Avoid logging full session IDs at normal verbosity if unnecessary.

Use abbreviated hashes.

---

# 46. Metrics

Expose internal counters through the service and later optional Prometheus integration:

```text
dsh_kv_restore_total
dsh_kv_restore_hit_total
dsh_kv_restore_miss_total
dsh_kv_restore_failure_total

dsh_kv_save_total
dsh_kv_save_failure_total

dsh_kv_restore_bytes_total
dsh_kv_save_bytes_total

dsh_kv_restore_duration_ms
dsh_kv_save_duration_ms

dsh_kv_cold_prefill_total

dsh_kv_slot_switch_total

dsh_kv_snapshot_count
dsh_kv_snapshot_bytes
```

Especially useful derived metric:

```text
persistent-cache restore hit rate
```

---

# 47. Diagnostics API

`ctx.kvPersist.status()` should return something like:

```json
{
  "enabled": true,
  "backend": {
    "kind": "llama.cpp",
    "state": "healthy",
    "endpoint": "http://127.0.0.1:8080"
  },

  "mode": "single-slot",

  "slots": [
    {
      "id": 0,
      "owner": "7c856d",
      "state": "dirty"
    }
  ],

  "snapshots": {
    "known": 14,
    "valid": 13,
    "invalid": 1
  },

  "stats": {
    "restores": 23,
    "restoreHits": 21,
    "coldStarts": 2,
    "saves": 18
  }
}
```

---

# 48. Optional CLI

Eventually expose human-facing commands:

```text
dsh kv status
dsh kv list
dsh kv save <session>
dsh kv restore <session>
dsh kv invalidate <session>
dsh kv purge <session>
dsh kv gc
dsh kv doctor
```

`doctor` should be particularly useful.

Example:

```text
$ dsh kv doctor

Backend: llama.cpp
Endpoint: http://127.0.0.1:8080
Slots API: OK
Slots: 1
Configured mode: single-slot
Slot 0: idle
Save path capability: OK
Restore verification: OK
Hybrid model persistence: unverified
Metadata directory: writable
Result: READY
```

---

# 49. No model-facing tool by default

Do NOT register:

```text
save_kv_cache
restore_kv_cache
```

with `ctx.tools`.

There is almost no reason for the LLM itself to manage its infrastructure cache.

It wastes tool schema tokens and introduces failure modes such as:

```text
model decides to purge its own cache
```

Management belongs to:

```text
plugin
user CLI
UI
```

not to the model.

---

# 50. Session lifecycle integration

Subscribe to session lifecycle for:

```text
session created
session flush
session disposed
turn end
```

Use these events as persistence hints.

DSH explicitly exposes session persistence hooks and `session/flush` as the durability checkpoint seam.

Recommended semantics:

### session created/resumed

Do not restore immediately.

Lazy restore on first actual LLM request.

Reason:

```text
opening a chat in UI
```

should not evict another active KV session unless inference actually occurs.

### session flush

If the session currently owns a dirty slot:

```text
checkpoint
```

### session disposed

If dirty:

```text
checkpoint if configured
```

then remove runtime ownership.

### turn/end

Checkpoint only when:

```yaml
checkpoint.onTurnEnd: true
```

---

# 51. Lazy restore

This is important enough to be explicit.

Bad:

```text
user clicks session B
→ immediately save A
→ restore 3GB B
→ user clicks session C
→ immediately save B
→ restore C
```

Good:

```text
user clicks session B
→ nothing

user actually sends message in B
→ switch slot
```

Snapshot management follows inference, not UI navigation.

---

# 52. Save-before-evict invariant

Before assigning a dirty slot to another owner:

```text
MUST attempt save
```

unless configured:

```yaml
checkpoint.onSwitch: false
```

Default invariant:

```text
dirty A
+
need B
=
save A before erase/restore B
```

This is the core of session switching.

---

# 53. Cold-session behavior

If no snapshot exists:

```text
erase slot
assign owner
let llama.cpp process full request
mark dirty
```

Do not try to build a snapshot before inference.

Snapshot will naturally be created by the next checkpoint.

---

# 54. Snapshot restore and prompt divergence

A restored KV snapshot is not assumed to perfectly equal the next DSH request.

Example:

Snapshot:

```text
system
A
assistant A
B
assistant B
```

Current request:

```text
system
A
assistant A
B
assistant B
C
```

Ideal outcome:

```text
reuse existing prefix
process only C
```

If the system prompt/tool schema changed:

```text
old prefix
    ↓
divergence detected by llama.cpp
    ↓
recompute changed suffix
```

Thus plugin-side fingerprints are mainly for runtime compatibility and diagnostics rather than replacing llama.cpp's prompt matching.

---

# 55. Context compaction

Compaction changes model-visible history substantially.

The plugin does not need special correctness logic.

After compaction:

```text
restored old snapshot
        ↓
incoming compacted prompt differs
        ↓
llama.cpp finds smaller common prefix
        ↓
new prompt is processed
        ↓
slot becomes dirty
        ↓
next checkpoint replaces snapshot
```

However the plugin should emit diagnostics:

```text
large restored cache
low subsequent cache reuse
possible compaction/prompt mutation
```

Future versions can proactively invalidate on known compaction events.

---

# 56. Provider/model changes inside a session

DSH allows the request route to change between steps.

Therefore one DSH session can theoretically contain:

```text
model A
→ model B
→ model A
```

KV identity must therefore include:

```text
provider + model
```

not only session.

Conceptually:

```text
session X
├─ qwen snapshot
└─ coder snapshot
```

MVP may simplify by allowing one current snapshot per:

```text
(session, provider, model)
```

---

# 57. LoRA and runtime mutations

If llama-server changes:

```text
LoRA
model
chat template
KV representation
other state that affects serialized cache
```

the runtime fingerprint must change or snapshots must be invalidated.

Never silently restore across obviously different model states.

---

# 58. Plugin lifecycle

Cordis plugins may be unloaded through configuration changes, HMR, explicit disposal, or loss of dependencies; resources external to Cordis should be tied to `ctx.effect()` and cleaned on unload.

The plugin should therefore register:

```text
timers
HTTP resources
backend lifecycle
shutdown save
```

through proper Cordis effects.

On dispose:

```text
stop accepting new persistence work
        ↓
cancel idle timers
        ↓
wait for/abort safe pending operations
        ↓
checkpoint active dirty slot if configured
        ↓
dispose service
```

---

# 59. Cancellation

User cancellation of generation MUST NOT be blocked by a slow snapshot write.

Inference `AbortSignal` belongs to inference.

Persistence operations should use their own bounded timeout.

For example:

```yaml
backend:
  requestTimeoutMs: 15000
```

If save exceeds timeout:

```text
log
mark persistence degraded
release workflow
```

Don't leave the agent permanently stuck because an NVMe/cache filesystem is unhappy.

---

# 60. Crash semantics

There are three relevant crashes:

### DSH crashes

llama-server remains alive.

Active slot may still contain valid state.

v0.1 may ignore this unsaved in-memory opportunity and restore the last durable snapshot.

Future optimization:

```text
inspect current slot metadata
re-associate if ownership can be proven
```

### llama-server crashes

Only durable snapshots survive.

After restart:

```text
probe
restore snapshot
```

### Machine crashes during snapshot save

Manifest must continue referencing the previous known-good generation.

This is why two-file rotation may eventually be useful.

---

# 61. Hybrid/recurrent model compatibility

Qwen3.x hybrid/recurrent architectures make this especially important.

Define compatibility states:

```text
supported
experimental
broken
unknown
```

Example metadata:

```json
{
  "persistenceCompatibility": "experimental"
}
```

`dsh kv doctor` can perform an opt-in verification:

```text
1. cold prompt
2. save
3. erase
4. restore
5. inspect
6. identical prompt
7. confirm cache reuse
```

An even stronger test:

```text
save
restart server manually
restore
same prompt
verify hit
```

The plugin should never assume that receiving `n_restored` means a particular model/build definitely restored usable recurrent state.

---

# 62. Compatibility database

Future versions may contain small rules:

```ts
interface CompatibilityRule {
  backend: 'llama.cpp'
  architecture?: string
  minBuild?: number
  maxBuild?: number
  status: 'supported' | 'experimental' | 'broken'
  note?: string
}
```

But avoid hardcoding large brittle version tables initially.

Prefer runtime verification.

---

# 63. Multi-slot architecture

After MVP, support:

```text
--parallel N
```

with a real slot pool.

Example N=4:

```text
slot 0 → session A
slot 1 → session B
slot 2 → session C
slot 3 → session D
```

Session E arrives:

```text
choose LRU clean/dirty slot
        ↓
save old owner if dirty
        ↓
restore E
        ↓
bind slot to E
```

---

# 64. Multi-slot slot selection

Selection order:

```text
1. slot already owned by requested session
2. empty slot
3. clean least-recently-used slot
4. dirty least-recently-used slot
```

Evicting a dirty slot requires save.

Pseudo-code:

```ts
function selectSlot(sessionId) {
  return (
    ownedBy(sessionId) ??
    emptySlot() ??
    lruClean() ??
    lruDirty()
  )
}
```

---

# 65. Multi-slot transport

For managed multi-slot support, introduce:

```text
dsh-llama.cpp adapter
```

or a transport backend capable of injecting:

```json
{
  "id_slot": 2,
  "cache_prompt": true
}
```

into llama-server requests.

Potential package architecture:

```text
dsh-kv-persist
└─ coordination/service

dsh-llm-llama-cpp
└─ llama-specific transport
```

The two can communicate through:

```text
ctx.kvPersist
```

This is preferable to making the persistence plugin own all OpenAI serialization logic.

---

# 66. Alternative multi-slot sidecar

Another possible backend:

```text
DSH
 ↓
normal OpenAI adapter
 ↓
local KV-aware reverse proxy
 ↓
llama-server
```

Proxy receives a hidden session identifier and injects:

```text
id_slot
```

This is useful if DSH's adapter layer remains intentionally provider-neutral.

However a native adapter is probably cleaner.

---

# 67. Future upstream opportunity

Potential DSH upstream proposal:

```ts
GenerateOptions.transportMetadata?
```

or an adapter-private request context carrying:

```text
sessionId
```

all the way into adapters.

DSH already provides `sessionId` as model-hidden routing metadata, so a llama-specific adapter can naturally use that for slot assignment without exposing it to the model.

Avoid adding llama-specific fields to core DSH vocabulary.

---

# 68. MVP scope — v0.1

The first usable release should contain only:

```text
llama.cpp backend
single server
single slot
explicit managed provider list
sessionId → snapshot mapping
save on switch
idle save
save on shutdown/flush
lazy restore
restore fallback
metadata manifests
global slot mutex
logging
status API
basic doctor/probe
```

Explicitly NOT in v0.1:

```text
multi-slot
UI
disk GC
multiple servers
snapshot migration
Prometheus
custom adapter
automatic server startup
```

Keep v0.1 small enough to actually ship.

---

# 69. v0.1 request flow

Example: first ever session A request.

```text
DSH llm/stream(A)
        ↓
plugin sees managed provider
        ↓
acquire slot 0
        ↓
no current owner
        ↓
no snapshot A
        ↓
erase slot
        ↓
owner = A
        ↓
next()
        ↓
llama processes prompt
        ↓
stream response
        ↓
mark A dirty
        ↓
release
```

Second request A:

```text
llm/stream(A)
        ↓
slot already belongs to A
        ↓
no save/restore
        ↓
next()
        ↓
normal in-memory cache hit
```

This is very important:

> The plugin must not save/restore when the requested session is already resident.

Persistence must not make the happy path slower.

---

# 70. v0.1 session switch

A → B:

```text
request B
   ↓
acquire slot
   ↓
slot owner = A, A dirty
   ↓
save A.bin
   ↓
mark A saved
   ↓
find B snapshot
   ↓
restore B.bin
   ↓
owner = B
   ↓
request B
```

B → A:

```text
save B if dirty
restore A
run A
```

---

# 71. v0.1 idle save

After request A finishes:

```text
A dirty
   ↓
start/reset 30s timer
```

If another A request comes within 30 seconds:

```text
cancel/reset timer
```

If idle timer fires:

```text
acquire slot
   ↓
confirm slot still owned by A
   ↓
confirm same dirty generation
   ↓
save
   ↓
release
```

Never save based purely on an old timer callback without rechecking ownership.

---

# 72. v0.1 auxiliary request flow

Suppose A is active and DSH starts session-title generation.

```text
A dirty
   ↓
aux request detected
   ↓
save A
   ↓
slot owner cleared
   ↓
run title request
   ↓
slot owner = auxiliary/unowned
```

Next A request:

```text
restore A
```

This is slower than having a separate aux slot but correct.

v0.2 multi-slot can reserve:

```text
slot N-1 = auxiliary
```

---

# 73. Performance targets

MVP should add almost zero overhead when a session remains resident.

Resident request overhead target:

```text
< 1 ms plugin CPU overhead
0 disk I/O
0 extra llama management calls
```

Session restore cost is dominated by backend I/O.

The plugin should record:

```text
save latency
restore latency
bytes
tokens
```

so the user can compare:

```text
cold prefill time
vs
restore time
```

---

# 74. Acceptance criteria for v0.1

Release `0.1.0` is acceptable when all of the following work:

1. Start llama-server with slot save path.
2. Start DSH with plugin.
3. Open session A.
4. Send large prompt.
5. Slot becomes owned by A.
6. Send another A turn.
7. No disk save/restore occurs.
8. Switch to session B.
9. A is saved automatically.
10. B runs.
11. Switch back to A.
12. A snapshot is restored.
13. Next request demonstrates substantial prompt-cache reuse.
14. Restart DSH.
15. Open A and send another message.
16. Plugin restores A snapshot.
17. Conversation remains correct if snapshot file is manually deleted.
18. Conversation remains correct if restore returns an error.
19. Unmanaged providers are completely unaffected.
20. Plugin hot unload cleans timers/resources.

---

# 75. Integration tests

Minimum integration test suite:

### Cold start

```text
snapshot absent
→ request succeeds
→ state dirty
```

### Resident reuse

```text
A request
A request
→ no save
→ no restore
```

### Switch

```text
A
B
→ save A
```

### Restore

```text
A
B
A
→ restore A
```

### Corrupt snapshot

```text
restore fails
→ snapshot invalidated
→ cold request succeeds
```

### Backend unavailable

```text
/slots unreachable
→ ordinary LLM request still works
```

### Save failure

```text
save A fails
→ B still eventually runs in non-strict mode
```

### Auxiliary request

```text
A
session-title
A
→ no incorrect slot ownership
```

### Cancellation

```text
cancel model request
→ lock released
→ next session still works
```

### HMR/disposal

```text
reload plugin
→ no orphan timer
→ no dead mutex
```

---

# 76. Unit tests

Unit test:

```text
state-machine transitions
slot selection
snapshot compatibility
filename sanitization
fingerprint stability
dirty revision logic
save coalescing
idle timer invalidation
failure circuit breaker
manifest atomicity
provider filtering
```

No network should be necessary for these.

---

# 77. Fake backend

Create:

```ts
class FakeKvBackend
```

with deterministic state.

Example capabilities:

```ts
backend.failNextSave()
backend.failNextRestore()
backend.delayRestore(100)
backend.removeSnapshot(key)
backend.corruptSnapshot(key)
```

Most coordinator tests should run against this rather than launching llama-server.

---

# 78. Real llama integration test

Optional test profile:

```text
DSH_KV_TEST_LLAMA_URL=http://127.0.0.1:8080
```

Tests only run when explicitly enabled.

Never require a GPU in the ordinary CI pipeline.

---

# 79. Error taxonomy

Use stable codes.

Suggested:

```text
KV_BACKEND_UNAVAILABLE
KV_BACKEND_UNSUPPORTED

KV_SLOT_NOT_FOUND
KV_SLOT_BUSY
KV_SLOT_STATE_INVALID

KV_SNAPSHOT_NOT_FOUND
KV_SNAPSHOT_INCOMPATIBLE
KV_SNAPSHOT_CORRUPT

KV_SAVE_FAILED
KV_RESTORE_FAILED
KV_ERASE_FAILED

KV_MANIFEST_INVALID
KV_METADATA_IO

KV_OPERATION_TIMEOUT

KV_INVARIANT
```

Infrastructure diagnostics become much easier than matching error strings.

---

# 80. Example logs

First request:

```text
[kv-persist] session cold
session=7c856d slot=0
```

Idle checkpoint:

```text
[kv-persist] snapshot saved
session=7c856d
tokens=48712
bytes=2.42GiB
save=531ms
```

Resume:

```text
[kv-persist] snapshot restored
session=7c856d
tokens=48712
bytes=2.42GiB
restore=188ms
```

Failure:

```text
[kv-persist] restore failed; falling back to cold prefill
session=7c856d
code=KV_RESTORE_FAILED
```

---

# 81. User-visible UX

Most of the time:

```text
nothing
```

It should simply make old local-model sessions resume quickly.

Potential status line later:

```text
KV: restored 48.7K · 188ms
```

or:

```text
KV: resident
```

or:

```text
KV: cold
```

But this belongs to a later UI integration and should not block the core plugin.

---

# 82. Suggested README pitch

> `dsh-kv-persist` keeps local LLM sessions warm across session switches and restarts.
>
> It maps DeepSeek Harness sessions to persistent inference-cache snapshots and restores them when a session becomes active again. The initial backend uses llama.cpp's slot save/restore API, allowing large agent contexts to resume without repeating a full prompt prefill.
>
> KV state is treated strictly as an optimization: DSH's session log remains the source of truth, and any missing, stale, or incompatible cache automatically falls back to normal inference.

---

# 83. Roadmap

## Phase 0 — research/prototype

- Validate llama.cpp save/restore with target Qwen3.8 build.
- Verify restore within same server process.
- Verify restore across llama-server restart.
- Measure snapshot sizes.
- Measure save/restore throughput.
- Confirm cache hit after restore.
- Document hybrid-model behavior.

## Phase 1 — MVP / `0.1`

- Cordis service.
- llama.cpp client.
- backend probe.
- single-slot coordinator.
- session mapping.
- `llm/stream` wrapper.
- lazy restore.
- save-before-switch.
- idle checkpoint.
- shutdown/session-flush checkpoint.
- local metadata.
- logging.
- cold fallback.
- fake backend tests.

## Phase 2 — reliability / `0.2`

- compatibility fingerprints.
- circuit breaker.
- snapshot verification.
- atomic snapshot rotation.
- diagnostics API.
- `doctor`.
- cleanup tooling.
- improved hybrid/recurrent testing.

## Phase 3 — multi-slot / `0.3`

- slot pool.
- LRU assignment.
- explicit slot leases.
- llama-specific transport integration.
- request `id_slot`.
- auxiliary slot reservation.
- concurrent sessions.

## Phase 4 — observability / `0.4`

- metrics.
- cache hit statistics.
- storage statistics.
- performance comparisons.
- optional DSH UI panel.

## Phase 5 — generalized persistence / `1.0`

- stable backend interface.
- multiple servers.
- multiple backends.
- retention policies.
- documented API for external plugins.
- production-hardening.

---

# 84. First implementation milestone

The first prototype should intentionally do almost nothing clever.

Hardcode/test:

```text
provider = local-qwen
slot = 0
server = localhost:8080
```

Implement only:

```text
request A
request A
request B
request A
```

Expected management calls:

```text
A #1:
erase

A #2:
none

B:
save A
erase/restore B

A #3:
save B
restore A
```

Once this works reliably, abstract it.

Do not start by implementing:

```text
multi-server
multi-slot
GC
UI
dynamic provider discovery
```

before proving the fundamental cache lifecycle.

---

# 85. Key architectural invariants

These should eventually exist as comments/tests.

**Invariant 1**

```text
DSH session state never depends on KV persistence.
```

**Invariant 2**

```text
At most one owner controls a physical slot at a time.
```

**Invariant 3**

```text
A dirty slot is checkpointed before reassignment unless policy explicitly disables it.
```

**Invariant 4**

```text
A snapshot is restored only when its runtime identity is compatible.
```

**Invariant 5**

```text
Persistence failure defaults to cold inference.
```

**Invariant 6**

```text
Resident-session requests incur no disk I/O.
```

**Invariant 7**

```text
Auxiliary LLM requests never become authoritative state for a conversation session.
```

**Invariant 8**

```text
All backend mutation operations are serialized per physical slot.
```

**Invariant 9**

```text
Snapshot filenames are plugin-generated opaque identifiers.
```

**Invariant 10**

```text
A successful HTTP restore is not automatically equivalent to a verified usable restore.
```

---

# 86. Recommended initial technical direction

For the first release, use:

```text
Cordis plugin
    +
ctx.sessions lifecycle
    +
llm/stream observation
    +
single llama slot
    +
server-side snapshot files
```

Do NOT fork or patch DeepSeek Harness.

Do NOT replace the existing OpenAI-compatible provider.

Do NOT modify prompts.

Do NOT make cache state part of SessionEvent history.

Once the single-slot implementation proves useful, introduce the llama-specific transport adapter needed for explicit `id_slot` and proper multi-session concurrency.

This yields a plugin that starts as a small, useful local optimization but has a clean path toward becoming a general persistence/cache coordinator for local inference runtimes.