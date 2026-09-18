import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import { config, credentialFor, stub } from "./shared.js";

describe("teamcity artifacts", () => {
  it("lists artifact metadata one directory at a time", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        count: 2,
        file: [
          {
            name: "results",
            children: {
              href: "/app/rest/builds/id:5/artifacts/children/results",
            },
          },
          {
            name: "build.log",
            size: 1_024,
            modificationTime: "20260915T101500+0300",
          },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "artifacts.list",
      { buildId: 5, path: "out" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe(
      "/app/rest/builds/id:5/artifacts/children/out",
    );
    expect(answer["items"]).toEqual([
      { name: "results", path: "out/results", kind: "directory" },
      {
        name: "build.log",
        path: "out/build.log",
        kind: "file",
        size: 1_024,
        modified: "2026-09-15T07:15:00.000Z",
      },
    ]);
  });

  it("reads a small text artifact and bounds it", async () => {
    const { calls, fetcher } = stub(() => ({ text: "PASS 12 tests" }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "artifacts.text",
      { buildId: 5, path: "out/report.txt" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe(
      "/app/rest/builds/id:5/artifacts/content/out/report.txt",
    );
    expect(answer).toMatchObject({
      buildId: 5,
      path: "out/report.txt",
      binary: false,
      truncated: false,
      content: "PASS 12 tests",
    });
  });

  it("refuses traversal, archives and binaries before asking TeamCity", async () => {
    const { calls, fetcher } = stub(() => ({ text: "x" }));
    const provider = new TeamcityProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const path of [
      "../../etc/passwd",
      "/etc/passwd",
      "out/../../secret",
      "out/build.zip!/inner.txt",
      "out\\report.txt",
      "out/\u0000report.txt",
    ]) {
      await expect(
        provider.execute({ credential }, "artifacts.text", {
          buildId: 5,
          path,
        }),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    // Naming an archive is refused outright: extraction is not on the table.
    await expect(
      provider.execute({ credential }, "artifacts.text", {
        buildId: 5,
        path: "out/report.zip",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toHaveLength(0);
  });

  it("answers a binary artifact with metadata instead of bytes", async () => {
    const { fetcher } = stub(() => ({
      headers: { "content-type": "application/octet-stream" },
      text: "\u0000\u0001binary",
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "artifacts.text",
      { buildId: 5, path: "out/dump" },
    )) as Record<string, unknown>;
    expect(answer["binary"]).toBe(true);
    expect(answer["content"]).toBeUndefined();
  });

  it("keeps the prefix that fits when an artifact is larger than the budget", async () => {
    const { fetcher } = stub(() => ({ text: "x".repeat(4_096) }));
    const provider = new TeamcityProvider(
      config({ defaultArtifactBytes: 1_024 }),
      fetcher,
    );
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "artifacts.text",
      { buildId: 5, path: "out/report.txt" },
    )) as Record<string, unknown>;
    expect(answer["truncated"]).toBe(true);
    expect(String(answer["content"])).toHaveLength(1_024);
  });
});
