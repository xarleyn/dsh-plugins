import { resolveConfig } from "../../src/config.js";
import { JiraProvider } from "../../src/providers/jira/index.js";
import { cloud, credentialFor, providerFor, SITES, stub } from "./shared.js";

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

  it("spends one deadline on a request that never answers", async () => {
    let attempts = 0;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        attempts += 1;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    const provider = new JiraProvider(
      resolveConfig({ timeoutMs: 30, jira: { sites: SITES, retries: 2 } }),
      hanging,
    );
    await expect(
      provider.execute(
        { credential: credentialFor(provider) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    // The deadline is this deployment's own verdict, so asking again cannot make
    // the answer arrive sooner — two further attempts only triple how long a
    // caller waits to be told the instance is not replying.
    expect(attempts).toBe(1);
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
