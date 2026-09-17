import { resolveConfig } from "../src/config.js";
import { TEAMCITY_OPERATIONS } from "../src/providers/teamcity/catalog.js";
import type { TeamCityConfigInput } from "../src/providers/teamcity/config.js";
import {
  TeamcityProvider,
  buildTypeAllowed,
  projectAllowed,
} from "../src/providers/teamcity/index.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import {
  UNCLASSIFIED_OPERATION,
  type ServiceCredentialProfile,
  type ServiceResourceBoundary,
} from "../src/service-credentials/types.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const SERVER = "https://teamcity.example.com";
const NETWORK = {
  mode: "allowlist" as const,
  allowedHosts: ["teamcity.example.com"],
  allowedCidrs: [],
  allowedPorts: [443],
};

/** Two listed projects, one of them with a listed build configuration. */
const BOUNDARY: ServiceResourceBoundary = Object.freeze({
  projects: Object.freeze(["PAYMENTS", "PLATFORM_Frontend"]),
});

function config(teamcity: TeamCityConfigInput = {}) {
  return resolveConfig({
    teamcity: { network: NETWORK, serverUrl: SERVER, ...teamcity },
  });
}

interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
}

function stub(handler: (url: URL) => StubResult) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = handler(url);
    return new Response(JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

function credential(fetcher: typeof fetch) {
  return {
    provider: new TeamcityProvider(config(), fetcher),
    plaintext: JSON.stringify({ token: TOKEN }),
  };
}

function serviceContext(boundary: ServiceResourceBoundary = BOUNDARY) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

describe("TeamCity managed service credentials", () => {
  it("classifies the build log and the artifact body as sensitive", () => {
    expect(TEAMCITY_OPERATIONS["builds.log"]?.security).toMatchObject({
      effect: "read",
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    expect(TEAMCITY_OPERATIONS["artifacts.text"]?.security).toMatchObject({
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    // ...while the normalized failure answer stays readable, which is the whole
    // point of keeping "why did it fail" available.
    expect(TEAMCITY_OPERATIONS["failures.get"]?.security).toMatchObject({
      sensitivity: "normal",
      serviceCredential: "allow",
    });
  });

  it("refuses a build log and an artifact body before reading a byte", async () => {
    const { fetcher, calls } = stub(() => ({ text: "secret log" }) as never);
    const { provider, plaintext } = credential(fetcher);
    for (const operation of ["builds.log", "artifacts.text"]) {
      const definition = TEAMCITY_OPERATIONS[operation];
      const decision = evaluateServiceOperation({
        metadata: definition?.security ?? UNCLASSIFIED_OPERATION,
        capability: provider.operationCapability(operation),
        profile: profile(),
        boundaryKind: provider.resourceBoundaryKind?.(operation),
      });
      expect(decision, operation).toMatchObject({
        allowed: false,
        code: "SensitiveReadRequiresPersonalCredential",
      });
      await expect(
        provider.execute(
          { credential: plaintext, ...serviceContext() },
          operation,
          { buildId: 7, path: "out.txt" },
        ),
        operation,
      ).rejects.toMatchObject({
        code: "SensitiveReadRequiresPersonalCredential",
      });
    }
    expect(calls).toEqual([]);
  });

  it("refuses an unscoped listing, because it would answer with the whole server", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "builds.list",
        {
          limit: 10,
        },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "buildConfigs.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("serves a listing scoped to an allowed project", async () => {
    const { fetcher, calls } = stub(() => ({ json: { count: 0, build: [] } }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "builds.list",
        {
          projectId: "PAYMENTS",
          limit: 10,
        },
      ),
    ).resolves.toBeDefined();
    expect(calls.map((url) => url.pathname)).toEqual(["/app/rest/builds"]);
    expect(calls[0]?.searchParams.get("locator")).toContain(
      "project:(id:PAYMENTS)",
    );
  });

  it("will not take a build configuration for a project it cannot narrow by", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    // `buildConfigs.list` builds its locator from `projectId` alone, so a
    // boundary check that accepted a build type would authorise an unscoped
    // listing of every configuration on the server.
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "buildConfigs.list",
        { buildTypeId: "PAYMENTS_Build" },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "buildConfigs.list",
        { projectId: "PAYMENTS" },
      ),
    ).resolves.toBeDefined();
    expect(calls.map((url) => url.pathname)).toEqual(["/app/rest/buildTypes"]);
  });

  it("refuses assignee=me, which the shared account has no answer for", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "investigations.list",
        { assignee: "me", projectId: "PAYMENTS" },
      ),
    ).rejects.toMatchObject({
      code: "InvalidRequest",
      message: expect.stringContaining("assignee=me"),
    });
    expect(calls).toEqual([]);
  });

  it("resolves a build id to its project before answering", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname === "/app/rest/builds/id:7"
        ? { json: { buildType: { id: "SECRET_Build", projectId: "SECRET" } } }
        : { json: { id: 7 } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "builds.get",
        {
          buildId: 7,
        },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // Only the resolution call was made: the answer itself was never fetched.
    expect(calls.map((url) => url.pathname)).toEqual(["/app/rest/builds/id:7"]);
    expect(calls[0]?.searchParams.get("fields")).toBe(
      "buildType(id,projectId)",
    );
  });

  it("serves a build whose project is inside the boundary", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname === "/app/rest/builds/id:7"
        ? {
            json: {
              buildType: { id: "PAYMENTS_Build", projectId: "PAYMENTS" },
            },
          }
        : { json: { id: 7, number: "1.0" } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "builds.get",
        {
          buildId: 7,
        },
      ),
    ).resolves.toBeDefined();
    // One call to resolve the owning project, one for the answer the caller
    // asked for.
    expect(calls.map((url) => url.pathname)).toEqual([
      "/app/rest/builds/id:7",
      "/app/rest/builds/id:7",
    ]);
    expect(calls[1]?.searchParams.get("fields")).toContain("buildType");
  });

  it("lists only the projects the boundary names", async () => {
    const { fetcher, calls } = stub((url) => ({
      json: {
        id: url.pathname.endsWith("PAYMENTS")
          ? "PAYMENTS"
          : "PLATFORM_Frontend",
        name: "listed",
      },
    }));
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "projects.list",
      {},
    )) as { serviceScoped: boolean; items: readonly { id: string }[] };
    expect(answer.serviceScoped).toBe(true);
    expect(answer.items.map((item) => item.id)).toEqual([
      "PAYMENTS",
      "PLATFORM_Frontend",
    ]);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/app/rest/projects/id:PAYMENTS",
      "/app/rest/projects/id:PLATFORM_Frontend",
    ]);
  });

  it("leaves the personal mode untouched, log included", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.startsWith("/app/rest") ? { json: { id: 7 } } : { json: {} },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute({ credential: plaintext }, "builds.log", {
        buildId: 7,
        mode: "head",
        maxLines: 10,
      }),
    ).resolves.toBeDefined();
    await expect(
      provider.execute({ credential: plaintext }, "builds.list", { limit: 5 }),
    ).resolves.toBeDefined();
  });

  it("fails closed when service mode arrives without a boundary", async () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, credentialSource: "service" },
        "builds.get",
        { buildId: 7 },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
  });

  it("asks about its instances the same way the connect form does", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new TeamcityProvider(config(), fetcher);
    expect(provider.instancePortal("teamcity")).toBe(SERVER);
    expect(provider.instancePortal("")).toBe(SERVER);
    expect(provider.instancePortal("elsewhere")).toBeUndefined();
    const unmounted = new TeamcityProvider(config({ serverUrl: "" }), fetcher);
    expect(unmounted.instancePortal("teamcity")).toBeUndefined();
  });

  it("reports the identity a managed token carries, without probing permissions", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { id: 12, username: "qa-service", name: "QA Service" },
    }));
    const { provider, plaintext } = credential(fetcher);
    const health = await provider.validateServiceCredential?.({
      credential: plaintext,
      credentialSource: "service",
    });
    expect(health).toMatchObject({
      status: "healthy",
      upstreamIdentity: { id: "12", label: "QA Service (@qa-service)" },
    });
    // TeamCity reports no token roles, so the answer says so rather than
    // implying an audit it cannot perform.
    expect(health?.warnings?.[0]).toMatch(/roles/u);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/app/rest/users/current",
    ]);
  });
});

