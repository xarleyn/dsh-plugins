import { resolveConfig } from "../../src/config.js";
import { IntegrationError } from "../../src/errors.js";
import { GitlabProvider } from "../../src/providers/gitlab/index.js";
import { INSTANCES, TOKEN, config, credentialFor, stub } from "./shared.js";

describe("gitlab upstream failures", () => {
  const cases: readonly [number, string][] = [
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [400, "InvalidRequest"],
    [500, "ProviderUnavailable"],
  ];

  it("maps statuses onto the provider error model without upstream bodies", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({
        status,
        json: { message: "internal detail with glpat-abcdefghij0123456789" },
      }));
      const provider = new GitlabProvider(config({ retries: 0 }), fetcher);
      const credential = credentialFor("gitlab-com", fetcher);
      await expect(
        provider.execute({ credential }, "projects.get", { project: 1 }),
      ).rejects.toMatchObject({ code });
      try {
        await provider.execute({ credential }, "projects.get", { project: 1 });
      } catch (error) {
        expect((error as IntegrationError).message).not.toContain("internal");
        expect((error as IntegrationError).message).not.toContain(TOKEN);
      }
    }
  });

  it("retries a throttled read and reports the typed error when it persists", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ id: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };
    const provider = new GitlabProvider(config({ retries: 1 }), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor("gitlab-com", fetcher) },
        "projects.get",
        { project: 1 },
      ),
    ).resolves.toMatchObject({ id: 1 });
    expect(attempts).toBe(2);

    const throttled = new GitlabProvider(config({ retries: 0 }), () =>
      Promise.resolve(
        new Response(null, { status: 429, headers: { "retry-after": "0" } }),
      ),
    );
    await expect(
      throttled.execute(
        { credential: credentialFor("gitlab-com", throttled as never) },
        "projects.get",
        { project: 1 },
      ),
    ).rejects.toMatchObject({ code: "RateLimited" });
  });

  it("does not retry an authorization answer", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return new Response(null, { status: 403 });
    };
    const provider = new GitlabProvider(config({ retries: 3 }), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor("gitlab-com", fetcher) },
        "projects.get",
        { project: 1 },
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(attempts).toBe(1);
  });

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
