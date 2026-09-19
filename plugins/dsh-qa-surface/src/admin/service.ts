import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaAccounts } from "../accounts/store.js";
import { QaAccountsError } from "../accounts/store.js";
import type { QaAccessService } from "../access/service.js";
import type { QaRoleRepository } from "../access/role-repository.js";
import {
  defaultCapabilityConfig,
  normalizeUserAccess,
  resolveSkillAccess,
} from "../access/model.js";
import type {
  QaAccountRole,
  QaAccountUserPublic,
  QaAdminAuditEvent,
  QaAdminOverview,
  QaAdminPage,
  QaAdminUserDetail,
  QaAdminUserRow,
  QaAdminUserUpdate,
  QaAuditQuery,
  QaConversationDetail,
  QaConversationDeletion,
  QaConversationMessage,
  QaConversationQuery,
  QaConversationReview,
  QaConversationReviewInput,
  QaConversationSummary,
  QaFeedbackQuery,
  QaFeedbackRow,
  QaMessageFeedback,
  QaMessageFeedbackInput,
  QaOverviewAlert,
  QaPermission,
  QaQualityMetrics,
  QaReviewQueueItem,
  QaReviewQueueRow,
  QaReviewStatus,
  QaTranscriptUnavailableReason,
  QaUserAccess,
  QaUserQuery,
} from "../types.js";
import { allows } from "./permissions.js";
import { aggregateQuality, type QaConversationFact } from "./metrics.js";
import { paginate } from "./paging.js";
import { deriveQueue, type QaToolFailureSignal } from "./queue.js";
import type { QaQualityStore } from "./quality-store.js";
import type { QaAdminRedactor } from "./redaction.js";
import { defaultAdminRedactor } from "./redaction.js";
import {
  projectTranscript,
  type QaProjectedTranscript,
} from "./conversation-log.js";
import type {
  QaSessionLogReader,
  QaStoredSessionEraser,
  QaStoredSessionHeader,
} from "./session-log.js";

/**
 * The administrative console's server side.
 *
 * Every entry point takes the caller's token and names the permission it
 * needs; there is no `isAdmin` shortcut and no client-supplied identity. The
 * browser may only ever read what a role grants, and every write lands in the
 * audit trail with its before and after images.
 */

export const QA_ADMIN_PAGE_DEFAULT = 25;
export const QA_ADMIN_PAGE_MAX = 100;

/**
 * How many conversations one metrics or search pass will open. Reading every
 * stored log is unbounded work, so the aggregation covers the newest logs and
 * says so; moving these counters onto a real index is the next iteration.
 */
export const QA_ADMIN_SCAN_LIMIT = 200;

/** How long one projected log may serve the list and metrics before re-reading. */
const TRANSCRIPT_TTL_MS = 30_000;
const TRANSCRIPT_CACHE_MAX = 128;

interface QaServiceClock {
  now(): number;
}

interface IndexedConversation {
  readonly conversationId: string;
  readonly userId: string;
  readonly displayName: string;
  /** Owner's address, so a search may name the account either way. */
  readonly email: string;
  readonly subroleId: string;
  readonly adminPreview: boolean;
  /** Epoch ms: the session header's creation, or the reservation's. */
  readonly createdAt: number;
  readonly createdAtIso: string;
  readonly effectiveTools?: readonly string[];
  readonly effectiveSkills?: readonly string[];
}

export interface QaAdminServiceOptions {
  readonly accounts: () => QaAccounts | undefined;
  readonly quality: () => QaQualityStore;
  readonly roles: () => QaRoleRepository;
  readonly access: () => QaAccessService;
  readonly sessionLog: QaSessionLogReader;
  /**
   * Removal of stored session logs, the one thing the Harness does not offer.
   * Without it the console refuses to delete a conversation rather than
   * pretending it did.
   */
  readonly sessionFiles?: QaStoredSessionEraser;
  /** Drops the sources a conversation collected, when the deployment keeps any. */
  readonly dropSources?: (sessionId: string) => void;
  readonly logger: PluginLogger;
  readonly redactor?: QaAdminRedactor;
  readonly clock?: QaServiceClock;
}

/**
 * Every session one conversation owns: the chat itself and everything
 * delegated from it, transitively. A subagent's session is part of the answer
 * it ran inside, so a conversation does not leave its children behind.
 */
function descendantsOf(
  sessionId: string,
  headers: readonly QaStoredSessionHeader[],
): readonly string[] {
  const found: string[] = [];
  const queue = [sessionId];
  while (queue.length > 0) {
    const parent = queue.shift();
    if (parent === undefined) break;
    for (const header of headers) {
      if (header.parentSessionId !== parent || found.includes(header.id)) {
        continue;
      }
      found.push(header.id);
      queue.push(header.id);
    }
  }
  return found;
}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function epochOf(iso: string | undefined): number | undefined {
  if (iso === undefined || iso === "") return undefined;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return QA_ADMIN_PAGE_DEFAULT;
  return Math.max(1, Math.min(QA_ADMIN_PAGE_MAX, Math.floor(value)));
}

function matches(
  search: string,
  ...values: readonly (string | undefined)[]
): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return values.some(
    (value) => value?.toLocaleLowerCase().includes(needle) === true,
  );
}

/**
 * Treat an absent filter and an explicit null alike. The browser sends the
 * field either way, and a null that reached a comparison would filter on the
 * absence of a value instead of meaning "no filter at all".
 */
