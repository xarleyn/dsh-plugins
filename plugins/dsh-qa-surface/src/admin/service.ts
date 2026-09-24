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
  QaAdminSkillOwner,
  QaAdminSkillScope,
  QaAdminSkillsView,
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
  QaFeedbackHarvestEntry,
  QaFeedbackHarvestResult,
  QaFeedbackQuery,
  QaFeedbackRow,
  QaMessageFeedback,
  QaMessageFeedbackInput,
  QaOverviewAlert,
  QaPasswordResetRequest,
  QaPermission,
  QaQualityMetrics,
  QaReviewQueueItem,
  QaReviewQueueRow,
  QaReviewStatus,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillRemoval,
  QaSkillToolDescriptor,
  QaSkillValidation,
  QaTranscriptUnavailableReason,
  QaUserAccess,
  QaUserQuery,
} from "../types.js";
import type {
  QaPersonalSkills,
  QaSkillScope,
} from "../personal-skills/index.js";
import { allows } from "./permissions.js";
import { aggregateQuality, type QaConversationFact } from "./metrics.js";
import { paginate } from "./paging.js";
import { deriveQueue, type QaToolFailureSignal } from "./queue.js";
import { QA_FEEDBACK_RATINGS, type QaQualityStore } from "./quality-store.js";
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

/**
 * How long one projected log may serve the list and metrics before it is read
 * again — and only while the Harness still holds that conversation. A log no
 * process holds cannot gain events, so re-reading it is pure cost: on a
 * deployment with a durable store one read pays for a listing of every stored
 * session and a replay of the whole log before it reaches the one conversation
 * asked for. Reading the scan window again on every page load is what took the
 * aggregate pages minutes; keeping what cannot have changed is what makes the
 * next load free.
 */
const TRANSCRIPT_TTL_MS = 30_000;

/**
 * How many projections the cache holds. It has to cover one scan window with
 * room for a page of summaries: a cache narrower than the window evicts the
 * conversations a pass has already read, and the next pass pays for them again.
 */
const TRANSCRIPT_CACHE_MAX = QA_ADMIN_SCAN_LIMIT + QA_ADMIN_PAGE_MAX;

/**
 * What one harvest request may carry. The browser replays its ratings in
 * batches far below this; the ceiling is what a caller that ignored them is
 * refused outright, rather than half-applied.
 */
const MAX_HARVEST_BATCH = 500;

/** One harvested identifier, or undefined when the entry cannot be filed. */
function harvestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

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

/** What one pass over the scan window answers for the aggregate pages. */
interface QaAggregateRows {
  readonly facts: readonly QaConversationFact[];
  readonly failures: readonly QaToolFailureSignal[];
}

/**
 * One aggregate pass, shared by every caller waiting for the same window. A
 * reviewer who gives up on a page that has not answered and opens the next one
 * used to start a second scan while the first was still reading; two concurrent
 * scans of the newest logs is exactly the load that parks the remaining
 * administrative calls behind them.
 */
