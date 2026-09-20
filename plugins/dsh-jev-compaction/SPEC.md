# dsh-jev-compaction — SPEC & Implementation Plan

**Status:** Implemented — v0.1.0 scope (Phase 0 findings in `docs/compatibility.md`)  
**Date:** 2026-09-19  
**Target:** DeepSeek Harness (DSH)  
**Proposed package/repository name:** `dsh-jev-compaction`  
**Primary goal:** replay-safe semantic pruning of stale tool results using a Jev/System-One decision backend before ordinary DSH summary compaction is needed.

---

## 1. Executive summary

`dsh-jev-compaction` is a DeepSeek Harness plugin that uses a Jev/System-One
decision model (TypeSafe hosted Jev, or a self-hosted compatible backend such
as Jeff) to decide which historical tool outputs still need to remain fully
visible in the model context.

The plugin is intentionally **not** a replacement for the DSH append-only session log and is **not** a full replacement for `dsh-compaction-basic` in v1.

Instead, it acts as an asynchronous semantic pruning layer:

1. DSH approaches configurable context pressure.
2. The plugin inspects the current replayed session surface.
3. User/system/assistant text and recent context are pinned.
4. Older `tool/result` surface nodes become pruning candidates.
5. Jev scores whether each candidate still needs its full content.
6. A local safety policy validates the decisions.
7. Selected `tool/result` nodes are replaced by replay-safe shortened versions using DSH single-node `surfaceOp: replace`.
8. The original full-fidelity events remain in the append-only session log.
9. DSH remeasures context normally.
10. If pruning was insufficient, the existing `dsh-compaction-basic` summary compaction remains the fallback.

The core principle is:

> **Selective forgetting before lossy summarization.**

The plugin should preserve exact conversational instructions while preferentially removing stale, superseded, duplicated, or cheaply reproducible tool output.

---

## 2. Motivation

Traditional context compaction normally summarizes older history with an LLM. That is useful, but a generated summary can accidentally lose exact details such as:

- file paths;
- exact error messages;
- commands;
- user constraints;
- configuration values;
- identifiers;
- tool-derived evidence;
- previous decisions that later become relevant.

The project `tamaratran/fast-jev-compaction` demonstrated another approach for Claude Code: retain text verbatim and use Jev to score tool calls/results for selective removal or truncation.

DSH has a particularly useful architecture for adapting this idea:

- the durable session log is append-only;
- the model-visible **surface** is a replayed projection;
- current surface nodes can be shadowed through replay-safe replacements;
- full original tool results can remain in history even when the visible result is shortened;
- `ctx.tokenMeter` can remeasure the resulting context;
- `dsh-compaction-basic` can remain the final fallback.

This enables a safer DSH-native design than destructive transcript mutation.

---

## 3. Goals

### 3.1 Primary goals

The v1 plugin MUST:

- reduce model-visible context by pruning stale historical tool results;
- use Jev as a semantic decision engine;
- preserve the original durable DSH session events;
- preserve system, user, and assistant conversational text;
- avoid rewriting `assistant/message` in v1;
- mutate only eligible `tool/result` surface nodes;
- maintain DSH tool/result and surface invariants;
- be fail-open;
- cooperate with `dsh-compaction-basic`;
- support automatic pressure-triggered pruning;
- support a manual command;
- support a dry-run mode;
- expose useful diagnostics and savings statistics;
- work without modifying DeepSeek Harness core.

### 3.2 Secondary goals

The implementation SHOULD:

- recognize obviously superseded results deterministically;
- distinguish expensive-to-reproduce from cheap-to-reproduce results;
- use DSH token measurement instead of relying only on character heuristics;
- minimize Jev state size and request count;
- allow future support for different decision backends;
- isolate DSH-version compatibility code;
- provide enough telemetry to tune thresholds safely.

### 3.3 Success definition

A successful v1 should make long coding-agent sessions survive materially longer before summary compaction while preserving user/assistant text verbatim and without making the session log unreplayable.

---

## 4. Non-goals for v1

The first release MUST NOT attempt to:

- delete events from the durable DSH session log;
- rewrite arbitrary `assistant/message` events;
- delete historical tool calls from assistant provider output;
- implement an entirely new `CompactionEngine`;
- replace DSH's canonical overflow recovery;
- summarize user or assistant messages with Jev;
- use Jev as an authority that can override deterministic safety rules;
- compact image/binary content beyond what DSH already supports;
- automatically expand permissions or tool authority;
- require a fork of DeepSeek Harness;
- depend on patching generated DSH files after every update.

These may be evaluated in later versions.

---

## 5. Key design decisions

### 5.1 Prune the surface, never the durable source

DSH sessions are append-only. The plugin should preserve this property.

When a historical tool result is pruned, the original event stays in the log. The plugin appends a new `tool/result` event that replaces exactly one current surface node.

Conceptually:

```text
durable log

seq 120: tool/result   <full original, remains forever>
...
seq 310: tool/result   <short replacement, shadows seq 120>
```

Model-visible surface:

```text
seq 310 only
```

Inspection/replay retains access to seq 120.

### 5.2 v1 rewrites `tool/result` only

Do not rewrite `assistant/message` in v1.

Reasons:

- assistant messages can embed provider-native streams/tool call structure;
- DSH provenance rules differ for assistant messages;
- pairing and provider serialization invariants are easier to preserve when the call stays present;
- single-node `tool/result` replacement matches an existing DSH compaction pattern;
- the risk of creating an unreplayable session is substantially lower.

### 5.3 Jev proposes; local policy disposes

Jev output MUST be treated as an input to a deterministic local policy.

Jev must never directly mutate the session.

Pipeline:

```text
candidate collection
        ↓
deterministic features / pins
        ↓
Jev scoring
        ↓
response validation
        ↓
local safety policy
        ↓
mutation plan
        ↓
revalidate surface generation
        ↓
apply replacements
```

### 5.4 Fail open

If Jev, networking, parsing, fitting, compatibility validation, cancellation, or session mutation fails:

- do not perform speculative pruning;
- preserve the session;
- allow downstream DSH behavior to continue;
- leave ordinary DSH compaction as fallback.

The plugin should prefer "no savings" over "corrupt or misleading context".

---

## 6. Relevant DSH architecture

The implementation should be built around public/capability-style DSH seams where possible.

Important concepts:

### 6.1 `agent/pre-step`

DSH runs an asynchronous `agent/pre-step` waterfall before a proposed step is admitted.

This is suitable for calling Jev because it is asynchronous.

The plugin should register a pre-step listener that:

1. checks whether automatic pruning should run;
2. performs pruning before calling downstream `next()`;
3. always respects the provided `AbortSignal`;
4. calls `next()` unless it intentionally rejects the step, which this plugin normally should not do.

The plugin SHOULD register with `{ prepend: true }` so that semantic pruning runs before ordinary compaction listeners registered earlier. Composition order must still be documented and tested.

### 6.2 `ctx.tokenMeter`

Use DSH token measurement to determine whether pruning is needed and whether it helped.

The plugin should not base the primary pressure decision on `characters / 4`.

Character/token heuristics may be used only for Jev request fitting where an exact Jev tokenizer is unavailable.

### 6.3 Session surface replacement

DSH surface nodes can be replaced while original events remain in the log.

For a pruned tool result, append a replacement `tool/result` with:

- the same logical tool result data;
- only text `content` modified;
- a single-node `surfaceOp: { op: 'replace', startSeq, endSeq }`;
- provenance/source coverage required by the current DSH session contract.

The compatibility adapter must use the field names required by the supported DSH version.

### 6.4 Built-in compaction

`dsh-compaction-basic` already owns:

- pressure policy;
- summary compaction;
- canonical context-overflow recovery;
- compaction failure handling.

`dsh-jev-compaction` should complement it.

Expected normal sequence:

```text
agent/pre-step
    │
    ├─ dsh-jev-compaction
    │     ├─ pressure check
    │     ├─ Jev scoring
    │     ├─ safe tool/result replacements
    │     └─ remeasure
    │
    └─ dsh-compaction-basic
          ├─ pressure check
          ├─ optional deterministic pruner
          └─ summary only if still necessary
```

### 6.5 Existing deterministic tool-result pruner

DSH ships a model-free tool-result pruner that trims oversized outputs with deterministic head/middle/tail logic.

