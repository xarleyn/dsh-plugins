import { resolveConfig } from "../../src/config.js";
import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import { NETWORK, SERVER, TOKEN } from "./shared.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

describeProviderConformance({
  provider: "teamcity",
  operation: "builds.list",
  answer: { count: 0, build: [] },
  method: "GET",
  secret: TOKEN,
  carrier: { kind: "header", name: "authorization", value: `Bearer ${TOKEN}` },
  statuses: [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 3, code: "RateLimited" },
  build: ({ fetcher, retries, maxResponseBytes }) => {
    const provider = new TeamcityProvider(
      resolveConfig({
        maxResponseBytes,
        teamcity: { network: NETWORK, serverUrl: SERVER, retries },
      }),
      fetcher,
    );
    const credential = provider.parseCredential(TOKEN).credential;
    return () => provider.execute({ credential }, "builds.list", { limit: 10 });
  },
});
