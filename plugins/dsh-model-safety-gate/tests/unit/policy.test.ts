import { describe, expect, it } from "vitest";

import { applyGateMode, decisionForCategories, mergeDecisions, mergeL0L1 } from "../../src/rules/policy.js";
import { emptyScan } from "../../src/rules/policy.js";
import { VERDICT_VERSION, type SafetyCategory, type SafetyVerdict, type ScanResult } from "../../src/types.js";

function scan(decision: ScanResult["decision"], categories: SafetyCategory[] = []): ScanResult {
  return {
    findings: decision === "allow" ? [] : [{ ruleId: "injection.ignore_previous", category: "prompt_injection", severity: "block", spanLength: 10, confidence: 0.9 }],
    decision,
    categories,
    scannedChars: 100,
    truncated: false,
  };
}

function verdict(decision: SafetyVerdict["decision"], categories: string[] = []): SafetyVerdict {
  return { version: VERDICT_VERSION, decision, confidence: 0.8, categories, summary: "l1" };
}

describe("mergeDecisions", () => {
  it("is monotonic: a deterministic block can never be weakened", () => {
    expect(mergeDecisions("block", "allow")).toBe("block");
    expect(mergeDecisions("allow", "block")).toBe("block");
    expect(mergeDecisions("warn", "block")).toBe("block");
  });

  it("escalates softer decisions", () => {
    expect(mergeDecisions("allow", "warn")).toBe("warn");
    expect(mergeDecisions("allow")).toBe("allow");
    expect(mergeDecisions("warn", "review")).toBe("review");
  });
});

describe("mergeL0L1", () => {
  it("keeps the L0 red line when L1 allows", () => {
    const merged = mergeL0L1(scan("block", ["prompt_injection"]), verdict("allow"));
    expect(merged.decision).toBe("block");
    expect(merged.l0Decision).toBe("block");
  });

  it("escalates when L1 blocks a clean L0 scan", () => {
    const merged = mergeL0L1(emptyScan(), verdict("block", ["jailbreak"]));
    expect(merged.decision).toBe("block");
    expect(merged.categories).toContain("jailbreak");
  });

  it("applies the L1 failure decision without weakening L0", () => {
    expect(mergeL0L1(emptyScan(), null, "block").decision).toBe("block");
    expect(mergeL0L1(emptyScan(), null, "allow").decision).toBe("allow");
    expect(mergeL0L1(scan("block", ["prompt_injection"]), null, "allow").decision).toBe("block");
  });

  it("unions rule ids from both layers", () => {
    const merged = mergeL0L1(scan("warn", ["prompt_injection"]), verdict("block", ["jailbreak"]));
    expect(merged.policyRuleIds).toContain("injection.ignore_previous");
  });
});

describe("applyGateMode", () => {
  it("audit mode never enforces", () => {
    expect(applyGateMode("block", "audit")).toBe("allow");
  });

  it("warn mode caps blocks at warn", () => {
    expect(applyGateMode("block", "warn")).toBe("warn");
    expect(applyGateMode("warn", "warn")).toBe("warn");
  });

  it("enforce mode applies decisions fully", () => {
    expect(applyGateMode("block", "enforce")).toBe("block");
  });
});

describe("decisionForCategories", () => {
  it("floors safety categories at the safety action", () => {
    const outcome = decisionForCategories(verdict("warn", ["jailbreak"]), { safety: "block", quality: "warn" });
    expect(outcome).toBe("block");
  });

  it("treats quality-only verdicts with the quality action", () => {
    // The action is a floor: an L1 `warn` stays warn, `block` only comes from
    // an explicit opt-in qualityAction.
    expect(decisionForCategories(verdict("warn", ["unclear"]), { safety: "block", quality: "warn" })).toBe("warn");
    expect(decisionForCategories(verdict("allow", ["spam"]), { safety: "block", quality: "block" })).toBe("block");
    expect(decisionForCategories(verdict("allow", ["spam"]), { safety: "block", quality: "warn" })).toBe("warn");
  });

  it("never hard-blocks usefulness unless opted in", () => {
    expect(decisionForCategories(verdict("warn", ["low_information"]), { safety: "block", quality: "warn" })).toBe("warn");
    expect(decisionForCategories(verdict("warn", ["low_information"]), { safety: "block", quality: "block" })).toBe("block");
  });
});
