# dsh-jev-compaction — Immediate Result Shaping & Settings UI

## Enhancement SPEC / Implementation Plan

**Status:** Draft / implementation-ready  
**Date:** 2026-09-20  
**Target package:** `@yadsh/dsh-jev-compaction`  
**Target platform:** DeepSeek Harness (DSH)  
**Scope:** extend the existing Jev historical compaction plugin with:

1. immediate semantic shaping of large tool outputs at `tools/post-execute`;
2. a first-class DSH settings card for the plugin;
3. safety, observability and interoperability rules between immediate shaping and historical compaction.

---

# 1. Summary

The current plugin primarily solves **historical context compaction**:

```text
conversation grows
      ↓
old tool results accumulate
      ↓
context pressure
      ↓
Jev evaluates historical results
      ↓
KEEP / TRUNCATE / STUB
      ↓
avoid or delay summary compaction
```

This enhancement adds an earlier layer:

```text
tool executes
      ↓
large/repetitive result
      ↓
tools/post-execute
      ↓
Jev evaluates result segments
      ↓
preserve informative parts
      ↓
small model-facing tool/result enters history
```

The two layers become complementary:

```text
┌───────────────────────────────────────────────┐
│                 Tool execution                │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
             Immediate Result Shaper
             (new, tools/post-execute)
                        │
                        ▼
           compact model-facing result
                        │
                        ▼
                  Session history
                        │
                 grows over time
                        │
                        ▼
            Historical Jev Compaction
             (existing functionality)
                        │
                        ▼
            stale results → stub/trim
                        │
                        ▼
              summary compaction
                  only if needed
```

The desired result is a three-stage context-management pipeline:

```text
1. Prevent bloat
   Immediate Result Shaping

2. Garbage-collect stale history
   Historical Jev Compaction

3. Last-resort condensation
   DSH summary compaction
```

This enhancement must also add a proper **plugin settings card** to DSH Web so the plugin no longer depends only on hand-edited `cordis.yml` / patch files.

---

# 2. Inspiration and attribution

The immediate result-shaping concept is inspired by:

- `zhangxaochen/dsh-jev`
- specifically its opt-in `typesafe-result-shaper` module.

That project uses `tools/post-execute` and classifies groups of similar output lines so routine/repetitive output can be dropped before it enters long-lived context.

The implementation in `@yadsh/dsh-jev-compaction` should be independently designed around this plugin's goals and architecture.

Do not copy source code without preserving the upstream MIT attribution requirements.

README / research notes SHOULD explicitly acknowledge the inspiration, for example:

```text
Immediate result shaping was inspired by the `typesafe-result-shaper`
module from zhangxaochen/dsh-jev. This implementation is adapted for
dsh-jev-compaction's two-stage context lifecycle and reversible/archive
safety model.
```

---

# 3. Why this belongs in dsh-jev-compaction

The plugin should evolve from "a thing that runs when the context is already large" into a broader **semantic context lifecycle manager**.

Without immediate shaping:

```text
tool produces 80 KB
      ↓
80 KB enters context
      ↓
next several LLM requests pay for it
      ↓
later compaction finally removes it
```

With immediate shaping:

```text
tool produces 80 KB
      ↓
Jev keeps 5 KB of useful evidence
      ↓
only 5 KB enters context
      ↓
historical compaction may later reduce it further
```

This particularly helps:

- test runners;
- builds;
- package managers;
- shell commands;
- linters;
- long grep/search output;
- repetitive progress logs;
- CI logs;
- download/install output;
- generated diagnostics containing large routine sections.

The immediate shaper must **not** be indiscriminately applied to every tool.

---

# 4. Critical DSH semantic difference

Historical compaction and immediate shaping have different safety properties.

## 4.1 Historical compaction

The existing historical compactor can shadow an already-durable `tool/result` surface node while retaining the original event in the append-only session log.

That is replay-friendly:

```text
durable original exists
       ↓
new surface replacement shadows it
```

## 4.2 Immediate result shaping

`tools/post-execute` runs **before** the final `tool/result` event is persisted.

DSH's successful `ToolExecutionResult.value` is execution-local. The durable event persists the rendered:

- `content`;
- optional `error`;
- optional `meta`.

The canonical structured `value` is not retained for replay.

Therefore:

> Immediate result shaping is potentially destructive unless the plugin explicitly archives the original rendered content before replacing it.

This SPEC must not call immediate shaping "replay-safe" by default.

---

# 5. Goals

The enhancement MUST:

- add optional immediate semantic shaping of large tool outputs;
- use the official asynchronous `tools/post-execute` DSH hook;
- replace only model-facing `content`, not canonical `value`;
- preserve downstream tool policy and other post-execute plugins;
- be conservative by default;
- skip unknown/unsafe result forms;
- preserve errors by default;
- preserve non-text blocks;
- have a minimum-savings gate;
- support a configurable allowlist/blocklist of tools;
- integrate with the existing Jev/System One backend abstraction;
- expose metrics separately for immediate shaping and historical compaction;
- add a DSH Web settings card;
- support live settings updates where safe;
- document the fact that immediate shaping changes durable model-visible result content;
- optionally archive original rendered output before shaping.

---

# 6. Non-goals

This enhancement MUST NOT:

- modify tool arguments;
- alter whether a tool was executed;
- rewrite canonical successful `value`;
- use the shaper as a security boundary;
- shape all tools by default;
- silently remove tool errors by default;
- shape non-text/binary/image blocks unless explicitly supported later;
- replace DSH spill policy;
- replace DSH tool-result presentation cards;
- claim that removed output is semantically irrelevant with certainty;
- automatically restore archived output into context;
- require a DSH core fork.

---

