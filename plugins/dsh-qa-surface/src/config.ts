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
      title: z.string().default("Assistant"),
      subtitle: z.string().default(""),
      welcomeMessage: z.string().default("How can I help?"),
      placeholder: z.string().default("Ask a question..."),
      logoUrl: nullableString.default(null),
    })
    .default({
      title: "Assistant",
      subtitle: "",
      welcomeMessage: "How can I help?",
      placeholder: "Ask a question...",
      logoUrl: null,
    }),
  session: z
    .object({
      policy: z
        .union(["browser-persistent", "new-on-load", "fixed"] as const)
        .default("browser-persistent"),
      storageKey: z.string().default("dsh-qa-surface"),
      workspaceId: nullableString.default(null),
      fixedSessionId: nullableString.default(null),
      agentPreset: nullableString.default(null),
      provider: nullableString.default(null),
      model: nullableString.default(null),
      reasoningEffort: nullableString.default(null),
    })
    .default({
      policy: "browser-persistent",
      storageKey: "dsh-qa-surface",
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
    }),
  suggestedQuestions: z.array(z.string()).default([]),
  interaction: z
    .object({
      approvals: z.union(["blocked"] as const).default("blocked"),
      questions: z.union(["unsupported"] as const).default("unsupported"),
    })
    .default({ approvals: "blocked", questions: "unsupported" }),
  embedding: z
    .object({ frameAncestors: nullableString.default(null) })
    .default({ frameAncestors: null }),
});

export const ConfigSchema = configSchema as unknown as z<QaSurfaceConfig>;
export {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "./resolve-config.js";
