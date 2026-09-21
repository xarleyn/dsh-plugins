import { resolveConfig } from "../../src/config.js";
import { WeblateProvider } from "../../src/providers/weblate/index.js";
import { INSTANCES, TOKEN } from "./shared.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

describeProviderConformance({
  provider: "weblate",
  operation: "projects.list",
  answer: { count: 0, next: null, previous: null, results: [] },
  method: "GET",
  secret: TOKEN,
  carrier: { kind: "header", name: "authorization", value: `Token ${TOKEN}` },
  statuses: [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    // A read this Weblate release does not offer is a missing endpoint.
    [405, "ResourceNotFound"],
    [422, "InvalidRequest"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 3, code: "RateLimited" },
  build: ({ fetcher, retries, maxResponseBytes }) => {
    const provider = new WeblateProvider(
      resolveConfig({
        maxResponseBytes,
        weblate: { instances: INSTANCES, retries },
      }),
      fetcher,
    );
    const credential = provider.parseCredential(TOKEN, {
      instanceId: "main",
    }).credential;
    return () => provider.execute({ credential }, "projects.list", {});
  },
});
