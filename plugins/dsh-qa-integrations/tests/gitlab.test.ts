import { resolveConfig } from "../src/config.js";
import { IntegrationError } from "../src/errors.js";
import {
  resolveGitlabConfig,
  type GitlabFlags,
} from "../src/providers/gitlab/config.js";
import { GitlabProvider } from "../src/providers/gitlab/index.js";

const TOKEN = "glpat-abcdefghij0123456789";

const GITLAB_COM = {
  id: "gitlab-com",
  label: "GitLab.com",
  baseUrl: "https://gitlab.com",
};
const CORP = {
  id: "corp",
  label: "Corporate GitLab",
  baseUrl: "https://gitlab.example.internal",
};
const INSTANCES = [GITLAB_COM, CORP];

function config(gitlab: Partial<GitlabFlags> = {}) {
  return resolveConfig({ gitlab: { instances: INSTANCES, ...gitlab } });
}

interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
}

interface StubCall {
  readonly url: URL;
  readonly init: RequestInit;
}

function stub(handler: (url: URL) => StubResult) {
  const calls: StubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    const result = handler(url);
    const headers = new Headers(result.headers ?? {});
    const status = result.status ?? 200;
    if (result.json !== undefined) {
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(result.json), { status, headers });
    }
    headers.set("content-type", headers.get("content-type") ?? "text/plain");
    return new Response(result.text ?? "", { status, headers });
  };
  return { calls, fetcher };
}

const USER = { id: 153, username: "alice", name: "Alice Example" };

/** Credential plaintext as `parseCredential` stores it. */
function credentialFor(instanceId: string, fetcher: typeof fetch) {
  const provider = new GitlabProvider(config(), fetcher);
  return provider.parseCredential(TOKEN, { instanceId }).credential;
}

describe("gitlab instance configuration", () => {
  it("canonicalizes configured instances and rejects unsafe ones", () => {
    const flags = resolveGitlabConfig({
      instances: [
        { id: "com", label: "", baseUrl: "https://gitlab.com/" },
        {
          id: "self",
          label: "Self",
          baseUrl: "https://example.com/gitlab/",
        },
      ],
    });
    expect(flags.instances).toEqual([
      { id: "com", label: "gitlab.com", baseUrl: "https://gitlab.com" },
      {
        id: "self",
        label: "Self",
        baseUrl: "https://example.com/gitlab",
      },
    ]);
    expect(flags.enabled).toBe(true);
    expect(flags.instances).toHaveLength(2);

    for (const bad of [
      // Production instances answer over HTTPS; plain HTTP is opt-in.
      { id: "plain", label: "x", baseUrl: "http://gitlab.example.com" },
      // No credentials and no query belong in a configured address.
      { id: "creds", label: "x", baseUrl: "https://user:pw@gitlab.com" },
      { id: "query", label: "x", baseUrl: "https://gitlab.com?x=1" },
      // Ids are the stable key the stored credential names.
      { id: "Bad Id", label: "x", baseUrl: "https://gitlab.com" },
      { id: "protocol", label: "x", baseUrl: "ftp://gitlab.com" },
      { id: "not-a-url", label: "x", baseUrl: "gitlab.com" },
    ]) {
      expect(() => resolveGitlabConfig({ instances: [bad] })).toThrow(
        /gitlab integration config/u,
      );
    }
    expect(() =>
      resolveGitlabConfig({
        instances: [
          { id: "same", label: "a", baseUrl: "https://a.example" },
          { id: "same", label: "b", baseUrl: "https://b.example" },
        ],
      }),
    ).toThrow(/duplicate/u);
  });

  it("allows plain HTTP only when the deployment says so", () => {
    const flags = resolveGitlabConfig({
      allowInsecureHttp: true,
      instances: [
        { id: "lab", label: "Lab", baseUrl: "http://gitlab.lan:8080/" },
      ],
    });
    expect(flags.instances[0]?.baseUrl).toBe("http://gitlab.lan:8080");
  });
});

describe("gitlab connect form", () => {
  it("accepts a token only as a token, never as a pasted URL", () => {
    const provider = new GitlabProvider(
      config({ instances: [GITLAB_COM] }),
      stub(() => ({})).fetcher,
    );
    for (const bad of [
      "https://gitlab.com/-/user_settings/personal_access_tokens",
      "glpat short",
      "short",
      "glpat-abcdefghij0123456789\nmore",
    ]) {
      expect(() => provider.parseCredential(bad)).toThrow(
        /personal access token/u,
      );
    }
    // Surrounding whitespace is a paste artifact, not part of the token.
    expect(provider.parseCredential(` ${TOKEN} `).credential).toContain(TOKEN);
  });

  it("binds the token to a configured instance and refuses unknown ones", () => {
    const { fetcher } = stub(() => ({}));
    const provider = new GitlabProvider(config(), fetcher);
    // One configured instance may be implied; two must be chosen explicitly.
    const many = new GitlabProvider(config({ instances: INSTANCES }), fetcher);
    expect(() => many.parseCredential(TOKEN)).toThrow(/Choose a GitLab/u);

    const single = new GitlabProvider(
      config({ instances: [GITLAB_COM] }),
      fetcher,
    );
    const parsed = single.parseCredential(TOKEN);
    expect(parsed.portal).toBe("https://gitlab.com");
    expect(JSON.parse(parsed.credential)).toEqual({
      instanceId: "gitlab-com",
      token: TOKEN,
    });

    expect(() =>
      provider.parseCredential(TOKEN, { instanceId: "nope" }),
    ).toThrow(/Unknown GitLab instance/u);
    const none = new GitlabProvider(config({ instances: [] }), fetcher);
    expect(() => none.parseCredential(TOKEN)).toThrow(
      /No GitLab instance is configured/u,
    );
  });
});

