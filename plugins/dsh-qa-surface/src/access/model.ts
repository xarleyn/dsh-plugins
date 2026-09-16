import type {
  QaCapabilityConfig,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaEffectiveCapabilityPolicy,
  QaSkillAccess,
  QaSkillAssignmentOverride,
  QaSkillDescriptor,
  QaSkillRoleGrant,
  QaSubrole,
  QaToolSelection,
  QaUserAccess,
} from "../types.js";
import {
  normalizeSkillOverride,
  resolveSkillVisibility,
  skillHealth,
} from "./skill-metadata.js";

const CAPABILITY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u;
const SUBROLE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function uniqueIds(
  values: readonly string[],
  label: string,
): readonly string[] {
  const result = [
    ...new Set(
      values.map((value) => {
        if (typeof value !== "string") {
          throw new TypeError(`${label} must contain strings`);
        }
        return value.trim();
      }),
    ),
  ].filter(Boolean);
  if (result.some((value) => !CAPABILITY_ID.test(value))) {
    throw new TypeError(`${label} contains an invalid capability id`);
  }
  return Object.freeze(result);
}

/**
 * Normalize one Tool selection, accepting the pre-split flat list.
 *
 * A flat list predates skill grants and can only mean "always visible": the
 * legacy reading is the narrower one, so an upgraded deployment never hands
 * out a tool it did not hand out before.
 * @param value - split selection, legacy string list, or nothing.
 * @param label - prefix for validation errors.
 */
export function normalizeToolSelection(
  value: QaToolSelection | readonly string[] | undefined,
  label = "tools",
): QaToolSelection {
  if (Array.isArray(value)) {
    return Object.freeze({
      always: uniqueIds(value, label),
      skillGrantable: Object.freeze([]) as readonly string[],
      deny: Object.freeze([]) as readonly string[],
    });
  }
  const selection = value as QaToolSelection | undefined;
  return Object.freeze({
    always: uniqueIds(selection?.always ?? [], `${label}.always`),
    skillGrantable: uniqueIds(
      selection?.skillGrantable ?? [],
      `${label}.skillGrantable`,
    ),
    deny: uniqueIds(selection?.deny ?? [], `${label}.deny`),
  });
}

export function normalizeCapabilitySelection(
  value: Partial<QaCapabilitySelection> | undefined,
): QaCapabilitySelection {
  return Object.freeze({
    tools: normalizeToolSelection(value?.tools),
    skills: uniqueIds(value?.skills ?? [], "skills"),
    ...(value?.mcpServers === undefined
      ? {}
      : { mcpServers: uniqueIds(value.mcpServers, "mcpServers") }),
    ...(value?.knowledgeSources === undefined
      ? {}
      : {
          knowledgeSources: uniqueIds(
            value.knowledgeSources,
            "knowledgeSources",
          ),
        }),
    ...(value?.promptAdditions === undefined
      ? {}
      : {
          promptAdditions: Object.freeze(
            value.promptAdditions
              .map((entry) => entry.trim())
              .filter(Boolean)
              .slice(0, 32),
          ),
        }),
  });
}

export function normalizeSubrole(value: QaSubrole): QaSubrole {
  const id = value.id.trim().toLowerCase();
  const name = value.name.trim();
  const description = value.description?.trim();
  if (!SUBROLE_ID.test(id)) {
    throw new TypeError(
      "subrole id must use lowercase letters, digits and hyphens",
    );
  }
  if (name === "" || name.length > 100) {
    throw new TypeError("subrole name must contain 1-100 characters");
  }
  if ((description?.length ?? 0) > 500) {
    throw new TypeError("subrole description must be at most 500 characters");
  }
  const icon = value.ui?.icon?.trim();
  const accent = value.ui?.accent?.trim();
  return Object.freeze({
    id,
    name,
    ...(description === undefined || description === "" ? {} : { description }),
    enabled: value.enabled === true,
    capabilities: normalizeCapabilitySelection(value.capabilities),
    ...(icon === undefined && accent === undefined
      ? {}
      : {
          ui: Object.freeze({
            ...(icon === undefined || icon === "" ? {} : { icon }),
            ...(accent === undefined || accent === "" ? {} : { accent }),
          }),
        }),
  });
}

