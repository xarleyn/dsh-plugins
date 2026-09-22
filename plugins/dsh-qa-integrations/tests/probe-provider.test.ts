import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The provider probe (`scripts/probe-provider.mjs` at the repository root) is
 * what a human runs against a real instance before calling a provider done —
 * see `docs/MANUAL_VERIFICATION.md`. It lives at the root because it serves the
 * whole repository, so it is imported here by URL rather than through a
 * package boundary, and this suite is where the provider facts it depends on
 * are already tested.
 */
const probe = await import(
  new URL("../../../scripts/probe-provider.mjs", import.meta.url).href
);

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PROVIDERS_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "plugins",
  "dsh-qa-integrations",
  "src",
  "providers",
);

describe("probe-provider arguments", () => {
  it("reads the flags a person actually types", () => {
    const options = probe.parseProbeArgs([
      "--provider=jira",
      "--base-url=https://jira.example.corp",
      "--deployment=server",
      "--token-env=JIRA_PAT",
      "--op=issues.search",
      "--arg",
      'projectKeys=["PROJ"]',
      "--arg",
      "limit=5",
    ]);
    expect(options.provider).toBe("jira");
    expect(options.baseUrl).toBe("https://jira.example.corp");
    expect(options.deployment).toBe("server");
    expect(options.tokenEnv).toBe("JIRA_PAT");
    expect(options.operation).toBe("issues.search");
    expect(options.args).toEqual({ projectKeys: ["PROJ"], limit: 5 });
    expect(options.json).toBe(false);
  });

  it("takes a stand-alone flag without a value, and a dev http address", () => {
    const options = probe.parseProbeArgs([
      "--provider=jira",
      "--base-url=http://127.0.0.1:8080",
      "--deployment=server",
      "--token-env=JIRA_PAT",
      "--allow-insecure-http",
    ]);
    expect(options.allowInsecureHttp).toBe(true);
    const config = probe.probeConfig(options);
    expect(config.jira.allowInsecureHttp).toBe(true);
    expect(config.jira.sites[0].deploymentType).toBe("server");
  });

  it("accepts a token file instead of an environment variable", () => {
    const options = probe.parseProbeArgs([
      "--provider=weblate",
      "--base-url=https://weblate.example.com",
      "--token-file",
      "/tmp/token",
    ]);
    expect(options.tokenFile).toBe("/tmp/token");
    expect(options.tokenEnv).toBeUndefined();
  });

  it("refuses a token on the command line", () => {
    expect(() =>
      probe.parseProbeArgs([
        "--provider=gitlab",
        "--base-url=https://git.example.com",
        "--token=glpat-abcdefghijklmnop",
      ]),
    ).toThrow(/--token is refused on purpose/u);
  });

  it("refuses a flag that is missing, unknown or contradictory", () => {
    expect(() => probe.parseProbeArgs(["--provider=jira"])).toThrow(
      /--base-url is required/u,
    );
    expect(() =>
      probe.parseProbeArgs([
        "--provider=nope",
        "--base-url=https://example.com",
        "--token-env=T",
      ]),
    ).toThrow(/--provider must be one of/u);
    expect(() =>
      probe.parseProbeArgs(["--provider=jira", "--base-url=https://x.example"]),
    ).toThrow(/give exactly one of --token-env or --token-file/u);
    expect(() =>
      probe.parseProbeArgs([
        "--provider=jira",
        "--base-url=https://x.example",
        "--token-env=T",
        "--deployment=on-prem",
      ]),
    ).toThrow(/--deployment must be cloud or server/u);
    // A provider that has one product refuses the switch rather than ignoring it.
    expect(() =>
      probe.parseProbeArgs([
        "--provider=gitlab",
        "--base-url=https://git.example.com",
        "--token-env=T",
        "--deployment=server",
      ]),
    ).toThrow(/applies to jira and confluence only/u);
    expect(() => probe.parseProbeArgs(["--provider"])).toThrow(
      /--provider needs a value/u,
    );
    expect(() => probe.parseProbeArgs(["stray"])).toThrow(
      /unexpected argument "stray"/u,
    );
  });

  it("reads a value as JSON when it is JSON and as text when it is not", () => {
    expect(probe.parseValue('["PROJ"]')).toEqual(["PROJ"]);
    expect(probe.parseValue("5")).toBe(5);
    expect(probe.parseValue("true")).toBe(true);
    expect(probe.parseValue("untranslated")).toBe("untranslated");
  });
});

