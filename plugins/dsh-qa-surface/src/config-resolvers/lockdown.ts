import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { isAbsoluteDirectoryPath } from "./shared.js";

type LockdownSlice = ResolvedQaSurfaceConfig["lockdown"];

/** Tool allow-list names are capped so they stay legible in host echoes. */
function uniqueToolNames(values: readonly string[]): readonly string[] {
  const names = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (names.some((value) => value.length > 200)) {
    throw new TypeError(
      "dsh-qa-surface: lockdown.toolPolicy.allow names must be at most 200 characters",
    );
  }
  return Object.freeze(names);
}

function uniqueAbsoluteRoots(values: readonly string[]): readonly string[] {
  const roots = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (roots.some((value) => !isAbsoluteDirectoryPath(value))) {
    throw new TypeError(
      "dsh-qa-surface: lockdown.sharedReadOnlyRoots must contain only absolute paths",
    );
  }
  return Object.freeze(roots);
}

/**
 * Resolve the lockdown domain. The capability flags are clamped shut, and
 * showing the reset control needs an explicit authorization here, so the
 * resolved UI slice arrives as a neighbor.
 */
export function resolveLockdown(
  input: QaSurfaceConfig,
  ui: ResolvedQaSurfaceConfig["ui"],
): LockdownSlice {
  const lockdownEnabled =
    input.lockdown?.enabled ?? DEFAULT_QA_SURFACE_CONFIG.lockdown.enabled;
  const rawLockdown = input.lockdown as
    Readonly<Record<string, unknown>> | undefined;
  const forbiddenCapabilityFlags = [
    ["allowPermissionChanges", rawLockdown?.allowPermissionChanges],
    ["allowSlashCommands", rawLockdown?.allowSlashCommands],
    ["allowSettingsMutation", rawLockdown?.allowSettingsMutation],
    ["allowSessionRename", rawLockdown?.allowSessionRename],
    ["allowSessionDelete", rawLockdown?.allowSessionDelete],
    ["allowArbitrarySessionOpen", rawLockdown?.allowArbitrarySessionOpen],
  ] as const;
  const weakenedFlag = forbiddenCapabilityFlags.find(
    ([, value]) => value === true,
  );
  if (weakenedFlag !== undefined) {
    throw new TypeError(
      `dsh-qa-surface: lockdown.${weakenedFlag[0]} cannot be enabled`,
    );
  }
  const sandboxMode =
    input.lockdown?.sandboxMode ??
    DEFAULT_QA_SURFACE_CONFIG.lockdown.sandboxMode;
  if (sandboxMode !== "read-only" && sandboxMode !== "workspace-write") {
    throw new TypeError(
      "dsh-qa-surface: lockdown.sandboxMode must be read-only or workspace-write",
    );
  }
  if (
    input.lockdown?.approvalPolicy !== undefined &&
    input.lockdown.approvalPolicy !== "never"
  ) {
    throw new TypeError(
      "dsh-qa-surface: lockdown.approvalPolicy must be never",
    );
  }
  if (
    input.lockdown?.toolPolicy?.mode !== undefined &&
    input.lockdown.toolPolicy.mode !== "allow-list"
  ) {
    throw new TypeError(
      "dsh-qa-surface: lockdown.toolPolicy.mode must be allow-list",
    );
  }
  const permissionPreset =
    input.lockdown?.permissionPreset?.trim() ??
    DEFAULT_QA_SURFACE_CONFIG.lockdown.permissionPreset;
  if (lockdownEnabled && permissionPreset === "") {
    throw new TypeError(
      "dsh-qa-surface: lockdown.permissionPreset is required when lockdown is enabled",
    );
  }
  const allowSessionReset =
    input.lockdown?.allowSessionReset ??
    DEFAULT_QA_SURFACE_CONFIG.lockdown.allowSessionReset;
  if (lockdownEnabled && ui.showReset && !allowSessionReset) {
    throw new TypeError(
      "dsh-qa-surface: ui.showReset requires lockdown.allowSessionReset",
    );
  }
  return Object.freeze({
    enabled: lockdownEnabled,
    enforceFixedAgentPreset:
      input.lockdown?.enforceFixedAgentPreset ??
      DEFAULT_QA_SURFACE_CONFIG.lockdown.enforceFixedAgentPreset,
    enforceFixedWorkspace:
      input.lockdown?.enforceFixedWorkspace ??
      DEFAULT_QA_SURFACE_CONFIG.lockdown.enforceFixedWorkspace,
    enforceFixedModel:
      input.lockdown?.enforceFixedModel ??
      DEFAULT_QA_SURFACE_CONFIG.lockdown.enforceFixedModel,
    sandboxMode,
    approvalPolicy: "never",
    permissionPreset,
    allowPermissionChanges: false,
    allowSlashCommands: false,
    allowSettingsMutation: false,
    allowSessionReset,
    allowSessionRename: false,
    allowSessionDelete: false,
    allowArbitrarySessionOpen: false,
    toolPolicy: Object.freeze({
      mode: "allow-list",
      allow: uniqueToolNames(input.lockdown?.toolPolicy?.allow ?? []),
    }),
    sharedReadOnlyRoots: uniqueAbsoluteRoots(
      input.lockdown?.sharedReadOnlyRoots ?? [],
    ),
  });
}
