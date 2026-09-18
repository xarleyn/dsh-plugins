import { resolveConfig } from "../../src/config.js";
import { GitlabProvider } from "../../src/providers/gitlab/index.js";
import {
  INSTANCES,
  TOKEN,
  USER,
  config,
  credentialFor,
  stub,
} from "./shared.js";

describe("gitlab operations", () => {
  it("sends documented read endpoints with bounded paging", async () => {
    const { calls, fetcher } = stub((url) =>
      url.pathname.includes("/issues")
        ? {
            json: [{ iid: 5 }],
            headers: { "x-page": "2", "x-per-page": "20", "x-next-page": "3" },
          }
        : { json: { id: 7 } },
    );
    const provider = new GitlabProvider(config(), fetcher);
    const credential = credentialFor("corp", fetcher);

    await expect(
      provider.execute({ credential }, "issues.list", {
        project: "group/subgroup/service",
        page: 2,
        labels: ["bug", "urgent"],
      }),
    ).resolves.toEqual({
      items: [{ iid: 5, labels: [], assignees: [] }],
      pagination: { page: 2, perPage: 20, nextPage: 3 },
    });
    expect(calls[0]?.url.pathname).toBe(
      "/api/v4/projects/group%2Fsubgroup%2Fservice/issues",
    );
    expect(calls[0]?.url.searchParams.get("labels")).toBe("bug,urgent");
    expect(calls[0]?.url.searchParams.get("page")).toBe("2");
    // GitLab's own default page size applies when the caller names none.
    expect(calls[0]?.url.searchParams.get("per_page")).toBe(null);
    // The project variant leaves the scope to GitLab; the global one asks for
    // everything the token may read instead of GitLab's "created by me".
    expect(calls[0]?.url.searchParams.get("scope")).toBe(null);

    await provider.execute({ credential }, "issues.list", {});
    expect(calls[1]?.url.pathname).toBe("/api/v4/issues");
    expect(calls[1]?.url.searchParams.get("scope")).toBe("all");
  });

  it("never puts the token anywhere but the private-token header", async () => {
    const { calls, fetcher } = stub(() => ({ json: USER }));
    const provider = new GitlabProvider(config(), fetcher);
    await provider.execute(
      { credential: credentialFor("gitlab-com", fetcher) },
      "connection.get",
      {},
    );
    expect(calls[0]?.init.headers).toMatchObject({ "private-token": TOKEN });
    expect(calls[0]?.init.redirect).toBe("error");
    expect(JSON.stringify(calls[0]?.url.href)).not.toContain(TOKEN);
  });

  it("resolves file paths and refs itself and refuses traversal", async () => {
    const { calls, fetcher } = stub(() => ({
      json: {
        file_name: "README.md",
        file_path: "docs/README.md",
        size: 11,
        encoding: "base64",
        content: Buffer.from("hello world").toString("base64"),
      },
    }));
    const provider = new GitlabProvider(config(), fetcher);
    const credential = credentialFor("gitlab-com", fetcher);
    await expect(
      provider.execute({ credential }, "repository.file", {
        project: 12,
        path: "docs/README.md",
      }),
    ).resolves.toMatchObject({ size: 11, content: "hello world" });
    expect(calls[0]?.url.pathname).toBe(
      "/api/v4/projects/12/repository/files/docs%2FREADME.md",
    );
    // HEAD lets GitLab resolve the project's default branch itself.
    expect(calls[0]?.url.searchParams.get("ref")).toBe("HEAD");

    for (const input of [
      { project: 12, path: "../../etc/passwd" },
      { project: "group/../other", path: "README.md" },
      { project: 12, path: "README.md", ref: "main/../../etc" },
    ]) {
      await expect(
        provider.execute({ credential }, "repository.file", input),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(1);
  });

  it("marks a binary file instead of putting bytes in context", async () => {
    const { fetcher } = stub(() => ({
      json: {
        file_name: "logo.png",
        size: 8,
        encoding: "base64",
        content: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03,
        ]).toString("base64"),
      },
    }));
    const provider = new GitlabProvider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor("gitlab-com", fetcher) },
        "repository.file",
        { project: 12, path: "logo.png" },
      ),
    ).resolves.toMatchObject({ binary: true });
    const answer = (await provider.execute(
      { credential: credentialFor("gitlab-com", fetcher) },
      "repository.file",
      { project: 12, path: "logo.png" },
    )) as Record<string, unknown>;
    expect(answer["content"]).toBeUndefined();
  });

  it("falls back to the raw endpoint when GitLab inlines too much for one answer", async () => {
    const config = resolveConfig({
      maxResponseBytes: 2_048,
      gitlab: { instances: INSTANCES },
    });
    const { calls, fetcher } = stub((url) =>
      url.pathname.endsWith("/raw")
        ? { text: "x".repeat(3_000) }
        : {
            // The metadata call answers with a body over the transport cap.
            json: {
              file_name: "big.txt",
              content: "y".repeat(4_000),
              encoding: "base64",
            },
          },
    );
    const provider = new GitlabProvider(config, fetcher);
    const credential = provider.parseCredential(TOKEN, {
      instanceId: "gitlab-com",
    }).credential;
    const answer = (await provider.execute({ credential }, "repository.file", {
      project: 12,
      path: "big.txt",
      maxBytes: 1_500,
    })) as Record<string, unknown>;
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/api/v4/projects/12/repository/files/big.txt",
      "/api/v4/projects/12/repository/files/big.txt/raw",
    ]);
    expect(answer["truncated"]).toBe(true);
    expect(answer["content"]).toHaveLength(1_500);
    expect(answer["binary"]).toBe(false);
  });

  it("answers CI logs as bounded, redacted text", async () => {
    const { calls, fetcher } = stub(() => ({
      text: [
        "$ deploy --token glpat-abcdefghij0123456789",
        "Access-Token: super-secret-value",
      ].join("\n"),
    }));
    const provider = new GitlabProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor("corp", fetcher) },
      "jobs.log",
      { project: "group/service", jobId: 91 },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe(
      "/api/v4/projects/group%2Fservice/jobs/91/trace",
    );
    expect(String(answer["log"])).not.toContain(TOKEN);
    expect(String(answer["log"])).toContain("[REDACTED]");
    expect(answer["truncated"]).toBe(false);
    expect(answer["jobId"]).toBe("91");
  });

  it("reads merge request diffs from the endpoint GitLab still maintains", async () => {
    const { calls, fetcher } = stub(() => ({
      json: [
        { old_path: "a.txt", new_path: "a.txt", diff: "@@ -1 +1 @@" },
        { old_path: "b.txt", new_path: "b.txt", diff: "@@ -2 +2 @@" },
      ],
    }));
    const provider = new GitlabProvider(config(), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor("gitlab-com", fetcher) },
        "mergeRequests.changes",
        { project: 5, iid: 77 },
      ),
    ).resolves.toMatchObject({
      items: [{ newPath: "a.txt" }, { newPath: "b.txt" }],
    });
    expect(calls[0]?.url.pathname).toBe(
      "/api/v4/projects/5/merge_requests/77/diffs",
    );
  });

  it("keeps code search inside a project or a group", async () => {
    const { calls, fetcher } = stub(() => ({ json: [] }));
    const provider = new GitlabProvider(config(), fetcher);
    const credential = credentialFor("gitlab-com", fetcher);
    await expect(
      provider.execute({ credential }, "search.run", {
        query: "timeout",
        scope: "blobs",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    await expect(
      provider.execute({ credential }, "search.run", {
        query: "timeout",
        scope: "blobs",
        project: "group/service",
      }),
    ).resolves.toMatchObject({ items: [] });
    expect(calls[0]?.url.pathname).toBe(
      "/api/v4/projects/group%2Fservice/search",
    );
    // An unknown scope is refused rather than forwarded as a broader preset.
    await expect(
      provider.execute({ credential }, "search.run", {
        query: "x",
        scope: "everything",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
  });

  it("refuses any operation the catalog does not declare", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new GitlabProvider(config(), fetcher);
    const credential = credentialFor("gitlab-com", fetcher);
    for (const operation of ["raw_api", "issues.create", "repository.push"]) {
      await expect(
        provider.execute({ credential }, operation, {}),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
    // Every declared operation maps onto a capability the broker can police.
    for (const operation of Object.keys(
      (await import("../../src/providers/gitlab/catalog.js")).GITLAB_OPERATIONS,
    )) {
      expect(provider.operationCapability(operation), operation).toBeDefined();
    }
  });
});
