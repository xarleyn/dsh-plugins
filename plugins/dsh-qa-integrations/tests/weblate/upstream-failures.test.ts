import { WeblateProvider } from "../../src/providers/weblate/index.js";
import {
  INSTANCE,
  PAGE,
  TOKEN,
  config,
  credentialFor,
  provider,
  stub,
} from "./shared.js";

describe("weblate upstream failures", () => {
  const cases: readonly [number, string][] = [
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    // A read this Weblate release does not offer is a missing endpoint, not a
    // crash: the provider only ever issues GETs.
    [405, "ResourceNotFound"],
    [429, "RateLimited"],
    [400, "InvalidRequest"],
    [422, "InvalidRequest"],
    [500, "ProviderUnavailable"],
  ];

  it("folds an upstream status into a safe code", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({ status, json: {} }));
      const p = provider(fetcher);
      await expect(
        p.execute({ credential: credentialFor() }, "projects.list", {}),
      ).rejects.toMatchObject({ code });
    }
  });

  it("never lets an upstream body into the error", async () => {
    const { fetcher } = stub(() => ({
      status: 403,
      json: { detail: `token ${TOKEN} is not allowed` },
    }));
    const p = provider(fetcher);
    const error = await p
      .execute({ credential: credentialFor() }, "projects.list", {})
      .then(
        () => undefined,
        (cause: unknown) => cause as Error,
      );
    expect(error).toBeDefined();
    expect(error?.message).not.toContain(TOKEN);
    expect(error?.message).not.toContain("not allowed");
  });

  it("separates an unreachable host from bad TLS", async () => {
    const refused: typeof fetch = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const denied = provider(refused);
    await expect(
      denied.execute({ credential: credentialFor() }, "projects.list", {}),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
    const tls: typeof fetch = () => {
      throw Object.assign(new Error("fetch failed"), {
        cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" },
      });
    };
    const broken = provider(tls);
    await expect(
      broken.execute({ credential: credentialFor() }, "projects.list", {}),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });

  it("retries a throttled read but not an authorization failure", async () => {
    let attempts = 0;
    const limited: typeof fetch = async () => {
      attempts += 1;
      const status = attempts === 1 ? 429 : 200;
      return new Response(
        JSON.stringify(status === 200 ? { ...PAGE, results: [] } : {}),
        { status, headers: { "content-type": "application/json" } },
      );
    };
    const p = provider(limited);
    await p.execute({ credential: credentialFor() }, "projects.list", {});
    expect(attempts).toBe(2);
    attempts = 0;
    const forbidden: typeof fetch = async () => {
      attempts += 1;
      return new Response("{}", {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    };
    const denied = provider(forbidden);
    await expect(
      denied.execute({ credential: credentialFor() }, "projects.list", {}),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(attempts).toBe(1);
  });

  it("refuses an oversized answer instead of handing it to the model", async () => {
    const { fetcher } = stub(() => ({
      json: { ...PAGE, results: [{ id: 1, padding: "x".repeat(4_000) }] },
    }));
    const tiny = new WeblateProvider(
      config({}, { maxResponseBytes: 512 }),
      fetcher,
    );
    await expect(
      tiny.execute({ credential: credentialFor() }, "projects.list", {}),
    ).rejects.toMatchObject({ code: "ResultTooLarge" });
  });

  it("answers a non-JSON body with a safe failure", async () => {
    const html: typeof fetch = async () =>
      new Response("<html>maintenance</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const p = provider(html);
    await expect(
      p.execute({ credential: credentialFor() }, "projects.list", {}),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
  });

  it("survives an answer whose shape it has never seen", async () => {
    // Weblate's OpenAPI coverage is a preview upstream, so a release may move a
    // field: an answer this provider cannot read must answer with what it does
    // understand instead of throwing in the projection.
    const { fetcher } = stub(() => ({
      json: {
        count: "many",
        next: { url: 1 },
        results: [
          {
            id: "18219",
            translation: `${INSTANCE}/api/translations/app/`,
            state: null,
            source: { text: "nope" },
            target: [7, "ok"],
            labels: [{ color: "#fff" }, "plain", { name: "auth" }],
            source_unit: `${INSTANCE}/api/units/not-a-number/`,
            web_url: `${INSTANCE}/translate/app/frontend/de/`,
            has_failing_check: "yes",
          },
        ],
      },
    }));
    const p = provider(fetcher);
    const answer = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "units.find",
      {},
    )) as {
      readonly items: readonly Record<string, unknown>[];
      readonly pagination?: Record<string, unknown>;
    };
    expect(answer.items).toHaveLength(1);
    expect(answer.items[0]).toMatchObject({
      state: "unknown",
      source: [],
      target: ["ok"],
      labels: ["plain", "auth"],
    });
    // A field the provider could not parse is left out rather than guessed at.
    expect(answer.items[0]?.["id"]).toBeUndefined();
    expect(answer.items[0]?.["sourceUnitId"]).toBeUndefined();
    expect(answer.items[0]?.["hasFailingCheck"]).toBeUndefined();
    // An unreadable count and an unreadable next link are reported as absent
    // rather than as a number nobody can verify.
    expect(answer.pagination).toEqual({ page: 1, perPage: 20 });
  });
});
