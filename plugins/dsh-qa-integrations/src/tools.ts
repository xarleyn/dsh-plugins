import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { IntegrationBroker } from "./broker.js";
import type { IntegrationPrincipal, IntegrationProviderId } from "./types.js";
import {
  createBitrix24Tools,
  BITRIX24_COMMENT_TOOL_NAME,
  BITRIX24_TOOL_NAMES,
} from "./providers/bitrix24/tools.js";
import {
  createConfluenceTools,
  CONFLUENCE_TOOL_NAMES,
} from "./providers/confluence/tools.js";
import {
  createGitlabTools,
  GITLAB_TOOL_NAMES,
} from "./providers/gitlab/tools.js";
import { createJiraTools, JIRA_TOOL_NAMES } from "./providers/jira/tools.js";
import {
  createTestitTools,
  TESTIT_TOOL_NAMES,
} from "./providers/testit/tools.js";
import {
  createTeamcityTools,
  TEAMCITY_TOOL_NAMES,
} from "./providers/teamcity/tools.js";
import {
  createWeblateTools,
  WEBLATE_TOOL_NAMES,
} from "./providers/weblate/tools.js";

export interface IntegrationToolOptions {
  readonly broker: IntegrationBroker;
  readonly principalForSession: (
    sessionId: string,
  ) => IntegrationPrincipal | undefined;
  /** Mount the Bitrix24 timeline-comment tool; default stays read-only. */
  readonly bitrix24CrmCommentWrite?: boolean;
  /**
   * Whether this deployment hands out managed service credentials, which is what
   * decides whether a tool warns about the ceiling those credentials meet. Off
   * by default: a stand without a shared token has no ceiling to describe, and a
   * tool that claimed one would talk a model out of a reading its own personal
   * connection answers.
   */
  readonly managedServiceCredentialsEnabled?: boolean;
  /**
   * The providers this deployment actually enables. Absent means every one,
   * which is what a caller that has no configuration to speak of asks for;
   * present means the tools of a provider the operator switched off are neither
   * mounted nor admitted.
   */
  readonly enabledProviders?: readonly IntegrationProviderId[];
}

/**
 * Model-facing tool names of every provider the code knows about, in
 * registration order. The QA surface admits exactly these names as
 * principal-scoped, so this list is the single place where the tool surface is
 * declared; `integrationToolNames` is what narrows it to one deployment.
 */
export const INTEGRATION_TOOL_NAMES = [
  ...BITRIX24_TOOL_NAMES,
  ...CONFLUENCE_TOOL_NAMES,
  ...GITLAB_TOOL_NAMES,
  ...TEAMCITY_TOOL_NAMES,
  ...JIRA_TOOL_NAMES,
  ...TESTIT_TOOL_NAMES,
  ...WEBLATE_TOOL_NAMES,
] as const;

/** The providers in mount order, each with the tool names it contributes. */
const TOOL_NAMES_BY_PROVIDER: readonly (readonly [
  IntegrationProviderId,
  readonly string[],
])[] = [
  ["bitrix24", BITRIX24_TOOL_NAMES],
  ["confluence", CONFLUENCE_TOOL_NAMES],
  ["gitlab", GITLAB_TOOL_NAMES],
  ["teamcity", TEAMCITY_TOOL_NAMES],
  ["jira", JIRA_TOOL_NAMES],
  ["testit", TESTIT_TOOL_NAMES],
  ["weblate", WEBLATE_TOOL_NAMES],
];

export type IntegrationToolNamesOptions = Pick<
  IntegrationToolOptions,
  "bitrix24CrmCommentWrite" | "enabledProviders"
>;

/**
 * The names to admit and mount for one deployment: the read-only catalog of the
 * providers it enables plus, only when the operator switched it on, the Bitrix24
 * timeline comment. The mount and the admission list must always be derived
 * through this function so the two cannot drift apart.
 */
export function integrationToolNames(
  options: IntegrationToolNamesOptions = {},
): readonly string[] {
  const enabled = options.enabledProviders;
  const names: string[] = [];
  for (const [providerId, providerNames] of TOOL_NAMES_BY_PROVIDER) {
    if (enabled !== undefined && !enabled.includes(providerId)) continue;
    names.push(...providerNames);
    // The comment tool rides at the end of the Bitrix24 block, where the
    // provider module mounts it.
    if (providerId === "bitrix24" && options.bitrix24CrmCommentWrite === true) {
      names.push(BITRIX24_COMMENT_TOOL_NAME);
    }
  }
  return names;
}

/** Provider tool modules, composed into one registration list. */
export function createIntegrationTools(
  options: IntegrationToolOptions,
): readonly ToolDefinition[] {
  const enabled = options.enabledProviders;
  const mounted = (providerId: IntegrationProviderId): boolean =>
    enabled === undefined || enabled.includes(providerId);
  const shared = {
    broker: options.broker,
    principalForSession: options.principalForSession,
    managedServiceCredentialsEnabled:
      options.managedServiceCredentialsEnabled === true,
  };
  return [
    ...(mounted("bitrix24")
      ? createBitrix24Tools({
          ...shared,
          crmCommentWrite: options.bitrix24CrmCommentWrite === true,
        })
      : []),
    ...(mounted("confluence") ? createConfluenceTools(shared) : []),
    ...(mounted("gitlab") ? createGitlabTools(shared) : []),
    ...(mounted("teamcity") ? createTeamcityTools(shared) : []),
    ...(mounted("jira") ? createJiraTools(shared) : []),
    ...(mounted("testit") ? createTestitTools(shared) : []),
    ...(mounted("weblate") ? createWeblateTools(shared) : []),
  ];
}
