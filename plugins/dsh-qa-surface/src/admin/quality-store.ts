import { randomUUID } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import path from "node:path";
import {
  SqliteDatabase,
  type SqliteMigration,
} from "@yadsh/dsh-plugin-kit/sqlite";
import type {
  QaAdminAuditAction,
  QaAdminAuditEvent,
  QaConversationReview,
  QaConversationReviewInput,
  QaFeedbackReason,
  QaFeedbackRating,
  QaMessageFeedback,
  QaMessageFeedbackInput,
  QaQualityIssueType,
  QaQualitySeverity,
  QaRemediationTarget,
} from "../types.js";

/**
 * The durable quality file: user feedback, reviewer results, the manual review
 * queue and the administrative audit trail.
 *
 * It is deliberately separate from the capability policy file: role
 * configuration is a deployment artifact an operator may replace wholesale,
 * while feedback and reviews are user data that must survive such a reset.
 */

export const QA_FEEDBACK_RATINGS: readonly QaFeedbackRating[] = [
  "positive",
  "negative",
];
export const QA_FEEDBACK_REASONS: readonly QaFeedbackReason[] = [
  "incorrect",
  "instruction_not_followed",
  "missing_information",
  "outdated_information",
  "tool_issue",
  "too_verbose",
  "too_short",
  "other",
];
export const QA_QUALITY_ISSUES: readonly QaQualityIssueType[] = [
  "answer.incorrect",
  "answer.incomplete",
  "answer.hallucination",
  "answer.request_not_followed",
  "answer.poor_formatting",
  "answer.communication",
  "context.missing_conversation",
  "context.missing_knowledge",
  "context.outdated_knowledge",
  "tool.wrong_selection",
  "tool.should_have_been_used",
  "tool.bad_arguments",
  "tool.failure",
  "tool.unavailable",
  "skill.missing",
  "skill.wrong",
  "skill.not_followed",
  "skill.prompt_policy",
  "access.missing_capability",
  "access.excessive_capability",
  "other",
];
export const QA_QUALITY_SEVERITIES: readonly QaQualitySeverity[] = [
  "minor",
  "major",
  "critical",
];
export const QA_REMEDIATION_TARGETS: readonly QaRemediationTarget[] = [
  "prompt",
  "skill",
  "tool",
  "knowledge",
  "role",
  "model",
  "product_ux",
  "user_misunderstanding",
  "unknown",
];
const REVIEW_STATUSES = ["reviewed", "needs_followup"] as const;
const AUDIT_ACTIONS: readonly QaAdminAuditAction[] = [
  "user.created",
  "user.updated",
  "user.enabled",
  "user.disabled",
  "user.password-reset",
  "authorization.changed",
  "subrole.assignment.changed",
  "subrole.created",
  "subrole.updated",
  "subrole.deleted",
  "common_capabilities.updated",
  "conversation.reviewed",
  "conversation.deleted",
  "review.updated",
  "review.queued",
  "admin.settings.updated",
  "skill.created",
  "skill.updated",
  "skill.deleted",
  "memory.corrected",
  "memory.deleted",
  "memory.wiped",
];

/**
 * Retention caps. A long-lived deployment must not grow its quality file
 * without bound; the oldest rows fall off first and every list is newest-first,
 * so a cap only ever hides ancient history. Configurable `admin.retentionDays`
 * (spec §44) belongs to the deployment's own storage lifecycle and is a
 * follow-up.
 */
const MAX_FEEDBACK = 20_000;
const MAX_REVIEWS = 5_000;
const MAX_QUEUE = 2_000;
const MAX_AUDIT = 5_000;
const MAX_COMMENT_LENGTH = 2_000;
const MAX_NOTE_LENGTH = 4_000;
const MAX_ACTION_LENGTH = 2_000;
const MAX_ID_LENGTH = 200;
const MAX_SNAPSHOT_LENGTH = 20_000;
export interface QaManualQueueEntry {
  readonly conversationId: string;
  readonly messageId?: string;
  /** The reviewer who parked it; a queue entry is a deliberate act. */
  readonly userId: string;
  readonly createdAt: string;
}