export function normalizeSkillOverrides(
  value: readonly QaSkillAssignmentOverride[] | undefined,
): readonly QaSkillAssignmentOverride[] {
  const overrides = (value ?? []).map(normalizeSkillOverride);
  if (
    new Set(overrides.map(({ skillName }) => skillName)).size !==
    overrides.length
  ) {
    throw new TypeError("a skill may have only one assignment override");
  }
  return Object.freeze(overrides);
}

export function normalizeCapabilityConfig(
  value: QaCapabilityConfig,
): QaCapabilityConfig {
  if (value.version !== 1 || !Array.isArray(value.subroles)) {
    throw new TypeError("capability configuration version 1 is required");
  }
  const subroles = value.subroles.map(normalizeSubrole);
  if (subroles.length === 0) {
    throw new TypeError("at least one QA subrole is required");
  }
  if (new Set(subroles.map(({ id }) => id)).size !== subroles.length) {
    throw new TypeError("subrole ids must be unique");
  }
  if (!subroles.some(({ enabled }) => enabled)) {
    throw new TypeError("at least one QA subrole must be enabled");
  }
  return Object.freeze({
    version: 1,
    common: normalizeCapabilitySelection(value.common),
    subroles: Object.freeze(subroles),
    skillOverrides: normalizeSkillOverrides(value.skillOverrides),
  });
}

export function defaultCapabilityConfig(): QaCapabilityConfig {
  return normalizeCapabilityConfig({
    version: 1,
    common: { tools: { always: [], skillGrantable: [] }, skills: [] },
    subroles: [
      {
        id: "general",
        name: "Общий",
        description: "Базовый профиль QA-ассистента",
        enabled: true,
        capabilities: {
          tools: { always: [], skillGrantable: [] },
          skills: [],
        },
      },
    ],
    skillOverrides: [],
  });
}

export function enabledSubroles(
  config: QaCapabilityConfig,
): readonly QaSubrole[] {
  return config.subroles.filter(({ enabled }) => enabled);
}

export function enabledSubroleIds(
  config: QaCapabilityConfig,
): readonly string[] {
  return enabledSubroles(config).map(({ id }) => id);
}

/** The Common and subrole Tool selections that apply to one subrole. */
export function roleToolSelection(
  config: QaCapabilityConfig,
  subroleId: string,
): QaToolSelection {
  const role = config.subroles.find(
    (candidate) => candidate.id === subroleId && candidate.enabled,
  );
  if (role === undefined) throw new TypeError("QA subrole is unavailable");
  // A denial from either layer wins over every grant, including the pinned
  // system tools: that is the only way an administrator can withdraw a name
  // the deployment hands out to every profile. It narrows the grant ceiling
  // too, so a skill cannot hand back what the role takes away.
  const denied = new Set([
    ...(config.common.tools.deny ?? []),
    ...(role.capabilities.tools.deny ?? []),
  ]);
  const granted = (values: readonly string[]): readonly string[] =>
    uniqueIds(values, "tools").filter((name) => !denied.has(name));
  return Object.freeze({
    always: granted([
      ...config.common.tools.always,
      ...role.capabilities.tools.always,
    ]),
    skillGrantable: granted([
      ...config.common.tools.skillGrantable,
      ...role.capabilities.tools.skillGrantable,
    ]),
    deny: Object.freeze([...denied]),
  });
}

/** The ceiling that bounds what one activated skill may add to the toolset. */
export function roleGrantCeiling(
  config: QaCapabilityConfig,
  subroleId: string,
): readonly string[] {
  return roleToolSelection(config, subroleId).skillGrantable;
}

