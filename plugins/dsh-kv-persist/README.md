# @yadsh/dsh-kv-persist

`dsh-kv-persist` keeps local LLM sessions warm across session switches and restarts.

It maps DeepSeek Harness sessions to persistent inference-cache snapshots and
restores them when a session becomes active again. The initial backend uses
llama.cpp's slot save/restore API, allowing large agent contexts to resume
without repeating a full prompt prefill.

KV state is treated strictly as an optimization: DSH's session log remains the
source of truth, and any missing, stale, or incompatible cache automatically
falls back to normal inference. The model never knows this plugin exists.

## Features

- Maps DSH sessions (`sessionId` + provider + model) to llama.cpp slot
  snapshots via `GET /slots` and `POST /slots/{id}?action=save|restore|erase`.
- Lazy restore: nothing is loaded until the session's first managed request;
  resident sessions run with zero disk I/O and zero management calls.
- Save-before-switch, idle checkpoints, and shutdown/flush checkpoints, with
  dirty generations and save coalescing instead of a naive boolean.
- Runtime compatibility gate: snapshots restored only when the server
  instance, provider, model, and `runtimeKey` generation match; the rest are
  marked invalid and skipped, never deleted.
- Cold fallback everywhere: persistence failures degrade to ordinary
  inference; optional strict mode is the only failure path.
- Circuit breaker stops a broken backend from costing latency on every
  request.
- Auxiliary requests (session titles, compaction) are coordinated so they
  never pollute or hijack a session's slot ownership.
- Structured `kv.*` logging, in-memory metrics, `status()` and `doctor()`
  diagnostics on the service.

## Requirements

- DeepSeek Harness >= 0.1.1-rc.2 < 0.2.0
- A llama.cpp `llama-server` started with `--slots --slot-save-path <dir>`
  and `--parallel 1` for the single-slot mode (see the [design doc](./docs/dsh-kv-persist.md) §6).
  The server flag does not replace the plugin's local lease, which also
  serializes save, restore, erase, and terminal stream bookkeeping.
- Node.js >= 22

## Installation

```bash
dsh plugin add @yadsh/dsh-kv-persist
```

From sources:

```bash
pnpm nx run @yadsh/dsh-kv-persist:build
```

## Configuration

Configure the plugin under the `kv-persist` key in the DSH profile. Only
providers listed under `providers` are ever coordinated.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; `false` passes everything through. |
| `backend.baseURL` | string | `http://127.0.0.1:8080` | llama-server management endpoint. |
| `backend.apiKey` | string | `""` | Bearer key for the management API; never logged. |
| `backend.requestTimeoutMs` | number | `15000` | Bounded timeout per persistence call. |
| `providers` | string[] | `[]` | Managed provider routes; empty = plugin inert. |
| `mode` | `"single-slot"` | `"single-slot"` | v0.1 supports single-slot only. |
| `slotId` | number | `0` | Physical slot used in single-slot mode. |
| `runtimeKey` | string | `""` | Runtime identity escape hatch; changing it hides old snapshots (they are kept, not deleted). |
| `checkpoint.onSwitch` | boolean | `true` | Save a dirty slot before reassignment. |
| `checkpoint.onShutdown` | boolean | `true` | Final checkpoint on plugin disposal. |
| `checkpoint.onSessionFlush` | boolean | `true` | Checkpoint on the session flush event. |
| `checkpoint.idleMs` | number | `30000` | Idle checkpoint delay; `0` disables. |
| `checkpoint.onTurnEnd` | boolean | `false` | Checkpoint after every user turn. |
| `checkpoint.onStepEnd` | boolean | `false` | Reserved for per-step checkpoints. |
| `restore.enabled` | boolean | `true` | Restore compatible snapshots lazily. |
| `restore.verify` | boolean | `true` | Reject restores reporting `n_restored <= 0`. |
| `failure.strict` | boolean | `false` | Turn restore failures into request failures. |
| `failure.maxConsecutiveFailures` | number | `3` | Failures before the circuit opens. |
| `failure.cooldownMs` | number | `60000` | Circuit open duration. |
| `metadata.path` | string | `<DSH home>/cache/dsh-kv-persist` | Manifest storage directory. DSH home is non-blank `$DSH_HOME`, otherwise `~/.dsh`. |
| `logging.level` | `"debug" \| "info" \| "off"` | `"info"` | Structured `kv.*` event verbosity. |

Full configuration rationale: [design doc §35](./docs/dsh-kv-persist.md).

## Compatibility

- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0` (see `compatibility.json`)
- Node.js >= 22
- llama.cpp server with the slots management API enabled

## Development

```bash
pnpm nx run @yadsh/dsh-kv-persist:lint
pnpm nx run @yadsh/dsh-kv-persist:typecheck
pnpm nx run @yadsh/dsh-kv-persist:test
pnpm nx run @yadsh/dsh-kv-persist:build
pnpm nx run @yadsh/dsh-kv-persist:verify
```

Optional end-to-end check against a live server (no GPU in CI):

```bash
DSH_KV_TEST_LLAMA_URL=http://127.0.0.1:8080 pnpm --filter @yadsh/dsh-kv-persist test:llama
```

See [SPEC.md](./SPEC.md) for the product contract and implementation status.

## License

MIT
