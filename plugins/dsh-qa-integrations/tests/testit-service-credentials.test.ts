import { resolveConfig } from "../src/config.js";
import {
  TESTIT_CAPABILITIES,
  TESTIT_OPERATIONS,
} from "../src/providers/testit/catalog.js";
import {
  TestitProvider,
  projectAllowed,
} from "../src/providers/testit/index.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import { operationCapabilityServiceState } from "../src/service-credentials/state.js";
import {
  UNCLASSIFIED_OPERATION,
  type ServiceCredentialProfile,
  type ServiceResourceBoundary,
} from "../src/service-credentials/types.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const INSTANCE = {
  id: "cloud",
  label: "Test IT Cloud",
  baseUrl: "https://team.example.testit.software",
};

/** Two listed projects, one of them the one every read below is answered from. */
const PROJECT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PROJECT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const OUTSIDE = "cccccccc-0000-4000-8000-00000000000c";
const WORK_ITEM = "11111111-0000-4000-8000-000000000001";
const TEST_PLAN = "22222222-0000-4000-8000-000000000002";
const TEST_RUN = "33333333-0000-4000-8000-000000000003";
const TEST_RESULT = "44444444-0000-4000-8000-000000000004";

const BOUNDARY: ServiceResourceBoundary = Object.freeze({
  projects: Object.freeze([PROJECT_A, PROJECT_B]),
});

function config() {
  return resolveConfig({ testit: { instances: [INSTANCE] } });
}

interface StubResult {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
}

