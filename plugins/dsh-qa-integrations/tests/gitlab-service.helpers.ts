import { resolveConfig } from "../src/config.js";
import { GitlabProvider } from "../src/providers/gitlab/index.js";
import type {
  ServiceCredentialProfile,
  ServiceResourceBoundary,
} from "../src/service-credentials/types.js";
export const TOKEN = "glpat-abcdefghij0123456789";

export const CORP = {
  id: "corp",
  label: "Corporate GitLab",
  baseUrl: "https://gitlab.example.internal",
};

export const BOUNDARY = Object.freeze({
  projects: Object.freeze(["1208", "group/product"]),
  groups: Object.freeze(["group/platform"]),
});

export function config() {
  return resolveConfig({ gitlab: { instances: [CORP] } });
}

export interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
}

export function stub(handler: (url: URL) => StubResult) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = handler(url);
    return new Response(JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

export function credential(fetcher: typeof fetch) {
  return {
    provider: new GitlabProvider(config(), fetcher),
    plaintext: JSON.stringify({ instanceId: "corp", token: TOKEN }),
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
    id: "gitlab-corp-readonly",
    provider: "gitlab",
    instance: "corp",
    portal: CORP.baseUrl,
    label: "QA GitLab Read-only",
    authType: "pat",
    secretRef: "env:QA_GITLAB_SERVICE_TOKEN",
    enabled: true,
    resources: BOUNDARY,
    policy: {},
    policyRevision: "rev",
  };
}