interface QualityFileShape {
  readonly version: 1;
  readonly feedback: readonly QaMessageFeedback[];
  readonly reviews: readonly QaConversationReview[];
  readonly queue: readonly QaManualQueueEntry[];
  readonly audit: readonly QaAdminAuditEvent[];
}

/** The four record families the store keeps, one row each. */
export type QualityRowKind = "feedback" | "review" | "queue" | "audit";

/** How many rows of each family survive; the oldest fall off first. */
export const QA_ROW_CAPS: Readonly<Record<QualityRowKind, number>> =
  Object.freeze({
    feedback: MAX_FEEDBACK,
    review: MAX_REVIEWS,
    queue: MAX_QUEUE,
    audit: MAX_AUDIT,
  });

/**
 * The families a conversation owns. The audit trail is deliberately not one
 * of them: it records what administrators did, and it outlives its subject.
 */
const CONVERSATION_KINDS: readonly QualityRowKind[] = Object.freeze([
  "feedback",
  "review",
  "queue",
]);

// The statements that read a whole family, or its end, named here so the plan
// test can ask SQLite about the query the store actually prepares: a copy
// retyped in the test keeps passing after the store's own query has drifted off
// the index.

/** Give up everything older in rank than the row at the cap, whose position the
 * caller binds as `QA_ROW_CAPS[kind] - 1`. */
export const OVERFLOW_CUT_SQL = `
  DELETE FROM quality_rows
   WHERE kind = ?
     AND seq < (
       SELECT seq FROM quality_rows
        WHERE kind = ?
        ORDER BY seq DESC
        LIMIT 1 OFFSET ?
     )`;

/** Read a whole family back in the order its records arrived. */
export const FAMILY_REPLAY_SQL = `
  SELECT json FROM quality_rows WHERE kind = ? ORDER BY seq`;

/** Write one record at the end of its family's order, taking that end from the
 * family's `MAX(seq)` whether the record is new or being re-judged. */
export const ROW_PLACEMENT_SQL = `
  INSERT INTO quality_rows (kind, key, seq, json)
  VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM quality_rows WHERE kind = ?), ?)
  ON CONFLICT(kind, key) DO UPDATE SET
    seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM quality_rows WHERE kind = excluded.kind),
    json = excluded.json`;

/** Read a whole family with each record's identity, the way the ownership sweep
 * finds the rows of a conversation it is forgetting. */
export const FAMILY_MEMBERSHIP_SQL = `
  SELECT key, json FROM quality_rows WHERE kind = ?`;

const MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: `
      -- A record is stored as its own validated shape; what the table adds is
      -- one row per record, so a rating or an audit entry writes one row
      -- instead of rewriting the whole document. \`seq\` is the insertion order
      -- the caps and every newest-first list are defined by.
      CREATE TABLE quality_rows (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (kind, key)
      );
    `,
  },
  {
    version: 2,
    up: `
      -- Every family-scoped read walks this index: the cap looks up the row at
      -- rank cap to know where the overflow starts, a write mints its place
      -- from the family's MAX(seq), a reload replays the family in insertion
      -- order, the ownership sweep reads a family for the rows of a vanished
      -- conversation, and the import verification counts one family, once.
      -- What the index removes is the sort, and it removes it from two of
      -- them: without it the rank lookup and the replay sort the whole family
      -- into a temp B-tree, and the replay runs on every read that follows a
      -- write, so the 👎 that moves a re-judged rating to the end of the order
      -- pays for that sort twice over. What it does not do is cover the table:
      -- the reads that want nothing but seq — the rank lookup, MAX(seq) and the
      -- count — are answered from the index alone, while the replay and the
      -- sweep want json as well and still reach the row, so they get cheaper
      -- without becoming flat. Measured locally on a family at the twenty
      -- thousand row feedback cap, the rank lookup and MAX(seq) fell from
      -- milliseconds to fractions of a millisecond, a replay cost about a fifth
      -- less and a sweep read about a tenth.
      CREATE INDEX IF NOT EXISTS quality_rows_kind_seq
        ON quality_rows (kind, seq);
    `,
  },
];

