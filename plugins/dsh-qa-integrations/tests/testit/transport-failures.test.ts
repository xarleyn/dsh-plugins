import { resolveConfig } from "../../src/config.js";
import { TestitProvider } from "../../src/providers/testit/index.js";
import { INSTANCE, TOKEN, config, credentialFor } from "./shared.js";

/**
 * What `tests/testit/conformance.test.ts` does not cover: telling this
 * deployment's own deadline apart from an untrusted certificate. The status
 * model, the retry policy, the byte cap, the refused redirect and the secret's
 * one carrier live in the shared suite.
 */
describe("testit transport failures", () => {
  it("keeps a timeout and a TLS failure apart from an unreachable host", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    const slow = new TestitProvider(
      resolveConfig({
        timeoutMs: 30,
        testit: { instances: [{ ...INSTANCE }], retries: 0 },
      }),
      hanging,
    );
    await expect(
      slow.execute(
        {
          credential: new TestitProvider(
            config({ retries: 0 }),
            hanging,
          ).parseCredential(TOKEN, { instanceId: "cloud" }).credential,
        },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });

    const untrusted: typeof fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      });
    };
    const tls = new TestitProvider(config({ retries: 0 }), untrusted);
    await expect(
      tls.execute(
        { credential: credentialFor(untrusted, { retries: 0 }) },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });
});
