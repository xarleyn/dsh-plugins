import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import type { QaLockdownProof } from "../src/types.js";
import {
  attestationHint,
  attestationReasonOf,
  proofMatchesConfig,
} from "../src/client/attestation.js";

function proof(overrides: Partial<QaLockdownProof> = {}): QaLockdownProof {
  return {
    sessionId: "session-1",
    enabled: true,
    agentPresetMatches: true,
    workspaceMatches: true,
    modelMatches: true,
    sandboxIsReadOnly: true,
    approvalIsNever: true,
    permissionPreset: "qa-read-only",
    toolPolicyLoaded: true,
    toolAllowList: [],
    ...overrides,
  };
}

describe("attestation diagnostics", () => {
  it("parses the Host reason marker from wire failures", () => {
    expect(
      attestationReasonOf({
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
      }),
    ).toBe("unknown-tools");
    expect(attestationReasonOf({ message: "plain refusal" })).toBeNull();
    expect(attestationReasonOf(undefined)).toBeNull();
  });

  it("maps known reason codes to operator hints and falls back generically", () => {
    for (const reason of [
      "unknown-tools",
      "composition-mismatch",
      "permission-preset",
      "adoption-refused",
    ]) {
      expect(attestationHint(reason)).not.toContain("Host logs");
    }
    expect(attestationHint("attestation-failed")).toContain("Host logs");
    expect(attestationHint(null)).toContain("Host logs");
  });
});

describe("proofMatchesConfig", () => {
  const lockdown = resolveConfig().lockdown;

  it("accepts a proof that answers the deployment lockdown config", () => {
    expect(proofMatchesConfig(proof(), lockdown, "session-1")).toBe(true);
  });

  it("refuses a proof for another session or a disabled lockdown", () => {
    expect(proofMatchesConfig(proof(), lockdown, "other")).toBe(false);
    expect(
      proofMatchesConfig(proof({ enabled: false }), lockdown, "session-1"),
    ).toBe(false);
  });

  it("refuses when any verified fact is false", () => {
    for (const key of [
      "agentPresetMatches",
      "workspaceMatches",
      "modelMatches",
      "sandboxIsReadOnly",
      "approvalIsNever",
      "toolPolicyLoaded",
    ] as const) {
      const broken = proof({ [key]: false } as Partial<QaLockdownProof>);
      expect(proofMatchesConfig(broken, lockdown, "session-1")).toBe(false);
    }
  });

  it("refuses a different permission preset or allow-list", () => {
    expect(
      proofMatchesConfig(
        proof({ permissionPreset: "some-other-preset" }),
        lockdown,
        "session-1",
      ),
    ).toBe(false);
    expect(
      proofMatchesConfig(
        proof({ toolPolicyLoaded: false }),
        lockdown,
        "session-1",
      ),
    ).toBe(false);
    expect(
      proofMatchesConfig(
        proof({ toolAllowList: ["bash"] }),
        lockdown,
        "session-1",
      ),
    ).toBe(false);
    expect(
      proofMatchesConfig(
        proof({ toolAllowList: ["bash"] }),
        resolveConfig({ lockdown: { toolPolicy: { allow: ["bash"] } } })
          .lockdown,
        "session-1",
      ),
    ).toBe(true);
  });
});
