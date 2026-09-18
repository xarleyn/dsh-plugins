import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import { config, credentialFor, stub } from "./shared.js";

describe("teamcity queue, investigations and agents", () => {
  it("lists the queue the connected account can see", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 1,
        build: [
          {
            id: 900,
            state: "queued",
            branchName: "main",
            buildType: { id: "PROJ_Backend" },
          },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    await expect(
      provider.execute({ credential: credentialFor(fetcher) }, "queue.list", {
        buildTypeId: "PROJ_Backend",
      }),
    ).resolves.toMatchObject({ items: [{ id: 900, state: "queued" }] });
    expect(calls[0]?.url.pathname).toBe("/app/rest/buildQueue");
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "buildType:(id:PROJ_Backend),count:50",
    );
  });

  it('resolves assignee "me" from the stored connection, never from the model', async () => {
    const { calls, fetcher } = stub(() => ({ json: { count: 0 } }));
    const provider = new TeamcityProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    await provider.execute(
      { credential, externalUserId: "42" },
      "investigations.list",
      { assignee: "me", state: "TAKEN" },
    );
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "assignee:(id:42),state:TAKEN,count:100",
    );
    // Any other assignee is refused rather than forwarded as a name.
    await expect(
      provider.execute(
        { credential, externalUserId: "42" },
        "investigations.list",
        {
          assignee: "bob",
        },
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    // And "me" without a known connected user fails closed.
    await expect(
      provider.execute({ credential }, "investigations.list", {
        assignee: "me",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(1);
  });

  it("filters agents by health without ever writing to them", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 2,
        agent: [
          {
            id: 1,
            name: "linux-01",
            connected: true,
            enabled: true,
            authorized: true,
          },
          {
            id: 2,
            name: "win-01",
            connected: false,
            enabled: true,
            authorized: false,
          },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "agents.list",
      { connected: true, query: "linux" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/app/rest/agents");
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "connected:true,count:100",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(answer["items"]).toEqual([
      expect.objectContaining({ name: "linux-01", connected: true }),
    ]);
  });
});

describe("teamcity projects and build configurations", () => {
  it("hides archived projects and filters the returned page", async () => {
    const { fetcher } = stub(() => ({
      json: {
        count: 3,
        project: [
          { id: "PROJ", name: "PROJ", parentProjectId: "_Root" },
          { id: "OLD", name: "Legacy", archived: true },
          { id: "PROJ_LAB", name: "PROJ Lab" },
        ],
        nextHref: "/app/rest/projects?locator=start:100",
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "projects.list",
      { query: "proj" },
    )) as Record<string, unknown>;
    expect(
      (answer["items"] as readonly Record<string, unknown>[]).map(
        (project) => project["id"],
      ),
    ).toEqual(["PROJ", "PROJ_LAB"]);
    // The page was cut short by the server, and the model is told.
    expect(answer["pagination"]).toEqual({ returned: 2, hasMore: true });

    const archived = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "projects.list",
      { includeArchived: true },
    )) as Record<string, unknown>;
    expect((archived["items"] as readonly unknown[]).length).toBe(3);
  });

  it("hides paused configurations and scopes to one project", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 2,
        buildType: [
          { id: "PROJ_Backend", name: "Backend", projectId: "PROJ" },
          { id: "PROJ_Old", name: "Old", paused: true },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "buildConfigs.list",
      { projectId: "PROJ" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/app/rest/buildTypes");
    expect(calls[0]?.url.searchParams.get("locator")).toBe("project:(id:PROJ)");
    expect(answer["items"]).toEqual([
      expect.objectContaining({ id: "PROJ_Backend" }),
    ]);
  });
});
