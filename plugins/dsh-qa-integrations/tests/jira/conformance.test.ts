import { resolveConfig } from "../../src/config.js";
import { JiraProvider } from "../../src/providers/jira/index.js";
import { COMPANY, EMAIL, SITES, TOKEN } from "./shared.js";
import { describeProviderConformance } from "../provider-conformance.helpers.js";

const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64");

describeProviderConformance({
  provider: "jira",
  operation: "issues.get",
  answer: { id: "10001", key: "PROJ-123", fields: { summary: "Login fails" } },
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
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
  ],
  transient: { status: 429, attempts: 3, code: "RateLimited" },
  build: ({ fetcher, retries, maxResponseBytes }) => {
    const provider = new JiraProvider(
      resolveConfig({ maxResponseBytes, jira: { sites: SITES, retries } }),
      fetcher,
    );
    const credential = provider.parseCredential(TOKEN, {
      siteId: COMPANY.id,
      email: EMAIL,
    }).credential;
    return () =>
      provider.execute({ credential }, "issues.get", { issueKey: "PROJ-123" });
  },
});
