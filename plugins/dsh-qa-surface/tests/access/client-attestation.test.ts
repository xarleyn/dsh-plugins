import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import type { QaLockdownProof } from "../../src/types.js";
import {
  attestationHint,
  attestationReasonOf,
  proofMatchesConfig,
} from "../../src/client/attestation.js";

function proof(overrides: Partial<QaLockdownProof> = {}): QaLockdownProof {
  return {
    sessionId: "session-1",
    enabled: true,
    agentPresetMatches: true,
    workspaceMatches: true,
    modelMatches: true,
    sandboxModeMatches: true,
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
    // A hint may point at the Host logs for details; what it must not be is the
    // fallback, which says nothing but that.
    const fallback =
      "The specific mismatch facts are written to the Host logs.";
    for (const reason of [
      "unknown-tools",
      "agent-unavailable",
      "composition-mismatch",
      "permission-preset",
      "adoption-refused",
      "subagent-session",
    ]) {
      expect(attestationHint(reason)).not.toBe(fallback);
    }
    expect(attestationHint("attestation-failed")).toBe(fallback);
    expect(attestationHint(null)).toBe(fallback);
  });

  it("tells a chat with no agent behind it from another conversation's child", () => {
    // Both once read "agent is unavailable", which an operator could not
    // separate from a stand that had just restarted — and they ask for opposite
    // repairs: re-mount a preset, or leave the id alone. Each hint therefore has
    // to name its own cause and the move that follows from it.
    const noAgent = attestationHint("agent-unavailable");
    const routing = attestationHint("subagent-session");
    expect(noAgent).not.toBe(routing);
    expect(noAgent).toContain("session.agent-resolve-rejected");
    expect(noAgent).toContain("restart");
    expect(noAgent).toContain("New chat");
    expect(routing).toContain("subagent routing owns");
    expect(routing).toContain("parent chat");
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

  it("reads the vacuous proof of an unpinned deployment as an admission", () => {
    // With lockdown off the Host evaluates none of the pins and answers with
    // their empty shapes, having admitted the session for this account. There
    // is nothing to compare but the session the proof names.
    const off = resolveConfig({ lockdown: { enabled: false } }).lockdown;
    expect(
      proofMatchesConfig(
        proof({
          enabled: false,
          sandboxModeMatches: false,
          approvalIsNever: false,
          permissionPreset: "",
          toolPolicyLoaded: false,
        }),
        off,
        "session-1",
      ),
    ).toBe(true);
    expect(proofMatchesConfig(proof({ enabled: false }), off, "other")).toBe(
      false,
    );
  });

  it("refuses when any verified fact is false", () => {
    for (const key of [
      "agentPresetMatches",
      "workspaceMatches",
      "modelMatches",
      "sandboxModeMatches",
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
