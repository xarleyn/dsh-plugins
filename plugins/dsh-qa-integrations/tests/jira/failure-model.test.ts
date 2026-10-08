import { providerFor, credentialFor, cloud, stub } from "./shared.js";

/**
 * What `tests/jira/conformance.test.ts` does not cover: an answer that is not
 * JSON at all, and an operation the catalog refuses before any request. The
 * status model, the retry policy, the byte cap, the refused redirect and the
 * secret's one carrier live in the shared suite.
 */
describe("jira failure model", () => {
  it("reads a sign-in page in place of data as the refused credential", async () => {
    // What a Jira Server / Data Center answers an expired personal key with,
    // and the one thing the user can act on. The body is never echoed.
    const { fetcher } = stub(() => ({ text: "<html>login</html>" }));
    const provider = providerFor(fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({
      code: "CredentialRevoked",
      message:
        "Provider answered with a sign-in page instead of data; reconnect the integration",
    });
  });

  it("reports a body that is neither JSON nor a page as an upstream fault", async () => {
    const { fetcher } = stub(() => ({ text: "gateway is thinking" }));
    const provider = providerFor(fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
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
