import {
  INSTANCE,
  PAGE,
  TOKEN,
  UNIT,
  credentialFor,
  provider,
  stub,
} from "./shared.js";

describe("weblate operations", () => {
  const listCases: readonly [string, Record<string, unknown>, string][] = [
    ["projects.list", {}, "/api/projects/"],
    ["components.list", { project: "app" }, "/api/projects/app/components/"],
    [
      "translations.list",
      { project: "app", component: "frontend" },
      "/api/components/app/frontend/translations/",
    ],
    [
      "units.search",
      { project: "app", component: "frontend", language: "de" },
      "/api/translations/app/frontend/de/units/",
    ],
    ["units.find", {}, "/api/units/"],
    ["units.failing", { project: "app" }, "/api/units/"],
    ["units.comments", { unitId: 18219 }, "/api/units/18219/comments/"],
    ["units.suggestions", { unitId: 18219 }, "/api/units/18219/suggestions/"],
    ["changes.list", { project: "app" }, "/api/projects/app/changes/"],
    ["screenshots.list", {}, "/api/screenshots/"],
  ];

  const readCases: readonly [string, Record<string, unknown>, string][] = [
    ["projects.get", { project: "app" }, "/api/projects/app/"],
    [
      "projects.statistics",
      { project: "app" },
      "/api/projects/app/statistics/",
    ],
    [
      "components.get",
      { project: "app", component: "frontend" },
      "/api/components/app/frontend/",
    ],
    [
      "components.statistics",
      { project: "app", component: "frontend" },
      "/api/components/app/frontend/statistics/",
    ],
    [
      "translations.get",
      { project: "app", component: "frontend", language: "de" },
      "/api/translations/app/frontend/de/",
    ],
    [
      "translations.statistics",
      { project: "app", component: "frontend", language: "de" },
      "/api/translations/app/frontend/de/statistics/",
    ],
    ["units.get", { unitId: 18219 }, "/api/units/18219/"],
    ["screenshots.get", { screenshotId: 3 }, "/api/screenshots/3/"],
  ];

  it("addresses one endpoint per listing, all of them on the configured instance", async () => {
    const { calls, fetcher } = stub(() => ({
      json: { ...PAGE, results: [UNIT] },
    }));
    const p = provider(fetcher);
    const credential = credentialFor(TOKEN, {}, fetcher);
    for (const [operation, input, expected] of listCases) {
      calls.length = 0;
      await p.execute({ credential }, operation, input);
      expect(calls[0]?.url.pathname, operation).toBe(expected);
      expect(calls[0]?.init.method, operation).toBe("GET");
      expect(calls[0]?.url.searchParams.get("page"), operation).toBe("1");
      expect(calls[0]?.url.searchParams.get("page_size"), operation).toBe("20");
      expect(
        calls.every((call) => call.url.origin === INSTANCE),
        operation,
      ).toBe(true);
    }
  });

  it("reads a single resource without a page argument", async () => {
    const { calls, fetcher } = stub(() => ({ json: UNIT }));
    const p = provider(fetcher);
    const credential = credentialFor(TOKEN, {}, fetcher);
    for (const [operation, input, expected] of readCases) {
      calls.length = 0;
      await p.execute({ credential }, operation, input);
      expect(calls[0]?.url.pathname, operation).toBe(expected);
      expect(calls[0]?.url.search, operation).toBe("");
      expect(calls[0]?.init.method, operation).toBe("GET");
    }
  });

  it("keeps one page small, whatever Weblate would allow", async () => {
    const { calls, fetcher } = stub(() => ({ json: { ...PAGE, results: [] } }));
    const p = provider(fetcher);
    const credential = credentialFor(TOKEN, {}, fetcher);
    await p.execute({ credential }, "projects.list", {
      page: 3,
      perPage: 500,
    });
    // The model-facing cap is the provider's: 500 rows is not a page, it is a
    // translation export.
    expect(calls[0]?.url.searchParams.get("page")).toBe("3");
    expect(calls[0]?.url.searchParams.get("page_size")).toBe("100");
    await p.execute({ credential }, "projects.list", {});
    expect(calls[1]?.url.searchParams.get("page_size")).toBe("20");
    const tight = provider(fetcher, { maxPageSize: 5 });
    await tight.execute(
      { credential: credentialFor(TOKEN, { maxPageSize: 5 }, fetcher) },
      "projects.list",
      { perPage: 50 },
    );
    expect(calls[2]?.url.searchParams.get("page_size")).toBe("5");
  });

  it("reports the cursor without ever following it", async () => {
    const { fetcher } = stub(() => ({
      json: {
        count: 40,
        next: `${INSTANCE}/api/projects/?page=2&page_size=20`,
        previous: null,
        results: [UNIT],
      },
    }));
    const p = provider(fetcher);
    const answer = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "projects.list",
      {},
    )) as Record<string, unknown>;
    expect(answer["items"]).toHaveLength(1);
    expect(answer["pagination"]).toEqual({
      page: 1,
      perPage: 20,
      nextPage: 2,
      total: 40,
    });
  });

  it("normalizes a localization string into what a QA question needs", async () => {
    const { fetcher } = stub(() => ({ json: UNIT }));
    const p = provider(fetcher);
    const unit = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "units.get",
      { unitId: 18219 },
    )) as Record<string, unknown>;
    expect(unit).toMatchObject({
      id: 18219,
      project: "app",
      component: "frontend",
      language: "de",
      state: "needs-editing",
      fuzzy: true,
      translated: false,
      source: ["Reset password"],
      target: ["Passwort zurücksetzen"],
      context: "auth/reset",
      location: "src/auth.ts:12",
      labels: ["auth"],
      hasComment: true,
      hasFailingCheck: true,
      hasSuggestion: false,
      sourceUnitId: 18200,
      priority: 100,
      numWords: 3,
      webUrl: `${INSTANCE}/translate/app/frontend/de/?checksum=abc`,
      // The text-bearing answer says out loud where the text came from.
      untrustedExternalContent: true,
    });
  });

  it("keeps plural forms and marks a clipped string", async () => {
    const long = "x".repeat(300);
    const unit = { ...UNIT, source: ["one", long], target: [long] };
    const { fetcher } = stub((url) =>
      url.pathname === "/api/units/"
        ? { json: { ...PAGE, results: [unit] } }
        : { json: unit },
    );
    const p = provider(fetcher);
    const list = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "units.find",
      {},
    )) as { readonly items: readonly Record<string, unknown>[] };
    const row = list.items[0] as Record<string, unknown>;
    expect((row["source"] as readonly string[]).length).toBe(2);
    expect((row["source"] as readonly string[])[1]?.length).toBe(200);
    expect(row["textTruncated"]).toBe(true);
    // A single read is allowed to carry more of the string, and still not all
    // of an arbitrarily large one.
    const one = (await p.execute(
      { credential: credentialFor(TOKEN, {}, fetcher) },
      "units.get",
      { unitId: 1, maxChars: 300 },
    )) as Record<string, unknown>;
    expect((one["source"] as readonly string[])[1]?.length).toBe(300);
    expect(one["textTruncated"]).toBeUndefined();
  });

  it("caps one string by the deployment budget, not by the request", async () => {
    const long = "y".repeat(900);
    const { fetcher } = stub(() => ({ json: { ...UNIT, source: [long] } }));
    const p = provider(fetcher, { maxTextChars: 128 });
    const unit = (await p.execute(
      { credential: credentialFor(TOKEN, { maxTextChars: 128 }, fetcher) },
      "units.get",
      { unitId: 1, maxChars: 20_000 },
    )) as Record<string, unknown>;
    expect((unit["source"] as readonly string[])[0]?.length).toBe(128);
    expect(unit["textTruncated"]).toBe(true);
  });

  it("composes Weblate's own search instead of accepting one", async () => {
    const { calls, fetcher } = stub(() => ({ json: { ...PAGE, results: [] } }));
    const p = provider(fetcher);
    const credential = credentialFor(TOKEN, {}, fetcher);
    await p.execute({ credential }, "units.find", {
      project: "app",
      language: "de",
      source: "Reset password",
      state: "needs-editing",
      failingChecks: true,
    });
    expect(calls[0]?.url.searchParams.get("q")).toBe(
      'source:"Reset password" AND is:needs-editing AND has:check AND project:="app" AND language:="de"',
    );
    await p.execute({ credential }, "units.failing", { project: "app" });
    expect(calls[1]?.url.searchParams.get("q")).toBe(
      'has:check AND project:="app"',
    );
    // No filter at all is not a query string with nothing in it.
    calls.length = 0;
    await p.execute({ credential }, "units.search", {
      project: "app",
      component: "frontend",
      language: "de",
    });
    expect(calls[0]?.url.searchParams.has("q")).toBe(false);
  });
});
