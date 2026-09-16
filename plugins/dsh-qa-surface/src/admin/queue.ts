import type {
  QaConversationReview,
  QaMessageFeedback,
  QaReviewPriority,
  QaReviewQueueItem,
  QaReviewStatus,
} from "../types.js";
import type { QaManualQueueEntry } from "./quality-store.js";

/**
 * The review queue is derived, never stored as its own list: every entry is a
 * signal that still exists — an unanswered negative rating, a deliberate
 * "send to review", a failed tool call — plus the review that answers it. That
 * is what keeps the queue honest when a review is edited or a rating changed.
 *
 * The one exception is the manual entry, which is a reviewer's own act and has
 * no other record; it lives in the quality store.
 */

/** Reasons that point at a broken answer rather than at user preference. */
const HIGH_PRIORITY_REASONS = new Set([
  "incorrect",
  "instruction_not_followed",
  "missing_information",
  "outdated_information",
  "tool_issue",
]);

/** A tool call that failed inside one conversation, found while projecting it. */
export interface QaToolFailureSignal {
  readonly conversationId: string;
  readonly messageId?: string;
  readonly at: string;
}

export interface QaQueueInput {
  readonly feedback: readonly QaMessageFeedback[];
  readonly reviews: readonly QaConversationReview[];
  readonly manual: readonly QaManualQueueEntry[];
  readonly failures?: readonly QaToolFailureSignal[];
}

function statusOf(
  reviews: readonly QaConversationReview[],
  conversationId: string,
  messageId: string | undefined,
): {
  readonly status: QaReviewStatus;
  readonly review: QaConversationReview | undefined;
} {
  const covering = reviews.filter(
    (row) =>
      row.conversationId === conversationId &&
      (messageId === undefined ||
        row.messageId === undefined ||
        row.messageId === messageId),
  );
  if (covering.length === 0) return { status: "unreviewed", review: undefined };
  const followUp = covering.find((row) => row.status === "needs_followup");
  if (followUp !== undefined)
    return { status: "needs_followup", review: followUp };
  const newest = [...covering].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];
  return { status: "reviewed", review: newest };
}

function priorityOf(
  reason: QaReviewQueueItem["reason"],
  feedback: QaMessageFeedback | undefined,
): QaReviewPriority {
  if (reason === "negative_feedback" && feedback !== undefined) {
    return (feedback.reasons ?? []).some((value) =>
      HIGH_PRIORITY_REASONS.has(value),
    )
      ? "high"
      : "normal";
  }
  // An auto-derived tool failure is a lead, not a verdict; a human decides
  // whether it matters by looking at the conversation.
  return reason === "tool_failure" ? "low" : "normal";
}

const PRIORITY_ORDER: Readonly<Record<QaReviewPriority, number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * Build queue rows, newest signal first within a priority band. A conversation
 * reached by several signals appears once per answered target, so a reviewer
 * can see that the same chat was rated down twice.
 */
export function deriveQueue({
  feedback,
  reviews,
  manual,
  failures = [],
}: QaQueueInput): readonly QaReviewQueueItem[] {
  const items: QaReviewQueueItem[] = [];

  for (const row of feedback) {
    if (row.rating !== "negative") continue;
    const { status, review } = statusOf(
      reviews,
      row.conversationId,
      row.messageId,
    );
    items.push({
      conversationId: row.conversationId,
      messageId: row.messageId,
      reason: "negative_feedback",
      priority: priorityOf("negative_feedback", row),
      status,
      raisedAt: row.createdAt,
      feedbackId: row.id,
      ...(review === undefined
        ? {}
        : { reviewId: review.id, reviewerId: review.reviewerId }),
    });
  }

  for (const entry of manual) {
    const { status, review } = statusOf(
      reviews,
      entry.conversationId,
      entry.messageId,
    );
    items.push({
      conversationId: entry.conversationId,
      ...(entry.messageId === undefined ? {} : { messageId: entry.messageId }),
      reason: "manual",
      priority: priorityOf("manual", undefined),
      status,
      raisedAt: entry.createdAt,
      ...(review === undefined
        ? {}
        : { reviewId: review.id, reviewerId: review.reviewerId }),
    });
  }

  for (const failure of failures) {
    const { status, review } = statusOf(
      reviews,
      failure.conversationId,
      failure.messageId,
    );
    items.push({
      conversationId: failure.conversationId,
      ...(failure.messageId === undefined
        ? {}
        : { messageId: failure.messageId }),
      reason: "tool_failure",
      priority: priorityOf("tool_failure", undefined),
      status,
      raisedAt: failure.at,
      ...(review === undefined
        ? {}
        : { reviewId: review.id, reviewerId: review.reviewerId }),
    });
  }

  return Object.freeze(
    items.sort((left, right) => {
      const byPriority =
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
      if (byPriority !== 0) return byPriority;
      return right.raisedAt.localeCompare(left.raisedAt);
    }),
  );
}
