# dsh-sleev — Initial Technical Specification

**Document status:** Draft / v0.1  
**Target:** DeepSeek Harness developer preview (state verified 2026-08-27)  
**Plugin:** `dsh-sleev`  
**Primary role:** integrate DeepSeek Harness with Sleev as an external context-optimization gateway, while preserving Harness-native session semantics and adding first-class observability.

---

## 1. Executive summary

`dsh-sleev` should **not** reimplement Sleev and should **not** become another compaction engine.

The plugin is a thin integration and observability layer between DeepSeek Harness (DSH) and the external Sleev gateway. Its responsibilities are:

1. provide a safe, convenient way to route selected DSH LLM provider routes through Sleev;
2. keep DSH's durable session history and logical model context untouched;
3. observe the logical request before Sleev and provider-reported usage after Sleev;
4. expose the difference as context-reduction / cache / cost metrics;
5. detect potentially harmful overlap with native DSH compaction;
6. offer a small Web UI for status, routing, diagnostics, and per-session savings;
7. integrate cleanly with `dsh-context` without depending on its internal implementation;
8. keep Sleev-specific transport code isolated so future context optimizers can be supported without rewriting the plugin.

The key architectural idea is to deliberately preserve three different layers of state:

```text
┌──────────────────────────────────────────────┐
│ 1. Durable history                          │
│ DSH SessionEvent log                        │
│ "what happened"                             │
└──────────────────────┬───────────────────────┘
                       │ projection
                       ▼
┌──────────────────────────────────────────────┐
│ 2. Logical model context                    │
│ DSH GenerateOptions                         │
│ "what Harness intends to send"              │
└──────────────────────┬───────────────────────┘
                       │ external optimization
                       ▼
┌──────────────────────────────────────────────┐
│ 3. Effective provider context               │
│ request after Sleev                         │
│ "what the upstream model actually processes"│
└──────────────────────────────────────────────┘
```

`dsh-sleev` must **not collapse these concepts into one number**.

This separation is the core of the project.

---

# 2. Problem statement

Long-running agent sessions repeatedly send an increasingly large prompt containing:

- system prompt;
- tool schemas;
- previous user messages;
- assistant replies;
- tool calls and results;
- file contents;
- shell output;
- stale investigation branches;
- already-resolved errors.

DSH already has a native compaction subsystem. Sleev solves a related problem from another layer: it acts as a gateway between the harness and the model provider and optimizes the context at the wire boundary.

The integration problem is therefore not simply:

> point `baseURL` at Sleev.

There are several secondary problems that become important once the gateway is actually used:

- DSH's token meter continues to describe the logical context;
- the provider reports usage for the optimized context;
- native DSH compaction may fire based on logical pressure even when the effective provider request is much smaller;
- a UI such as `dsh-context` can show apparently contradictory numbers;
- auxiliary model calls (`compaction`, `session-title`) must not pollute main-session savings metrics;
- retries must not be accidentally double-counted or attributed to the wrong request;
- routing must remain explicit and reversible;
- credentials and upstream headers must never leak into telemetry.

`dsh-sleev` exists to make these interactions predictable.

---

# 3. Goals

## 3.1 Primary goals

### G1. Sleev routing without modifying DSH core

The integration must work as an out-of-tree DSH plugin and must not require patching DeepSeek Harness.

### G2. Preserve reconstructability

`GenerateOptions` produced by the DSH agent loop must remain untouched.

The session log must continue to reconstruct the logical request exactly as DSH expects.

### G3. One owner of automatic context mutation

When Sleev is used as the active context optimizer, automatic DSH summarizing/pruning should normally be disabled or explicitly acknowledged.

The plugin must detect and surface possible double-compaction.

### G4. Accurate observability

For each main LLM request, expose at least:

- provider;
- model;
- session;
- logical estimated context;
- provider-reported uncached input;
- provider-reported cache reads;
- provider-reported cache writes;
- output tokens;
- effective provider input;
- estimated context reduction;
- reduction ratio;
- gateway route;
- request status / latency if available.

### G5. Fail predictably

The user must know whether the request is:

- routed through Sleev;
- bypassing Sleev;
- failing because Sleev is unavailable.

No silent routing changes.

### G6. Web UI suitable for day-to-day use

A user should be able to answer:

- Is Sleev active?
- Which providers go through it?
- Is the gateway reachable?
- Is native compaction also active?
- How much context is DSH carrying?
- How much did the provider actually process?
- How much has this session approximately saved?

### G7. Good architecture for future extension

Vendor-specific behavior must be behind an adapter boundary.

We should be able to add another external optimizer later without rewriting metrics, UI, session correlation, or DSH integration.

---

# 4. Non-goals

The first versions explicitly do **not** aim to:

1. reproduce Sleev's compression algorithm;
2. modify `GenerateOptions.messages`;
3. implement a new `CompactionEngine`;
4. replace `dsh-context`;
5. infer or reconstruct Sleev's internal summaries;
6. intercept arbitrary HTTP traffic outside the DSH LLM seam;
7. promise exact monetary savings when the upstream pricing model is unknown;
8. manage provider API keys outside existing DSH credential mechanisms;
9. silently rewrite arbitrary existing provider profiles;
10. implement transparent provider failover in MVP.

These constraints keep the project narrow and make the initial implementation safe.

---

# 5. Verified DSH architecture assumptions

The design is based on the following current DSH properties.

## 5.1 Everything is a Cordis plugin

DSH is composed as a plugin tree. An out-of-tree npm package can ship a bundle patch and be installed into a profile without modifying DSH itself.

This is the correct extension mechanism for `dsh-sleev`.

## 5.2 `llm/stream` is an official waterfall interception point

Every model call passes through the `llm/stream` waterfall.

This is suitable for:

- observing the full `GenerateOptions`;
- classifying main agent-loop vs auxiliary requests;
- wrapping the returned `AsyncIterable<StreamChunk>`;
- observing `usage` chunks;
- collecting latency/error metrics.

Important constraint: loop-built `GenerateOptions` are deep-frozen and are intended to be read, not rewritten.

`dsh-sleev` should honor that contract.

## 5.3 Main requests have identity

Loop-built requests have:

- `sessionId`;
- a process-local agent-loop request marker;
- `purpose` unset for ordinary conversation requests.

Auxiliary calls may use:

- `purpose: 'compaction'`;
- `purpose: 'session-title'`.

This gives us a robust request classifier.

## 5.4 `llm-pi-ai` supports gateway-style provider configuration

