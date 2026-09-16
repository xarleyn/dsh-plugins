import {
  QA_PROFILE_INSTRUCTIONS_MAX_MAX,
  QA_PROFILE_INSTRUCTIONS_MAX_MIN,
  validateIdentityFields,
} from "../profile.js";
import {
  QA_SKILL_ENABLED_BY_DEFAULT,
  QA_SKILL_MAX_BYTES_MAX,
  QA_SKILL_MAX_BYTES_MIN,
  skillRelativeRootProblem,
} from "../personal-skills/skill-format.js";
import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { assertIntInRange } from "./shared.js";

type AccountsSlice = ResolvedQaSurfaceConfig["accounts"];

/** Resolved neighbors the per-user workspace boundary is checked against. */
export interface AccountsDependencies {
  readonly session: ResolvedQaSurfaceConfig["session"];
  readonly lockdown: ResolvedQaSurfaceConfig["lockdown"];
}

/**
 * Resolve the accounts domain. The per-user workspace boundary spans session
 * and lockdown, so their resolved slices arrive as dependencies and the
 * boundary checks run here, next to the flag they guard.
 */
export function resolveAccounts(
  input: QaSurfaceConfig,
  dependencies: AccountsDependencies,
): AccountsSlice {
  const sessionTtlDays =
    input.accounts?.sessionTtlDays ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.sessionTtlDays;
  assertIntInRange("accounts.sessionTtlDays", sessionTtlDays, 1, 365);
  const maxAuthAttemptsPerMinute =
    input.accounts?.maxAuthAttemptsPerMinute ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.maxAuthAttemptsPerMinute;
  assertIntInRange(
    "accounts.maxAuthAttemptsPerMinute",
    maxAuthAttemptsPerMinute,
    1,
    600,
  );
  const accountsEnabled =
    input.accounts?.enabled ?? DEFAULT_QA_SURFACE_CONFIG.accounts.enabled;
  const instructionsMaxLength =
    input.accounts?.profile?.instructionsMaxLength ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.profile.instructionsMaxLength;
  assertIntInRange(
    "accounts.profile.instructionsMaxLength",
    instructionsMaxLength,
    QA_PROFILE_INSTRUCTIONS_MAX_MIN,
    QA_PROFILE_INSTRUCTIONS_MAX_MAX,
  );
  const identityFields = validateIdentityFields(
    input.accounts?.profile?.identities,
  );
  if (!identityFields.ok) {
    throw new TypeError(
      `dsh-qa-surface: accounts.profile.identities ${identityFields.message}`,
    );
  }
  const perUserWorkspace =
    input.accounts?.perUserWorkspace ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.perUserWorkspace;
  if (perUserWorkspace && !accountsEnabled) {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace requires accounts.enabled",
    );
  }
  const { session, lockdown } = dependencies;
  if (perUserWorkspace && session.workspaceId === null) {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace requires session.workspaceId",
    );
  }
  if (perUserWorkspace && session.policy === "fixed") {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace does not support fixed sessions",
    );
  }
  if (
    perUserWorkspace &&
    (!lockdown.enabled ||
      !lockdown.enforceFixedWorkspace ||
      lockdown.sandboxMode !== "workspace-write")
  ) {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace requires lockdown.enabled, enforceFixedWorkspace, and workspace-write",
    );
  }
  if (lockdown.sandboxMode === "workspace-write" && !perUserWorkspace) {
    throw new TypeError(
      "dsh-qa-surface: workspace-write is allowed only with accounts.perUserWorkspace",
    );
  }
  const relativeRoot =
    input.accounts?.skills?.relativeRoot ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.skills.relativeRoot;
  const relativeRootProblem = skillRelativeRootProblem(relativeRoot);
  if (relativeRootProblem !== null) {
    throw new TypeError(
      `dsh-qa-surface: accounts.skills.relativeRoot ${relativeRootProblem}`,
    );
  }
  const maxSkillBytes =
    input.accounts?.skills?.maxSkillBytes ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.skills.maxSkillBytes;
  assertIntInRange(
    "accounts.skills.maxSkillBytes",
    maxSkillBytes,
    QA_SKILL_MAX_BYTES_MIN,
    QA_SKILL_MAX_BYTES_MAX,
  );
  // A deployment without per-account directories has no personal root to
  // resolve, so the feature reports itself off rather than offering a screen
  // that could only ever refuse. The configured flags stay untouched: turning
  // perUserWorkspace on again brings the deployment's own choice back.
  const skillsEnabled =
    (input.accounts?.skills?.enabled ?? QA_SKILL_ENABLED_BY_DEFAULT) &&
    accountsEnabled &&
    perUserWorkspace;
  const retention = {
    pruneVanishedSessions:
      input.accounts?.retention?.pruneVanishedSessions ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.retention.pruneVanishedSessions,
    ownershipGraceHours:
      input.accounts?.retention?.ownershipGraceHours ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.retention.ownershipGraceHours,
    sweepIntervalMinutes:
      input.accounts?.retention?.sweepIntervalMinutes ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.retention.sweepIntervalMinutes,
  };
  assertIntInRange(
    "accounts.retention.ownershipGraceHours",
    retention.ownershipGraceHours,
    1,
    8_760,
  );
  assertIntInRange(
    "accounts.retention.sweepIntervalMinutes",
    retention.sweepIntervalMinutes,
    1,
    1_440,
  );
  return Object.freeze({
    enabled: accountsEnabled,
    allowRegistration:
      input.accounts?.allowRegistration ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.allowRegistration,
    sessionTtlDays,
    maxAuthAttemptsPerMinute,
    showOtherUsersChats:
      input.accounts?.showOtherUsersChats ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.showOtherUsersChats,
    perUserWorkspace,
    retention: Object.freeze(retention),
    profile: Object.freeze({
      enabled:
        input.accounts?.profile?.enabled ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.profile.enabled,
      inject:
        input.accounts?.profile?.inject ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.profile.inject,
      identities: Object.freeze(
        identityFields.value.map((field) => Object.freeze({ ...field })),
      ),
      instructionsMaxLength,
    }),
    starters: Object.freeze({
      enabled:
        input.accounts?.starters?.enabled ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.starters.enabled,
    }),
    skills: Object.freeze({
      enabled: skillsEnabled,
      relativeRoot: relativeRoot.trim(),
      watch:
        input.accounts?.skills?.watch ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.skills.watch,
      maxSkillBytes,
      allowResourceEditing:
        input.accounts?.skills?.allowResourceEditing ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.skills.allowResourceEditing,
    }),
  });
}