`dsh-jev-compaction` should be compatible with it.

Possible compositions:

```text
A. Jev first → built-in deterministic pruner → summary
B. deterministic pruner first → Jev → summary
```

For v1, prefer **Jev first** if listener ordering allows it, because Jev can preserve semantically valuable large results while pruning irrelevant smaller ones.

If compatibility or ordering proves unreliable, document a supported composition and make tests enforce it.

### 6.6 Deployment modes: `companion` (shipped) and `backend` (target)

Compaction in DSH is a capability seam, and the harness explicitly invites
alternative backends. Verified against the pinned sources (0.1.5-rc.2):

- `CompactionEngine extends Service` registers under the service name
  `compaction` (`packages/compaction/compaction/src/index.ts`); the package
  README documents mounting a backend by profile row
  (`- name: '@deepseek-ai/dsh-compaction-basic'`) and names "a backend with a
  different summarizer" as the intended extension.
- `dsh-command-compact` declares `inject = ['commands', 'compaction']` — it
  depends on the seam, not on `dsh-compaction-basic`. `/compact` keeps working
  unchanged when a different engine provides `ctx.compaction`.
- Shipped basic defaults: `thresholdRatio = 0.8`, `retainRatio = 0.16`. The
  optional deterministic pruner runs only AFTER the threshold is already
  reached, and the LLM summary runs only if a remeasure is still above it —
  so below 80% nothing prunes tool results today. Semantic GC that starts
  earlier is genuine headroom, not a duplicate.
- The `ctx.toolResultPruner` seam is synchronous
  (`pruneSession(session): PruneResult`); an asynchronous Jev decision cannot
  ride it. Jev can therefore either sit before the threshold decision
  (companion) or own the engine (backend) — there is no third "drop-in async
  pruner" path.

Consequences for this plugin:

**`companion` mode — shipped 0.1.0.** Own prepended `agent/pre-step` listener;
`dsh-compaction-basic` stays mounted and remains the summary fallback. Lowest
risk, no compaction contract to honor; cost: two pressure policies and an
ordering relationship to maintain.

**`backend` mode — target architecture (0.2+).** The package provides
`ctx.compaction` by subclassing `CompactionEngine` and must honor the full
contract:

- `compactIfNeeded(trigger)` — Jev prune first at an early semantic threshold,
  remeasure, conventional summary fallback only above a second, higher
  threshold:

  ```yaml
  trigger:
    jevPruneRatio: 0.65 # semantic GC starts here
    summaryRatio: 0.82  # conventional summary only above this
  ```

- `compactNow()` / `compactRegion()` — manual and programmatic entry points.
  Manual summary compaction may run in the idle phase (like basic's
  `compactNow`); manual *tool-result* pruning remains bound by the open-turn
  invariant, so the §21.0 arming design carries over to backend mode.
- **Overflow recovery is not part of the base contract.** The
  `agent/request-error` context-overflow listener is registered by
  `dsh-compaction-basic` itself; a replacement engine must re-implement it.
- The compaction event protocol (`compaction/start` … `compaction/summary` …
  `compaction/end` brackets), `ManualCompactionError` failure classes,
  balanced range selection and surface-stability checks (basic's region
  machinery; the seam package exports the tool-pairing and checkpoint
  building blocks).
- New peer dependency `@deepseek-ai/dsh-compaction` (catalog additions) and an
  updated `requiredHostFeatures`.

**`mode` cannot be runtime config.** The profile loader imports the package
and composes its default export; the service name is fixed at class
construction (`'jevCompaction'` for the companion service, `'compaction'` for
an engine), and mounting both engines simultaneously collides on the
`compaction` service name. Mode therefore selects the composition entry, by
one of two mechanics to be decided by a small compatibility spike before
implementation: a subpath export (e.g. `@yadsh/dsh-jev-compaction/backend`)
mounted as its own profile row, or a second package over a shared workspace
core (plugin-to-plugin dependencies are forbidden by `pnpm deps:check`).

---

## 7. High-level architecture

```text
┌───────────────────────────────────────────────┐
│                 DSH Agent                     │
└───────────────────────┬───────────────────────┘
                        │
                  agent/pre-step
                        │
                        ▼
┌───────────────────────────────────────────────┐
│           Auto Trigger / Token Meter          │
│ pressure? cooldown? enough candidates?        │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│             Candidate Collector               │
│ current surface → old tool/result candidates  │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│          Deterministic Feature Layer          │
│ recency, superseded, error, path, cost, etc.  │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│                Jev State Builder              │
│ bounded semantic representation of history   │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│                   Jev Client                  │
│ batching + timeout + validation + cancellation│
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│              Safety Policy Engine             │
│ pins + thresholds + minimum savings           │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│              Mutation Plan Builder            │
│ FULL / STUB / TRUNCATE / NO-OP                │
└───────────────────────┬───────────────────────┘
                        │
                 surface revalidation
                        │
                        ▼
┌───────────────────────────────────────────────┐
│            Replay-safe Surface Writer         │
│ append single-node tool/result replacements   │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
                 token remeasure
                        │
                        ▼
                 downstream next()
                        │
                        ▼
             dsh-compaction-basic
```

---

## 8. Automatic trigger policy

The plugin should not call Jev on every step.

Recommended v1 trigger conditions:

```text
enabled
AND not already running for session
AND cooldown elapsed
AND pressure ratio >= trigger.contextRatio
AND surface tokens >= trigger.minSurfaceTokens
AND eligible candidate count >= trigger.minCandidates
AND candidate text chars >= trigger.minCandidateChars
```

Suggested defaults:

```yaml
trigger:
  contextRatio: 0.70
  minSurfaceTokens: 32000
  minCandidates: 4
  minCandidateChars: 8000
  cooldownTurns: 3
```

The exact pressure representation depends on the current `ctx.tokenMeter` API and model route. The compatibility layer should expose:

```ts
interface PressureSnapshot {
  estimatedSurfaceTokens: number
  contextWindow?: number
  ratio?: number
}
```

If context-window capacity cannot be resolved safely, auto mode may fall back to `minSurfaceTokens` rather than guessing.

---

## 9. Candidate collection

Only current model-visible `tool/result` surface nodes are candidates.

### 9.1 Always pinned in v1

Never prune:

- system messages;
- user messages;
- assistant messages;
- results in the newest configured messages/steps;
- results in an active/open step;
- unresolved or structurally ambiguous call/result pairs;
- replacement nodes that cannot be traced safely;
- content whose DSH shape is not understood by the compatibility adapter.

### 9.2 Candidate model

Internal normalized candidate:

```ts
interface ToolResultCandidate {
  surfaceSeq: number
  callId: string
  toolName?: string

  turn?: number | null
  step?: number | null

  originalText: string
  originalChars: number

  isError: boolean
  ageTurns?: number
  ageSteps?: number

  toolArgumentsPreview?: string

  // Deterministic signals
  superseded: boolean
  duplicateLike: boolean
  rerunnable: 'cheap' | 'moderate' | 'expensive' | 'unknown'
  containsLikelyExactEvidence: boolean

  // Optional extracted hints
  paths?: string[]
  command?: string
  exitCode?: number
}
```

The normalized model must not leak DSH-version-specific event shapes into planner modules.

---

## 10. Deterministic feature extraction

Jev should not be forced to infer everything from raw history.

The plugin should derive cheap local features where possible.

Examples:

### 10.1 Superseded file reads

If:

```text
Read src/a.ts @ turn 4
Read src/a.ts @ turn 18
```

the older read is likely superseded.

Stronger signal:

```text
Read src/a.ts @ turn 4
Edit src/a.ts @ turn 10
Read src/a.ts @ turn 18
```

The result from turn 4 is strongly stale.

This MUST remain a signal, not an unconditional deletion rule in the initial release.

### 10.2 Duplicate searches

Repeated grep/search calls with equivalent query/path combinations can mark older results `duplicateLike = true`.

### 10.3 Test/build outputs

Older successful test output is usually cheaper to re-run than:

- an expensive external query;
- a non-deterministic remote API response;
- unique diagnostic evidence.

Errors should receive stronger preservation bias.

### 10.4 Exact-evidence hints

The feature layer may detect likely high-value content:

