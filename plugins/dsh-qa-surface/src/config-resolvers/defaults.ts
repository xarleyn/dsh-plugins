import { DEFAULT_QA_TEXT_EXTENSIONS } from "../attachment-rules.js";
import { QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX } from "../profile.js";
import { DEFAULT_QA_PROVENANCE_RETENTION } from "../provenance/retention.js";
import {
  QA_SKILL_DEFAULT_RELATIVE_ROOT,
  QA_SKILL_FILE_MAX_BYTES,
} from "../personal-skills/skill-format.js";
import { DEFAULT_THINKING_PHRASES } from "../thinking-phrases.js";
import type { ResolvedQaSurfaceConfig } from "../types.js";

/** The canonical resolved config; every domain resolver defaults from it. */
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
      minContentWidth: 650,
      showSessionList: false,
      subagentCodenames: true,
    }),
    suggestedQuestions: Object.freeze([
      "Что ты умеешь?",
      "С чего начать?",
      "Помоги разобраться с ошибкой",
    ]),
    thinkingPhrases: DEFAULT_THINKING_PHRASES,
    interaction: Object.freeze({
      // Fail closed: a deployment that wants the operator to answer a composed
      // tool gate's `ask` opts in with `interactive`.
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
      sharedReadOnlyRoots: Object.freeze([]),
    }),
    embedding: Object.freeze({ frameAncestors: null }),
    accounts: Object.freeze({
      enabled: false,
      allowRegistration: true,
      sessionTtlDays: 30,
      maxAuthAttemptsPerMinute: 30,
      showOtherUsersChats: false,
      perUserWorkspace: false,
      retention: Object.freeze({
        pruneVanishedSessions: true,
        ownershipGraceHours: 24,
        sweepIntervalMinutes: 60,
      }),
      profile: Object.freeze({
        enabled: true,
        inject: true,
        identities: Object.freeze([]),
        instructionsMaxLength: QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX,
      }),
      starters: Object.freeze({
        enabled: true,
      }),
      skills: Object.freeze({
        // Off, not because of an operator choice but because the canonical
        // default deployment has no accounts and no per-account directory:
        // `resolveAccounts` turns the intent back on wherever one exists.
        enabled: false,
        relativeRoot: QA_SKILL_DEFAULT_RELATIVE_ROOT,
        watch: true,
        maxSkillBytes: QA_SKILL_FILE_MAX_BYTES,
        allowResourceEditing: false,
      }),
    }),
    entry: Object.freeze({
      redirectNonLoopback: true,
      cookieBootstrap: true,
    }),
    tools: Object.freeze({
      dynamicActivation: true,
      activationSkill: "qa-surface",
      activationMode: "all" as const,
      activationPresets: Object.freeze([]),
    }),
    sources: Object.freeze({
      enabled: true,
      retention: Object.freeze({ ...DEFAULT_QA_PROVENANCE_RETENTION }),
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
        validateReportedSources: true,
      }),
      legacy: Object.freeze({ parseAssistantSourcesBlock: false }),
    }),
    attachments: Object.freeze({
      textFiles: true,
      pastedTextLines: 200,
      maxFileBytes: 10_485_760,
      maxPending: 8,
      extensions: DEFAULT_QA_TEXT_EXTENSIONS,
    }),
  },
);
