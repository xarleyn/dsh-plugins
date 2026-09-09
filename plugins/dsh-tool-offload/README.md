# @yadsh/dsh-tool-offload

DeepSeek Harness plugin that offloads large, low-judgement tool results to small
one-shot worker agents before they enter the main model context — cutting
frontier-model tokens and cost on I/O-heavy workflows without touching how your
agent picks tools.

## Features

- **Result processing, not tool replacement.** The original tool executes
  normally under the parent agent's permissions; the plugin only rewrites the
  model-facing `content` of successful results in `tools/post-execute`. The
  canonical `value` stays untouched for programmatic consumers.
- **Deterministic routing.** Allowlist/denylist tool patterns, byte and
  estimated-token thresholds, and ordered selection rules pick the worker and
  prompt profile — no extra LLM in the routing path.
- **Cheap no-tools workers.** Workers start through `ctx.subagents.start` on a
  `spawn`-style provider with `toolFilter: { allow: [] }` — zero inherited
  model-facing tools, zero authority expansion — and an exact cheap model via
  `agentOptions`.
- **Bounded parent context.** The worker receives the latest user task
  (byte-capped), the tool name, and the serialized arguments behind explicit
  `<PARENT_TASK>` / `<TOOL_CALL>` / `<TOOL_RESULT>` data boundaries, with a
  prompt that treats tool output as untrusted data.
- **Fail-open everywhere.** Worker failure, timeout, cancellation, refusal,
  empty answer, or an answer that is not actually smaller — every failure mode
  falls back to the original result (`fallback.mode: original` by default;
  `truncate` and `error` modes available).
- **Recursion-proof.** Workers carry no tools and delegated child sessions are
  never offloaded, so an offload worker cannot spawn another offload worker.
- **Bounded fan-out.** Non-blocking per-agent and global worker budgets; an
  exhausted budget routes results through instead of queueing.
- **Observability.** Structured events (`offload.started` / `offload.completed`
  / `offload.skipped` / `offload.worker_failed`) with byte counts, reduction
  ratio, and skip reasons — never raw tool content — plus in-memory counters
  exposed through `ctx.toolOffload.stats()`.

## Install

```bash
dsh plugin add @yadsh/dsh-tool-offload
```

Requires a DSH release in the `>=0.1.1-rc.2 <0.2.0` range with a subagent
provider that supports tool restrictions (the in-process `spawn` provider).

## Configuration

All keys are optional; defaults in parentheses.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; `false` passes every result through untouched. |
| `routing.mode` | `allowlist` \| `denylist` | `allowlist` | `allowlist` offloads only `routing.allow` tools; `denylist` offloads everything except `routing.deny`. |
| `routing.allow` | string[] | `read, grep, search, web_fetch` | Tool names matched exactly or by `prefix*` glob. |
| `routing.deny` | string[] | `bash` | Tools never offloaded; wins over `allow`. |
| `routing.thresholds.minBytes` | number | `24000` | Byte threshold; a result qualifies when either threshold is exceeded. |
| `routing.thresholds.minEstimatedTokens` | number | `6000` | Cheap `characters / 4` token estimate threshold. |
| `routing.rules` | Rule[] | `[]` | Ordered rules; first match picks the worker/prompt profile or forces passthrough. Each rule: `id`, `match.tools`, `match.minBytes`, `action` (`offload`/`passthrough`), `worker`, `prompt`. |
| `workers` | Record | — | Named worker profiles merged over the `default` profile. |
| `workers.<name>.subagentProvider` | string | `spawn` | DSH subagent provider; must support tool restrictions. |
| `workers.<name>.provider` / `.model` | string \| null | `null` | Model route for the worker; `null` inherits the parent agent's route. Configure a cheap model here. |
| `workers.<name>.maxTokens` | number \| null | `4000` | Worker output token cap. |
| `workers.<name>.timeoutMs` | number | `45000` | Bounded worker timeout; on timeout the original result is restored. |
| `defaultWorker` | string | `default` | Worker profile used when no rule selects one. |
| `context.includeLastUserMessage` | boolean | `true` | Pass the latest user task message to the worker. |
| `context.maxParentContextBytes` | number | `12000` | Byte cap for the extracted parent task. |
| `payload.maxBytes` | number | `300000` | Results larger than this pass through (chunking is planned). |
| `validation.maxOutputBytes` | number | `20000` | Worker answers above this size are rejected. |
| `validation.requireReduction` | boolean | `true` | Reject answers that did not actually shrink the result. |
| `validation.minReductionRatio` | number | `0.15` | Required relative shrink (0.15 = at least 15 % smaller). |
| `fallback.mode` | `original` \| `truncate` \| `error` | `original` | What replaces the result when an offload fails. |
| `annotation.enabled` | boolean | `false` | Prefix transformed content with `[offloaded result]`. |
| `concurrency.maxWorkersPerAgent` | number | `3` | Per-agent worker budget (non-blocking). |
| `concurrency.maxWorkersGlobal` | number | `8` | Global worker budget (non-blocking). |
| `prompts` | Record | — | Custom "Your job" prompt sections; `generic`, `code-reader`, `search-results`, `web-reader`, and `logs` are bundled. |
| `telemetry.enabled` | boolean | `true` | Structured event logging; counters stay on either way. |

Built-in routing rules map the default tool candidates to bundled prompt
profiles: `web_fetch` → `web-reader`, `grep`/`search` → `search-results`,
`read` → `code-reader`; everything else uses `generic`.

Example `cordis.patch.yml` profile override:

```yaml
- override:
    - id: dsh-tool-offload
      config:
        workers:
          default:
            provider: zai
            model: glm-4.5-air
            maxTokens: 4000
        routing:
          allow:
            - read
            - grep
            - web_fetch
```

## Compatibility

- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0` (tested on `0.1.1-rc.2`); requires the
  `tools/post-execute` seam and the `subagents/start` service with a
  tool-restriction-capable provider — see `compatibility.json`.
- Node.js `^22.19.0 || >=24.0.0`.
- Only top-level ordinary tool results are offloaded; Code Mode (`run_code`)
  nested dispatches pass through untouched.

## Development

```bash
pnpm nx run dsh-tool-offload:lint typecheck test build
pnpm nx run dsh-tool-offload:verify   # package gate
```

The full design document (routing policy, safety model, phased plan) lives in
`dsh-tool-offload-SPEC.md`; the behavioral contract is `SPEC.md`.

## Credits

Inspired by Spotify's
[`portal-ai-plugins/shunt`](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt),
which routes I/O-heavy work to cheaper worker models. This project is a
DeepSeek Harness-native implementation and does not require Spotify Portal or
AiKA. See `NOTICE.md`.

## License

MIT
