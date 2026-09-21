import { resolveConfig } from "../../src/config.js";
import { Bitrix24Provider } from "../../src/providers/bitrix24/index.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

const WEBHOOK = "https://company.bitrix24.ru/rest/42/abcdefghijk";

describeProviderConformance({
  provider: "bitrix24",
  operation: "crm.get",
  answer: { result: { ID: "7" } },
  method: "POST",
  secret: "abcdefghijk",
  // The credential *is* the webhook address, so the secret lives in the target
  // and must stay out of every header and out of the body.
  carrier: { kind: "url", value: "abcdefghijk" },
  statuses: [
    [401, "ProviderPermissionDenied"],
    [403, "ProviderPermissionDenied"],
    [429, "ProviderUnavailable"],
    [500, "ProviderUnavailable"],
  ],
  // One attempt on purpose: this transport also carries the one write the
  // plugin offers, and a silently repeated write is worse than a failure.
  transient: { status: 429, attempts: 1, code: "ProviderUnavailable" },
  build: ({ fetcher, maxResponseBytes }) => {
    const provider = new Bitrix24Provider(
      resolveConfig({ maxResponseBytes }),
      fetcher,
    );
    const credential = JSON.stringify({ webhookBaseUrl: WEBHOOK });
    return () =>
      provider.execute({ credential }, "crm.get", {
        entityTypeId: 2,
        id: 9,
      });
  },
});
