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
      storageKey: "dsh-qa-surface",
      workspaceId: null,
      fixedSessionId: null,
      agentPreset: null,
      provider: null,
      model: null,
      reasoningEffort: null,
    }),
    ui: Object.freeze({
      showHeader: true,
      showReset: true,
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
  if (input.ui?.showReasoning === true) {
    throw new TypeError(
      "dsh-qa-surface: ui.showReasoning is not supported by the safe MVP surface",
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
      showReasoning: false,
      renderMarkdown:
        input.ui?.renderMarkdown ?? DEFAULT_QA_SURFACE_CONFIG.ui.renderMarkdown,
      maxContentWidth,
    }),
    suggestedQuestions: uniqueQuestions(input.suggestedQuestions ?? []),
    interaction: Object.freeze({
      approvals: "blocked",
      questions: "unsupported",
    }),
    embedding: Object.freeze({
      frameAncestors: optionalText(input.embedding?.frameAncestors),
    }),
  });
}
