import { providerFor, credentialFor, cloud, stub } from "./shared.js";

/**
 * What `tests/jira/conformance.test.ts` does not cover: an answer that is not
 * JSON at all, and an operation the catalog refuses before any request. The
 * status model, the retry policy, the byte cap, the refused redirect and the
 * secret's one carrier live in the shared suite.
 */
describe("jira failure model", () => {
  it("reports a body that is not JSON as an upstream fault", async () => {
    const { fetcher } = stub(() => ({ text: "<html>login</html>" }));
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