/** Missing assignments migrate to the first enabled role, never to all roles. */
export function normalizeUserAccess(
  value: Partial<QaUserAccess> | undefined,
  config: QaCapabilityConfig,
): QaUserAccess {
  const enabled = enabledSubroles(config);
  const enabledIds = new Set(enabled.map(({ id }) => id));
  const fallback = enabled[0]?.id;
  if (fallback === undefined) throw new TypeError("no enabled QA subrole");
  const allowed = [
    ...new Set(
      (value?.allowedSubroles ?? []).filter((id) => enabledIds.has(id)),
    ),
  ];
  if (allowed.length === 0) allowed.push(fallback);
  const requestedDefault = value?.defaultSubrole;
  const defaultSubrole =
    requestedDefault !== undefined && allowed.includes(requestedDefault)
      ? requestedDefault
      : (allowed[0] as string);
  return Object.freeze({
    allowedSubroles: Object.freeze(allowed),
    defaultSubrole,
  });
}

export interface CapabilityAvailability {
  readonly tools: ReadonlySet<string>;
  /** Installed skills a model-facing catalog may list. */
  readonly skills: ReadonlySet<string>;
  /** Installed skills a person may invoke; defaults to the model-facing set. */
  readonly userSkills?: ReadonlySet<string>;
}

export interface ResolveCapabilityPolicyInput {
  readonly config: QaCapabilityConfig;
  readonly subroleId: string;
  readonly systemTools: readonly string[];
  readonly systemSkills: readonly string[];
  readonly available: CapabilityAvailability;
  /** Normalized `metadata.qa-surface` of every discovered skill. */
  readonly skillMetadata?: ReadonlyMap<string, QaSkillDescriptor>;
  /** Revision recorded with the session snapshot; opaque to enforcement. */
  readonly revision?: string;
}

function available(
  values: readonly string[],
  installed: ReadonlySet<string>,
): readonly string[] {
  return Object.freeze(values.filter((value) => installed.has(value)));
}

function missing(
  values: readonly string[],
  installed: ReadonlySet<string>,
): readonly string[] {
  return Object.freeze(values.filter((value) => !installed.has(value)));
}

/**
 * Skills one subrole may see, and the reason each one is there.
 *
 * Declared skills come from their own SKILL.md audience, managed skills from
 * the administrator's Common and role lists. Both are still subject to the
 * administrator overlay, and an explicit withdrawal beats either source.
 */
function resolveVisibleSkills(
  config: QaCapabilityConfig,
  role: QaSubrole,
  systemSkills: readonly string[],
  metadata: ReadonlyMap<string, QaSkillDescriptor>,
): {
  readonly visible: readonly string[];
  readonly declared: readonly string[];
} {
  const overrides = new Map(
    config.skillOverrides.map((override) => [override.skillName, override]),
  );
  const enabled = enabledSubroleIds(config);
  const declared: string[] = [];
  const withdrawn = new Set<string>();
  for (const [name, descriptor] of metadata) {
    const visibility = resolveSkillVisibility(
      descriptor,
      overrides.get(name),
      enabled,
    );
    if (visibility.visibleTo.includes(role.id)) declared.push(name);
    if (visibility.disabled || visibility.removedByAdmin.includes(role.id)) {
      withdrawn.add(name);
    }
  }
  const managed = [
    ...systemSkills,
    ...config.common.skills,
    ...role.capabilities.skills,
  ];
  return {
    visible: [
      ...new Set(
        [...managed, ...declared].filter((name) => !withdrawn.has(name)),
      ),
    ],
    declared,
  };
}

