import {
  WEBLATE_OPERATIONS,
  WEBLATE_RESOURCE_KIND,
} from "../src/providers/weblate/catalog.js";
import {
  INSTANCE,
  PAGE,
  TOKEN,
  UNIT,
  credentialFor,
  provider,
  stub,
} from "./weblate/shared.js";

/** Two listed projects, the slugs the operations address them by. */
const BOUNDARY = Object.freeze({
  projects: Object.freeze(["app", "docs"]),
});

function serviceContext(
  boundary: Record<string, readonly string[]> = BOUNDARY,
) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

function credential(fetcher: typeof fetch) {
  return {
    p: provider(fetcher),
    plaintext: credentialFor(TOKEN, {}, fetcher),
  };
}

/** The same string, answering for a project the boundary does not name. */
const FOREIGN_UNIT = {
  ...UNIT,
  id: 90001,
  translation: `${INSTANCE}/api/translations/other/backend/de/`,
};

const APP_SCREENSHOT = {
  id: 3,
  name: "login form",
  translation: `${INSTANCE}/api/translations/app/frontend/de/`,
  units: [`${INSTANCE}/api/units/18219/`],
};

const FOREIGN_SCREENSHOT = {
  id: 4,
  name: "admin panel",
  translation: `${INSTANCE}/api/translations/other/backend/de/`,
  units: [],
};

const UNRESOLVABLE_SCREENSHOT = {
  id: 5,
  name: "borrowed image",
  // Another origin entirely: the provider cannot even attribute it, so a
  // service listing must not show it.
  translation: "https://elsewhere.example/api/translations/app/frontend/de/",
  units: [],
};

function projectCard(slug: string) {
  return { id: slug === "app" ? 1 : 2, name: slug, slug };
}

