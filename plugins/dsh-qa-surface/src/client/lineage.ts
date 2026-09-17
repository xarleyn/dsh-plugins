import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";

/**
 * Whether one session-list entry is a delegated child — a subagent's session —
 * rather than a chat.
 *
 * A delegated run is an implementation detail of a single answer: the Host
 * refuses to attest it, its sources reach the parent chat through the
 * provenance inheritance flow, and it has no owner. The host list the surface
 * already follows carries both marks (`origin` and `parentId`), so every
 * projection that talks about chats asks this one question instead of
 * re-deriving it — and a chat row, a chat count and a claim batch can never
 * disagree about what a chat is.
 */
export function isDelegatedSession(
  summary: Pick<SessionSummary, "origin" | "parentId"> | undefined,
): boolean {
  if (summary === undefined) return false;
  return summary.origin === "subagent" || summary.parentId !== undefined;
}
