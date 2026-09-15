import { resolveConfig } from "../src/config.js";
import { IntegrationError } from "../src/errors.js";
import {
  resolveTeamCityConfig,
  type TeamCityConfigInput,
} from "../src/providers/teamcity/config.js";
import { TeamcityProvider } from "../src/providers/teamcity/index.js";
import {
  buildBuildLocator,
  locatorValue,
  teamCityDate,
} from "../src/providers/teamcity/locators.js";
import {
  PRIVATE_CIDRS,
  cidrProblem,
  hostPatternProblem,
  serverUrlProblem,
} from "../src/providers/teamcity/network.js";
import { networkAllowsNothing } from "../src/providers/teamcity/config.js";
import {
  logMode,
  sanitizeLog,
  selectLogWindow,
} from "../src/providers/teamcity/logs.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

const SERVER = "https://teamcity.example.com";
const NETWORK = {
  mode: "allowlist" as const,
  allowedHosts: ["teamcity.example.com", "*.corp.example"],
  allowedCidrs: ["10.20.0.0/16"],
  allowedPorts: [443, 8111],
};

function config(teamcity: TeamCityConfigInput = {}) {
  return resolveConfig({ teamcity: { network: NETWORK, ...teamcity } });
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

const SERVER_INFO = {
  version: "2025.11",
  versionMajor: 2025,
  buildNumber: "1",
};
const USER = { id: 42, username: "alice", name: "Alice Example" };

/** Credential plaintext as `parseCredential` stores it. */
function credentialFor(
  fetcher: typeof fetch,
  serverUrl = SERVER,
  teamcity: TeamCityConfigInput = {},
) {
  return new TeamcityProvider(config(teamcity), fetcher).parseCredential(
    TOKEN,
    { serverUrl },
  ).credential;
}

describe("teamcity address policy", () => {
  it("canonicalizes the allowlist it is given", () => {
    const flags = resolveTeamCityConfig({
      network: {
        ...NETWORK,
        allowedHosts: ["TeamCity.Example.COM", "*.Corp.Example"],
      },
    });
    expect(flags.network).toEqual({
      mode: "allowlist",
      allowedHosts: ["teamcity.example.com", "*.corp.example"],
      allowedCidrs: ["10.20.0.0/16"],
      allowedPorts: [443, 8111],
      allowHttp: false,
    });
    expect(() =>
      resolveTeamCityConfig({ network: { mode: "yolo" } as never }),
    ).toThrow(/network.mode/u);
  });

  it("stays inert by default and says so instead of failing to load", () => {
    // A deployment that mounts no TeamCity still has to start, so the empty
    // policy is a state rather than an error — one the plugin logs.
    const empty = resolveTeamCityConfig();
    expect(networkAllowsNothing(empty.network)).toBe(true);
    expect(serverUrlProblem(SERVER, empty.network)).toBeDefined();
    expect(
      networkAllowsNothing(resolveTeamCityConfig({ network: NETWORK }).network),
    ).toBe(false);
  });

  it("fails loudly on an operator typo instead of dropping an entry", () => {
    for (const allowedHosts of [
      ["10.0.0.7"],
      ["*corp.example"],
      ["host name"],
    ]) {
      expect(() =>
        resolveTeamCityConfig({ network: { allowedHosts } }),
      ).toThrow(/allowedHosts/u);
    }
    for (const allowedCidrs of [["10.0.0.0/33"], ["10.0.0"], ["nope"]]) {
      expect(() =>
        resolveTeamCityConfig({ network: { allowedCidrs } }),
      ).toThrow(/allowedCidrs/u);
    }
    expect(hostPatternProblem("*.corp.example")).toBeUndefined();
    expect(cidrProblem("192.168.0.0/16")).toBeUndefined();
    // Ports are explicit: an unlisted port is refused rather than guessed at.
    expect(
      resolveTeamCityConfig({ network: { ...NETWORK, allowedPorts: [8111] } })
        .network.allowedPorts,
    ).toEqual([8111]);
  });

  it("takes private ranges as the default only in trusted-private mode", () => {
    const trusted = resolveTeamCityConfig({
      network: { mode: "trusted-private", allowHttp: true },
    });
    expect(trusted.network.allowedCidrs).toEqual(PRIVATE_CIDRS);
    // Plain HTTP implies the scheme's own port unless the operator names more.
    expect(trusted.network.allowedPorts).toEqual([80]);
    expect(
      resolveTeamCityConfig({ network: { mode: "trusted-private" } }).network
        .allowedPorts,
    ).toEqual([443]);
  });

  it("refuses addresses the deployment did not allow", () => {
    const allowed: readonly string[] = [
      "https://teamcity.example.com",
      "https://teamcity.example.com/teamcity",
      "https://ci.corp.example",
      "https://teamcity.example.com:8111",
      "https://10.20.1.5",
    ];
    for (const url of allowed) {
      expect(serverUrlProblem(url, config().teamcity.network)).toBeUndefined();
    }
    const refused: readonly string[] = [
      // Not in the allowlist, or an address where a name belongs.
      "https://evil.example.com",
      "https://10.21.1.5",
      "https://teamcity.example.com.evil.net",
      // Plain HTTP, a port nobody allowed, credentials or a query in the URL.
      "http://teamcity.example.com",
      "https://teamcity.example.com:8080",
      "https://user:pw@teamcity.example.com",
      "https://teamcity.example.com?x=1",
      "ftp://teamcity.example.com",
      "teamcity.example.com",
      "",
    ];
    for (const url of refused) {
      expect(
        serverUrlProblem(url, config().teamcity.network),
        url,
      ).toBeDefined();
    }
    // A wildcard never matches the domain itself, and plain HTTP needs the
    // deployment's explicit consent.
    expect(
      serverUrlProblem("https://corp.example", config().teamcity.network),
    ).toBeDefined();
    expect(
      serverUrlProblem(
        "http://teamcity.example.com",
        config().teamcity.network,
      ),
    ).toBeDefined();
    expect(
      serverUrlProblem(
        "http://teamcity.example.com",
        resolveTeamCityConfig({
          network: { ...NETWORK, allowHttp: true, allowedPorts: [80] },
        }).network,
      ),
    ).toBeUndefined();
  });
});

describe("teamcity connect form", () => {
  it("accepts a token only as a token, never as a pasted URL", () => {
    const provider = new TeamcityProvider(config(), stub(() => ({})).fetcher);
    for (const bad of [
      "https://teamcity.example.com/app/rest/users/current",
      "short",
      `${TOKEN}\nmore`,
      "",
    ]) {
      expect(() =>
        provider.parseCredential(bad, { serverUrl: SERVER }),
      ).toThrow(/access token/u);
    }
  });

  it("binds the token to the address the connect form named", () => {
    const provider = new TeamcityProvider(config(), stub(() => ({})).fetcher);
    const parsed = provider.parseCredential(TOKEN, {
      serverUrl: "https://teamcity.example.com/teamcity/",
    });
    // A trailing slash would double up against the REST root.
    expect(parsed.portal).toBe("https://teamcity.example.com/teamcity");
    expect(JSON.parse(parsed.credential)).toEqual({
      serverUrl: "https://teamcity.example.com/teamcity",
      token: TOKEN,
    });
    // Surrounding whitespace is a paste artifact, not part of the token.
    expect(
      provider.parseCredential(` ${TOKEN} `, { serverUrl: SERVER }).credential,
    ).toContain(TOKEN);
    expect(() =>
      provider.parseCredential(TOKEN, { serverUrl: "https://nope" }),
    ).toThrow(/not allowed/u);
    expect(() => provider.parseCredential(TOKEN)).toThrow(/invalid|allowed/u);
  });

  it("re-checks the address on every call, not only when it was stored", async () => {
    const { fetcher } = stub(() => ({ json: SERVER_INFO }));
    const credential = credentialFor(fetcher);
    // The operator dropped the host from the allowlist: the stored connection
    // stops working instead of staying a hole in the new policy.
    const narrowed = new TeamcityProvider(
      config({ network: { ...NETWORK, allowedHosts: ["other.example.com"] } }),
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

describe("teamcity locators", () => {
  it("keeps plain values plain and encodes the ones that would break the parser", () => {
    expect(locatorValue("MyProject_Build")).toBe("MyProject_Build");
    expect(locatorValue("feature/MDC-123")).toBe("feature/MDC-123");
    // TeamCity's locator has no escape character, so a value with a comma, a
    // colon or a parenthesis goes through the documented `$base64:` form.
    const encoded = locatorValue("release,2026: (hotfix)");
    expect(encoded).toMatch(/^\(\$base64:[A-Za-z0-9_-]+\)$/u);
    expect(Buffer.from(encoded.slice(9, -1), "base64url").toString()).toBe(
      "release,2026: (hotfix)",
    );
    expect(locatorValue("back\\slash")).toContain("$base64:");
  });

  it("builds build locators without ever accepting one from the model", () => {
    expect(
      buildBuildLocator({
        buildTypeId: "MyProject_Build",
        branch: "feature/MDC-123",
        status: "FAILURE",
        state: "finished",
        since: "20260901T000000+0000",
        count: 50,
      }),
    ).toBe(
      "buildType:(id:MyProject_Build),branch:(name:feature/MDC-123),status:FAILURE,state:finished,sinceDate:20260901T000000+0000,count:50",
    );
    // TeamCity hides personal builds behind its default filter, so asking for
    // them has to drop that filter or the answer would be empty.
    expect(buildBuildLocator({ personal: true })).toBe(
      "personal:true,defaultFilter:false",
    );
    expect(buildBuildLocator({})).toBe("");
  });

  it("formats dates in TeamCity's own shape, in UTC", () => {
    expect(teamCityDate("2026-09-01")).toBe("20260901T000000+0000");
    expect(teamCityDate("2026-09-01T12:34:56Z")).toBe("20260901T123456+0000");
    expect(teamCityDate("2026-09-01T15:34:56+03:00")).toBe(
      "20260901T123456+0000",
    );
    expect(teamCityDate("yesterday")).toBeUndefined();
  });
});

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
            branchName: "feature/MDC-123",
            startDate: "20260915T101500+0300",
            finishDate: "20260915T102000+0300",
            webUrl: `${SERVER}/viewLog.html?buildId=81234`,
            buildType: { id: "MDC_Backend", name: "Backend" },
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
        projectId: "MDC",
        branch: "feature/MDC-123",
        status: "FAILURE",
        since: "2026-09-01",
        // Above the deployment cap for this collection, which clamps.
        limit: 500,
      },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/app/rest/builds");
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "project:(id:MDC),branch:(name:feature/MDC-123),status:FAILURE,sinceDate:20260901T000000+0000,count:50",
    );
    expect(calls[0]?.url.searchParams.get("fields")).toContain("buildType(");
    expect(answer["items"]).toEqual([
      expect.objectContaining({
        id: 81234,
        status: "FAILURE",
        // TeamCity's dates are not ISO-8601; the model gets ISO-8601.
        startedAt: "2026-09-15T07:15:00.000Z",
        finishedAt: "2026-09-15T07:20:00.000Z",
        buildType: { id: "MDC_Backend", name: "Backend" },
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
      { projectId: "MDC/../other" },
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
            buildType: { id: "MDC_Backend" },
          },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    await expect(
      provider.execute({ credential: credentialFor(fetcher) }, "queue.list", {
        buildTypeId: "MDC_Backend",
      }),
    ).resolves.toMatchObject({ items: [{ id: 900, state: "queued" }] });
    expect(calls[0]?.url.pathname).toBe("/app/rest/buildQueue");
    expect(calls[0]?.url.searchParams.get("locator")).toBe(
      "buildType:(id:MDC_Backend),count:50",
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
          { id: "MDC", name: "MDC", parentProjectId: "_Root" },
          { id: "OLD", name: "Legacy", archived: true },
          { id: "MDC_LAB", name: "MDC Lab" },
        ],
        nextHref: "/app/rest/projects?locator=start:100",
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "projects.list",
      { query: "mdc" },
    )) as Record<string, unknown>;
    expect(
      (answer["items"] as readonly Record<string, unknown>[]).map(
        (project) => project["id"],
      ),
    ).toEqual(["MDC", "MDC_LAB"]);
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
          { id: "MDC_Backend", name: "Backend", projectId: "MDC" },
          { id: "MDC_Old", name: "Old", paused: true },
        ],
      },
    }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "buildConfigs.list",
      { projectId: "MDC" },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/app/rest/buildTypes");
    expect(calls[0]?.url.searchParams.get("locator")).toBe("project:(id:MDC)");
    expect(answer["items"]).toEqual([
      expect.objectContaining({ id: "MDC_Backend" }),
    ]);
  });
});