/** SQLite hands back null-prototype records. */
function asRows<T>(value: unknown): T[] {
  return value as T[];
}

export function defaultQualityFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-quality.db",
  );
}

/** The `.json` sibling of a `.db` path: what a deployment upgraded from. */
function legacySiblingOf(filePath: string): string | undefined {
  return filePath.endsWith(".db")
    ? `${filePath.slice(0, -".db".length)}.json`
    : undefined;
}

/** The pre-SQLite quality file, imported once on first use. */
export function defaultLegacyQualityFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-quality.json",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === "") throw new TypeError(`${label} must not be empty`);
  if (trimmed.length > max) {
    throw new TypeError(`${label} must be at most ${max} characters`);
  }
  return trimmed;
}

function optionalText(
  value: unknown,
  label: string,
  max: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > max) {
    throw new TypeError(`${label} must be at most ${max} characters`);
  }
  return trimmed;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function listOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): readonly T[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze([
    ...new Set(value.map((entry) => oneOf(entry, allowed, label))),
  ]);
}

/** Identity of one queue entry: a conversation, optionally one message. */
/**
 * Separator for composite keys. A NUL would be the obvious choice, but the
 * SQLite binding truncates a string at its first NUL, which would collapse
 * every record of one conversation into a single row; the ASCII unit separator
 * survives the round trip and cannot appear in a validated identifier.
 */
const KEY_SEPARATOR = "\u001f";

function queueKey(entry: {
  readonly conversationId: string;
  readonly messageId?: string | undefined;
}): string {
  return `${entry.conversationId}${KEY_SEPARATOR}${entry.messageId ?? ""}`;
}