A provider profile can include:

- route-specific `baseURL`;
- route-specific headers;
- protocol selection;
- model metadata;
- prompt-cache preferences;
- credential references.

It can represent a custom OpenAI-compatible gateway without writing another HTTP client.

Therefore the preferred integration should reuse `@deepseek-ai/dsh-llm-pi-ai` where possible.

## 5.5 DSH has a native token meter

`ctx.tokenMeter` owns the canonical Harness-side request-pressure estimate.

Its composition values are estimates, not billing truth.

This is exactly what we need for the logical-context side of the comparison.

## 5.6 DSH has native compaction

The current compaction capability consists of a service contract and swappable implementation.

`dsh-compaction-basic`:

- uses `ctx.tokenMeter`;
- automatically compacts around a configurable pressure threshold;
- can retain a configurable recent tail;
- performs summarization through `ctx.llm.stream()`.

This creates a potential conflict with Sleev because both can modify effective long-session context, but at different layers.

## 5.7 Provider usage is part of the stream

A `usage` chunk contains disjoint token counts:

```ts
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

Effective provider input for comparison should therefore normally be treated as:

```ts
effectiveInput =
  inputTokens
  + (cacheReadTokens ?? 0)
  + (cacheWriteTokens ?? 0)
```

This is a token-volume metric, **not necessarily billed cost**.

## 5.8 `dsh-context` already distinguishes estimate and provider actuals

`dsh-context` already exposes current composition, history, compactions/prunes, and provider-reported usage.

That makes it a natural optional integration target, but `dsh-sleev` should not import or mutate its internals.

---

# 6. Core design principles

## 6.1 Observe, do not rewrite

The host plugin should use `llm/stream` primarily as an observer.

It must not mutate loop-built requests.

Routing happens through provider configuration, not message rewriting.

## 6.2 Logical and effective context are separate first-class metrics

Never label provider usage simply as "context" without qualification.

Terminology:

- **Logical context** — DSH-side request before external optimization.
- **Effective provider input** — token volume reported after the external gateway.
- **Reduction** — difference between the two when both are comparable.
- **Reclaimed** — use only for explicit optimizer-reported savings if Sleev eventually exposes such telemetry.

## 6.3 No hidden bypass

If a route is named/configured as Sleev-routed, it should fail if Sleev is unavailable unless the user explicitly enables a future fallback policy.

MVP behavior: fail closed.

This prevents a misleading state where the UI says "Sleev" but requests are suddenly sent directly.

## 6.4 Do not automatically mutate unrelated plugins

`dsh-sleev` should warn about native automatic compaction but should not silently rewrite `dsh-compaction-basic` configuration.

Automatic config mutation is hard to reason about and can survive longer than the plugin itself.

A later version may provide an explicit "Apply recommended config" action.

## 6.5 Prefer Harness services over private filesystem state

Session metrics should live in DSH-native projections/storage where practical.

If local plugin state is needed, never hard-code `~/.dsh`; resolve Harness home through `DSH_HOME` / the host's own runtime facilities.

## 6.6 Vendor isolation

Sleev-specific details belong in one module:

```text
src/host/optimizer/sleev/*
```

Everything above that layer should talk in generic concepts such as:

- route;
- gateway;
- health;
- optimization status;
- request telemetry.

## 6.7 Rule of three for public abstraction

Internally we can define neutral interfaces from day one.

We should not publish a large generic "context optimizer SDK" before a second implementation exists.

The plugin should be extensible without prematurely freezing the wrong public API.

---

# 7. High-level architecture

```mermaid
flowchart TD
    A[DSH Agent Loop] --> B[GenerateOptions]
    B --> C[llm/stream waterfall]

    C --> O[dsh-sleev observer]
    O --> N[next()]

    N --> P[llm-pi-ai Sleev route]
    P --> S[Sleev Gateway]
    S --> U[Upstream Model Provider]

    U --> S
    S --> P
    P --> R[StreamChunk usage/output]
    R --> O
    O --> A

    T[ctx.tokenMeter / session projections] --> M[Metrics Correlator]
    O --> M
    M --> Q[dsh-sleev projection]
    Q --> W[dsh-sleev Web UI]

    Q -. optional contract .-> X[dsh-context]
```

The most important design choice is that the plugin sits **beside** the LLM adapter rather than replacing the agent loop.

---

# 8. Proposed repository structure

Initial recommendation: **single npm package**, layered internally.

Do not split into a monorepo until there is a concrete need.

```text
dsh-sleev/
├─ package.json
├─ tsconfig.json
├─ tsup.config.ts
├─ cordis.patch.yml
├─ README.md
├─ LICENSE
├─ docs/
│  ├─ architecture.md
│  ├─ troubleshooting.md
│  └─ development.md
├─ src/
│  ├─ index.ts
│  ├─ client.ts
│  │
│  ├─ shared/
│  │  ├─ contracts.ts
│  │  ├─ telemetry.ts
│  │  ├─ config.ts
│  │  └─ constants.ts
│  │
│  ├─ host/
│  │  ├─ plugin.ts
│  │  ├─ config.ts
│  │  ├─ request-classifier.ts
│  │  ├─ stream-observer.ts
│  │  ├─ session-correlator.ts
│  │  ├─ usage.ts
│  │  ├─ conflict-detector.ts
│  │  ├─ health-service.ts
│  │  ├─ projection.ts
│  │  ├─ logger.ts
│  │  │
│  │  ├─ routing/
│  │  │  ├─ route-plan.ts
│  │  │  ├─ route-validator.ts
│  │  │  └─ pi-ai-profile.ts
│  │  │
│  │  └─ optimizer/
│  │     ├─ optimizer-adapter.ts
│  │     └─ sleev/
│  │        ├─ sleev-adapter.ts
│  │        ├─ sleev-config.ts
│  │        ├─ sleev-health.ts
│  │        └─ sleev-headers.ts
│  │
│  └─ client/
│     ├─ index.tsx
│     ├─ i18n.ts
│     ├─ hooks/
│     ├─ components/
│     │  ├─ StatusCard.tsx
│     │  ├─ RouteTable.tsx
│     │  ├─ SavingsSummary.tsx
│     │  ├─ ConflictWarning.tsx
│     │  └─ RequestHistory.tsx
│     └─ format/
│
├─ tests/
│  ├─ host/
│  ├─ client/
│  ├─ fixtures/
│  └─ integration/
└─ scripts/
   └─ dev-install.*
```

This mirrors the successful `shared / host / client` shape used by modern out-of-tree DSH UI plugins while keeping the vendor boundary explicit.

---

# 9. Internal domain model

## 9.1 Optimizer identity

```ts
export type OptimizerId = 'sleev'
```

Keep it a string-like abstraction internally even if only Sleev exists today.

## 9.2 Route identity

```ts
export interface OptimizedRoute {
  route: string
  optimizer: OptimizerId
  gatewayBaseUrl: string
  upstreamProvider: string
  enabled: boolean
}
```

Avoid storing API keys here.

## 9.3 Request classification

```ts
export type RequestKind =
  | 'agent'
  | 'compaction'
  | 'session-title'
  | 'one-shot'
  | 'unknown'
```

Classification rules:

```text
isAgentLoopRequest(options) && purpose == undefined
    -> agent

purpose == 'compaction'
    -> compaction

purpose == 'session-title'
    -> session-title

no loop marker
    -> one-shot

otherwise
    -> unknown
```

Only `agent` should count toward the primary "session context savings" KPI by default.

Auxiliary calls still deserve their own telemetry because native compaction can become unexpectedly expensive.

## 9.4 Per-call telemetry

```ts
export interface OptimizerCallTelemetry {
  schemaVersion: 1

  callId: string
  sessionId?: string
  kind: RequestKind

  provider: string
  model: string
  optimizer?: OptimizerId

  startedAt: number
  finishedAt?: number
  durationMs?: number

  logical?: {
    estimatedInputTokens?: number
    contextWindow?: number
    occupancyRatio?: number
  }

  providerUsage?: {
    inputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    outputTokens: number
    reasoningTokens?: number
  }

  derived?: {
    effectiveInputTokens?: number
    estimatedReducedTokens?: number
    estimatedReductionRatio?: number
  }

  result:
    | { kind: 'pending' }
    | { kind: 'success' }
    | { kind: 'error'; code?: string }
    | { kind: 'aborted' }
}
```

### Important naming choice

Use `estimatedReducedTokens`, not `savedTokens`.

Why?

The logical DSH token meter is heuristic, while provider usage is provider-reported. The subtraction is useful but not exact enough to present as accounting truth.

If Sleev later exposes explicit pre/post counts, we can add:

```ts
optimizerUsage?: {
  beforeTokens: number
  afterTokens: number
  reclaimedTokens: number
}
```

That would be a stronger metric.

---

# 10. Routing architecture

There are three plausible integration modes.

## 10.1 Mode A — explicit Sleev route aliases (recommended MVP)

Example conceptual route names:

```text
openai          -> direct provider
sleev-openai    -> Sleev -> OpenAI

zai             -> direct provider
sleev-zai       -> Sleev -> Z.AI
```

Benefits:

- direct and optimized paths can coexist;
- easy A/B testing;
- no surprise modification of existing routes;
- easy rollback;
- easy debugging;
- route name itself communicates behavior.

Cost:

- the user has to select the Sleev route explicitly;
- models may need duplicated route metadata.

This is the safest MVP.

## 10.2 Mode B — override an existing route

```text
openai -> Sleev -> OpenAI
```

Benefits:

- transparent to the user;
- existing sessions keep the same logical provider name.

Costs:

- much harder to reason about route ownership;
- possible adapter registration conflicts;
- harder rollback;
- direct-vs-Sleev comparison becomes less obvious;
- out-of-tree plugins should avoid surprising composition overrides.

This should be an advanced, later option only.

## 10.3 Mode C — dedicated forwarding LLM adapter

`dsh-sleev` implements `LlmAdapter` itself.

This would give maximum control over routing and fallback, but would force us to:

- serialize multiple provider protocols;
- reproduce behavior already handled by `pi-ai`;
- track DSH wire/API changes;
- reimplement model listing and capability handling.

Reject for initial implementation.

---

# 11. Preferred provider integration

The preferred implementation is:

```text
dsh-sleev
    └─ generates/installs provider profile(s)
          ↓
@deepseek-ai/dsh-llm-pi-ai
          ↓
Sleev gateway base URL + Sleev routing headers
          ↓
upstream provider
```

`dsh-sleev` should not own HTTP serialization when `llm-pi-ai` can already express the route.

## 11.1 Route configuration object

Proposed plugin-level config:

```ts
export interface DshSleevConfig {
  gateway?: {
    baseUrl?: string
    healthUrl?: string
    connectTimeoutMs?: number
  }

  routes?: Record<string, {
    enabled?: boolean

    /**
     * Existing provider semantics to mirror.
     * Example: "openai", "anthropic", "zai".
     */
    upstreamProvider: string

    /**
     * Wire protocol expected by Sleev/upstream.
     * Optional when inherited from a known pi-ai provider.
     */
    api?: string

    /**
     * Route-specific upstream base URL if Sleev requires one.
     */
    upstreamBaseUrl?: string

    /**
     * Optional explicit model catalog override.
     */
    models?: Array<{
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
    }>

    /**
     * Credential reference already managed by DSH.
     */
    apiKeyEnv?: string

    /**
     * Additional non-secret routing headers.
     */
    headers?: Record<string, string>
  }>

  observability?: {
    enabled?: boolean
    persistPerRequest?: boolean
    maxRequestsPerSession?: number
  }

  safety?: {
    nativeCompactionPolicy?: 'warn' | 'ignore'
    failMode?: 'closed'
  }

  ui?: {
    enabled?: boolean
  }
}
```

The exact Sleev header names and supported harness identifier must be verified during Phase 0 and must be encapsulated in `sleev-headers.ts`, not scattered throughout the codebase.

---

# 12. Route provisioning strategy

A key implementation question is **who writes the `llm-pi-ai` profile**.

Recommended progression:

## v0.1: generated configuration / guided setup

The plugin exposes a diagnostic command or UI that produces the exact provider profile required for DSH.

The user applies it through the normal DSH settings/configuration plane.

Why start here:

- no undocumented runtime mutation;
- easy to inspect;
- simplest possible failure model;
- proves Sleev compatibility first.

## v0.2+: settings integration

Once the integration is proven, `dsh-sleev` can use DSH's settings/configurable-provider mechanisms to make route setup one-click.

The important rule is:

> use supported configuration services, not direct edits to random files.

If a generated file is ever needed, resolve all paths through DSH runtime facilities / `DSH_HOME`, never assumptions about `~/.dsh`.

---

# 13. Observability pipeline

## 13.1 Request start

A `llm/stream` listener receives `GenerateOptions`.

For every request:

1. classify the request;
2. detect whether its provider route is Sleev-managed;
3. create an internal call ID;
4. capture provider/model/session/purpose;
5. obtain logical context measurement if available;
6. call `next()` exactly once;
7. wrap the downstream stream.

Pseudo-code:

```ts
ctx.on('llm/stream', function (options, next) {
  const meta = classify(options)

  if (!telemetry.shouldObserve(meta)) {
    return next()
  }

  return observeStream({
    options,
    meta,
    downstream: next(),
  })
})
```

### Critical invariant

The listener must not consume `next()` twice.

The waterfall is one-shot.

## 13.2 Stream observation

```ts
async function* observeStream(...) {
  let usage: TokenUsage | undefined
  let finish: FinishReason | undefined

  try {
    for await (const chunk of downstream) {
      if (chunk.type === 'usage') {
        usage = mergeUsageForThisAttempt(usage, chunk.usage)
      }

      if (chunk.type === 'finish') {
        finish = chunk.reason
      }

      yield chunk
    }
  } finally {
    telemetry.complete(...)
  }
}
```

The wrapper must be transparent:

- same chunk order;
- same values;
- same cancellation;
- no buffering of content chunks;
- no alteration of errors.

## 13.3 Logical token measurement

Preferred order:

1. use official DSH request/session measurement where a same-boundary API is available;
2. otherwise use the nearest official session projection;
3. only as a last resort compute a plugin-local estimate.

Do **not** duplicate DSH's 4-char/token heuristic if `ctx.tokenMeter` can provide the figure.

The measurement should be tagged with:

```text
source = token-meter | projection | local-estimate
```

so the UI can communicate confidence.

## 13.4 Effective input

Provider usage fields are disjoint.

Therefore:

```ts
effectiveInputTokens =
  inputTokens +
  cacheReadTokens +
  cacheWriteTokens
