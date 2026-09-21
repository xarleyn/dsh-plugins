import { INSTANCE, TOKEN, credentialFor, provider, stub } from "./shared.js";

/**
 * What `tests/weblate/conformance.test.ts` does not cover: telling an
 * unreachable host from bad TLS, a body that is not JSON at all, and an answer
 * whose shape this release has never seen. The status model, the retry policy,
 * the byte cap, the refused redirect and the secret's one carrier live in the
 * shared suite.
 */
describe("weblate transport failures", () => {
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