describe("teamcity build log", () => {
  const LOG = [
    "\u001B[32mStarting build\u001B[0m",
    "compiling…",
    "ERROR: cannot find symbol",
    "  at com.example.Main.main(Main.java:10)",
    "token=abcdefghijklmnopqrstuvwxyz012345",
    "BUILD FAILED",
  ].join("\n");

  it("returns the tail of the log, cleaned and redacted", async () => {
    const { calls, fetcher } = stub(() => ({ text: LOG }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, mode: "tail", maxLines: 3 },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/downloadBuildLog.html");
    expect(calls[0]?.url.searchParams.get("buildId")).toBe("5");
    expect(calls[0]?.url.searchParams.get("plain")).toBe("true");
    expect(answer["returnedLines"]).toBe(3);
    expect(answer["truncated"]).toBe(true);
    expect(answer["logTruncated"]).toBe(false);
    const text = String(answer["text"]);
    // Terminal colouring is gone, and a printed secret is not handed over.
    expect(text).not.toContain("\u001B");
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("[REDACTED]");
    expect(text.endsWith("BUILD FAILED")).toBe(true);
  });

  it("finds lines the model asks about, with context and gap markers", async () => {
    const { fetcher } = stub(() => ({ text: LOG }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, mode: "search", query: "ERROR", maxLines: 10 },
    )) as Record<string, unknown>;
    expect(answer["matched"]).toBe(1);
    expect(String(answer["text"])).toContain("cannot find symbol");
    expect(String(answer["text"])).toContain("compiling");
    // A required query is the one thing search cannot do without.
    await expect(
      provider.execute({ credential: credentialFor(fetcher) }, "builds.log", {
        buildId: 5,
        mode: "search",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(() => logMode("middle")).toThrow(IntegrationError);
  });

  it("says so when the log is longer than the deployment download budget", async () => {
    const big = Array.from(
      { length: 4_000 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const { fetcher } = stub(() => ({ text: big }));
    const provider = new TeamcityProvider(
      config({ maxLogBytes: 2_048, maxLogLines: 100 }),
      fetcher,
    );
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, mode: "tail", maxLines: 5 },
    )) as Record<string, unknown>;
    expect(answer["logTruncated"]).toBe(true);
    expect(answer["returnedLines"]).toBe(5);
    // The window is the end of what was downloaded, and the answer says so.
    expect(String(answer["text"]).split("\n")).toHaveLength(5);
  });

  it("never answers with more lines than the deployment allows", async () => {
    const { fetcher } = stub(() => ({ text: "a\nb\nc\nd\ne" }));
    const provider = new TeamcityProvider(config({ maxLogLines: 2 }), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, maxLines: 500 },
    )) as Record<string, unknown>;
    expect(answer["returnedLines"]).toBe(2);
  });

  it("strips what a log can carry and repairs what cannot be encoded", () => {
    const cleaned = sanitizeLog(
      "a\u001B[31mb\u001B[0m\u0007c\r\nd\uD800e\u001B]0;title\u0007f",
    );
    expect(cleaned).toBe("abc\nd\uFFFDe f".replace(" f", "f"));
    expect(selectLogWindow("x\ny\nz", "head", 2, undefined).text).toBe("x\ny");
    expect(selectLogWindow("x\ny\nz", "tail", 2, undefined).text).toBe("y\nz");
  });
});

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