describe("TeamCity boundary matching", () => {
  it("covers a listed project and its subprojects", () => {
    expect(projectAllowed(BOUNDARY, "PAYMENTS")).toBe(true);
    expect(projectAllowed(BOUNDARY, "PAYMENTS.Cards")).toBe(true);
    expect(projectAllowed(BOUNDARY, "PAYMENTSX")).toBe(false);
    expect(projectAllowed(BOUNDARY, "SECRET")).toBe(false);
  });

  it("covers a build configuration of a listed project, by prefix or by projectId", () => {
    expect(buildTypeAllowed(BOUNDARY, "PAYMENTS_Build")).toBe(true);
    expect(buildTypeAllowed(BOUNDARY, "anything", "PAYMENTS")).toBe(true);
    expect(buildTypeAllowed(BOUNDARY, "PLATFORM_Frontend_Web")).toBe(true);
    expect(buildTypeAllowed(BOUNDARY, "SECRET_Build")).toBe(false);
    expect(buildTypeAllowed(BOUNDARY, "SECRET_Build", "SECRET")).toBe(false);
    expect(buildTypeAllowed(BOUNDARY, "PAYMENTSX_Build")).toBe(false);
  });

  it("bounds every project-scoped operation and nothing else", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const provider = new TeamcityProvider(config(), fetcher);
    const unscoped = new Set(["connection.get", "agents.list"]);
    for (const [operation, definition] of Object.entries(TEAMCITY_OPERATIONS)) {
      const kind = provider.resourceBoundaryKind?.(operation);
      if (definition.security.requiresResourceBoundary) {
        expect(kind, operation).toBe("projects");
      } else {
        expect(kind, operation).toBeUndefined();
        expect(unscoped.has(operation), operation).toBe(true);
      }
    }
  });
});

function profile(): ServiceCredentialProfile {
  return {
    id: "teamcity-corp-readonly",
    provider: "teamcity",
    instance: "teamcity",
    portal: SERVER,
    label: "QA TeamCity Read-only",
    authType: "personal_access_token",
    secretRef: "env:QA_TEAMCITY_SERVICE_TOKEN",
    enabled: true,
    resources: BOUNDARY,
    policy: {},
    policyRevision: "rev",
  };
}