# 7. DSH integration point

Use:

```ts
ctx.on(
  "tools/post-execute",
  async (exec, result, next): Promise<PostToolDecision> => {
    // ...
  },
  { prepend: true },
);
```

The exact registration options MUST be confirmed against the target DSH version.

Current DSH semantics:

```text
tools/pre-execute
       ↓
guards
       ↓
tools/execute
       ↓
tool body
       ↓
tools/post-execute
       ↓
ToolDefinition.finalizeContent
       ↓
tools/result
       ↓
durable tool/result
```

`tools/post-execute` can:

```ts
{ kind: 'accept' }
{ kind: 'accept', content: ContentBlock[] }
{ kind: 'accept', value: JsonValue }
{ kind: 'block', feedback: ContentBlock[] }
```

The shaper MUST use the `content` replacement form.

---

# 8. Middleware composition rule

The shaper must not short-circuit unrelated post-execute middleware.

Preferred behavior:

```ts
ctx.on(
  "tools/post-execute",
  async (exec, result, next) => {
    const downstream = await next();

    if (downstream.kind === "block") {
      return downstream;
    }

    if ("value" in downstream && downstream.value !== undefined) {
      // A downstream plugin replaced the canonical value.
      // Do not guess its rendered content.
      return downstream;
    }

    const effectiveContent = downstream.content ?? result.content;

    const shaped = await maybeShape(exec, result, effectiveContent);

    if (!shaped) {
      return downstream;
    }

    return {
      ...downstream,
      kind: "accept",
      content: shaped.content,
    };
  },
  { prepend: true },
);
```

This makes the shaper behave as an **outer post-processor**:

1. later listeners get a chance to block/replace first;
2. the shaper never overrides a downstream block;
3. the shaper does not attempt to reinterpret a replaced canonical value;
4. existing `additionalContexts` are preserved.

Exact typing should be adapted to the currently installed DSH version.

---

# 9. Feature name

Internal module name:

```text
ImmediateResultShaper
```

Config namespace subsection:

```text
resultShaping
```

UI label:

```text
Immediate result shaping
```

Avoid naming it simply `resultPruner`, because the plugin already has historical pruning and DSH itself has tool-result pruners.

---

# 10. Default state

Immediate shaping should initially be:

```yaml
resultShaping:
  enabled: false
```

Reason:

- it changes the durable model-facing output before persistence;
- classification can remove ordinary details;
- behavior is tool-dependent;
- the feature needs user-visible opt-in until enough evaluation data exists.

After evaluation, a later major/minor version may consider a safe default profile for selected command tools.

---

# 11. Tool eligibility

## 11.1 Default included tools

Recommended initial defaults:

```text
bash
terminal
pwsh
run_command
execute_command
run_tests
```

Only include names that actually exist in the target DSH deployment.

The matcher should support exact names plus optional glob/prefix patterns later.

## 11.2 Default excluded categories

Do not shape by default:

- file reads;
- file writes;
- file diffs;
- web fetch body;
- web search;
- database queries;
- structured business/API tools;
- subagent results;
- ask-user tools;
- memory/knowledge retrieval;
- arbitrary MCP tools.

These may contain unique evidence that cannot be inferred from output shape.

Users may opt them in.

## 11.3 Error policy

Default:

```yaml
preserveErrors: true
```

If `result.isError === true`, return unchanged.

Future optional mode:

```yaml
shapeErrors: conservative
```

would preserve error/warning sections plus stack-trace neighborhoods, but is out of MVP.

---

# 12. Trigger conditions

A result becomes a shaping candidate only if all configured checks pass.

Recommended defaults:

```yaml
resultShaping:
  enabled: false

  thresholdChars: 12000
  minLines: 80
  repetitionTriggerRatio: 0.45

  maxPerTurn: 2
  maxConcurrent: 2

  preserveErrors: true
```

Candidate if:

```text
enabled
AND tool allowed
AND tool not excluded
AND successful result
AND text content exists
AND text length >= thresholdChars
AND (
      line count >= minLines
      OR repetition ratio >= repetitionTriggerRatio
      OR text length >= hardLengthTriggerChars
    )
AND per-turn budget not exhausted
```

Suggested:

```yaml
hardLengthTriggerChars: 32000
```

A huge output should be considered even if it is not line-oriented.

---

# 13. Content eligibility

The shaper should operate on text blocks only.

For content:

```text
[text, text]
```

it may reshape them.

For:

```text
[text, image, text]
```

default policy:

- preserve all non-text blocks unchanged;
- shape text blocks independently only if the reconstruction is unambiguous;
- otherwise skip the entire result.

Unknown block type:

```text
SKIP
```

Do not silently drop unsupported blocks.

---

# 14. Shaping strategy

The implementation should not send an entire 100 KB log to Jev as one opaque question.

Use a staged pipeline.

```text
raw text
  ↓
deterministic segmentation
  ↓
line-shape clustering
  ↓
important-line pinning
  ↓
bounded Jev classification/scoring
  ↓
reconstruction
  ↓
minimum-savings gate
```

---

# 15. Stage A — deterministic segmentation

Split output into stable ordered segments.

For line-oriented output:

```text
line 1
line 2
line 3
...
```

Create groups using:

- contiguous repeated patterns;
- blank-line boundaries;
- indentation boundaries;
- log-level prefixes;
- test case boundaries;
- obvious summary sections.

Do not build a parser for every tool in v1.

---

# 16. Stage B — line-shape clustering

Borrow the useful conceptual idea from `dsh-jev`:

Normalize lines so outputs that differ only in volatile values can be treated as one repeated shape.

Examples:

```text
Downloading package foo 12%
Downloading package foo 13%
Downloading package foo 14%
```

