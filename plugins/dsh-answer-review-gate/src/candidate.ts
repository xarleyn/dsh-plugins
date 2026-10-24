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

import { fileHandleText, type ContentBlock } from "@deepseek-ai/dsh-llm";

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
  /** Immutable event position of the exact answer reviewed. */
  readonly candidateSeq: number;
  readonly text: string;
  /** Latest real user message before the candidate; null when not found. */
  readonly requestText: string | null;
  /**
   * Handle text for every attachment (image/file) the located user request
   * carried. Image descriptions never assert a model capability; the original
   * image blocks travel separately so the Host can apply the selected route's
   * image policy. File handles retain their explicit access limitation.
   */
  readonly requestAttachments: readonly string[];
  readonly requestImages: readonly Extract<ContentBlock, { type: "image" }>[];
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
 * Handle text for the non-text (image/file) blocks of one content-block list.
 *
 * The companion of `textOfBlocks`: where that keeps only text, this renders
 * each attachment without inventing model capabilities. Images also travel as
 * native blocks; only the Host knows whether the selected model accepts them.
 */
export function attachmentHandleTexts(
  blocks: readonly ContentBlock[],
): readonly string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "file") {
      lines.push(fileHandleText(block.attachment, undefined));
    } else if (block.type === "image") {
      const ref = block.attachment;
      lines.push(
        `Image ${JSON.stringify(ref.name ?? "unnamed")} (${ref.attachmentId}; ` +
          `normalized attachment ${String(ref.width)}x${String(ref.height)}px, ${ref.mediaType}).`,
      );
    }
  }
  return lines;
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
      candidateSeq,
      text,
      requestText: request?.text ?? null,
      requestAttachments: request?.attachments ?? [],
      requestImages: request?.images ?? [],
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

/** Latest real user message at or before `beforeSeq` (every other producer source excluded). */
function collectUserRequest(
  session: CandidateSession,
  beforeSeq: number,
): {
  readonly text: string;
  readonly seq: number;
  readonly messageId: string | null;
  readonly attachments: readonly string[];
  readonly images: readonly Extract<ContentBlock, { type: "image" }>[];
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
    const content = data.content ?? [];
    const text = textOfBlocks(content);
    if (
      text !== "" ||
      content.some((block) => block.type === "image" || block.type === "file")
    ) {
      return {
        text,
        seq,
        messageId: typeof data.id === "string" ? data.id : null,
        attachments: attachmentHandleTexts(content),
        images: content.filter(
          (block): block is Extract<ContentBlock, { type: "image" }> =>
            block.type === "image",
        ),
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

/**
 * The review-disputation head: a draft that opens by naming the act of
 * disputing — `Опровержение вывода ревизора: …`, `Rebuttal of the reviewer's
 * finding: …` — and names the review it disputes in the same opening line.
 * Either half alone is ordinary prose, so both are required: an answer may
 * refute a benchmark, and an answer may discuss a code review.
 *
 * The two halves must also be fed by different words. `провер` is the stem of
 * `опровержение` itself, so an unguarded stem lets one Russian word answer both
 * halves and every legitimate «Опровержение мифа …» reads as the leak; the
 * lookbehind keeps the stem for «вывод проверки» while refusing the overlap.
 * `\b` cannot do this job — in Unicode mode JavaScript still defines a word
 * character as ASCII, so no boundary separates two Cyrillic letters.
 */
const DISPUTATION_HEAD =
  /^(?:опроверж|опроверг|rebut|refut|disproof|disprov|disagree)/iu;
const REVIEW_HEAD = /ревизор|ревью|рецензент|review|(?<!о)провер/iu;
const MAX_HEAD_CHARS = 240;

/**
 * Whether the candidate opens with the review rather than with an answer. The
 * primary is steered to answer the request alone; a draft that opens with its
 * disagreement is the review leaking into user-visible output, so the first
 * such draft of a reviewed turn is neither handed to a reviewer nor certified
 * (`SPEC.md`, "Revision behavior").
 */
export function opensWithReviewDisputation(text: string): boolean {
  const line = text.split("\n").find((candidate) => candidate.trim() !== "");
  if (line === undefined) return false;
  const head = line
    .trim()
    .replace(/^[[({*_>#\-'"]+/u, "")
    .slice(0, MAX_HEAD_CHARS);
  return DISPUTATION_HEAD.test(head) && REVIEW_HEAD.test(head);
}

/** Stable candidate identity: SHA-256 over the normalized text. */
export function candidateHash(text: string): string {
  return createHash("sha256")
    .update(normalizeCandidateText(text), "utf8")
    .digest("hex");
}