function stub(handler: (url: URL) => StubResult) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = handler(url);
    return new Response(result.text ?? JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

function credential(fetcher: typeof fetch) {
  return {
    provider: new TestitProvider(config(), fetcher),
    plaintext: JSON.stringify({ instanceId: "cloud", token: TOKEN }),
  };
}

/** A service call: the broker hands the provider a boundary and the mode. */
function serviceContext(boundary: ServiceResourceBoundary = BOUNDARY) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

function profile(): ServiceCredentialProfile {
  return {
    id: "testit-cloud-readonly",
    provider: "testit",
    instance: "cloud",
    portal: INSTANCE.baseUrl,
    label: "QA Test IT Read-only",
    authType: "api_token",
    secretRef: "env:QA_TESTIT_SERVICE_TOKEN",
    enabled: true,
    resources: BOUNDARY,
    policy: {},
    policyRevision: "rev",
  };
}

describe("Test IT managed service credentials", () => {
  it("classifies every operation as a read under the service ceiling", () => {
    for (const [operation, definition] of Object.entries(TESTIT_OPERATIONS)) {
      expect(definition.security.effect, operation).toBe("read");
      expect(
        definition.security.serviceCredential === "allow" ||
          definition.security.serviceCredential === "deny",
        operation,
      ).toBe(true);
    }
  });

  it("keeps the project-scoped reads service-safe and boundary-bounded", () => {
    const unbounded = new Set(["connection.get"]);
    const denied = new Set(["attachments.metadata", "attachments.text"]);
    for (const [operation, definition] of Object.entries(TESTIT_OPERATIONS)) {
      if (unbounded.has(operation)) {
        expect(definition.security, operation).toMatchObject({
          sensitivity: "normal",
          serviceCredential: "allow",
          requiresResourceBoundary: false,
        });
        continue;
      }
      if (denied.has(operation)) continue;
      expect(definition.security, operation).toMatchObject({
        sensitivity: "normal",
        serviceCredential: "allow",
        requiresResourceBoundary: true,
      });
      expect(provider().resourceBoundaryKind?.(operation), operation).toBe(
        "projects",
      );
    }
  });

  it("classifies the connection probe as the identity read it is", () => {
    expect(TESTIT_OPERATIONS["connection.get"]?.security).toMatchObject({
      serviceCredential: "allow",
      requiresResourceBoundary: false,
    });
    expect(provider().resourceBoundaryKind?.("connection.get")).toBeUndefined();
  });

  it("classifies the attachment body as sensitive and refuses it through a service token", async () => {
    const { fetcher, calls } = stub(() => ({ text: "uploaded bytes" }));
    const { provider, plaintext } = credential(fetcher);
    const definition = TESTIT_OPERATIONS["attachments.text"];
    expect(definition?.security).toMatchObject({
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    const decision = evaluateServiceOperation({
      metadata: definition?.security ?? UNCLASSIFIED_OPERATION,
      capability: "attachments.read",
      profile: profile(),
      boundaryKind: provider.resourceBoundaryKind?.("attachments.text"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "SensitiveReadRequiresPersonalCredential",
    });

    // Defence in depth: the provider refuses on its own classification, so a
    // caller that reached it without the broker's decision — or a future
    // broker bug — still does not download an uploaded body through a shared
    // credential.
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "attachments.text",
        { attachmentId: WORK_ITEM },
      ),
    ).rejects.toMatchObject({
      code: "SensitiveReadRequiresPersonalCredential",
    });
    expect(calls).toEqual([]);
  });

  it("refuses attachment metadata, which no call can prove inside any boundary", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { id: WORK_ITEM, name: "log.txt", size: 12 },
    }));
    const { provider, plaintext } = credential(fetcher);
    const definition = TESTIT_OPERATIONS["attachments.metadata"];
    expect(definition?.security).toMatchObject({
      sensitivity: "normal",
      serviceCredential: "deny",
    });
    const decision = evaluateServiceOperation({
      metadata: definition?.security ?? UNCLASSIFIED_OPERATION,
      capability: "attachments.read",
      profile: profile(),
      boundaryKind: provider.resourceBoundaryKind?.("attachments.metadata"),
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "OperationNotAllowedWithServiceCredential",
    });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "attachments.metadata",
        { attachmentId: WORK_ITEM },
      ),
    ).rejects.toMatchObject({
      code: "OperationNotAllowedWithServiceCredential",
    });
    expect(calls).toEqual([]);
  });

  it("derives the capability service states from the classifications", () => {
    for (const { capability } of TESTIT_CAPABILITIES) {
      const state = operationCapabilityServiceState(
        TESTIT_OPERATIONS,
        capability,
      );
      expect(state, capability).toBe(
        capability === "attachments.read" ? "unavailable" : "available",
      );
    }
  });

  it("refuses a project outside the administrator boundary", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.get",
        { projectId: OUTSIDE },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // The refusal happens before anything is sent upstream.
    expect(calls).toEqual([]);
  });

  it("refuses an unscoped listing, because it would answer with the whole installation", async () => {
    const { fetcher, calls } = stub(() => ({ json: [] }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "autoTests.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "workItems.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls).toEqual([]);
  });

  it("serves a listing scoped to a project the boundary names", async () => {
    const { fetcher, calls } = stub(() => ({ json: [] }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "sections.list",
        { projectId: PROJECT_A },
      ),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "sections.list",
        { projectId: OUTSIDE },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/projects/${PROJECT_A}/sections`,
    ]);
  });

  it("serves a work item whose project the boundary names", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { id: WORK_ITEM, projectId: PROJECT_A, name: "Вход" },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "workItems.get",
        { workItemId: WORK_ITEM },
      ),
    ).resolves.toMatchObject({ id: WORK_ITEM });
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/workItems/${WORK_ITEM}`,
    ]);
  });

  it("discards a work item that turns out to live outside the boundary", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { id: WORK_ITEM, projectId: OUTSIDE, name: "secret" },
    }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "workItems.get",
        { workItemId: WORK_ITEM },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // The answer was fetched, but nothing about it is disclosed.
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/workItems/${WORK_ITEM}`,
    ]);
  });

  it("resolves an id-addressed listing to its project before answering it", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname === `/api/v2/workItems/${WORK_ITEM}`
        ? { json: { id: WORK_ITEM, projectId: PROJECT_A } }
        : { json: [{ id: "c1" }] },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "workItems.comments",
        { workItemId: WORK_ITEM },
      ),
    ).resolves.toMatchObject({ items: [{ id: "c1" }] });
    // One call to resolve the owning project, one for the answer the caller
    // asked for.
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/workItems/${WORK_ITEM}`,
      `/api/v2/workItems/${WORK_ITEM}/comments`,
    ]);
  });

  it("refuses an id-addressed listing whose project is outside the boundary", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname === `/api/v2/testPlans/${TEST_PLAN}`
        ? { json: { id: TEST_PLAN, projectId: OUTSIDE } }
        : { json: [] },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "testPlans.summary",
        { testPlanId: TEST_PLAN },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    // Only the resolution call was made: the answer itself was never fetched.
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/testPlans/${TEST_PLAN}`,
    ]);
  });

  it("serves a run summary listing whose run is inside the boundary", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname === `/api/v2/testRuns/${TEST_RUN}`
        ? { json: { id: TEST_RUN, projectId: PROJECT_B } }
        : { json: [{ testPointId: "tp1" }] },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "testRuns.results",
        { testRunId: TEST_RUN },
      ),
    ).resolves.toMatchObject({ items: [{ testPointId: "tp1" }] });
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/testRuns/${TEST_RUN}`,
      `/api/v2/testRuns/${TEST_RUN}/testPoints/results`,
    ]);
  });

  it("chains a test result through the run that owns it", async () => {
    const { fetcher, calls } = stub((url) => {
      if (url.pathname === `/api/v2/testResults/${TEST_RESULT}`) {
        return {
          json: { id: TEST_RESULT, testRunId: TEST_RUN, outcome: "Failed" },
        };
      }
      if (url.pathname === `/api/v2/testRuns/${TEST_RUN}`) {
        return { json: { id: TEST_RUN, projectId: PROJECT_A } };
      }
      return { json: {} };
    });
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "testResults.get",
        { testResultId: TEST_RESULT },
      ),
    ).resolves.toMatchObject({ id: TEST_RESULT, outcome: "Failed" });
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/testResults/${TEST_RESULT}`,
      `/api/v2/testRuns/${TEST_RUN}`,
    ]);

    // The same chain refuses a result owned by an outside run.
    calls.length = 0;
    const refusing = stub((url) => {
      if (url.pathname === `/api/v2/testResults/${TEST_RESULT}`) {
        return { json: { id: TEST_RESULT, testRunId: TEST_RUN } };
      }
      return { json: { id: TEST_RUN, projectId: OUTSIDE } };
    });
    const other = credential(refusing.fetcher);
    await expect(
      other.provider.execute(
        { credential: other.plaintext, ...serviceContext() },
        "testResults.get",
        { testResultId: TEST_RESULT },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
    expect(refusing.calls.map((url) => url.pathname)).toEqual([
      `/api/v2/testResults/${TEST_RESULT}`,
      `/api/v2/testRuns/${TEST_RUN}`,
    ]);
  });

  it("lists only the projects the boundary names", async () => {
    const { fetcher, calls } = stub((url) =>
      url.pathname.endsWith(PROJECT_A)
        ? { json: { id: PROJECT_A, name: "Alpha" } }
        : { json: { id: PROJECT_B, name: "Beta" } },
    );
    const { provider, plaintext } = credential(fetcher);
    const answer = (await provider.execute(
      { credential: plaintext, ...serviceContext() },
      "projects.list",
      {},
    )) as { serviceScoped: boolean; items: readonly { id: string }[] };
    // The listing is built from the allowlist, not from what the shared
    // account could reach.
    expect(answer.serviceScoped).toBe(true);
    expect(answer.items.map((item) => item.id)).toEqual([PROJECT_A, PROJECT_B]);
    expect(calls.map((url) => url.pathname)).toEqual([
      `/api/v2/projects/${PROJECT_A}`,
      `/api/v2/projects/${PROJECT_B}`,
    ]);
  });

  it("reports a bounded project the service token cannot see instead of hiding it", async () => {
    const { fetcher } = stub((url) =>
      url.pathname.endsWith(PROJECT_A)
        ? { status: 404, json: {} }
        : { json: { id: PROJECT_B, name: "Beta" } },
    );
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, ...serviceContext() },
        "projects.list",
        {},
      ),
    ).resolves.toMatchObject({ unavailableResources: [PROJECT_A] });
  });

  it("leaves the personal mode untouched", async () => {
    const { fetcher } = stub(() => ({
      json: { id: WORK_ITEM, projectId: OUTSIDE, name: "Вход" },
    }));
    const { provider, plaintext } = credential(fetcher);
    // No boundary, no service mode: the call is the plain read it always was,
    // including for a project the deployment's allowlist does not name.
    await expect(
      provider.execute({ credential: plaintext }, "workItems.get", {
        workItemId: WORK_ITEM,
      }),
    ).resolves.toMatchObject({ id: WORK_ITEM });
    await expect(
      provider.execute({ credential: plaintext }, "autoTests.list", {}),
    ).resolves.toBeDefined();
  });

  it("fails closed when service mode arrives without a boundary", async () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.execute(
        { credential: plaintext, credentialSource: "service" },
        "projects.get",
        { projectId: PROJECT_A },
      ),
    ).rejects.toMatchObject({ code: "ServiceResourceNotAllowed" });
  });

  it("asks about its installations the same way the connect form does", () => {
    expect(provider().instancePortal("cloud")).toBe(INSTANCE.baseUrl);
    expect(provider().instancePortal("")).toBe(INSTANCE.baseUrl);
    expect(provider().instancePortal("elsewhere")).toBeUndefined();
    const second = {
      id: "tms",
      label: "TMS",
      baseUrl: "https://tms.corp.example",
    };
    const both = new TestitProvider(
      resolveConfig({ testit: { instances: [INSTANCE, second] } }),
      () => {
        throw new Error("no upstream");
      },
    );
    expect(both.instancePortal("")).toBeUndefined();
    expect(both.instancePortal("tms")).toBe(second.baseUrl);
  });

  it("reports a managed token healthy without claiming a scope audit it did not perform", async () => {
    const { fetcher, calls } = stub(() => ({ json: [] }));
    const { provider, plaintext } = credential(fetcher);
    const health = await provider.validateServiceCredential?.({
      credential: plaintext,
      credentialSource: "service",
    });
    expect(health).toMatchObject({ status: "healthy" });
    // Test IT exposes no scope introspection, so the answer says so rather
    // than implying a permission audit it cannot perform.
    expect(health?.warnings?.[0]).toMatch(/scopes/u);
    // The probe is the read-only connection probe itself: never a write.
    expect(calls.map((url) => url.pathname)).toEqual(["/api/v2/projects"]);
    expect(calls[0]?.searchParams.get("Take")).toBe("1");
  });

  it("maps a rejected service token onto its health status", async () => {
    const { fetcher } = stub(() => ({ status: 401, json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("maps an unreachable installation onto its health status", async () => {
    const { fetcher } = stub(() => ({ status: 503, json: {} }));
    const { provider, plaintext } = credential(fetcher);
    await expect(
      provider.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({ status: "unreachable" });
  });
});

describe("Test IT boundary matching", () => {
  it("covers a listed project exactly and nothing that merely looks like it", () => {
    expect(projectAllowed(BOUNDARY, PROJECT_A)).toBe(true);
    expect(projectAllowed(BOUNDARY, ` ${PROJECT_B} `)).toBe(true);
    expect(projectAllowed(BOUNDARY, OUTSIDE)).toBe(false);
    expect(projectAllowed(BOUNDARY, "")).toBe(false);
  });

  it("bounds every project-scoped operation and nothing else", () => {
    const unscoped = new Set(["connection.get"]);
    for (const [operation, definition] of Object.entries(TESTIT_OPERATIONS)) {
      const kind = provider().resourceBoundaryKind?.(operation);
      if (definition.security.requiresResourceBoundary) {
        expect(kind, operation).toBe("projects");
      } else {
        expect(kind, operation).toBeUndefined();
        expect(unscoped.has(operation), operation).toBe(true);
      }
    }
  });
});

function provider(): TestitProvider {
  return new TestitProvider(config(), () => {
    throw new Error("no upstream");
  });
}