- stack traces;
- compiler errors;
- hashes;
- URLs;
- issue IDs;
- migration IDs;
- generated plans;
- unique external data.

Detection should only influence preservation bias.

---

## 11. Jev state representation

The state should represent the conversation sufficiently for Jev to judge relevance without sending every historical tool output in full.

Conceptual format:

```text
SESSION STATE

[user t1]
Fix failing auth tests.
Never modify migrations.

[assistant t1]
I'll inspect the auth implementation and tests.

[tool t1/c1]
id=t1
name=read
args={"path":"src/auth.ts"}
result=ok, 14382 chars omitted
features=age:18 turns; superseded:true; rerunnable:cheap

[tool t1/c2]
id=t2
name=test
args={"command":"pnpm test auth"}
result=error, 8221 chars omitted
features=age:17 turns; isError:true; rerunnable:moderate

...

[recent user]
The failure is only on refresh-token rotation.
```

Important properties:

- user and assistant textual intent remains represented;
- full historical tool outputs are not copied into state by default;
- candidate IDs are stable within the request;
- deterministic signals are explicit;
- recent task context is favored;
- state fitting must be deterministic and testable.

---

## 12. Jev questions

v1 SHOULD ask at least one semantic preservation question per candidate.

Recommended primary question:

```text
Does the agent still need the substantive contents of tool result {candidateId}
to correctly continue the user's current task?
```

A second question may be used to distinguish full preservation from shortened preservation:

```text
Does tool result {candidateId} need to remain substantially verbatim,
rather than being replaced by a short replay marker describing the tool
and the fact that its old output was pruned?
```

Optional future dimension:

```text
Would re-running the original tool be an acceptable way to recover the
information if it becomes needed again?
```

Do not overcomplicate v1 with many correlated questions until empirical evaluation proves value.

---

## 13. Decision model

Recommended internal result:

```ts
interface JevCandidateDecision {
  candidateId: string
  needContents: number
  needVerbatim?: number
}
```

Local policy converts probability into an action.

Example:

```text
PINNED / unsafe to mutate
    → KEEP_FULL

needContents >= fullThreshold
    → KEEP_FULL

needContents >= truncateThreshold
    → KEEP_TRUNCATED

otherwise
    → KEEP_STUB
```

Suggested initial thresholds:

```yaml
decisions:
  fullThreshold: 0.70
  truncateThreshold: 0.45
```

Do not blindly copy the original project threshold. Tune with DSH replay fixtures.

---

## 14. Mutation modes

### 14.1 `KEEP_FULL`

No mutation.

### 14.2 `KEEP_TRUNCATED`

Preserve a bounded head and optional tail plus a marker.

Example:

```text
[first 384 chars]

… [dsh-jev-compaction pruned 12,910 historical characters] …

[last 128 chars]
```

This is useful for:

- command outputs;
- logs;
- search results where rough identity still matters.

### 14.3 `KEEP_STUB`

Replace textual result content with a small semantic/replay marker.

Example:

```text
[dsh-jev-compaction]
Historical tool output pruned from active model context.
tool=read
originalChars=14382
reason=low semantic retention score
original event remains available in the session log.
```

Do NOT claim that Jev proved the result is irrelevant.

Prefer neutral wording such as "pruned from active model context".

### 14.4 No physical tool-call deletion in v1

Even at extremely low score, retain the tool call and a corresponding tool result stub.

This protects tool/result pairing and provider serialization.

---

## 15. Preserving non-text blocks

A tool result may contain rich/non-text blocks.

v1 policy:

- modify text blocks only;
- preserve non-text blocks and their order unless DSH's own image-offload mechanism already transformed them;
- never silently drop unknown block types;
- if a block schema is unknown, pin the entire result.

When reconstructing the replacement result, copy all existing result metadata and modify only intended textual content.

---

## 16. Surface mutation algorithm

Pseudo-code:

```ts
async function applyPlan(session, plan, snapshot) {
  assertSurfaceStillMatches(snapshot)

  for (const item of plan.items) {
    if (item.action === 'KEEP_FULL') continue

    const current = resolveCurrentSurfaceNode(item.originalSeq)

    if (!current) throw new SurfaceChangedError()
    if (current.type !== 'tool/result') throw new InvariantError()

    const replacementData = {
      ...current.data,
      message: replaceToolResultText(
        current.data.message,
        renderReplacement(item),
      ),
    }

    session.append(
      'tool/result',
      replacementData,
      makeSingleNodeReplacementIntent(current),
    )
  }
}
```

Exact APIs must be hidden behind `src/dsh/compat.ts`.

### 16.1 Mutation ordering

Apply replacements in the snapshotted surface order.

### 16.2 Partial failure

The DSH log is append-only, so already-landed replacements may be durable if a later replacement fails.

Therefore:

- validate all planned mutations before the first append;
- revalidate surface generation immediately before applying;
- make each replacement independently valid;
- log partial completion clearly;
- do not attempt unsafe rollback by rewriting history.

---

## 17. Concurrency and race handling

This is a critical area.

### 17.1 Per-session mutex

Only one Jev compaction operation may run per session at a time.

```ts
Map<SessionId, Promise/Mutex>
```

Manual and automatic runs share the same lock.

### 17.2 Snapshot identity

Before calling Jev, capture enough state to detect drift:

- session identity;
- surface replacement generation, if accessible;
- ordered candidate seqs;
- latest surface tail seq;
- token measurement revision if exposed.

After Jev returns, revalidate.

If the relevant surface changed:

```text
discard plan
do not apply stale decisions
continue normally
```

Optionally retry once only for manual mode. Automatic mode should usually skip and wait for the next step.

### 17.3 Cancellation

Forward the `agent/pre-step` `AbortSignal` through:

- Jev HTTP request;
- batching;
- waiting on concurrency;
- long local processing where practical.

Cancellation must not be converted into a successful prune.

---

## 18. Decision backends (System One)

Create an internal backend interface. The name is deliberately provider-neutral:
TypeSafe's hosted Jev, the self-hosted Jeff server, and other System
One-compatible endpoints all speak conceptually the same scoring contract.

```ts
interface SystemOneBackend {
  decide(
    state: string,
    questions: DecisionQuestion[],
    signal?: AbortSignal,
  ): Promise<JevCandidateDecision[]>
}
```

Implementations:

```ts
class SystemOneClient implements SystemOneBackend {} // wire client shared by all presets
// provider presets over the same client:
//   typesafe — https://api.typesafe.ai/v1/systemone (hosted Jev)
//   jeff     — self-hosted, e.g. http://jeff:8000 (logan-markewich/jeff)
//   custom   — any System One-compatible endpoint (e.g. daseinlabs/open-jev)
```

TypeSafe hosted Jev cannot currently be self-hosted (closed weights, hosted
early-access API). Jeff is a drop-in self-hosted System One implementation over
GLiFormer Large (~400M parameters) that serves the same API surface and accepts
the `jev-latest` model alias; it trades some accuracy (reasoning-heavy tasks are
noticeably weaker than hosted Jev) for locality, privacy, and free evals. A
`custom` preset covers other compatible implementations such as open-jev
(Gemma-3-based; probabilities are not calibrated to Jev without additional
training). Backend choice does not change the planner: switching is config-only.

Benefits:

- unit tests use a fake backend;
- self-hosted backends enable thousands of local evaluation runs before a
  hosted-Jev comparison pass on the same corpus;
- transport code stays separate from DSH integration.

### 18.1 Authentication

Per-provider environment variable references (the config stores the NAME of the
environment variable, never the key):

```text
typesafe → TYPESAFE_API_KEY
jeff     → JEFF_API_KEY
custom   → configured explicitly
```

Do not store raw API keys in logs.

If DSH provides a stable credential-reference seam suitable for third-party plugins, add optional integration later.

### 18.2 Timeouts

Suggested default:

```yaml
jev:
  timeoutMs: 2500
```

Automatic compaction is latency-sensitive.

Manual `/jev-compact` may optionally allow a longer timeout.

### 18.3 Retries

v1 should use either:

- no retry; or
- one retry for network/5xx only with tight overall deadline.

Never retry malformed semantic responses indefinitely.

### 18.4 Response validation

Reject:

- missing candidate keys;
- duplicate candidate keys;
- probabilities outside `[0, 1]`;
- `NaN`;
- non-numeric probabilities;
- unknown result shape;
- partial response unless explicitly allowed by policy.

Default: any malformed batch makes that batch fail safe.

---

## 19. Jev state fitting and batching

The request builder must respect Jev request limits without turning fitting into a second summarizer.

Progressive fitting strategy:

1. full conversational text + compact tool metadata;
2. truncate long tool argument previews;
3. reduce older assistant/user text to bounded head/tail only if needed;
4. collapse old tool metadata into one-line records;
5. omit oldest non-critical metadata blocks;
6. fail open if a safe state cannot fit.

Do not delete recent user constraints merely to fit Jev.

Questions should be batched when necessary.

Batch requests MAY run concurrently with a configurable cap.

Suggested:

```yaml
jev:
  maxConcurrency: 4

state:
  maxStateTokens: 25000
  maxRequestTokens: 30000
  toolInputChars: 1000
  resultPreviewChars: 300
```

These are implementation defaults, not API guarantees. Verify against current Jev documentation during implementation.

---

## 20. Minimum savings gate

Do not rewrite dozens of events to save trivial context.

After decisions are computed, estimate expected savings.

Example:

```yaml
pruning:
  minSavingsChars: 8000
  minSavingsRatio: 0.05
```

Apply only if either/both configured thresholds are satisfied.

For automatic mode:

```text
too little expected savings
→ no mutation
→ downstream built-in compaction proceeds normally
```

Manual dry-run should still show the plan.

---

## 21. Manual commands

### 21.0 Why `/jev-compact` arms instead of mutating inline

