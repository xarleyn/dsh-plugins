import { createHash } from "node:crypto";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
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
  QaCapabilityConfig,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
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

  constructor(
    private readonly ctx: Context,
    private readonly options: {
      readonly accounts: () => QaAccounts | undefined;
      readonly config: () => ResolvedQaSurfaceConfig;
      readonly logger: PluginLogger;
      readonly repository?: QaRoleRepository;
      readonly dynamicToolNames?: () => readonly string[];
    },
  ) {
    this.roles = options.repository ?? new QaRoleRepository();
    this.catalog = new QaCapabilityCatalog(
      ctx,
      options.dynamicToolNames ?? (() => []),
      () => this.roles.snapshot().subroles.map(({ id }) => id),
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
    const user = accounts.currentUser(token);
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
    return accounts.reserveSession(token, sessionId, {
      subroleId: selected,
      ...(adminPreview ? { adminPreview: true } : {}),
    });
  }

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
          // them; the guard admits them for as long as the policy holds.
          agentLocalTools: new Set(this.options.dynamicToolNames?.() ?? []),
          descriptors: catalog.skillMetadata,
          logger: this.options.logger,
          record: (entry) => this.recordSkillActivation(sessionId, entry),
        }),
    };
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

  private requireAccounts(): QaAccounts {
    const accounts = this.options.accounts();
    if (accounts === undefined) {
      throw new Error("QA accounts are required for subrole management");
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
