import { resolveGitlabConfig } from "../../src/providers/gitlab/config.js";
import { GitlabProvider } from "../../src/providers/gitlab/index.js";
import {
  CORP,
  GITLAB_COM,
  INSTANCES,
  TOKEN,
  USER,
  config,
  credentialFor,
  stub,
} from "./shared.js";

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
        "ci.metadata.read",
        "ci.logs.read",
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
    const provider = new GitlabProvider(
      config({ ciMetadataRead: false, ciLogsRead: false }),
      fetcher,
    );
    const validation = await provider.validate({
      credential: credentialFor("gitlab-com", fetcher),
    });
    expect(validation.capabilities).not.toContain("ci.metadata.read");
    expect(validation.capabilities).not.toContain("ci.logs.read");
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
