import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "./types.js";

export const DEFAULT_QA_SURFACE_CONFIG: ResolvedQaSurfaceConfig = Object.freeze(
  {
    enabled: true,
    route: Object.freeze({ path: "/qa", matchChildren: true }),
    branding: Object.freeze({
      title: "Assistant",
      subtitle: "",
      welcomeMessage: "How can I help?",
      placeholder: "Ask a question...",
      logoUrl: null,
    }),
    session: Object.freeze({
      policy: "browser-persistent",
      storageKey: "dsh-qa-surface.session",
      workspaceId: null,
      fixedSessionId: null,
      agentPreset: null,
      provider: null,
      model: null,
      reasoningEffort: null,
    }),
    ui: Object.freeze({
      showHeader: true,
      showReset: false,
      showStop: true,
      showTimestamps: false,
      showToolActivity: false,
      showReasoning: false,
      renderMarkdown: true,
      maxContentWidth: 900,
    }),
    suggestedQuestions: Object.freeze([]),
    interaction: Object.freeze({
      approvals: "blocked",
      questions: "unsupported",
    }),
    lockdown: Object.freeze({
      enabled: true,
      enforceFixedAgentPreset: true,
      enforceFixedWorkspace: true,
      enforceFixedModel: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      permissionPreset: "qa-read-only",
      allowPermissionChanges: false,
      allowSlashCommands: false,
      allowSettingsMutation: false,
      allowSessionReset: false,
      allowSessionRename: false,
      allowSessionDelete: false,
      allowArbitrarySessionOpen: false,
      toolPolicy: Object.freeze({
        mode: "allow-list",
        allow: Object.freeze([]),
      }),
    }),
    embedding: Object.freeze({ frameAncestors: null }),
  },
);

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function normalizeRoutePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || !trimmed.startsWith("/")) {
    throw new TypeError("dsh-qa-surface: route.path must start with /");
  }
  const path = trimmed.length > 1 ? trimmed.replace(/\/+$/u, "") : trimmed;
  if (path === "/") {
    throw new TypeError(
      "dsh-qa-surface: route.path cannot replace the operator root",
    );
  }
  if (path === "/api" || path.startsWith("/api/")) {
    throw new TypeError("dsh-qa-surface: route.path cannot claim /api");
  }
  if (path === "/plugins" || path.startsWith("/plugins/")) {
    throw new TypeError("dsh-qa-surface: route.path cannot claim /plugins");
  }
  return path;
}

function uniqueQuestions(values: readonly string[]): readonly string[] {
  const questions = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (questions.some((value) => value.length > 500)) {
    throw new TypeError(
      "dsh-qa-surface: suggested questions must be at most 500 characters",
    );
  }
  return Object.freeze(questions);
}

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

/** Materialize defaults and enforce route/session/model safety constraints. */
export function resolveConfig(
  input: QaSurfaceConfig = {},
): ResolvedQaSurfaceConfig {
  const routePath = normalizeRoutePath(
    input.route?.path ?? DEFAULT_QA_SURFACE_CONFIG.route.path,
  );
  const policy =
    input.session?.policy ?? DEFAULT_QA_SURFACE_CONFIG.session.policy;
  const fixedSessionId = optionalText(input.session?.fixedSessionId);
  if (policy === "fixed" && fixedSessionId === null) {
    throw new TypeError(
      "dsh-qa-surface: session.fixedSessionId is required for fixed policy",
    );
  }
  const provider = optionalText(input.session?.provider);
  const model = optionalText(input.session?.model);
  if ((provider === null) !== (model === null)) {
    throw new TypeError(
      "dsh-qa-surface: session.provider and session.model must be set together",
    );
  }
  const storageKey =
    input.session?.storageKey?.trim() ??
    DEFAULT_QA_SURFACE_CONFIG.session.storageKey;
  if (storageKey === "") {
    throw new TypeError("dsh-qa-surface: session.storageKey cannot be empty");
  }
  const maxContentWidth =
    input.ui?.maxContentWidth ?? DEFAULT_QA_SURFACE_CONFIG.ui.maxContentWidth;
  if (
    !Number.isSafeInteger(maxContentWidth) ||
    maxContentWidth < 480 ||
    maxContentWidth > 1600
  ) {
    throw new TypeError(
      "dsh-qa-surface: ui.maxContentWidth must be an integer from 480 to 1600",
    );
  }
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
  if (
    input.lockdown?.sandboxMode !== undefined &&
    input.lockdown.sandboxMode !== "read-only"
  ) {
    throw new TypeError(
      "dsh-qa-surface: lockdown.sandboxMode must be read-only",
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
  if (
    lockdownEnabled &&
    (input.ui?.showReset ?? DEFAULT_QA_SURFACE_CONFIG.ui.showReset) &&
    !allowSessionReset
  ) {
    throw new TypeError(
      "dsh-qa-surface: ui.showReset requires lockdown.allowSessionReset",
    );
  }

  return Object.freeze({
    enabled: input.enabled ?? DEFAULT_QA_SURFACE_CONFIG.enabled,
    route: Object.freeze({
      path: routePath,
      matchChildren:
        input.route?.matchChildren ??
        DEFAULT_QA_SURFACE_CONFIG.route.matchChildren,
    }),
    branding: Object.freeze({
      title:
        input.branding?.title?.trim() ||
        DEFAULT_QA_SURFACE_CONFIG.branding.title,
      subtitle: input.branding?.subtitle?.trim() ?? "",
      welcomeMessage:
        input.branding?.welcomeMessage?.trim() ??
        DEFAULT_QA_SURFACE_CONFIG.branding.welcomeMessage,
      placeholder:
        input.branding?.placeholder?.trim() ||
        DEFAULT_QA_SURFACE_CONFIG.branding.placeholder,
      logoUrl: optionalText(input.branding?.logoUrl),
    }),
    session: Object.freeze({
      policy,
      storageKey,
      workspaceId: optionalText(input.session?.workspaceId),
      fixedSessionId,
      agentPreset: optionalText(input.session?.agentPreset),
      provider,
      model,
      reasoningEffort: optionalText(input.session?.reasoningEffort),
    }),
    ui: Object.freeze({
      showHeader:
        input.ui?.showHeader ?? DEFAULT_QA_SURFACE_CONFIG.ui.showHeader,
      showReset: input.ui?.showReset ?? DEFAULT_QA_SURFACE_CONFIG.ui.showReset,
      showStop: input.ui?.showStop ?? DEFAULT_QA_SURFACE_CONFIG.ui.showStop,
      showTimestamps:
        input.ui?.showTimestamps ?? DEFAULT_QA_SURFACE_CONFIG.ui.showTimestamps,
      showToolActivity:
        input.ui?.showToolActivity ??
        DEFAULT_QA_SURFACE_CONFIG.ui.showToolActivity,
      showReasoning:
        input.ui?.showReasoning ?? DEFAULT_QA_SURFACE_CONFIG.ui.showReasoning,
      renderMarkdown:
        input.ui?.renderMarkdown ?? DEFAULT_QA_SURFACE_CONFIG.ui.renderMarkdown,
      maxContentWidth,
    }),
    suggestedQuestions: uniqueQuestions(input.suggestedQuestions ?? []),
    interaction: Object.freeze({
      approvals: "blocked",
      questions: "unsupported",
    }),
    lockdown: Object.freeze({
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
      sandboxMode: "read-only",
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
    }),
    embedding: Object.freeze({
      frameAncestors: optionalText(input.embedding?.frameAncestors),
    }),
  });
}
