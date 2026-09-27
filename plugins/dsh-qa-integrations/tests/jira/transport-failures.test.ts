import { resolveConfig } from "../../src/config.js";
import { JiraProvider } from "../../src/providers/jira/index.js";
import { COMPANY, EMAIL, SITES, TOKEN } from "./shared.js";

/**
 * The symmetric half of `tests/gitlab/transport-failures.test.ts`. Jira and
 * GitLab answer one timeout differently on purpose — GitLab treats the
 * deployment's deadline as the whole budget, Jira re-sends the call — and the
 * difference lives in `providers/kernel/read-policy.ts` as a named rule, not in
 * a lambda per transport. Both sides are pinned so the rule cannot drift back
 * into an accident, and so a provider that names neither is forced to choose.
 */
describe("jira transport failures", () => {
  function providerFor(fetcher: typeof fetch, extra: Record<string, unknown>) {
    const provider = new JiraProvider(
      resolveConfig({ timeoutMs: 30, jira: { sites: SITES, ...extra } }),
      fetcher,
    );
    return {
      provider,
      credential: provider.parseCredential(TOKEN, {
        siteId: COMPANY.id,
        email: EMAIL,
      }).credential,
    };
  }

  it("re-sends a call that hit this deployment's own deadline", async () => {
    let attempts = 0;
    const hanging: typeof fetch = (_input, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    };
    const { provider, credential } = providerFor(hanging, { retries: 1 });
    await expect(
      provider.execute({ credential }, "issues.get", { issueKey: "PROJ-123" }),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    // The deviation, priced: `retries` further attempts, each paying the
    // deadline again. GitLab asserts `1` here, and that contrast is the point.
    expect(attempts).toBe(2);
  });

  it("reads a TLS refusal as itself rather than as a timeout", async () => {
    const untrusted: typeof fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      });
    };
    const { provider, credential } = providerFor(untrusted, { retries: 0 });
    await expect(
      provider.execute({ credential }, "issues.get", { issueKey: "PROJ-123" }),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });
});