describe("gitlab connection validation", () => {
  it("offers only the capabilities the token scopes actually grant", async () => {
    const { calls, fetcher } = stub((url) =>
      url.pathname.endsWith("/user")
        ? { json: USER }
        : { json: { scopes: ["read_api"] } },
    );
    const provider = new GitlabProvider(config(), fetcher);
    const validation = await provider.validate({
      credential: credentialFor("gitlab-com", fetcher),
    });
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/api/v4/user",
      "/api/v4/personal_access_tokens/self",
    ]);
    expect(validation).toEqual({
      tenantId: "https://gitlab.com",
      externalUserId: "153",
      displayName: "Alice Example (@alice)",
      capabilities: [
        "identity.read",
        "projects.read",
        "repository.read",
        "search.read",
        "issues.read",
        "merge_requests.read",
        "ci.read",
      ],
    });
  });

  it("keeps read_repository and read_user narrow instead of guessing", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/user")
        ? { json: USER }
        : { json: { scopes: ["read_user", "read_repository"] } },
    );
    const provider = new GitlabProvider(config(), fetcher);
    const validation = await provider.validate({
      credential: credentialFor("gitlab-com", fetcher),
    });
    expect(validation.capabilities).toEqual([
      "identity.read",
      "repository.read",
    ]);
  });

  it("falls back to the deployment switches when the token cannot read itself", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/user")
        ? { json: USER }
        : { status: 403, json: { message: "403 Forbidden" } },
    );
    const provider = new GitlabProvider(config({ ciRead: false }), fetcher);
    const validation = await provider.validate({
      credential: credentialFor("gitlab-com", fetcher),
    });
    expect(validation.capabilities).not.toContain("ci.read");
    expect(validation.capabilities).toContain("projects.read");
  });

  it("fails closed for an expired token and for a removed instance", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/user")
        ? { json: USER }
        : {
            json: {
              scopes: ["read_api"],
              expires_at: "2020-01-01",
            },
          },
    );
    const provider = new GitlabProvider(config(), fetcher);
    await expect(
      provider.validate({ credential: credentialFor("gitlab-com", fetcher) }),
    ).rejects.toMatchObject({ code: "CredentialExpired" });

    // The operator removed the instance the stored credential belongs to: it
    // must never fall back to another configured instance.
    const other = new GitlabProvider(config({ instances: [CORP] }), fetcher);
    await expect(
      other.validate({ credential: credentialFor("gitlab-com", fetcher) }),
    ).rejects.toMatchObject({ code: "CredentialRevoked" });
  });
});

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
      (await import("../src/providers/gitlab/catalog.js")).GITLAB_OPERATIONS,
    )) {
      expect(provider.operationCapability(operation), operation).toBeDefined();
    }
  });
});

describe("gitlab upstream failures", () => {
  const cases: readonly [number, string][] = [
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [400, "InvalidRequest"],
    [500, "ProviderUnavailable"],
  ];

  it("maps statuses onto the provider error model without upstream bodies", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({
        status,
        json: { message: "internal detail with glpat-abcdefghij0123456789" },
      }));
      const provider = new GitlabProvider(config({ retries: 0 }), fetcher);
      const credential = credentialFor("gitlab-com", fetcher);
      await expect(
        provider.execute({ credential }, "projects.get", { project: 1 }),
      ).rejects.toMatchObject({ code });
      try {
        await provider.execute({ credential }, "projects.get", { project: 1 });
      } catch (error) {
        expect((error as IntegrationError).message).not.toContain("internal");
        expect((error as IntegrationError).message).not.toContain(TOKEN);
      }
    }
  });

  it("retries a throttled read and reports the typed error when it persists", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ id: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };
    const provider = new GitlabProvider(config({ retries: 1 }), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor("gitlab-com", fetcher) },
        "projects.get",
        { project: 1 },
      ),
    ).resolves.toMatchObject({ id: 1 });
    expect(attempts).toBe(2);

    const throttled = new GitlabProvider(config({ retries: 0 }), () =>
      Promise.resolve(
        new Response(null, { status: 429, headers: { "retry-after": "0" } }),
      ),
    );
    await expect(
      throttled.execute(
        { credential: credentialFor("gitlab-com", throttled as never) },
        "projects.get",
        { project: 1 },
      ),
    ).rejects.toMatchObject({ code: "RateLimited" });
  });

  it("does not retry an authorization answer", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return new Response(null, { status: 403 });
    };
    const provider = new GitlabProvider(config({ retries: 3 }), fetcher);
    await expect(
      provider.execute(
        { credential: credentialFor("gitlab-com", fetcher) },
        "projects.get",
        { project: 1 },
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(attempts).toBe(1);
  });
});
