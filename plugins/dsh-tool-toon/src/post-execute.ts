import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import { resolvePostExecuteContent } from "@yadsh/dsh-plugin-kit/post-execute";
import type { PluginLoggerLike } from "@yadsh/dsh-plugin-log";
import type { ResolvedToolToonConfig } from "./config.js";
import { formatJsonText } from "./format.js";

export type ToolToonListener = (
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>;

export function createPostExecuteListener(
  config: ResolvedToolToonConfig,
  logger: PluginLoggerLike,
): ToolToonListener {
  return async (exec, result, next) => {
    const decision = await next();
    try {
      if (
        !config.enabled ||
        result.isError ||
        exec.parent !== undefined ||
        config.excludeTools.includes(exec.name)
      )
        return decision;
      const effective = resolvePostExecuteContent(decision, result.content);
      if (effective.kind !== "content") return decision;
      let changed = false;
      const content = effective.content.map((block) => {
        if (block.type !== "text") return block;
        const text = formatJsonText(block.text, config);
        if (text === null) return block;
        changed = true;
        return { ...block, text };
      });
      if (!changed) return decision;
      logger.debug("toon.formatted", { tool: exec.name });
      return { ...effective.decision, content };
    } catch {
      // Never log data-bearing codec errors: tool payloads may be sensitive.
      logger.warn("toon.format_failed", { tool: exec.name });
      return decision;
    }
  };
}