may normalize to:

```text
Downloading package <token> <number>%
```

Likewise:

```text
[12:01:04] test foo passed in 31ms
[12:01:05] test bar passed in 29ms
```

can share a progress/result shape.

Normalization MUST be conservative.

Potential replacements:

```text
timestamps → <time>
large integers → <number>
percentages → <percent>
UUIDs → <uuid>
long hashes → <hash>
ANSI color sequences → removed
```

Do NOT normalize away:

- short numeric values that may be semantically meaningful;
- line/column positions;
- HTTP status codes;
- exit codes;
- version numbers;
- filenames/paths by default.

---

# 17. Stage C — deterministic pins

Before Jev is called, mark obviously important segments.

Always keep:

- first configurable N lines;
- last configurable N lines;
- command exit summary;
- lines containing common fatal/error indicators;
- stack trace roots;
- test suite summary;
- package manager final summary;
- explicit warnings;
- assertion diffs;
- failing test names;
- compiler diagnostics.

Suggested defaults:

```yaml
keepHeadLines: 8
keepTailLines: 12
```

These pins are heuristic aids, not a security guarantee.

---

# 18. Stage D — Jev classification

Use the existing decision backend.

The immediate shaper should use a separate question template from historical compaction.

Provide Jev:

- current user goal / latest relevant user instruction;
- tool name;
- bounded tool arguments;
- result-group representative;
- count of repeated lines;
- approximate position in output;
- deterministic flags.

Recommended fixed categories:

```text
routine_progress
summary
warning
failure
important_evidence
unknown
```

Question:

```text
Classify this group of tool output by what role it plays for an agent
continuing the user's current task.
```

Second Noul question only when useful:

```text
Would removing this output group materially reduce the agent's ability
to make the correct next decision?
```

Do not use raw probability as permission.

---

# 19. Local retention policy

Suggested policy:

```text
failure
warning
important_evidence
unknown
    → KEEP

summary
    → KEEP one or bounded representatives

routine_progress
    → COLLAPSE
```

Low-confidence classification:

```text
KEEP
```

Recommended:

```yaml
minClassificationConfidence: 0.60
```

The local policy, not Jev, has final authority.

---

# 20. Reconstruction

Reconstruct text in original order.

Example original:

```text
Downloading a 1%
Downloading a 2%
...
Downloading a 99%
Installed a
Running test 1 ... pass
Running test 2 ... pass
...
Running test 80 ... pass
Running test 81 ... FAIL
AssertionError: expected 3 got 4
80 passed, 1 failed
```

Possible shaped output:

```text
Downloading a 1%
[dsh-jev-compaction: collapsed 97 routine progress lines]
Downloading a 99%
Installed a

Running test 1 ... pass
[dsh-jev-compaction: collapsed 79 repetitive passing-test lines]
Running test 81 ... FAIL
AssertionError: expected 3 got 4
80 passed, 1 failed
```

The omission marker MUST be factual and neutral.

Do not write:

```text
irrelevant output removed
```

Use:

```text
collapsed N repetitive/routine lines
```

or:

```text
semantic result shaping omitted N lines
```

---

# 21. Minimum savings gate

After reconstruction:

```text
originalChars
shapedChars
savedChars
savedRatio
```

If savings are too small, use the original result.

Recommended:

```yaml
minSavingsChars: 4000
minSavingsRatio: 0.30
```

Decision:

```text
savedChars < minSavingsChars
AND savedRatio < minSavingsRatio
    → KEEP ORIGINAL
```

This prevents paying Jev latency/cost for negligible context reduction.

---

# 22. Original-content archive

Because immediate shaping happens before the durable result is persisted, add an optional plugin-owned archive.

Recommended default:

```yaml
archive:
  enabled: true
```

The implementation MUST first check whether the existing plugin already has a durable storage abstraction suitable for this.

If not, create a small storage interface rather than scattering filesystem writes.

```ts
interface OriginalResultArchive {
  put(entry: ArchivedToolResult): Promise<ArchiveRef>;
  get(ref: ArchiveRef): Promise<ArchivedToolResult | null>;
  delete?(ref: ArchiveRef): Promise<void>;
}
```

Entry:

```ts
interface ArchivedToolResult {
  version: 1;
  createdAt: string;

  sessionId?: string;
  callId: string;
  toolName: string;

  content: ContentBlock[];

  contentHash: string;
  charCount: number;
}
```

---

# 23. Archive storage layout

If no DSH plugin-data service exists, use a configurable directory rooted under DSH-owned persistent data.

Example conceptual layout:

```text
$DSH_HOME/
└── data/
    └── dsh-jev-compaction/
        └── originals/
            ├── sha256-abcd...
            └── sha256-ef01...
```

Do not hardcode the exact location before Phase 0 checks the installed DSH version and package conventions.

Prefer content-addressed storage:

```text
SHA-256(canonical serialized content)
```

Benefits:

- deduplicates repeated output;
- simple integrity verification;
- easy expiry/GC;
- future retrieval tool.

---

# 24. Archive retention

Recommended config:

```yaml
archive:
  enabled: true
  retentionDays: 14
  maxBytes: 1073741824
  deduplicate: true
```

Garbage collection:

- run lazily;
- never block the agent critical path for large scans;
- enforce max size oldest-first;
- failure to archive should follow configured policy.

Recommended default policy:

```yaml
onArchiveFailure: keep-original
```

Meaning:

```text
archive failed
      ↓
do not shape
      ↓
persist full original result
```

This preserves the plugin's safety philosophy.

Optional:

```text
shape-anyway
```

may exist only as explicit advanced config.

---

# 25. Archive marker

When an archived result is shaped, include a short marker:

```text
[dsh-jev-compaction: output shaped; original archived as sha256:abcd…]
```

Do not expose a filesystem path to the model.

The archive reference should be:

- short;
- opaque/content-addressed;
- not a capability by itself.

Future retrieval tooling can resolve it under plugin policy.

---

# 26. Interaction with historical compaction

The historical compactor must recognize already-shaped results.

Detect the marker or, if future DSH metadata support allows, plugin metadata.

State:

```ts
alreadyShaped: boolean
archiveRef?: string
```

Historical policy:

```text
fresh shaped result
    → usually keep

old shaped result
    → may later truncate/stub

already shaped + now stale
    → stub can retain archiveRef marker
```

Example:

```text
Immediate shaping:
80 KB → 6 KB

Later historical compaction:
6 KB → 180 B stub
```

This is valid.

The historical compactor MUST NOT attempt to re-expand archived output merely to judge it.

---

# 27. Interaction with DSH spill policy

DSH may already truncate/spill oversized results.

The immediate shaper should not fight the built-in.

Phase 0 must determine actual ordering in the installed profile.

Rules:

- if incoming content is already an explicit spill locator/preview, skip shaping;
- do not remove spill locators;
- do not reinterpret a built-in truncation marker as normal output;
- measure whether shaping happens before or after configured spill behavior.

Document the final order in README.

---

# 28. PTC / Code Mode behavior

DSH can execute nested sub-calls through PTC / code-mode transports.

Do not assume all nested calls persist exactly like native top-level calls.

MVP recommendation:

```text
shape top-level model-requested tool results only
```

Skip nested PTC dispatches unless the current hook receives a normal, safe top-level `ToolExecution`.

Later add explicit PTC shaping after dedicated fixtures.

---

# 29. Concurrency

Tool calls may execute in parallel.

Track per-turn shaping budget by agent/turn.

Example:

```ts
Map<AgentId, TurnShapeBudget>;
```

Must be:

- bounded;
- cleaned after turn;
- safe against parallel settlement order.

DSH orders post-execute processing by model call order even when dispatch settles out of order; do not rely on wall-clock completion order.

---

# 30. Time budget

Immediate shaping is in the tool execution critical path.

Recommended defaults:

```yaml
resultShaping:
  requestTimeoutMs: 2500
  maxConcurrent: 2
  maxPerTurn: 2
```

If Jev times out:

```text
KEEP ORIGINAL
```

No retry by default in the hot path.

Optional one retry only for manual/benchmark paths.

---

# 31. Cost budget

Add per-turn and optional per-session budget.

Possible config:

```yaml
resultShaping:
  maxPerTurn: 2
  maxInputCharsPerTurn: 50000
```

If budget exceeded:

```text
KEEP ORIGINAL
```

Historical compaction has its own budget and should not share the same counter unless intentionally configured.

---

# 32. Metrics

Track immediate shaping separately.

Counters:

```text
resultShaping.seen
resultShaping.eligible
resultShaping.skipped
resultShaping.requests
resultShaping.shaped
resultShaping.keptOriginal
resultShaping.errors
resultShaping.timeouts
resultShaping.archiveWrites
resultShaping.archiveFailures
```

Totals:

```text
resultShaping.originalChars
resultShaping.persistedChars
resultShaping.savedChars
resultShaping.jevInputEstimate
```

Timing:

```text
resultShaping.latencyMs
resultShaping.jevLatencyMs
```

Skip reason tags:

```text
disabled
tool-not-allowed
error-result
too-small
unsupported-content
already-spilled
turn-budget
low-savings
low-confidence
jev-error
archive-error
downstream-block
downstream-value-replacement
```

---

# 33. Settings architecture

The plugin MUST expose a real DSH Web settings card.

Current DSH provides a first-class settings seam:

Host side:

```text
ctx.settings.installSection(...)
```

Browser side:

```text
settings.plugin.item
```

The namespace is the join key.

Use:

```text
jev-compaction
```

unless the plugin already owns another stable settings namespace.

Do not invent a second namespace if an existing one can be migrated safely.

---

# 34. Host-side settings registration

Conceptual:

```ts
export const SETTINGS_NS = "jev-compaction";

export function apply(ctx: Context, config: Config) {
  let source = () => config;

  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.installSection(
      ctx,
      SETTINGS_NS,
      UserSettingsSchema,
      config,
      {
        setSource(current) {
          source = current;
        },

        onChange() {
          service.updateConfig(source());
        },
      },
    );
  });
}
```

The settings schema should contain only user-editable values.

Deployment-only internals may remain composition config.

Settings overrides should layer:

```text
schema defaults
    ↓
deployment/composition config
    ↓
user settings
```

---

# 35. Browser-side settings registration

Package must expose a client module.

Suggested layout:

```text
src/
├── index.ts
├── settings.ts
└── client/
    ├── index.ts
    ├── card.ts
    ├── controller.ts
    └── locale.ts
```

`package.json` must declare the DSH client entry according to current DSH packaging rules.

Client registration concept:

```ts
ctx.slots.inject("settings.plugin.item", () =>
  ctx.slots.register(
    {
      name: "settings.plugin.item",
      key: "jev-compaction",
      locale: "settings.jevCompaction",
      inject: () => controller.inject(),
    },
    JevCompactionSettingsCard,
  ),
);
```

The implementation should follow the current official DSH cookbook instead of cloning a core UI component through deep private imports.

---

# 36. Settings card UX goals

The card should make the plugin usable without editing YAML.

A user should be able to answer:

- Is the plugin enabled?
- Which backend is it using?
- Is the Jev endpoint configured?
- When does immediate shaping run?
- Which tools may be shaped?
- When does historical compaction run?
- How aggressive is it?
- Are original immediate outputs archived?
- How much context has the plugin saved?
- Is the configuration currently healthy?

