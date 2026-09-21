/**
 * The one classification every provider uses to answer "is this service
 * credential still usable?". It is shared policy, so it is pinned here once
 * instead of being re-derived from each provider's own tests.
 */
import { describe, expect, it } from "vitest";

import { IntegrationError } from "../src/errors.js";
import { healthFromFailure } from "../src/providers/shared/health.js";

describe("healthFromFailure", () => {
  it("reports an expired secret as expired", () => {
    expect(
      healthFromFailure(
        new IntegrationError("CredentialExpired", "Credential expired"),
      ),
    ).toEqual({ status: "expired" });
  });

  it.each(["CredentialRevoked", "ProviderPermissionDenied"] as const)(
    "reports %s as revoked",
    (code) => {
      expect(healthFromFailure(new IntegrationError(code, "Denied"))).toEqual({
        status: "revoked",
      });
    },
  );

  it.each(["ProviderUnavailable", "RateLimited", "InvalidRequest"] as const)(
    "reports %s as unreachable rather than guessing a credential verdict",
    (code) => {
      expect(healthFromFailure(new IntegrationError(code, "Failed"))).toEqual({
        status: "unreachable",
      });
    },
  );

  it.each([
    ["a plain error", new Error("boom")],
    ["a string", "boom"],
    ["undefined", undefined],
    ["null", null],
  ])("reports %s as unreachable", (_label, thrown) => {
    expect(healthFromFailure(thrown)).toEqual({ status: "unreachable" });
  });
});
