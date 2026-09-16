import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { IntegrationBroker } from "./broker.js";
import type { IntegrationPrincipal } from "./types.js";
import {
  createBitrix24Tools,
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

export interface IntegrationToolOptions {
  readonly broker: IntegrationBroker;
  readonly principalForSession: (
    sessionId: string,
  ) => IntegrationPrincipal | undefined;
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
] as const;

/** Provider tool modules, composed into one registration list. */
export function createIntegrationTools(
  options: IntegrationToolOptions,
): readonly ToolDefinition[] {
  return [
    ...createBitrix24Tools(options),
    ...createConfluenceTools(options),
    ...createGitlabTools(options),
    ...createTeamcityTools(options),
    ...createJiraTools(options),
    ...createTestitTools(options),
  ];
}
