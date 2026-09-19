/**
 * Question construction (SPEC §12).
 *
 * v1 asks two semantic preservation questions per candidate: whether the
 * substantive contents are still needed, and whether they must remain
 * verbatim rather than collapse into a short replay marker.
 */

import type { ToolResultCandidate } from "../planner/collect.js";
import type { JevQuestion } from "./types.js";

/** Build the question list for one batch of candidates. */
export function questionsFor(
  candidates: readonly ToolResultCandidate[],
): JevQuestion[] {
  const questions: JevQuestion[] = [];
  for (const candidate of candidates) {
    const name = candidate.callId;
    const tool = candidate.toolName ?? "unknown";
    questions.push({
      name: `needContents_${name}`,
      instructions:
        `Does the agent still need the substantive contents of tool result ${name} ` +
        `(${tool}, ${candidate.originalChars} chars, args ${candidate.toolArgumentsPreview ?? "{}"}) ` +
        "to correctly continue the user's current task?",
    });
    questions.push({
      name: `needVerbatim_${name}`,
      instructions:
        `Does tool result ${name} need to remain substantially verbatim, rather than ` +
        "being replaced by a short replay marker describing the tool and the fact that its " +
        "old output was pruned (the original stays recoverable from the session log)?",
    });
  }
  return questions;
}