```

For a separate "uncached billed input" row, keep `inputTokens` as-is.

Do not add reasoning tokens to output totals: they are informational and already included in output token accounting in the DSH contract.

## 13.5 Reduction

```ts
estimatedReducedTokens =
  max(0, logicalEstimatedInput - effectiveInputTokens)

estimatedReductionRatio =
  estimatedReducedTokens / logicalEstimatedInput
```

If the provider usage is missing or logical measurement confidence is too low:

```text
reduction = unavailable
```

Do not invent zero.

---

# 14. Correlation model

## 14.1 Session identity

For main agent-loop requests, `GenerateOptions.sessionId` is the stable primary key.

Per-session state:

```ts
Map<SessionId, SessionOptimizerState>
```

## 14.2 Per-call identity

Do not use only `(sessionId, turn, step)` internally unless the exact step is reliably available at the interception boundary.

Retries can produce multiple provider attempts for one logical step.

Use an internal unique call/attempt identifier and attach step metadata later when available.

## 14.3 Retries

Two different questions must be represented separately:

### Request-level view

"What did the successful logical step cost?"

### Attempt-level view

"How many provider attempts were paid for?"

The internal model should support attempt accumulation even if the first UI initially shows only request-level totals.

This avoids painting ourselves into a corner around DSH retry semantics.

---

# 15. Session projection

Recommended: expose a DSH-native session projection rather than creating a custom polling endpoint.

Conceptual projection:

```ts
export interface SleevSessionProjection {
  schemaVersion: 1