describe("probe-provider secrets", () => {
  it("reads the token from the environment and refuses an empty one", () => {
    expect(
      probe.readToken({ tokenEnv: "PROBE_TOKEN" }, { PROBE_TOKEN: " abc123 " }),
    ).toBe("abc123");
    expect(() =>
      probe.readToken({ tokenEnv: "PROBE_TOKEN" }, { PROBE_TOKEN: "  " }),
    ).toThrow(/PROBE_TOKEN is unset or empty/u);
    expect(() => probe.readToken({ tokenEnv: "MISSING" }, {})).toThrow(
      /MISSING is unset or empty/u,
    );
  });

  it("reads a token file and refuses an empty one", () => {
    const directory = mkdtemp();
    const file = path.join(directory, "token");
    writeFileSync(file, "s3cret\n");
    expect(probe.readToken({ tokenFile: file })).toBe("s3cret");
    writeFileSync(file, "\n");
    expect(() => probe.readToken({ tokenFile: file })).toThrow(/is empty/u);
  });

  it("masks the credential in everything the probe prints", () => {
    const secret = "ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789";
    const masked = probe.redactProbeText(
      `authorization: Bearer ${secret} for ${secret}`,
      secret,
    );
    expect(masked).not.toContain(secret);
    expect(masked).toMatch(/Bearer <redacted>/u);
    expect(masked).toMatch(/for <token>/u);
    // Any scheme, whatever the provider uses.
    expect(probe.redactProbeText("PrivateToken abcdef123456", undefined)).toBe(
      "PrivateToken <redacted>",
    );
    expect(probe.redactProbeText("Token wlu_abcdefghij", undefined)).toBe(
      "Token <redacted>",
    );
  });

  it("prints a summary that carries no credential", () => {
    const summary = probe.formatSummary({
      provider: "jira",
      displayName: "Alice Example",
      externalUserId: "alice",
      tenantId: "https://jira.example.corp",
      declared: "server",
      capabilities: ["issues.read"],
      operation: "issues.search",
      answer: { items: { array: 1, of: [] } },
    });
    expect(summary).toMatch(/connected:\s+Alice Example \(alice\)/u);
    expect(summary).toMatch(/declared:\s+server/u);
    expect(summary).toMatch(/issues\.search/u);
    expect(summary).toMatch(/--json/u);
  });
});

