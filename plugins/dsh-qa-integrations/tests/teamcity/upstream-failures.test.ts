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

  it("spends one deadline on a request that never answers", async () => {
    let attempts = 0;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        attempts += 1;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    const provider = new TeamcityProvider(
      resolveConfig({
        timeoutMs: 30,
        teamcity: { network: NETWORK, serverUrl: SERVER, retries: 2 },
      }),
      hanging,
    );
    await expect(
      provider.execute({ credential: credentialFor(hanging) }, "builds.get", {
        buildId: 1,
      }),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });
    // The deadline is this deployment's own verdict, so asking again cannot make
    // the answer arrive sooner — two further attempts only triple how long a
    // caller waits to be told the server is not replying.
    expect(attempts).toBe(1);
  });

  it("still spends the whole budget on a connection the server refused", async () => {
    // The bound above is only this deployment's own deadline. A refused
    // connection is the upstream's answer, and a busy on-prem server is more
    // often momentarily refusing than gone, so it keeps earning its retries.
    let attempts = 0;
    const refusing: typeof fetch = async () => {
      attempts += 1;
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      });
    };
    const provider = new TeamcityProvider(
      resolveConfig({
        timeoutMs: 30,
        teamcity: { network: NETWORK, serverUrl: SERVER, retries: 2 },
      }),
      refusing,
    );
    await expect(
      provider.execute(
        { credential: credentialFor(refusing) },
        "builds.get",
        { buildId: 1 },
      ),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
    expect(attempts).toBe(3);
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
