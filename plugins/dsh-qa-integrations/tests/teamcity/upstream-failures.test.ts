import { resolveConfig } from "../../src/config.js";
import { IntegrationError } from "../../src/errors.js";
import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import {
  config,
  credentialFor,
  NETWORK,
  SERVER,
  stub,
  TOKEN,
} from "./shared.js";

describe("teamcity upstream failures", () => {
  const cases: readonly [number, string][] = [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
    [503, "ProviderUnavailable"],
  ];

  it("maps statuses onto the provider error model without upstream bodies", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({
        status,
        json: {
          message: `internal detail at teamcity.internal with ${TOKEN}`,
        },
      }));
      const provider = new TeamcityProvider(config({ retries: 0 }), fetcher);
      const credential = credentialFor(fetcher);
      await expect(
        provider.execute({ credential }, "builds.get", { buildId: 1 }),
      ).rejects.toMatchObject({ code });
      try {
        await provider.execute({ credential }, "builds.get", { buildId: 1 });
      } catch (error) {
        expect((error as IntegrationError).message).not.toContain("internal");
        expect((error as IntegrationError).message).not.toContain(TOKEN);
      }
    }
  });

  it("retries a throttled read, and does not retry an authorization answer", async () => {
    let throttled = 0;
    const throttling: typeof fetch = async () => {
      throttled += 1;
      return throttled === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ id: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };
    const provider = new TeamcityProvider(config({ retries: 1 }), throttling);
    await expect(
      provider.execute(
        { credential: credentialFor(throttling) },
        "builds.get",
        { buildId: 1 },
      ),
    ).resolves.toMatchObject({ id: 1 });
    expect(throttled).toBe(2);

    let denied = 0;
    const refusing: typeof fetch = async () => {
      denied += 1;
      return new Response(null, { status: 403 });
    };
    const deniedProvider = new TeamcityProvider(
      config({ retries: 3 }),
      refusing,
    );
    await expect(
      deniedProvider.execute(
        { credential: credentialFor(refusing) },
        "builds.get",
        { buildId: 1 },
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(denied).toBe(1);
  });

  it("separates a timeout and a TLS refusal from an unreachable host", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    const slow = new TeamcityProvider(
      resolveConfig({
        timeoutMs: 30,
        teamcity: { network: NETWORK, serverUrl: SERVER, retries: 0 },
      }),
      hanging,
    );
    await expect(
      slow.execute({ credential: credentialFor(hanging) }, "builds.get", {
        buildId: 1,
      }),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });

    const untrusted: typeof fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      });
    };
    const tls = new TeamcityProvider(config({ retries: 0 }), untrusted);
    await expect(
      tls.execute({ credential: credentialFor(untrusted) }, "builds.get", {
        buildId: 1,
      }),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });

  it("refuses any operation the catalog does not declare", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TeamcityProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const operation of [
      "raw_rest",
      "builds.trigger",
      "builds.cancel",
      "builds.comment",
      "agents.authorize",
    ]) {
      await expect(
        provider.execute({ credential }, operation, {}),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });
});