export function resolveCapabilityPolicy({
  config,
  subroleId,
  systemTools,
  systemSkills,
  available: installed,
  skillMetadata,
  revision,
}: ResolveCapabilityPolicyInput): QaEffectiveCapabilityPolicy {
  const role = config.subroles.find(
    (candidate) => candidate.id === subroleId && candidate.enabled,
  );
  if (role === undefined) throw new TypeError("QA subrole is unavailable");

  const systemToolIds = uniqueIds(systemTools, "system tools");
  const systemSkillIds = uniqueIds(systemSkills, "system skills");
  const selection = roleToolSelection(config, role.id);
  // The denial reaches the system tools too: the deployment pins them for every
  // profile, and withdrawing one is the only reason this list exists.
  const denied = new Set(selection.deny ?? []);
  const configuredBase = [
    ...new Set([...systemToolIds, ...selection.always]),
  ].filter((name) => !denied.has(name));
  const configuredGrantable = selection.skillGrantable;
  const { visible: configuredSkills, declared: declaredSkills } =
    resolveVisibleSkills(
      config,
      role,
      systemSkillIds,
      skillMetadata ?? new Map<string, QaSkillDescriptor>(),
    );

  const baseTools = [...available(configuredBase, installed.tools)];
  const grantableTools = available(
    configuredGrantable.filter((name) => !baseTools.includes(name)),
    installed.tools,
  );
  const skills = available(configuredSkills, installed.skills);
  const userSkills = available(
    configuredSkills,
    installed.userSkills ?? installed.skills,
  );

  // The filtered skill loader is transport for the selected skill set. It is
  // made visible only when at least one model-invocable skill survived.
  if (
    skills.length > 0 &&
    installed.tools.has("skill") &&
    !baseTools.includes("skill")
  ) {
    baseTools.push("skill");
  }

  return Object.freeze({
    subroleId: role.id,
    tools: Object.freeze([...new Set(baseTools)]),
    grantableTools,
    skills,
    userSkills,
    sources: Object.freeze({
      systemTools: available(systemToolIds, installed.tools),
      commonTools: available(config.common.tools.always, installed.tools),
      roleTools: available(role.capabilities.tools.always, installed.tools),
      commonGrantableTools: available(
        config.common.tools.skillGrantable,
        installed.tools,
      ),
      roleGrantableTools: available(
        role.capabilities.tools.skillGrantable,
        installed.tools,
      ),
      systemSkills: available(systemSkillIds, installed.skills),
      commonSkills: available(config.common.skills, installed.skills),
      roleSkills: available(role.capabilities.skills, installed.skills),
      declaredSkills: available(declaredSkills, installed.skills),
    }),
    missingTools: missing(
      [...new Set([...configuredBase, ...configuredGrantable])],
      installed.tools,
    ),
    missingSkills: missing(
      configuredSkills,
      installed.userSkills ?? installed.skills,
    ),
    policyRevision: revision ?? "",
  });
}

export interface ResolveSkillAccessInput {
  readonly config: QaCapabilityConfig;
  /** Every discovered skill with its normalized metadata. */
  readonly descriptors: ReadonlyMap<string, QaSkillDescriptor>;
  /** Catalog rows for skills, used for description, source and presence. */
  readonly rows: readonly QaCapabilityDescriptor[];
  readonly installedTools: ReadonlySet<string>;
}

function roleGrants(
  input: ResolveSkillAccessInput,
  name: string,
  descriptor: QaSkillDescriptor,
  visibleTo: readonly string[],
): readonly QaSkillRoleGrant[] {
  const overrides = new Map(
    input.config.skillOverrides.map((override) => [
      override.skillName,
      override,
    ]),
  );
  const enabled = enabledSubroleIds(input.config);
  return enabled.map((roleId) => {
    const visibility = resolveSkillVisibility(
      descriptor,
      overrides.get(name),
      enabled,
    );
    const ceiling = new Set(roleGrantCeiling(input.config, roleId));
    const grantable = descriptor.requiredTools.filter(
      (tool) => ceiling.has(tool) && input.installedTools.has(tool),
    );
    const unavailable = descriptor.requiredTools.filter(
      (tool) => !grantable.includes(tool),
    );
    return Object.freeze({
      roleId,
      visible: visibleTo.includes(roleId),
      declared: visibility.declaredTo.includes(roleId),
      addedByAdmin: visibility.addedByAdmin.includes(roleId),
      removedByAdmin: visibility.removedByAdmin.includes(roleId),
      disabled: visibility.disabled,
      grantableTools: Object.freeze(grantable),
      unavailableTools: Object.freeze(unavailable),
    });
  });
}