within one settings page.

---

# 37. Settings card overview

Card title:

```text
Jev Compaction
```

Subtitle:

```text
Semantic result shaping and historical context compaction
```

Header status area:

```text
● Enabled
Provider: TypeSafe Jev
Model: jev-latest
Last decision: 18s ago
Saved this session: 184k tokens
```

The status indicator must not imply API health unless health was actually checked.

---

# 38. Proposed settings card wireframe

```text
┌──────────────────────────────────────────────────────────────┐
│ Jev Compaction                                      [ ON ]  │
│ Semantic result shaping and historical context compaction   │
│                                                              │
│ Provider: TypeSafe Jev            Status: ● Configured       │
│ Model: jev-latest                 Last error: —              │
│                                                              │
│ [General] [Result shaping] [Historical] [Provider] [Advanced]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Immediate result shaping                         [ OFF ]      │
│ Reduce large repetitive tool outputs before they enter       │
│ conversation history.                                         │
│                                                              │
│ Shape tools                                                  │
│ [ bash × ] [ terminal × ] [ run_command × ] [+ Add]          │
│                                                              │
│ Minimum result size                                          │
│ [ 12000 ] chars                                              │
│                                                              │
│ Maximum per turn                                             │
│ [ 2 ]                                                        │
│                                                              │
│ Preserve errors                                  [ ON ]       │
│ Archive original output                          [ ON ]       │
│                                                              │
│ Minimum savings                                              │
│ [ 30 ] %        [ 4000 ] chars                               │
│                                                              │
│             [Reset section]              [Save changes]       │
└──────────────────────────────────────────────────────────────┘
```

Tabs are optional.

If DSH's visual conventions prefer a single scrolling page, use collapsible groups instead.

Do not build a custom navigation framework just for this plugin.

---

# 39. Settings section — General

Fields:

### `enabled`

```text
Enable Jev Compaction
```

Toggle.

Description:

```text
Turns semantic context management on or off without uninstalling the plugin.
```

When disabled:

- no immediate shaping;
- no automatic Jev historical pruning;
- manual dry-run may optionally remain available if explicitly designed that way;
- ordinary DSH behavior remains untouched.

### `mode`

If the plugin currently supports/introduces multiple integration modes:

```text
Compaction integration
[ Companion ▾ ]
```

Values:

```text
companion
backend
```

Only show this field if both are implemented.

Do not expose aspirational options that do not work yet.

---

# 40. Settings section — Immediate result shaping

Header:

```text
Immediate result shaping
```

Description:

```text
Semantically compress large repetitive tool outputs before they are written
to conversation history.
```

Fields:

### `resultShaping.enabled`

Toggle.

### `resultShaping.includeTools`

Tag/multi-value input.

Label:

```text
Eligible tools
```

Helper:

```text
Only these tools may be shaped. Unknown tools are kept unchanged.
```

### `resultShaping.excludeTools`

Advanced tag input.

Exclusions win over inclusions.

### `resultShaping.thresholdChars`

Numeric input.

Label:

```text
Minimum result size
```

Unit:

```text
characters
```

### `resultShaping.hardLengthTriggerChars`

Advanced numeric input.

### `resultShaping.minLines`

Numeric.

### `resultShaping.repetitionTriggerRatio`

Percentage/slider or number.

Label:

```text
Repetition trigger
```

Do not use a vague "aggressiveness" slider as the only control.

### `resultShaping.maxPerTurn`

Numeric integer.

### `resultShaping.preserveErrors`

Toggle, default ON.

### `resultShaping.minClassificationConfidence`

Advanced percentage.

### `resultShaping.minSavingsRatio`

Percentage.

### `resultShaping.minSavingsChars`

Numeric.

### `resultShaping.keepHeadLines`

Advanced numeric.

### `resultShaping.keepTailLines`

Advanced numeric.

---

# 41. Settings section — Original output archive

Show inside Result Shaping or Safety.

Header:

```text
Original output archive
```

Warning copy:

```text
Immediate shaping occurs before the final tool result is persisted by DSH.
Archiving keeps a local copy of the original rendered output for diagnostics
and future recovery.
```

Fields:

### `archive.enabled`

Toggle, recommended default ON when result shaping is ON.

### `archive.retentionDays`

Number.

### `archive.maxBytes`

Use a friendly size control:

```text
Maximum archive size
[ 1 ] [ GB ▾ ]
```

Convert to bytes internally.

### `archive.onFailure`

Select:

```text
Keep original result (recommended)
Shape anyway
```

Default:

```text
keep-original
```

If archive is disabled, show a visible warning:

```text
Shaped output may not be recoverable from session replay.
```

Do not hide this warning in a tooltip.

---

# 42. Settings section — Historical compaction

Expose the existing plugin settings rather than forcing YAML edits.

Potential fields, aligned with actual implementation:

### Automatic historical pruning

Toggle.

### Context pressure trigger

```text
Start semantic pruning at
[ 70 ] % of model context
```

### Minimum surface tokens

Numeric.

### Preserve recent messages

Numeric.

### Preserve recent tokens

Numeric.

### Full keep threshold

Probability/number.

### Truncate threshold

Probability/number.

### Minimum savings

Ratio + chars.

### Summary fallback

Toggle if the plugin owns/controls that behavior.

Helper copy:

```text
If Jev pruning does not reduce context enough, allow ordinary DSH
summary compaction to continue.
```

Only expose settings that are implemented by the installed version.

---

# 43. Settings section — Provider

Header:

```text
Decision backend
```

Provider select:

