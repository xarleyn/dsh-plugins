/**
 * The `tools/post-execute` listener (result-shaping SPEC §7, §8, §63).
 *
 * The shaper is an *outer post-processor*, not a filter: it calls `next()`
 * first so every later listener gets to block or replace the result, and only
 * then does it consider shaping whatever survived.
 *
 *   our listener → next() → downstream decision
 *                            ├─ block            → returned untouched
 *                            ├─ accept(value=X)  → returned untouched: the
 *                            │                     renderer for X has not run
 *                            │                     yet, so there is nothing
 *                            │                     to shape
 *                            └─ accept(content)  → shaped, and the accepted
 *                                                  decision is preserved
 *
 * Returning `{ kind: 'accept', content }` before `next()` would stop the other
 * post-execute policies from running, and a throwing listener turns a
 * successful tool call into an error — both are contained here instead.
 */

import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";

import type { ResolvedJevCompactionConfig } from "../config.js";
import type { ShapeSkipReason } from "./metrics.js";
import type { ImmediateResultShaper } from "./shaper.js";

/** The listener shape registered on `tools/post-execute`. */
export type PostExecuteListener = (
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>;

export interface PostExecuteOptions {
  readonly shaper: ImmediateResultShaper;
  readonly readConfig: () => ResolvedJevCompactionConfig;
  /** Reserves this turn's request budget for one execution. */
  readonly reserveBudget: (exec: ToolExecution, chars: number) => boolean;
  /** Current user goal for the classifier's state. */
  readonly goalFor: (exec: ToolExecution) => string;
  readonly onSkip: (
    reason: ShapeSkipReason,
    details: Record<string, unknown>,
  ) => void;
}

/** Initial decision of a tool call this plugin runs itself (future tools). */
const OWN_TOOL_PREFIX = "jev_compaction";

export function createPostExecuteListener(
  options: PostExecuteOptions,
): PostExecuteListener {
  const { shaper, readConfig, reserveBudget, goalFor, onSkip } = options;

  return async (exec, result, next) => {
    // Run the rest of the chain first: it owns the block/replace decisions.
    const downstream = await next();
    try {
      if (downstream.kind !== "accept") {
        onSkip("downstream-block", { tool: exec.name });
        return downstream;
      }
      if ("value" in downstream && downstream.value !== undefined) {
        // A downstream plugin replaced the canonical value. Its renderer has
        // not materialized in this listener, so there is no content to shape
        // and no way to guess what it will look like.
        onSkip("downstream-value-replacement", { tool: exec.name });
        return downstream;
      }
      const config = readConfig();
      if (!config.resultShaping.enabled) return downstream;
      // Nested code-mode/PTC dispatches never reach the model as their own
      // result: shaping them would be invisible at best (SPEC §28).
      if (exec.parent !== undefined) {
        onSkip("nested-dispatch", { tool: exec.name });
        return downstream;
      }
      if (exec.name.startsWith(OWN_TOOL_PREFIX)) {
        onSkip("own-result", { tool: exec.name });
        return downstream;
      }

      const content = downstream.content ?? result.content;
      const session = exec.agent?.session;
      const sessionId =
        session === undefined ? undefined : String(session.header.id);

      const outcome = await shaper.maybeShape({
        callId: String(exec.callId),
        toolName: exec.name,
        ...(sessionId === undefined ? {} : { sessionId }),
        isError: result.isError,
        content,
        argumentsPreview: argumentsPreview(exec.arguments, config),
        goal: goalFor(exec),
        signal: exec.signal,
        reserve: (chars) => reserveBudget(exec, chars),
      });
      if (outcome === undefined) return downstream;

      // Preserve every other field of the accepted decision
      // (`additionalContexts` in particular): only `content` is ours.
      return { ...downstream, content: outcome.content };
    } catch (error: unknown) {
      // A throw here would turn a successful tool call into a failed one.
      onSkip("jev-error", {
        tool: exec.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return downstream;
    }
  };
}

/** Bounded tool-argument preview for the classifier's state. */
function argumentsPreview(
  args: unknown,
  config: ResolvedJevCompactionConfig,
): string | undefined {
  const limit = config.state.toolInputChars;
  if (limit <= 0) return undefined;
  const serialized =
    typeof args === "string" ? args : JSON.stringify(args ?? null);
  if (serialized === undefined || serialized === null) return undefined;
  return serialized.length <= limit
    ? serialized
    : `${serialized.slice(0, Math.max(0, limit - 1))}\u2026`;
}