The harness session invariant classifies a `tool/result` surface replacement as
durable turn work: appending one outside an open turn is rejected at the
session boundary, and turn numbering is loop-owned (a plugin that fabricated a
turn would desynchronize the driver's counter and corrupt later turns).
Manual compaction that replaces `user/message` summary checkpoints is exempt
from that rule, which is why the built-in `/compact` can run while the agent is
idle — but `tool/result` pruning cannot.

Therefore the manual command scores and builds the plan at command time (with
the longer manual timeout), then **arms** it: the prepended `agent/pre-step`
listener applies the armed plan before the next model step of that session,
inside the open turn, after full surface revalidation (§17.2). If the surface
changes before it can apply, the stale plan items are dropped exactly like a
stale automatic plan. `/jev-compact --dry-run` remains purely read-only.

### 21.1 `/jev-compact`

Score now, apply before the next model step of this session, independent of
automatic pressure thresholds and cooldown.

Expected output:

```text
Jev compaction armed

Candidates:   64
Full kept:    13
Truncated:    17
Stubbed:      34

Estimated visible text reduction: 182,450 chars
Estimated token reduction: 35,200

The plan will be applied before the next model step in this session
(or when the next message is sent). It is discarded if the history
changes first. Run /jev-compact --dry-run to preview without arming.
```

After the armed plan lands, the plugin log records the same before/after
statistics the automatic path emits. The command itself does not create a user
model message and does not wake the agent.

### 21.2 `/jev-compact --dry-run`

Never mutate session.

Example:

```text
Jev compaction dry-run

Candidates: 64
Would keep full: 13
Would truncate: 17
Would stub: 34

Estimated visible text reduction: 182,450 chars
Estimated token reduction: 35,200

Highest-confidence stub candidates:
- read src/old-config.ts      0.06
- grep refreshToken          0.09
- pnpm test auth (old pass)  0.12

No changes were made.
```

### 21.3 Optional future commands

```text
/jev-compact --explain
/jev-compact --force
/jev-compact --last-plan
/jev-compact status
```

Do not include these in MVP unless implementation cost is negligible.

---

## 22. Configuration

Proposed shape:

```yaml
- id: jev-compaction
  name: dsh-jev-compaction
  config:
    enabled: true

    decision:
      provider: typesafe # typesafe | jeff | custom
      typesafe:
        baseUrl: https://api.typesafe.ai/v1/systemone
        apiKeyEnv: TYPESAFE_API_KEY
        model: jev-latest
      jeff:
        baseUrl: http://localhost:8000/v1/systemone
        apiKeyEnv: JEFF_API_KEY
        model: jev-latest
      custom:
        baseUrl: "" # required when provider: custom
        apiKeyEnv: ""
        model: jev-latest
      timeoutMs: 2500
      maxConcurrency: 4
      retries: 1

    trigger:
      contextRatio: 0.70
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

    fallback:
      continueOnFailure: true

    diagnostics:
      includeCandidateScores: false
```

### 22.1 Configuration safety

Validate at startup:

- thresholds in `[0,1]`;
- `truncateThreshold <= fullThreshold`;
- positive token/character budgets;
- reasonable concurrency;
- no secret included in normal config dump.

---

## 23. Recommended plugin lifecycle

Pseudo-skeleton:

```ts
export const name = 'dsh-jev-compaction'

export function apply(ctx: Context, config: Config) {
  const service = new JevCompactionService(ctx, config)

  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      try {
        await service.maybeCompact(payload.agent, {
          mode: 'auto',
          signal: payload.signal,
        })
      } catch (error) {
        service.reportFailure(error, 'auto')
      }

      return next()
    },
    { prepend: true },
  )

  ctx.commands.register({
    name: 'jev-compact',
    description: 'Prune stale tool output with Jev',
    input: { hint: '[--dry-run]' },
    handler: async ({ agent, rawInput, signal }) => {
      return service.runCommand(agent, rawInput, signal)
    },
  })
}
```

Exact command handler payload must be aligned with the currently installed DSH API.

---

## 24. Compatibility layer

DSH is actively evolving. Do not spread DSH event internals across the project.

Create:

```text
src/dsh/compat.ts
src/dsh/types.ts
src/dsh/surface.ts
src/dsh/meter.ts
```

Responsibilities:

- get current surface nodes;
- identify `tool/result`;
- extract normalized tool-result content;
- resolve related tool call metadata;
- obtain pressure/token measurement;
- capture a surface revision;
- detect whether snapshot is still valid;
- construct a legal single-node replacement;
- append replacement;
- expose current session/agent identifiers safely.

Everything outside `src/dsh/` should operate on normalized internal types.

### 24.1 Version support policy

README should state tested DSH versions.

Example:

```text
Tested:
- DSH 0.1.x current release line

Best-effort:
- newer alpha builds

Unsupported:
- session formats older than required surface replacement support
```

Do not claim semver compatibility unless CI verifies it.

---

## 25. Compatibility spike — Phase 0

Before full implementation, coding agent MUST verify against the actual target DSH version:

1. exact `agent/pre-step` listener signature;
2. whether `{ prepend: true }` gives desired ordering;
3. token-meter measurement API;
4. method for reading ordered current surface;
5. replacement-generation/revision API;
6. exact `Session.append()` shape;
7. exact `surfaceOp` field names;
8. source/provenance requirements for `tool/result`;
9. slash command handler signature;
10. whether built-in compaction runs after this listener as expected;
11. whether a single-node replaced tool result is re-priced correctly;
12. whether a session reloaded from JSONL/SQLite reproduces the same surface.

Output of the spike should be captured in project docs before implementing mutation code.

---

## 26. Relationship with `fast-jev-compaction`

Upstream inspiration:

- repository: `tamaratran/fast-jev-compaction`;
- license: MIT;
- core idea: Jev evaluates historical tool call/result retention while conversational text remains verbatim.

### 26.1 Attribution

README and/or NOTICE should explicitly credit the original project and author.

Suggested wording:

```text
Inspired by fast-jev-compaction by Tamara Tran:
https://github.com/tamaratran/fast-jev-compaction

The original project introduced the Jev-based selective tool-history
compaction approach for Claude Code. dsh-jev-compaction adapts that idea
to DeepSeek Harness' append-only session log and replayable surface model.
```

If code is copied or adapted, retain required MIT copyright/license notice.

### 26.2 Dependency strategy

Do NOT couple DSH surface mutation to upstream Claude transcript mutation.

Preferred architecture:

```text
fast-jev ideas / optional reusable Jev helpers
              │
              ▼
       internal Jev adapter
              │
              ▼
        DSH-native planner
              │
              ▼
    DSH-native surface writer
```

Phase 0 should evaluate whether to reuse exported upstream helpers such as request building, response parsing, state fitting, and batching.

If the upstream package proves unstable because it is very new, vendor/port only the minimal necessary Jev logic behind the internal backend interface and record the upstream commit hash in NOTICE.

### 26.3 Self-hosted System One backends

The decision backend is a first-class abstraction (§18), not a TypeSafe client
detail. Supported presets:

| Backend | Where | Locality | Notes for compaction |
|---|---|---|---|
| TypeSafe Jev | hosted early-access API | cloud | reference quality; closed weights |
| Jeff | self-hosted `/v1/systemone` (logan-markewich/jeff, GLiFormer ~400M) | local | near drop-in; weaker on reasoning-heavy scoring; ideal for bulk evals |
| custom | any System One-compatible endpoint (e.g. open-jev) | local | open-jev (Gemma 3) scores are not Jev-calibrated without extra training |

Deployment shape follows the standalone-service pattern: Jeff (or any
compatible backend) runs as its own Docker service next to Harness, and the
plugin reaches it over HTTP with `decision.provider: jeff` plus the endpoint
and key-variable name. No backend dependency ever enters the DSH process.

Recommended evaluation workflow: run the offline corpus (§33) against the
self-hosted backend for threshold tuning, then replay the identical corpus
against hosted Jev and compare dangerous-prune-rate curves. Local iteration is
free; hosted runs validate the shipped defaults.

---

## 27. Logging and observability

Useful structured events/logs:

```text
jev-compaction/check
jev-compaction/skip
jev-compaction/request
jev-compaction/plan
jev-compaction/applied
jev-compaction/fallback
jev-compaction/error
```

Suggested fields:

```ts
{
  sessionId,
  mode: 'auto' | 'manual' | 'dry-run',
  surfaceTokensBefore,
  surfaceTokensAfter,
  candidates,
  keptFull,
  truncated,
  stubbed,
  charsBefore,
  charsAfter,
  jevRequests,
  jevLatencyMs,
  totalLatencyMs,
  reason,
}
```

Never log:

- API key;
- entire Jev state by default;
- full tool outputs;
- sensitive tool arguments unless explicit debug mode is enabled.

Future: OpenTelemetry spans and metrics.

---

## 28. Optional durable diagnostic events

v1 may avoid adding custom durable session events to minimize compatibility risk.

If later needed, custom log-only events could record a compaction plan without entering the model surface.

Possible future types:

```text
jev-compaction/start
jev-compaction/end
jev-compaction/error
```

Do not give custom event types a `surfaceOp`.

Before adding any durable plugin event, verify DSH persistence/plugin event extension rules for the target version.

---

## 29. Failure handling

The plugin MUST define explicit behavior for each failure class.

| Failure | Automatic behavior | Manual behavior |
|---|---|---|
| API key missing | skip, warn once | error text |
| Jev timeout | skip | error text |
| Jev 5xx | skip | error text |
| invalid JSON/shape | skip | error text |
| probability invalid | skip affected run | error text |
| missing decision | skip affected run | error text |
| state cannot fit | skip | explain |
| token meter fails | skip | error text |
| surface changed while Jev ran | discard plan | report stale plan |
| cancellation | propagate/stop safely | cancelled |
| candidate invariant fails | pin candidate or abort plan | error |
| append replacement fails before any mutation | skip | error |
| append fails after partial mutation | stop; report partial durable changes | explicit partial result |

`continueOnFailure: true` means "continue the agent with unmodified or safely partially modified context", never "invent a fallback pruning decision".

---

## 30. Security and privacy

Using Jev sends a derived representation of session history to the configured
decision endpoint (hosted TypeSafe Jev or a self-hosted backend).

README MUST state this clearly.

Provide configuration to reduce exposed data:

```yaml
privacy:
  includeUserText: true
  includeAssistantText: true
  includeToolArguments: true
  textChars: 1000 # per-message user/assistant text budget
```

Tool argument previews are bounded separately by `state.toolInputChars`.

Future privacy mode may hash/redact known secret patterns, but secret detection must not be marketed as complete.

The plugin should honor DSH cancellation and should not send tool result bodies in full by default.

---

## 31. Performance requirements

Automatic compaction sits on the pre-step critical path.

Targets for ordinary runs:

- one semantic compaction operation per pressure event, not per step;
- bounded concurrency;
- no O(N²) full-log rescans where avoidable;
- no repeated serialization of full historical tool bodies;
- Jev call should dominate latency, not local processing.

Cache normalized candidate metadata for one operation only unless a safe revision-aware cache is implemented.

Avoid global unbounded per-session state.

---

## 32. Testing strategy

### 32.1 Unit tests

Test:

- config validation;
- candidate collection;
- recent-result pinning;
- error-result pinning;
- tool content extraction;
- feature extraction;
- state building;
- state fitting;
- batching;
- response validation;
- thresholds;
- minimum savings gate;
- replacement text rendering;
- fake Jev backend;
- cancellation;
- stale snapshot rejection.

### 32.2 Session invariant tests

Fixtures should cover:

```text
assistant tool call → tool result
multiple tool calls in one assistant message
error result
rich result blocks
replacement of an already-replaced result
compacted historical prefix
recent unpaired/ambiguous structures
system message at surface head
```

For every mutation fixture:

1. replay session before;
2. apply replacements;
3. replay session after;
4. derive messages;
5. ensure serialization/provider-facing history remains valid;
6. ensure original event remains in log;
7. reload persisted session;
8. confirm identical resulting surface.

### 32.3 Integration tests with built-in compaction

Test:

```text
Jev pruning relieves pressure
→ built-in summary is skipped

Jev pruning insufficient
→ built-in summary still runs

Jev fails
→ built-in compaction remains available

Jev makes partial safe replacements
→ meter remeasures new surface correctly
```

### 32.4 Fake backend by default

Unit/integration tests MUST NOT require TypeSafe credentials.

Provide a deterministic fake:

```ts
new FakeDecisionBackend({
  t1: { needContents: 0.9 },
  t2: { needContents: 0.1 },
})
```

### 32.5 Live smoke test

Separate opt-in command:

```bash
TYPESAFE_API_KEY=... pnpm test:live
```

It should use a synthetic session without secrets.

---

## 33. Evaluation corpus — executable plan

Before calling the plugin "safe", run it against an offline corpus of
synthetic DSH sessions. The corpus doubles as the threshold-tuning harness
and as the A/B baseline against `dsh-compaction-basic` (backend mode, §6.6).

### 33.1 Corpus format and location

```text
tests/eval/
├── corpus/
│   ├── <scenario-id>.session.json     # full SessionEvent[] fixture (seq-contiguous)
│   ├── <scenario-id>.labels.json      # per-candidate labels
│   └── MANIFEST.md                    # scenario table + intent notes
├── results/                           # gitignored run artifacts (§34 JSON)
└── run-eval.mjs                       # offline runner (no network by default)
```

- Sessions are built with the same event vocabulary as the unit fixtures
  (closed tool steps inside closed turns, optional open tail turn) and must
  replay through the real `Session` (`Session.create(id, events)`), fold
  cleanly, and pass `deriveMessages()` — a fixture that cannot replay is a
  corpus bug, not an eval result.
- Labels address candidates by `callId` and use exactly the three action
  grades the policy can emit:

```json
{
  "callId": "call-7",
  "label": "must-keep | safe-to-truncate | safe-to-stub",
  "why": "one-line rationale, synthetic content only"
}
```

### 33.2 Scenario matrix (minimum 12 sessions)

| # | Scenario id | Exercises | Danger axis |
|---|---|---|---|
| 1 | `reread-same-file` | repeated reads of one path | low |
| 2 | `edit-invalidates-read` | read → edit → old read stale | low |
| 3 | `edit-invalidates-many` | one edit invalidating N older reads | medium |
| 4 | `long-grep` | one huge search result, never cited again | low |
| 5 | `grep-cited-later` | search result referenced by later user text | high |
| 6 | `test-fail-then-fix` | failing run, later fixed, then green | low |
| 7 | `test-fail-investigating` | failing run still under investigation | high |
| 8 | `unique-api-response` | non-reproducible external response | high |
| 9 | `docs-lookup` | package docs query, generic content | low |
| 10 | `user-constraint-fanout` | explicit user constraint + many tools after | high |
| 11 | `long-shell-log` | verbose build log, identity matters (head/tail) | medium |
| 12 | `after-summary-checkpoint` | pruning on a surface that already has a compaction checkpoint | medium |

Scenario intent: every `high` row must contain at least one candidate whose
correct action is `must-keep` despite looking prune-worthy deterministically
(old, large, cheap-looking) — those are the rows that catch a dangerous prune.

Synthetic content only (repo leak rules): paths like `src/demo/auth.ts`,
hosts `api.example.corp`, ticket keys `PROJ-123`.

### 33.3 Runner and metrics

`run-eval.mjs` loads each session + labels, runs the real pipeline with a
scripted decision backend (label-derived probabilities, so runs are
deterministic and free), applies plans to a scratch `Session`, and scores:

```text
dangerousPruneRate  = labeled must-keep candidates with action ≠ KEEP_FULL
                      ÷ all labeled must-keep candidates     ← PRIMARY
fullKeepPrecision   = correctly-kept must-keep ÷ kept full
contextReduction    = Σ savedChars ÷ Σ candidateChars
summaryFallbackRate = runs where a (backend-mode) summary still fired
jevRequests / est. input tokens per run (from the state builder, no network)
latency budget      = local pipeline time excluding backend
```

Acceptance gates for shipping default thresholds:

- `dangerousPruneRate = 0` on the corpus (any hit blocks the release and
  forces a pin, threshold change, or feature fix — never a corpus edit);
- `contextReduction ≥ 0.55` averaged over scenarios 1–4, 9, 11;
- no run may regress `dangerousPruneRate` versus the previous released
  thresholds (baselines are checked in under `results/baseline.json`).

### 33.4 Threshold-tuning procedure

1. Sweep `decisions.fullThreshold` ∈ {0.5…0.9 step 0.05} ×
   `decisions.truncateThreshold` ∈ {0.3…0.6 step 0.05} with the scripted
   backend; keep the Pareto frontier of (`dangerousPruneRate`,
   `contextReduction`).
2. Pick the knee with `dangerousPruneRate = 0`; if no knee is safe, bias
   `fullThreshold` up (preserve more) — compression is not the goal (§47).
3. Replay the chosen thresholds against the hosted TypeSafe Jev and a local
   Jeff backend over the identical corpus; compare per-scenario deltas.
   Divergences larger than one grade on `high` rows are documented in
   `docs/evaluation.md` before defaults ship.
4. Re-run on every planner/features change; the corpus is the regression net
   for "smart" heuristics.

### 33.5 What the corpus deliberately does not cover

Live provider variance, secret-shaped content, and multi-session workspaces
are out of scope for the offline corpus; they belong to the rig smoke
(§38 Track A, phase A6) and to future privacy work (§30).

---

## 34. Dry-run UX as evaluation tooling

Dry-run is not merely a user feature. It is the main threshold-tuning mechanism.

Optionally support writing a JSON artifact in debug mode:

```json
{
  "sessionId": "...",
  "surfaceRevision": "...",
  "candidates": [
    {
      "id": "t12",
      "tool": "read",
      "chars": 14382,
      "score": 0.08,
      "action": "KEEP_STUB",
      "features": {
        "superseded": true
      }
    }
  ]
}
```

Do not include full result text unless explicitly enabled.

---

## 35. Repository structure

Recommended:

```text
dsh-jev-compaction/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── service.ts
│   │
│   ├── dsh/
│   │   ├── compat.ts
│   │   ├── surface.ts
│   │   ├── meter.ts
│   │   └── types.ts
│   │
│   ├── jev/
│   │   ├── backend.ts
│   │   ├── client.ts
│   │   ├── questions.ts
│   │   ├── state.ts
│   │   ├── fit.ts
│   │   ├── batch.ts
│   │   └── validate.ts
│   │
│   ├── planner/
│   │   ├── collect.ts
│   │   ├── features.ts
│   │   ├── policy.ts
│   │   ├── savings.ts
│   │   └── plan.ts
│   │
│   ├── mutation/
│   │   ├── render.ts
│   │   ├── validate.ts
│   │   └── apply.ts
│   │
│   ├── commands/
│   │   └── jev-compact.ts
│   │
│   └── observability/
│       └── logging.ts
│
├── tests/
│   ├── unit/
│   ├── fixtures/
│   ├── integration/
│   └── live/
│
├── docs/
│   ├── architecture.md
│   ├── compatibility.md
│   └── evaluation.md
│
├── NOTICE
├── LICENSE
├── README.md
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

If developed inside a larger DSH plugin monorepo, keep the package boundary equivalent.

---

## 36. Package scripts

Suggested:

```json
{
  "scripts": {
    "build": "...",
    "typecheck": "...",
    "lint": "...",
    "test": "...",
    "test:unit": "...",
    "test:integration": "...",
    "test:live": "...",
    "eval": "..."
  }
}
```

`test:live` must never be part of default CI without credentials.

---

## 37. CI

Minimum CI:

- install with pnpm;
- typecheck;
- lint;
- unit tests;
- integration fixtures;
- build;
- package dry-run;
- compatibility matrix where practical.

Future matrix:

```text
DSH current stable
DSH current prerelease
Node active LTS
Node current
```

Do not use floating "latest" for all compatibility tests; pin at least one known-good DSH version.

---

## 38. Implementation phases

The plan runs as two tracks. **Track A (companion, 0.1.x)** is the shipped
architecture of §6.6: own prepended `agent/pre-step` listener, built-in
compaction untouched below. **Track B (backend, 0.2)** replaces
`dsh-compaction-basic` through the `ctx.compaction` seam. Track A phases A1–
A5 landed as one implementation wave; per-phase verification below is what
each stage contributes to the current test surface.

### Track A — companion mode

#### Phase A0 — compatibility spike — COMPLETE

Executed against the pinned harness release (`dsh-v0.1.5-rc.2`); verified
facts and their consequences in `docs/compatibility.md`. Decisive findings:
`tool/result` replacement is legal only inside an open turn and the
content-only rewrite rule (§3 there), which shaped §21.0 arming; `{prepend:
true}` ordering; `tokenMeter.measure` per-node pricing; the command
invocation/result contract.

**Exit criterion (met):** a synthetic single-node tool-result replacement
survives persistence and replay; DSH continues the conversation and ordinary
`/compact` still works.

#### Phase A1 — local deterministic planner — COMPLETE (`b69409f`)

Delivered: candidate collection with the full pin set (`collect.ts`),
deterministic features (`features.ts`), preservation window by position and
metered tokens, stub/truncate renderers with convergence pinning
(`render.ts`), plan assembly and savings gate (`plan.ts`, `savings.ts`),
mutation writer with snapshot revalidation (`apply.ts`).

Verification: `tests/unit/{render-policy-savings,features}.test.ts`,
`tests/integration/surface.test.ts` (real `Session` replay: prune → reload →
identical derived messages and `replaceGeneration`).

**Exit criterion (met):** the fake backend safely prunes a fixture session;
repeated runs converge (markers pin re-pruning).

#### Phase A2 — System One backend — COMPLETE (`b69409f`)

Delivered: provider-neutral `SystemOneClient` over the System One scoring
wire (`backend.ts`) with per-provider presets `typesafe | jeff | custom`
(`decision.provider`, `SYSTEM_ONE_PRESETS`), keyless mode (empty
`apiKeyEnv`), timeout + caller cancellation, zero-or-one network/5xx retry,
strict response validation (`validate.ts`), state builder with progressive
fitting (`state.ts`), two questions per candidate (`questions.ts`), batching
with a concurrency cap (`batch.ts`).

Verification: `tests/unit/backend.test.ts` (wire contract, keyless header,
retry, cancellation), `tests/unit/jev-state-fit-batch.test.ts`,
`tests/unit/config.test.ts` (preset resolution, custom-required-baseUrl,
legacy override order).

**Exit criterion (met):** manual `/jev-compact --dry-run` scores a real
session through the full pipeline with a fake or local backend; malformed
responses can never trigger pruning.

#### Phase A3 — manual mutation — COMPLETE (`b69409f`)

Delivered: `/jev-compact` and `/jev-compact --dry-run` (`commands/
jev-compact.ts`) with the arming design of §21.0 — the command scores and
queues; the prepended pre-step listener recomputes and applies inside the
open turn; per-item revalidation and partial-failure reporting
(`apply.ts`); savings report; manual failures surfaced as command errors
(§29 manual column).

Verification: `tests/integration/service.test.ts` (queueing, fail-open,
waterfall continuation).

**Exit criterion (met):** repeated manual runs are idempotent enough and do
not corrupt replay (integration surface tests reload and recompare).

#### Phase A4 — automatic pressure integration — COMPLETE (`b69409f`)

Delivered: pressure snapshot over `ctx.tokenMeter` with the routed
context-window lookup and absolute-token fallback (`dsh/meter.ts`); trigger
gates (ratio or `minSurfaceTokens`, `minCandidates`, `minCandidateChars`,
`cooldownTurns`); per-session mutex; prepended pre-step hook
(`service.ts`, `dsh/lifecycle` wiring in `index.ts`); downstream
`dsh-compaction-basic` interop by ordering (prepended → basic appended).

**Exit criterion (met in fixture scope):** a pressured synthetic session
prunes automatically; when savings miss the gate, the run skips and the
built-in summary path remains available (ordering facts in
`docs/compatibility.md` §1).

#### Phase A5 — release hardening — COMPLETE (`b69409f`, `31b15da`, `b8874eb`)

Delivered: README (privacy notice, provider table, roadmap), NOTICE
attribution, `compatibility.json` (`agent/pre-step`), version plan,
`plugins.json` regeneration, root README + `docs/COMPATIBILITY.md` rows,
phase-0 findings doc, deployment-mode design (§6.6).

**Exit criterion (met):** all repository gates green — plugin `pnpm run
check`, `verify:logging`, `verify:packages`, `deps:check`,
`tarball:verify:packages`, prettier; leak sweep clean.

#### Phase A6 — 0.1.x hardening — corpus and tuning COMPLETE; live smoke OPEN

1. **Evaluation corpus + runner — COMPLETE.** Twelve scenario builders with
   labels (`tests/eval/scenarios.ts`), the offline runner as a test
   (`tests/eval/evaluation.test.ts`, `pnpm run eval`). Exit: acceptance
   gates of §33.3 hold — zero dangerous prunes, ≈80% low-danger reduction
   (results in `docs/evaluation.md`).
2. **Threshold tuning — COMPLETE at shipped defaults.** Defaults sit on the
   zero-danger frontier of the corpus; the sweep procedure and the
   hosted-Jev / Jeff replay protocol are documented in `docs/evaluation.md`.
3. **Live rig smoke — OPEN** (opt-in, credentials required): real session on
   a local rig, `/jev-compact --dry-run` and one armed application; reload
   the session from storage and confirm the surface; record latencies.
4. **Persisted run stats** (optional): storage-domain counters per session
   (runs, applied, chars saved) surfaced in `/jev-compact` output. Exit:
   dispose symmetry proven, no journal writes (§28 holds).

### Track B — backend mode (implemented; live-rig confirmation open)

#### Phase B0 — entry/loader spike — static findings COMPLETE

Executed statically against `dsh-v0.1.5-rc.2` and `dsh-v0.1.6-alpha.1`
(`docs/backend-mode-spike.md`): the profile shim composes a row's **default
export** and bare specifiers resolve through the host's internal Node loader
(subpath rows are expected to work with a declared `exports` entry);
`ctx.reflect.provide` throws on a duplicate name → exactly-one-engine rule;
`dsh-compaction` / `dsh-compaction-basic` are published at `0.1.5-rc.2` and
wired into both pnpm catalogs; 0.1.6's `MESSAGE_PROJECTION_EVENT_TYPES`
contains only `image/offload`, so the inherited `compaction/*` bracket
protocol stays journal-safe as of alpha.1.

**Open (needs a rig):** end-to-end subpath row mount, `/compact` through
`dsh-command-compact` over typert Remote, one 0.1.6 host run.

#### Phase B1 — engine skeleton — COMPLETE

`JevCompactionEngine extends BasicCompactionEngine`
(`src/backend/engine.ts`, mounted via the `./backend` subpath export). The
nested `JevCompactionService` owns the prepended early-prune listener at
`trigger.contextRatio` (the SPEC's `jevPruneRatio`), the armed manual plans,
and `/jev-compact`; the inherited basic machinery provides the conventional
summary above `summaryRatio` (forwarded as basic's `thresholdRatio`),
`compactNow`, overflow recovery, the size pruner seam, and the compaction
event protocol. The engine overrides `static Config` with a pass-through
schema (an inherited schema would strip the companion sections) and
validates strictly — `summaryRatio` must exceed the early threshold.

Verification: `tests/integration/engine.test.ts` — early prune below the
summary threshold without a summary; inherited summary fires when Jev keeps
everything; balanced brackets with clean replay; idle-session `compactNow`;
armed manual application; fail-open prune then inherited summary; threshold
ordering validation.

**Exit criterion (met in fixture scope):** a pressured session never
summarizes while Jev pruning holds it under `summaryRatio`; forced past it,
the summary lands with correct brackets and replays.

#### Phase B2 — overflow recovery — COMPLETE (by inheritance)

The `agent/request-error` context-overflow path is inherited from the basic
engine (it is registered by basic itself, not by the base contract) and its
listeners call `this.compactIfNeeded` dynamically, so the two-threshold
override composes with overflow recovery. Composition is covered by the
B1 suite; a forced provider-overflow rig test remains part of B0's open
items.

#### Phase B3 — deployment and migration — docs COMPLETE; kit A/B OPEN

README "Modes" section documents both entries with profile rows and the
rollback rule; the deployment mechanics and rig checklist live in
`docs/backend-mode-spike.md`. Remaining: the docker-kit A/B run (basic vs
backend) through the smoke checklist.

#### Phase B4 — comparative evaluation — offline leg COMPLETE

The §33 corpus runs our modes (companion pipeline; backend thresholds) with
zero dangerous prunes. Remaining: the same corpus against a mounted
`dsh-compaction-basic` and a hosted decision backend on a rig.

#### Phase B5 — release

The backend entry ships in the first release (nothing earlier is published,
so the 0.1/0.2 split collapses into one initial release; the version plan
text documents both modes).

### Cross-track risks

| Risk | Tracks | Mitigation |
|---|---|---|
| Harness 0.1.6 required-projection categories change journal rules | A, B | spike B0.4 pins it; `known-event-types` is generated — re-verify on every harness bump |
| Two pressure policies drift apart (companion) | A | our default `contextRatio` stays strictly below basic's `0.8`; documented composition; §33 re-run gates |
| Entry mechanic rejected by the loader | B | fallback mechanic is the second-package layout over a shared workspace core (B0 decision) |
| Pre-step latency | A, B | pressure-gated, cooldown, tight backend timeout, bounded batching; latency recorded per eval run |
| Secret exposure via state | A, B | §30 budgets; rig smoke includes a canary-token session; never log state |

---

## 39. MVP acceptance criteria

Status after Track A (`b69409f`): every criterion below is implemented and
covered by the gates listed in §38, with one honest caveat — "built-in DSH
compaction remains functional" rests on the verified ordering facts
(`docs/compatibility.md` §1) rather than a live-rig run; the live smoke is
phase A6.3.

The first public release is acceptable when all of the following hold:

- [ ] No DSH core fork is required.
- [ ] Jev calls happen asynchronously outside the synchronous `ctx.toolResultPruner` seam.
- [ ] Only historical eligible `tool/result` surface nodes are rewritten.
- [ ] Original full results remain in the durable session log.
- [ ] User text is never rewritten by the plugin.
- [ ] Assistant text is never rewritten by the plugin.
- [ ] Recent results are pinned.
- [ ] Unknown/ambiguous result shapes are pinned.
- [ ] Jev malformed output cannot trigger pruning.
- [ ] Stale Jev plans are rejected when the surface changes.
- [ ] Cancellation is honored.
- [ ] Automatic failure does not block ordinary agent execution.
- [ ] Built-in DSH compaction remains functional.
- [ ] `/jev-compact --dry-run` performs no mutation.
- [ ] Token savings are measured before/after when the meter permits it.
- [ ] Persistence/reload reproduces the same pruned surface.
- [ ] README clearly states that derived conversation data is sent to the Jev provider.
- [ ] Original `fast-jev-compaction` work is credited.
- [ ] Tests use a fake Jev backend by default.

---

## 40. Post-0.1 backlog (prioritized, track-tagged)

Ordered by value-to-risk; `[A]` ships inside companion 0.1.x, `[B]` belongs
to the backend track, `[A/B]` benefits both.

1. `[A]` Evaluation corpus + runner + threshold tuning (§33, phase A6.1–A6.2)
   — the safety net every later change stands on.
2. `[A]` Live rig smoke checklist (A6.3) — closes the §39 caveat.
3. `[B]` B0 entry/loader spike — unblocks the whole backend track.
4. `[A/B]` Persisted per-session stats (A6.4) — becomes the backend mode's
   `summaryFallbackRate` telemetry source.
5. `[A]` Configurable tool-specific preservation policies (per-tool pin or
   bias overrides in config; must pass the §33 gates).
6. `[A]` Smarter superseded-file-read detection (path-keyed read/write
   chains in `features.ts`) — gated by the corpus, never an unconditional
   delete rule (§10.1).
7. `[A/B]` Privacy redaction pass over the state builder (best-effort
   secret patterns, never marketed as complete; §30).
8. `[B]` Overflow recovery (B2) and the two-threshold policy (B1) — the
   core of the backend track.
9. `[A/B]` `agent/request-error` Jev pruning before canonical summary
   recovery, only if B2 proves the retry semantics safe.
10. `[A/B]` OpenTelemetry spans/metrics behind the existing structured
    events; per-workspace policy overrides; plan inspection UI; retrieval
    of pruned originals (`§41.3`) — evaluate after backend mode lands.

---

## 41. v2 exploration

Potential v2 features:

### 41.1 Pair-level removal

Explore removal of both historical tool call and result only when DSH provides a safe public way to reconstruct/rewrite the provider-facing assistant message while preserving provenance.

Do not implement through brittle private event surgery.

### 41.2 Jev-backed compaction engine (promoted to the §6.6 target)

The full replacement of `dsh-compaction-basic` — subclassing
`CompactionEngine`, Jev prune as the first stage, conventional summary as the
fallback — is no longer speculative: the `ctx.compaction` seam is designed for
alternative backends, and `/compact` keeps working through it. See §6.6 for
the verified contract, the two-threshold policy, the re-implementation
obligations (overflow recovery, event protocol, entry-selection constraint),
and the spike that must precede implementation. The original precondition is
superseded; what remains deferred is only the spike and the build itself,
planned for 0.2.

### 41.3 Retrieval of pruned originals

A tool could expose original shadowed result data on demand:

```text
session_get_original_tool_result(seq)
```

This would turn pruning into explicit cold storage from the agent's perspective.

Security and permission implications must be reviewed first.

### 41.4 Hybrid local + Jev policy

Cheap deterministic rules can prune extremely obvious cases without an API call, while Jev handles ambiguous cases.

Example:

```text
definitely superseded + cheap rerun + old enough
→ local stub

ambiguous semantic relevance
→ Jev
```

---

## 42. Known risks

### Risk: DSH APIs change quickly

Mitigation:

- isolated compatibility layer;
- pinned CI version;
- compatibility smoke fixture;
- no direct imports from deep private paths where avoidable.

### Risk: Jev incorrectly prunes important evidence

Mitigation:

- conservative thresholds;
- deterministic pins;
- recent window;
- error bias;
- stubs rather than pair deletion;
- dry-run;
- offline evaluation;
- original event remains durable.

### Risk: pre-step latency

Mitigation:

- pressure-triggered only;
- cooldown;
- tight timeout;
- bounded batching;
- minimum candidate threshold.

### Risk: waterfall ordering

Mitigation:

- `prepend`;
- documented composition;
- integration test with `dsh-compaction-basic`;
- degrade to manual-only mode if unsupported DSH release breaks ordering.

### Risk: secret leakage to Jev

Mitigation:

- explicit documentation;
- send compact metadata/result previews rather than full results;
- optional redaction later;
- no raw state logging.

### Risk: partial append failure

Mitigation:

- full validation before mutation;
- legal independent replacements;
- explicit partial result reporting;
- append-only semantics respected.

---

## 43. README positioning

Suggested short description:

> **Jev-powered, replay-safe semantic context pruning for DeepSeek Harness. Keeps conversation text verbatim and selectively forgets stale tool output before ordinary summary compaction is needed.**

Suggested tagline:

> **Forget stale tool output, not the conversation.**

Key README comparison:

| Approach | User/assistant text | Tool output | Durable original | Semantic |
|---|---|---|---|---|
| DSH summary compaction | summarized for old range | summarized | yes | yes, generative |
| deterministic tool pruner | unchanged | size-based trim | yes | no |
| `dsh-jev-compaction` | unchanged | Jev-selected trim/stub | yes | yes, decision model |

Avoid claiming "zero hallucination" or "lossless compaction". The selection decision can still be wrong.

Positioning line: **Jev/System-One semantic compaction for DeepSeek Harness —
supports TypeSafe Jev and self-hosted compatible backends (Jeff, open-jev) via
a pluggable decision backend.**

---

## 44. Suggested first release scope

Keep `0.1.0` small (companion mode per §6.6; the `backend` replacement is the
0.2+ target):

```text
✓ manual dry-run
✓ manual pruning (armed-plan application at the next step boundary)
✓ automatic pressure trigger
✓ tool/result only
✓ TypeSafe Jev hosted API
✓ self-hosted System One-compatible backends (jeff preset, custom endpoint)
✓ replay-safe replacement
✓ fake backend tests
✓ built-in compaction fallback (companion mode)
✓ backend entry providing ctx.compaction (backend mode, §6.6)
✓ offline evaluation corpus with a zero-dangerous-prune release gate
✓ logs/stats
✓ attribution

✗ live-rig confirmation of the backend entry (B0 open items)
✗ UI
✗ pair deletion
✗ automatic retrieval
✗ request-error interception
```

This is enough to establish the niche without overbuilding.

---

## 45. Implementation order — as executed, and what follows

Track A was executed in one wave (spike first, then the full stack):

1. Read the harness sources for session, compaction, token meter, commands,
   and agent lifecycle; record the installed version (`0.1.5-rc.2`).
2. Phase A0 compatibility spike → `docs/compatibility.md`.
3. Real-`Session` replay fixtures before any mutation code.
4. Normalized internal types, structural host views (`src/dsh/`).
5. Candidate collection, features, policy, savings, plan; dry-run with a
   fake backend.
6. Safe `tool/result` replacement + persistence/reload proof.
7. System One client behind `SystemOneBackend` + provider presets; state
   fitting and batching; strict validation.
8. Manual command (dry-run + armed application).
9. Automatic pre-step integration (pressure, cooldown, mutex).
10. Compaction interoperability by verified ordering.
11. README, NOTICE, privacy warning, version plan; gates; commit.

Never begin with UI or pair deletion (unchanged rule).

Next up, in order:

12. Track A6: evaluation corpus, threshold tuning, live rig smoke (§33).
13. Track B0 spike, then B1–B5 (§38 Track B) toward the 0.2 backend release.
14. §40 backlog items in priority order as capacity allows.

---

## 46. References checked while designing this SPEC

### DeepSeek Harness

- Compaction subsystem  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md

- Session subsystem / surface replacement  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md

- Agent lifecycle  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/agent-lifecycle.md

- Capability seams  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/capability-seams.md

- Tool-result pruner  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-tool-result-pruner/README.md

- Token meter  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/token-meter/README.md

- Commands  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.md

- Cordis event behavior  
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md

### Jev / upstream inspiration

- fast-jev-compaction  
  https://github.com/tamaratran/fast-jev-compaction

- TypeSafe AI / Jev documentation  
  https://docs.typesafe.ai/

---

## 47. Final architectural rule

If an implementation choice conflicts with the following ordering, prefer the earlier item:

1. **Do not corrupt or make the DSH session unreplayable.**
2. **Do not lose explicit user instructions.**
3. **Do not break tool/result structural validity.**
4. **Preserve exact evidence when uncertain.**
5. **Fail open to ordinary DSH behavior.**
6. **Reduce context.**
7. **Optimize latency/cost.**

Compression ratio is not the primary correctness criterion.