function given<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Review state of a conversation as a whole: a needs-followup verdict outranks
 * a completed one, and no review at all is the unreviewed default.
 */
function reviewStatusOf(
  reviews: readonly QaConversationReview[],
  conversationId: string,
): QaReviewStatus {
  const mine = reviews.filter((row) => row.conversationId === conversationId);
  if (mine.length === 0) return "unreviewed";
  return mine.some((row) => row.status === "needs_followup")
    ? "needs_followup"
    : "reviewed";
}

export class QaAdminService {
  private readonly redactor: QaAdminRedactor;
  private readonly transcripts = new Map<
    string,
    { readonly at: number; readonly project: QaProjectedTranscript }
  >();

  constructor(private readonly options: QaAdminServiceOptions) {
    this.redactor = options.redactor ?? defaultAdminRedactor;
  }

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  private requireAccounts(): QaAccounts {
    const accounts = this.options.accounts();
    if (accounts === undefined) {
      throw new Error("QA accounts are not enabled on this deployment.");
    }
    return accounts;
  }

  /**
   * Resolve the caller and check one permission. The refusal carries the shared
   * `forbidden` reason, so a browser shows the same audience-safe copy for
   * every administrative surface it may not open.
   */
  private require(
    token: string,
    permission: QaPermission,
  ): { readonly accounts: QaAccounts; readonly actor: QaAccountUserPublic } {
    const accounts = this.requireAccounts();
    const actor = accounts.currentUser(token);
    if (!allows(actor.role, permission)) {
      this.options.logger.warn("admin.forbidden", {
        userId: actor.id,
        role: actor.role,
        permission,
      });
      throw new QaAccountsError(
        "forbidden",
        `the ${actor.role} role does not grant ${permission}`,
      );
    }
    return { accounts, actor };
  }

  // -------------------------------------------------------------------------
  // Conversation index
  // -------------------------------------------------------------------------

  /**
   * The deployment's conversation index: one row per reserved QA session,
   * enriched with the stored header when the deployment can list one. A chat
   * that exists but has no readable log still appears — the reviewer must see
   * that it happened.
   *
   * Reading the index first asks the access sweep to reclaim what the Harness
   * no longer knows: a chat deleted outside the deployment would otherwise sit
   * in this list, in the counters and in the metrics until some later chat
   * creation happened to trigger housekeeping. The sweep is throttled, so this
   * costs a listing per interval at most.
   */
  private async index(): Promise<readonly IndexedConversation[]> {
    const accounts = this.requireAccounts();
    await this.options.access().sweepVanishedOwnership();
    const directory = new Map(
      accounts.directory().map((user) => [user.id, user]),
    );
    const headers = new Map(
      (await this.options.sessionLog.list()).headers.map((header) => [
        header.id,
        header,
      ]),
    );
    return accounts
      .listOwnershipRecords()
      .map((record) => {
        const header = headers.get(record.sessionId);
        // A subagent's session is an implementation detail of one answer, not a
        // conversation a user had.
        if (header?.parentSessionId !== undefined) {
          return undefined;
        }
        const createdAt = header?.createdAt ?? Date.parse(record.claimedAt);
        const snapshot = record.capabilitySnapshot;
        return {
          conversationId: record.sessionId,
          userId: record.userId,
          displayName:
            directory.get(record.userId)?.displayName ?? record.userId,
          email: directory.get(record.userId)?.email ?? "",
          subroleId: record.subroleId ?? "",
          adminPreview: record.adminPreview === true,
          createdAt,
          createdAtIso: isoOf(createdAt),
          ...(snapshot === undefined
            ? {}
            : {
                effectiveTools: snapshot.tools,
                effectiveSkills: snapshot.skills,
              }),
        } satisfies IndexedConversation;
      })
      .filter((row): row is IndexedConversation => row !== undefined);
  }

  /** One conversation's projected log, cached for the TTL unless asked fresh. */
  private async transcript(
    conversationId: string,
    fresh = false,
  ): Promise<
    | { readonly ok: true; readonly project: QaProjectedTranscript }
    | { readonly ok: false; readonly reason: QaTranscriptUnavailableReason }
  > {
    const cached = this.transcripts.get(conversationId);
    const now = this.options.clock?.now() ?? Date.now();
    if (!fresh && cached !== undefined && now - cached.at < TRANSCRIPT_TTL_MS) {
      return { ok: true, project: cached.project };
    }
    const result = await this.options.sessionLog.read(conversationId);
    if (!result.ok) {
      this.transcripts.delete(conversationId);
      return { ok: false, reason: result.reason };
    }
    const project = projectTranscript(result.events, this.redactor);
    this.transcripts.set(conversationId, { at: now, project });
    if (this.transcripts.size > TRANSCRIPT_CACHE_MAX) {
      const oldest = [...this.transcripts.entries()].sort(
        (left, right) => left[1].at - right[1].at,
      )[0];
      if (oldest !== undefined) this.transcripts.delete(oldest[0]);
    }
    return { ok: true, project };
  }

  private async facts(
    rows: readonly IndexedConversation[],
  ): Promise<readonly QaConversationFact[]> {
    const facts: QaConversationFact[] = [];
    for (const row of rows) {
      const transcript = await this.transcript(row.conversationId);
      facts.push({
        conversationId: row.conversationId,
        userId: row.userId,
        subroleId: row.subroleId,
        assistantMessages: transcript.ok
          ? transcript.project.messages.filter(
              (message) => message.role === "assistant",
            ).length
          : 0,
        createdAt: row.createdAt,
      });
    }
    return facts;
  }

