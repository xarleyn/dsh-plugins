# @yadsh/dsh-jev-compaction

**Jev-powered, replay-safe semantic context pruning for DeepSeek Harness. Keeps conversation text verbatim and selectively forgets stale tool output before ordinary summary compaction is needed.**

> Forget stale tool output, not the conversation.

## How context reduction works

Two layers with deliberately different safety properties:

```text
tool executes
     ↓
tools/post-execute ── immediate result shaping (opt-in, off by default)
     ↓                 large repetitive output → smaller output, same meaning
tool/result persisted
     ↓
session grows over time
     ↓
agent/pre-step ────── historical Jev compaction (on by default)
     ↓                 stale results → truncated head/tail or a stub
still too much context?
     ↓
ordinary DSH summary compaction
```

**Immediate result shaping** collapses long runs of repetitive output —
progress bars, per-item chatter, per-test pass lines — before they ever enter
the conversation. It runs on the tool-execution path, so it is opt-in, it
archives the original by default, and it never touches errors.

**Historical compaction** runs later, when the context is already under
pressure: it scores the old `tool/result` nodes that are still visible and
replaces the stale ones through replay-safe surface replacements.

### Historical compaction (on by default)

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

### Immediate result shaping (opt-in)

Registered on the `tools/post-execute` waterfall, which runs **before** DSH
persists the final `tool/result`:

1. Only allowlisted command tools are considered, only successful results, and
   only ones long enough and repetitive enough to be worth a request.
2. The text is split into lines and normalized to line shapes, so lines that
   differ only in counters, percentages, timestamps or hashes share a shape.
3. Head, tail, failures, warnings, summaries and diagnostics are pinned; a
   pinned line splits a run, so an error in the middle of a progress bar is
   never collapsed away. Only _contiguous_ same-shape runs can collapse.
4. Each run is classified by two yes/no questions: is this routine repetition,
   and would removing it materially hurt the next decision. A run collapses
   only when the two answers are decisively apart.
5. The collapsed runs are replaced in place by neutral markers such as
   `[dsh-jev-compaction: collapsed 97 repetitive lines]`, and the whole result
   is discarded unless it clears the minimum-savings gate.

