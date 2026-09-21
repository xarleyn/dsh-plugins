import { resolveConfig } from "../../src/config.js";
import { ConfluenceProvider } from "../../src/providers/confluence/index.js";
import { COMPANY, EMAIL, SITES, TOKEN } from "./shared.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64");

describeProviderConformance({
  provider: "confluence",
  operation: "connection.get",
  answer: { accountId: "acc-alice" },
  method: "GET",
  secret: TOKEN,
  carrier: {
    kind: "header",
    name: "authorization",
    value: `Basic ${BASIC}`,
  },
  statuses: [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [410, "ProviderUnavailable"],
    [422, "InvalidRequest"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 3, code: "RateLimited" },
  build: ({ fetcher, retries, maxResponseBytes }) => {
    const provider = new ConfluenceProvider(
      resolveConfig({
        maxResponseBytes,
        confluence: { instances: SITES, retries },
      }),
      fetcher,
    );
    const credential = provider.parseCredential(TOKEN, {
      instanceId: COMPANY.id,
      email: EMAIL,
    }).credential;
    return () => provider.execute({ credential }, "connection.get", {});
  },
});
