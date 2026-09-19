# @yadsh/dsh-jev-compaction

**Jev-powered, replay-safe semantic context pruning for DeepSeek Harness. Keeps conversation text verbatim and selectively forgets stale tool output before ordinary summary compaction is needed.**

> Forget stale tool output, not the conversation.

## How it works

The plugin adds an asynchronous semantic pruning layer on the `agent/pre-step`
waterfall:

1. The session approaches configurable context pressure.
2. The plugin inspects the current model-visible surface; user, system and
   assistant text, recent results, error results and structurally ambiguous
   nodes are pinned and never touched.
3. Older `tool/result` nodes become candidates and get deterministic stale
   signals (superseded reads, duplicate searches, rerunnability, exact
   evidence).
4. A bounded representation of the conversation is sent to the Jev decision
   model (TypeSafe AI System One), which scores for every candidate whether
   its contents are still needed and whether they must remain verbatim.
5. A deterministic local policy converts the scores into actions: keep full,
   keep a truncated head/tail, or replace with a short neutral stub.
6. Selected nodes are replaced through DSH single-node `surfaceOp: replace`
   events. The original full-fidelity events remain in the append-only
   session log; DSH remeasures context natively.
7. If pruning was not enough, the built-in summary compaction
   (`dsh-compaction-basic`) still runs after it, unchanged.

Fail-open by design: every failure (missing API key, timeout, malformed
response, surface drift, cancellation) skips pruning and leaves ordinary DSH
behavior untouched.

## Decision backends

The scoring backend is pluggable (SPEC §18). All providers speak the same
System One scoring contract; switching is configuration, not code.

