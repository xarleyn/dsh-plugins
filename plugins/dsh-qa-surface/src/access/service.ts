import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import { QaAccountsError } from "../accounts/store.js";
import type { QaAccounts } from "../accounts/store.js";
import type {
  QaAccessAdminSnapshot,
  QaCapabilityConfig,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaCurrentAccess,
  QaEffectiveCapabilityPolicy,
  QaSessionAccess,
  QaSubrole,
  QaUserAccess,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import {
  enabledSubroles,
  normalizeCapabilityConfig,
  normalizeUserAccess,
  resolveCapabilityPolicy,
} from "./model.js";
import {
  QaCapabilityCatalog,
  withMissingCapabilities,
  type CapabilityCatalogSnapshot,
} from "./capability-catalog.js";
import { QaRoleRepository } from "./role-repository.js";

export interface QaResolvedSessionPolicy {
  readonly policy: QaEffectiveCapabilityPolicy;
  readonly skills: CapabilityCatalogSnapshot["skills"];
}

function configuredCapabilities(config: QaCapabilityConfig): {
  readonly tools: readonly string[];
  readonly skills: readonly string[];
} {
  return {
    tools: [
      ...new Set([
        ...config.common.tools,
        ...config.subroles.flatMap(({ capabilities }) => capabilities.tools),
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
    skills: Object.freeze([...policy.skills]),
    sources: Object.freeze({
      systemTools: Object.freeze([...policy.sources.systemTools]),
      commonTools: Object.freeze([...policy.sources.commonTools]),
      roleTools: Object.freeze([...policy.sources.roleTools]),
      systemSkills: Object.freeze([...policy.sources.systemSkills]),
      commonSkills: Object.freeze([...policy.sources.commonSkills]),
      roleSkills: Object.freeze([...policy.sources.roleSkills]),
    }),
    missingTools: Object.freeze([...policy.missingTools]),
    missingSkills: Object.freeze([...policy.missingSkills]),
  });
}

function retainInstalledSnapshot(
  stored: QaEffectiveCapabilityPolicy,
  catalog: CapabilityCatalogSnapshot,
): QaEffectiveCapabilityPolicy {
  const tool = (values: readonly string[]) =>
    values.filter((id) => catalog.toolIds.has(id));
  const skill = (values: readonly string[]) =>
    values.filter((id) => catalog.skillIds.has(id));
  return freezePolicy({
    subroleId: stored.subroleId,
    tools: tool(stored.tools),
    skills: skill(stored.skills),
    sources: {
      systemTools: tool(stored.sources.systemTools),
      commonTools: tool(stored.sources.commonTools),
      roleTools: tool(stored.sources.roleTools),
      systemSkills: skill(stored.sources.systemSkills),
      commonSkills: skill(stored.sources.commonSkills),
      roleSkills: skill(stored.sources.roleSkills),
    },
    missingTools: [
      ...new Set([
        ...stored.missingTools,
        ...stored.tools.filter((id) => !catalog.toolIds.has(id)),
      ]),
    ],
    missingSkills: [
      ...new Set([
        ...stored.missingSkills,
        ...stored.skills.filter((id) => !catalog.skillIds.has(id)),
      ]),
    ],
  });
}

/** Server-only orchestration of roles, assignments, discovery and snapshots. */
export class QaAccessService {
  readonly roles: QaRoleRepository;
  readonly catalog: QaCapabilityCatalog;

  constructor(
    ctx: Context,
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
    );
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
    const owner = accounts.ensureSessionAccess(token, sessionId);
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
        capabilities: { tools: [], skills: [] },
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
    const owner = accounts.ensureSessionAccess(token, sessionId);
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
            },
          })
        : retainInstalledSnapshot(record.capabilitySnapshot, catalog);
    if (record?.capabilitySnapshot === undefined) {
      accounts.updateSessionAccess(sessionId, { capabilitySnapshot: policy });
      this.options.logger.info("access.policy-snapshotted", {
        sessionId,
        subroleId,
        tools: policy.tools,
        skills: policy.skills,
      });
    }
    return { policy, skills: catalog.skills };
  }

  async adminSnapshot(token: string): Promise<QaAccessAdminSnapshot> {
    const { accounts } = this.requireAdmin(token);
    const config = this.roles.snapshot();
    const catalog = await this.catalog.snapshot();
    const configured = configuredCapabilities(config);
    const systemRequired: QaCapabilitySelection = Object.freeze({
      tools: Object.freeze(this.systemRequiredTools()),
      skills: Object.freeze([]),
    });
    return Object.freeze({
      config,
      systemRequired,
      catalog: withMissingCapabilities(
        catalog.descriptors,
        [...systemRequired.tools, ...configured.tools],
        [...systemRequired.skills, ...configured.skills],
      ),
      users: accounts.listAccessUsers((value) =>
        normalizeUserAccess(value, config),
      ),
      audit: this.roles.audit(),
    });
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

  /** The activation diagnostic is runtime plumbing, not an administrator grant. */
  private systemRequiredTools(): readonly string[] {
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