describe("teamcity upstream failures", () => {
  const cases: readonly [number, string][] = [
    [400, "InvalidRequest"],
    [401, "CredentialRevoked"],
    [403, "ProviderPermissionDenied"],
    [404, "ResourceNotFound"],
    [429, "RateLimited"],
    [500, "ProviderUnavailable"],
    [503, "ProviderUnavailable"],
  ];

  it("maps statuses onto the provider error model without upstream bodies", async () => {
    for (const [status, code] of cases) {
      const { fetcher } = stub(() => ({
        status,
        json: {
          message: `internal detail at teamcity.internal with ${TOKEN}`,
        },
      }));
      const provider = new TeamcityProvider(config({ retries: 0 }), fetcher);
      const credential = credentialFor(fetcher);
      await expect(
        provider.execute({ credential }, "builds.get", { buildId: 1 }),
      ).rejects.toMatchObject({ code });
      try {
        await provider.execute({ credential }, "builds.get", { buildId: 1 });
      } catch (error) {
        expect((error as IntegrationError).message).not.toContain("internal");
        expect((error as IntegrationError).message).not.toContain(TOKEN);
      }
    }
  });

  it("retries a throttled read, and does not retry an authorization answer", async () => {
    let throttled = 0;
    const throttling: typeof fetch = async () => {
      throttled += 1;
      return throttled === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ id: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };
    const provider = new TeamcityProvider(config({ retries: 1 }), throttling);
    await expect(
      provider.execute(
        { credential: credentialFor(throttling) },
        "builds.get",
        { buildId: 1 },
      ),
    ).resolves.toMatchObject({ id: 1 });
    expect(throttled).toBe(2);

    let denied = 0;
    const refusing: typeof fetch = async () => {
      denied += 1;
      return new Response(null, { status: 403 });
    };
    const deniedProvider = new TeamcityProvider(
      config({ retries: 3 }),
      refusing,
    );
    await expect(
      deniedProvider.execute(
        { credential: credentialFor(refusing) },
        "builds.get",
        { buildId: 1 },
      ),
    ).rejects.toMatchObject({ code: "ProviderPermissionDenied" });
    expect(denied).toBe(1);
  });

  it("separates a timeout and a TLS refusal from an unreachable host", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    const slow = new TeamcityProvider(
      resolveConfig({
        timeoutMs: 30,
        teamcity: { network: NETWORK, retries: 0 },
      }),
      hanging,
    );
    await expect(
      slow.execute({ credential: credentialFor(hanging) }, "builds.get", {
        buildId: 1,
      }),
    ).rejects.toMatchObject({ code: "UpstreamTimeout" });

    const untrusted: typeof fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("self signed certificate"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        }),
      });
    };
    const tls = new TeamcityProvider(config({ retries: 0 }), untrusted);
    await expect(
      tls.execute({ credential: credentialFor(untrusted) }, "builds.get", {
        buildId: 1,
      }),
    ).rejects.toMatchObject({ code: "TlsFailure" });
  });

  it("refuses any operation the catalog does not declare", async () => {
    const { calls, fetcher } = stub(() => ({ json: {} }));
    const provider = new TeamcityProvider(config(), fetcher);
    const credential = credentialFor(fetcher);
    for (const operation of [
      "raw_rest",
      "builds.trigger",
      "builds.cancel",
      "builds.comment",
      "agents.authorize",
    ]) {
      await expect(
        provider.execute({ credential }, operation, {}),
      ).rejects.toMatchObject({ code: "InvalidRequest" });
    }
    expect(calls).toHaveLength(0);
  });
});
