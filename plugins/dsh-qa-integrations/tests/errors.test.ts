/**
 * The two error policies every provider shares: which failures a listing may
 * pass over, and how a configuration failure names its scope. Both were copies
 * in each provider before, so they are pinned once here.
 */
import { describe, expect, it } from "vitest";

import {
  IntegrationError,
  recoverableResource,
  scopedConfigError,
} from "../src/errors.js";

describe("recoverableResource", () => {
  it.each(["ResourceNotFound", "ProviderPermissionDenied"] as const)(
    "lets a listing pass over a resource answered as %s",
    (code) => {
      expect(recoverableResource(new IntegrationError(code, "Missing"))).toBe(
        true,
      );
    },
  );

  it.each([
    "ProviderUnavailable",
    "RateLimited",
    "CredentialExpired",
    "InvalidRequest",
  ] as const)("does not swallow %s", (code) => {
    expect(recoverableResource(new IntegrationError(code, "Failed"))).toBe(
      false,
    );
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["undefined", undefined],
    ["a string", "boom"],
  ])("does not treat %s as a missing resource", (_label, thrown) => {
    expect(recoverableResource(thrown)).toBe(false);
  });
});

describe("scopedConfigError", () => {
  it("names the configuration an operator has to fix", () => {
    const configError = scopedConfigError("jira integration config");
    expect(configError("sites[0].baseUrl must be https")).toEqual(
      new Error("jira integration config: sites[0].baseUrl must be https"),
    );
  });

  it("keeps one scope per configuration module", () => {
    const one = scopedConfigError("gitlab integration config");
    const other = scopedConfigError(
      "qa-integrations managed service credentials",
    );
    expect(one("unknown key").message).toBe(
      "gitlab integration config: unknown key",
    );
    expect(other("profile id is required").message).toBe(
      "qa-integrations managed service credentials: profile id is required",
    );
  });
});
