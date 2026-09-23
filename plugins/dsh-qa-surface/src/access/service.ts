import { createHash } from "node:crypto";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { ScopeKey } from "@deepseek-ai/dsh-scope";
// The `types` subpath keeps the client ISessions Context merge authoritative,
// mirroring the admission boundary's import.
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAccountsError } from "../accounts/store.js";
import type { QaAccounts, QaSessionFacts } from "../accounts/store.js";
import type { QaAgentToolGrants } from "../enforcement/tool-grants.js";
import { QaAgentToolGrants as Grants } from "../enforcement/tool-grants.js";
import type {
  QaAccessAdminSnapshot,
  QaAccountUserPublic,
  QaCapabilityConfig,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaClaimResult,
  QaCurrentAccess,
  QaEffectiveCapabilityPolicy,
  QaSessionAccess,
  QaSkillAccess,
  QaSkillActivationRecord,
  QaSkillAssignmentOverride,
  QaSkillDescriptor,
  QaSubrole,
  QaUserAccess,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import type { QaSessionLogReader } from "../admin/session-log.js";
import {
  enabledSubroles,
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
  resolveSkillAccess,
} from "./model.js";
import {
  QaCapabilityCatalog,
  withMissingCapabilities,
  type CapabilityCatalogSnapshot,
} from "./capability-catalog.js";
import { QaRoleRepository } from "./role-repository.js";

/** Attempts recorded per session before the oldest ones are dropped. */
const MAX_SKILL_ACTIVATIONS = 100;

export interface QaResolvedSessionPolicy {
  readonly policy: QaEffectiveCapabilityPolicy;
  readonly skills: CapabilityCatalogSnapshot["skills"];
  readonly skillMetadata: CapabilityCatalogSnapshot["skillMetadata"];
  /** Preview sessions label their own activation records. */
  readonly adminPreview: boolean;
  /**
   * Build the live tool policy of one agent. The admission calls this only
   * when it installs a policy, so a repeated attestation never stacks a second
   * scoped restriction.
   */
  readonly createGrants: () => QaAgentToolGrants;
}

function configuredCapabilities(config: QaCapabilityConfig): {
  readonly tools: readonly string[];
  readonly skills: readonly string[];
} {
  return {
    tools: [
      ...new Set([
        ...config.common.tools.always,
        ...config.common.tools.skillGrantable,
        // Denied names stay in the catalogue rows: a denial must remain
        // visible (and fixable) even when the tool it names is not mounted.
        ...(config.common.tools.deny ?? []),
        ...config.subroles.flatMap(({ capabilities }) => [
          ...capabilities.tools.always,
          ...capabilities.tools.skillGrantable,
          ...(capabilities.tools.deny ?? []),
        ]),
      ]),
    ],
    skills: [
      ...new Set([
        ...config.common.skills,
        ...config.subroles.flatMap(({ capabilities }) => capabilities.skills),
      ]),
    ],
  };
}

/**
 * Opaque revision of everything that shaped one policy.
 *
 * A session records it next to its snapshot so a later review can tell whether
 * a conversation ran under the policy that is in force now.
 */
function policyRevision(
  config: QaCapabilityConfig,
  metadata: ReadonlyMap<string, QaSkillDescriptor>,
  tools: ReadonlySet<string>,
): string {
  return createHash("sha1")
    .update(
      JSON.stringify([
        config,
        [...metadata]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, descriptor]) => [
            name,
            descriptor.audience,
            descriptor.requiredTools,
            descriptor.requireAll,
          ]),
        [...tools].sort(),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

function requireExactAssignment(
  input: QaUserAccess,
  config: QaCapabilityConfig,
): QaUserAccess {
  const enabled = new Set(enabledSubroles(config).map(({ id }) => id));
  const allowed = [...new Set(input.allowedSubroles)];
  if (
    allowed.length === 0 ||
    allowed.some((id) => !enabled.has(id)) ||
    !allowed.includes(input.defaultSubrole)
  ) {
    throw new TypeError(
      "assignment must name enabled roles and select one of them as default",
    );
  }
  return Object.freeze({
    allowedSubroles: Object.freeze(allowed),
    defaultSubrole: input.defaultSubrole,
  });
}

function freezePolicy(
  policy: QaEffectiveCapabilityPolicy,
): QaEffectiveCapabilityPolicy {
  return Object.freeze({
    subroleId: policy.subroleId,
    tools: Object.freeze([...policy.tools]),
    grantableTools: Object.freeze([...policy.grantableTools]),
    skills: Object.freeze([...policy.skills]),
    userSkills: Object.freeze([...policy.userSkills]),
    sources: Object.freeze({
      systemTools: Object.freeze([...policy.sources.systemTools]),
      commonTools: Object.freeze([...policy.sources.commonTools]),
      roleTools: Object.freeze([...policy.sources.roleTools]),
      commonGrantableTools: Object.freeze([
        ...policy.sources.commonGrantableTools,
      ]),
      roleGrantableTools: Object.freeze([...policy.sources.roleGrantableTools]),
      systemSkills: Object.freeze([...policy.sources.systemSkills]),
      commonSkills: Object.freeze([...policy.sources.commonSkills]),
      roleSkills: Object.freeze([...policy.sources.roleSkills]),
      declaredSkills: Object.freeze([...policy.sources.declaredSkills]),
    }),
    missingTools: Object.freeze([...policy.missingTools]),
    missingSkills: Object.freeze([...policy.missingSkills]),
    policyRevision: policy.policyRevision,
  });
}

function retainInstalledSnapshot(
  stored: QaEffectiveCapabilityPolicy,
  catalog: CapabilityCatalogSnapshot,
): QaEffectiveCapabilityPolicy {
  const tool = (values: readonly string[]) =>
    values.filter((id) => catalog.toolIds.has(id));
  const modelSkill = (values: readonly string[]) =>
    values.filter((id) => catalog.skillIds.has(id));
  const anySkill = (values: readonly string[]) =>
    values.filter((id) => catalog.userSkillIds.has(id));
  return freezePolicy({
    subroleId: stored.subroleId,
    tools: tool(stored.tools),
    grantableTools: tool(stored.grantableTools),
    skills: modelSkill(stored.skills),
    userSkills: anySkill(stored.userSkills),
    sources: {
      systemTools: tool(stored.sources.systemTools),
      commonTools: tool(stored.sources.commonTools),
      roleTools: tool(stored.sources.roleTools),
      commonGrantableTools: tool(stored.sources.commonGrantableTools),
      roleGrantableTools: tool(stored.sources.roleGrantableTools),
      systemSkills: modelSkill(stored.sources.systemSkills),
      commonSkills: modelSkill(stored.sources.commonSkills),
      roleSkills: modelSkill(stored.sources.roleSkills),
      declaredSkills: modelSkill(stored.sources.declaredSkills),
    },
    missingTools: [
      ...new Set([
        ...stored.missingTools,
        ...[...stored.tools, ...stored.grantableTools].filter(
          (id) => !catalog.toolIds.has(id),
        ),
      ]),
    ],
    missingSkills: [
      ...new Set([
        ...stored.missingSkills,
        ...stored.skills.filter((id) => !catalog.skillIds.has(id)),
      ]),
    ],
    policyRevision: stored.policyRevision,
  });
}

/** Server-only orchestration of roles, assignments, discovery and snapshots. */
export class QaAccessService {
  readonly roles: QaRoleRepository;
  readonly catalog: QaCapabilityCatalog;
  private lastOwnershipSweepAt = 0;
  /** The sweep in flight, so a burst of readers runs one listing, not ten. */
  private ownershipSweep: Promise<void> | undefined;
  /**
   * Sessions the Host has listed as delegated children of another session.
   * The live registry answers for a child that is running right now; this
   * cache answers for the ones that finished and were dismantled, which is the
   * state a browser meets when it opens an old subagent transcript.
   */
  private readonly delegatedSessions = new Set<string>();
  private lastDelegatedSweepAt = 0;
  private delegatedSweep: Promise<void> | undefined;

  constructor(
    private readonly ctx: Context,
    private readonly options: {
      readonly accounts: () => QaAccounts | undefined;
      readonly config: () => ResolvedQaSurfaceConfig;
      readonly logger: PluginLogger;
      readonly repository?: QaRoleRepository;
      readonly dynamicToolNames?: () => readonly string[];
      /**
       * The viewing scope an administrator's catalog is read with. Skills and
       * tools a deployment mounts through an agent preset live in that
       * preset's scope, so a global-only catalog left the operator unable to
       * see — or grant — what every QA chat actually mounts.
       */
      readonly presetScope?: () => Promise<ScopeKey | undefined>;
      /**
       * Durable session listing, used to tell a chat from a delegated child
       * across Host runs. Without it the lineage answer degrades to the live
       * registry, which knows nothing about a session this process has not
       * materialized — the sweep then reclaims nothing rather than guessing.
       */
      readonly sessionLog?: QaSessionLogReader;
      /**
       * Called with the ids of chats the Harness no longer knows, once their
       * ownership records are reclaimed. The record is the auth boundary, not
       * the whole of what the deployment kept about a chat: ratings, reviews
       * and queue entries are keyed by conversation, and they outlive their
       * chat unless the caller drops them here.
       */
      readonly onVanishedSessions?: (sessionIds: readonly string[]) => void;
    },
  ) {
    this.roles = options.repository ?? new QaRoleRepository();
    this.catalog = new QaCapabilityCatalog(
      ctx,
      options.dynamicToolNames ?? (() => []),
      () => this.roles.snapshot().subroles.map(({ id }) => id),
      options.presetScope ?? (() => Promise.resolve(undefined)),
    );
  }

  /**
   * Whether the Host can prove this session is a delegated child: a subagent's
   * session, which is an implementation detail of one answer and never a chat.
   * Used to refuse one wherever conversations are listed or claimed.
   */
  isDelegatedChild(sessionId: string): boolean {
    return (
      this.sessionFacts(sessionId).hasParent === true ||
      this.delegatedSessions.has(sessionId)
    );
  }

  /**
   * The Host-registered facts of one session, for the accounts store's
   * bounded auto-claim. Absent facts (the session registry is unavailable,
   * or this chat is not materialized here) keep the historical claim.
   */
  private sessionFacts(sessionId: string): QaSessionFacts {
    // Structural access: test and embedding contexts may compose no session
    // registry at all.
    const registry = (
      this.ctx as {
        sessions?: {
          get(id: SessionId):
            | {
                readonly header?: {
                  readonly createdAt?: number;
                  readonly parentSession?: unknown;
                };
              }
            | undefined;
        };
      }
    ).sessions;
    const header = registry?.get(SessionId(sessionId))?.header;
    if (header === undefined) return {};
    return {
      ...(header.createdAt === undefined
        ? {}
        : { createdAt: header.createdAt }),
      ...(header.parentSession === undefined ? {} : { hasParent: true }),
    };
  }

  /**
   * Reclaim ownership records of chats the Harness no longer knows.
   *
   * Nothing else removes them: the browser's "delete chat" hides a chat in one
   * browser, and a record outlives its session forever, so a year of QA traffic
   * accumulates one row per chat ever created. The sweep is throttled, runs
   * off the reservation path and off the review reads, and is skipped entirely
   * when the Harness cannot say what exists — an unanswerable question is
   * never a licence to delete an auth boundary.
   *
   * What exists is both halves of the Harness's own knowledge: the sessions
   * this process has open and the ones its storage still holds. The live store
   * alone would make a cold chat — one nobody has opened since the last
   * restart — look deleted, and the sweep would reclaim records of chats that
   * are merely quiet. A listing that cannot see stored sessions therefore
   * reclaims nothing.
   *
   * @returns the sweep, for callers that want to await it (tests, and the
   * review reads that must show the console what still exists).
   */
  sweepVanishedOwnership(): Promise<void> {
    this.ownershipSweep ??= this.runOwnershipSweep().finally(() => {
      this.ownershipSweep = undefined;
    });
    return this.ownershipSweep;
  }

  private async runOwnershipSweep(): Promise<void> {
    const accounts = this.options.accounts();
    const reader = this.options.sessionLog;
    if (accounts === undefined || reader === undefined) return;
    const retention = this.options.config().accounts.retention;
    if (!retention.pruneVanishedSessions) return;
    const interval = retention.sweepIntervalMinutes * 60_000;
    if (interval > 0 && Date.now() - this.lastOwnershipSweepAt < interval) {
      return;
    }
    this.lastOwnershipSweepAt = Date.now();
    try {
      const listing = await reader.list();
      if (!listing.complete) {
        // Live-only view of a deployment that keeps sessions on disk: an id
        // missing from it may be a chat nobody opened today.
        this.options.logger.debug("accounts.ownership-sweep-skipped", {
          reason: "incomplete-session-listing",
        });
        return;
      }
      const known = new Set(listing.headers.map((header) => header.id));
      const removed = accounts.pruneVanishedSessions(
        (sessionId) => known.has(sessionId),
        retention.ownershipGraceHours,
      );
      if (removed.length === 0) return;
      this.options.logger.info("accounts.ownership-pruned", {
        count: removed.length,
        sessionIds: removed.slice(0, 20),
      });
      // The record is one of several things the deployment kept about a chat;
      // the rest is the caller's to drop.
      this.options.onVanishedSessions?.(removed);
    } catch (error) {
      // Housekeeping must never fail the chat that triggered it.
      this.options.logger.error("accounts.ownership-prune-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Migrate a browser's local chat index into server-side ownership.
   *
   * A delegated session is not a chat: claiming one would write exactly the
   * ownership record the admission refuses to create and put a subagent's
   * transcript in the account's chat list. Its ids are left out of the batch
   * and reported, so a stale browser index cannot reintroduce the record.
   */
  claimSessions(token: string, sessionIds: readonly string[]): QaClaimResult {
    const accounts = this.requireAccounts("chat migration");
    this.maybeSweepDelegatedSessions();
    const refused = new Set(
      sessionIds.filter((sessionId) => this.isDelegatedChild(sessionId)),
    );
    const result = accounts.claimSessions(
      token,
      sessionIds.filter((sessionId) => !refused.has(sessionId)),
    );
    if (refused.size > 0) {
      this.options.logger.info("accounts.claim-refused-delegated", {
        count: refused.size,
        sessionIds: [...refused].slice(0, 20),
      });
    }
    return result;
  }

  /**
   * Reclaim ownership records that point at delegated sessions, and remember
   * which sessions are children while doing it.
   *
   * Records like this are residue of the paths that used to claim a session
   * without knowing its lineage: each one keeps a subagent's transcript in the
   * chat list of whoever opened it. Only positively identified children lose
   * their record, so a listing that cannot be read reclaims nothing, and every
   * other record stays the auth boundary it is.
   *
   * @returns the sweep, for callers that want to await it (tests).
   */
  reclaimDelegatedSessions(): Promise<void> {
    const accounts = this.options.accounts();
    const reader = this.options.sessionLog;
    if (accounts === undefined || reader === undefined)
      return Promise.resolve();
    return (async () => {
      try {
        const { headers } = await reader.list();
        const children = new Set(
          headers
            .filter((header) => header.parentSessionId !== undefined)
            .map((header) => header.id),
        );
        for (const sessionId of children) {
          this.delegatedSessions.add(sessionId);
        }
        const removed = accounts.pruneDelegatedOwnership(children);
        if (removed.length > 0) {
          this.options.logger.info("accounts.delegated-ownership-reclaimed", {
            count: removed.length,
            sessionIds: removed.slice(0, 20),
          });
        }
      } catch (error) {
        // Housekeeping must never fail the chat that triggered it.
        this.options.logger.error("accounts.delegated-ownership-sweep-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  /** Throttled, off the critical path, and never awaited by a request. */
  private maybeSweepDelegatedSessions(): void {
    if (this.options.accounts() === undefined) return;
    if (this.options.sessionLog === undefined) return;
    if (this.delegatedSweep !== undefined) return;
    const interval =
      this.options.config().accounts.retention.sweepIntervalMinutes * 60_000;
    if (interval > 0 && Date.now() - this.lastDelegatedSweepAt < interval) {
      return;
    }
    this.lastDelegatedSweepAt = Date.now();
    this.delegatedSweep = this.reclaimDelegatedSessions().finally(() => {
      this.delegatedSweep = undefined;
    });
  }

  current(token: string): QaCurrentAccess {
    const accounts = this.requireAccounts();
    const user = accounts.currentUser(token);
    const config = this.roles.snapshot();
    const access = normalizeUserAccess(accounts.accessOf(user.id), config);
    const allowed = new Set(access.allowedSubroles);
    return Object.freeze({
      subroles: Object.freeze(
        config.subroles.filter(({ id, enabled }) => enabled && allowed.has(id)),
      ),
      defaultSubrole: access.defaultSubrole,
    });
  }

  session(token: string, sessionId: string): QaSessionAccess {
    const accounts = this.requireAccounts();
    const owner = accounts.ensureSessionAccess(
      token,
      sessionId,
      this.sessionFacts(sessionId),
    );
    const record = accounts.sessionAccess(sessionId);
    const config = this.roles.snapshot();
    const access = normalizeUserAccess(accounts.accessOf(owner.id), config);
    const subroleId = record?.subroleId ?? access.defaultSubrole;
    if (record?.subroleId === undefined) {
      accounts.updateSessionAccess(sessionId, { subroleId });
    }
    const role =
      config.subroles.find(({ id }) => id === subroleId) ??
      ({
        id: subroleId,
        name: subroleId,
        description: "Снимок удалённой саброли",
        enabled: false,
        capabilities: {
          tools: { always: [], skillGrantable: [] },
          skills: [],
        },
      } satisfies QaSubrole);
    return Object.freeze({
      subrole: role,
      adminPreview: record?.adminPreview === true,
    });
  }

  reserveSession(
    token: string,
    sessionId: string,
    requestedSubrole: string | null,
    adminPreview: boolean,
  ) {
    const accounts = this.requireAccounts();
    return this.reserveForUser(
      accounts.currentUser(token),
      sessionId,
      requestedSubrole,
      adminPreview,
    );
  }

  /**
   * The same reservation for a chat opened by an already-authenticated
   * account — the integration API's path. The subrole is the account's own
   * default: an external caller is never offered a choice of capabilities,
   * and an administrator's preview flag stays a browser-only affordance.
   *
   * @param user - the account the chat belongs to.
   * @param sessionId - the Host-generated session id to reserve.
   * @returns the account, as the browser path returns it.
   */
  reserveSessionForUser(
    user: QaAccountUserPublic,
    sessionId: string,
  ): QaAccountUserPublic {
    this.requireAccounts();
    return this.reserveForUser(user, sessionId, null, false);
  }

  private reserveForUser(
    user: QaAccountUserPublic,
    sessionId: string,
    requestedSubrole: string | null,
    adminPreview: boolean,
  ) {
    const accounts = this.requireAccounts();
    const config = this.roles.snapshot();
    const assignment = normalizeUserAccess(accounts.accessOf(user.id), config);
    const selected = requestedSubrole ?? assignment.defaultSubrole;
    const role = config.subroles.find(
      ({ id, enabled }) => id === selected && enabled,
    );
    if (role === undefined) throw new TypeError("QA subrole is unavailable");
    if (adminPreview) {
      if (user.role !== "admin") {
        throw new QaAccountsError(
          "admin-required",
          "previewing a QA subrole requires an admin account",
        );
      }
    } else if (!assignment.allowedSubroles.includes(selected)) {
      throw new QaAccountsError(
        "invalid-role",
        "this QA subrole is not assigned to the account",
      );
    }
    const owner = accounts.reserveSessionForUser(user, sessionId, {
      subroleId: selected,
      ...(adminPreview ? { adminPreview: true } : {}),
    });
    // Creating a chat is the moment the ownership map grows, so it is also
    // the natural moment to reclaim what deleted chats and delegated
    // sessions left behind.
    void this.sweepVanishedOwnership();
    this.maybeSweepDelegatedSessions();
    return owner;
  }

  /**
   * The policy of one session, addressed by its authenticated account.
   *
   * Split from {@link policyForSession} so the integration API — whose caller
   * proved an account with a service token instead of a browser one — freezes
   * exactly the same capability snapshot. What the two entry points share is
   * everything after identity; the identity check itself is the only part that
   * differs, and it stays with whoever holds the credential.
   *
   * @param owner - the account that owns the session, or undefined when the
   *   deployment has no accounts service at all.
   * @param sessionId - the session being admitted.
   * @param agent - its live agent, for the tool catalog the policy resolves against.
   * @returns the policy, or undefined without an accounts service.
   */
  async policyForSessionOwner(
    owner: { readonly id: string } | undefined,
    sessionId: string,
    agent: Agent,
  ): Promise<QaResolvedSessionPolicy | undefined> {
    const accounts = this.options.accounts();
    if (accounts === undefined || owner === undefined) return undefined;
    let record = accounts.sessionAccess(sessionId);
    const config = this.roles.snapshot();
    const assignment = normalizeUserAccess(accounts.accessOf(owner.id), config);
    const subroleId = record?.subroleId ?? assignment.defaultSubrole;
    if (record?.subroleId === undefined) {
      record = accounts.updateSessionAccess(sessionId, { subroleId });
    }
    const catalog = await this.catalog.snapshot(agent);
    const policy =
      record?.capabilitySnapshot === undefined
        ? resolveCapabilityPolicy({
            config,
            subroleId,
            systemTools: this.systemRequiredTools(),
            systemSkills: [],
            available: {
              tools: catalog.toolIds,
              skills: catalog.skillIds,
              userSkills: catalog.userSkillIds,
            },
            skillMetadata: catalog.skillMetadata,
            revision: policyRevision(
              config,
              catalog.skillMetadata,
              catalog.toolIds,
            ),
          })
        : retainInstalledSnapshot(record.capabilitySnapshot, catalog);
    if (record?.capabilitySnapshot === undefined) {
      accounts.updateSessionAccess(sessionId, { capabilitySnapshot: policy });
      this.options.logger.info("access.policy-snapshotted", {
        sessionId,
        subroleId,
        tools: policy.tools,
        grantableTools: policy.grantableTools,
        skills: policy.skills,
        revision: policy.policyRevision,
      });
    }
    return {
      policy,
      skills: catalog.skills,
      skillMetadata: catalog.skillMetadata,
      adminPreview: record?.adminPreview === true,
      createGrants: () =>
        new Grants({
          agent,
          baseTools: policy.tools,
          grantableTools: policy.grantableTools,
          // The catalog's names ride on the agent itself, so no mask can carry
          // them. The execution guard still admits only names present in the
          // role's base set or in a successfully activated grant.
          agentLocalTools: new Set(this.options.dynamicToolNames?.() ?? []),
          descriptors: catalog.skillMetadata,
          logger: this.options.logger,
          record: (entry) => this.recordSkillActivation(sessionId, entry),
        }),
    };
  }

  /** The browser's entry point: the token resolves the owning account. */
  async policyForSession(
    token: string,
    sessionId: string,
    agent: Agent,
  ): Promise<QaResolvedSessionPolicy | undefined> {
    const accounts = this.options.accounts();
    if (accounts === undefined) return undefined;
    const owner = accounts.ensureSessionAccess(token, sessionId, {
      createdAt: agent.session.header.createdAt,
      ...(agent.session.header.parentSession === undefined
        ? {}
        : { hasParent: true }),
    });
    return this.policyForSessionOwner(owner, sessionId, agent);
  }

  /** Activation history of one session, for review and quality analysis. */
  skillActivations(
    token: string,
    sessionId: string,
  ): readonly QaSkillActivationRecord[] {
    const { accounts } = this.requireAdmin(token);
    return accounts.sessionAccess(sessionId)?.skillActivations ?? [];
  }

  /** Append one activation attempt; a lost record never fails the session. */
  private recordSkillActivation(
    sessionId: string,
    entry: QaSkillActivationRecord,
  ): void {
    const accounts = this.options.accounts();
    if (accounts === undefined) return;
    try {
      accounts.recordSkillActivation(sessionId, entry, MAX_SKILL_ACTIVATIONS);
    } catch (error) {
      this.options.logger.warn("access.skill-activation-record-failed", {
        sessionId,
        skill: entry.skillName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async adminSnapshot(token: string): Promise<QaAccessAdminSnapshot> {
    const { accounts } = this.requireAdmin(token);
    const config = this.roles.snapshot();
    const catalog = await this.catalog.snapshot();
    const configured = configuredCapabilities(config);
    const systemRequired: QaCapabilitySelection = Object.freeze({
      tools: Object.freeze({
        always: Object.freeze(this.systemRequiredTools()),
        skillGrantable: Object.freeze([]) as readonly string[],
      }),
      skills: Object.freeze([]) as readonly string[],
    });
    const rows = withMissingCapabilities(
      catalog.descriptors,
      [...systemRequired.tools.always, ...configured.tools],
      [...systemRequired.skills, ...configured.skills],
    );
    const skills: readonly QaSkillAccess[] = resolveSkillAccess({
      config,
      descriptors: catalog.skillMetadata,
      rows: rows.filter(({ type }) => type === "skill"),
      installedTools: catalog.toolIds,
    });
    return Object.freeze({
      config,
      systemRequired,
      catalog: rows,
      skills,
      users: accounts.listAccessUsers((value) =>
        normalizeUserAccess(value, config),
      ),
      audit: this.roles.audit(),
    });
  }

  /** Replace or clear one skill's administrator overlay. */
  updateSkillOverride(
    token: string,
    input: QaSkillAssignmentOverride,
  ): readonly QaSkillAssignmentOverride[] {
    const { actor } = this.requireAdmin(token);
    return this.roles.updateSkillOverride(actor.id, input);
  }

  createSubrole(token: string, input: QaSubrole): QaSubrole {
    const { actor } = this.requireAdmin(token);
    return this.roles.create(actor.id, input);
  }

  updateSubrole(token: string, id: string, input: QaSubrole): QaSubrole {
    const { actor } = this.requireAdmin(token);
    return this.roles.update(actor.id, id, input);
  }

  deleteSubrole(token: string, id: string, replacementId: string | null): void {
    const { actor, accounts } = this.requireAdmin(token);
    const before = this.roles.snapshot();
    const assigned = accounts
      .listAccessUsers((value) => normalizeUserAccess(value, before))
      .filter(({ access }) => access.allowedSubroles.includes(id));
    if (assigned.length > 0) {
      const replacement = before.subroles.find(
        ({ id: candidate, enabled }) =>
          candidate === replacementId && candidate !== id && enabled,
      );
      if (replacement === undefined) {
        throw new TypeError(
          "deleting an assigned subrole requires an enabled replacement",
        );
      }
    }
    this.roles.delete(actor.id, id);
    const after = this.roles.snapshot();
    for (const user of assigned) {
      const allowed = user.access.allowedSubroles.filter(
        (value) => value !== id,
      );
      if (replacementId !== null && !allowed.includes(replacementId)) {
        allowed.push(replacementId);
      }
      const next = requireExactAssignment(
        {
          allowedSubroles: allowed,
          defaultSubrole:
            user.access.defaultSubrole === id
              ? (replacementId as string)
              : user.access.defaultSubrole,
        },
        after,
      );
      accounts.setAccess(user.id, next);
      this.roles.recordAssignment(actor.id, user.id, user.access, next);
    }
  }

  updateCommon(
    token: string,
    input: QaCapabilitySelection,
  ): QaCapabilitySelection {
    const { actor } = this.requireAdmin(token);
    return this.roles.updateCommon(actor.id, input);
  }

  updateAssignment(
    token: string,
    userId: string,
    input: QaUserAccess,
  ): QaUserAccess {
    const { actor, accounts } = this.requireAdmin(token);
    const access = requireExactAssignment(input, this.roles.snapshot());
    const before = accounts.accessOf(userId);
    accounts.setAccess(userId, access);
    this.roles.recordAssignment(actor.id, userId, before, access);
    return access;
  }

  /** The accounts store, or the refusal this operation names. */
  private requireAccounts(operation = "subrole management"): QaAccounts {
    const accounts = this.options.accounts();
    if (accounts === undefined) {
      throw new Error(`QA accounts are required for ${operation}`);
    }
    return accounts;
  }

  /**
   * Tools every session resolves regardless of the role it runs under: the
   * deployment's pinned allow-list plus the activation diagnostic.
   *
   * Readable outside the service because the administration surface reports a
   * profile's effective capabilities next to the configured ones, and the
   * pinned set is part of that answer whatever the profile says.
   */
  systemRequiredTools(): readonly string[] {
    return [
      ...new Set([
        ...this.options.config().lockdown.toolPolicy.allow,
        ...(this.options.dynamicToolNames?.() ?? []).filter(
          (name) => name === "qa_tools_selfcheck",
        ),
      ]),
    ];
  }

  private requireAdmin(token: string): {
    readonly accounts: QaAccounts;
    readonly actor: ReturnType<QaAccounts["currentUser"]>;
  } {
    const accounts = this.requireAccounts();
    const actor = accounts.currentUser(token);
    if (actor.role !== "admin") {
      throw new QaAccountsError(
        "admin-required",
        "QA access administration requires an admin account",
      );
    }
    return { accounts, actor };
  }
}

export function validateCapabilityConfig(
  config: QaCapabilityConfig,
): QaCapabilityConfig {
  return normalizeCapabilityConfig(config);
}

export type { QaCapabilityDescriptor };
