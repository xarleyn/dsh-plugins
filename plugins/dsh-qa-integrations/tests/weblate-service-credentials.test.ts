import { IntegrationError } from "../src/errors.js";
import {
  WEBLATE_CAPABILITIES,
  WEBLATE_OPERATIONS,
} from "../src/providers/weblate/catalog.js";
import { evaluateServiceOperation } from "../src/service-credentials/policy.js";
import {
  UNCLASSIFIED_OPERATION,
  type ServiceCredentialProfile,
  type ServiceResourceBoundary,
} from "../src/service-credentials/types.js";
import {
  INSTANCE,
  PAGE,
  TOKEN,
  USER,
  credentialFor,
  provider,
  stub,
} from "./weblate/shared.js";

/** Two listed projects, the slugs the operations address them by. */
const BOUNDARY: ServiceResourceBoundary = Object.freeze({
  projects: Object.freeze(["app", "docs"]),
});

/** A service call: the broker hands the provider a boundary and the mode. */
function serviceContext(boundary: ServiceResourceBoundary = BOUNDARY) {
  return {
    credentialSource: "service" as const,
    resourceBoundary: boundary,
  };
}

function profile(
  resources: ServiceResourceBoundary = BOUNDARY,
): ServiceCredentialProfile {
  return {
    id: "weblate-main-readonly",
    provider: "weblate",
    instance: "main",
    portal: INSTANCE,
    label: "QA Weblate Read-only",
    authType: "token",
    secretRef: "env:QA_WEBLATE_SERVICE_TOKEN",
    enabled: true,
    resources,
    policy: {},
    policyRevision: "rev",
  };
}

function credential(fetcher: typeof fetch) {
  return {
    p: provider(fetcher),
    plaintext: credentialFor(TOKEN, {}, fetcher),
  };
}

