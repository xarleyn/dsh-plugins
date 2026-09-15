import type {
  QaSkillAssignmentOverride,
  QaSkillAudience,
  QaSkillDescriptor,
  QaSkillHealth,
} from "../types.js";

/**
 * DSH skill frontmatter carries unknown keys in `metadata`. Everything this
 * plugin understands lives under this one key, so a skill file stays a plain
 * valid Agent Skill outside a QA deployment and no upstream schema is forked.
 */
const QA_METADATA_KEY = "qa-surface";

/** Metadata schema this build reads. Unknown versions stay unassigned. */
const SUPPORTED_SCHEMA_VERSION = 1;

const CAPABILITY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u;
const SUBROLE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, label: string, warnings: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${label} must be a list of capability ids`);
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !CAPABILITY_ID.test(entry.trim())) {
      warnings.push(
        `${label} contains an invalid id: ${JSON.stringify(entry)}`,
      );
      continue;
    }
    result.push(entry.trim());
  }
  return [...new Set(result)];
}

/** The fail-closed descriptor of a skill that declares nothing. */
export function unassignedSkill(name: string): QaSkillDescriptor {
  return Object.freeze({
    name,
    audience: Object.freeze({ type: "unassigned" as const }),
    requiredTools: Object.freeze([]) as readonly string[],
    requireAll: false,
    lifecycle: "session" as const,
    schemaVersion: 0,
    declared: false,
    warnings: Object.freeze([]) as readonly string[],
  });
}

function audience(
  value: unknown,
  knownSubroles: ReadonlySet<string>,
  warnings: string[],
): QaSkillAudience {
  if (value === undefined)
    return Object.freeze({ type: "unassigned" as const });
  if (!isPlainObject(value)) {
    warnings.push("audience must be an object");
    return Object.freeze({ type: "unassigned" as const });
  }
  if (value.type === "common") {
    return Object.freeze({ type: "common" as const });
  }
  if (value.type !== "subroles") {
    warnings.push(`unsupported audience type: ${JSON.stringify(value.type)}`);
    return Object.freeze({ type: "unassigned" as const });
  }
  const requested = strings(value.include, "audience.include", warnings);
  const include: string[] = [];
  for (const id of requested) {
    if (knownSubroles.has(id)) {
      include.push(id);
      continue;
    }
    // An unknown role fails closed for itself and never invalidates the skill.
    warnings.push(`unknown subrole: ${id}`);
  }
  if (include.length === 0) {
    warnings.push("audience lists no known subrole");
    return Object.freeze({ type: "unassigned" as const });
  }
  return Object.freeze({
    type: "subroles" as const,
    include: Object.freeze(include),
  });
}

/**
 * Read and normalize one skill's `metadata.qa-surface` block.
 *
 * The block is advisory input, never an authority: it decides who may see the
 * skill and which tools the skill needs, while the role ceiling still decides
 * whether a tool can ever be granted. Malformed input degrades to the
 * fail-closed default and is reported instead of throwing, because one broken
 * skill must not take down discovery for the whole deployment.
 * @param name - the skill name the registry resolved, not the metadata's.
 * @param metadata - the raw frontmatter `metadata` object, if any.
 * @param knownSubroles - role ids that currently exist, for typo reporting.
 * @returns the normalized descriptor with every complaint in `warnings`.
 */
export function parseQaSkillMetadata(
  name: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
  knownSubroles: ReadonlySet<string>,
): QaSkillDescriptor {
  const raw = metadata?.[QA_METADATA_KEY];
  if (!isPlainObject(raw)) return unassignedSkill(name);

  const warnings: string[] = [];
  const version = raw.version;
  if (version !== undefined && version !== SUPPORTED_SCHEMA_VERSION) {
    warnings.push(
      `unsupported qa-surface metadata version: ${JSON.stringify(version)}`,
    );
    return Object.freeze({
      ...unassignedSkill(name),
      declared: true,
      warnings: Object.freeze(warnings),
    });
  }

  const declaredAudience = audience(raw.audience, knownSubroles, warnings);
  const toolsBlock = isPlainObject(raw.tools) ? raw.tools : undefined;
  if (raw.tools !== undefined && toolsBlock === undefined) {
    warnings.push("tools must be an object");
  }
  const requiredTools = strings(
    toolsBlock?.requires,
    "tools.requires",
    warnings,
  );
  const grant = isPlainObject(toolsBlock?.grant) ? toolsBlock.grant : undefined;
  if (toolsBlock?.grant !== undefined && grant === undefined) {
    warnings.push("tools.grant must be an object");
  }
  let requireAll = false;
  if (grant?.requireAll !== undefined) {
    if (typeof grant.requireAll === "boolean") {
      requireAll = grant.requireAll;
    } else {
      warnings.push("tools.grant.requireAll must be a boolean");
    }
  }
  if (grant?.lifecycle !== undefined && grant.lifecycle !== "session") {
    // `turn`/`task` lifecycles are deliberately unsupported in v1: a grant
    // that expires before the model acts on the instructions is a trap.
    warnings.push(
      `unsupported grant lifecycle: ${JSON.stringify(grant.lifecycle)}; using session`,
    );
  }

  return Object.freeze({
    name,
    audience: declaredAudience,
    requiredTools: Object.freeze(requiredTools),
    requireAll,
    lifecycle: "session" as const,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    declared: true,
    warnings: Object.freeze(warnings),
  });
}

/** Validate one administrator overlay row before it reaches the policy file. */
export function normalizeSkillOverride(
  value: QaSkillAssignmentOverride,
): QaSkillAssignmentOverride {
  const skillName = String(value.skillName ?? "").trim();
  if (!CAPABILITY_ID.test(skillName)) {
    throw new TypeError("skill override must name a skill");
  }
  const roles = (input: readonly string[] | undefined, label: string) => {
    const result = [
      ...new Set((input ?? []).map((entry) => String(entry).trim())),
    ].filter(Boolean);
    if (result.some((entry) => !SUBROLE_ID.test(entry))) {
      throw new TypeError(`${label} must contain subrole ids`);
    }
    return result;
  };
  const add = roles(value.addToSubroles, "addToSubroles");
  const remove = roles(value.removeFromSubroles, "removeFromSubroles");
  const disabled = value.disabled === true;
  const forceCommon = value.forceCommon === true;
  return Object.freeze({
    skillName,
    ...(add.length === 0 ? {} : { addToSubroles: Object.freeze(add) }),
    ...(remove.length === 0
      ? {}
      : { removeFromSubroles: Object.freeze(remove) }),
    ...(forceCommon ? { forceCommon: true } : {}),
    ...(disabled ? { disabled: true } : {}),
  });
}

/** One skill's effective audience after the administrator overlay. */
export interface QaSkillVisibility {
  readonly declaredTo: readonly string[];
  readonly visibleTo: readonly string[];
  readonly addedByAdmin: readonly string[];
  readonly removedByAdmin: readonly string[];
  readonly disabled: boolean;
  /** Whether the overlay actually changed the declared outcome. */
  readonly overridden: boolean;
}

/**
 * Merge one skill's declared audience with its administrator overlay.
 *
 * The declared list is only a default: an administrator may extend it, force
 * the skill on for every role, or withdraw it. A withdrawal always wins over
 * an addition, so a contradictory pair of edits can only narrow access.
 * @param descriptor - normalized metadata of the skill.
 * @param override - administrator overlay, when one exists.
 * @param enabledRoles - ids of subroles that are currently enabled.
 */
export function resolveSkillVisibility(
  descriptor: QaSkillDescriptor,
  override: QaSkillAssignmentOverride | undefined,
  enabledRoles: readonly string[],
): QaSkillVisibility {
  const declaredTo =
    descriptor.audience.type === "common"
      ? [...enabledRoles]
      : descriptor.audience.type === "subroles"
        ? descriptor.audience.include.filter((id) => enabledRoles.includes(id))
        : [];
  const enabled = new Set(enabledRoles);
  const addedByAdmin = (override?.addToSubroles ?? []).filter((id) =>
    enabled.has(id),
  );
  // Reported as given, not only when it takes something away: a withdrawal must
  // also beat an administrator's own explicit role list, so the caller has to
  // see it for every role it names.
  const removedByAdmin = (override?.removeFromSubroles ?? []).filter((id) =>
    enabled.has(id),
  );
  const disabled = override?.disabled === true;

  const visible = new Set(declaredTo);
  if (override?.forceCommon === true) {
    for (const role of enabledRoles) visible.add(role);
  }
  for (const role of addedByAdmin) visible.add(role);
  for (const role of removedByAdmin) visible.delete(role);
  if (disabled) visible.clear();

  const overridden =
    disabled ||
    override?.forceCommon === true ||
    addedByAdmin.some((id) => !declaredTo.includes(id)) ||
    removedByAdmin.some((id) => declaredTo.includes(id));

  return Object.freeze({
    declaredTo: Object.freeze(declaredTo),
    visibleTo: Object.freeze(enabledRoles.filter((id) => visible.has(id))),
    addedByAdmin: Object.freeze(addedByAdmin),
    removedByAdmin: Object.freeze(removedByAdmin),
    disabled,
    overridden,
  });
}

/**
 * Computed health of one skill for the administration table.
 *
 * `blocked` and `degraded` differ only in what `requireAll` promises: a strict
 * skill refuses to activate at all, a best-effort one activates with a warning.
 * @param descriptor - normalized metadata carrying the requirement list.
 * @param available - required tools that are installed and grantable for at
 *   least one role that can see the skill.
 * @param missing - required tools no visible role could ever grant.
 * @param visibleTo - roles that currently see the skill.
 */
export function skillHealth(
  descriptor: QaSkillDescriptor,
  available: number,
  missing: number,
  visibleTo: readonly string[],
): QaSkillHealth {
  if (available + missing === 0) {
    return visibleTo.length === 0 ? "unassigned" : "healthy";
  }
  if (missing === 0) return "healthy";
  return descriptor.requireAll ? "blocked" : "degraded";
}
