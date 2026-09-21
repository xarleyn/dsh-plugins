import { resolveConfig } from "../../src/config.js";
import { TestitProvider } from "../../src/providers/testit/index.js";
import { INSTANCE, TOKEN } from "./shared.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

describeProviderConformance({
  provider: "testit",
  operation: "projects.list",
  answer: [{ id: "11111111-1111-1111-1111-111111111111", name: "Mobile" }],
  method: "GET",
  secret: TOKEN,
  carrier: {
    kind: "header",
    name: "authorization",
    value: `PrivateToken ${TOKEN}`,
  },
  statuses: [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [409, "InvalidRequest"],
    [413, "ResultTooLarge"],
    [422, "InvalidRequest"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
    [503, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 3, code: "RateLimited" },
  build: ({ fetcher, retries, maxResponseBytes }) => {
    const provider = new TestitProvider(
      resolveConfig({
        maxResponseBytes,
        testit: { instances: [{ ...INSTANCE }], retries },
      }),
      fetcher,
    );
    const credential = provider.parseCredential(TOKEN, {
      instanceId: INSTANCE.id,
    }).credential;
    return () => provider.execute({ credential }, "projects.list", {});
  },
});