describe("Weblate service boundary", () => {
  it("bounds every project-scoped operation and nothing else", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const p = provider(fetcher);
    for (const [operation, definition] of Object.entries(WEBLATE_OPERATIONS)) {
      const kind = p.resourceBoundaryKind?.(operation);
      if (definition.security.requiresResourceBoundary) {
        expect(kind, operation).toBe(WEBLATE_RESOURCE_KIND);
      } else {
        expect(kind, operation).toBeUndefined();
      }
    }
  });

  it("refuses a project outside the administrator boundary before reading a byte", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        { project: "elsewhere" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("serves an allowed project, addressed by its slug", async () => {
    const { fetcher, calls } = stub(() => ({ json: projectCard("app") }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        { project: "app" },
      ),
    ).resolves.toMatchObject({ slug: "app" });
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/api/projects/app/",
    ]);
  });

  it("refuses a component of a foreign project and any listing that names no project", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { p, plaintext } = credential(fetcher);
    for (const [operation, input] of [
      ["components.get", { project: "elsewhere", component: "web" }],
      ["components.list", {}],
      ["changes.list", {}],
      ["units.find", {}],
      ["units.failing", {}],
    ] as const) {
      await expect(
        p.execute(
          { credential: plaintext, ...serviceContext() },
          operation,
          input,
        ),
        operation,
      ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    }
    // Every refusal happened before anything was sent upstream.
    expect(calls).toEqual([]);
  });

  it("resolves an id-addressed string to its project before answering", async () => {
    const { fetcher, calls } = stub(() => ({ json: UNIT }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute({ credential: plaintext, ...serviceContext() }, "units.get", {
        unitId: 18219,
      }),
    ).resolves.toMatchObject({ id: 18219, project: "app" });
    // The probe that resolves the id and the read that answers it.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/api/units/18219/",
      "/api/units/18219/",
    ]);
  });

  it("fails closed on a string from a project outside the boundary", async () => {
    const { fetcher, calls } = stub(() => ({ json: FOREIGN_UNIT }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute({ credential: plaintext, ...serviceContext() }, "units.get", {
        unitId: 90001,
      }),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // Only the probe ran, and its answer was discarded: a foreign id reveals
    // nothing, not even its own text.
    expect(calls).toHaveLength(1);
  });

  it("resolves a screenshot the same way, and refuses a foreign one", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname === "/api/screenshots/3/"
        ? { json: APP_SCREENSHOT }
        : { json: FOREIGN_SCREENSHOT },
    );
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "screenshots.get",
        { screenshotId: 3 },
      ),
    ).resolves.toMatchObject({ id: 3, project: "app" });
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "screenshots.get",
        { screenshotId: 4 },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toHaveLength(3);
  });

  it("lists only the projects the boundary names", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.endsWith("/app/")
        ? { json: projectCard("app") }
        : { json: projectCard("docs") },
    );
    const { p, plaintext } = credential(fetcher);
    const answer = (await p.execute(
      { credential: plaintext, ...serviceContext() },
      "projects.list",
      {},
    )) as {
      serviceScoped: boolean;
      items: readonly { slug: string }[];
    };
    // The listing is built from the allowlist, not from whatever the shared
    // account could reach.
    expect(answer.serviceScoped).toBe(true);
    expect(answer.items.map((item) => item.slug)).toEqual(["app", "docs"]);
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/api/projects/app/",
      "/api/projects/docs/",
    ]);
  });

  it("reports a bounded project the service token cannot see instead of hiding it", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/docs/")
        ? { status: 404, json: { detail: "Not found" } }
        : { json: projectCard("app") },
    );
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.list",
        {},
      ),
    ).resolves.toMatchObject({
      items: [{ slug: "app" }],
      unavailableResources: ["docs"],
    });
  });

  it("forces the project clause into a global string search and holds the rows to it", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { ...PAGE, count: 2, results: [UNIT, FOREIGN_UNIT] },
    }));
    const { p, plaintext } = credential(fetcher);
    const answer = (await p.execute(
      { credential: plaintext, ...serviceContext() },
      "units.find",
      { project: "app", source: "Reset password" },
    )) as { items: readonly { id: number }[] };
    // The upstream query itself is narrowed by the checked argument.
    expect(calls[0]?.url.searchParams.get("q")).toContain('project:="app"');
    // And the page loses the row the boundary does not cover.
    expect(answer.items.map((item) => item.id)).toEqual([18219]);
  });

  it("keeps a screenshot listing inside the boundary even when a row is unattributable", async () => {
    const { fetcher } = stub(() => ({
      json: {
        ...PAGE,
        count: 3,
        results: [APP_SCREENSHOT, FOREIGN_SCREENSHOT, UNRESOLVABLE_SCREENSHOT],
      },
    }));
    const { p, plaintext } = credential(fetcher);
    const answer = (await p.execute(
      { credential: plaintext, ...serviceContext() },
      "screenshots.list",
      {},
    )) as { items: readonly { id: number }[] };
    expect(answer.items.map((item) => item.id)).toEqual([3]);
  });

  it("serves a search inside an allowed project without extra guards", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { ...PAGE, results: [UNIT] },
    }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "units.search",
        { project: "app", component: "frontend", language: "de" },
      ),
    ).resolves.toMatchObject({ items: [{ id: 18219 }] });
    expect(calls).toHaveLength(1);
  });

  it("fails closed when service mode arrives without a boundary", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, credentialSource: "service" },
        "projects.get",
        { project: "app" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // An empty boundary is no boundary either.
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext({}) },
        "projects.get",
        { project: "app" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("leaves the personal mode untouched", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { ...PAGE, results: [UNIT] },
    }));
    const { p, plaintext } = credential(fetcher);
    // No boundary, no service mode: the call is the plain read it always was,
    // including for a project the allowlist does not name.
    await expect(
      p.execute({ credential: plaintext }, "projects.get", {
        project: "elsewhere",
      }),
    ).resolves.toBeDefined();
    await expect(
      p.execute({ credential: plaintext }, "units.get", { unitId: 18219 }),
    ).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });
});
