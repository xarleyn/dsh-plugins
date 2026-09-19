import { resolveConfig } from "../src/config.js";
import { JiraProvider } from "../src/providers/jira/index.js";
import type {
  ServiceCredentialProfile,
  ServiceResourceBoundary,
} from "../src/service-credentials/types.js";
import { COMPANY, EMAIL, TOKEN, stub, type StubResult } from "./jira/shared.js";

export { COMPANY, EMAIL, TOKEN, stub };
export type { StubResult };

/**
 * The projects the deployment's allowlist names: the project key every
 * operation addresses a project by, plus one numeric id as Jira reports it on
 * a search hit.
 */
export const BOUNDARY = Object.freeze({
  projects: Object.freeze(["PROJ", "10001"]),
});

export function config() {
  return resolveConfig({ jira: { sites: [COMPANY] } });
}

export function credential(fetcher: typeof fetch) {
  return {
    provider: new JiraProvider(config(), fetcher),
    plaintext: JSON.stringify({
      siteId: COMPANY.id,
      email: EMAIL,
      token: TOKEN,
    }),
  };
}

/** A service call: the broker hands the provider a boundary and the mode. */
export function serviceContext(boundary: ServiceResourceBoundary = BOUNDARY) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

export function profile(): ServiceCredentialProfile {
  return {
    id: "jira-company-readonly",
    provider: "jira",
    instance: COMPANY.id,
    portal: COMPANY.baseUrl,
    label: "QA Jira Read-only",
    authType: "api-token",
    secretRef: "env:QA_JIRA_SERVICE_TOKEN",
    enabled: true,
    resources: BOUNDARY,
    policy: {},
    policyRevision: "rev",
  };
}
