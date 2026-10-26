import type { QaUserAccess } from "./capability.js";
import type { QaAccountRole } from "./policy.js";
import type {
  QaConversationReview,
  QaFeedbackRating,
  QaFeedbackReason,
  QaMessageFeedback,
  QaQualityIssueType,
  QaQualitySeverity,
  QaReviewQueueItem,
  QaReviewStatus,
} from "./quality.js";

/** Administrative actions recorded in the audit trail. */
export type QaAdminAuditAction =
  | "user.created"
  | "user.updated"
  | "user.enabled"
  | "user.disabled"
  /** An operator set a new password for an account that had requested one. */
  | "user.password-reset"
  | "authorization.changed"
  | "subrole.assignment.changed"
  | "subrole.created"
  | "subrole.updated"
  | "subrole.deleted"
  | "common_capabilities.updated"
  | "conversation.reviewed"
  | "conversation.deleted"
  | "review.updated"
  | "review.queued"
  | "admin.settings.updated"
  | "skill.created"
  | "skill.updated"
  | "skill.deleted"
  /** An operator rewrote a line an expert had remembered. */
  | "memory.corrected"
  /** One or several remembered lines were deleted; the count is in the target. */
  | "memory.deleted"
  /** A whole namespace was emptied. */
  | "memory.wiped";

export interface QaAdminAuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly actorId: string;
  readonly action: QaAdminAuditAction;
  readonly targetType?: string;
  readonly targetId?: string;
  /** JSON snapshots serialized at the storage boundary for a strict Remote type. */
  readonly before?: string;
  readonly after?: string;
}

/**
 * One tool call as the review viewer shows it. `arguments` and `result` are
 * preview strings, not raw payloads: the admin redaction seam owns trimming.
 */
export interface QaConversationToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
  readonly result?: string;
  readonly error?: string;
  readonly time?: number;
  readonly durationMs?: number;
}

/** Token accounting of one assistant message, when the log carries it. */
export interface QaMessageUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

/** One message in the review viewer, in log order. */
export interface QaConversationMessage {
  /** Stable message identity: the session event seq it was projected from. */
  readonly id: string;
  readonly seq: number;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly time: number;
  readonly model?: string;
  readonly provider?: string;
  readonly usage?: QaMessageUsage;
  readonly interrupted?: boolean;
  readonly toolCalls?: readonly QaConversationToolCall[];
  /** Ratings of this message by its owner, newest first. */
  readonly feedback?: readonly QaMessageFeedback[];
  /** Reviewer results attached to this exact message. */
  readonly reviews?: readonly QaConversationReview[];
}

/**
 * What the agent could use in a conversation, frozen when the session was
 * reserved. Reviewing an old answer against today's role configuration would
 * answer the wrong question.
 */
export interface QaConversationRuntime {
  readonly subroleId: string;
  readonly adminPreview: boolean;
  readonly model?: string;
  readonly provider?: string;
  readonly agentPreset?: string;
  readonly effectiveTools?: readonly string[];
  readonly effectiveSkills?: readonly string[];
  /** Skills the model actually loaded, derived from the log's skill tool calls. */
  readonly loadedSkills?: readonly string[];
  /** True when the stored log could not be read; counts stay 0 and text is absent. */
  readonly transcriptUnavailable?: QaTranscriptUnavailableReason;
}

/** Why a stored transcript could not be projected for the reviewer. */
export type QaTranscriptUnavailableReason =
  "storage-unavailable" | "not-found" | "unreadable";

/** One conversation row of the administrative list. */
export interface QaConversationSummary {
  readonly conversationId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly subroleId: string;
  readonly createdAt: string;
  /** Newest activity the deployment can see: creation, log tail, or a review. */
  readonly updatedAt: string;
  readonly title?: string;
  readonly messageCount: number;
  readonly positiveFeedback: number;
  readonly negativeFeedback: number;
  readonly reviewStatus: QaReviewStatus;
}

/** The full review payload of one conversation. */
export interface QaConversationDetail {
  readonly conversationId: string;
  readonly summary: QaConversationSummary;
  readonly runtime: QaConversationRuntime;
  readonly messages: readonly QaConversationMessage[];
  readonly reviews: readonly QaConversationReview[];
  readonly queueItems: readonly QaReviewQueueItem[];
}

/** What one administrative deletion removed, for the console to report. */
export interface QaConversationDeletion {
  readonly conversationId: string;
  /**
   * Every session whose stored log is gone, the chat first: a conversation's
   * subagent sessions are part of it and are removed with it.
   */
  readonly sessions: readonly string[];
  /** Quality rows dropped with the conversation. */
  readonly qualityRows: number;
}

/**
 * Server-side filter for the conversation list. Every field is optional and
 * accepts an explicit null: the wire carries whatever the browser has, and an
 * absent filter must never be mistaken for a filter on `null`.
 */
export interface QaConversationQuery {
  readonly userId?: string | null;
  readonly subroleId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly rating?: QaFeedbackRating | null;
  readonly reviewStatus?: QaReviewStatus | null;
  /** Search matches the conversation title and the owner's name or email. */
  readonly search?: string | null;
}