| `decision.provider` | Endpoint | Key variable | Notes |
|---|---|---|---|
| `typesafe` (default) | `https://api.typesafe.ai/v1/systemone` | `TYPESAFE_API_KEY` | hosted Jev; reference quality |
| `jeff` | `http://localhost:8000` | `JEFF_API_KEY` | self-hosted [jeff](https://github.com/logan-markewich/jeff) server (GLiFormer ~400M); near drop-in, free local evals, weaker on reasoning-heavy scoring |
| `custom` | required | optional | any System One-compatible endpoint (e.g. open-jev); set `decision.custom.baseUrl`; an empty `apiKeyEnv` disables the Authorization header |

```yaml
jev-compaction:
  decision:
    provider: jeff # typesafe | jeff | custom
    jeff:
      baseUrl: http://jeff:8000
      apiKeyEnv: JEFF_API_KEY
    timeoutMs: 2500
    maxConcurrency: 4
    retries: 1
```

Jeff (or any compatible backend) runs as its own service next to Harness —
the plugin reaches it over HTTP and no backend dependency enters the DSH
process. Local backends are the recommended way to run thousands of
`/jev-compact --dry-run` evaluations while tuning thresholds; replay the same
corpus against hosted Jev to compare dangerous-prune rates before shipping
defaults.

## Privacy notice

Using this plugin sends a derived representation of session history — the
bounded Jev state (user/assistant text snippets, tool names, argument
previews, result sizes and deterministic features) plus the scoring
questions — to the configured decision endpoint
(`https://api.typesafe.ai/v1/systemone` by default; a self-hosted endpoint
keeps the data on your network). Full tool outputs are never sent. The
`privacy` configuration section controls which text categories are included
and their per-message character budget. Secret detection is not performed; do
not enable text categories you would not share with the endpoint operator.

The API key is read from the environment variable named by the provider's
`apiKeyEnv` (default `TYPESAFE_API_KEY`) and is never logged or included in
reports.

## Installation

```bash
dsh plugin --profile <profile> add @yadsh/dsh-jev-compaction
```

## Commands

- `/jev-compact --dry-run` — run the full pipeline read-only and report the
  plan (candidates, actions, estimated savings, highest-confidence stubs).
- `/jev-compact` — run the pipeline and queue the mutation for the next
  model step. Tool-result replacements are only legal inside an open turn,
  and command handlers run between turns, so the queued plan is recomputed
  and applied right before the next step; a stale plan is dropped.

## Configuration (defaults)

```yaml
jev-compaction:
  enabled: true
  jev:
    model: jev-latest
    apiKeyEnv: TYPESAFE_API_KEY
    baseUrl: https://api.typesafe.ai/v1/systemone
    timeoutMs: 2500
    maxConcurrency: 4
    retries: 0
  trigger:
    contextRatio: 0.70      # below dsh-compaction-basic's 0.8 default
    minSurfaceTokens: 32000
    minCandidates: 4
    minCandidateChars: 8000
    cooldownTurns: 3
  preserve:
    recentMessages: 6
    recentTokens: 12000
    errors: true
  decisions:
    fullThreshold: 0.70
    truncateThreshold: 0.45
  state:
    maxStateTokens: 25000
    maxRequestTokens: 30000
    toolInputChars: 1000
    resultPreviewChars: 300
  pruning:
    truncateHeadChars: 384
    truncateTailChars: 128
    minSavingsChars: 8000
    minSavingsRatio: 0.05
  privacy:
    includeUserText: true
    includeAssistantText: true
    includeToolArguments: true
    textChars: 1000
  diagnostics:
    logLevel: info
    includeCandidateScores: false
```

Without a resolvable model context window the automatic trigger falls back to
`trigger.minSurfaceTokens` on the metered total instead of guessing a ratio.

### Decision provider presets

The `decision` block selects the scoring endpoint by preset instead of
listing the endpoint fields by hand:

```yaml
jev-compaction:
  decision:
    provider: typesafe   # typesafe | jeff | custom
    # typesafe:            # per-preset overrides (optional)
    #   model: jev-latest
    # custom:              # `provider: custom` requires an explicit baseUrl
    #   baseUrl: https://internal.example.corp/v1/systemone
    #   apiKeyEnv: MY_JEV_KEY
```

- `typesafe` — the public TypeSafe AI System One endpoint (`jev-latest`,
  `TYPESAFE_API_KEY`); the default.
- `jeff` — a local System One-compatible server on `http://localhost:8000`
  (`JEFF_API_KEY`).
- `custom` — bring your own endpoint; an explicit `baseUrl` is required and
  a missing one fails loudly at startup.

The flat `jev.*` fields from the example above remain supported and override
the resolved preset one-for-one.

## Comparison

| Approach | User/assistant text | Tool output | Durable original | Semantic |
|---|---|---|---|---|
| Summary compaction | summarized for old range | summarized | yes | generative |
| Deterministic size pruner | unchanged | size-based trim | yes | no |
| `dsh-jev-compaction` | unchanged | Jev-selected trim/stub | yes | decision model |

The selection decision can still be wrong; this plugin does not claim
lossless compaction. Use `/jev-compact --dry-run` to audit what would be
pruned before enabling automatic mode. The original of every pruned result
stays recoverable from the session log.

## Roadmap

- **0.1 — companion mode (this release):** runs before `dsh-compaction-basic`;
  the built-in engine remains the summary fallback.
- **0.2 — `backend` mode (target):** the plugin provides `ctx.compaction`
  itself — Jev pruning at an early semantic threshold, conventional summary
  fallback above a higher one — replacing `dsh-compaction-basic` through the
  official capability seam; `/compact` keeps working unchanged. Design notes:
  SPEC §6.6 and
  [docs/compatibility.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/compatibility.md).

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0`, tested against `0.1.5-rc.2` (see
  `compatibility.json`). Phase 0 API findings:
  [docs/compatibility.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/compatibility.md).
- Node.js `^22.19.0 || >=24.0.0`.

## Attribution

Inspired by [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
by Tamara Tran (MIT), which introduced Jev-based selective tool-history
compaction for Claude Code. See [NOTICE.md](./NOTICE.md).

## License

MIT