Fail-open by design at both layers: every failure (missing API key, timeout,
malformed response, surface drift, cancellation, a downstream plugin's block)
skips the work and leaves ordinary DSH behavior untouched.

## Safety: what each layer can and cannot lose

Historical compaction is replay-safe. It shadows an already-durable
`tool/result` surface node, and the original event stays in the append-only
session log forever — a stub says so in its own text.

Immediate shaping is **not** replay-safe by construction: it replaces the
rendered content _before_ DSH persists it, and DSH does not keep the
execution-local `value` for replay. That is why it is off by default, why the
archive is on by default, and why turning the archive off is answered with a
warning rather than silence:

> Shaped output may not be recoverable from session replay.

The archive stores the pre-shaping content under its content hash
(`sha256:<hex>`, deduplicated) beneath the harness home, with a retention
window and a size ceiling. The shaped text carries only a short opaque
reference — never a path, and never a capability the model can act on.

## Decision backends

The scoring backend is pluggable (SPEC §18). All providers speak the same
System One scoring contract; switching is configuration, not code.

| `decision.provider`  | Endpoint                               | Key variable       | Notes                                                                                                                                                   |
| -------------------- | -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typesafe` (default) | `https://api.typesafe.ai/v1/systemone` | `TYPESAFE_API_KEY` | hosted Jev; reference quality                                                                                                                           |
| `jeff`               | `http://localhost:8000/v1/systemone`   | `JEFF_API_KEY`     | self-hosted [jeff](https://github.com/logan-markewich/jeff) server (GLiFormer ~400M); near drop-in, free local evals, weaker on reasoning-heavy scoring |
| `custom`             | required                               | optional           | any System One-compatible endpoint (e.g. open-jev); set `decision.custom.baseUrl`; an empty `apiKeyEnv` disables the Authorization header               |

```yaml
jev-compaction:
  decision:
    provider: jeff # typesafe | jeff | custom
    jeff:
      baseUrl: http://jeff:8000/v1/systemone
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
reports. A backend whose variable is unset at startup is reported once in the
plugin log (`jev-compaction/credential-missing`) with its provider and
endpoint, because the environment is not part of the configuration and the
first symptom would otherwise be a prune refused minutes later.

`decision.<provider>` is the authoritative shape. The legacy flat `jev` block
still overrides it one-for-one, but only for values that differ from the
shipped defaults: a settings-driven deployment is handed a configuration with
every default filled in, and letting those win would shadow the provider the
deployment actually selected.

## Installation

```bash
dsh plugin --profile <profile> add @yadsh/dsh-jev-compaction
```

## Modes

The plugin ships two mountable entries (SPEC §6.6):

**Companion (default `.` entry).** Mount as a regular plugin next to the
built-in engine. Semantic pruning runs at `trigger.contextRatio`; the
inherited `dsh-compaction-basic` stays the summary fallback:

```yaml
- name: "@yadsh/dsh-jev-compaction"
- name: "@deepseek-ai/dsh-compaction-basic"
- name: "@deepseek-ai/dsh-command-compact"
```

**Backend (`./backend` entry).** The plugin _is_ the compaction engine: it
extends `BasicCompactionEngine`, so `/compact`, overflow recovery, the
deterministic size pruner, and the summary fallback are inherited, while
Jev pruning runs earlier. `summaryRatio` (default `0.82`) replaces basic's
`thresholdRatio`; mounting both engines is a composition error — exactly one
engine may claim the compaction service:

```yaml
- name: "@yadsh/dsh-jev-compaction/backend"
- name: "@deepseek-ai/dsh-command-compact"
```

Rolling back to the stock engine is a one-row profile change. Phase 0
findings for the backend entry (loader mechanics, exactly-one-engine rule,
0.1.6 readiness):
[docs/backend-mode-spike.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/backend-mode-spike.md).

## Commands

- `/jev-compact --dry-run` — run the full pipeline read-only and report the
  plan (candidates, actions, estimated savings, highest-confidence stubs).
- `/jev-compact` — run the pipeline and queue the mutation for the next
  model step. Tool-result replacements are only legal inside an open turn,
  and command handlers run between turns, so the queued plan is recomputed
  and applied right before the next step; a stale plan is dropped.

## Configuration (defaults)

Every value below is also editable from the settings card (**Settings →
Plugins → Jev Compaction**) without editing YAML; the full reference, including
the result-shaping and archive sections, is in
[docs/configuration.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/configuration.md).

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
    contextRatio: 0.70 # below dsh-compaction-basic's 0.8 default
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
  resultShaping:
    enabled: false # opt-in: this path changes durable content
    includeTools:
      [bash, terminal, pwsh, run_command, execute_command, run_tests]
    excludeTools: []
    thresholdChars: 12000
    hardLengthTriggerChars: 32000
    minLines: 80
    repetitionTriggerRatio: 0.45
    maxPerTurn: 2
    maxConcurrent: 2
    preserveErrors: true
    minRunLines: 3
    keepHeadLines: 8
    keepTailLines: 12
    minClassificationConfidence: 0.60
    minSavingsChars: 4000
    minSavingsRatio: 0.30
    requestTimeoutMs: 2500
    maxInputCharsPerTurn: 50000
  archive:
    enabled: true # keep the pre-shaping original
    rootPath: "" # default: $DSH_HOME/data/dsh-jev-compaction/originals
    retentionDays: 14
    maxBytes: 1073741824
    deduplicate: true
    onFailure: keep-original
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

## Settings card

**Settings → Plugins → Jev Compaction** edits the same configuration through
the host settings service: every control writes as it is made and applies to
the running plugin without a restart. The card shows which values your user
layer overrides, resets them back to the deployment default, and never renders
an API key — the provider section edits the _name_ of the environment variable
holding it and the key itself stays on the host.

<!-- Screenshot of the card: `docs/images/settings-card.png` (added on release). -->

### Decision provider presets

The `decision` block selects the scoring endpoint by preset instead of
listing the endpoint fields by hand:

```yaml
jev-compaction:
  decision:
    provider: typesafe # typesafe | jeff | custom
    # typesafe:            # per-preset overrides (optional)
    #   model: jev-latest
    # custom:              # `provider: custom` requires an explicit baseUrl
    #   baseUrl: https://internal.example.corp/v1/systemone
    #   apiKeyEnv: MY_JEV_KEY
```

- `typesafe` — the public TypeSafe AI System One endpoint (`jev-latest`,
  `TYPESAFE_API_KEY`); the default.
- `jeff` — a local System One-compatible server on `http://localhost:8000`; the
  `/v1/systemone` route is added when a deployment names only a host, so both
  spellings work
  (`JEFF_API_KEY`).
- `custom` — bring your own endpoint; an explicit `baseUrl` is required and
  a missing one fails loudly at startup.

The flat `jev.*` fields from the example above remain supported and override
the resolved preset one-for-one.

## Comparison

| Approach                  | User/assistant text      | Tool output            | Durable original       | Semantic       |
| ------------------------- | ------------------------ | ---------------------- | ---------------------- | -------------- |
| Summary compaction        | summarized for old range | summarized             | yes                    | generative     |
| Deterministic size pruner | unchanged                | size-based trim        | yes                    | no             |
| Immediate result shaping  | unchanged                | routine runs collapsed | archived by the plugin | decision model |
| Historical compaction     | unchanged                | Jev-selected trim/stub | yes                    | decision model |

The selection decision can still be wrong; this plugin does not claim
lossless compaction. Use `/jev-compact --dry-run` to audit what would be
pruned before enabling automatic mode. The original of every historically
pruned result stays recoverable from the session log; the original of an
immediately shaped result is recoverable from the plugin archive while it is
retained.

## Roadmap

- **0.1 — companion mode:** runs before `dsh-compaction-basic`; the
  built-in engine remains the summary fallback.
- **0.1 — backend mode (shipped, requires live-rig confirmation):** the
  `./backend` entry provides `ctx.compaction` itself — Jev pruning at the
  early threshold, conventional summary fallback above `summaryRatio` —
  replacing `dsh-compaction-basic` through the official capability seam;
  `/compact` keeps working unchanged.
- **0.1 — immediate result shaping and the settings card (shipped, off by
  default):** the `tools/post-execute` shaper plus the Plugins settings card.
  Phase 0 API findings:
  [docs/RESULT_SHAPING_SPIKE.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/RESULT_SHAPING_SPIKE.md).
- **Offline evaluation:** the twelve-scenario corpus runs in-repo via
  `pnpm run eval` (zero dangerous prunes, ≈80% average reduction on the
  low-danger set); results and the hosted-Jev replay procedure:
  [docs/evaluation.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/evaluation.md).

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0`, tested against `0.1.5-rc.2` (see
  `compatibility.json`); the settings card requires the
  `settings.plugin.item` client slot, and immediate shaping requires the
  `tools/post-execute` waterfall. Phase 0 API findings:
  [docs/compatibility.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/compatibility.md)
  and
  [docs/RESULT_SHAPING_SPIKE.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-jev-compaction/docs/RESULT_SHAPING_SPIKE.md).
- Node.js `^22.19.0 || >=24.0.0`.

## Attribution

Inspired by [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
by Tamara Tran (MIT), which introduced Jev-based selective tool-history
compaction for Claude Code. Immediate result shaping was inspired by the
`typesafe-result-shaper` module of
[zhangxaochen/dsh-jev](https://github.com/zhangxaochen/dsh-jev) (MIT). See
[NOTICE.md](./NOTICE.md).

## License

MIT