```text
TypeSafe Jev
Custom System One endpoint
```

If local compatible backends are already supported, include:

```text
Jeff / compatible endpoint
```

but prefer a generic custom endpoint to hardcoding every compatible server.

Fields:

### `provider.type`

### `provider.baseUrl`

Text input.

### `provider.model`

Text input / select if known.

### API credential

Preferred UX:

```text
API key source: TYPESAFE_API_KEY
Status: configured / missing
```

Avoid round-tripping the actual secret into browser settings.

If DSH credentials API is supported by the target version, prefer a credential reference.

Otherwise expose:

```text
API key environment variable
[ TYPESAFE_API_KEY ]
```

and show only whether it resolves server-side.

Never send the raw resolved key to the browser.

---

# 44. Provider connection check

Optional but recommended.

Button:

```text
[Test connection]
```

It should perform a tiny server-side health/probe request.

Display:

```text
✓ Reachable · 241 ms
```

or:

```text
✕ Authentication failed
```

Do not run a paid semantic decision without making that behavior clear.

If TypeSafe has no free health endpoint, label:

```text
Test decision (~small API request)
```

This can be deferred if implementing a host RPC/route would significantly expand MVP scope.

---

# 45. Settings section — Advanced

Collapse by default.

Fields may include:

```text
Request timeout
Max concurrent Jev requests
State token budget
Tool argument preview chars
Result preview chars
Logging verbosity
Include candidate scores in logs
Dry-run diagnostics
```

Do not expose every internal constant.

Only values useful to real deployments belong in UI.

---

# 46. Runtime statistics block

Settings card SHOULD show a small read-only summary if metrics are already available.

Example:

```text
This process

Immediate shaping
  42 candidates
  18 shaped
  824 KB → 113 KB
  86.3% text saved

Historical compaction
  6 runs
  129 results stubbed
  ~188k tokens saved

Jev
  31 requests
  p50 280 ms
  1 timeout
```

This block is informational, not configuration.

If metrics are not yet available through Host→Client APIs, leave it for a later patch rather than blocking the settings card.

---

# 47. Settings save behavior

Follow DSH settings semantics:

- edits remain local until Save;
- Reset removes the user override and falls back to deployment default;
- stale-revision saves are rejected instead of overwriting newer settings;
- leaving with unsaved edits follows host settings UX;
- hot-reload/live settings should apply without process restart when safe.

The UI must visually distinguish:

```text
deployment default
user override
```

where DSH's settings scope supports it.

---

# 48. Live configuration updates

Recommended live-update support:

```text
enabled
thresholds
tool lists
timeouts
archive retention
logging
```

Potential restart-only settings:

```text
archive root path
storage backend type
```

If restart is required, mark it through DSH settings metadata rather than silently accepting a value that will not apply.

---

# 49. Validation

Validate both schema-level and cross-field constraints.

Examples:

```text
0 <= minClassificationConfidence <= 1
0 <= minSavingsRatio <= 1
thresholdChars >= 0
maxPerTurn >= 0
maxConcurrent >= 1
archive.retentionDays >= 0
historical.truncateThreshold <= historical.fullThreshold
```

Validate URL shape for provider endpoint.

Do not test network reachability as part of synchronous schema validation.

---

# 50. Settings schema split

Separate:

```ts
interface PluginConfig
```

from:

```ts
interface UserSettings
```

Not every deployment config value must be user-editable.

Example:

```ts
interface UserSettings {
  enabled?: boolean;

  resultShaping?: {
    enabled?: boolean;
    includeTools?: string[];
    thresholdChars?: number;
    maxPerTurn?: number;
    preserveErrors?: boolean;
    minSavingsRatio?: number;
  };

  historical?: {
    triggerRatio?: number;
    preserveRecentMessages?: number;
  };

  provider?: {
    type?: string;
    baseUrl?: string;
    model?: string;
    apiKeyEnv?: string;
  };
}
```

The resolved runtime config is still one normalized object.

---

# 51. Settings UI acceptance criteria

The feature is incomplete until:

- [ ] a "Jev Compaction" card appears in DSH Web Plugins settings;
- [ ] the card appears only when the host plugin namespace exists;
- [ ] enable/disable can be changed from the UI;
- [ ] immediate shaping can be enabled from the UI;
- [ ] tool allowlist can be edited;
- [ ] minimum result size can be edited;
- [ ] provider URL/model/key source can be configured or inspected;
- [ ] historical thresholds can be edited;
- [ ] archive behavior is visible;
- [ ] disabling archive while shaping is enabled shows a warning;
- [ ] Save persists through the DSH settings service;
- [ ] Reset restores deployment defaults;
- [ ] stale settings revisions do not overwrite newer state;
- [ ] raw API secrets never come back to the browser;
- [ ] README includes a screenshot/GIF after implementation.

---

# 52. Immediate shaping acceptance criteria

- [ ] implemented through `tools/post-execute`;
- [ ] async work observes `exec.signal`;
- [ ] downstream block decisions are preserved;
- [ ] downstream canonical `value` replacements are not overwritten;
- [ ] canonical tool `value` is never modified by this feature;
- [ ] errors are preserved by default;
- [ ] unsupported result blocks are preserved/skipped;
- [ ] default tool list is conservative;
- [ ] feature is opt-in initially;
- [ ] minimum savings gate works;
- [ ] low confidence means keep;
- [ ] timeout means keep;
- [ ] API error means keep;
- [ ] archive failure means keep original by default;
- [ ] reconstructed lines retain original ordering;
- [ ] omission markers state what happened without claiming certainty;
- [ ] historical compaction understands already-shaped markers;
- [ ] parallel tool calls do not break per-turn budgets;
- [ ] PTC/nested call behavior is explicitly tested or skipped;
- [ ] metrics distinguish shaping from historical pruning.

