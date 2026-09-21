import { resolveConfig } from "../../src/config.js";
import { GitlabProvider } from "../../src/providers/gitlab/index.js";
import { GITLAB_COM, INSTANCES, TOKEN } from "./shared.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

describeProviderConformance({
  provider: "gitlab",
  operation: "projects.get",
  answer: { id: 1, path_with_namespace: "demo/one" },
  method: "GET",
  secret: TOKEN,
  carrier: { kind: "header", name: "private-token", value: TOKEN },
  statuses: [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [500, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 3, code: "RateLimited" },
  build: ({ fetcher, retries, maxResponseBytes }) => {
    const provider = new GitlabProvider(
      resolveConfig({
        maxResponseBytes,
        gitlab: { instances: INSTANCES, retries },
      }),
      fetcher,
    );
    const credential = provider.parseCredential(TOKEN, {
      instanceId: GITLAB_COM.id,
    }).credential;
    return () =>
      provider.execute({ credential }, "projects.get", { project: 1 });
  },
});
