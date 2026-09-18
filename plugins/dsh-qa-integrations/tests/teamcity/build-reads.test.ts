import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import { config, credentialFor, SERVER, stub } from "./shared.js";

describe("teamcity build reads", () => {
  it("searches builds through a locator it built itself", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 1,
        build: [
          {
            id: 81234,
            number: "1.4.2",
            state: "finished",
            status: "FAILURE",
            statusText: "exit code 1",
            branchName: "feature/PROJ-123",
            startDate: "20260915T101500+0300",
            finishDate: "20260915T102000+0300",
            webUrl: `${SERVER}/viewLog.html?buildId=81234`,
            buildType: { id: "PROJ_Backend", name: "Backend" },
            agent: { id: 3, name: "linux-01" },
            triggered: {
              type: "vcs",
              user: { username: "alice", name: "Alice" },
            },
          },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.list",
      {
        projectId: "PROJ",
        branch: "feature/PROJ-123",
        status: "FAILURE",
        since: "2026-09-01",
        // Above the deployment cap for this collection, which clamps.
        limit: 500,
      },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/app/rest/builds");
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "project:(id:PROJ),branch:(name:feature/PROJ-123),status:FAILURE,sinceDate:20260901T000000+0000,count:50",
    );
    expect(calls[0]?.url.searchParams.get("fields")).toContain("buildType(");
    expect(answer["items"]).toEqual([
      expect.objectContaining({
        id: 81234,
        status: "FAILURE",
        // TeamCity's dates are not ISO-8601; the model gets ISO-8601.
        startedAt: "2026-09-15T07:15:00.000Z",
        finishedAt: "2026-09-15T07:20:00.000Z",
        buildType: { id: "PROJ_Backend", name: "Backend" },
        agent: { id: 3, name: "linux-01" },
      }),
    ]);
    expect(answer["pagination"]).toEqual({ returned: 1 });
  });

  it("refuses a status, state or branch the catalog does not declare", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TeamcityProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const input of [
      { status: "MAYBE" },
      { state: "sleeping" },
      { buildTypeId: "a b" },
      { projectId: "PROJ/../other" },
      { since: "soon" },
    ]) {
      await expect(
        provider.execute({ credential }, "builds.list", input),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });

  it("reads one build by its numeric id", async () => {
    const { calls, fetcher } = stub(() => ({
      json: { id: 7, number: "7", state: "running", status: "UNKNOWN" },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    await expect(
      provider.execute({ credential: credentialFor(fetcher) }, "builds.get", {
        buildId: 7,
      }),
    ).resolves.toMatchObject({ id: 7, state: "running" });
    expect(calls[0]?.url.pathname).toBe("/app/rest/builds/id:7");
    // The build number is not an id, and neither is a string.
    await expect(
      provider.execute({ credential: credentialFor(fetcher) }, "builds.get", {
        buildId: "7",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(1);
  });

  it("reads version control changes of a build", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 1,
        change: [
          {
            id: 991,
            version: "abc123",
            username: "bob",
            date: "20260915T090000+0300",
            comment: "fix: the thing",
            webUrl: `${SERVER}/viewModification.html?modId=991`,
          },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.changes",
      { buildId: 81234 },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/app/rest/changes");
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "build:(id:81234),count:100",
    );
    expect(answer["items"]).toEqual([
      expect.objectContaining({
        version: "abc123",
        username: "bob",
        date: "2026-09-15T06:00:00.000Z",
      }),
    ]);
  });

  it("answers failures with failed tests and problems only", async () => {
    const { calls, fetcher } = stub((url) =>
      url.pathname.endsWith("/testOccurrences")
        ? {
            json: {
              count: 3,
              testOccurrence: [
                { id: "1", name: "passes", status: "SUCCESS" },
                { id: "2", name: "breaks", status: "FAILURE", duration: 12 },
                { id: "3", name: "also breaks", status: "ERROR" },
              ],
            },
          }
        : {
            json: {
              count: 1,
              problemOccurrence: [
                { id: "p1", type: "TC_EXIT_CODE", identity: "exit code 1" },
              ],
            },
          },
    );
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "failures.get",
      { buildId: 81234 },
    )) as Record<string, unknown>;
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/app/rest/testOccurrences",
      "/app/rest/problemOccurrences",
    ]);
    expect(calls[0]?.url.searchParams.get("locator")).toBe("build:(id:81234)");
    expect(
      (answer["failedTests"] as readonly unknown[]).map(
        (test) => (test as Record<string, unknown>)["name"],
      ),
    ).toEqual(["breaks", "also breaks"]);
    expect(answer["problems"]).toEqual([
      expect.objectContaining({
        identity: "exit code 1",
        type: "TC_EXIT_CODE",
      }),
    ]);
    expect(answer["truncated"]).toBeUndefined();
  });

  it("skips the half of the failure answer the caller does not want", async () => {
    const { calls, fetcher } = stub(() => ({ json: { count: 0 } }));
    const provider = new TeamcityProvider(config(), fetcher);
    await provider.execute(
      { credential: credentialFor(fetcher) },
      "failures.get",
      {
        buildId: 5,
        includeProblems: false,
      },
    );
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/app/rest/testOccurrences",
    ]);
  });
});
