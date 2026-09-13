import {
  QA_PROFILE_INSTRUCTIONS_MAX_MAX,
  QA_PROFILE_INSTRUCTIONS_MAX_MIN,
  validateIdentityFields,
} from "../profile.js";
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
  return Object.freeze({
    enabled: accountsEnabled,
    allowRegistration:
      input.accounts?.allowRegistration ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.allowRegistration,
    sessionTtlDays,
    showOtherUsersChats:
      input.accounts?.showOtherUsersChats ??
      DEFAULT_QA_SURFACE_CONFIG.accounts.showOtherUsersChats,
    perUserWorkspace,
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
  });
}