/** Server-side filter for the feedback table. */
export interface QaFeedbackQuery {
  readonly rating?: QaFeedbackRating | null;
  readonly userId?: string | null;
  readonly subroleId?: string | null;
  readonly reason?: QaFeedbackReason | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly reviewStatus?: QaReviewStatus | null;
}

/** Server-side filter for the audit table. */
export interface QaAuditQuery {
  readonly actorId?: string | null;
  readonly action?: QaAdminAuditAction | null;
  readonly from?: string | null;
  readonly to?: string | null;
}

/** Server-side filter for the user list. */
export interface QaUserQuery {
  readonly search?: string | null;
  readonly status?: "active" | "disabled" | null;
  readonly role?: QaAccountRole | null;
  readonly subroleId?: string | null;
}

/** Cursor page of any admin list. `nextCursor` is null on the last page. */
export interface QaAdminPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/** One pending item of the review queue, with the context to triage it. */
export interface QaReviewQueueRow extends QaReviewQueueItem {
  readonly displayName: string;
  readonly subroleId: string;
  readonly title?: string;
  readonly raisedAtLabel: string;
  readonly issueSummary?: readonly QaQualityIssueType[];
  readonly severity?: QaQualitySeverity;
}

/** One row of the feedback table (spec §33). */
export interface QaFeedbackRow extends QaMessageFeedback {
  readonly displayName: string;
  readonly subroleId: string;
  readonly conversationTitle?: string;
  readonly reviewStatus: QaReviewStatus;
}

/** Aggregated quality counters (spec §27). */
export interface QaQualityIssueCount {
  readonly issue: QaQualityIssueType;
  readonly count: number;
}

export interface QaQualityRatingBreakdown {
  readonly key: string;
  readonly label: string;
  readonly rated: number;
  readonly positive: number;
  readonly negative: number;
  readonly positiveRate: number | null;
}

export interface QaQualityTrendPoint {
  /** ISO date (UTC) of the bucket. */
  readonly date: string;
  readonly rated: number;
  readonly positive: number;
  readonly negative: number;
}

export interface QaQualityMetrics {
  /** Counts derived from journals are incomplete until every journal was read. */
  readonly coverage?: {
    readonly complete: boolean;
    readonly readConversations: number;
    readonly totalConversations: number;
  };
  readonly conversations: number;
  readonly activeUsers: number;
  readonly assistantMessages: number;
  readonly ratedMessages: number;
  readonly positiveRatings: number;
  readonly negativeRatings: number;
  /** Share of assistant messages that carry a rating; null without messages. */
  readonly ratingRate: number | null;
  /** Share of positive ratings among rated messages; null without ratings. */
  readonly positiveRate: number | null;
  readonly unreviewedNegatives: number;
  readonly reviewedItems: number;
  readonly issues: readonly QaQualityIssueCount[];
  readonly bySubrole: readonly QaQualityRatingBreakdown[];
  readonly trend: readonly QaQualityTrendPoint[];
}

/**
 * One attention line on the admin overview. The Host reports the condition and
 * its numbers; the browser owns the wording, so an operator's language never
 * depends on the deployment's locale.
 */
export interface QaOverviewAlert {
  readonly level: "critical" | "warning" | "info";
  readonly code:
    "unreviewed-negatives" | "subrole-satisfaction" | "recurring-reason";
  readonly count: number;
  /** Subrole id or feedback reason, when the condition names one. */
  readonly subject?: string;
  /** Positive-feedback share of the subject, when the condition measured one. */
  readonly rate?: number;
}

/** The /qa/admin landing payload. */
export interface QaAdminOverview {
  readonly metrics: QaQualityMetrics;
  readonly alerts: readonly QaOverviewAlert[];
  readonly recentFeedback: readonly QaFeedbackRow[];
  readonly queue: readonly QaReviewQueueRow[];
}

/** The account columns the store owns, without any joined counters. */
export interface QaAdminAccountRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly fullName: string;
  readonly role: QaAccountRole;
  readonly disabled: boolean;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
  readonly access: QaUserAccess;
}

/** One user row of the admin user list (spec §5). */
export interface QaAdminUserRow extends QaAdminAccountRow {
  readonly conversations: number;
  readonly feedbackGiven: number;
}

/** Everything the user detail page renders, in one payload (spec §6). */
export interface QaAdminUserDetail {
  readonly user: QaAdminUserRow;
  /** Effective capability counts per assigned subrole, for the access preview. */
  readonly effective: readonly {
    readonly subroleId: string;
    readonly name: string;
    /** Visible from the first step: system-required, Common and the role. */
    readonly tools: number;
    /** The role's ceiling for tools a loaded skill requires. */
    readonly grantableTools: number;
    /** Tools the profile withdraws, whatever else grants them. */
    readonly deniedTools: number;
    readonly skills: number;
  }[];
  readonly activity: {
    readonly conversations: number;
    /**
     * Unknown until the conversations page is opened: the count needs every
     * conversation's log read, so the detail card reports null instead of
     * blocking its payload on the scan.
     */
    readonly messages: number | null;
    readonly positiveRatings: number;
    readonly negativeRatings: number;
  };
}

/** The administrative write of one account; absent fields stay unchanged. */
export interface QaAdminUserUpdate {
  readonly role?: QaAccountRole | null;
  readonly disabled?: boolean | null;
  readonly access?: QaUserAccess | null;
}
