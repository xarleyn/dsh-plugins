import { spaceAllowed } from "../../src/providers/confluence/config.js";
import { call, config, SPACE, stub } from "./shared.js";

describe("confluence spaces", () => {
  it("lists spaces and asks upstream for the allowlist when there is one", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        results: [
          SPACE,
          { id: "98306", key: "HR", name: "People", type: "global" },
        ],
      },
    }));
    const answer = (await call(
      "spaces.list",
      {},
      { fetcher, confluence: { allowedSpaces: ["ENG"] } },
    )) as Record<string, unknown>;
    expect((calls[0]?.url as URL).searchParams.get("keys")).toBe("ENG");
    expect(answer["items"]).toEqual([
      {
        id: "98305",
        key: "ENG",
        name: "Engineering",
        type: "global",
        status: "current",
        homepageId: "1",
      },
    ]);

    const open = (await call(
      "spaces.list",
      { type: "global" },
      { fetcher },
    )) as Record<string, unknown>;
    expect((open["items"] as unknown[]).length).toBe(2);
    expect((calls[1]?.url as URL).searchParams.get("keys")).toBeNull();
    expect((calls[1]?.url as URL).searchParams.get("type")).toBe("global");
  });

  it("refuses an explicit key outside the allowlist", async () => {
    const { calls, fetcher } = stub(() => ({ json: { results: [] } }));
    await expect(
      call(
        "spaces.list",
        { keys: ["HR"] },
        { fetcher, confluence: { allowedSpaces: ["ENG"] } },
      ),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
    expect(calls).toHaveLength(0);
  });

  it("resolves a space key through the listing and reads an id directly", async () => {
    const { calls, fetcher } = stub(() => ({ json: { results: [SPACE] } }));
    const byKey = (await call(
      "spaces.get",
      { space: "ENG" },
      { fetcher },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/wiki/api/v2/spaces");
    expect((calls[0]?.url as URL).searchParams.get("keys")).toBe("ENG");
    expect(byKey["space"]).toMatchObject({
      id: "98305",
      key: "ENG",
      name: "Engineering",
    });

    await call("spaces.get", { space: "98305" }, { fetcher });
    expect(calls[1]?.url.pathname).toBe("/wiki/api/v2/spaces/98305");

    // A numeric id is answered by the space itself, not by a collection.
    const single = stub(() => ({ json: SPACE }));
    const direct = (await call(
      "spaces.get",
      { space: "98305" },
      { fetcher: single.fetcher },
    )) as Record<string, unknown>;
    expect(direct["space"]).toMatchObject({ key: "ENG" });

    const unusable = stub(() => ({ json: "not-an-object" }));
    await expect(
      call("spaces.get", { space: "98305" }, { fetcher: unusable.fetcher }),
    ).rejects.toMatchObject({ code: "ResourceNotFound" });
  });

  it("answers not-found when a key matches nothing", async () => {
    const { fetcher } = stub(() => ({ json: { results: [] } }));
    await expect(
      call("spaces.get", { space: "NOPE" }, { fetcher }),
    ).rejects.toMatchObject({ code: "ResourceNotFound" });
  });

  it("applies the allowlist to a direct space read", async () => {
    const { fetcher } = stub(() => ({ json: { ...SPACE, key: "HR" } }));
    // The single-space answer is the shape a numeric id read gets.
    await expect(
      call(
        "spaces.get",
        { space: "98305" },
        { fetcher, confluence: { allowedSpaces: ["ENG"] } },
      ),
    ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
  });

  it("detects a space key that is not an id", () => {
    expect(spaceAllowed(config().confluence, "ENG")).toBe(true);
  });
});