interface QaRunningScan {
  readonly window: readonly string[];
  readonly promise: Promise<QaAggregateRows>;
  /** The cancellation of each caller waiting for this pass. */
  readonly waiting: Set<AbortSignal | undefined>;
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
  /**
   * The skill store both scopes read and write, resolved lazily so the console
   * never constructs storage before someone opens its skills page.
   */
  readonly skills: () => QaPersonalSkills;
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

/**
 * Whether a running pass has no caller left to answer. A caller that passed no
 * cancellation cannot leave, so it keeps the pass alive.
 */
function nobodyWaits(waiting: ReadonlySet<AbortSignal | undefined>): boolean {
  for (const signal of waiting) {
    if (signal === undefined || !signal.aborted) return false;
  }
  return true;
}

function sameWindow(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export class QaAdminService {
  private readonly redactor: QaAdminRedactor;
  /** The aggregate pass running now, shared by the callers waiting for it. */
  private scanning: QaRunningScan | undefined;
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

  /**
   * One conversation's projected log, held across calls.
   *
   * A log the Harness no longer holds is finished — nothing can append to it —
   * so its projection stays valid until the cache evicts it or the conversation
   * is deleted. Only a log this process is still writing is re-read once the TTL
   * expires. A cache hit counts as a use: an aggregate pass walks the whole
   * window, and evicting by read time would drop the conversations the pages ask
   * for most often and then read them again.
   *
   * The one answer this can hold back is a conversation resumed and finished
   * between two page loads: its counters lag until the log is read for another
   * reason. The conversation itself is never affected — the detail view always
   * reads the log — and what the aggregate pages show instead is the newest
   * projection of every finished conversation, which is the cheaper lie.
   */
  private async transcript(
    conversationId: string,
    fresh = false,
  ): Promise<
    | { readonly ok: true; readonly project: QaProjectedTranscript }
    | { readonly ok: false; readonly reason: QaTranscriptUnavailableReason }
  > {
    const cached = this.transcripts.get(conversationId);
    const now = this.options.clock?.now() ?? Date.now();
    if (cached !== undefined) {
      const stale =
        fresh ||
        (this.options.sessionLog.live(conversationId) &&
          now - cached.at >= TRANSCRIPT_TTL_MS);
      if (!stale) {
        this.retain(conversationId, cached);
        return { ok: true, project: cached.project };
      }
      this.transcripts.delete(conversationId);
    }
    const result = await this.options.sessionLog.read(conversationId);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    const project = projectTranscript(result.events, this.redactor);
    this.retain(conversationId, {
      at: this.options.clock?.now() ?? Date.now(),
      project,
    });
    return { ok: true, project };
  }

  /** Insert or re-touch one projection, keeping the cache inside its budget. */
  private retain(
    conversationId: string,
    entry: { readonly at: number; readonly project: QaProjectedTranscript },
  ): void {
    this.transcripts.delete(conversationId);
    this.transcripts.set(conversationId, entry);
    while (this.transcripts.size > TRANSCRIPT_CACHE_MAX) {
      const oldest = this.transcripts.keys().next();
      if (oldest.done === true) break;
      this.transcripts.delete(oldest.value);
    }
  }

  /**
   * The aggregate rows of the newest scan window, read in one pass.
   *
   * The message counts and the tool failures come from the same projections, so
   * one walk fills both. While a walk runs, a caller that wants the same window
   * joins it rather than starting a second scan of the deployment's logs, and the
   * walk stops once no caller waits for it: a scan nobody is reading is only ever
   * a load on the store.
   */
  private async scanOf(
    rows: readonly IndexedConversation[],
    signal: AbortSignal | undefined,
  ): Promise<QaAggregateRows> {
    signal?.throwIfAborted();
    const window = [...rows]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, QA_ADMIN_SCAN_LIMIT);
    const ids = window.map((row) => row.conversationId);
    const running = this.scanning;
    if (
      running !== undefined &&
      !nobodyWaits(running.waiting) &&
      sameWindow(running.window, ids)
    ) {
      running.waiting.add(signal);
      try {
        return await running.promise;
      } finally {
        running.waiting.delete(signal);
      }
    }
    const facts: QaConversationFact[] = [];
    const failures: QaToolFailureSignal[] = [];
    const waiting = new Set<AbortSignal | undefined>([signal]);
    const promise = this.walk(window, waiting, facts, failures);
    const pass: QaRunningScan = { window: ids, promise, waiting };
    this.scanning = pass;
    void promise
      .catch(() => undefined)
      .then(() => {
        if (this.scanning === pass) this.scanning = undefined;
      });
    try {
      return await promise;
    } finally {
      waiting.delete(signal);
    }
  }

  /**
   * Walk one scan window, filling the counts and the failure signals as it goes.
   *
   * `waiting` is the caller set of the pass this walk belongs to: the walk gives
   * up between two reads once every caller has left, so a reviewer who abandons a
   * page that has not answered does not keep the deployment reading logs for an
   * answer nobody will see.
   */
  private async walk(
    window: readonly IndexedConversation[],
    waiting: ReadonlySet<AbortSignal | undefined>,
    facts: QaConversationFact[],
    failures: QaToolFailureSignal[],
  ): Promise<QaAggregateRows> {
    for (const row of window) {
      if (nobodyWaits(waiting)) {
        throw new Error("qa admin aggregate scan abandoned: no caller left");
      }
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
      if (transcript.ok) {
        failures.push(
          ...this.failuresOf(row.conversationId, transcript.project),
        );
      }
    }
    return { facts, failures };
  }

  // -------------------------------------------------------------------------
  // Overview and metrics
  // -------------------------------------------------------------------------

  async overview(
    token: string,
    signal?: AbortSignal,
  ): Promise<QaAdminOverview> {
    this.require(token, "conversations.read.all");
    const rows = await this.index();
    const metrics = await this.metricsOf(rows, signal);
    const fresh = [...this.options.quality().allFeedback()].sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
    const queue = await this.queueRows(rows, signal);
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

  async metrics(
    token: string,
    signal?: AbortSignal,
  ): Promise<QaQualityMetrics> {
    this.require(token, "analytics.read");
    return this.metricsOf(await this.index(), signal);
  }

  private async metricsOf(
    rows: readonly IndexedConversation[],
    signal: AbortSignal | undefined,
  ): Promise<QaQualityMetrics> {
    const quality = this.options.quality();
    // Feedback and reviews are exact; the message counts come from the bounded
    // log scan and are labelled as such where they are shown.
    return aggregateQuality({
      conversations: (await this.scanOf(rows, signal)).facts,
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
   * Accounts that asked for a password reset from the sign-in screen. Reading
   * the list takes `users.read` — a reviewer has no business seeing who is
   * locked out; answering one takes `users.manage`, since a reset is a write
   * to a credential.
   */
  async passwordResetRequests(
    token: string,
  ): Promise<readonly QaPasswordResetRequest[]> {
    const { accounts } = this.require(token, "users.read");
    return accounts.passwordResetRequests();
  }

  /**
   * Answer one forgotten-password request: set a new password for the account
   * and clear its queue row. Every live session of that account dies with the
   * token-version bump, so the user signs in with the password the operator
   * handed over. Audited, because an operator setting somebody else's
   * credential must leave a trace.
   */
  async resetUserPassword(
    token: string,
    userId: string,
    password: string,
  ): Promise<QaAdminUserDetail> {
    const { accounts, actor } = this.require(token, "users.manage");
    const before = accounts.adminUser(userId, (value) =>
      normalizeUserAccess(value, this.options.roles().snapshot()),
    );
    if (before === undefined) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    accounts.resetUserPassword(userId, password);
    this.options.quality().appendAudit({
      actorId: actor.id,
      action: "user.password-reset",
      targetType: "user",
      targetId: userId,
    });
    this.options.logger.info("admin.password-reset", {
      userId,
      actor: actor.id,
    });
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
    signal?: AbortSignal,
  ): Promise<QaAdminPage<QaConversationSummary>> {
    this.require(token, "conversations.read.all");
    signal?.throwIfAborted();
    const rows = await this.index();
    const quality = this.options.quality();
    const feedback = quality.allFeedback();
    const reviews = quality.allReviews();

    const userIdFilter = given(query.userId);
    const subroleFilter = given(query.subroleId);
    const ratingFilter = given(query.rating);
    const reviewFilter = given(query.reviewStatus);
    const search = given(query.search) ?? "";
    const searching = search.trim() !== "";
    const from = epochOf(given(query.from) ?? undefined);
    const to = epochOf(given(query.to) ?? undefined);
    // A search may name a title, which only the log knows, so the candidate
    // set is bounded by the newest logs before the text is available. Without
    // search text no filter here needs a log at all — and reading one per
    // candidate to answer a page of twenty-five rows made this call cost every
    // conversation the deployment stores, each read paying for a listing of all
    // of them before it reaches the one log asked for.
    const searchable = searching
      ? [...rows]
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, QA_ADMIN_SCAN_LIMIT)
      : rows;

    const candidates: IndexedConversation[] = [];
    for (const row of searchable) {
      signal?.throwIfAborted();
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
      // Only a search reads a candidate's log, and the projection stays cached
      // for the summary of the rows that survive the filter.
      let title: string | undefined;
      if (searching) {
        const transcript = await this.transcript(row.conversationId);
        title = transcript.ok ? transcript.project.title : undefined;
      }
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
      signal?.throwIfAborted();
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
    // A removed log is never read again, so its projection must not survive to
    // answer a later page: the cache holds it as if the conversation existed.
    for (const sessionId of targets) this.transcripts.delete(sessionId);
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

  /**
   * Replay the ratings a browser still holds from the window in which a thumbs
   * never reached the Host.
   *
   * A harvest never overwrites. The browser's map stores no timestamp, so an
   * entry may well be a rating the same user has since filed together with a
   * reason and a comment; replacing that record with the bare thumbs would
   * delete exactly what a reviewer reads. An entry the Host already answers for
   * is counted as present and left alone.
   *
   * One unusable or foreign entry costs that entry alone: a browser keeps
   * ratings of chats it no longer owns, and the rest of the replay must not be
   * lost because of them.
   */
  harvestFeedback(
    token: string,
    entries: readonly QaFeedbackHarvestEntry[],
  ): QaFeedbackHarvestResult {
    const { accounts, actor } = this.require(token, "conversations.read.own");
    if (!Array.isArray(entries)) {
      throw new TypeError("entries must be an array");
    }
    if (entries.length > MAX_HARVEST_BATCH) {
      throw new QaAccountsError("auth-required", "harvest batch is too large");
    }
    const quality = this.options.quality();
    let recorded = 0;
    let present = 0;
    let rejected = 0;
    for (const entry of entries) {
      const conversationId = harvestId(entry?.conversationId);
      const messageId = harvestId(entry?.messageId);
      const rating = entry?.rating;
      if (
        conversationId === undefined ||
        messageId === undefined ||
        !QA_FEEDBACK_RATINGS.includes(rating)
      ) {
        rejected += 1;
        continue;
      }
      if (accounts.ownerIdOf(conversationId) !== actor.id) {
        rejected += 1;
        continue;
      }
      if (
        quality.feedbackOf(conversationId, messageId, actor.id) !== undefined
      ) {
        present += 1;
        continue;
      }
      try {
        quality.rateFeedback(
          { conversationId, messageId, userId: actor.id },
          { rating },
        );
        recorded += 1;
      } catch (error) {
        // The store re-validates what it is given, and one row it refuses is
        // that row's problem rather than the batch's.
        this.options.logger.warn("admin.feedback-harvest-entry-refused", {
          conversationId,
          messageId,
          userId: actor.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        rejected += 1;
      }
    }
    this.options.logger.info("admin.feedback-harvested", {
      userId: actor.id,
      recorded,
      present,
      rejected,
    });
    return { recorded, present, rejected };
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
    signal?: AbortSignal,
  ): Promise<readonly QaReviewQueueRow[]> {
    const conversations = rows ?? (await this.index());
    const quality = this.options.quality();
    const reviews = quality.allReviews();
    const byId = new Map(conversations.map((row) => [row.conversationId, row]));
    const queue = deriveQueue({
      feedback: quality.allFeedback(),
      reviews,
      manual: quality.manualQueue(),
      failures: (await this.scanOf(conversations, signal)).failures,
    });
    const result: QaReviewQueueRow[] = [];
    for (const item of queue) {
      signal?.throwIfAborted();
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
    signal?: AbortSignal,
  ): Promise<QaAdminPage<QaReviewQueueRow>> {
    this.require(token, "reviews.read");
    const rows = await this.queueRows(await this.index(), signal);
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
  // Skill files
  //
  // An administrator edits two stores through one console: the deployment's
  // shared skills, and the personal skills of one named account. Neither is a
  // second editor — every call lands in the same storage service the owner's
  // own editor uses, which is what keeps path checks, validation and catalog
  // invalidation identical. What the console adds is authorization, an audit
  // row, and the mark that tells the owner who wrote their file.
  // -------------------------------------------------------------------------

  /**
   * Resolve one requested scope into what the storage service understands.
   * The account id arrives from the browser, so an unknown one is refused
   * here: deriving a directory for it would create storage for nobody.
   */
  private skillTarget(
    accounts: QaAccounts,
    scope: QaAdminSkillScope,
  ): {
    readonly scope: QaSkillScope;
    readonly owner: QaAdminSkillOwner | null;
  } {
    if (scope.kind === "shared") {
      return { scope: { shared: true }, owner: null };
    }
    const account = accounts.directory().find(({ id }) => id === scope.userId);
    if (account === undefined) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    return {
      scope: { userId: account.id },
      owner: {
        userId: account.id,
        email: account.email,
        displayName: account.displayName,
      },
    };
  }

  /**
   * One audit image of a skill. The body is deliberately not part of it: the
   * trail records who changed which skill and to what revision, and a stored
   * transcript of a person's instructions belongs in the skill, not doubled in
   * every audit row.
   */
  private skillImage(
    target: { readonly owner: QaAdminSkillOwner | null },
    document: QaSkillDocument,
  ): Readonly<Record<string, unknown>> {
    return {
      scope: target.owner === null ? "shared" : "user",
      ownerId: target.owner?.userId ?? null,
      name: document.name,
      description: document.description,
      revision: document.revision,
    };
  }

  /** The catalog of one scope with the facts the console names it by. */
  async skills(
    token: string,
    scope: QaAdminSkillScope,
  ): Promise<QaAdminSkillsView> {
    const { accounts } = this.require(token, "skills.manage");
    const target = this.skillTarget(accounts, scope);
    const skills = this.options.skills();
    return {
      scope,
      owner: target.owner,
      skills: skills.list(target.scope),
      rootPath: skills.rootPath(target.scope),
    };
  }

  /** One skill file with its body and the revision a save must echo. */
  async skill(
    token: string,
    scope: QaAdminSkillScope,
    name: string,
  ): Promise<QaSkillDocument> {
    const { accounts } = this.require(token, "skills.manage");
    const target = this.skillTarget(accounts, scope);
    return this.options.skills().get(target.scope, name);
  }

  /**
   * Check an unsaved draft against the target scope: the file a save would
   * write, and every diagnostic for it.
   */
  async validateSkill(
    token: string,
    scope: QaAdminSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<QaSkillValidation> {
    const { accounts } = this.require(token, "skills.manage");
    const target = this.skillTarget(accounts, scope);
    return this.options.skills().validate(target.scope, name, input);
  }

  /** The tool catalog the picker offers for one scope. */
  async skillTools(
    token: string,
    scope: QaAdminSkillScope,
  ): Promise<readonly QaSkillToolDescriptor[]> {
    const { accounts } = this.require(token, "skills.manage");
    const target = this.skillTarget(accounts, scope);
    return this.options.skills().tools(target.scope);
  }

  /**
   * Create (`name` null) or replace one skill. The write is marked as this
   * administrator's, so the owner reads it as an administrator's edit rather
   * than as a silent substitution, and it is audited with both images.
   */
  async saveSkill(
    token: string,
    scope: QaAdminSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): Promise<QaSkillDocument> {
    const { accounts, actor } = this.require(token, "skills.manage");
    const target = this.skillTarget(accounts, scope);
    const skills = this.options.skills();
    const before = name === null ? undefined : this.existingSkill(target, name);
    const document =
      name === null
        ? skills.create(target.scope, input, { actorId: actor.id })
        : skills.update(target.scope, name, input, { actorId: actor.id });
    this.options.quality().appendAudit({
      actorId: actor.id,
      action: name === null ? "skill.created" : "skill.updated",
      targetType: "skill",
      targetId: document.name,
      ...(before === undefined
        ? {}
        : { before: this.skillImage(target, before) }),
      after: this.skillImage(target, document),
    });
    this.options.logger.info("admin.skill-saved", {
      actor: actor.id,
      scope: target.owner === null ? "shared" : "user",
      skill: document.name,
      created: name === null,
    });
    return document;
  }

  /** Remove one skill into the trash beside its own skills root. */
  async removeSkill(
    token: string,
    scope: QaAdminSkillScope,
    name: string,
    expectedRevision: string | null,
  ): Promise<QaSkillRemoval> {
    const { accounts, actor } = this.require(token, "skills.manage");
    const target = this.skillTarget(accounts, scope);
    const before = this.existingSkill(target, name);
    const removal = this.options
      .skills()
      .remove(target.scope, name, expectedRevision);
    this.options.quality().appendAudit({
      actorId: actor.id,
      action: "skill.deleted",
      targetType: "skill",
      targetId: name,
      before: this.skillImage(target, before),
    });
    this.options.logger.info("admin.skill-removed", {
      actor: actor.id,
      scope: target.owner === null ? "shared" : "user",
      skill: name,
    });
    return removal;
  }

  /** One skill as it exists now; a missing one is the service's refusal. */
  private existingSkill(
    target: { readonly scope: QaSkillScope },
    name: string,
  ): QaSkillDocument {
    return this.options.skills().get(target.scope, name);
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
