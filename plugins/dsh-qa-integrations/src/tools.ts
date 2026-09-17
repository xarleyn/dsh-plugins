import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { IntegrationBroker } from "./broker.js";
import type { IntegrationPrincipal } from "./types.js";
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
}

/**
 * Model-facing tool names of every enabled provider, in registration order. The
 * QA surface admits exactly these names as principal-scoped, so this list is the
 * single place where the tool surface is declared.
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

/**
 * The names to admit and mount for one deployment: the read-only catalog plus,
 * only when the operator switched it on, the Bitrix24 timeline comment. The
 * mount and the admission list must always be derived through this function so
 * the two cannot drift apart.
 */
export function integrationToolNames(
  options: Pick<IntegrationToolOptions, "bitrix24CrmCommentWrite"> = {},
): readonly string[] {
  if (options.bitrix24CrmCommentWrite !== true) return INTEGRATION_TOOL_NAMES;
  // The mounted list carries the comment tool at the end of the Bitrix24
  // block, where the provider module mounts it.
  const names: string[] = [...INTEGRATION_TOOL_NAMES];
  names.splice(BITRIX24_TOOL_NAMES.length, 0, BITRIX24_COMMENT_TOOL_NAME);
  return names;
}

/** Provider tool modules, composed into one registration list. */
export function createIntegrationTools(
  options: IntegrationToolOptions,
): readonly ToolDefinition[] {
  return [
    ...createBitrix24Tools({
      broker: options.broker,
      principalForSession: options.principalForSession,
      crmCommentWrite: options.bitrix24CrmCommentWrite === true,
    }),
    ...createConfluenceTools(options),
    ...createGitlabTools(options),
    ...createTeamcityTools(options),
    ...createJiraTools(options),
    ...createTestitTools(options),
    ...createWeblateTools(options),
  ];
}
