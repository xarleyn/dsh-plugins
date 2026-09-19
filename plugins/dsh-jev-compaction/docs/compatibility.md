# Phase 0 compatibility findings — DSH 0.1.5-rc.2

Verified against the DeepSeek Harness source checkout `dsh-v0.1.5-rc.2`
(release commit `a305303422`). Every fact below was read from the harness
source before any mutation code was written (SPEC §25). Harness source paths
are quoted relative to the harness repository root.

## 1. `agent/pre-step`

- Payload: `{ agent, messages, turn, step, signal }`; listener signature
  `(payload, next) => Promise<PreStepDecision>`; `PreStepDecision` is
  `{ kind: 'reject' } | { kind: 'enter'; messages; startsRequestSeries? }`.
  (`packages/core/agent/src/runtime-types.ts`)
- Dispatched as a Cordis waterfall from `packages/core/agent-loop/src/agent.ts`
  (pre-step claims inbox messages, then `dispatch.waterfall('agent/pre-step', …)`).
- Cordis waterfall listeners run **outermost-first in hook-array order**;
  `ctx.on(name, listener, { prepend: true })` unshifts the listener to the
  head, so it runs **before** listeners registered without options.
  `dsh-compaction-basic` registers its pressure listener **without options**
  (appended), so a prepended plugin listener always runs before built-in
  pressure compaction regardless of registration order. Composition:
  `dsh-jev-compaction → next() → dsh-compaction-basic → default enter`.
- Built-in compaction never rewrites the decision; it mutates the session
  surface and calls `next()`. We do the same.

## 2. Reading the surface

- `session.surface: { nodes: readonly SessionSeq[]; replaceGeneration: number }`
  — nodes are raw seqs in model-visible order; `replaceGeneration` increments
  once per landed positional replacement.
- `session.eventAt(seq)` returns the logged event; `session.snapshotEvents()`
  returns a frozen full-log slice (used to build the callId → tool/call index).

## 3. Replay-safe `tool/result` replacement

- `session.append('tool/result', data, { surfaceOp: { op: 'replace', startSeq,
  endSeq }, sourceEventSeqs: [seq] })`.
- Session-level checks (`packages/core/session/src/surface.ts`):
  - a `tool/result` replacement must shadow **exactly one** current surface
    node, and that node must be a `tool/result`;
  - `sourceEventSeqs` must be non-empty, duplicate-free, and must include
    every shadowed surface node;
  - after blanking `message.content[0].content` on both sides, the rest of
    the event data must be deep-equal — `turn`, `step`, `error`, `meta` and
    `message.source.callId` are preserved verbatim; **only the textual
    content of the first tool-result block may change**.
- Replay (`foldSurface`) splices the replacement into the shadowed position;
  the token meter's own surface fold applies replace ops the same way and
  re-prices the replacement node, so no per-plugin accounting is needed.

## 4. Open-turn invariant (drives the manual-mode design)

`packages/core/session/src/invariant.ts` (companion plugin
`session-invariant`, part of the shipped SDK bundle composition):

> a `tool/result` surface replacement appended **outside any open turn**
> fails the invariant.

Consequences:

- **Automatic mode** (prepended `agent/pre-step` listener) runs inside the
  open turn — replacements are legal there.
- **Manual command** (`/jev-compact`) executes with **no open turn** (the
  same reason `dsh-compaction-basic`'s manual path records a standalone
  `turn: null` bracket). Appending a replacement from the command handler
  would be rejected when session invariants are active — which they are in
  the host runtime.

Therefore the manual non-dry-run path **queues** the request; the next
`agent/pre-step` re-runs the pipeline (fresh snapshot, fresh scores) with the
pressure/cooldown gates bypassed and applies the plan inside the open turn.
The command replies with a plan preview and the queue notice. A stale queue
entry (surface changed before the next step) is dropped fail-open.

## 5. Token meter and context window

- `ctx.tokenMeter.measure(session)` → `{ totalTokens, surfaceTokens,
  surfaceDeltaTokens, baseline, nodes: [{ seq, tokens, heuristicTokens }] }`;
  `ctx.tokenMeter.estimateMessage(message)` prices one message. Per-node
  prices cover **all** surface nodes, which drives the recent-tokens pin.
- Context capacity is **optional**:
  `session.requestHeader()?.config` → `{ provider, model }` →
  `ctx.llm.resolveModelInfo(provider, model, signal).context?.contextWindow`.
  When the capacity is unknown the trigger falls back to
  `trigger.minSurfaceTokens` on `totalTokens` instead of guessing a ratio.
- `dsh-compaction-basic` qualifies pressure at
  `floor(contextWindow * thresholdRatio)` with default ratio `0.8`; our
  default `trigger.contextRatio` of `0.70` sits strictly below it, so Jev
  pruning gets the first attempt.

## 6. Slash commands

- `ctx.commands.register({ name, description, input?, handler })`; handler
  receives `{ commandId, agent, rawInput, attachments, signal }` and returns
  `{ kind: 'success', text? } | { kind: 'error', text }`.
- Registration is deferred through `ctx.inject(['commands'], …)` (host
  service); duplicate command names throw.

## 7. Built-in deterministic pruner

`ctx.toolResultPruner` (head/middle/tail, size-based) is invoked by
`dsh-compaction-basic` inside its pressure path before range selection. With
our prepended listener the effective composition is
**Jev first → deterministic pruner → summary**, the SPEC §6.5 option A.

## 8. Deliberate omissions in v1

- **No `compaction/prune` shadow-price events.** That log-only pricing event
  is the built-in pruner's protocol; the meter re-prices replacements
  natively (§3), and emitting it would pull a type-only dependency outside
  this repository's pnpm catalogs. Downstream consumers simply see a
  replacement with no shadow-price record.
- **No durable plugin events** (SPEC §28): nothing custom enters the session
  log, so the journal stays readable in builds without this plugin.

## 9. Supported versions

- Tested: DSH 0.1.5-rc.2 (`>=0.1.5-rc.2 <0.2.0` declared).
- All DSH-version-specific code is isolated in `src/dsh/`; everything outside
  operates on normalized internal types.
