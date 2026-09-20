# Result-shaping Phase 0: DSH seam findings

**Status:** Complete — verified against the installed harness  
**Date:** 2026-09-20  
**Harness:** `0.1.5-rc.2` (`@deepseek-ai/dsh-tools`, `dsh-settings`,
`dsh-client-ui-settings`, `dsh-client-ui-settings-plugins`,
`dsh-client-ui-slots` are all `0.1.5-rc.2` in this workspace)

This is the Phase 0 deliverable of
[the result-shaping specification](./specs/result-shaping.md) §58. Every
statement below was checked against the sources, not assumed.

## 1. `tools/post-execute` exists and is a waterfall

```ts
'tools/post-execute'(
  this: Scoped<ToolRuntime>,
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
): Promise<PostToolDecision>
```

`ctx.waterfall` makes the **first** registered listener the outermost one, so
`{ prepend: true }` is what makes the shaper an outer post-processor: it calls
`next()` and receives whatever the rest of the chain decided.

```ts
export type PostToolDecision =
  | {
      kind: "accept";
      content?: ContentBlock[];
      value?: never;
      additionalContexts?: UserMessage[];
    }
  | {
      kind: "accept";
      value: JsonValue;
      content?: never;
      additionalContexts?: UserMessage[];
    }
  | {
      kind: "block";
      feedback: ContentBlock[];
      additionalContexts?: UserMessage[];
    };
```

Hard rules the implementation respects:

- `content` and `value` are mutually exclusive on one decision (the registry
  throws otherwise);
- a `value` replacement is re-validated against the tool's output schema and
  re-rendered, which discards any `content` the same decision carried — so the
  shaper uses `content` only;
- a `value` replacement on a failed result is a `TypeError`;
- a **throwing listener turns a successful call into `isError`**, which is why
  every path in `result-shaping/hook.ts` is wrapped.

## 2. Ordering: shaping is pre-persistence

```text
tools/pre-execute → guards → tools/execute → tool body → tools/post-execute
   → ToolDefinition.finalizeContent → tools/result → durable tool/result
```

The durable `tool/result` event is appended by the agent loop _after_
`tools/result`, so content replaced at `tools/post-execute` is what persists —
and `exec.value` is deliberately omitted from durable events. That asymmetry is
the whole reason this feature ships with an archive and off by default.

## 3. Interaction with DSH's own result bounding

`@deepseek-ai/dsh-spill-policy` is enabled in the default preset
(`maxInlineBytes: 50000`) and **registers on the same event with
`{ prepend: true }`**. Both listeners therefore call `next()`; whichever is
outermost sees the other's result. Two consequences:

- an already-bounded result must not be shaped again — the shaper detects the
  spill notice (`Full formatted result stored at:`), the tool-result pruner's
  marker (`[... tool result middle pruned ...]`) and its own markers, and skips;
- a shaped result must stay small enough that spill does not immediately bound
  it again for a different reason.

`@deepseek-ai/dsh-compaction-tool-result-pruner` rewrites the session surface
instead of hooking post-execute, so it runs later and is unaffected.

## 4. Nested code-mode dispatches

`exec.parent !== undefined` marks a sub-dispatch the model never sees as its
own result. The shaper skips those. `exec.name === "read"` is not special-cased
here (unlike spill-policy) because the tool allowlist already decides what may
be shaped, and file reads are not in the default list.

## 5. Settings seam

Host: `ctx.settings.installSection(owner, ns, schema, entry, hooks)` with
`{ setSource, onChange, validate? }`. The section keeps the composition entry as
its base layer and hands back the resolved scope as the active source; the
`onChange` hook fires at attach, at detach and on every committed change, which
is what makes the settings card live rather than restart-scoped.

Browser: the `settings.plugin.item` keyed slot, **keyed by the namespace**
(`settings.plugins.tab` is the containing tab, not a registration target), and
`ctx.settingsScope.bind({ namespace })` for reads and writes. Overrides are
detected by presence in the raw user layer, not by comparing values.

The namespace `jev-compaction` is declared once in `src/shared/settings.ts`, a
dependency-free module so the card bundle inlines a string and not Schemastery.

## 6. Client packaging

`dsh.client = { platform: "web", inject: [...], external: [...] }` plus an
`exports["./client"]` entry; the artifact is a classic bundle that calls
`window.__ModuleLoader__.load({ id, factory })` with the **full package name**
as `id`. `@yadsh/dsh-plugin-kit/client` supplies the canonical card shell, so
the bundle stays inside the AGENTS.md card contract; `verify:package` asserts
it.

## 7. Decisions taken from these findings

| Finding                                        | Decision                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Content replacement is durable and pre-archive | Feature is opt-in, errors are preserved, and the original is archived by default                             |
| `next()`-outer composition is supported        | The shaper never short-circuits: it runs after the chain and preserves blocks and value replacements         |
| Spill policy already bounds large results      | Bounded results are skipped, and the shaper never removes a locator                                          |
| A throwing listener fails the tool call        | The listener contains every failure and returns the downstream decision                                      |
| The settings card needs no Remote namespace    | The card is configuration-only; no metric or health claim is rendered that the Host did not actually produce |

## 8. Upstream inspiration

The immediate-shaping concept is adapted from the `typesafe-result-shaper`
module of [`zhangxaochen/dsh-jev`](https://github.com/zhangxaochen/dsh-jev)
(MIT). That module normalizes each line to a shape, classifies shape clusters
with a bounded Jev request, keeps `warning`/`failure` clusters and replaces the
rest with a drop marker.

This implementation keeps the line-shape idea and differs deliberately where
this plugin's model demands it:

- **contiguous runs only** — a run is a maximal block of adjacent same-shape
  lines, so reconstruction is order-preserving by construction and scattered
  identical lines are never merged;
- **deterministic pins first** — head, tail, conclusions, failures and
  diagnostics are pinned before classification, and a pin splits a run;
- **two questions, one decision** — routine _and_ "would dropping this hurt"
  must be decisively apart, so a mid-range probability keeps the lines;
- **a minimum-savings gate** — a shaping that saves little is discarded;
- **an archive** — because this pipeline runs before persistence, unlike a
  surface rewrite.
