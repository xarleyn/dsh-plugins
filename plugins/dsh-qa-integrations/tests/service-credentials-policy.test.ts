import {
  evaluateServiceOperation,
  narrowBoundary,
} from "../src/service-credentials/policy.js";
import type { ServiceCredentialProfile } from "../src/service-credentials/types.js";
import { READ, SENSITIVE, WRITE } from "./service-credentials.helpers.js";
describe("managed service credentials: policy", () => {
  const profile = Object.freeze({
    id: "p",
    provider: "acme",
    instance: "acme-app",
    portal: "acme.example",
    label: "Acme Read-only",
    authType: "pat",
    secretRef: "env:ACME_SERVICE_TOKEN",
    enabled: true,
    resources: Object.freeze({ projects: Object.freeze(["alpha"]) }),
    policy: Object.freeze({}),
    policyRevision: "rev1",
  }) satisfies ServiceCredentialProfile;

  it("allows a read of normal sensitivity that declared itself service-safe", () => {
    expect(
      evaluateServiceOperation({
        metadata: READ,
        capability: "records.read",
        profile,
        boundaryKind: "projects",
      }),
    ).toEqual({ allowed: true });
  });

  it("refuses a write even when the operation is of normal sensitivity", () => {
    const decision = evaluateServiceOperation({
      metadata: WRITE,
      capability: "records.write",
      profile,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "OperationNotAllowedWithServiceCredential",
    });
  });

  it("refuses a sensitive read with the personal-credential reason", () => {
    const decision = evaluateServiceOperation({
      metadata: SENSITIVE,
      capability: "logs.read",
      profile,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "SensitiveReadRequiresPersonalCredential",
    });
  });

  it("refuses an operation the provider did not classify", () => {
    const decision = evaluateServiceOperation({
      metadata: {
        effect: "admin",
        sensitivity: "secret",
        serviceCredential: "deny",
        requiresResourceBoundary: true,
      },
      capability: "records.read",
      profile,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({ allowed: false });
  });

  it("refuses a bounded operation whose provider names no boundary kind", () => {
    const decision = evaluateServiceOperation({
      metadata: READ,
      capability: "records.read",
      profile,
      boundaryKind: undefined,
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "ServiceResourceNotAllowed",
    });
  });

  it("reads a malformed selection as no narrowing at all", () => {
    const narrowed = narrowBoundary(profile.resources, {
      projects: "alpha" as unknown as readonly string[],
    });
    expect(narrowed).toEqual(profile.resources);
  });

  it("lets the administrator narrow a capability the provider allowed", () => {
    const narrowed = {
      ...profile,
      policy: { "records.read": "deny" as const },
    };
    const decision = evaluateServiceOperation({
      metadata: READ,
      capability: "records.read",
      profile: narrowed,
      boundaryKind: "projects",
    });
    expect(decision).toMatchObject({ allowed: false });
  });
});
