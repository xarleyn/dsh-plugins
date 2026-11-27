import { describeProviderConformance } from "../helpers/provider-conformance.helpers.js";
import DirectusProvider from "../../src/providers/directus/index.js";

const TOKEN = "fake-directus-token";

describeProviderConformance({
  provider: "directus",
  operation: "items.list",
  answer: { data: [] },
  method: "GET",
  secret: TOKEN,
  carrier: { kind: "header", name: "authorization", value: `Bearer ${TOKEN}` },
  statuses: [
    [302, "CredentialRevoked"],
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 1, code: "RateLimited" },
  build: ({ fetcher, maxResponseBytes, timeoutMs }) => {
    const provider = new DirectusProvider(
      {
        id: "demo",
        label: "Demo",
        baseUrl: "https://directus.example.com/demo",
        collections: [
          { name: "demo_records", primaryKey: "id", fields: ["id"] },
        ],
      },
      { maxResponseBytes, timeoutMs },
      fetcher,
    );
    const { credential } = provider.parseCredential(TOKEN);
    return () =>
      provider.execute({ credential }, "items.list", {
        collection: "demo_records",
      });
  },
});