describe("Weblate managed service credentials", () => {
  it("classifies every operation as a service-safe project read, except the identity", () => {
    for (const [operation, definition] of Object.entries(WEBLATE_OPERATIONS)) {
      const { security } = definition;
      // The catalog carries no operation that could change Weblate state, and
      // none that answers with a secret or another person's raw output — the
      // service ceiling therefore covers all of it, inside a boundary.
      expect(security.effect, operation).toBe("read");
      expect(security.sensitivity, operation).toBe("normal");
      expect(security.serviceCredential, operation).toBe("allow");
      expect(security.requiresResourceBoundary, operation).toBe(
        operation === "connection.get" ? false : true,
      );
    }
  });

  it("keeps the service ceiling and the broker policy in agreement", () => {
    const { p } = credential(stub(() => ({ json: {} })).fetcher);
    const decision = evaluateServiceOperation({
      metadata:
        WEBLATE_OPERATIONS["projects.get"]?.security ?? UNCLASSIFIED_OPERATION,
      capability: p.operationCapability("projects.get"),
      profile: profile(),
      boundaryKind: p.resourceBoundaryKind?.("projects.get"),
    });
    expect(decision).toEqual({ allowed: true });

    // A profile that bounds no projects cannot serve a project read at all.
    const unbounded = evaluateServiceOperation({
      metadata:
        WEBLATE_OPERATIONS["projects.get"]?.security ?? UNCLASSIFIED_OPERATION,
      capability: p.operationCapability("projects.get"),
      profile: profile({ projects: [] }),
      boundaryKind: p.resourceBoundaryKind?.("projects.get"),
    });
    expect(unbounded).toMatchObject({
      allowed: false,
      code: "ServiceResourceNotAllowed",
    });

    // The administrator's narrowing removes a capability from the ceiling.
    const narrowed = evaluateServiceOperation({
      metadata:
        WEBLATE_OPERATIONS["units.get"]?.security ?? UNCLASSIFIED_OPERATION,
      capability: p.operationCapability("units.get"),
      profile: { ...profile(), policy: { "units.read": "deny" } },
      boundaryKind: p.resourceBoundaryKind?.("units.get"),
    });
    expect(narrowed).toMatchObject({
      allowed: false,
      code: "OperationNotAllowedWithServiceCredential",
    });
  });

  it("fails closed on an operation the catalog does not classify", async () => {
    const { fetcher, calls } = stub(() => ({ json: {} }));
    const { p, plaintext } = credential(fetcher);
    // The provider does not know the operation, so nothing about it is
    // classified either: the broker's default and the provider's own table
    // both refuse it.
    expect(p.operationMetadata?.("units.update")).toBeUndefined();
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "units.update",
        {},
      ),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(calls).toEqual([]);
    // And the unclassified default the broker substitutes is refused too.
    const decision = evaluateServiceOperation({
      metadata: UNCLASSIFIED_OPERATION,
      capability: p.operationCapability("units.update"),
      profile: profile(),
      boundaryKind: p.resourceBoundaryKind?.("units.update"),
    });
    expect(decision).toMatchObject({ allowed: false });
  });

  it("serves the identity read to the shared account without a project", async () => {
    const { fetcher } = stub(() => ({ json: { ...PAGE, results: [USER] } }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.execute(
        { credential: plaintext, ...serviceContext() },
        "connection.get",
        {},
      ),
    ).resolves.toMatchObject({ accountResolved: true });
  });

  it("reports every capability as available in service mode", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const p = provider(fetcher);
    for (const item of WEBLATE_CAPABILITIES) {
      expect(p.capabilityServiceState?.(item.capability), item.capability).toBe(
        "available",
      );
    }
    // A capability the provider does not declare is reported as unavailable,
    // never as silently supported.
    expect(p.capabilityServiceState?.("repository.write")).toBe("unavailable");
  });

  it("names the portal of a configured instance the way the connect form does", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const p = provider(fetcher);
    // An empty id means "the only instance", the same rule parseCredential
    // applies when the deployment has nothing to choose between.
    expect(p.instancePortal?.("")).toBe(INSTANCE);
    expect(p.instancePortal?.("main")).toBe(INSTANCE);
    expect(p.instancePortal?.("nope")).toBeUndefined();

    const mirror = provider(fetcher, {
      instances: [
        { id: "main", label: "Main", baseUrl: INSTANCE },
        {
          id: "mirror",
          label: "Mirror",
          baseUrl: "https://weblate.example.org",
        },
      ],
    });
    expect(mirror.instancePortal?.("")).toBeUndefined();
    expect(mirror.instancePortal?.("mirror")).toBe(
      "https://weblate.example.org",
    );
  });

  it("probes the managed credential with the one read personal validation makes", async () => {
    const { fetcher, calls } = stub(() => ({
      json: { ...PAGE, results: [USER] },
    }));
    const { p, plaintext } = credential(fetcher);
    const health = await p.validateServiceCredential?.({
      credential: plaintext,
    });
    expect(health).toMatchObject({
      status: "healthy",
      upstreamIdentity: { id: "7", label: "Alice Example (@alice)" },
    });
    // Weblate exposes no token-scope introspection, so the probe cannot vouch
    // for read-only; it says so instead of pretending.
    expect(health?.warnings).toEqual([
      "Weblate did not report the token scopes; the local service ceiling still applies",
    ]);
    expect(calls.map((call) => call.url.pathname)).toEqual(["/api/users/"]);
  });

  it("reports no identity when the token may list users", async () => {
    const { fetcher } = stub(() => ({
      json: {
        ...PAGE,
        count: 2,
        results: [USER, { id: 8, username: "bob", name: "Bob Example" }],
      },
    }));
    const { p, plaintext } = credential(fetcher);
    const health = await p.validateServiceCredential?.({
      credential: plaintext,
    });
    expect(health).toMatchObject({ status: "healthy" });
    expect(health?.warnings).toHaveLength(1);
    expect(health?.upstreamIdentity).toBeUndefined();
  });

  it("maps a rejected service token onto its health status", async () => {
    const { fetcher } = stub(() => ({
      status: 401,
      json: { detail: "Invalid token" },
    }));
    const { p, plaintext } = credential(fetcher);
    await expect(
      p.validateServiceCredential?.({ credential: plaintext }),
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("rejects a malformed service secret instead of spending it", () => {
    const { fetcher } = stub(() => ({ json: {} }));
    const p = provider(fetcher);
    expect(() =>
      p.parseCredential("https://weblate.example.com", { instanceId: "main" }),
    ).toThrow(IntegrationError);
  });
});