  active: boolean

  route?: {
    provider: string
    model?: string
    optimizer: 'sleev'
  }

  aggregate: {
    calls: number
    successfulCalls: number

    logicalEstimatedInputTokens?: number
    effectiveInputTokens?: number

    inputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    outputTokens: number

    estimatedReducedTokens?: number
    estimatedReductionRatio?: number
  }

  latest?: OptimizerCallTelemetry

  recent: OptimizerCallTelemetry[]

  warnings: OptimizerWarning[]
}
```

Benefits:

- integrates with Harness's live session-projection transport;
- naturally scopes data per session;
- client does not need custom polling;
- can be cached/persisted using host infrastructure;
- matches the direction taken by modern DSH plugins.

---

# 16. Native compaction conflict model

This is one of the most important parts of the plugin.

## 16.1 Why double compaction is undesirable

Example:

```text
Logical DSH context:   800k
Sleev effective input: 260k
Model capacity:       1000k
```

Native compaction sees:

```text
800k / 1000k = 80%
```

and may compact.

But the actual request reaching the provider is only around:

```text
260k / 1000k = 26%
```

That can cause unnecessary information loss.

## 16.2 Ownership states

Represent context ownership explicitly:

```ts
type ContextOwnership =
  | 'sleev-preferred'
  | 'dsh-preferred'
  | 'mixed-explicit'
