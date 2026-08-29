import { isAgentLoopRequest, type GenerateOptions } from "@deepseek-ai/dsh-llm";
import type { RequestKind } from "../shared/telemetry.js";

/** Classify main loop and known auxiliary calls without inspecting prompts. */
export function classifyRequest(options: GenerateOptions): RequestKind {
  if (options.purpose === "compaction") return "compaction";
  if (options.purpose === "session-title") return "session-title";
  if (isAgentLoopRequest(options)) return "agent";
  if (options.purpose === undefined) return "one-shot";
  return "unknown";
}
