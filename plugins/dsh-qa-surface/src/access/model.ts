import type {
  QaCapabilityConfig,
  QaCapabilitySelection,
  QaEffectiveCapabilityPolicy,
  QaSubrole,
  QaUserAccess,
} from "../types.js";

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

export function normalizeCapabilitySelection(
  value: Partial<QaCapabilitySelection> | undefined,
): QaCapabilitySelection {
  return Object.freeze({
    tools: uniqueIds(value?.tools ?? [], "tools"),
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
  });
}

export function defaultCapabilityConfig(): QaCapabilityConfig {
  return normalizeCapabilityConfig({
    version: 1,
    common: { tools: [], skills: [] },
    subroles: [
      {
        id: "general",
        name: "Общий",
        description: "Базовый профиль QA-ассистента",
        enabled: true,
        capabilities: { tools: [], skills: [] },
      },
    ],
  });
}

export function enabledSubroles(
  config: QaCapabilityConfig,
): readonly QaSubrole[] {
  return config.subroles.filter(({ enabled }) => enabled);
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
  readonly skills: ReadonlySet<string>;
}

export interface ResolveCapabilityPolicyInput {
  readonly config: QaCapabilityConfig;
  readonly subroleId: string;
  readonly systemTools: readonly string[];
  readonly systemSkills: readonly string[];
  readonly available: CapabilityAvailability;
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

export function resolveCapabilityPolicy({
  config,
  subroleId,
  systemTools,
  systemSkills,
  available: installed,
}: ResolveCapabilityPolicyInput): QaEffectiveCapabilityPolicy {
  const role = config.subroles.find(
    (candidate) => candidate.id === subroleId && candidate.enabled,
  );
  if (role === undefined) throw new TypeError("QA subrole is unavailable");

  const systemToolIds = uniqueIds(systemTools, "system tools");
  const systemSkillIds = uniqueIds(systemSkills, "system skills");
  const configuredTools = [
    ...new Set([
      ...systemToolIds,
      ...config.common.tools,
      ...role.capabilities.tools,
    ]),
  ];
  const configuredSkills = [
    ...new Set([
      ...systemSkillIds,
      ...config.common.skills,
      ...role.capabilities.skills,
    ]),
  ];
  const skills = available(configuredSkills, installed.skills);
  const tools = [...available(configuredTools, installed.tools)];

  // The filtered skill loader is transport for the selected skill set. It is
  // made visible only when at least one model-invocable skill survived.
  if (
    skills.length > 0 &&
    installed.tools.has("skill") &&
    !tools.includes("skill")
  ) {
    tools.push("skill");
  }

  return Object.freeze({
    subroleId: role.id,
    tools: Object.freeze([...new Set(tools)]),
    skills,
    sources: Object.freeze({
      systemTools: available(systemToolIds, installed.tools),
      commonTools: available(config.common.tools, installed.tools),
      roleTools: available(role.capabilities.tools, installed.tools),
      systemSkills: available(systemSkillIds, installed.skills),
      commonSkills: available(config.common.skills, installed.skills),
      roleSkills: available(role.capabilities.skills, installed.skills),
    }),
    missingTools: missing(configuredTools, installed.tools),
    missingSkills: missing(configuredSkills, installed.skills),
  });
}
