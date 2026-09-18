import { IntegrationError } from "../../src/errors.js";
import { resolveConfig } from "../../src/config.js";
import { TestitProvider } from "../../src/providers/testit/index.js";
import { INSTANCE, TOKEN, config, credentialFor, stub } from "./shared.js";

describe("testit upstream failures", () => {
  const cases: readonly [number, string][] = [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [409, "InvalidRequest"],
    [413, "ResultTooLarge"],
    [422, "InvalidRequest"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
    [503, "ProviderUnavailable"],
  ];

  it("maps statuses onto the provider error model without upstream bodies", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({
        status,
        json: { detail: `internal host tms.corp.example with ${TOKEN}` },
      }));
      const provider = new TestitProvider(config({ retries: 0 }), fetcher);
      const credential = credentialFor(fetcher, { retries: 0 });
      await expect(
        provider.execute({ credential }, "projects.list", {}),
      ).rejects.toMatchObject({ code });
      try {
        await provider.execute({ credential }, "projects.list", {});
      } catch (error) {
        expect((error as IntegrationError).message).not.toContain("internal");
        expect((error as IntegrationError).message).not.toContain(TOKEN);
      }
    }
  });

  it("retries a throttled read but not a refused one", async () => {
    const throttled = stub(() => ({
      status: 429,
      json: {},
      headers: { "retry-after": "0" },
    }));
    const provider = new TestitProvider(
      config({ retries: 1 }),
      throttled.fetcher,
    );
    await expect(
      provider.execute(
        { credential: credentialFor(throttled.fetcher, { retries: 1 }) },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "RateLimited" });
    expect(throttled.calls).toHaveLength(2);

    const denied = stub(() => ({ status: 403, json: {} }));
    const strict = new TestitProvider(config({ retries: 3 }), denied.fetcher);
    await expect(
      strict.execute(
        { credential: credentialFor(denied.fetcher, { retries: 3 }) },
        "projects.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(denied.calls).toHaveLength(1);
  });

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
