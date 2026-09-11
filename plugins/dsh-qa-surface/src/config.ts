import z from "@deepseek-ai/schemastery";
import type { QaSurfaceConfig } from "./types.js";

const nullableString = z.union([z.string(), z.const(null)]);

const configSchema = z.object({
  enabled: z.boolean().default(true),
  route: z
    .object({
      path: z.string().default("/qa"),
      matchChildren: z.boolean().default(true),
    })
    .default({ path: "/qa", matchChildren: true }),
  branding: z
    .object({
      title: z.string().default("Помощник"),
      subtitle: z.string().default(""),
      welcomeMessage: z.string().default("Чем могу помочь?"),
      placeholder: z.string().default("Задайте вопрос…"),
      logoUrl: nullableString.default(null),
      disclaimer: nullableString.default(
        "Диалоги могут быть видны другим пользователям сервера и используются для улучшения качества ответов.",
      ),
    })
    .default({
      title: "Помощник",
      subtitle: "",
      welcomeMessage: "Чем могу помочь?",
      placeholder: "Задайте вопрос…",
      logoUrl: null,
      disclaimer:
        "Диалоги могут быть видны другим пользователям сервера и используются для улучшения качества ответов.",
    }),
  session: z
    .object({
      policy: z
        .union(["browser-persistent", "new-on-load", "fixed"] as const)
        .default("browser-persistent"),
      storageKey: z.string().default("dsh-qa-surface.session"),
      cwd: nullableString.default(null),
      workspaceId: nullableString.default(null),
      fixedSessionId: nullableString.default(null),
      agentPreset: nullableString.default(null),
      provider: nullableString.default(null),
      model: nullableString.default(null),
      reasoningEffort: nullableString.default(null),
    })
    .default({
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
  ui: z
    .object({
      showHeader: z.boolean().default(true),
      showReset: z.boolean().default(true),
      showStop: z.boolean().default(true),
      showTimestamps: z.boolean().default(false),
      showToolActivity: z.boolean().default(false),
      showReasoning: z.boolean().default(false),
      renderMarkdown: z.boolean().default(true),
      maxContentWidth: z.number().step(1).min(480).max(1600).default(900),
      showSessionList: z.boolean().default(false),
    })
    .default({
      showHeader: true,
      showReset: true,
      showStop: true,
      showTimestamps: false,
      showToolActivity: false,
      showReasoning: false,
      renderMarkdown: true,
      maxContentWidth: 900,
      showSessionList: false,
    }),
  suggestedQuestions: z
    .array(z.string())
    .default([
      "Что ты умеешь?",
      "С чего начать?",
      "Помоги разобраться с ошибкой",
    ]),
  interaction: z
    .object({
      approvals: z.union(["blocked"] as const).default("blocked"),
      questions: z.union(["unsupported"] as const).default("unsupported"),
    })
    .default({ approvals: "blocked", questions: "unsupported" }),
  lockdown: z
    .object({
      enabled: z.boolean().default(true),
      enforceFixedAgentPreset: z.boolean().default(true),
      enforceFixedWorkspace: z.boolean().default(true),
      enforceFixedModel: z.boolean().default(true),
      sandboxMode: z.union(["read-only"] as const).default("read-only"),
      approvalPolicy: z.union(["never"] as const).default("never"),
      permissionPreset: z.string().default("qa-read-only"),
      allowPermissionChanges: z.const(false).default(false),
      allowSlashCommands: z.const(false).default(false),
      allowSettingsMutation: z.const(false).default(false),
      allowSessionReset: z.boolean().default(false),
      allowSessionRename: z.const(false).default(false),
      allowSessionDelete: z.const(false).default(false),
      allowArbitrarySessionOpen: z.const(false).default(false),
      toolPolicy: z
        .object({
          mode: z.union(["allow-list"] as const).default("allow-list"),
          allow: z.array(z.string()).default([]),
        })
        .default({ mode: "allow-list", allow: [] }),
    })
    .default({
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
      toolPolicy: { mode: "allow-list", allow: [] },
    }),
  embedding: z
    .object({ frameAncestors: nullableString.default(null) })
    .default({ frameAncestors: null }),
  sources: z
    .object({
      enabled: z.boolean().default(true),
      collect: z
        .object({
          parentAgent: z.boolean().default(true),
          subagents: z.boolean().default(true),
          persistTurnEvent: z.boolean().default(true),
        })
        .default({
          parentAgent: true,
          subagents: true,
          persistTurnEvent: true,
        }),
      display: z
        .object({
          sidebar: z.boolean().default(true),
          footer: z.boolean().default(true),
          groupByKind: z.boolean().default(true),
          showDiscovered: z.boolean().default(false),
          showOriginBadges: z.boolean().default(false),
          maxInitiallyVisiblePerGroup: z
            .number()
            .step(1)
            .min(1)
            .max(100)
            .default(8),
        })
        .default({
          sidebar: true,
          footer: true,
          groupByKind: true,
          showDiscovered: false,
          showOriginBadges: false,
          maxInitiallyVisiblePerGroup: 8,
        }),
      webSearch: z
        .object({
          promoteSearchResultsWithoutFetch: z.boolean().default(true),
          maxPromotedPerSearch: z.number().step(1).min(0).max(50).default(5),
        })
        .default({
          promoteSearchResultsWithoutFetch: true,
          maxPromotedPerSearch: 5,
        }),
      dedupe: z
        .object({
          normalizeUrls: z.boolean().default(true),
          stripTrackingParams: z.boolean().default(true),
          mergeFileRanges: z.boolean().default(true),
        })
        .default({
          normalizeUrls: true,
          stripTrackingParams: true,
          mergeFileRanges: true,
        }),
      filePreview: z
        .object({
          enabled: z.boolean().default(true),
          markdownRenderedByDefault: z.boolean().default(true),
          allowRawToggle: z.boolean().default(true),
          maxBytes: z
            .number()
            .step(1)
            .min(1024)
            .max(20_000_000)
            .default(2_000_000),
          maxMarkdownRenderBytes: z
            .number()
            .step(1)
            .min(1024)
            .max(10_000_000)
            .default(1_000_000),
        })
        .default({
          enabled: true,
          markdownRenderedByDefault: true,
          allowRawToggle: true,
          maxBytes: 2_000_000,
          maxMarkdownRenderBytes: 1_000_000,
        }),
      subagents: z
        .object({
          inheritSources: z.boolean().default(true),
          enableReportToolFallback: z.boolean().default(true),
          markIncompleteOpaqueRuns: z.boolean().default(true),
        })
        .default({
          inheritSources: true,
          enableReportToolFallback: true,
          markIncompleteOpaqueRuns: true,
        }),
      legacy: z
        .object({ parseAssistantSourcesBlock: z.boolean().default(false) })
        .default({ parseAssistantSourcesBlock: false }),
    })
    .default({
      enabled: true,
      collect: { parentAgent: true, subagents: true, persistTurnEvent: true },
      display: {
        sidebar: true,
        footer: true,
        groupByKind: true,
        showDiscovered: false,
        showOriginBadges: false,
        maxInitiallyVisiblePerGroup: 8,
      },
      webSearch: {
        promoteSearchResultsWithoutFetch: true,
        maxPromotedPerSearch: 5,
      },
      dedupe: {
        normalizeUrls: true,
        stripTrackingParams: true,
        mergeFileRanges: true,
      },
      filePreview: {
        enabled: true,
        markdownRenderedByDefault: true,
        allowRawToggle: true,
        maxBytes: 2_000_000,
        maxMarkdownRenderBytes: 1_000_000,
      },
      subagents: {
        inheritSources: true,
        enableReportToolFallback: true,
        markIncompleteOpaqueRuns: true,
      },
      legacy: { parseAssistantSourcesBlock: false },
    }),
});

export const ConfigSchema = configSchema as unknown as z<QaSurfaceConfig>;
export {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "./resolve-config.js";
