import { resolveTeamCityConfig } from "../../src/providers/teamcity/config.js";
import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import {
  config,
  credentialFor,
  NETWORK,
  SERVER,
  SERVER_INFO,
  stub,
  TOKEN,
  USER,
} from "./shared.js";

describe("teamcity connect form", () => {
  it("accepts a token only as a token, never as a pasted URL", () => {
    const provider = new TeamcityProvider(config(), stub(() => ({})).fetcher);
    for (const bad of [
      "https://teamcity.example.com/app/rest/users/current",
      "short",
      `${TOKEN}\nmore`,
      "",
    ]) {
      expect(() => provider.parseCredential(bad)).toThrow(/access token/u);
    }
  });

  it("keeps the address out of the stored credential", () => {
    const provider = new TeamcityProvider(config(), stub(() => ({})).fetcher);
    const parsed = provider.parseCredential(TOKEN);
    // The server a token is spent against is the deployment's configuration, so
    // nothing about it travels with the secret: repointing the deployment
    // cannot leave a connection dialling an address a user once typed.
    expect(JSON.parse(parsed.credential)).toEqual({ token: TOKEN });
    expect(parsed.portal).toBe(SERVER);
    // Surrounding whitespace is a paste artifact, not part of the token.
    expect(provider.parseCredential(` ${TOKEN} `).credential).toContain(TOKEN);
  });

  it("stores nothing while the deployment configured no address", () => {
    const provider = new TeamcityProvider(
      config({ serverUrl: "" }),
      stub(() => ({})).fetcher,
    );
    expect(() => provider.parseCredential(TOKEN)).toThrow(
      /no TeamCity address/u,
    );
  });

  it("dials nothing while the deployment configured no address", async () => {
    const provider = new TeamcityProvider(
      config({ serverUrl: "" }),
      stub(() => ({ json: SERVER_INFO })).fetcher,
    );
    await expect(
      provider.execute(
        { credential: JSON.stringify({ token: TOKEN }) },
        "connection.get",
        {},
      ),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
  });

  it("refuses at load an address its own policy would not dial", () => {
    // A typo here would otherwise leave every user with a form that cannot be
    // saved and no explanation, so it fails where the operator can see it.
    expect(() =>
      resolveTeamCityConfig({
        serverUrl: "https://nope.example.com",
        network: { ...NETWORK, allowedHosts: ["other.example.com"] },
      }),
    ).toThrow(/serverUrl/u);
  });

  it("canonicalizes the configured address and accepts none at all", () => {
    const trailing = resolveTeamCityConfig({
      serverUrl: "https://teamcity.example.com/teamcity/",
      network: NETWORK,
    });
    // A trailing slash would double up against the REST root.
    expect(trailing.serverUrl).toBe("https://teamcity.example.com/teamcity");
    expect(resolveTeamCityConfig({ network: NETWORK }).serverUrl).toBe("");
  });

  it("re-checks the address against the policy it is dialled with", async () => {
    const { fetcher } = stub(() => ({ json: SERVER_INFO }));
    const credential = credentialFor(fetcher);
    // Defensive half of the load-time check: a provider handed flags whose
    // policy no longer covers the address refuses instead of dialling a host
    // the deployment has stopped allowing.
    const narrowed = new TeamcityProvider(
      {
        ...config(),
        teamcity: {
          ...config().teamcity,
          network: {
            ...config().teamcity.network,
            allowedHosts: ["other.example.com"],
          },
        },
      },
      fetcher,
    );
    await expect(
      narrowed.execute({ credential }, "connection.get", {}),
    ).rejects.toMatchObject({ code: "ProviderUnavailable" });
  });
});

describe("teamcity connection validation", () => {
  it("reads the two documented discovery endpoints with the token in a header", async () => {
    const { calls, fetcher } = stub((url) =>
      url.pathname.endsWith("/server") ? { json: SERVER_INFO } : { json: USER },
    );
    const provider = new TeamcityProvider(config(), fetcher);
    const validation = await provider.validate({
      credential: credentialFor(fetcher),
    });
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/app/rest/server",
      "/app/rest/users/current",
    ]);
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
    });
    expect(JSON.stringify(calls.map(({ url }) => url.href))).not.toContain(
      TOKEN,
    );
    expect(validation).toEqual({
      tenantId: SERVER,
      externalUserId: "42",
      displayName: "Alice Example (@alice) · TeamCity 2025.11",
      capabilities: [
        "identity.read",
        "projects.read",
        "buildConfigs.read",
        "builds.read",
        "failures.read",
        "logs.read",
        "queue.read",
        "investigations.read",
        "agents.read",
        "artifacts.read",
      ],
    });
  });

  it("narrows the offered capabilities to the deployment switches", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith("/server") ? { json: SERVER_INFO } : { json: USER },
    );
    const provider = new TeamcityProvider(
      config({ logsRead: false, artifactsRead: false, agentsRead: false }),
      fetcher,
    );
    const validation = await provider.validate({
      credential: credentialFor(fetcher),
    });
    expect(validation.capabilities).not.toContain("logs.read");
    expect(validation.capabilities).not.toContain("artifacts.read");
    expect(validation.capabilities).toContain("builds.read");
  });
});
