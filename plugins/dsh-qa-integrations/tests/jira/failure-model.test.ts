import { resolveConfig } from "../../src/config.js";
import { JiraProvider } from "../../src/providers/jira/index.js";
import {
  EMAIL,
  SITES,
  TOKEN,
  cloud,
  credentialFor,
  providerFor,
  stub,
} from "./shared.js";

describe("jira failure model", () => {
  function failing(status: number, headers: Record<string, string> = {}) {
    return stub(() => ({ status, headers, json: { errorMessages: ["nope"] } }));
  }

  async function call(fetcher: typeof fetch) {
    const provider = providerFor(fetcher);
    return provider.execute(
      { credential: credentialFor(provider) },
      "connection.get",
      {},
    );
  }

  it("maps upstream answers onto the domain codes", async () => {
    for (const [status, code] of [
      [401, "CredentialRevoked"],
      [403, "ProviderPermissionDenied"],
      [404, "ResourceNotFound"],
      [400, "InvalidRequest"],
      [500, "ProviderUnavailable"],
    ] as const) {
      await expect(call(failing(status).fetcher)).rejects.toMatchObject({
        code,
      });
    }
  });

  it("honours Retry-After once and then gives up", async () => {
    const { fetcher, calls } = failing(429, { "retry-after": "0" });
    await expect(call(fetcher)).rejects.toMatchObject({ code: "RateLimited" });
    // Two retries by default: the first answer plus two more attempts.
    expect(calls).toHaveLength(3);
  });

  it("never puts the token in the URL and never follows a redirect", async () => {
    const { fetcher, calls } = cloud((url) =>
      url.pathname.includes("/issue/")
        ? { json: { id: "10001", key: "PROJ-123", fields: { summary: "x" } } }
        : undefined,
    );
    const provider = providerFor(fetcher);
    await provider.execute(
      { credential: credentialFor(provider) },
      "issues.get",
      { issueKey: "PROJ-123" },
    );
    const call = calls[0];
    expect(call?.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`, "utf8").toString("base64")}`,
    });
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.method).toBe("GET");
    expect(call?.url.href).not.toContain(TOKEN);
    expect(call?.url.href).not.toContain(EMAIL);
  });

  it("refuses an answer larger than the deployment allows", async () => {
    const { fetcher } = stub(() => ({
      json: { padding: "x".repeat(4_000) },
    }));
    const provider = new JiraProvider(
      resolveConfig({ maxResponseBytes: 1_024, jira: { sites: SITES } }),
      fetcher,
    );
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
  });

  it("reports a body that is not JSON as an upstream fault", async () => {
    const { fetcher } = stub(() => ({ text: "<html>login</html>" }));
    await expect(call(fetcher)).rejects.toMatchObject({
      code: "ProviderUnavailable",
    });
  });

  it("refuses an operation that is not in the catalog", async () => {
    const { fetcher, calls } = cloud(() => undefined);
    const provider = providerFor(fetcher);
    for (const operation of [
      "issues.create",
      "issues.transition",
      "rest.call",
      "raw",
    ]) {
      await expect(
        provider.execute(
          { credential: credentialFor(provider) },
          operation,
          {},
        ),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toEqual([]);
  });
});
