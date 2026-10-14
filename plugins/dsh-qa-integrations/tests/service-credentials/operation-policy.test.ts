import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_POLICY_OPERATIONS } from "../../src/service-credentials/catalog.js";
import { assertServiceOperationAllowed } from "../../src/providers/shared/service-boundary.js";
import { serviceOperationAccess } from "../../src/service-credentials/operation-policy.js";
import { evaluateServiceOperation } from "../../src/service-credentials/policy.js";
import {
  buildHarness,
  PROFILE_INPUT,
  repositories,
  SENSITIVE,
  WRITE,
} from "./helpers.js";

describe("service operation allowances", () => {
  it("uses the same explicit allow and deny at both gates for every provider", () => {
    for (const [provider, operations] of Object.entries(
      SERVICE_POLICY_OPERATIONS,
    )) {
      for (const entry of operations) {
        const selection = {
          provider,
          capability: entry.capability,
          operation: entry.operation,
          policy: { [entry.operation]: "allow" as const },
        };
        const grantable =
          entry.security.effect === "read" &&
          entry.security.sensitivity !== "secret" &&
          entry.security.serviceOverrideAllowed !== false;
        expect(
          serviceOperationAccess(entry.security, selection) === "allow",
          `${provider}.${entry.operation}`,
        ).toBe(grantable);
        if (grantable)
          expect(() =>
            assertServiceOperationAllowed(entry.security, "refused", selection),
          ).not.toThrow();
        else
          expect(() =>
            assertServiceOperationAllowed(entry.security, "refused", selection),
          ).toThrow();
        expect(
          serviceOperationAccess(entry.security, {
            ...selection,
            policy: { [entry.operation]: "deny" },
          }),
        ).not.toBe("allow");
      }
    }
  });

  it("keeps denials stronger than exact and provider-prefixed allowances", () => {
    expect(
      serviceOperationAccess(SENSITIVE, {
        provider: "teamcity",
        capability: "logs.read",
        operation: "builds.log",
        policy: { "teamcity.builds.log": "allow", "logs.read": "deny" },
      }),
    ).toBe("policy");
    expect(
      serviceOperationAccess(SENSITIVE, {
        provider: "gitlab",
        capability: "ci.read",
        operation: "jobs.trace",
        policy: { "gitlab.ci.read": "allow", "jobs.trace": "deny" },
      }),
    ).toBe("policy");
    expect(
      serviceOperationAccess(WRITE, {
        capability: "records.write",
        policy: { "records.write": "allow" },
      }),
    ).toBe("effect");
    expect(
      serviceOperationAccess(undefined, {
        operation: "unknown",
        policy: { unknown: "allow" },
      }),
    ).toBe("effect");
    expect(
      serviceOperationAccess(
        { ...SENSITIVE, sensitivity: "secret" },
        { capability: "logs.read", policy: { "logs.read": "allow" } },
      ),
    ).toBe("secret");
  });

  it("never opens a sensitive reading without its resource boundary", () => {
    const profile = {
      id: "test",
      provider: "acme",
      instance: "test",
      portal: "acme.example",
      label: "Test",
      enabled: true,
      authType: "pat",
      secretRef: "env:TEST_TOKEN",
      policyRevision: "1",
      resources: {},
      policy: { "logs.get": "allow" as const },
    };
    expect(
      evaluateServiceOperation({
        metadata: SENSITIVE,
        capability: "logs.read",
        operation: "logs.get",
        profile,
        boundaryKind: "projects",
      }),
    ).toMatchObject({ allowed: false, code: "ServiceResourceNotAllowed" });
  });

  it("applies changed shared policies to existing connections and keeps personal denials", async () => {
    const directory = mkdtempSync(join(tmpdir(), "service-policy-"));
    const start = repositories.length;
    try {
      const file = join(directory, "integrations.db");
      const principal = { userId: "policy-reader" };
      const original = buildHarness(file, PROFILE_INPUT());
      await original.broker.connect(principal, "acme", { token: "" });
      expect(
        original.broker.summary(principal, "acme").capabilities,
      ).not.toContain("logs.read");
      const allowed = buildHarness(
        file,
        PROFILE_INPUT({ policy: { "logs.get": "allow" } }),
      );
      expect(
        allowed.broker.summary(principal, "acme").service?.capabilities[
          "logs.read"
        ],
      ).toBe("available");
      await expect(
        allowed.broker.call(principal, {
          provider: "acme",
          operation: "logs.get",
          input: { project: "alpha" },
          sourceSessionId: "test-session",
        }),
      ).resolves.toMatchObject({ operation: "logs.get" });
      allowed.broker.patchPolicy(principal, "acme", {
        operation: "logs.read",
        mode: "deny",
      });
      await expect(
        allowed.broker.call(principal, {
          provider: "acme",
          operation: "logs.get",
          input: { project: "alpha" },
          sourceSessionId: "test-session",
        }),
      ).rejects.toMatchObject({ code: "OperationDeniedByPolicy" });
      const denied = buildHarness(
        file,
        PROFILE_INPUT({ policy: { "logs.get": "deny" } }),
      );
      expect(
        denied.broker.summary(principal, "acme").service?.capabilities[
          "logs.read"
        ],
      ).toBe("unavailable");
    } finally {
      for (const repository of repositories.splice(start)) repository.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