/**
 * Project every skill for the administration surface.
 *
 * The declared audience is reported next to the effective one, so an
 * administrator can see which roles a skill asked for and which it got.
 * @param input - configuration, resolved metadata and the installed catalog.
 */
export function resolveSkillAccess(
  input: ResolveSkillAccessInput,
): readonly QaSkillAccess[] {
  const rowByName = new Map(input.rows.map((row) => [row.id, row]));
  const enabled = enabledSubroleIds(input.config);
  const overrides = new Map(
    input.config.skillOverrides.map((override) => [
      override.skillName,
      override,
    ]),
  );
  const names = [
    ...new Set([...input.descriptors.keys(), ...rowByName.keys()]),
  ].sort((left, right) => left.localeCompare(right));
  const access = names.map((name) => {
    const descriptor = input.descriptors.get(name);
    const row = rowByName.get(name);
    const overridesEntry = overrides.get(name);
    if (descriptor === undefined) {
      // Retained selection: the skill is configured but no longer discovered.
      const empty: QaSkillDescriptor = Object.freeze({
        name,
        audience: Object.freeze({ type: "unassigned" as const }),
        requiredTools: Object.freeze([]) as readonly string[],
        requireAll: false,
        lifecycle: "session" as const,
        schemaVersion: 0,
        declared: false,
        warnings: Object.freeze([]) as readonly string[],
      });
      return Object.freeze({
        name,
        ...(row?.description === undefined
          ? {}
          : { description: row.description }),
        source: row?.source ?? { kind: "plugin" as const },
        status: "missing" as const,
        descriptor: empty,
        visibleTo: Object.freeze([]) as readonly string[],
        disabled: overridesEntry?.disabled === true,
        forceCommon: overridesEntry?.forceCommon === true,
        overridden: overridesEntry !== undefined,
        health: "unassigned" as const,
        tools: Object.freeze([]) as QaSkillAccess["tools"],
        roles: Object.freeze([]) as readonly QaSkillRoleGrant[],
      });
    }
    const visibility = resolveSkillVisibility(
      descriptor,
      overridesEntry,
      enabled,
    );
    const grants = roleGrants(input, name, descriptor, visibility.visibleTo);
    const toolIds = [...new Set(descriptor.requiredTools)];
    const tools = toolIds.map((id) => {
      const installed = input.installedTools.has(id);
      const grantableBy = grants
        .filter(
          ({ visible, grantableTools }) =>
            visible && grantableTools.includes(id),
        )
        .map(({ roleId }) => roleId);
      const blockedFor = grants
        .filter(
          ({ visible, grantableTools }) =>
            visible && !grantableTools.includes(id),
        )
        .map(({ roleId }) => roleId);
      return Object.freeze({
        id,
        installed,
        grantableBy: Object.freeze(grantableBy),
        blockedFor: Object.freeze(blockedFor),
      });
    });
    return Object.freeze({
      name,
      ...(row?.description === undefined
        ? {}
        : { description: row.description }),
      source: row?.source ?? { kind: "runtime" as const },
      status: row?.status ?? ("available" as const),
      descriptor,
      visibleTo: visibility.visibleTo,
      disabled: visibility.disabled,
      forceCommon: overridesEntry?.forceCommon === true,
      overridden: visibility.overridden,
      health: skillHealth(
        descriptor,
        tools.filter(({ grantableBy }) => grantableBy.length > 0).length,
        tools.filter(({ grantableBy }) => grantableBy.length === 0).length,
        visibility.visibleTo,
      ),
      tools: Object.freeze(tools),
      roles: grants,
    });
  });
  // Skills that already have an audience come first; the rest is alphabetical.
  return Object.freeze(
    access.sort(
      (left, right) =>
        Number(left.health === "unassigned") -
          Number(right.health === "unassigned") ||
        left.name.localeCompare(right.name),
    ),
  );
}
