import { resolveConfig } from "../../src/config.js";
import { GitlabProvider } from "../../src/providers/gitlab/index.js";
import { INSTANCES, config, credentialFor } from "./shared.js";

/**
 * What `tests/gitlab/conformance.test.ts` does not cover: telling this
 * deployment's own deadline apart from an untrusted certificate. The status
 * model, the retry policy, the byte cap, the refused redirect and the secret's
 * one carrier live in the shared suite, so they are asserted once for every
 * provider instead of once here.
 */
describe("gitlab transport failures", () => {
  it("separates its own timeout and a TLS refusal, and never re-sends a timed-out call", async () => {
    let attempts = 0;
    const hanging: typeof fetch = (_input, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    };
    const slow = new GitlabProvider(
      resolveConfig({
        timeoutMs: 30,
        gitlab: { instances: INSTANCES, retries: 3 },
      }),
      hanging,
    );
    await expect(
      slow.execute(
        { credential: credentialFor("gitlab-com", hanging) },
        "projects.get",
        { project: 1 },
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    expect(attempts).toBe(1);

    const untrusted: typeof fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      });
    };
    const tls = new GitlabProvider(config({ retries: 0 }), untrusted);
    await expect(
      tls.execute(
        { credential: credentialFor("gitlab-com", untrusted as never) },
        "projects.get",
        { project: 1 },
      ),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });
});
