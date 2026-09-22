import { readFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
import {
  QA_MAX_FILE_BYTES_MAX,
  QA_MAX_FILE_BYTES_MIN,
  QA_MAX_PENDING_MAX,
  QA_MAX_PENDING_MIN,
  QA_PASTED_TEXT_LINES_MAX,
  QA_PASTED_TEXT_LINES_MIN,
} from "./attachment-rules.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./resolve-config.js";
import { QA_PROVENANCE_RETENTION_LIMITS } from "./provenance/retention.js";
import {
  QA_PROFILE_INSTRUCTIONS_MAX_MAX,
  QA_PROFILE_INSTRUCTIONS_MAX_MIN,
} from "./profile.js";
import {
  QA_SKILL_ENABLED_BY_DEFAULT,
  QA_SKILL_MAX_BYTES_MAX,
  QA_SKILL_MAX_BYTES_MIN,
} from "./personal-skills/skill-format.js";
import {
  QA_SLASH_MAX_VISIBLE_MAX,
  QA_SLASH_MAX_VISIBLE_MIN,
} from "./config-resolvers/slash-commands.js";
import type { QaSurfaceConfig } from "./types.js";

// Every schema default derives from the canonical resolved defaults: the Host
// feeds the schema-parsed config into resolveConfig, so a default that exists
// only here would reach the resolver as an explicit value (and, for
// ui.showReset, trip the lockdown cross-check on untouched deployments).
const D = DEFAULT_QA_SURFACE_CONFIG;
// Node-free on purpose: this schema reaches the browser bundle.

/**
 * Version this build reports to the integration API's health endpoint.
 *
 * Read from the package manifest rather than written as a constant, so a
 * release bump cannot drift away from it. Resolved on first use so importing
 * the module never touches the filesystem, and this module is the right home
 * for it: it is bundled one level under the package root, which is the depth
 * `../package.json` resolves at.
 */
export function qaSurfaceVersion(): string {
  cachedVersion ??= readManifestVersion() ?? "0.0.0";
  return cachedVersion;
}

let cachedVersion: string | undefined;

function readManifestVersion(): string | undefined {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    const version = (manifest as { version?: unknown }).version;
    return typeof version === "string" && version.trim() !== ""
      ? version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

const nullableString = z.union([z.string(), z.const(null)]);

const configSchema = z.object({
  enabled: z.boolean().default(D.enabled),
  route: z
    .object({
      path: z.string().default(D.route.path),
      matchChildren: z.boolean().default(D.route.matchChildren),
    })
    .default({ ...D.route }),
  branding: z
    .object({
      title: z.string().default(D.branding.title),
      subtitle: z.string().default(D.branding.subtitle),
      welcomeMessage: z.string().default(D.branding.welcomeMessage),
      placeholder: z.string().default(D.branding.placeholder),
      logoUrl: nullableString.default(D.branding.logoUrl),
      disclaimer: nullableString.default(D.branding.disclaimer),
    })
    .default({ ...D.branding }),
  session: z
    .object({
      policy: z
        .union(["browser-persistent", "new-on-load", "fixed"] as const)
        .default(D.session.policy),
      storageKey: z.string().default(D.session.storageKey),
      cwd: nullableString.default(D.session.cwd),
      workspaceId: nullableString.default(D.session.workspaceId),
      fixedSessionId: nullableString.default(D.session.fixedSessionId),
      agentPreset: nullableString.default(D.session.agentPreset),
      provider: nullableString.default(D.session.provider),
      model: nullableString.default(D.session.model),
      reasoningEffort: nullableString.default(D.session.reasoningEffort),
    })
    .default({ ...D.session }),
  ui: z
    .object({
      showHeader: z.boolean().default(D.ui.showHeader),
      showReset: z.boolean().default(D.ui.showReset),
      showStop: z.boolean().default(D.ui.showStop),
      showTimestamps: z.boolean().default(D.ui.showTimestamps),
      showToolActivity: z.boolean().default(D.ui.showToolActivity),
      showReasoning: z.boolean().default(D.ui.showReasoning),
      renderMarkdown: z.boolean().default(D.ui.renderMarkdown),
      minContentWidth: z
        .number()
        .step(1)
        .min(480)
        .max(1600)
        .default(D.ui.minContentWidth),
      showSessionList: z.boolean().default(D.ui.showSessionList),
      subagentCodenames: z.boolean().default(D.ui.subagentCodenames),
    })
    .default({ ...D.ui }),
  suggestedQuestions: z.array(z.string()).default([...D.suggestedQuestions]),
  thinkingPhrases: z.array(z.string()).default([...D.thinkingPhrases]),
  interaction: z
    .object({
      approvals: z
        .union(["blocked", "interactive"] as const)
        .default(D.interaction.approvals),
      questions: z
        // `enabled` is the synonym of `interactive` a feature request asked
        // for; the resolver folds it into the one name the config carries.
        .union(["unsupported", "interactive", "enabled"] as const)
        .default(D.interaction.questions),
    })
    .default({ ...D.interaction }),
  lockdown: z
    .object({
      enabled: z.boolean().default(D.lockdown.enabled),
      enforceFixedAgentPreset: z
        .boolean()
        .default(D.lockdown.enforceFixedAgentPreset),
      enforceFixedWorkspace: z
        .boolean()
        .default(D.lockdown.enforceFixedWorkspace),
      enforceFixedModel: z.boolean().default(D.lockdown.enforceFixedModel),
      sandboxMode: z
        .union(["read-only", "workspace-write"] as const)
        .default(D.lockdown.sandboxMode),
      approvalPolicy: z
        .union(["never"] as const)
        .default(D.lockdown.approvalPolicy),
      permissionPreset: z.string().default(D.lockdown.permissionPreset),
      allowPermissionChanges: z
        .const(false)
        .default(D.lockdown.allowPermissionChanges),
      allowSlashCommands: z.boolean().default(D.lockdown.allowSlashCommands),
      allowSettingsMutation: z
        .const(false)
        .default(D.lockdown.allowSettingsMutation),
      allowSessionReset: z.boolean().default(D.lockdown.allowSessionReset),
      allowSessionRename: z.const(false).default(D.lockdown.allowSessionRename),
      allowSessionDelete: z.const(false).default(D.lockdown.allowSessionDelete),
      allowArbitrarySessionOpen: z
        .const(false)
        .default(D.lockdown.allowArbitrarySessionOpen),
      toolPolicy: z
        .object({
          mode: z
            .union(["allow-list"] as const)
            .default(D.lockdown.toolPolicy.mode),
          allow: z.array(z.string()).default([...D.lockdown.toolPolicy.allow]),
        })
        .default({
          mode: D.lockdown.toolPolicy.mode,
          allow: [...D.lockdown.toolPolicy.allow],
        }),
      sharedReadOnlyRoots: z
        .array(z.string())
        .default([...D.lockdown.sharedReadOnlyRoots]),
    })
    .default({
      ...D.lockdown,
      toolPolicy: {
        mode: D.lockdown.toolPolicy.mode,
        allow: [...D.lockdown.toolPolicy.allow],
      },
      sharedReadOnlyRoots: [...D.lockdown.sharedReadOnlyRoots],
    }),
  slashCommands: z
    .object({
      skills: z
        .object({
          mode: z
            .union(["deny-all", "allow-list", "all"] as const)
            .default(D.slashCommands.skills.mode),
          allow: z.array(z.string()).default([...D.slashCommands.skills.allow]),
        })
        .default({
          mode: D.slashCommands.skills.mode,
          allow: [...D.slashCommands.skills.allow],
        }),
      commands: z
        .object({
          mode: z
            .union(["deny-all", "allow-list", "all"] as const)
            .default(D.slashCommands.commands.mode),
          allow: z
            .array(z.string())
            .default([...D.slashCommands.commands.allow]),
        })
        .default({
          mode: D.slashCommands.commands.mode,
          allow: [...D.slashCommands.commands.allow],
        }),
      palette: z
        .object({
          enabled: z.boolean().default(D.slashCommands.palette.enabled),
          fuzzySearch: z.boolean().default(D.slashCommands.palette.fuzzySearch),
          maxVisible: z
            .number()
            .step(1)
            .min(QA_SLASH_MAX_VISIBLE_MIN)
            .max(QA_SLASH_MAX_VISIBLE_MAX)
            .default(D.slashCommands.palette.maxVisible),
          showDescriptions: z
            .boolean()
            .default(D.slashCommands.palette.showDescriptions),
          showKindBadge: z
            .boolean()
            .default(D.slashCommands.palette.showKindBadge),
        })
        .default({ ...D.slashCommands.palette }),
    })
    .default({
      skills: {
        mode: D.slashCommands.skills.mode,
        allow: [...D.slashCommands.skills.allow],
      },
      commands: {
        mode: D.slashCommands.commands.mode,
        allow: [...D.slashCommands.commands.allow],
      },
      palette: { ...D.slashCommands.palette },
    }),
  embedding: z
    .object({
      frameAncestors: nullableString.default(D.embedding.frameAncestors),
    })
    .default({ ...D.embedding }),
  accounts: z
    .object({
      enabled: z.boolean().default(D.accounts.enabled),
      allowRegistration: z.boolean().default(D.accounts.allowRegistration),
      retention: z
        .object({
          pruneVanishedSessions: z
            .boolean()
            .default(D.accounts.retention.pruneVanishedSessions),
          ownershipGraceHours: z
            .number()
            .step(1)
            .min(1)
            .max(8_760)
            .default(D.accounts.retention.ownershipGraceHours),
          sweepIntervalMinutes: z
            .number()
            .step(1)
            .min(1)
            .max(1_440)
            .default(D.accounts.retention.sweepIntervalMinutes),
        })
        .default({ ...D.accounts.retention }),
      sessionTtlDays: z
        .number()
        .step(1)
        .min(1)
        .max(365)
        .default(D.accounts.sessionTtlDays),
      maxAuthAttemptsPerMinute: z
        .number()
        .step(1)
        .min(1)
        .max(600)
        .default(D.accounts.maxAuthAttemptsPerMinute),
      showOtherUsersChats: z.boolean().default(D.accounts.showOtherUsersChats),
      perUserWorkspace: z.boolean().default(D.accounts.perUserWorkspace),
      profile: z
        .object({
          enabled: z.boolean().default(D.accounts.profile.enabled),
          inject: z.boolean().default(D.accounts.profile.inject),
          identities: z
            .array(
              z.object({
                key: z.string().required(),
                label: z.string(),
              }),
            )
            .default([]),
          instructionsMaxLength: z
            .number()
            .step(1)
            .min(QA_PROFILE_INSTRUCTIONS_MAX_MIN)
            .max(QA_PROFILE_INSTRUCTIONS_MAX_MAX)
            .default(D.accounts.profile.instructionsMaxLength),
        })
        .default({
          ...D.accounts.profile,
          identities: [...D.accounts.profile.identities],
        }),
      starters: z
        .object({
          enabled: z.boolean().default(D.accounts.starters.enabled),
        })
        .default({ ...D.accounts.starters }),
      skills: z
        .object({
          enabled: z.boolean().default(QA_SKILL_ENABLED_BY_DEFAULT),
          relativeRoot: z.string().default(D.accounts.skills.relativeRoot),
          watch: z.boolean().default(D.accounts.skills.watch),
          maxSkillBytes: z
            .number()
            .step(1)
            .min(QA_SKILL_MAX_BYTES_MIN)
            .max(QA_SKILL_MAX_BYTES_MAX)
            .default(D.accounts.skills.maxSkillBytes),
          allowResourceEditing: z
            .boolean()
            .default(D.accounts.skills.allowResourceEditing),
        })
        .default({
          ...D.accounts.skills,
          enabled: QA_SKILL_ENABLED_BY_DEFAULT,
        }),
    })
    .default({
      ...D.accounts,
      retention: { ...D.accounts.retention },
      profile: {
        ...D.accounts.profile,
        identities: [...D.accounts.profile.identities],
      },
      starters: { ...D.accounts.starters },
      skills: { ...D.accounts.skills, enabled: QA_SKILL_ENABLED_BY_DEFAULT },
    }),
  entry: z
    .object({
      redirectNonLoopback: z.boolean().default(D.entry.redirectNonLoopback),
      cookieBootstrap: z.boolean().default(D.entry.cookieBootstrap),
    })
    .default({ ...D.entry }),
  tools: z
    .object({
      dynamicActivation: z.boolean().default(D.tools.dynamicActivation),
      activationSkill: z.string().default(D.tools.activationSkill),
      activationMode: z.union(["all"] as const).default(D.tools.activationMode),
      activationPresets: z
        .array(z.string())
        .default([...D.tools.activationPresets]),
      /**
       * Absolute path of the documentation tree `docs_search`/`docs_read` read,
       * for a deployment that publishes the corpus once instead of inside every
       * chat workspace. Empty keeps the per-chat `docs/` layout.
       */
      docsRoot: z.string().default(D.tools.docsRoot),
      /**
       * Version `docs_search` stays inside when the caller named neither
       * `version` nor `path`. The stand documents several editions of the same
       * module, and a chat that has to be told which one it means answers out
       * of the wrong one; naming the edition here lets a search default to it.
       */
      docsDefaultVersion: z.string().default(D.tools.docsDefaultVersion),
      /**
       * Whether that default is applied. Kept beside the version so a
       * deployment can keep the value and stop acting on it — and so the
       * settings card can show which of the two a stand is running on.
       */
      docsDefaultVersionEnabled: z
        .boolean()
        .default(D.tools.docsDefaultVersionEnabled),
    })
    .default({ ...D.tools, activationPresets: [...D.tools.activationPresets] }),
  sources: z
    .object({
      enabled: z.boolean().default(D.sources.enabled),
      retention: z
        .object({
          maxTurnsPerSession: z
            .number()
            .step(1)
            .min(QA_PROVENANCE_RETENTION_LIMITS.maxTurnsPerSession.min)
            .max(QA_PROVENANCE_RETENTION_LIMITS.maxTurnsPerSession.max)
            .default(D.sources.retention.maxTurnsPerSession),
          maxSessions: z
            .number()
            .step(1)
            .min(QA_PROVENANCE_RETENTION_LIMITS.maxSessions.min)
            .max(QA_PROVENANCE_RETENTION_LIMITS.maxSessions.max)
            .default(D.sources.retention.maxSessions),
          maxAgeDays: z
            .number()
            .step(1)
            .min(QA_PROVENANCE_RETENTION_LIMITS.maxAgeDays.min)
            .max(QA_PROVENANCE_RETENTION_LIMITS.maxAgeDays.max)
            .default(D.sources.retention.maxAgeDays),
          sweepIntervalMinutes: z
            .number()
            .step(1)
            .min(QA_PROVENANCE_RETENTION_LIMITS.sweepIntervalMinutes.min)
            .max(QA_PROVENANCE_RETENTION_LIMITS.sweepIntervalMinutes.max)
            .default(D.sources.retention.sweepIntervalMinutes),
        })
        .default({ ...D.sources.retention }),
      collect: z
        .object({
          parentAgent: z.boolean().default(D.sources.collect.parentAgent),
          subagents: z.boolean().default(D.sources.collect.subagents),
          persistTurnEvent: z
            .boolean()
            .default(D.sources.collect.persistTurnEvent),
        })
        .default({ ...D.sources.collect }),
      display: z
        .object({
          sidebar: z.boolean().default(D.sources.display.sidebar),
          footer: z.boolean().default(D.sources.display.footer),
          groupByKind: z.boolean().default(D.sources.display.groupByKind),
          showDiscovered: z.boolean().default(D.sources.display.showDiscovered),
          showOriginBadges: z
            .boolean()
            .default(D.sources.display.showOriginBadges),
          maxInitiallyVisiblePerGroup: z
            .number()
            .step(1)
            .min(1)
            .max(100)
            .default(D.sources.display.maxInitiallyVisiblePerGroup),
        })
        .default({ ...D.sources.display }),
      webSearch: z
        .object({
          promoteSearchResultsWithoutFetch: z
            .boolean()
            .default(D.sources.webSearch.promoteSearchResultsWithoutFetch),
          maxPromotedPerSearch: z
            .number()
            .step(1)
            .min(0)
            .max(50)
            .default(D.sources.webSearch.maxPromotedPerSearch),
        })
        .default({ ...D.sources.webSearch }),
      dedupe: z
        .object({
          normalizeUrls: z.boolean().default(D.sources.dedupe.normalizeUrls),
          stripTrackingParams: z
            .boolean()
            .default(D.sources.dedupe.stripTrackingParams),
          mergeFileRanges: z
            .boolean()
            .default(D.sources.dedupe.mergeFileRanges),
        })
        .default({ ...D.sources.dedupe }),
      filePreview: z
        .object({
          enabled: z.boolean().default(D.sources.filePreview.enabled),
          markdownRenderedByDefault: z
            .boolean()
            .default(D.sources.filePreview.markdownRenderedByDefault),
          allowRawToggle: z
            .boolean()
            .default(D.sources.filePreview.allowRawToggle),
          maxBytes: z
            .number()
            .step(1)
            .min(1024)
            .max(20_000_000)
            .default(D.sources.filePreview.maxBytes),
          maxMarkdownRenderBytes: z
            .number()
            .step(1)
            .min(1024)
            .max(10_000_000)
            .default(D.sources.filePreview.maxMarkdownRenderBytes),
          maxListingEntries: z
            .number()
            .step(1)
            .min(10)
            .max(5000)
            .default(D.sources.filePreview.maxListingEntries),
        })
        .default({ ...D.sources.filePreview }),
      subagents: z
        .object({
          inheritSources: z
            .boolean()
            .default(D.sources.subagents.inheritSources),
          enableReportToolFallback: z
            .boolean()
            .default(D.sources.subagents.enableReportToolFallback),
          markIncompleteOpaqueRuns: z
            .boolean()
            .default(D.sources.subagents.markIncompleteOpaqueRuns),
          validateReportedSources: z
            .boolean()
            .default(D.sources.subagents.validateReportedSources),
        })
        .default({ ...D.sources.subagents }),
      legacy: z
        .object({
          parseAssistantSourcesBlock: z
            .boolean()
            .default(D.sources.legacy.parseAssistantSourcesBlock),
        })
        .default({ ...D.sources.legacy }),
    })
    .default({
      ...D.sources,
      retention: { ...D.sources.retention },
      collect: { ...D.sources.collect },
      display: { ...D.sources.display },
      webSearch: { ...D.sources.webSearch },
      dedupe: { ...D.sources.dedupe },
      filePreview: { ...D.sources.filePreview },
      subagents: { ...D.sources.subagents },
      legacy: { ...D.sources.legacy },
    }),
  attachments: z
    .object({
      textFiles: z.boolean().default(D.attachments.textFiles),
      pastedTextLines: z
        .number()
        .step(1)
        .min(QA_PASTED_TEXT_LINES_MIN)
        .max(QA_PASTED_TEXT_LINES_MAX)
        .default(D.attachments.pastedTextLines),
      maxFileBytes: z
        .number()
        .step(1)
        .min(QA_MAX_FILE_BYTES_MIN)
        .max(QA_MAX_FILE_BYTES_MAX)
        .default(D.attachments.maxFileBytes),
      maxPending: z
        .number()
        .step(1)
        .min(QA_MAX_PENDING_MIN)
        .max(QA_MAX_PENDING_MAX)
        .default(D.attachments.maxPending),
      // Free-form here: the resolver normalizes (lowercase, leading dots
      // stripped) and drops malformed entries, so a schema-level union would
      // only duplicate that rule.
      extensions: z.array(z.string()).default([...D.attachments.extensions]),
    })
    .default({
      ...D.attachments,
      extensions: [...D.attachments.extensions],
    }),
  notes: z
    .object({
      identity: z
        .object({
          enabled: z.boolean().default(D.notes.identity.enabled),
          template: z.string().default(D.notes.identity.template),
        })
        .default({ ...D.notes.identity }),
      sources: z
        .object({
          enabled: z.boolean().default(D.notes.sources.enabled),
          template: z.string().default(D.notes.sources.template),
          fallbackTemplate: z
            .string()
            .default(D.notes.sources.fallbackTemplate),
        })
        .default({ ...D.notes.sources }),
      delegation: z
        .object({
          enabled: z.boolean().default(D.notes.delegation.enabled),
          template: z.string().default(D.notes.delegation.template),
        })
        .default({ ...D.notes.delegation }),
      documents: z
        .object({
          enabled: z.boolean().default(D.notes.documents.enabled),
          template: z.string().default(D.notes.documents.template),
        })
        .default({ ...D.notes.documents }),
      sourcePriority: z
        .object({
          enabled: z.boolean().default(D.notes.sourcePriority.enabled),
          template: z.string().default(D.notes.sourcePriority.template),
        })
        .default({ ...D.notes.sourcePriority }),
    })
    .default({
      identity: { ...D.notes.identity },
      sources: { ...D.notes.sources },
      delegation: { ...D.notes.delegation },
      documents: { ...D.notes.documents },
      sourcePriority: { ...D.notes.sourcePriority },
    }),
  // The numeric fields are declared without schema-level bounds on purpose:
  // the resolver owns the range checks and their error messages, and a second
  // copy here would report a different one for the same mistake.
  integration: z
    .object({
      enabled: z.boolean().default(D.integration.enabled),
      basePath: z.string().default(D.integration.basePath),
      tokenTtlDays: z.number().step(1).default(D.integration.tokenTtlDays),
      requestTimeoutMs: z
        .number()
        .step(1)
        .default(D.integration.requestTimeoutMs),
      maxConcurrent: z.number().step(1).default(D.integration.maxConcurrent),
      requestsPerMinute: z
        .number()
        .step(1)
        .default(D.integration.requestsPerMinute),
      maxRequestBytes: z
        .number()
        .step(1)
        .default(D.integration.maxRequestBytes),
      maxAttachmentBytes: z
        .number()
        .step(1)
        .default(D.integration.maxAttachmentBytes),
      maxAnswerCharacters: z
        .number()
        .step(1)
        .default(D.integration.maxAnswerCharacters),
    })
    .default({ ...D.integration }),
});

export const ConfigSchema = configSchema as unknown as z<QaSurfaceConfig>;
export {
  DEFAULT_QA_SURFACE_CONFIG,
  normalizeRoutePath,
  resolveConfig,
} from "./resolve-config.js";
