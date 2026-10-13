import {
  BITRIX_OPERATIONS,
  BITRIX24_CAPABILITY_INFO,
} from "../providers/bitrix24/catalog.js";
import {
  CONFLUENCE_OPERATIONS,
  CONFLUENCE_CAPABILITY_INFO,
} from "../providers/confluence/catalog.js";
import {
  GITLAB_OPERATIONS,
  GITLAB_CAPABILITY_INFO,
} from "../providers/gitlab/catalog.js";
import {
  JIRA_OPERATIONS,
  JIRA_CAPABILITY_INFO,
} from "../providers/jira/catalog.js";
import {
  TEAMCITY_OPERATIONS,
  TEAMCITY_CAPABILITY_INFO,
} from "../providers/teamcity/catalog.js";
import {
  TESTIT_OPERATIONS,
  TESTIT_CAPABILITY_INFO,
} from "../providers/testit/catalog.js";
import {
  WEBLATE_OPERATIONS,
  WEBLATE_CAPABILITY_INFO,
} from "../providers/weblate/catalog.js";
import type { OperationSecurityMetadata } from "./types.js";
import type { ServicePolicyOperation } from "../types.js";

function entries(
  operations: Readonly<
    Record<
      string,
      {
        readonly capability: string;
        readonly security: OperationSecurityMetadata;
      }
    >
  >,
  info: Readonly<Record<string, { readonly label: string }>>,
): readonly ServicePolicyOperation[] {
  return Object.entries(operations).map(([operation, definition]) => ({
    operation,
    capability: definition.capability,
    security: definition.security,
    label: info[definition.capability]?.label ?? definition.capability,
  }));
}

/** The editor and execution gates use the same provider operation catalogs. */
export const SERVICE_POLICY_OPERATIONS: Readonly<
  Record<string, readonly ServicePolicyOperation[]>
> = {
  bitrix24: entries(BITRIX_OPERATIONS, BITRIX24_CAPABILITY_INFO),
  confluence: entries(CONFLUENCE_OPERATIONS, CONFLUENCE_CAPABILITY_INFO),
  gitlab: entries(GITLAB_OPERATIONS, GITLAB_CAPABILITY_INFO),
  jira: entries(JIRA_OPERATIONS, JIRA_CAPABILITY_INFO),
  teamcity: entries(TEAMCITY_OPERATIONS, TEAMCITY_CAPABILITY_INFO),
  testit: entries(TESTIT_OPERATIONS, TESTIT_CAPABILITY_INFO),
  weblate: entries(WEBLATE_OPERATIONS, WEBLATE_CAPABILITY_INFO),
};