describe("probe-provider configuration", () => {
  it("declares one Atlassian site the way an operator would", () => {
    const config = probe.probeConfig({
      provider: "jira",
      description: probe.PROVIDERS.jira,
      baseUrl: "https://jira.example.corp",
      deployment: "server",
    });
    expect(config.jira.sites).toEqual([
      {
        id: "probe",
        label: "probe",
        baseUrl: "https://jira.example.corp",
        deploymentType: "server",
      },
    ]);
    // An undeclared product is left out rather than defaulted here: the
    // resolver's own default is what a deployment gets.
    const implicit = probe.probeConfig({
      provider: "confluence",
      description: probe.PROVIDERS.confluence,
      baseUrl: "https://wiki.example.corp/confluence",
    });
    expect(implicit.confluence.instances[0].deploymentType).toBeUndefined();
  });

  it("mirrors the switches that would otherwise refuse the call", () => {
    const teamcity = probe.probeConfig({
      provider: "teamcity",
      description: probe.PROVIDERS.teamcity,
      baseUrl: "https://teamcity.example.corp:8443",
    });
    expect(teamcity.teamcity.network.allowedHosts).toEqual([
      "teamcity.example.corp",
    ]);
    expect(teamcity.teamcity.network.allowedPorts).toEqual([8443]);
    expect(teamcity.teamcity.serverUrl).toBe(
      "https://teamcity.example.corp:8443",
    );

    const bitrix = probe.probeConfig({
      provider: "bitrix24",
      description: probe.PROVIDERS.bitrix24,
      baseUrl: "https://demo.bitrix24.ru/rest/1/abcdefghij/",
    });
    expect(bitrix.allowedPortalSuffixes).toEqual([".bitrix24.ru"]);
    expect(bitrix.bitrix24.instances[0].portal).toBe(
      "https://demo.bitrix24.ru/rest/1/abcdefghij/",
    );
  });

  it("names the next command when a site answers the other product", () => {
    const hint = probe.mismatchHint(
      "jira",
      'Jira Cloud was expected, but the site answers "Server"; set deploymentType: server for it in the Jira integration config',
      "https://jira.example.corp",
    );
    expect(hint ?? "").toMatch(/--deployment=server/u);
    expect(hint ?? "").toMatch(/--provider=jira/u);
    expect(
      probe.mismatchHint("jira", "Jira resource not found", "x"),
    ).toBeUndefined();
  });

  it("detects the product without a credential, and gives up quietly", async () => {
    const quiet = await probe.detectDeploymentType(
      "jira",
      "https://jira.example.corp",
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );
    expect(quiet).toBeUndefined();
    // The single-product providers are never asked.
    expect(
      await probe.detectDeploymentType(
        "gitlab",
        "https://git.example.com",
        async () => {
          throw new Error("never called");
        },
      ),
    ).toBeUndefined();
    const server = await probe.detectDeploymentType(
      "confluence",
      "https://wiki.example.corp/confluence",
      async (url: string | URL | Request) =>
        new Response(
          String(url).endsWith("/rest/api/2/serverInfo")
            ? JSON.stringify({ deploymentType: "Data Center" })
            : "{}",
          {
            status: String(url).endsWith("/rest/api/2/serverInfo") ? 200 : 404,
          },
        ),
    );
    expect(server).toEqual({
      deploymentType: "Data Center",
      product: "server",
    });
  });
});

describe("probe-provider dialer", () => {
  it("answers with a real Response, and refuses to follow a redirect", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/answer") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ deploymentType: "Server" }));
        return;
      }
      response.writeHead(302, { location: "https://elsewhere.example" });
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const dialer = probe.probeFetcher();
    try {
      const answer = await dialer(`http://127.0.0.1:${port}/answer`);
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ deploymentType: "Server" });
      // The provider asks for `redirect: "error"`: a credential must not travel
      // to another origin, and the dialer keeps that promise at the socket.
      await expect(dialer(`http://127.0.0.1:${port}/moved`)).rejects.toThrow(
        /refusing to follow a redirect \(302\)/u,
      );
    } finally {
      server.close();
    }
  });
});

describe("probe-provider coverage", () => {
  const directories = readdirSync(PROVIDERS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name)
    .sort();

  it("describes every provider the package ships", () => {
    expect([...probe.providerNames()].sort()).toEqual(directories);
  });

  it("finds an identity read in every provider's own catalog", () => {
    for (const provider of directories) {
      const catalog = readFileSync(
        path.join(PROVIDERS_DIRECTORY, provider, "catalog.ts"),
        "utf8",
      );
      const identity = probe.PROVIDERS[provider].identityOperation;
      expect(
        new RegExp(
          `export const ${probe.catalogExport(provider)}\\b`,
          "u",
        ).test(catalog),
        `${provider}/catalog.ts must export ${probe.catalogExport(provider)}`,
      ).toBe(true);
      expect(
        catalog.includes(`"${identity}":`),
        `${provider} must declare its identity read (${identity})`,
      ).toBe(true);
    }
  });

  it("reads the built catalog of a provider", async () => {
    // Both products' endpoints, because the provider serves both.
    expect(await probe.catalogPaths("jira", "issues.search")).toEqual([
      "/rest/api/3/search/jql",
      "/rest/api/2/search",
    ]);
    expect(await probe.catalogPaths("jira", "no.such.operation")).toEqual([]);
  });
});

/** A throwaway directory for the token-file case. */
function mkdtemp(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "probe-token-"));
  TEST_TEMPORARIES.push(directory);
  return directory;
}

const TEST_TEMPORARIES: string[] = [];

afterAll(() => {
  for (const directory of TEST_TEMPORARIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});