---

# 53. Tests — immediate shaping

Unit tests:

```text
small output → untouched
tool excluded → untouched
error → untouched
unknown content block → untouched
high repetition → candidate
low repetition but huge → candidate
low confidence → untouched
Jev failure → untouched
Jev timeout → untouched
small savings → untouched
routine cluster → collapsed
failure cluster → preserved
warning cluster → preserved
summary cluster → bounded preservation
line order preserved
head/tail pins preserved
```

---

# 54. Tests — middleware interoperability

Fixtures:

### Downstream accepts unchanged

```text
our listener → next() → accept
→ shape effective original content
```

### Downstream replaces content

```text
our listener → next() → accept(content=B)
→ shape B, not stale content A
```

### Downstream replaces value

```text
our listener → next() → accept(value=X)
→ do not shape
```

### Downstream blocks

```text
our listener → next() → block
→ preserve block exactly
```

### Cancellation

Abort while Jev request in progress:

```text
→ no shaped result
→ canonical cancellation semantics remain DSH-owned
```

---

# 55. Tests — persistence

This is especially important.

For an immediate-shaped result:

1. execute tool;
2. capture original rendered content;
3. archive original;
4. allow shaped result to persist;
5. reload session;
6. confirm replay sees shaped content;
7. confirm archive still contains original;
8. confirm hash/reference matches;
9. confirm historical compactor can later replace the shaped result safely.

Also test the no-archive configuration and document that original output is not recoverable through replay.

---

# 56. Tests — settings card

Host-side:

```text
namespace installs
base config layers correctly
user override wins
reset falls back to base
onChange updates live runtime config
invalid settings rejected
```

Client-side:

```text
card registers correct slot key
loads scope snapshot
shows resolved values
shows override state
save calls scope set/unset
stale revision error visible
archive warning visible
secret not rendered
```

Packaging:

```text
dsh.client entry exists
client bundle does not import Host-only runtime values
settings namespace name matches on Host and Client
```

---

# 57. Benchmark plan

Compare four modes on recorded tool outputs:

```text
A. no shaping
B. deterministic head/tail only
C. immediate Jev shaping
D. immediate shaping + historical Jev compaction
```

Datasets:

- `pnpm install`;
- `npm test`;
- TypeScript build;
- pytest;
- cargo test/build;
- git diff/status;
- linter output;
- grep/ripgrep;
- long shell progress;
- CI log excerpts.

Measure:

```text
persisted chars
estimated prompt tokens next turn
Jev latency
Jev input size
important-line recall
failure/warning recall
next-step task success
```

Primary quality metric:

> Did shaping remove information required for the very next agent decision?

Do not optimize only for compression ratio.

---

# 58. Rollout strategy

Recommended release sequence:

## Phase 0 — inspect current package

Before coding:

- inspect current `@yadsh/dsh-jev-compaction` source;
- map existing config object;
- identify current Jev client/backend interface;
- identify metrics/logging;
- identify whether a settings namespace/client entry already exists but is incomplete;
- verify target DSH version.

Deliver:

```text
docs/RESULT_SHAPING_SPIKE.md
```

---

## Phase 1 — settings card first

Implement the settings namespace and UI card before adding the destructive path.

Reason:

- user gets a visible opt-in;
- settings architecture stabilizes before adding more config;
- feature can ship disabled safely;
- avoids another release where functionality exists but cannot be managed from UI.

Exit:

```text
card visible
settings persist
runtime config updates
resultShaping toggle exists but feature may still be no-op
```

---

## Phase 2 — deterministic shaping skeleton

Implement:

- hook;
- eligibility;
- text extraction;
- segmentation;
- line-shape clustering;
- deterministic pins;
- reconstruction;
- dry-run metrics.

No Jev action yet.

Exit:

```text
recorded fixtures produce deterministic candidate plans
```

---

## Phase 3 — Jev classification

Implement:

- question builder;
- batching;
- confidence;
- timeout;
- fail-open;
- minimum savings;
- metrics.

Exit:

```text
resultShaping.enabled=true
can safely shape synthetic long logs
```

---

## Phase 4 — archive

Implement:

- archive abstraction;
- content hashing;
- local backend;
- retention GC;
- marker;
- archive failure policy.

Exit:

```text
immediate-shaped persisted result can be matched to archived original
after process restart
```

---

## Phase 5 — historical integration

Teach existing historical candidate collector:

```text
alreadyShaped
archiveRef
```

Ensure:

- no useless reclassification of omission markers;
- shaped outputs can later become historical stubs;
- archive markers survive if desired.

---

## Phase 6 — evaluation and release

Run corpus.

Tune defaults.

Keep shaping opt-in unless dangerous-loss rate is convincingly low.

Update:

```text
README
CHANGELOG
docs/configuration.md
NOTICE/research acknowledgements
npm metadata
```

Add settings screenshot.

---

# 59. Suggested normalized config

Final shape should be adapted to existing package config rather than blindly replacing it.

Conceptual target:

```yaml
enabled: true

provider:
  type: typesafe
  baseUrl: https://api.typesafe.ai/v1/systemone
  model: jev-latest
  apiKeyEnv: TYPESAFE_API_KEY
  timeoutMs: 2500

resultShaping:
  enabled: false

  includeTools:
    - bash
    - terminal
    - pwsh
    - run_command
    - execute_command
    - run_tests

  excludeTools: []

  thresholdChars: 12000
  hardLengthTriggerChars: 32000
  minLines: 80
  repetitionTriggerRatio: 0.45

  maxPerTurn: 2
  maxConcurrent: 2

  preserveErrors: true

  keepHeadLines: 8
  keepTailLines: 12

  minClassificationConfidence: 0.60

  minSavingsChars: 4000
  minSavingsRatio: 0.30

  requestTimeoutMs: 2500

archive:
  enabled: true
  retentionDays: 14
  maxBytes: 1073741824
  deduplicate: true
  onFailure: keep-original

historical:
  enabled: true
  triggerRatio: 0.70
  minSurfaceTokens: 32000

  preserveRecentMessages: 6
  preserveRecentTokens: 12000

  fullThreshold: 0.70
  truncateThreshold: 0.45

  minSavingsChars: 8000
  minSavingsRatio: 0.05

diagnostics:
  logLevel: info
  candidateScores: false
```

Do not duplicate provider timeout fields if the current package already has a single shared Jev client config.

---

# 60. Repository changes

Likely additions:

```text
src/
├── result-shaping/
│   ├── index.ts
│   ├── eligibility.ts
│   ├── text.ts
│   ├── normalize.ts
│   ├── cluster.ts
│   ├── pins.ts
│   ├── questions.ts
│   ├── policy.ts
│   ├── reconstruct.ts
│   └── metrics.ts
│
├── archive/
│   ├── index.ts
│   ├── store.ts
│   ├── local.ts
│   ├── hash.ts
│   └── gc.ts
│
├── settings/
│   ├── schema.ts
│   └── install.ts
│
└── client/
    ├── index.ts
    ├── settings-card.ts
    ├── settings-controller.ts
    └── locale.ts
```

Adapt to the real existing repository layout.

Do not restructure unrelated code merely to match this diagram.

---

# 61. Documentation requirements

README must gain:

## How context reduction works

```text
tool output
  → immediate shaping
  → active history
  → historical Jev pruning
  → normal summary fallback
```

## Safety note

Explicitly explain:

```text
Historical pruning keeps original session events.
Immediate shaping occurs before persistence; enable the original-output
archive if recoverability matters.
```

## Settings

Show:

```text
Settings → Plugins → Jev Compaction
```

with screenshot.

## Attribution

Credit the `dsh-jev` result-shaper idea.

---

# 62. Suggested UI copy

Short descriptions that can be reused directly.

### Plugin card subtitle

```text
Semantic result shaping and historical context compaction powered by Jev.
```

### Immediate shaping

```text
Reduce large repetitive tool outputs before they enter conversation history.
```

### Preserve errors

```text
Keep failed tool results unchanged. Recommended.
```

### Archive original output

```text
Save the full rendered result locally before immediate shaping so it can be
inspected later.
```

### Historical compaction

```text
When context grows, semantically prune stale historical tool results before
falling back to summary compaction.
```

### Provider

```text
Jev/System One endpoint used for semantic retention decisions.
```

### Fail-open helper

```text
If semantic evaluation fails or times out, keep the original content.
```

---

# 63. Important implementation warnings

### Do not return `{ kind: 'accept', content }` before calling `next()`

That can prevent other post-execute policies from running.

### Do not shape a downstream `value` replacement

Its renderer has not yet materialized in the current listener.

### Do not assume execution `value` survives replay

It does not.

### Do not treat content replacement as a confidentiality boundary

Canonical value still exists during live execution and may be visible to other runtime components.

### Do not shape errors by default

The exact failure is commonly what the next LLM request needs most.

### Do not claim "lossless"

Immediate shaping is extractive/context-reducing and can remove useful details.

### Do not make archive write latency unbounded

Use bounded I/O and fail safely.

---

# 64. Final product behavior

Target lifecycle:

```text
                ┌──────────────────┐
                │     Tool call    │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │   Tool executes  │
                └────────┬─────────┘
                         │
                         ▼
              tools/post-execute
                         │
                         ▼
       ┌────────────────────────────────┐
       │ Immediate Result Shaper        │
       │                                │
       │ small/important → keep         │
       │ huge repetitive → Jev          │
       │ uncertain/error → keep         │
       │ selected → archive + shape     │
       └───────────────┬────────────────┘
                       │
                       ▼
                 tool/result
                       │
                       ▼
                session grows
                       │
                       ▼
       ┌────────────────────────────────┐
       │ Historical Jev Compaction      │
       │                                │
       │ full → truncate → stub         │
       └───────────────┬────────────────┘
                       │
                       ▼
             still too much context?
                  │            │
                 no           yes
                  │            │
                  ▼            ▼
              continue     DSH summary
```

This turns `dsh-jev-compaction` into a coherent **semantic context lifecycle plugin**, rather than only a late-stage compactor.

---

# 65. Definition of done

The enhancement is done when:

- immediate result shaping exists and is opt-in;
- shaping uses `tools/post-execute` correctly;
- shaping is conservative and fail-open;
- originals can be archived locally;
- already-shaped outputs cooperate with historical compaction;
- settings are editable from a real DSH Plugins settings card;
- API secrets never round-trip to the browser;
- UI settings persist through the official DSH settings service;
- tests cover middleware ordering, persistence, replay and settings;
- README clearly distinguishes immediate shaping from replay-safe historical pruning;
- upstream inspiration is acknowledged;
- package can be published without requiring core DSH changes.

---

# 66. Sources used for this enhancement plan

DeepSeek Harness:

- Tool execution pipeline:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md

- Tool subsystem / PostToolDecision:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md

- User settings subsystem:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/settings.md

- Plugin configuration:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md

- Adding a settings card:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md

Inspiration:

- dsh-jev:
  https://github.com/zhangxaochen/dsh-jev

- dsh-jev result-shaper configuration:
  https://github.com/zhangxaochen/dsh-jev/blob/master/docs/configuration.md
