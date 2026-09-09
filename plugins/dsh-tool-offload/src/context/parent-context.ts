/**
 * ParentContextExtractor (SPEC §9.3).
 *
 * The worker needs to know what matters without copying the parent's whole
 * conversation: the bounded latest *human* user message is enough for the MVP
 * (SPEC §9.3 explicitly allows shipping latest user message + tool call
 * only). Assistant text is not reliably reachable from this seam and is
 * therefore not included.
 *
 * Access to `agent.session` stays structural on purpose: the plugin does not
 * declare `dsh-agent`/`dsh-session` peers, so session shape drift degrades to
 * "parent task unavailable" instead of breaking the host.
 */

import type { ToolExecution } from "@deepseek-ai/dsh-tools";

import type { ResolvedToolOffloadConfig } from "../config.js";
import { sanitizeBoundaryTags, truncateHead } from "../utils/text.js";

type ParentAgent = NonNullable<ToolExecution["agent"]>;

export function extractParentTask(agent: ParentAgent | undefined, config: ResolvedToolOffloadConfig): string | null {
  if (!agent || !config.context.includeLastUserMessage) return null;
  try {
    const events = readSessionEvents(agent);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const text = readHumanMessageText(events[index]);
      if (text !== null) {
        return sanitizeBoundaryTags(truncateHead(text, config.context.maxParentContextBytes));
      }
    }
  } catch {
    // Session introspection is best-effort; the worker prompt renders a
    // placeholder when no parent task is available.
  }
  return null;
}

function readSessionEvents(agent: ParentAgent): readonly unknown[] {
  const session = (agent as { session?: { events?: readonly unknown[] } }).session;
  return session?.events ?? [];
}

/**
 * Recognize a user/message event carrying a human-authored message. The
 * `source.kind === "user"` check separates real task messages from
 * plugin-injected user-role context.
 */
function readHumanMessageText(event: unknown): string | null {
  const record = event as { type?: unknown; data?: unknown } | undefined;
  if (record?.type !== "user/message") return null;
  const data = record.data as { source?: { kind?: unknown }; content?: unknown } | undefined;
  if (data?.source?.kind !== "user") return null;
  const content = data.content;
  if (!Array.isArray(content)) return typeof data.content === "string" ? data.content : null;
  const parts: string[] = [];
  for (const block of content) {
    const text = (block as { type?: unknown; text?: unknown } | undefined)?.text;
    if ((block as { type?: unknown } | undefined)?.type === "text" && typeof text === "string") parts.push(text);
  }
  const joined = parts.join("\n").trim();
  return joined === "" ? null : joined;
}
