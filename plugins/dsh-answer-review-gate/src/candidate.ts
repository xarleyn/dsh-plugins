/**
 * Candidate collection and identity.
 *
 * At a turn-stopping boundary the candidate final answer is the session's
 * latest committed assistant message (`SPEC.md`, "session/event"): read from
 * the durable session surface, never from plugin-private text state, so a
 * restarted process reviews the real history. The candidate identity is a
 * SHA-256 digest of the normalized text — a review PASS applies to exactly
 * that content and is invalidated by any later edit.
 */

import { createHash } from "node:crypto";

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

import {
  collectReviewWaiver,
  type ReviewWaiverEvidence,
  type WaiverSession,
} from "./waiver.js";

/** Minimal structural view of a session the collector reads. */
export interface CandidateSession extends WaiverSession {
  /** Model-visible event sequences in order. */
  readonly surface: { readonly nodes: readonly number[] };
  eventAt(
    seq: number,
  ): { readonly type: string; readonly data: unknown } | undefined;
}

/** The candidate plus the user request it answers, when both were located. */
export interface CollectedCandidate {
  readonly text: string;
  /** Latest real user message before the candidate; null when not found. */
  readonly requestText: string | null;
  /**
   * Surface seq of that user request — the identity of the user turn this
   * candidate belongs to; null when no real user message was found.
   *
   * Agent turns are not user turns: one user request spends several agent
   * turns (a revision steered back to the primary continues the same agent
   * turn, a settlement notice opens a new one), so the review budget and the
   * PASS receipt must be keyed by this, never by the agent-turn counter.
   */
  readonly requestSeq: number | null;
  /** Verified structured waiver for this exact request, when present. */
  readonly reviewWaiver: ReviewWaiverEvidence | null;
}

/** Model-visible text of one content-block list. */
export function textOfBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(
      (block): block is Extract<ContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Collect the candidate final answer: the latest `assistant/message` surface
 * event. An interrupted (truncated) latest message is not a candidate — the
 * turn did not produce a finished answer.
 */
export function collectCandidate(
  session: CandidateSession,
): CollectedCandidate | null {
  const nodes = session.surface.nodes;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const event = session.eventAt(nodes[i]!);
    if (event === undefined || event.type !== "assistant/message") continue;
    const data = event.data as {
      readonly interrupted?: true;
      readonly message?: { readonly content: readonly ContentBlock[] };
    };
    if (data.interrupted === true) return null;
    if (data.message === undefined) return null;
    const text = textOfBlocks(data.message.content);
    if (text === "") return null;
    const candidateSeq = nodes[i]!;
    const request = collectUserRequest(session, candidateSeq);
    return {
      text,
      requestText: request?.text ?? null,
      requestSeq: request?.seq ?? null,
      reviewWaiver:
        request === null
          ? null
          : collectReviewWaiver(
              session,
              request.messageId,
              request.seq,
              candidateSeq,
            ),
    };
  }
  return null;
}

/** Latest real user message at or before `beforeSeq` (tool and plugin sources excluded). */
function collectUserRequest(
  session: CandidateSession,
  beforeSeq: number,
): {
  readonly text: string;
  readonly seq: number;
  readonly messageId: string | null;
} | null {
  const nodes = session.surface.nodes;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const seq = nodes[i]!;
    if (seq > beforeSeq) continue;
    const event = session.eventAt(seq);
    if (event === undefined || event.type !== "user/message") continue;
    const data = event.data as {
      readonly id?: unknown;
      readonly source?: { readonly kind?: string };
      readonly content?: readonly ContentBlock[];
    };
    if (data.source?.kind !== "user") continue;
    const text = textOfBlocks(data.content ?? []);
    if (text !== "") {
      return {
        text,
        seq,
        messageId: typeof data.id === "string" ? data.id : null,
      };
    }
  }
  return null;
}

/** Collapse encoding noise so cosmetic edits do not invalidate a PASS. */
export function normalizeCandidateText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Stable candidate identity: SHA-256 over the normalized text. */
export function candidateHash(text: string): string {
  return createHash("sha256")
    .update(normalizeCandidateText(text), "utf8")
    .digest("hex");
}
