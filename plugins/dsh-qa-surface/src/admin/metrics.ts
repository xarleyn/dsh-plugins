import type {
  QaConversationReview,
  QaFeedbackRating,
  QaMessageFeedback,
  QaQualityIssueCount,
  QaQualityIssueType,
  QaQualityMetrics,
  QaQualityRatingBreakdown,
  QaQualityTrendPoint,
} from "../types.js";

/**
 * Quality aggregation.
 *
 * The numbers here are named for what they are. A thumbs-up is a user
 * satisfaction signal, not an accuracy measurement: this module never reports
 * a rate that reads as ground truth, and the API surfaces carry the same
 * wording (spec §26).
 */

/** What one conversation contributes, however cheaply it was obtained. */
export interface QaConversationFact {
  readonly conversationId: string;
  readonly userId: string;
  readonly subroleId: string;
  readonly assistantMessages: number;
  /** Epoch ms of the conversation's creation, for the activity window. */
  readonly createdAt: number;
}

export interface QaAggregationInput {
  readonly conversations: readonly QaConversationFact[];
  readonly feedback: readonly QaMessageFeedback[];
  readonly reviews: readonly QaConversationReview[];
  /** Days of feedback history the trend shows; older buckets are dropped. */
  readonly trendDays?: number;
}

/** Share of `total`, or null when there is nothing to take a share of. */
function rate(part: number, total: number): number | null {
  return total === 0 ? null : part / total;
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Does any review of this conversation cover one message (or the chat)? */
function reviewedTarget(
  reviews: readonly QaConversationReview[],
  conversationId: string,
  messageId: string,
): QaConversationReview | undefined {
  return reviews.find(
    (row) =>
      row.conversationId === conversationId &&
      (row.messageId === undefined || row.messageId === messageId),
  );
}

export function aggregateQuality({
  conversations,
  feedback,
  reviews,
  trendDays = 30,
}: QaAggregationInput): QaQualityMetrics {
  const positives = feedback.filter(({ rating }) => rating === "positive");
  const negatives = feedback.filter(({ rating }) => rating === "negative");

  const issueCounts = new Map<QaQualityIssueType, number>();
  for (const review of reviews) {
    for (const issue of review.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }

  const subroleOf = new Map(
    conversations.map((row) => [row.conversationId, row.subroleId]),
  );
  const breakdown = new Map<
    string,
    { rated: number; positive: number; negative: number }
  >();
  for (const row of feedback) {
    const subrole = subroleOf.get(row.conversationId);
    if (subrole === undefined) continue;
    const bucket = breakdown.get(subrole) ?? {
      rated: 0,
      positive: 0,
      negative: 0,
    };
    bucket.rated += 1;
    if (row.rating === "positive") bucket.positive += 1;
    else bucket.negative += 1;
    breakdown.set(subrole, bucket);
  }

  const trend = new Map<
    string,
    { rated: number; positive: number; negative: number }
  >();
  for (const row of feedback) {
    const date = dayOf(row.createdAt);
    const bucket = trend.get(date) ?? { rated: 0, positive: 0, negative: 0 };
    bucket.rated += 1;
    if (row.rating === "positive") bucket.positive += 1;
    else bucket.negative += 1;
    trend.set(date, bucket);
  }
  const trendPoints: QaQualityTrendPoint[] = [...trend]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(-trendDays)
    .map(([date, bucket]) =>
      Object.freeze({
        date,
        rated: bucket.rated,
        positive: bucket.positive,
        negative: bucket.negative,
      }),
    );

  const unreviewedNegatives = negatives.filter(
    (row) =>
      reviewedTarget(reviews, row.conversationId, row.messageId) === undefined,
  ).length;

  const issues: QaQualityIssueCount[] = [...issueCounts]
    .map(([issue, count]) => Object.freeze({ issue, count }))
    .sort((left, right) =>
      right.count === left.count
        ? left.issue.localeCompare(right.issue)
        : right.count - left.count,
    );

  const bySubrole: QaQualityRatingBreakdown[] = [...breakdown]
    .map(([key, bucket]) =>
      Object.freeze({
        key,
        label: key,
        rated: bucket.rated,
        positive: bucket.positive,
        negative: bucket.negative,
        positiveRate: rate(bucket.positive, bucket.rated),
      }),
    )
    .sort((left, right) =>
      left.key.localeCompare(right.key, undefined, { numeric: true }),
    );

  const assistantMessages = conversations.reduce(
    (total, row) => total + row.assistantMessages,
    0,
  );

  return Object.freeze({
    conversations: conversations.length,
    activeUsers: new Set(conversations.map(({ userId }) => userId)).size,
    assistantMessages,
    ratedMessages: feedback.length,
    positiveRatings: positives.length,
    negativeRatings: negatives.length,
    ratingRate: rate(feedback.length, assistantMessages),
    positiveRate: rate(positives.length, feedback.length),
    unreviewedNegatives,
    reviewedItems: reviews.length,
    issues: Object.freeze(issues),
    bySubrole: Object.freeze(bySubrole),
    trend: Object.freeze(trendPoints),
  });
}

/** One rating's contribution to a conversation row, without re-reading logs. */
export function countRatings(
  feedback: readonly QaMessageFeedback[],
): Readonly<Record<QaFeedbackRating, number>> {
  const result: Record<QaFeedbackRating, number> = {
    positive: 0,
    negative: 0,
  };
  for (const row of feedback) result[row.rating] += 1;
  return result;
}
