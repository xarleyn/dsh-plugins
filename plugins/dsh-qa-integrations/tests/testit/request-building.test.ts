import { capped, paged } from "../../src/providers/testit/operations.js";
import { TestitProvider } from "../../src/providers/testit/index.js";
import { PROJECTS, config, credentialFor, stub } from "./shared.js";

describe("testit request building", () => {
  it("pages with Skip and Take and reports the page back", async () => {
    const { calls, fetcher } = stub(() => ({
      json: PROJECTS,
      headers: { "pagination-total-items": "7" },
    }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    const first = (await provider.execute({ credential }, "projects.list", {
      offset: 0,
      limit: 5,
    })) as Record<string, unknown>;
    expect(calls[0]?.url.searchParams.get("Skip")).toBe("0");
    expect(calls[0]?.url.searchParams.get("Take")).toBe("5");
    expect(first["pagination"]).toEqual({
      offset: 0,
      limit: 5,
      returned: 1,
      total: 7,
      hasMore: true,
    });
    await provider.execute({ credential }, "projects.list", { offset: 2 });
    expect(calls[1]?.url.searchParams.get("Skip")).toBe("2");
    // An unasked limit is the deployment default, not the hard cap.
    expect(calls[1]?.url.searchParams.get("Take")).toBe("20");
  });

  it("clamps an oversized limit instead of refusing it", async () => {
    const { calls, fetcher } = stub(() => ({ json: [] }));
    const provider = new TestitProvider(config(), fetcher);
    await provider.execute(
      { credential: credentialFor(fetcher) },
      "testRuns.list",
      {
        projectId: PROJECTS[0]?.id,
        limit: 5_000,
      },
    );
    expect(calls[0]?.url.searchParams.get("Take")).toBe("50");
  });

  it("sends all four run state flags, as that endpoint requires", async () => {
    const { calls, fetcher } = stub(() => ({ json: [] }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    // `Failed` is a result outcome, not a run state: the typed filter refuses it
    // before any request is built.
    await expect(
      provider.execute({ credential }, "testRuns.list", {
        projectId: PROJECTS[0]?.id,
        states: ["Failed"],
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(0);

    await provider.execute({ credential }, "testRuns.list", {
      projectId: PROJECTS[0]?.id,
    });
    const query = calls[0]?.url.searchParams;
    expect([
      query?.get("notStarted"),
      query?.get("inProgress"),
      query?.get("stopped"),
      query?.get("completed"),
    ]).toEqual(["true", "true", "true", "true"]);

    await provider.execute({ credential }, "testRuns.list", {
      projectId: PROJECTS[0]?.id,
      states: ["InProgress", "Stopped"],
      createdFrom: "2026-09-01T00:00:00Z",
      createdTo: "2026-09-17",
      testPlanId: PROJECTS[0]?.id,
    });
    const filtered = calls[1]?.url.searchParams;
    expect(filtered?.get("notStarted")).toBe("false");
    expect(filtered?.get("inProgress")).toBe("true");
    expect(filtered?.get("stopped")).toBe("true");
    expect(filtered?.get("completed")).toBe("false");
    expect(filtered?.get("createdDateFrom")).toBe("2026-09-01T00:00:00Z");
    expect(filtered?.get("createdDateTo")).toBe("2026-09-17");
    expect(filtered?.get("testPlanId")).toBe(PROJECTS[0]?.id);
  });

  it("refuses an identifier that is not an identifier, without a request", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const value of ["../projects", "a/b", "", "x".repeat(65), 42]) {
      await expect(
        provider.execute({ credential }, "workItems.get", {
          workItemId: value,
        }),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });

  it("addresses each read by its documented path", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    const id = PROJECTS[0]?.id ?? "";
    const paths: readonly [string, Record<string, unknown>][] = [
      ["projects.get", { projectId: id }],
      ["sections.list", { projectId: id }],
      ["workItems.list", { projectId: id }],
      ["workItems.get", { workItemId: id }],
      ["workItems.history", { workItemId: id }],
      ["workItems.comments", { workItemId: id }],
      ["workItems.testResults", { workItemId: id }],
      ["testPlans.list", { projectId: id }],
      ["testPlans.get", { testPlanId: id }],
      ["testPlans.summary", { testPlanId: id }],
      ["testRuns.get", { testRunId: id }],
      ["testRuns.results", { testRunId: id }],
      ["testResults.get", { testResultId: id }],
      ["testResults.attachments", { testResultId: id }],
      ["attachments.metadata", { attachmentId: id }],
      ["autoTests.get", { autoTestId: id }],
      ["configurations.list", { projectId: id }],
    ];
    for (const [operation, input] of paths) {
      await provider.execute({ credential }, operation, input);
    }
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      `/api/v2/projects/${id}`,
      `/api/v2/projects/${id}/sections`,
      `/api/v2/projects/${id}/workItems`,
      `/api/v2/workItems/${id}`,
      `/api/v2/workItems/${id}/history`,
      `/api/v2/workItems/${id}/comments`,
      `/api/v2/workItems/${id}/testResults/history`,
      `/api/v2/projects/${id}/testPlans`,
      `/api/v2/testPlans/${id}`,
      `/api/v2/testPlans/${id}/summaries`,
      `/api/v2/testRuns/${id}`,
      `/api/v2/testRuns/${id}/testPoints/results`,
      `/api/v2/testResults/${id}`,
      `/api/v2/testResults/${id}/attachments`,
      `/api/v2/attachments/${id}/metadata`,
      `/api/v2/autoTests/${id}`,
      `/api/v2/projects/${id}/configurations`,
    ]);
    expect(calls.every(({ init }) => init.method === "GET")).toBe(true);
    expect(calls.every(({ init }) => init.redirect === "error")).toBe(true);
  });

  it("refuses an operation the catalog does not declare, without a request", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TestitProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const operation of [
      "raw_rest",
      "search.global",
      "workItems.create",
      "workItems.search",
      "testRuns.statistics",
      "attachments.upload",
      "workItems.like",
      "projects.purge",
    ]) {
      await expect(
        provider.execute({ credential }, operation, {}),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("testit list envelopes", () => {
  it("reports the upstream total when the header carries it", () => {
    expect(paged([1, 2], { skip: 0, take: 2, total: 9 }, 2, 0)).toEqual({
      items: [1, 2],
      pagination: { offset: 0, limit: 2, returned: 2, total: 9, hasMore: true },
    });
    expect(paged([1], { skip: 8, take: 2, total: 9 }, 2, 8)).toEqual({
      items: [1],
      pagination: {
        offset: 8,
        limit: 2,
        returned: 1,
        total: 9,
        hasMore: false,
      },
    });
  });

  it("admits that a full page without a total may continue", () => {
    expect(paged([1, 2], undefined, 2, 0)).toEqual({
      items: [1, 2],
      pagination: { offset: 0, limit: 2, returned: 2, hasMore: true },
    });
    expect(paged([1], undefined, 2, 0)).toEqual({
      items: [1],
      pagination: { offset: 0, limit: 2, returned: 1, hasMore: false },
    });
  });

  it("cuts a collection upstream answers whole and says so", () => {
    expect(capped([1, 2, 3], 2)).toEqual({
      items: [1, 2],
      truncated: true,
      pagination: { limit: 2, returned: 2 },
    });
    expect(capped([1], 2)).toEqual({
      items: [1],
      truncated: false,
      pagination: { limit: 2, returned: 1 },
    });
  });
});