/** Identity of one rating: a user rates one message once. */
function feedbackKey(
  conversationId: string,
  messageId: string,
  userId: string,
): string {
  return `${conversationId}${KEY_SEPARATOR}${messageId}${KEY_SEPARATOR}${userId}`;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Atomic, externally reloadable store for the quality layer. Writes are
 * synchronous and persisted with a temp file plus rename, matching the accounts
 * and capability files: LAN scale keeps this trivial, and a reload probe keeps
 * a second process's write visible.
 *
 * Rows are re-validated on read rather than trusted: a hand-edited file cannot
 * inject a record the writers would have refused. A malformed row is reported
 * instead of dropped — writes are atomic, so it can only mean someone edited
 * the file, and silently discarding a user's record would hide that.
 */
export class QaQualityStore {
  private readonly storage: SqliteDatabase;
  private file: QualityFileShape;
  private observedDataVersion: number;

  constructor(readonly filePath: string = defaultQualityFilePath()) {
    this.storage = new SqliteDatabase(filePath, MIGRATIONS);
    this.observedDataVersion = this.readDataVersion();
    try {
      // The pre-SQLite file sat beside the database, so it is looked for as
      // the `.json` sibling of the path this store was given.
      this.importLegacyFile(
        legacySiblingOf(filePath) ?? defaultLegacyQualityFilePath(),
      );
      this.file = this.load();
    } catch (error) {
      // A store that cannot start must not hold the database open: the caller
      // may retry, and a held handle blocks cleaning up after the failure.
      this.storage.close();
      throw error;
    }
  }

  close(): void {
    this.storage.close();
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  /**
   * Record or replace one user's rating of one message. Re-rating the same
   * message overwrites in place rather than appending: a reviewer reads the
   * user's current verdict, and the first-seen time stays with it.
   */
  rateFeedback(
    input: {
      readonly conversationId: string;
      readonly messageId: string;
      readonly userId: string;
    },
    feedback: QaMessageFeedbackInput,
  ): QaMessageFeedback {
    this.reload();
    const conversationId = requiredText(
      input.conversationId,
      "conversationId",
      MAX_ID_LENGTH,
    );
    const messageId = requiredText(input.messageId, "messageId", MAX_ID_LENGTH);
    const rating = oneOf(feedback.rating, QA_FEEDBACK_RATINGS, "rating");
    const reasons = listOf(feedback.reasons, QA_FEEDBACK_REASONS, "reasons");
    const comment = optionalText(
      feedback.comment,
      "comment",
      MAX_COMMENT_LENGTH,
    );
    const key = feedbackKey(conversationId, messageId, input.userId);
    const existing = this.file.feedback.find(
      (row) =>
        feedbackKey(row.conversationId, row.messageId, row.userId) === key,
    );
    const now = new Date().toISOString();
    const record: QaMessageFeedback = Object.freeze({
      id: existing?.id ?? randomUUID(),
      conversationId,
      messageId,
      userId: input.userId,
      rating,
      ...(reasons.length === 0 ? {} : { reasons }),
      ...(comment === undefined ? {} : { comment }),
      createdAt: existing?.createdAt ?? now,
      ...(existing === undefined ? {} : { updatedAt: now }),
    });
    this.upsertRow("feedback", key, record);
    this.file = {
      ...this.file,
      feedback: [
        ...this.file.feedback.filter(
          (row) =>
            feedbackKey(row.conversationId, row.messageId, row.userId) !== key,
        ),
        record,
      ].slice(-MAX_FEEDBACK),
    };
    return record;
  }

  allFeedback(): readonly QaMessageFeedback[] {
    this.reload();
    return this.file.feedback;
  }

  /** Ratings of one conversation, newest first. */
  feedbackOfConversation(conversationId: string): readonly QaMessageFeedback[] {
    this.reload();
    return this.file.feedback
      .filter((row) => row.conversationId === conversationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** One exact rating, for the viewer's per-message thumbs state. */
  feedbackOf(
    conversationId: string,
    messageId: string,
    userId: string,
  ): QaMessageFeedback | undefined {
    this.reload();
    const key = feedbackKey(conversationId, messageId, userId);
    return this.file.feedback.find(
      (row) =>
        feedbackKey(row.conversationId, row.messageId, row.userId) === key,
    );
  }

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------

  /** Save a reviewer's result, replacing that reviewer's earlier verdict. */
  saveReview(
    reviewerId: string,
    input: QaConversationReviewInput,
  ): { readonly review: QaConversationReview; readonly created: boolean } {
    this.reload();
    const conversationId = requiredText(
      input.conversationId,
      "conversationId",
      MAX_ID_LENGTH,
    );
    const messageId = optionalText(input.messageId, "messageId", MAX_ID_LENGTH);
    const notes = optionalText(input.notes, "notes", MAX_NOTE_LENGTH);
    const suggestedAction = optionalText(
      input.suggestedAction,
      "suggestedAction",
      MAX_ACTION_LENGTH,
    );
    const existing = this.file.reviews.find(
      (row) =>
        row.conversationId === conversationId &&
        row.reviewerId === reviewerId &&
        row.messageId === messageId,
    );
    const now = new Date().toISOString();
    const review: QaConversationReview = Object.freeze({
      id: existing?.id ?? randomUUID(),
      conversationId,
      ...(messageId === undefined ? {} : { messageId }),
      reviewerId,
      status: oneOf(input.status, REVIEW_STATUSES, "status"),
      issues: listOf(input.issues, QA_QUALITY_ISSUES, "issues"),
      severity: oneOf(input.severity, QA_QUALITY_SEVERITIES, "severity"),
      ...(notes === undefined ? {} : { notes }),
      ...(input.target === undefined
        ? {}
        : {
            target: oneOf(input.target, QA_REMEDIATION_TARGETS, "target"),
          }),
      ...(suggestedAction === undefined ? {} : { suggestedAction }),
      createdAt: existing?.createdAt ?? now,
      ...(existing === undefined ? {} : { updatedAt: now }),
    });
    this.upsertRow("review", review.id, review);
    this.file = {
      ...this.file,
      reviews: [
        ...this.file.reviews.filter((row) => row.id !== review.id),
        review,
      ].slice(-MAX_REVIEWS),
    };
    return { review, created: existing === undefined };
  }

  allReviews(): readonly QaConversationReview[] {
    this.reload();
    return this.file.reviews;
  }

  reviewsOfConversation(
    conversationId: string,
  ): readonly QaConversationReview[] {
    this.reload();
    return this.file.reviews
      .filter((row) => row.conversationId === conversationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  // -------------------------------------------------------------------------
  // Manual review queue
  // -------------------------------------------------------------------------

  /** Park one conversation for review; re-parking the same target is a no-op. */
  enqueueReview(
    userId: string,
    conversationId: string,
    messageId?: string,
  ): QaManualQueueEntry {
    this.reload();
    const conversation = requiredText(
      conversationId,
      "conversationId",
      MAX_ID_LENGTH,
    );
    const message = optionalText(messageId, "messageId", MAX_ID_LENGTH);
    const existing = this.file.queue.find(
      (row) => row.conversationId === conversation && row.messageId === message,
    );
    if (existing !== undefined) return existing;
    const entry: QaManualQueueEntry = Object.freeze({
      conversationId: conversation,
      ...(message === undefined ? {} : { messageId: message }),
      userId,
      createdAt: new Date().toISOString(),
    });
    this.upsertRow("queue", queueKey(entry), entry);
    this.file = {
      ...this.file,
      queue: [...this.file.queue, entry].slice(-MAX_QUEUE),
    };
    return entry;
  }

  /** Drop a manual queue entry once a reviewer has answered it. */
  dequeueReview(conversationId: string, messageId?: string): boolean {
    this.reload();
    const remaining = this.file.queue.filter(
      (row) =>
        !(row.conversationId === conversationId && row.messageId === messageId),
    );
    if (remaining.length === this.file.queue.length) return false;
    this.deleteRow("queue", queueKey({ conversationId, messageId }));
    this.file = { ...this.file, queue: remaining };
    return true;
  }

  manualQueue(): readonly QaManualQueueEntry[] {
    this.reload();
    return this.file.queue;
  }

  // -------------------------------------------------------------------------
  // Conversation lifecycle
  // -------------------------------------------------------------------------

  /**
   * Drop every quality record of the named conversations.
   *
   * A record is keyed by the conversation it judges, and nothing else removes
   * it: a chat deleted from the Harness would otherwise leave its ratings,
   * reviews and queue entries behind, still counted by the metrics and still
   * pointing at a conversation the console cannot open. The ownership sweep is
   * the one place that learns a chat is gone, and it calls this with the ids
   * it reclaimed.
   *
   * The audit trail is not touched: it records what administrators did, not
   * what a conversation held, and a housekeeping drop is not an administrative
   * act to answer for.
   *
   * @param conversationIds - the conversations to forget.
   * @returns how many rows were removed.
   */
  dropConversations(conversationIds: readonly string[]): number {
    this.reload();
    const wanted = new Set(conversationIds);
    if (wanted.size === 0) return 0;
    let removed = 0;
    this.storage.transaction(() => {
      for (const kind of CONVERSATION_KINDS) {
        for (const row of asRows<{ key: string; json: string }>(
          this.storage.db.prepare(FAMILY_MEMBERSHIP_SQL).all(kind),
        )) {
          let record: unknown;
          try {
            record = JSON.parse(row.json);
          } catch {
            // A row the store cannot parse is reported by the readers that
            // surface it; housekeeping is not the place to delete it.
            continue;
          }
          if (
            !isRecord(record) ||
            typeof record.conversationId !== "string" ||
            !wanted.has(record.conversationId)
          ) {
            continue;
          }
          this.deleteRow(kind, row.key);
          removed += 1;
        }
      }
    });
    if (removed === 0) return 0;
    const keep = <T extends { readonly conversationId: string }>(
      rows: readonly T[],
    ): readonly T[] => rows.filter((row) => !wanted.has(row.conversationId));
    this.file = {
      ...this.file,
      feedback: keep(this.file.feedback),
      reviews: keep(this.file.reviews),
      queue: keep(this.file.queue),
    };
    return removed;
  }

  // -------------------------------------------------------------------------
  // Administrative audit
  // -------------------------------------------------------------------------

  /** Append one administrative action to the audit trail. */
  appendAudit(input: {
    readonly actorId: string;
    readonly action: QaAdminAuditAction;
    readonly targetType?: string | undefined;
    readonly targetId?: string | undefined;
    readonly before?: unknown;
    readonly after?: unknown;
  }): QaAdminAuditEvent {
    this.reload();
    const targetType = optionalText(input.targetType, "targetType", 64);
    const targetId = optionalText(input.targetId, "targetId", MAX_ID_LENGTH);
    const record: QaAdminAuditEvent = Object.freeze({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actorId: input.actorId,
      action: oneOf(input.action, AUDIT_ACTIONS, "action"),
      ...(targetType === undefined ? {} : { targetType }),
      ...(targetId === undefined ? {} : { targetId }),
      ...(input.before === undefined
        ? {}
        : { before: this.snapshot(input.before) }),
      ...(input.after === undefined
        ? {}
        : { after: this.snapshot(input.after) }),
    });
    this.appendRow("audit", record);
    this.file = {
      ...this.file,
      audit: [...this.file.audit, record].slice(-MAX_AUDIT),
    };
    return record;
  }

  auditEvents(): readonly QaAdminAuditEvent[] {
    this.reload();
    return this.file.audit;
  }

  /** Serialize one before/after value, refusing what no reader could use. */
  private snapshot(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return "null";
    if (serialized.length > MAX_SNAPSHOT_LENGTH) {
      return JSON.stringify({ truncated: true });
    }
    return serialized;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** Write one record, moving it to the end of its family's order. */
  private upsertRow(kind: QualityRowKind, key: string, value: unknown): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare(ROW_PLACEMENT_SQL)
        .run(kind, key, kind, JSON.stringify(value));
      this.applyCap(kind);
    });
  }

  /** Append a record whose identity the store mints itself. */
  private appendRow(kind: QualityRowKind, value: unknown): void {
    this.upsertRow(kind, randomUUID(), value);
  }

  private deleteRow(kind: QualityRowKind, key: string): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare("DELETE FROM quality_rows WHERE kind = ? AND key = ?")
        .run(kind, key);
    });
  }

  /**
   * Drop the rows that overflow their family's cap.
   *
   * The rows to give up are the oldest by rank, not everything below
   * `MAX(seq) - cap`. That range only equals the overflow while every sequence
   * value is taken, and the store itself vacates values: an updated record
   * moves to the end of the order and leaves its old value behind, and a
   * dropped record leaves a hole. A range cut pays for each of those gaps with
   * a real record, so a family at its cap loses one every time a record it
   * already holds is re-rated — feedback disappears without anything new
   * arriving to displace it.
   *
   * Reading that rank is not a seek: it walks cap entries of the family's own
   * slice of the (kind, seq) index, so the cap bounds the cost of every write,
   * while the delete reaches only the rows it removes and a write that does not
   * overflow pays the read alone. Without the index the same read sorts the
   * whole family into a temp B-tree.
   */
  private applyCap(kind: QualityRowKind): void {
    this.storage.db
      .prepare(OVERFLOW_CUT_SQL)
      .run(kind, kind, QA_ROW_CAPS[kind] - 1);
  }

  private rowsOf(kind: QualityRowKind): readonly unknown[] {
    return asRows<{ json: string }>(
      this.storage.db.prepare(FAMILY_REPLAY_SQL).all(kind),
    ).map((entry) => JSON.parse(entry.json) as unknown);
  }

  private readDataVersion(): number {
    const row = this.storage.db.prepare("PRAGMA data_version").get() as {
      data_version: number;
    };
    return row.data_version;
  }

  private reload(): void {
    const version = this.readDataVersion();
    if (version === this.observedDataVersion) return;
    this.observedDataVersion = version;
    this.file = this.load();
  }

  private load(): QualityFileShape {
    return {
      version: 1,
      feedback: Object.freeze(this.rowsOf("feedback").map(restoreFeedback)),
      reviews: Object.freeze(this.rowsOf("review").map(restoreReview)),
      queue: Object.freeze(this.rowsOf("queue").map(restoreQueueEntry)),
      audit: Object.freeze(this.rowsOf("audit").map(restoreAuditEvent)),
    };
  }

  /**
   * Import a pre-SQLite `qa-quality.json` exactly once, then rename it aside.
   * A row the database already holds wins, so a leftover file cannot overwrite
   * a verdict a person has since given.
   */
  private importLegacyFile(legacyFilePath: string): void {
    let raw: string;
    try {
      raw = readFileSync(legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) {
      throw new Error(
        `qa-quality: ${legacyFilePath} is not a recognizable quality file; refusing to import it`,
      );
    }
    const existing = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM quality_rows")
      .get() as { count: number };
    if (existing.count > 0) return;
    const feedback = asArray(parsed.feedback).map(restoreFeedback);
    const reviews = asArray(parsed.reviews).map(restoreReview);
    const queue = asArray(parsed.queue).map(restoreQueueEntry);
    const audit = asArray(parsed.audit).map(restoreAuditEvent);
    this.storage.transaction(() => {
      const insert = this.storage.db.prepare(
        "INSERT INTO quality_rows (kind, key, seq, json) VALUES (?, ?, ?, ?)",
      );
      const load = (
        kind: QualityRowKind,
        entries: readonly { key: string; value: unknown }[],
      ) => {
        entries.forEach((entry, index) => {
          insert.run(kind, entry.key, index + 1, JSON.stringify(entry.value));
        });
      };
      load(
        "feedback",
        feedback.map((record) => ({
          key: feedbackKey(
            record.conversationId,
            record.messageId,
            record.userId,
          ),
          value: record,
        })),
      );
      load(
        "review",
        reviews.map((record) => ({ key: record.id, value: record })),
      );
      load(
        "queue",
        queue.map((record) => ({ key: queueKey(record), value: record })),
      );
      load(
        "audit",
        audit.map((record) => ({ key: record.id, value: record })),
      );
      this.assertImportArrived({ feedback, reviews, queue, audit });
    });
    this.observedDataVersion = this.readDataVersion();
    renameSync(
      legacyFilePath,
      `${legacyFilePath}.migrated-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
    );
  }

  private assertImportArrived(expected: {
    readonly feedback: readonly unknown[];
    readonly reviews: readonly unknown[];
    readonly queue: readonly unknown[];
    readonly audit: readonly unknown[];
  }): void {
    const count = (kind: QualityRowKind): number =>
      (
        this.storage.db
          .prepare("SELECT COUNT(*) AS count FROM quality_rows WHERE kind = ?")
          .get(kind) as { count: number }
      ).count;
    const problems: string[] = [];
    const check = (kind: QualityRowKind, wanted: number) => {
      const kept = Math.min(wanted, QA_ROW_CAPS[kind]);
      if (count(kind) !== kept) {
        problems.push(`expected ${kept} ${kind} rows, imported ${count(kind)}`);
      }
    };
    check("feedback", expected.feedback.length);
    check("review", expected.reviews.length);
    check("queue", expected.queue.length);
    check("audit", expected.audit.length);
    if (problems.length > 0) {
      throw new Error(
        `qa-quality: importing the pre-SQLite file failed verification (${problems.join("; ")}); the file is left in place and the import was rolled back`,
      );
    }
  }
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function restoreFeedback(value: unknown): QaMessageFeedback {
  const source = row(value, "feedback");
  const reasons = listOf(source.reasons, QA_FEEDBACK_REASONS, "reasons");
  const comment = optionalText(source.comment, "comment", MAX_COMMENT_LENGTH);
  const updatedAt = optionalText(source.updatedAt, "updatedAt", 64);
  return Object.freeze({
    id: requiredText(source.id, "id", MAX_ID_LENGTH),
    conversationId: requiredText(
      source.conversationId,
      "conversationId",
      MAX_ID_LENGTH,
    ),
    messageId: requiredText(source.messageId, "messageId", MAX_ID_LENGTH),
    userId: requiredText(source.userId, "userId", MAX_ID_LENGTH),
    rating: oneOf(source.rating, QA_FEEDBACK_RATINGS, "rating"),
    ...(reasons.length === 0 ? {} : { reasons }),
    ...(comment === undefined ? {} : { comment }),
    createdAt: requiredText(source.createdAt, "createdAt", 64),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });
}

function restoreReview(value: unknown): QaConversationReview {
  const source = row(value, "review");
  const messageId = optionalText(source.messageId, "messageId", MAX_ID_LENGTH);
  const notes = optionalText(source.notes, "notes", MAX_NOTE_LENGTH);
  const suggestedAction = optionalText(
    source.suggestedAction,
    "suggestedAction",
    MAX_ACTION_LENGTH,
  );
  const updatedAt = optionalText(source.updatedAt, "updatedAt", 64);
  return Object.freeze({
    id: requiredText(source.id, "id", MAX_ID_LENGTH),
    conversationId: requiredText(
      source.conversationId,
      "conversationId",
      MAX_ID_LENGTH,
    ),
    ...(messageId === undefined ? {} : { messageId }),
    reviewerId: requiredText(source.reviewerId, "reviewerId", MAX_ID_LENGTH),
    status: oneOf(source.status, REVIEW_STATUSES, "status"),
    issues: listOf(source.issues, QA_QUALITY_ISSUES, "issues"),
    severity: oneOf(source.severity, QA_QUALITY_SEVERITIES, "severity"),
    ...(notes === undefined ? {} : { notes }),
    ...(source.target === undefined
      ? {}
      : { target: oneOf(source.target, QA_REMEDIATION_TARGETS, "target") }),
    ...(suggestedAction === undefined ? {} : { suggestedAction }),
    createdAt: requiredText(source.createdAt, "createdAt", 64),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });
}

function restoreQueueEntry(value: unknown): QaManualQueueEntry {
  const source = row(value, "review queue row");
  const messageId = optionalText(source.messageId, "messageId", MAX_ID_LENGTH);
  return Object.freeze({
    conversationId: requiredText(
      source.conversationId,
      "conversationId",
      MAX_ID_LENGTH,
    ),
    ...(messageId === undefined ? {} : { messageId }),
    userId: requiredText(source.userId, "userId", MAX_ID_LENGTH),
    createdAt: requiredText(source.createdAt, "createdAt", 64),
  });
}

function restoreAuditEvent(value: unknown): QaAdminAuditEvent {
  const source = row(value, "audit event");
  const targetType = optionalText(source.targetType, "targetType", 64);
  const targetId = optionalText(source.targetId, "targetId", MAX_ID_LENGTH);
  const before = optionalText(source.before, "before", MAX_SNAPSHOT_LENGTH);
  const after = optionalText(source.after, "after", MAX_SNAPSHOT_LENGTH);
  return Object.freeze({
    id: requiredText(source.id, "id", MAX_ID_LENGTH),
    timestamp: requiredText(source.timestamp, "timestamp", 64),
    actorId: requiredText(source.actorId, "actorId", MAX_ID_LENGTH),
    action: oneOf(source.action, AUDIT_ACTIONS, "action"),
    ...(targetType === undefined ? {} : { targetType }),
    ...(targetId === undefined ? {} : { targetId }),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  });
}