```

### `sleev-preferred`

Recommended default when an optimized route is active.

Expected setup:

- Sleev performs automatic external optimization;
- DSH native `compaction-basic.auto = false`;
- manual `/compact` may remain available.

### `dsh-preferred`

Sleev is used only for transport/metrics or its optimization is disabled.

### `mixed-explicit`

Both are intentionally active.

UI should display a warning but not block.

## 16.3 What the plugin should do

MVP:

- detect `ctx.compaction` presence if possible;
- observe native `compaction/*` events;
- if a compaction occurs in a Sleev-routed session, emit a warning;
- documentation should recommend disabling automatic native compaction;
- do not auto-edit compaction config.

Later:

- inspect configuration through supported settings APIs;
- show exact detected state;
- provide an explicit "Apply recommended configuration" action.

## 16.4 Manual `/compact`

Manual compaction should remain compatible.

A user may deliberately want a durable checkpoint in DSH history.

The warning model should distinguish:

```text
automatic compaction
vs.
explicit manual compaction
```

if the relevant session event data exposes that distinction.

---

# 17. Health and gateway state

Do not assume undocumented Sleev endpoints.

Define a small adapter interface:

```ts
interface ContextOptimizerAdapter {
  readonly id: OptimizerId

  validateConfig(config: unknown): ValidationResult

  buildRouteHeaders(input: RouteBuildInput): Record<string, string>

  health(signal: AbortSignal): Promise<OptimizerHealth>
}
```

For Sleev:

```ts
type OptimizerHealth =
  | { state: 'healthy'; latencyMs?: number; version?: string }
  | { state: 'degraded'; reason: string }
  | { state: 'unreachable'; reason: string }
  | { state: 'unknown'; reason?: string }
```

If Sleev does not expose a supported health endpoint, the implementation may report:

```text
unknown / last request succeeded
```

rather than inventing a health check.

The UI should separate:

- "gateway process reachable";
- "last optimized request succeeded";
- "upstream provider succeeded".

These are different states.

---

# 18. Fail behavior

## 18.1 MVP: fail closed

If the selected provider route is `sleev-openai` and Sleev is unavailable:

```text
request fails
```

not:

```text
silently retry direct OpenAI
```

Reasons:

- cost expectations remain correct;
- debugging is deterministic;
- no hidden privacy/routing change;
- metrics stay trustworthy.

## 18.2 Future explicit fallback

A later version may offer:

```ts
fallback?: {
  enabled: boolean
  directProvider: string
}
```

but only if the fallback is:

- visible in UI;
- logged;
- represented in per-call telemetry;
- protected against routing recursion;
- explicit per route.

---

# 19. Security requirements

## 19.1 Secrets

Never persist or log:

- API keys;
- `Authorization`;
- provider credential values;
- Sleev authentication tokens;
- raw credential-resolution results.

Telemetry should store only credential references if needed, never values.

## 19.2 Header allowlist

Separate headers into categories:

```text
routing-safe
credential
unknown
```

Only routing-safe metadata should ever appear in diagnostics.

## 19.3 Prompt content

Default telemetry should store token counts and request metadata, **not prompt text**.

`dsh-context` already owns detailed context inspection.

`dsh-sleev` should avoid creating a second prompt-history database.

## 19.4 Remote gateways

If a Sleev gateway is configured on a non-loopback host:

- UI should visibly label it remote;
- HTTPS should be recommended;
- no implicit trust based on host name;
- diagnostics must not echo secrets.

---

# 20. Proposed Web UI

The plugin should provide its own compact settings/status surface.

It should **not** try to reproduce the full `dsh-context` timeline.

## 20.1 Overview

```text
┌─ Sleev ─────────────────────────────────────────────┐
│ Status          ● Connected                        │
│ Gateway         127.0.0.1:17321                    │
│ Last request    3s ago · success                    │
│                                                    │
│ This session                                       │
│ Logical input      2.84M                            │
│ Effective input    1.07M                            │
│ Est. reduction      62%                             │
│ Cache reads        812k                             │
└────────────────────────────────────────────────────┘
```

## 20.2 Route table

```text
Provider route      Upstream      Sleev      Status
────────────────────────────────────────────────────
sleev-openai        OpenAI        yes        ●
sleev-zai           Z.AI          yes        ●
openai              OpenAI        no         direct
```

## 20.3 Conflict warning

```text
⚠ Native automatic compaction detected

This session is routed through Sleev while DSH compaction is also
active. Both systems may summarize old context.

Recommended:
  Sleev owns automatic optimization
  DSH /compact remains available manually
```

## 20.4 Request history

Keep it intentionally small:

```text
Step    Logical   Effective   Reduction   Cache   Result
12      202k      72k         64%         42k     ✓
13      218k      81k         63%         50k     ✓
14      231k      88k         62%         57k     ✓
```

Full context composition remains a `dsh-context` concern.

---

# 21. `dsh-context` integration

## 21.1 Principle

`dsh-sleev` must work without `dsh-context`.

`dsh-context` must continue to work without `dsh-sleev`.

The integration is optional.

## 21.2 Desired UX

`dsh-context` could eventually display:

```text
Logical context
████████████████████░░ 203k

Effective provider input
███████░░░░░░░░░░░░░░ 72k

External optimizer
Sleev · est. −64.5%

Cache
42k read
```

## 21.3 Integration contract

Do not directly import React components from one plugin into the other.

Preferred choices, in order:

1. consume a neutral session projection exposed by `dsh-sleev`;
2. consume a small exported telemetry type contract;
3. use plugin-owned events as a fallback.

Possible exported type-only surface:

```ts
// dsh-sleev/telemetry
export interface ExternalContextOptimizationSnapshot {
  provider: string
  model: string
  logicalInputTokens?: number
  effectiveInputTokens?: number
  estimatedReducedTokens?: number
  estimatedReductionRatio?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  optimizer: 'sleev'
}
```

No UI dependency.

## 21.4 Do not reinterpret DSH compaction events

Sleev optimization should not be represented as fake `compaction/*` session events.

Those events have DSH-specific durable semantics.

Instead:

```text
native compaction -> compaction event
external optimization -> external optimizer metric
```

This distinction is valuable.

---

# 22. Cost estimation

Cost estimation is useful but should come **after** reliable token telemetry.

## v1 behavior

Show token volume only.

## v1.5 behavior

Optional price catalog:

```ts
interface ModelPrice {
  inputPerMillion?: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
  outputPerMillion?: number
  currency: 'USD'
}
```

Then compute:

```text
estimated direct cost
estimated optimized cost
estimated delta
```

Important:

- prices change;
- some plans are subscription-based;
- Sleev itself may have pricing;
- Z.AI / provider plans may not be simple per-token billing.

Therefore monetary figures must always say **estimated** and expose the assumptions.

Do not block MVP on this.

---

# 23. Logging

Use structured, low-noise logs.

Examples:

```text
[dsh-sleev] route sleev-zai -> gateway configured
[dsh-sleev] gateway reachable
[dsh-sleev] session ... request effective input 72k / logical ~203k
[dsh-sleev] warning: native compaction observed on optimized session
```

Never log full prompt bodies by default.

Log levels:

```text
error   request/gateway failures
warn    routing conflicts, double compaction
info    startup, route activation, health transitions
debug   per-request metrics and correlation details
trace   development-only stream lifecycle
```

---

# 24. Error taxonomy

Define stable plugin-owned codes.

```ts
type DshSleevErrorCode =
  | 'GATEWAY_UNREACHABLE'
  | 'GATEWAY_PROTOCOL_ERROR'
  | 'INVALID_ROUTE_CONFIG'
  | 'UNSUPPORTED_PROVIDER_PROTOCOL'
  | 'ROUTE_COLLISION'
  | 'MISSING_UPSTREAM_CONFIG'
  | 'TELEMETRY_CORRELATION_FAILED'
  | 'NATIVE_COMPACTION_CONFLICT'
```

Do not parse human error strings in the UI.

---

# 25. Compatibility strategy

DSH is currently a developer preview and can introduce breaking changes.

The plugin must treat compatibility as a feature.

## 25.1 Peer dependencies

Pin to a tested range rather than `"*"`.

Example policy:

```text
support the current rc/minor series explicitly
```

## 25.2 Runtime capability checks

Before enabling features, detect required seams:

```text
ctx.llm
ctx.sessions
optional ctx.tokenMeter
optional ctx.sessionProjections
optional ctx.compaction
```

If token meter is missing:

```text
routing works
logical-reduction metric becomes unavailable
```

Observability should degrade gracefully.

## 25.3 Adapter boundary

All DSH-specific access should be concentrated in host integration modules so an upstream API rename is localized.

---

# 26. Testing strategy

## 26.1 Unit tests

### Request classifier

Cases:

- main agent-loop;
- compaction;
- session title;
- direct one-shot;
- missing session id;
- unknown purpose in future merge-extensible shape.

### Usage math

Cases:

```text
no cache
cache read only
cache write only
both
missing usage
logical estimate smaller than provider usage
zero logical tokens
```

Never report negative savings.

### Route validator

- duplicate route;
- invalid base URL;
- unknown optimizer;
- secret header accidentally included;
- missing upstream provider.

### Conflict detector

- Sleev route + compaction event;
- direct route + compaction event;
- manual vs automatic where detectable.

## 26.2 Stream transparency tests

Given a fake downstream `AsyncIterable<StreamChunk>`:

- all chunks emerge unchanged;
- usage is observed;
- finish is observed;
- cancellation propagates;
- thrown consumer errors are not swallowed;
- downstream cleanup runs;
- `next()` is invoked once.

This is a critical test suite.

## 26.3 DSH integration tests

Boot a minimal Harness composition with:

- session store;
- llm runtime;
- fake/replay adapter;
- token meter;
- `dsh-sleev`.

Verify:

- marked requests correlate to session;
- auxiliary calls do not pollute main KPI;
- usage survives projection;
- plugin unload cleans listeners;
- no request mutation occurs.

## 26.4 Gateway integration tests

Use a local fake OpenAI-compatible gateway:

```text
DSH -> fake Sleev -> fake provider
```

The fake Sleev should deliberately reduce reported usage so the reduction pipeline can be tested deterministically.

Real Sleev tests should be an optional/manual CI lane unless the service provides a stable test mode.

## 26.5 Web tests

- status rendering;
- no-session state;
- route status;
- missing token meter;
- conflict warning;
- dark mode;
- long provider names;
- large token formatting;
- live projection update.

---

# 27. Performance requirements

The observer must be effectively free relative to an LLM request.

Targets:

- no prompt deep-clone;
- no content serialization merely for telemetry;
- no buffering of model output;
- O(1) work per stream chunk;
- bounded per-session request history;
- no global high-frequency polling;
- no synchronous network health check in the model request path.

Health checks run independently.

Token measurement should reuse DSH's token meter rather than scan the full session repeatedly if a reusable same-boundary measurement exists.

---

# 28. Persistence policy

MVP should persist **as little as possible**.

Recommended:

- current session projection: yes;
- bounded request metrics: yes, if DSH projection persistence naturally supports it;
- global lifetime accounting database: no;
- raw prompts: no;
- gateway secrets: no.

Later global analytics can be built as a separate plugin/service.

This keeps `dsh-sleev` focused.

---

# 29. Configuration UX

The ideal eventual setup:

```text
Settings
  └─ Sleev
      ├─ Gateway
      │   ├─ URL
      │   ├─ status
      │   └─ test connection
      │
      ├─ Routes
      │   ├─ Add optimized route
      │   ├─ upstream provider
      │   ├─ model mapping
      │   └─ credential reference
      │
      ├─ Context ownership
      │   ├─ Sleev preferred
      │   ├─ DSH preferred
      │   └─ Mixed / advanced
      │
      └─ Observability
          ├─ session metrics
          └─ diagnostics
```

MVP does not need all of this UI.

---

# 30. CLI / command ideas

Not all are MVP requirements.

```text
/sleev status
/sleev routes
/sleev stats
/sleev doctor
```

or host CLI equivalents if DSH command conventions favor another surface.

### `doctor`

Should verify:

- gateway URL is valid;
- gateway is reachable if a supported check exists;
- selected Sleev routes exist;
- required headers can be built;
- credential references exist without revealing values;
- native compaction is present / recently observed;
- token meter is available;
- provider reports usage.

This will be extremely useful for support.

---

# 31. Telemetry confidence levels

Because we compare heuristic and provider-reported numbers, every derived metric should carry confidence.

```ts
type MetricConfidence =
  | 'exact-provider'
  | 'harness-estimate'
  | 'optimizer-reported'
  | 'unavailable'
```

Example:

```text
Logical input        ~203k   harness estimate
Effective input       72k    provider reported
Reduction            ~64%    derived estimate
```

The tilde is intentional.

This prevents the dashboard from looking more precise than the underlying data.

---

# 32. Metrics definitions

## Per call

```text
logical_input_estimate
provider_input_uncached
provider_cache_read
provider_cache_write
provider_output
effective_provider_input
estimated_reduced_input
estimated_reduction_ratio
duration_ms
```

## Per session

```text
main_calls
failed_calls
logical_input_estimate_sum
effective_provider_input_sum
estimated_reduced_input_sum
cache_read_sum
cache_write_sum
output_sum
```

## Important caveat

Summing logical prompt sizes answers:

> how much logical prompt volume would DSH have presented across calls?

It does **not** mean unique information size.

This is still exactly the useful quantity for token economics.

---

# 33. Events vs projections

Recommended split:

### Ephemeral plugin events

Useful for loose coupling inside host runtime:

```text
dsh-sleev/call-start
dsh-sleev/call-usage
dsh-sleev/call-end
dsh-sleev/health-changed
dsh-sleev/warning
```

### Session projection

Authoritative UI consumption surface:

```text
sleevOptimization
```

Avoid writing one durable session event for every tiny internal lifecycle transition unless a clear replay requirement exists.

If durable optimizer telemetry becomes important, design a compact session event vocabulary separately.

---

# 34. Proposed host service

A small service can centralize state and keep event handlers thin.

```ts
class SleevIntegrationService {
  getHealth(): OptimizerHealth

  listRoutes(): OptimizedRoute[]

  isOptimizedProvider(provider: string): boolean

  beginCall(input: BeginCallInput): CallHandle

  getSessionSnapshot(sessionId: string): SleevSessionProjection
}
```

`CallHandle`:

```ts
interface CallHandle {
  observeUsage(usage: TokenUsage): void
  succeed(): void
  fail(error: unknown): void
  abort(): void
}
```

This avoids spreading aggregation logic across stream middleware, health code, and projection code.

---

# 35. Why not implement this as a compaction backend?

DSH's `CompactionEngine` changes the Harness-visible session surface by replacing old ranges with summaries.

Sleev optimization occurs after the Harness has already assembled the request.

If `dsh-sleev` pretended Sleev were a DSH `CompactionEngine`:

- session semantics would be wrong;
- DSH would need access to Sleev's internal replacement decisions;
- external and durable compaction would be conflated;
- reconstructability would be weakened;
- `dsh-context` would show fake compaction events.

Therefore the plugin must remain a gateway integration, not a compaction provider.

---

# 36. Why not modify messages in `llm/stream`?

Current loop-built requests are deep-frozen by design.

More importantly, even if mutation were technically possible through copying, the reconstructed session request would no longer equal the dispatched request.

That undermines one of DSH's strongest architectural properties.

External gateway optimization is cleaner precisely because:

```text
DSH remains internally truthful
while
the wire layer is optimized externally.
```

---

# 37. Architectural invariants

These should be written as tests and code comments.

## INV-1 — DSH request immutability

`dsh-sleev` never mutates a loop-built `GenerateOptions`.

## INV-2 — Stream transparency

Every downstream chunk is yielded exactly once and unchanged.

## INV-3 — No hidden routing

An optimized route never silently becomes a direct route.

## INV-4 — Secrets never enter telemetry

No secret header/value can be serialized into a session snapshot.

## INV-5 — Native and external compaction remain distinguishable

Sleev optimization never emits fake DSH compaction events.

## INV-6 — Main KPI excludes auxiliary calls

Compaction/session-title traffic is classified separately.

## INV-7 — Estimates are labeled as estimates

Subtraction between heuristic logical tokens and provider usage is never presented as exact accounting.

## INV-8 — Plugin unload is clean

All listeners, timers, projections, and registrations unwind through Cordis effects.

---

# 38. Phase 0 — Compatibility spike

**Purpose:** prove the actual Sleev wire integration before writing UI.

Deliverables:

1. install/run Sleev locally;
2. determine exact gateway URL behavior;
3. verify accepted Sleev routing headers;
4. verify which harness identifier is accepted for DeepSeek Harness;
5. route one OpenAI-compatible DSH provider through Sleev using `llm-pi-ai`;
6. confirm streaming tool calls survive;
7. confirm provider `usage` survives through Sleev;
8. compare a direct route and Sleev route on the same short prompt;
9. run a long tool-heavy session and verify reduction appears;
10. document unsupported provider protocols.

Exit criteria:

```text
DSH -> Sleev -> provider -> DSH
```

works for at least one real model, including tools and usage.

**Do not build a large plugin before this passes.**

---

# 39. Phase 1 — Routing MVP

Target version: `0.1.x`

Features:

- host-only plugin;
- Sleev config validation;
- explicit Sleev route aliases;
- setup docs;
- gateway status in logs;
- no Web UI required yet;
- no cost calculation;
- no dsh-context integration.

Deliverables:

```text
src/shared/config.ts
src/host/optimizer/sleev/*
src/host/routing/*
src/host/plugin.ts
cordis.patch.yml
README.md
```

Acceptance:

- install via normal DSH plugin flow;
- direct providers continue working;
- Sleev route works;
- invalid route config fails clearly;
- uninstall leaves no persistent behavior behind.

---

# 40. Phase 2 — Core observability

Target version: `0.2.x`

Features:

- `llm/stream` observer;
- request classification;
- provider usage capture;
- session correlation;
- logical token measurement;
- reduction estimates;
- bounded in-memory state;
- debug logs.

Acceptance:

For every main request we can produce:

```text
provider/model
session
logical estimate
provider usage
effective input
estimated reduction
cache tokens
status
duration
```

without modifying the stream.

---

# 41. Phase 3 — Native compaction safety

Target version: `0.3.x`

Features:

- detect active/available native compaction where possible;
- watch `compaction/*` events;
- per-session warning;
- recommended configuration documentation;
- distinguish manual/native events when metadata permits.

Acceptance:

A user cannot unknowingly run a long Sleev-routed session with native compaction firing repeatedly without seeing a warning.

---

# 42. Phase 4 — Web UI

Target version: `0.4.x`

Features:

- Sleev tab/settings surface;
- health status;
- route list;
- per-session summary;
- recent request metrics;
- conflict warning;
- no custom polling if session projections are available.

Acceptance:

A user can diagnose the integration without opening logs.

---

# 43. Phase 5 — `dsh-context` integration

Target version: `0.5.x`

Two parallel deliverables:

### In `dsh-sleev`

- stable type-only telemetry export;
- stable session projection schema.

### Optional PR to `dsh-context`

- detect the optional projection;
- show logical vs effective context;
- show external optimizer badge;
- preserve native compaction markers as native-only.

Acceptance:

Without `dsh-sleev`, `dsh-context` behaves exactly as before.

Without `dsh-context`, `dsh-sleev` remains fully functional.

---

# 44. Phase 6 — Hardening / v1

Target version: `1.0.0`

Requirements:

- compatibility matrix;
- integration tests against supported DSH version(s);
- route doctor;
- stable error codes;
- documented upgrade path;
- security review;
- bounded memory verified;
- robust retry accounting;
- graceful missing-token-meter behavior;
- remote gateway warning;
- release automation;
- troubleshooting guide.

Only after this should the project call itself stable.

---

# 45. Possible post-v1 work

## 45.1 Cost analytics

Per-provider price catalog and session cost deltas.

## 45.2 Explicit direct fallback

Opt-in route fallback with visible telemetry.

## 45.3 Optimizer SPI

If a second external optimizer is implemented, extract:

```ts
ContextOptimizerAdapter
OptimizerHealth
ExternalOptimizationSnapshot
```

into a stable public contract.

## 45.4 Global analytics

A separate aggregate dashboard across sessions:

- total logical input;
- total effective input;
- estimated reduced tokens;
- estimated spend delta;
- provider/model breakdown.

This should probably be a separate plugin or service instead of bloating `dsh-sleev`.

## 45.5 A/B mode

Make direct and Sleev aliases easy to compare across otherwise equivalent sessions.

---

# 46. Roadmap summary

```text
0.0.x  Spike
       └─ prove DSH -> Sleev -> provider

0.1.x  Routing
       └─ explicit optimized provider aliases

0.2.x  Observability
       └─ llm/stream + usage + token-meter comparison

0.3.x  Safety
       └─ native compaction conflict detection

0.4.x  UI
       └─ gateway/routes/session metrics

0.5.x  dsh-context integration
       └─ optional external-optimizer telemetry

1.0.0  Stable
       └─ tests, compatibility, diagnostics, security
```

---

# 47. Suggested first implementation milestone

The first coding milestone should be deliberately small.

## Milestone M1

Create an installable `dsh-sleev` package that:

1. loads successfully as a DSH bundle;
2. injects only `llm` initially;
3. registers a transparent `llm/stream` observer;
4. detects requests whose provider name starts with a configured optimized-route set;
5. logs request classification and provider usage;
6. does not modify any request or chunk;
7. ships a sample `llm-pi-ai` Sleev route configuration.

No React yet.

No persistence yet.

No automatic config mutation.

No cost model yet.

If M1 is boring and reliable, the rest of the project has a good foundation.

---

# 48. Suggested TypeScript skeleton

```ts
// src/host/plugin.ts

import type { Context } from '@deepseek-ai/cordis'
import {
  isAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

export const name = 'dsh-sleev'
export const inject = ['llm']

export function apply(ctx: Context, config: Config): void {
  const service = new SleevIntegrationService(ctx, config)

  ctx.on('llm/stream', function (
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ) {
    const classification = classifyRequest(options)

    if (!service.shouldObserve(options, classification)) {
      return next()
    }

    const handle = service.beginCall({
      options,
      classification,
    })

    return observe(handle, next())
  })
}
```

```ts
async function* observe(
  handle: CallHandle,
  downstream: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  try {
    for await (const chunk of downstream) {
      if (chunk.type === 'usage') {
        handle.observeUsage(chunk.usage)
      }

      if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'aborted') handle.abort()
        else if (chunk.reason.kind === 'error') handle.fail(chunk.reason.failure)
        else handle.succeed()
      }

      yield chunk
    }
  } catch (error) {
    handle.fail(error)
    throw error
  }
}
```

The final implementation must be validated against current Cordis waterfall semantics and DSH disposal behavior, but this is the desired shape.

---

# 49. Open questions to resolve before implementation

These should be treated as Phase 0 tasks, not guessed.

## Sleev

1. What exact `sleev-harness` value should DeepSeek Harness use?
2. Does Sleev need a known harness identifier to enable optimization?
3. What routing headers are currently stable/public?
4. How is a custom upstream base URL expressed?
5. Which provider wire protocols are supported?
6. Does Sleev preserve upstream token-usage fields exactly?
7. Does Sleev expose pre/post optimization token counts?
8. Is there a supported health/version endpoint?
9. Can the gateway expose optimizer-specific request IDs?
10. Are there headers we can safely use for correlation?

## DSH

1. What is the cleanest same-boundary `ctx.tokenMeter` call from `llm/stream`?
2. Should the projection be plugin-local or use a standard session-projection unit?
3. Can we reliably determine whether a native compaction was automatic vs manual?
4. What is the supported settings API for creating/updating `llm-pi-ai` routes programmatically?
5. Can a plugin add UI into the model/settings surface cleanly, or should it own a separate tab?
6. What DSH version range should the first release support?

---

# 50. Decision log

## ADR-001 — External gateway instead of custom compressor

**Decision:** use Sleev as an external gateway.

**Reason:** avoids duplicating compression logic and preserves DSH session semantics.

## ADR-002 — Do not rewrite `GenerateOptions`

**Decision:** observe only.

**Reason:** preserves DSH's reconstructable request invariant.

## ADR-003 — Explicit route aliases first

**Decision:** `sleev-*` routes for MVP.

**Reason:** safest rollback and clearest debugging.

## ADR-004 — Fail closed

**Decision:** no silent direct-provider fallback in MVP.

**Reason:** predictable routing, cost and privacy behavior.

## ADR-005 — Keep native and external optimization distinct

**Decision:** do not emit fake compaction events.

**Reason:** they represent different layers and semantics.

## ADR-006 — Optional `dsh-context` integration

**Decision:** integrate through telemetry/projection contracts only.

**Reason:** avoid plugin-to-plugin implementation coupling.

## ADR-007 — Single package initially

**Decision:** layered source tree instead of monorepo.

**Reason:** lower maintenance cost while retaining architectural boundaries.

---

# 51. Definition of Done for v1.0

`dsh-sleev` v1 is done when:

- [ ] installation is one normal DSH plugin operation;
- [ ] at least the documented supported provider protocols route through Sleev;
- [ ] direct provider routes can coexist with optimized routes;
- [ ] main requests are classified correctly;
- [ ] auxiliary requests are accounted separately;
- [ ] provider usage is captured without modifying streams;
- [ ] logical/effective context metrics are clearly distinguished;
- [ ] native compaction conflicts are visible;
- [ ] no secrets are stored in telemetry;
- [ ] the plugin has a useful Web UI;
- [ ] missing optional DSH services degrade gracefully;
- [ ] HMR/plugin unload leaves no listeners/timers behind;
- [ ] compatibility is tested against declared DSH versions;
- [ ] documentation contains a working setup and troubleshooting guide;
- [ ] `dsh-context` integration is optional and loosely coupled;
- [ ] all derived savings numbers are labeled according to their confidence;
- [ ] a long real agent session demonstrates measurable reduction through Sleev.

---

# 52. Recommended next action

Do **not** start with the dashboard.

Start with the compatibility spike:

```text
DeepSeek Harness
   ↓
llm-pi-ai route
   ↓
Sleev
   ↓
one real provider
```

Once one real request with tools, streaming and usage is proven, implement the transparent `llm/stream` observer and capture:

```text
logical estimate -> provider effective input
```

That gives us the central primitive around which every later feature — UI, `dsh-context`, conflict detection and cost analytics — can be built.

---

# 53. Source references used for this draft

The implementation should re-check these sources at development time because DeepSeek Harness is moving quickly.

- DeepSeek Harness architecture  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md

- DSH LLM service / `llm/stream` waterfall  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/README.md

- DSH LLM streaming subsystem  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md

- DSH `llm-pi-ai` adapter  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md

- DSH token meter  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/token-meter/README.md

- DSH compaction capability  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/README.md

- DSH basic compaction backend  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md

- `dsh-context`  
  https://github.com/bowenliang123/dsh-context

- Sleev  
  https://sleev.ai/

---

**End of initial specification.**
