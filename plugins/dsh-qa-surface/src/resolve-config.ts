import type { QaSurfaceConfig, ResolvedQaSurfaceConfig } from "./types.js";

export const DEFAULT_QA_SURFACE_CONFIG: ResolvedQaSurfaceConfig = Object.freeze(
  {
    enabled: true,
    route: Object.freeze({ path: "/qa", matchChildren: true }),
    branding: Object.freeze({
      title: "Помощник",
      subtitle: "",
      welcomeMessage: "Чем могу помочь?",
      placeholder: "Задайте вопрос…",
      logoUrl: null,
      disclaimer:
        "Диалоги могут быть видны другим пользователям сервера и используются для улучшения качества ответов.",
    }),
    session: Object.freeze({
      policy: "browser-persistent",
      storageKey: "dsh-qa-surface.session",
      cwd: null,
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
      showSessionList: false,
    }),
    suggestedQuestions: Object.freeze([
      "Что ты умеешь?",
      "С чего начать?",
      "Помоги разобраться с ошибкой",
    ]),
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
    accounts: Object.freeze({
      enabled: false,
      allowRegistration: true,
      sessionTtlDays: 30,
      showOtherUsersChats: false,
      perUserWorkspace: false,
    }),
    entry: Object.freeze({
      redirectNonLoopback: true,
      cookieBootstrap: true,
    }),
    sources: Object.freeze({
      enabled: true,
      collect: Object.freeze({
        parentAgent: true,
        subagents: true,
        persistTurnEvent: true,
      }),
      display: Object.freeze({
        sidebar: true,
        footer: true,
        groupByKind: true,
        showDiscovered: false,
        showOriginBadges: false,
        maxInitiallyVisiblePerGroup: 8,
      }),
      webSearch: Object.freeze({
        promoteSearchResultsWithoutFetch: true,
        maxPromotedPerSearch: 5,
      }),
      dedupe: Object.freeze({
        normalizeUrls: true,
        stripTrackingParams: true,
        mergeFileRanges: true,
      }),
      filePreview: Object.freeze({
        enabled: true,
        markdownRenderedByDefault: true,
        allowRawToggle: true,
        maxBytes: 2_000_000,
        maxMarkdownRenderBytes: 1_000_000,
      }),
      subagents: Object.freeze({
        inheritSources: true,
        enableReportToolFallback: true,
        markIncompleteOpaqueRuns: true,
      }),
      legacy: Object.freeze({ parseAssistantSourcesBlock: false }),
    }),
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
  // The cwd pin is the no-registry alternative to workspaceId; both pin the
  // session to one directory, so together they are a configuration error.
  const cwd = optionalText(input.session?.cwd);
  if (cwd !== null && !/^([a-zA-Z]:[/\\]|\/)/u.test(cwd)) {
    throw new TypeError(
      "dsh-qa-surface: session.cwd must be an absolute directory path",
    );
  }
  const workspaceId = optionalText(input.session?.workspaceId);
  if (workspaceId !== null && cwd !== null) {
    throw new TypeError(
      "dsh-qa-surface: session.workspaceId and session.cwd are mutually exclusive",
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
  if (
    lockdownEnabled &&
    (input.ui?.showReset ?? DEFAULT_QA_SURFACE_CONFIG.ui.showReset) &&
    !allowSessionReset
  ) {
    throw new TypeError(
      "dsh-qa-surface: ui.showReset requires lockdown.allowSessionReset",
    );
  }
  const maxInitiallyVisiblePerGroup =
    input.sources?.display?.maxInitiallyVisiblePerGroup ??
    DEFAULT_QA_SURFACE_CONFIG.sources.display.maxInitiallyVisiblePerGroup;
  const maxPromotedPerSearch =
    input.sources?.webSearch?.maxPromotedPerSearch ??
    DEFAULT_QA_SURFACE_CONFIG.sources.webSearch.maxPromotedPerSearch;
  const maxBytes =
    input.sources?.filePreview?.maxBytes ??
    DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.maxBytes;
  const maxMarkdownRenderBytes =
    input.sources?.filePreview?.maxMarkdownRenderBytes ??
    DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.maxMarkdownRenderBytes;
  for (const [name, value, min, max] of [
    [
      "sources.display.maxInitiallyVisiblePerGroup",
      maxInitiallyVisiblePerGroup,
      1,
      100,
    ],
    ["sources.webSearch.maxPromotedPerSearch", maxPromotedPerSearch, 0, 50],
    ["sources.filePreview.maxBytes", maxBytes, 1_024, 20_000_000],
    [
      "sources.filePreview.maxMarkdownRenderBytes",
      maxMarkdownRenderBytes,
      1_024,
      10_000_000,
    ],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new TypeError(
        `dsh-qa-surface: ${name} must be an integer from ${min} to ${max}`,
      );
    }
  }
  if (maxMarkdownRenderBytes > maxBytes) {
    throw new TypeError(
      "dsh-qa-surface: sources.filePreview.maxMarkdownRenderBytes cannot exceed maxBytes",
    );
  }
  const sessionTtlDays =
    input.accounts?.sessionTtlDays ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.sessionTtlDays;
  if (
    !Number.isSafeInteger(sessionTtlDays) ||
    sessionTtlDays < 1 ||
    sessionTtlDays > 365
  ) {
    throw new TypeError(
      "dsh-qa-surface: accounts.sessionTtlDays must be an integer from 1 to 365",
    );
  }
  const accountsEnabled =
    input.accounts?.enabled ?? DEFAULT_QA_SURFACE_CONFIG.accounts.enabled;
  const perUserWorkspace =
    input.accounts?.perUserWorkspace ??
    DEFAULT_QA_SURFACE_CONFIG.accounts.perUserWorkspace;
  const enforceFixedWorkspace =
    input.lockdown?.enforceFixedWorkspace ??
    DEFAULT_QA_SURFACE_CONFIG.lockdown.enforceFixedWorkspace;
  if (perUserWorkspace && !accountsEnabled) {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace requires accounts.enabled",
    );
  }
  if (perUserWorkspace && workspaceId === null) {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace requires session.workspaceId",
    );
  }
  if (perUserWorkspace && policy === "fixed") {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace does not support fixed sessions",
    );
  }
  if (
    perUserWorkspace &&
    (!lockdownEnabled ||
      !enforceFixedWorkspace ||
      sandboxMode !== "workspace-write")
  ) {
    throw new TypeError(
      "dsh-qa-surface: accounts.perUserWorkspace requires lockdown.enabled, enforceFixedWorkspace, and workspace-write",
    );
  }
  if (sandboxMode === "workspace-write" && !perUserWorkspace) {
    throw new TypeError(
      "dsh-qa-surface: workspace-write is allowed only with accounts.perUserWorkspace",
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
      // Undefined falls back to the default notice; an explicit null or
      // empty string hides the plate entirely.
      disclaimer:
        input.branding?.disclaimer === undefined
          ? DEFAULT_QA_SURFACE_CONFIG.branding.disclaimer
          : (optionalText(input.branding.disclaimer) ?? ""),
    }),
    session: Object.freeze({
      policy,
      storageKey,
      cwd,
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
      showSessionList:
        input.ui?.showSessionList ??
        DEFAULT_QA_SURFACE_CONFIG.ui.showSessionList,
    }),
    suggestedQuestions: uniqueQuestions(
      input.suggestedQuestions ?? DEFAULT_QA_SURFACE_CONFIG.suggestedQuestions,
    ),
    interaction: Object.freeze({
      approvals: "blocked",
      questions: "unsupported",
    }),
    lockdown: Object.freeze({
      enabled: lockdownEnabled,
      enforceFixedAgentPreset:
        input.lockdown?.enforceFixedAgentPreset ??
        DEFAULT_QA_SURFACE_CONFIG.lockdown.enforceFixedAgentPreset,
      enforceFixedWorkspace: enforceFixedWorkspace,
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
    }),
    embedding: Object.freeze({
      frameAncestors: optionalText(input.embedding?.frameAncestors),
    }),
    accounts: Object.freeze({
      enabled: accountsEnabled,
      allowRegistration:
        input.accounts?.allowRegistration ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.allowRegistration,
      sessionTtlDays,
      showOtherUsersChats:
        input.accounts?.showOtherUsersChats ??
        DEFAULT_QA_SURFACE_CONFIG.accounts.showOtherUsersChats,
      perUserWorkspace,
    }),
    entry: Object.freeze({
      redirectNonLoopback:
        input.entry?.redirectNonLoopback ??
        DEFAULT_QA_SURFACE_CONFIG.entry.redirectNonLoopback,
      cookieBootstrap:
        input.entry?.cookieBootstrap ??
        DEFAULT_QA_SURFACE_CONFIG.entry.cookieBootstrap,
    }),
    sources: Object.freeze({
      enabled:
        input.sources?.enabled ?? DEFAULT_QA_SURFACE_CONFIG.sources.enabled,
      collect: Object.freeze({
        parentAgent:
          input.sources?.collect?.parentAgent ??
          DEFAULT_QA_SURFACE_CONFIG.sources.collect.parentAgent,
        subagents:
          input.sources?.collect?.subagents ??
          DEFAULT_QA_SURFACE_CONFIG.sources.collect.subagents,
        persistTurnEvent:
          input.sources?.collect?.persistTurnEvent ??
          DEFAULT_QA_SURFACE_CONFIG.sources.collect.persistTurnEvent,
      }),
      display: Object.freeze({
        sidebar:
          input.sources?.display?.sidebar ??
          DEFAULT_QA_SURFACE_CONFIG.sources.display.sidebar,
        footer:
          input.sources?.display?.footer ??
          DEFAULT_QA_SURFACE_CONFIG.sources.display.footer,
        groupByKind:
          input.sources?.display?.groupByKind ??
          DEFAULT_QA_SURFACE_CONFIG.sources.display.groupByKind,
        showDiscovered:
          input.sources?.display?.showDiscovered ??
          DEFAULT_QA_SURFACE_CONFIG.sources.display.showDiscovered,
        showOriginBadges:
          input.sources?.display?.showOriginBadges ??
          DEFAULT_QA_SURFACE_CONFIG.sources.display.showOriginBadges,
        maxInitiallyVisiblePerGroup,
      }),
      webSearch: Object.freeze({
        promoteSearchResultsWithoutFetch:
          input.sources?.webSearch?.promoteSearchResultsWithoutFetch ??
          DEFAULT_QA_SURFACE_CONFIG.sources.webSearch
            .promoteSearchResultsWithoutFetch,
        maxPromotedPerSearch,
      }),
      dedupe: Object.freeze({
        normalizeUrls:
          input.sources?.dedupe?.normalizeUrls ??
          DEFAULT_QA_SURFACE_CONFIG.sources.dedupe.normalizeUrls,
        stripTrackingParams:
          input.sources?.dedupe?.stripTrackingParams ??
          DEFAULT_QA_SURFACE_CONFIG.sources.dedupe.stripTrackingParams,
        mergeFileRanges:
          input.sources?.dedupe?.mergeFileRanges ??
          DEFAULT_QA_SURFACE_CONFIG.sources.dedupe.mergeFileRanges,
      }),
      filePreview: Object.freeze({
        enabled:
          input.sources?.filePreview?.enabled ??
          DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.enabled,
        markdownRenderedByDefault:
          input.sources?.filePreview?.markdownRenderedByDefault ??
          DEFAULT_QA_SURFACE_CONFIG.sources.filePreview
            .markdownRenderedByDefault,
        allowRawToggle:
          input.sources?.filePreview?.allowRawToggle ??
          DEFAULT_QA_SURFACE_CONFIG.sources.filePreview.allowRawToggle,
        maxBytes,
        maxMarkdownRenderBytes,
      }),
      subagents: Object.freeze({
        inheritSources:
          input.sources?.subagents?.inheritSources ??
          DEFAULT_QA_SURFACE_CONFIG.sources.subagents.inheritSources,
        enableReportToolFallback:
          input.sources?.subagents?.enableReportToolFallback ??
          DEFAULT_QA_SURFACE_CONFIG.sources.subagents.enableReportToolFallback,
        markIncompleteOpaqueRuns:
          input.sources?.subagents?.markIncompleteOpaqueRuns ??
          DEFAULT_QA_SURFACE_CONFIG.sources.subagents.markIncompleteOpaqueRuns,
      }),
      legacy: Object.freeze({
        parseAssistantSourcesBlock:
          input.sources?.legacy?.parseAssistantSourcesBlock ??
          DEFAULT_QA_SURFACE_CONFIG.sources.legacy.parseAssistantSourcesBlock,
      }),
    }),
  });
}
