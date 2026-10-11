// ---------------------------------------------------------------------------
// Quality layer: user feedback, reviewer results, and the admin audit trail.
// These are the durable records the admin console reads and writes; every one
// is keyed to an exact conversation message, never to a conversation alone.
// ---------------------------------------------------------------------------

/** A user's verdict on one assistant message. Binary by design. */
export type QaFeedbackRating = "positive" | "negative";

/**
 * Optional negative-feedback reasons. The list is short on purpose: asking for
 * a precise cause at rating time costs more answers than it buys insight, and
 * a reviewer classifies the hard cases afterwards.
 */
export type QaFeedbackReason =
  | "incorrect"
  | "instruction_not_followed"
  | "missing_information"
  | "outdated_information"
  | "tool_issue"
  | "too_verbose"
  | "too_short"
  | "other";

/** One user's rating of one assistant message. */
export interface QaMessageFeedback {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly rating: QaFeedbackRating;
  readonly reasons?: readonly QaFeedbackReason[];
  readonly comment?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/** The rating fields a browser may write; identity and time are Host-owned. */
export interface QaMessageFeedbackInput {
  readonly rating: QaFeedbackRating;
  readonly reasons?: readonly QaFeedbackReason[];
  readonly comment?: string;
}

/**
 * One rating a browser still holds locally: a verdict given while the surface
 * had no way to file it, replayed by the harvest. Reasons never ride along —
 * the browser's map only ever stored the thumbs.
 */
export interface QaFeedbackHarvestEntry {
  readonly conversationId: string;
  /** The durable log position, exactly as a live rating carries it. */
  readonly messageId: string;
  readonly rating: QaFeedbackRating;
}

/** What one harvest write did; the counts answer for the whole batch. */
export interface QaFeedbackHarvestResult {
  /** Ratings the Host stored now. Replaying the same batch stores none. */
  readonly recorded: number;
  /** Entries the Host already held a rating for, left as they were. */
  readonly present: number;
  /** Entries refused: not the caller's conversation, or unusable. */
  readonly rejected: number;
}

/** Review workflow state of a conversation or one of its messages. */
export type QaReviewStatus =
  "unreviewed" | "in_review" | "reviewed" | "needs_followup";

/**
 * Reviewer taxonomy, grouped the way the spec groups it. Issue ids stay flat so
 * aggregations never depend on walking a tree in the browser.
 */
export type QaQualityIssueType =
  | "answer.incorrect"
  | "answer.incomplete"
  | "answer.hallucination"
  | "answer.request_not_followed"
  | "answer.poor_formatting"
  | "answer.communication"
  | "context.missing_conversation"
  | "context.missing_knowledge"
  | "context.outdated_knowledge"
  | "tool.wrong_selection"
  | "tool.should_have_been_used"
  | "tool.bad_arguments"
  | "tool.failure"
  | "tool.unavailable"
  | "skill.missing"
  | "skill.wrong"
  | "skill.not_followed"
  | "skill.prompt_policy"
  | "access.missing_capability"
  | "access.excessive_capability"
  | "other";

export type QaQualitySeverity = "minor" | "major" | "critical";

/** Where a reviewer thinks the fix belongs; the loop's change target. */
export type QaRemediationTarget =
  | "prompt"
  | "skill"
  | "tool"
  | "knowledge"
  | "role"
  | "model"
  | "product_ux"
  | "user_misunderstanding"
  | "unknown";

/** One reviewer result. `needs_followup` keeps the item in the queue. */
export interface QaConversationReview {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId?: string;
  readonly reviewerId: string;
  readonly status: "reviewed" | "needs_followup";
  readonly issues: readonly QaQualityIssueType[];
  readonly severity: QaQualitySeverity;
  readonly notes?: string;
  readonly target?: QaRemediationTarget;
  readonly suggestedAction?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/** A reviewer's write; ids, author and first-seen time are Host-owned. */
export interface QaConversationReviewInput {
  readonly conversationId: string;
  readonly messageId?: string;
  readonly status: "reviewed" | "needs_followup";
  readonly issues: readonly QaQualityIssueType[];
  readonly severity: QaQualitySeverity;
  readonly notes?: string;
  readonly target?: QaRemediationTarget;
  readonly suggestedAction?: string;
}

/** Why a conversation entered the review queue. */
export type QaReviewReason =
  "negative_feedback" | "manual" | "tool_failure" | "automatic";

export type QaReviewPriority = "low" | "normal" | "high";

/** One queue row: a conversation needing attention, with its derived state. */
export interface QaReviewQueueItem {
  readonly conversationId: string;
  readonly messageId?: string;
  readonly reason: QaReviewReason;
  readonly priority: QaReviewPriority;
  readonly status: QaReviewStatus;
  readonly assignedReviewerId?: string;
  /** ISO time of the signal that put the item in the queue. */
  readonly raisedAt: string;
  readonly reviewerId?: string;
  readonly reviewId?: string;
  readonly feedbackId?: string;
}
