/**
 * The second lock: a provider refuses a call the managed credential may not
 * make even when the broker in front of it was bypassed. It decides from the
 * same catalog classification the broker reads, so it has to answer with the
 * same reason — a write is refused for being a write, and only a reading that
 * would return text a build or another person produced is named as personal.
 * The words matter as much as the code: they are what a tester reads.
 */

import { describe, expect, it } from "vitest";
import { BITRIX_OPERATIONS } from "../../src/providers/bitrix24/catalog.js";
import { CONFLUENCE_OPERATIONS } from "../../src/providers/confluence/catalog.js";
import { GITLAB_OPERATIONS } from "../../src/providers/gitlab/catalog.js";
import { JIRA_OPERATIONS } from "../../src/providers/jira/catalog.js";
import { assertServiceOperationAllowed } from "../../src/providers/shared/service-boundary.js";
import { TEAMCITY_OPERATIONS } from "../../src/providers/teamcity/catalog.js";
import { TESTIT_OPERATIONS } from "../../src/providers/testit/catalog.js";
import { WEBLATE_OPERATIONS } from "../../src/providers/weblate/catalog.js";
import { IntegrationError } from "../../src/errors.js";
import { evaluateServiceOperation } from "../../src/service-credentials/policy.js";
import {
  UNCLASSIFIED_OPERATION,
  type OperationSecurityMetadata,
  type ServiceCredentialProfile,
} from "../../src/service-credentials/types.js";

const MESSAGE =
  "This operation is not available through the service credential";

const READ = {
  effect: "read",
  sensitivity: "normal",
  serviceCredential: "allow",
} as const satisfies OperationSecurityMetadata;

/** What the lock answers with, or nothing when it lets the call through. */
function refusal(metadata: OperationSecurityMetadata | undefined): unknown {
  try {
    assertServiceOperationAllowed(metadata, MESSAGE);
    return undefined;
  } catch (error) {
    return error;
  }
}

function integrationError(metadata: OperationSecurityMetadata | undefined): {
  code: string;
  message: string;
} {
  const error = refusal(metadata);
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

/** The code a refusal carries; a decision that allows the call has none. */
function denialCode(
  decision: ReturnType<typeof evaluateServiceOperation>,
): string | undefined {
  return decision.allowed ? undefined : decision.code;
}

const PROFILE = Object.freeze({
  id: "svc",
  provider: "teamcity",
  instance: "teamcity",
  portal: "ci.example",
  label: "CI Read-only",
  authType: "token",
  secretRef: "env:CI_SERVICE_TOKEN",
  enabled: true,
  resources: Object.freeze({ projects: Object.freeze(["alpha"]) }),
  // Unnarrowed: the ceiling alone decides, which is what both locks share.
  policy: Object.freeze({}),
  policyRevision: "rev1",
}) satisfies ServiceCredentialProfile;

const CATALOGS = Object.freeze({
  bitrix24: BITRIX_OPERATIONS,
  confluence: CONFLUENCE_OPERATIONS,
  gitlab: GITLAB_OPERATIONS,
  jira: JIRA_OPERATIONS,
  teamcity: TEAMCITY_OPERATIONS,
  testit: TESTIT_OPERATIONS,
  weblate: WEBLATE_OPERATIONS,
});

describe("service credential: the provider's own lock", () => {
  it("lets a service-safe reading through", () => {
    expect(refusal(READ)).toBeUndefined();
  });

  it("refuses a write as a write, whatever it would have returned", () => {
    // A write that also touches sensitive data is refused for being a write:
    // re-classifying it as sensitive must never read like a way around the
    // ceiling, and this is the case whose code the wording change moved from
    // SensitiveReadRequiresPersonalCredential to this one.
    const error = integrationError({
      effect: "write",
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    expect(error.code).toBe("OperationNotAllowedWithServiceCredential");
    expect(error.message).toBe(
      `${MESSAGE}: the service credential performs reads only`,
    );
  });

  it("names the personal account a sensitive reading needs", () => {
    const error = integrationError({
      effect: "read",
      sensitivity: "sensitive",
      serviceCredential: "deny",
    });
    expect(error.code).toBe("SensitiveReadRequiresPersonalCredential");
    expect(error.message).toBe(
      `${MESSAGE}: it can return text a build or another person produced, so a personal account is required`,
    );
  });

  it("keeps a reading the classification denies on the plain refusal", () => {
    // Ordinary data the provider simply never opened to a shared account: there
    // is no personal-account advice to give that would not be wrong.
    const error = integrationError({
      effect: "read",
      sensitivity: "normal",
      serviceCredential: "deny",
    });
    expect(error.code).toBe("OperationNotAllowedWithServiceCredential");
    expect(error.message).toBe(MESSAGE);
  });

  it("fails closed on an operation the provider never classified", () => {
    const error = integrationError(undefined);
    expect(error.code).toBe("OperationNotAllowedWithServiceCredential");
    expect(error.message).toBe(
      `${MESSAGE}: the service credential performs reads only`,
    );
  });

  for (const [provider, operations] of Object.entries(CATALOGS)) {
    it(`answers with the broker's reason for every ${provider} operation`, () => {
      for (const [operation, definition] of Object.entries(operations)) {
        const broker = evaluateServiceOperation({
          metadata: definition.security,
          capability: definition.capability,
          profile: PROFILE,
          // Every catalog names a boundary kind or none; a bounded read passes
          // this step against a profile that bounds projects.
          boundaryKind: definition.security.requiresResourceBoundary
            ? "projects"
            : undefined,
        });
        const label = `${provider}.${operation}`;
        if (broker.allowed) {
          expect(refusal(definition.security), label).toBeUndefined();
          continue;
        }
        const error = integrationError(definition.security);
        expect(error.code, label).toBe(denialCode(broker));
      }
    });
  }

  it("refuses the same way the broker does on an unclassified operation", () => {
    // The default the two locks share: the most restrictive classification.
    const error = integrationError(UNCLASSIFIED_OPERATION);
    const broker = evaluateServiceOperation({
      metadata: UNCLASSIFIED_OPERATION,
      capability: undefined,
      profile: PROFILE,
      boundaryKind: undefined,
    });
    expect(error.code).toBe(denialCode(broker));
    expect(error.code).toBe("OperationNotAllowedWithServiceCredential");
  });
});