  // -------------------------------------------------------------------------
  // Overview and metrics
  // -------------------------------------------------------------------------

  async overview(token: string): Promise<QaAdminOverview> {
    this.require(token, "conversations.read.all");
    const rows = await this.index();
    const metrics = await this.metricsOf(rows);
    const fresh = [...this.options.quality().allFeedback()].sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
    const queue = await this.queueRows(rows);
    return Object.freeze({
      metrics,
      alerts: this.alertsOf(metrics),
      recentFeedback: this.feedbackRows(
        rows,
        fresh.slice(0, 5),
        this.options.quality().allReviews(),
      ),
      queue: queue.slice(0, 5),
    });
  }

  async metrics(token: string): Promise<QaQualityMetrics> {
    this.require(token, "analytics.read");
    return this.metricsOf(await this.index());
  }

  private async metricsOf(
    rows: readonly IndexedConversation[],
  ): Promise<QaQualityMetrics> {
    const quality = this.options.quality();
    // Feedback and reviews are exact; the message counts come from the bounded
    // log scan and are labelled as such where they are shown.
    const scanned = [...rows]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, QA_ADMIN_SCAN_LIMIT);
    return aggregateQuality({
      conversations: await this.facts(scanned),
      feedback: quality.allFeedback(),
      reviews: quality.allReviews(),
    });
  }

  /** One attention line per condition worth an administrator's time. */
  private alertsOf(metrics: QaQualityMetrics): readonly QaOverviewAlert[] {
    const alerts: QaOverviewAlert[] = [];
    if (metrics.unreviewedNegatives > 0) {
      alerts.push({
        level: "critical",
        code: "unreviewed-negatives",
        count: metrics.unreviewedNegatives,
      });
    }
    if (metrics.positiveRate !== null) {
      for (const row of metrics.bySubrole) {
        if (row.rated < 5 || row.positiveRate === null) continue;
        if (row.positiveRate <= metrics.positiveRate - 0.1) {
          alerts.push({
            level: "warning",
            code: "subrole-satisfaction",
            count: row.rated,
            subject: row.key,
            rate: row.positiveRate,
          });
        }
      }
    }
    const reasons = new Map<string, number>();
    for (const row of this.options.quality().allFeedback()) {
      if (row.rating !== "negative") continue;
      for (const reason of row.reasons ?? []) {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }
    for (const [reason, count] of [...reasons].sort(
      (left, right) => right[1] - left[1],
    )) {
      if (count >= 3) {
        alerts.push({
          level: "warning",
          code: "recurring-reason",
          count,
          subject: reason,
        });
      }
    }
    return Object.freeze(alerts.map((alert) => Object.freeze(alert)));
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  async users(
    token: string,
    query: QaUserQuery,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<QaAdminPage<QaAdminUserRow>> {
    const { accounts } = this.require(token, "users.read");
    const config = this.options.roles().snapshot();
    const rows = accounts.listAdminUsers((value) =>
      normalizeUserAccess(value, config),
    );
    const feedback = this.options.quality().allFeedback();
    const ownership = accounts.listOwnershipRecords();
    const enriched = rows.map((user) =>
      Object.freeze({
        ...user,
        conversations: ownership.filter((row) => row.userId === user.id).length,
        feedbackGiven: feedback.filter((row) => row.userId === user.id).length,
      }),
    );
    const status = given(query.status);
    const role = given(query.role);
    const subroleId = given(query.subroleId);
    const search = given(query.search) ?? "";
    const filtered = enriched.filter((user) => {
      if (status === "active" && user.disabled) return false;
      if (status === "disabled" && !user.disabled) return false;
      if (role !== undefined && user.role !== role) return false;
      if (
        subroleId !== undefined &&
        !user.access.allowedSubroles.includes(subroleId)
      ) {
        return false;
      }
      return matches(search, user.displayName, user.fullName, user.email);
    });
    const sorted = [...filtered].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "ru"),
    );
    return paginate({
      rows: sorted,
      keyOf: (row) => row.displayName.toLocaleLowerCase(),
      idOf: (row) => row.id,
      cursor,
      limit: clampLimit(limit),
    });
  }

  async user(token: string, userId: string): Promise<QaAdminUserDetail> {
    const { accounts } = this.require(token, "users.read");
    const config = this.options.roles().snapshot();
    const row = accounts.adminUser(userId, (value) =>
      normalizeUserAccess(value, config),
    );
    if (row === undefined) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    const feedback = this.options.quality().allFeedback();
    const ownership = accounts
      .listOwnershipRecords()
      .filter((record) => record.userId === userId);
    const catalog = await this.options.access().catalog.snapshot();
    const systemTools = this.options.access().systemRequiredTools();
    // Declared audiences are part of the effective set: a skill that names this
    // role reaches it without the administrator assigning it.
    const skills = resolveSkillAccess({
      config,
      descriptors: catalog.skillMetadata,
      rows: catalog.descriptors.filter(({ type }) => type === "skill"),
      installedTools: catalog.toolIds,
    });
    const effective = row.access.allowedSubroles.map((subroleId) => {
      const role = config.subroles.find(({ id }) => id === subroleId);
      const installed = (values: readonly string[], set: ReadonlySet<string>) =>
        [...new Set(values)].filter((id) => set.has(id)).length;
      // What a session under this profile resolves: the deployment's pinned
      // system set, the Common list and the role's own list. Counting the
      // configured lists alone reported "0 tools" for a profile whose sessions
      // run with the whole pinned set, and it counted the skill-grantable
      // ceiling as if those tools were already visible.
      const always = [
        ...systemTools,
        ...config.common.tools.always,
        ...(role?.capabilities.tools.always ?? []),
      ];
      const grantable = [
        ...config.common.tools.skillGrantable,
        ...(role?.capabilities.tools.skillGrantable ?? []),
      ];
      // A denial beats every grant, the pinned set included, so the counts a
      // user page reports have to subtract it — otherwise a profile that took
      // `dsh_git_*` away still reads as if its chats had them.
      const denied = new Set([
        ...(config.common.tools.deny ?? []),
        ...(role?.capabilities.tools.deny ?? []),
      ]);
      const reachable = (values: readonly string[]) =>
        installed(
          values.filter((id) => !denied.has(id)),
          catalog.toolIds,
        );
      const declared = skills
        .filter(({ roles }) =>
          roles.some(({ roleId, visible }) => roleId === subroleId && visible),
        )
        .map(({ name }) => name);
      return Object.freeze({
        subroleId,
        name: role?.name ?? subroleId,
        tools: reachable(always),
        grantableTools: reachable(grantable),
        deniedTools: installed([...denied], catalog.toolIds),
        skills: installed(
          [
            ...config.common.skills,
            ...(role?.capabilities.skills ?? []),
            ...declared,
          ],
          catalog.skillIds,
        ),
      });
    });
    const userFeedback = feedback.filter((item) => item.userId === userId);
    return Object.freeze({
      user: Object.freeze({
        ...row,
        conversations: ownership.length,
        feedbackGiven: userFeedback.length,
      }),
      effective: Object.freeze(effective),
      activity: Object.freeze({
        conversations: ownership.length,
        // Counting messages means reading every conversation the account owns,
        // and on the Harness each such read costs a full persistence listing
        // before it reaches the one log — minutes for a real store, all to
        // fill one counter. The conversations page computes the count per row
        // from the transcripts it is already reading; the card reports
        // "unknown" instead of blocking its whole payload on the scan.
        messages: null,
        positiveRatings: userFeedback.filter(
          ({ rating }) => rating === "positive",
        ).length,
        negativeRatings: userFeedback.filter(
          ({ rating }) => rating === "negative",
        ).length,
      }),
    });
  }

  async updateUser(
    token: string,
    userId: string,
    update: QaAdminUserUpdate,
  ): Promise<QaAdminUserDetail> {
    const { accounts, actor } = this.require(token, "users.manage");
    const config = this.options.roles().snapshot();
    const before = accounts.adminUser(userId, (value) =>
      normalizeUserAccess(value, config),
    );
    if (before === undefined) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    const nextRole = given(update.role);
    const nextDisabled = given(update.disabled);
    const nextAccess = given(update.access);
    if (nextRole !== undefined && nextRole !== before.role) {
      this.assertAdminSurvives(accounts, userId, nextRole);
      accounts.setAccessRole(userId, nextRole);
      this.options.quality().appendAudit({
        actorId: actor.id,
        action: "authorization.changed",
        targetType: "user",
        targetId: userId,
        before: before.role,
        after: nextRole,
      });
    }
    if (nextDisabled !== undefined && nextDisabled !== before.disabled) {
      if (nextDisabled) this.assertAdminSurvives(accounts, userId, "user");
      accounts.setAccessDisabled(userId, nextDisabled);
      this.options.quality().appendAudit({
        actorId: actor.id,
        action: nextDisabled ? "user.disabled" : "user.enabled",
        targetType: "user",
        targetId: userId,
      });
    }
    if (nextAccess !== undefined) {
      const access = this.exactAssignment(nextAccess, userId);
      accounts.setAccess(userId, access);
      this.options.quality().appendAudit({
        actorId: actor.id,
        action: "subrole.assignment.changed",
        targetType: "user",
        targetId: userId,
        before: before.access,
        after: access,
      });
    }
    this.options.logger.info("admin.user-updated", { userId, actor: actor.id });
    return this.user(token, userId);
  }

  /**
   * Refuse a write that would leave the deployment without a usable admin.
   * Granting the admin role carries no such risk; demoting or disabling the
   * last enabled administrator locks everyone out of the console.
   */
  private assertAdminSurvives(
    accounts: QaAccounts,
    targetId: string,
    nextRole: QaAccountRole,
  ): void {
    if (nextRole === "admin") return;
    const admins = accounts
      .listAdminUsers((value) =>
        normalizeUserAccess(value, defaultCapabilityConfig()),
      )
      .filter((user) => user.role === "admin" && !user.disabled);
    const survivor = admins.some((user) => user.id !== targetId);
    if (!survivor) {
      throw new QaAccountsError(
        "forbidden",
        "the deployment must keep at least one enabled administrator",
      );
    }
  }

  /** Validate an assignment against the enabled roles before storing it. */
  private exactAssignment(input: QaUserAccess, userId: string): QaUserAccess {
    const config = this.options.roles().snapshot();
    const enabled = new Set(
      config.subroles.filter(({ enabled }) => enabled).map(({ id }) => id),
    );
    const allowed = [...new Set(input.allowedSubroles)];
    if (
      allowed.length === 0 ||
      !allowed.every((id) => enabled.has(id)) ||
      !allowed.includes(input.defaultSubrole)
    ) {
      this.options.logger.warn("admin.assignment-rejected", { userId });
      throw new QaAccountsError(
        "invalid-role",
        "an assignment must name enabled roles and select one of them",
      );
    }
    return Object.freeze({
      allowedSubroles: Object.freeze(allowed),
      defaultSubrole: input.defaultSubrole,
    });
  }

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------

  async conversations(
    token: string,
    query: QaConversationQuery,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<QaAdminPage<QaConversationSummary>> {
    this.require(token, "conversations.read.all");
    const rows = await this.index();
    const quality = this.options.quality();
    const feedback = quality.allFeedback();
    const reviews = quality.allReviews();

    const userIdFilter = given(query.userId);
    const subroleFilter = given(query.subroleId);
    const ratingFilter = given(query.rating);
    const reviewFilter = given(query.reviewStatus);
    const search = given(query.search) ?? "";
    const from = epochOf(given(query.from) ?? undefined);
    const to = epochOf(given(query.to) ?? undefined);
    // A search may name a title, which only the log knows, so the candidate
    // set is bounded by the newest logs before the text is available.
    const searchable =
      search.trim() === ""
        ? rows
        : [...rows]
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(0, QA_ADMIN_SCAN_LIMIT);

    const candidates: IndexedConversation[] = [];
    for (const row of searchable) {
      if (userIdFilter !== undefined && row.userId !== userIdFilter) continue;
      if (subroleFilter !== undefined && row.subroleId !== subroleFilter) {
        continue;
      }
      if (from !== undefined && row.createdAt < from) continue;
      if (to !== undefined && row.createdAt > to) continue;
      const mine = feedback.filter(
        (item) => item.conversationId === row.conversationId,
      );
      if (
        ratingFilter !== undefined &&
        !mine.some((item) => item.rating === ratingFilter)
      ) {
        continue;
      }
      if (
        reviewFilter !== undefined &&
        reviewStatusOf(reviews, row.conversationId) !== reviewFilter
      ) {
        continue;
      }
      // One projection per candidate, reused by the search match and then by
      // the summary of a page row: the read is cached either way.
      const transcript = await this.transcript(row.conversationId);
      const title = transcript.ok ? transcript.project.title : undefined;
      if (
        !matches(
          search,
          row.displayName,
          row.email,
          row.userId,
          row.conversationId,
          title,
        )
      ) {
        continue;
      }
      candidates.push(row);
    }

    const sorted = candidates.sort(
      (left, right) => right.createdAt - left.createdAt,
    );
    const page = paginate({
      rows: sorted,
      keyOf: (row) => row.createdAtIso,
      idOf: (row) => row.conversationId,
      cursor,
      limit: clampLimit(limit),
    });
    const items: QaConversationSummary[] = [];
    for (const row of page.items) {
      items.push(await this.summaryOf(row, feedback, reviews));
    }
    return {
      items: Object.freeze(items),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  private async summaryOf(
    row: IndexedConversation,
    feedback: readonly QaMessageFeedback[],
    reviews: readonly QaConversationReview[],
  ): Promise<QaConversationSummary> {
    const transcript = await this.transcript(row.conversationId);
    const mine = feedback.filter(
      (item) => item.conversationId === row.conversationId,
    );
    const lastActivity = transcript.ok
      ? transcript.project.lastActivity
      : undefined;
    const title = transcript.ok ? transcript.project.title : undefined;
    return Object.freeze({
      conversationId: row.conversationId,
      userId: row.userId,
      displayName: row.displayName,
      subroleId: row.subroleId,
      createdAt: row.createdAtIso,
      updatedAt: isoOf(Math.max(row.createdAt, lastActivity ?? row.createdAt)),
      ...(title === undefined ? {} : { title }),
      messageCount: transcript.ok ? transcript.project.messages.length : 0,
      positiveFeedback: mine.filter(({ rating }) => rating === "positive")
        .length,
      negativeFeedback: mine.filter(({ rating }) => rating === "negative")
        .length,
      reviewStatus: reviewStatusOf(reviews, row.conversationId),
    });
  }

  async conversation(
    token: string,
    conversationId: string,
  ): Promise<QaConversationDetail> {
    const { accounts, actor } = this.require(token, "conversations.read.own");
    const owner = accounts.ownerIdOf(conversationId);
    if (owner === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "this conversation is unknown to the deployment",
      );
    }
    // Reading someone else's conversation is exactly what
    // `conversations.read.all` buys; owning it is what the base permission buys.
    if (owner !== actor.id && !allows(actor.role, "conversations.read.all")) {
      this.options.logger.warn("admin.conversation-forbidden", {
        userId: actor.id,
        conversationId,
      });
      throw new QaAccountsError(
        "forbidden",
        "this conversation belongs to another account",
      );
    }
    const rows = await this.index();
    const row = rows.find((entry) => entry.conversationId === conversationId);
    if (row === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "this conversation is unknown to the deployment",
      );
    }
    const quality = this.options.quality();
    const feedback = quality.allFeedback();
    const reviews = quality.allReviews();
    const summary = await this.summaryOf(row, feedback, reviews);
    const transcript = await this.transcript(conversationId, true);
    const project = transcript.ok ? transcript.project : undefined;
    const messages: QaConversationMessage[] = (project?.messages ?? []).map(
      (message) =>
        Object.freeze({
          ...message,
          feedback: Object.freeze(
            feedback.filter(
              (item) =>
                item.conversationId === conversationId &&
                item.messageId === message.id,
            ),
          ),
          reviews: Object.freeze(
            reviews.filter(
              (item) =>
                item.conversationId === conversationId &&
                item.messageId === message.id,
            ),
          ),
        }),
    );
    return Object.freeze({
      conversationId,
      summary,
      runtime: Object.freeze({
        subroleId: row.subroleId,
        adminPreview: row.adminPreview,
        ...(project?.model === undefined ? {} : { model: project.model }),
        ...(project?.provider === undefined
          ? {}
          : { provider: project.provider }),
        ...(row.effectiveTools === undefined
          ? {}
          : { effectiveTools: row.effectiveTools }),
        ...(row.effectiveSkills === undefined
          ? {}
          : { effectiveSkills: row.effectiveSkills }),
        ...(project === undefined
          ? {}
          : { loadedSkills: project.loadedSkills }),
        ...(transcript.ok
          ? {}
          : { transcriptUnavailable: transcript.reason as never }),
      }),
      messages: Object.freeze(messages),
      reviews: Object.freeze(
        reviews.filter((item) => item.conversationId === conversationId),
      ),
      queueItems: Object.freeze(
        deriveQueue({
          feedback,
          reviews,
          manual: quality.manualQueue(),
          failures: this.failuresOf(conversationId, project),
        }).filter((item) => item.conversationId === conversationId),
      ),
    });
  }

  /**
   * Delete one conversation from the deployment.
   *
   * The Harness has no deletion seam: persistence offers create, open, flush,
   * stat and list, and a chat stops existing only when its stored log is gone.
   * This is where the console's delete button gets its teeth — the stored logs
   * of the conversation and of every session delegated from it are removed,
   * and then everything the QA layer kept about it: the ownership record that
   * is its authorization boundary, its ratings, reviews and queue entries, and
   * the sources it collected. The act is audited, because it destroys what a
   * person wrote, and that is not the same as hiding a row.
   *
   * Every refusal comes before anything is removed, so a chat is never
   * half-deleted: a conversation the Harness still holds open would have its
   * log written back by the next flush, and one the deployment stores somewhere
   * directories do not express cannot be removed at all.
   */
  async deleteConversation(
    token: string,
    conversationId: string,
  ): Promise<QaConversationDeletion> {
    const { accounts, actor } = this.require(token, "conversations.delete");
    const eraser = this.options.sessionFiles;
    if (eraser === undefined) {
      throw new QaAccountsError(
        "conversation-not-removable",
        "this deployment serves no stored-conversation removal",
      );
    }
    const owner = accounts.ownerIdOf(conversationId);
    const listing = await this.options.sessionLog.list();
    const headers = new Map(
      listing.headers.map((header) => [header.id, header]),
    );
    if (
      owner === undefined &&
      !headers.has(conversationId) &&
      !this.options.sessionLog.live(conversationId)
    ) {
      throw new QaAccountsError(
        "conversation-unknown",
        "this conversation is unknown to the deployment",
      );
    }
    const targets = [
      conversationId,
      ...descendantsOf(conversationId, listing.headers),
    ];
    const held = targets.find((sessionId) =>
      this.options.sessionLog.live(sessionId),
    );
    if (held !== undefined) {
      throw new QaAccountsError(
        "conversation-live",
        "the Harness still holds this conversation open",
      );
    }
    const outcome = await eraser.erase(targets);
    if (
      headers.has(conversationId) &&
      !outcome.removed.includes(conversationId)
    ) {
      // The Harness lists the chat, storage has no directory for it: this
      // deployment keeps sessions somewhere directories do not express, and
      // dropping the records would leave the chat itself behind.
      throw new QaAccountsError(
        "conversation-not-removable",
        "this deployment does not store conversations as directories",
      );
    }
    accounts.forgetSessions(new Set(targets));
    const qualityRows = this.options.quality().dropConversations(targets);
    for (const sessionId of targets) this.options.dropSources?.(sessionId);
    this.transcripts.delete(conversationId);
    this.options.quality().appendAudit({
      actorId: actor.id,
      action: "conversation.deleted",
      targetType: "conversation",
      targetId: conversationId,
      before: {
        owner: owner ?? null,
        sessions: targets.length,
      },
      after: { removed: outcome.removed.length },
    });
    this.options.logger.info("admin.conversation-deleted", {
      conversationId,
      actor: actor.id,
      sessions: outcome.removed.length,
      absent: outcome.absent.length,
      qualityRows,
    });
    return Object.freeze({
      conversationId,
      sessions: Object.freeze([...outcome.removed]),
      qualityRows,
    });
  }
  private failuresOf(
    conversationId: string,
    project: QaProjectedTranscript | undefined,
  ): readonly QaToolFailureSignal[] {
    if (project === undefined) return [];
    const signals: QaToolFailureSignal[] = [];
    for (const message of project.messages) {
      for (const call of message.toolCalls ?? []) {
        if (call.error === undefined) continue;
        signals.push({
          conversationId,
          messageId: message.id,
          at: isoOf(call.time ?? message.time),
        });
      }
    }
    return signals;
  }

  private async failureSignals(
    rows: readonly IndexedConversation[],
  ): Promise<readonly QaToolFailureSignal[]> {
    const signals: QaToolFailureSignal[] = [];
    for (const row of rows) {
      const transcript = await this.transcript(row.conversationId);
      if (!transcript.ok) continue;
      signals.push(...this.failuresOf(row.conversationId, transcript.project));
    }
    return signals;
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  /**
   * Record the caller's verdict on one assistant message. The conversation must
   * be the caller's own: a rating is the user's own signal, and nobody rates
   * someone else's answer on their behalf.
   */
  rateMessage(
    token: string,
    conversationId: string,
    messageId: string,
    input: QaMessageFeedbackInput,
  ): QaMessageFeedback {
    const { accounts, actor } = this.require(token, "conversations.read.own");
    if (accounts.ownerIdOf(conversationId) !== actor.id) {
      throw new QaAccountsError(
        "forbidden",
        "feedback may only be given on your own conversations",
      );
    }
    const record = this.options
      .quality()
      .rateFeedback({ conversationId, messageId, userId: actor.id }, input);
    this.options.logger.info("admin.feedback-recorded", {
      conversationId,
      messageId,
      rating: record.rating,
      userId: actor.id,
    });
    return record;
  }

  async feedback(
    token: string,
    query: QaFeedbackQuery,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<QaAdminPage<QaFeedbackRow>> {
    this.require(token, "reviews.read");
    const rows = await this.index();
    const quality = this.options.quality();
    const reviews = quality.allReviews();
    const ratingFilter = given(query.rating);
    const userFilter = given(query.userId);
    const subroleFilter = given(query.subroleId);
    const reasonFilter = given(query.reason);
    const reviewFilter = given(query.reviewStatus);
    const from = epochOf(given(query.from) ?? undefined);
    const to = epochOf(given(query.to) ?? undefined);
    const conversations = new Map(rows.map((row) => [row.conversationId, row]));
    const filtered = quality.allFeedback().filter((row) => {
      const conversation = conversations.get(row.conversationId);
      if (ratingFilter !== undefined && row.rating !== ratingFilter)
        return false;
      if (userFilter !== undefined && row.userId !== userFilter) return false;
      if (
        subroleFilter !== undefined &&
        conversation?.subroleId !== subroleFilter
      ) {
        return false;
      }
      if (
        reasonFilter !== undefined &&
        !(row.reasons ?? []).includes(reasonFilter)
      ) {
        return false;
      }
      const at = epochOf(row.createdAt);
      if (from !== undefined && (at === undefined || at < from)) return false;
      if (to !== undefined && (at === undefined || at > to)) return false;
      if (
        reviewFilter !== undefined &&
        reviewStatusOf(reviews, row.conversationId) !== reviewFilter
      ) {
        return false;
      }
      return true;
    });
    const sorted = [...filtered].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    const page = paginate({
      rows: sorted,
      keyOf: (row) => row.createdAt,
      idOf: (row) => row.id,
      cursor,
      limit: clampLimit(limit),
    });
    // Titles are read for the rows on this page only: a title lives in the
    // conversation's log, and paging is what keeps that work bounded.
    const titles = new Map<string, string | undefined>();
    for (const row of page.items) {
      const transcript = await this.transcript(row.conversationId);
      titles.set(
        row.conversationId,
        transcript.ok ? transcript.project.title : undefined,
      );
    }
    return {
      items: Object.freeze(
        this.feedbackRows(rows, page.items, reviews, titles),
      ),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  private feedbackRows(
    rows: readonly IndexedConversation[],
    feedback: readonly QaMessageFeedback[],
    reviews: readonly QaConversationReview[],
    titles: ReadonlyMap<string, string | undefined> = new Map(),
  ): readonly QaFeedbackRow[] {
    const conversations = new Map(rows.map((row) => [row.conversationId, row]));
    return feedback.map((row) => {
      const conversation = conversations.get(row.conversationId);
      const title = titles.get(row.conversationId);
      return Object.freeze({
        ...row,
        displayName: conversation?.displayName ?? row.userId,
        subroleId: conversation?.subroleId ?? "",
        ...(title === undefined ? {} : { conversationTitle: title }),
        reviewStatus: reviewStatusOf(reviews, row.conversationId),
      });
    });
  }

  // -------------------------------------------------------------------------
  // Review queue and results
  // -------------------------------------------------------------------------

  private async queueRows(
    rows?: readonly IndexedConversation[],
  ): Promise<readonly QaReviewQueueRow[]> {
    const conversations = rows ?? (await this.index());
    const quality = this.options.quality();
    const reviews = quality.allReviews();
    const byId = new Map(conversations.map((row) => [row.conversationId, row]));
    const queue = deriveQueue({
      feedback: quality.allFeedback(),
      reviews,
      manual: quality.manualQueue(),
      failures: await this.failureSignals(
        [...conversations]
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, QA_ADMIN_SCAN_LIMIT),
      ),
    });
    const result: QaReviewQueueRow[] = [];
    for (const item of queue) {
      const row = byId.get(item.conversationId);
      if (row === undefined) continue;
      const transcript = await this.transcript(item.conversationId);
      const review = reviews.find((entry) => entry.id === item.reviewId);
      result.push(
        Object.freeze({
          ...item,
          displayName: row.displayName,
          subroleId: row.subroleId,
          ...(transcript.ok && transcript.project.title !== undefined
            ? { title: transcript.project.title }
            : {}),
          raisedAtLabel: item.raisedAt,
          ...(review === undefined
            ? {}
            : {
                issueSummary: review.issues,
                severity: review.severity,
              }),
        }),
      );
    }
    return Object.freeze(result);
  }

  async reviewQueue(
    token: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<QaAdminPage<QaReviewQueueRow>> {
    this.require(token, "reviews.read");
    const rows = await this.queueRows();
    return paginate({
      rows,
      keyOf: (row) => `${row.priority}:${row.raisedAt}`,
      idOf: (row) =>
        `${row.conversationId}:${row.messageId ?? ""}:${row.feedbackId ?? row.reviewId ?? ""}`,
      cursor,
      limit: clampLimit(limit),
    });
  }

  /** Park a conversation for review without rating it. */
  queueConversation(
    token: string,
    conversationId: string,
    messageId: string | undefined,
  ): QaReviewQueueItem {
    const { accounts, actor } = this.require(token, "reviews.write");
    if (accounts.ownerIdOf(conversationId) === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "this conversation is unknown to the deployment",
      );
    }
    const entry = this.options
      .quality()
      .enqueueReview(actor.id, conversationId, messageId);
    this.options.quality().appendAudit({
      actorId: actor.id,
      action: "review.queued",
      targetType: "conversation",
      targetId: conversationId,
      after: { messageId: entry.messageId ?? null },
    });
    return {
      conversationId,
      ...(entry.messageId === undefined ? {} : { messageId: entry.messageId }),
      reason: "manual",
      priority: "normal",
      status: "unreviewed",
      raisedAt: entry.createdAt,
    };
  }

  /** Save a reviewer's verdict, and take the item out of the queue when done. */
  saveReview(
    token: string,
    input: QaConversationReviewInput,
  ): QaConversationReview {
    const { accounts, actor } = this.require(token, "reviews.write");
    if (accounts.ownerIdOf(input.conversationId) === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "this conversation is unknown to the deployment",
      );
    }
    const quality = this.options.quality();
    const { review, created } = quality.saveReview(actor.id, input);
    quality.appendAudit({
      actorId: actor.id,
      action: created ? "conversation.reviewed" : "review.updated",
      targetType: "conversation",
      targetId: input.conversationId,
      after: review,
    });
    if (review.status === "needs_followup") {
      quality.enqueueReview(actor.id, input.conversationId, input.messageId);
    } else {
      quality.dequeueReview(input.conversationId, input.messageId);
    }
    this.options.logger.info("admin.review-saved", {
      conversationId: input.conversationId,
      reviewerId: actor.id,
      status: review.status,
      severity: review.severity,
    });
    return review;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /**
   * The audit trail as one table. Two writers keep records — the capability
   * service, whose repository predates the console, and the quality store —
   * and an administrator expects one timeline, so both are normalized here.
   */
  async audit(
    token: string,
    query: QaAuditQuery,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<QaAdminPage<QaAdminAuditEvent>> {
    this.require(token, "audit.read");
    const actorFilter = given(query.actorId);
    const actionFilter = given(query.action);
    const from = epochOf(given(query.from) ?? undefined);
    const to = epochOf(given(query.to) ?? undefined);
    const rows = [
      ...this.accessAuditEvents(),
      ...this.options.quality().auditEvents(),
    ]
      .filter((row) => {
        if (actorFilter !== undefined && row.actorId !== actorFilter) {
          return false;
        }
        if (actionFilter !== undefined && row.action !== actionFilter) {
          return false;
        }
        const at = epochOf(row.timestamp);
        if (from !== undefined && (at === undefined || at < from)) return false;
        if (to !== undefined && (at === undefined || at > to)) return false;
        return true;
      })
      .sort((left, right) =>
        right.timestamp === left.timestamp
          ? right.id.localeCompare(left.id)
          : right.timestamp.localeCompare(left.timestamp),
      );
    return paginate({
      rows,
      keyOf: (row) => row.timestamp,
      idOf: (row) => row.id,
      cursor,
      limit: clampLimit(limit),
    });
  }

  /** Capability-policy events, reshaped into the console's audit vocabulary. */
  private accessAuditEvents(): readonly QaAdminAuditEvent[] {
    const actions: Readonly<Record<string, QaAdminAuditEvent["action"]>> = {
      "subrole.created": "subrole.created",
      "subrole.updated": "subrole.updated",
      "subrole.deleted": "subrole.deleted",
      "common.updated": "common_capabilities.updated",
      "assignment.updated": "subrole.assignment.changed",
    };
    const events: QaAdminAuditEvent[] = [];
    const source = this.options.roles().audit();
    source.forEach((event, index) => {
      const action = actions[event.action];
      if (action === undefined) return;
      events.push(
        Object.freeze({
          id: `policy:${index}:${event.timestamp}`,
          timestamp: event.timestamp,
          actorId: event.actorId,
          action,
          targetType: "capability",
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
          ...(event.before === undefined ? {} : { before: event.before }),
          ...(event.after === undefined ? {} : { after: event.after }),
        }),
      );
    });
    return events;
  }
}
