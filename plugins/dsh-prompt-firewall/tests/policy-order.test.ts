import type { PromptAssembly } from "@deepseek-ai/dsh-system-prompt";
import { describe, expect, it, vi } from "vitest";
import { AuditStore } from "../src/audit.js";
import { resolveConfig } from "../src/config.js";
import { applyFirewall } from "../src/firewall.js";
import { FirewallMetrics } from "../src/metrics.js";
import { compileRules, evaluateSection } from "../src/rules.js";
import type {
  FirewallAction,
  FirewallDecision,
  PromptFirewallConfig,
  PromptSectionAudit,
} from "../src/types.js";

// Pins the two policy ladders that `applyFirewall` is built on: the per-entry
// ladder of SPEC §9 (`evaluateSection`: exact-protect, core-protect, mode
// override, then exact → prefix → pattern with allow ahead of block inside
// each tier, defaults last) and the surrounding order in `applyFirewall`
// (the `complete` short-circuit, observability before the filtering guard,
// fail-open on any internal error).

function assembly(
  sections: Array<{ name: string; text: string; complete?: boolean }>,
): PromptAssembly {
  return {
    sections,
    contexts: [{ name: "runtime", text: "context" }],
    tools: [],
    variables: { cwd: "/workspace" },
  };
}

function decide(name: string, config: PromptFirewallConfig): FirewallDecision {
  return evaluateSection(
    { name, text: "content" },
    compileRules(resolveConfig(config)),
  );
}

const AUDIT_DECISION: Record<FirewallAction, PromptSectionAudit["decision"]> = {
  allow: "allowed",
  block: "blocked",
  protect: "protected",
};

const COLLIDING = "plugin:demo:core";

/** One entry that every rule kind of SPEC §9 claims at the same time. */
const FIVE_KINDS: PromptFirewallConfig = {
  protectedSections: [COLLIDING],
  allowedSections: [COLLIDING],
  blockedSections: [COLLIDING],
  blockedPrefixes: ["plugin:demo:"],
  allowedPatterns: ["plugin:demo:*"],
  blockedPatterns: ["plugin:*"],
};

interface RuleRow {
  readonly title: string;
  readonly name: string;
  readonly config: PromptFirewallConfig;
  readonly expected: FirewallDecision;
}

const RULE_MATRIX: readonly RuleRow[] = [
  {
    title: "exact-protect beats allow, block, prefix and pattern on one entry",
    name: COLLIDING,
    config: FIVE_KINDS,
    expected: { action: "protect", reason: "exact-protect", rule: COLLIDING },
  },
  {
    title: "core-protect beats an exact, prefix and pattern block",
    name: "tool:run_code",
    config: {
      blockedSections: ["tool:run_code"],
      blockedPrefixes: ["tool:"],
      blockedPatterns: ["tool:*"],
    },
    expected: { action: "protect", reason: "core-protect", rule: "tool:" },
  },
  {
    title: "core-protect still applies in allowlist mode",
    name: "harness:identity",
    config: { mode: "allowlist" },
    expected: {
      action: "protect",
      reason: "core-protect",
      rule: "harness:",
    },
  },
  {
    title:
      "with protectCoreSections off a core entry falls to the block prefix",
    name: "tool:run_code",
    config: { protectCoreSections: false, blockedPrefixes: ["tool:"] },
    expected: {
      action: "block",
      reason: "prefix-block",
      rule: "tool:",
    },
  },
  {
    title: "exact-protect still wins while the firewall is disabled",
    name: COLLIDING,
    config: { ...FIVE_KINDS, enabled: false },
    expected: { action: "protect", reason: "exact-protect", rule: COLLIDING },
  },
  {
    title: "exact-allow beats exact-block on one entry",
    name: COLLIDING,
    config: { allowedSections: [COLLIDING], blockedSections: [COLLIDING] },
    expected: { action: "allow", reason: "exact-allow", rule: COLLIDING },
  },
  {
    title: "exact-allow beats a block prefix and a block pattern",
    name: COLLIDING,
    config: {
      allowedSections: [COLLIDING],
      blockedPrefixes: ["plugin:demo:"],
      blockedPatterns: ["plugin:*"],
    },
    expected: { action: "allow", reason: "exact-allow", rule: COLLIDING },
  },
  {
    title: "exact-block beats an allow prefix",
    name: COLLIDING,
    config: { blockedSections: [COLLIDING], allowedPrefixes: ["plugin:demo:"] },
    expected: { action: "block", reason: "exact-block", rule: COLLIDING },
  },
  {
    title: "exact-block beats an allow pattern",
    name: COLLIDING,
    config: { blockedSections: [COLLIDING], allowedPatterns: ["plugin:*"] },
    expected: { action: "block", reason: "exact-block", rule: COLLIDING },
  },
  {
    title: "prefix-allow beats prefix-block on the same name",
    name: "plugin:demo:ok",
    config: {
      allowedPrefixes: ["plugin:demo:ok"],
      blockedPrefixes: ["plugin:demo:"],
    },
    expected: {
      action: "allow",
      reason: "prefix-allow",
      rule: "plugin:demo:ok",
    },
  },
  {
    title: "prefix-block beats an allow pattern",
    name: "plugin:demo:noisy",
    config: {
      blockedPrefixes: ["plugin:demo:"],
      allowedPatterns: ["plugin:*"],
    },
    expected: {
      action: "block",
      reason: "prefix-block",
      rule: "plugin:demo:",
    },
  },
  {
    title: "pattern-allow beats pattern-block",
    name: "plugin:demo:noisy",
    config: {
      allowedPatterns: ["plugin:demo:*"],
      blockedPatterns: ["plugin:*"],
    },
    expected: {
      action: "allow",
      reason: "pattern-allow",
      rule: "plugin:demo:*",
    },
  },
  {
    title: "disabled firewall beats an exact allow and an exact block",
    name: COLLIDING,
    config: {
      enabled: false,
      allowedSections: [COLLIDING],
      blockedSections: [COLLIDING],
    },
    expected: { action: "allow", reason: "mode-off" },
  },
  {
    title: "off mode beats an exact block",
    name: COLLIDING,
    config: { mode: "off", blockedSections: [COLLIDING] },
    expected: { action: "allow", reason: "mode-off" },
  },
  {
    title: "audit mode beats an exact block",
    name: COLLIDING,
    config: { mode: "audit", blockedSections: [COLLIDING] },
    expected: { action: "allow", reason: "mode-audit" },
  },
  {
    title: "audit mode is reported instead of the matching exact allow",
    name: COLLIDING,
    config: {
      mode: "audit",
      allowedSections: [COLLIDING],
      blockedSections: [COLLIDING],
    },
    expected: { action: "allow", reason: "mode-audit" },
  },
  {
    title: "allowlist mode blocks an unmatched entry only as a default",
    name: "workspace:rules",
    config: { mode: "allowlist" },
    expected: { action: "block", reason: "allowlist-default" },
  },
  {
    title: "allowlist mode reports an exact block before its own default",
    name: COLLIDING,
    config: { mode: "allowlist", blockedSections: [COLLIDING] },
    expected: { action: "block", reason: "exact-block", rule: COLLIDING },
  },
  {
    title: "an allow pattern rescues an entry from the allowlist default",
    name: "plugin:extra",
    config: { mode: "allowlist", allowedPatterns: ["plugin:*"] },
    expected: {
      action: "allow",
      reason: "pattern-allow",
      rule: "plugin:*",
    },
  },
  {
    title: "unknownPluginPolicy blocks an unmatched plugin before the default",
    name: "plugin:unknown",
    config: { unknownPluginPolicy: "block" },
    expected: { action: "block", reason: "unknown-plugin-policy" },
  },
  {
    title: "unknownPluginPolicy leaves a non-plugin entry on the blocklist",
    name: "workspace:rules",
    config: { unknownPluginPolicy: "block" },
    expected: { action: "allow", reason: "blocklist-default" },
  },
  {
    title:
      "an allow pattern rescues an unknown plugin from unknownPluginPolicy",
    name: "plugin:unknown",
    config: { unknownPluginPolicy: "block", allowedPatterns: ["plugin:*"] },
    expected: { action: "allow", reason: "pattern-allow", rule: "plugin:*" },
  },
];

describe("rule ladder order", () => {
  it.each(RULE_MATRIX)(
    "evaluateSection resolves $title",
    ({ name, config, expected }) => {
      expect(decide(name, config)).toEqual(expected);
    },
  );

  it.each(RULE_MATRIX)(
    "applyFirewall filters identically for $title",
    ({ name, config, expected }) => {
      const original = assembly([{ name, text: "content" }]);
      const store = new AuditStore(10, false);
      const result = applyFirewall(original, {
        config: resolveConfig(config),
        auditStore: store,
      });

      expect(result.sections.map((section) => section.name)).toEqual(
        expected.action === "block" ? [] : [name],
      );
      // An assembly with nothing to remove is handed back by reference, and a
      // bypassed one never reaches the copy at all.
      expect(result === original).toBe(expected.action !== "block");
      expect(store.last()?.sections[0]).toMatchObject({
        decision: AUDIT_DECISION[expected.action],
        name,
        reason: expected.reason,
      });
    },
  );

  it("drops only the entry whose block prefix outranks its allow pattern", () => {
    const protectedEntry = { name: COLLIDING, text: "protected" };
    const noisyEntry = { name: "plugin:demo:noisy", text: "advertisement" };
    const coreEntry = { name: "tool:run_code", text: "critical" };
    const original = assembly([protectedEntry, noisyEntry, coreEntry]);
    const store = new AuditStore(10, false);

    const result = applyFirewall(original, {
      config: resolveConfig({
        protectedSections: [COLLIDING],
        allowedSections: [COLLIDING],
        blockedSections: [COLLIDING, "tool:run_code"],
        blockedPrefixes: ["plugin:demo:", "tool:"],
        allowedPatterns: ["plugin:demo:*"],
        blockedPatterns: ["plugin:*", "tool:*"],
      }),
      auditStore: store,
    });

    expect(result.sections).toEqual([protectedEntry, coreEntry]);
    expect(result.sections[0]).toBe(protectedEntry);
    expect(store.last()).toMatchObject({
      allowedSections: 2,
      blockedSections: 1,
      charsRemoved: noisyEntry.text.length,
    });
  });
});

describe("applyFirewall policy order", () => {
  it("audit mode keeps every blocked section and still records audit and metrics", () => {
    const original = assembly([{ name: "plugin:noisy", text: "12345678" }]);
    const store = new AuditStore(10, false);
    const metrics = new FirewallMetrics();

    const result = applyFirewall(original, {
      config: resolveConfig({
        blockedSections: ["plugin:noisy"],
        mode: "audit",
      }),
      auditStore: store,
      metrics,
    });

    expect(result).toBe(original);
    expect(result.sections).toHaveLength(1);
    expect(store.last()).toMatchObject({
      allowedSections: 1,
      blockedSections: 0,
      charsRemoved: 0,
      sections: [
        { name: "plugin:noisy", decision: "allowed", reason: "mode-audit" },
      ],
    });
    expect(metrics.snapshot()).toMatchObject({
      requestsTotal: 1,
      sectionsBlockedTotal: 0,
    });
  });

  it("keeps blocked sections for the disabled switch and for off mode alike", () => {
    for (const config of [{ enabled: false }, { mode: "off" }] as const) {
      const original = assembly([{ name: "plugin:noisy", text: "blocked" }]);
      const store = new AuditStore(10, false);
      const result = applyFirewall(original, {
        config: resolveConfig({ ...config, blockedSections: ["plugin:noisy"] }),
        auditStore: store,
      });

      expect(result).toBe(original);
      expect(store.last()?.bypassed).toBeUndefined();
      expect(store.last()).toMatchObject({
        blockedSections: 0,
        sections: [
          { name: "plugin:noisy", decision: "allowed", reason: "mode-off" },
        ],
      });
    }
  });

  it("short-circuits the evaluator on a complete marker instead of running it", () => {
    const original = assembly([
      { name: "complete", text: "exact prompt", complete: true },
      { name: "plugin:noisy", text: "blocked" },
    ]);
    const evaluate = vi.fn(() => {
      throw new Error("the evaluator must not be consulted");
    });
    const error = vi.fn();
    const store = new AuditStore(10, false);

    const result = applyFirewall(original, {
      config: resolveConfig({ blockedSections: ["plugin:noisy"] }),
      auditStore: store,
      evaluate,
      logger: { info: vi.fn(), warn: vi.fn(), error },
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(result).toBe(original);
    expect(store.last()).toMatchObject({
      blockedSections: 0,
      bypassReason: "complete prompt detected",
      bypassed: true,
    });
    expect(store.last()?.sections.map((section) => section.reason)).toEqual([
      "complete-prompt-bypass",
      "complete-prompt-bypass",
    ]);
  });

  it("complete bypass outranks audit mode in the recorded rows of one entry", () => {
    const original = assembly([
      { name: "complete", text: "exact prompt", complete: true },
      { name: "plugin:noisy", text: "blocked" },
    ]);
    const store = new AuditStore(10, false);

    const result = applyFirewall(original, {
      config: resolveConfig({
        blockedSections: ["plugin:noisy"],
        mode: "audit",
      }),
      auditStore: store,
    });

    // `applyFirewall` computes the `complete` short-circuit before consulting
    // the evaluator, so an audit mode that would answer "mode-audit" never
    // reaches these rows; the mode still contributes its no-filter guarantee.
    expect(result).toBe(original);
    expect(store.last()).toMatchObject({
      blockedSections: 0,
      bypassReason: "complete prompt detected",
      bypassed: true,
      sections: [
        {
          decision: "allowed",
          name: "complete",
          reason: "complete-prompt-bypass",
        },
        {
          decision: "allowed",
          name: "plugin:noisy",
          reason: "complete-prompt-bypass",
        },
      ],
    });
  });

  it("complete bypass outranks the disabled switch in the recorded rows", () => {
    const original = assembly([
      { name: "complete", text: "exact prompt", complete: true },
      { name: "plugin:noisy", text: "blocked" },
    ]);
    const store = new AuditStore(10, false);

    applyFirewall(original, {
      config: resolveConfig({
        blockedSections: ["plugin:noisy"],
        enabled: false,
      }),
      auditStore: store,
    });

    expect(store.last()?.sections.map((section) => section.reason)).toEqual([
      "complete-prompt-bypass",
      "complete-prompt-bypass",
    ]);
  });

  it("records audit and metrics before the guard that skips filtering", () => {
    const original = assembly([{ name: "plugin:noisy", text: "blocked" }]);
    const store = new AuditStore(10, false);
    const metrics = new FirewallMetrics();

    const result = applyFirewall(original, {
      config: resolveConfig({
        blockedSections: ["plugin:noisy"],
        mode: "off",
      }),
      auditStore: store,
      metrics,
    });

    expect(result).toBe(original);
    expect(metrics.snapshot().requestsTotal).toBe(1);
    expect(store.last()).toMatchObject({ totalSections: 1 });
  });

  it("counts metrics while audit recording is disabled, and filters anyway", () => {
    const original = assembly([{ name: "plugin:noisy", text: "blocked" }]);
    const store = new AuditStore(10, false);
    const metrics = new FirewallMetrics();

    const result = applyFirewall(original, {
      config: resolveConfig({
        audit: { enabled: false },
        blockedSections: ["plugin:noisy"],
      }),
      auditStore: store,
      metrics,
    });

    expect(result.sections).toEqual([]);
    expect(store.last()).toBeNull();
    expect(metrics.snapshot()).toMatchObject({
      requestsTotal: 1,
      sectionsBlockedTotal: 1,
    });
  });

  it("contains a failing audit store as fail-open and never reaches metrics", () => {
    class FailingAuditStore extends AuditStore {
      override record(): void {
        throw new Error("audit store unavailable");
      }
    }
    const original = assembly([{ name: "plugin:noisy", text: "blocked" }]);
    const metrics = new FirewallMetrics();
    const error = vi.fn();

    const result = applyFirewall(original, {
      config: resolveConfig({ blockedSections: ["plugin:noisy"] }),
      auditStore: new FailingAuditStore(10, false),
      logger: { info: vi.fn(), warn: vi.fn(), error },
      metrics,
    });

    expect(result).toBe(original);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("audit store unavailable"),
    );
    expect(metrics.snapshot().requestsTotal).toBe(0);
  });

  it("returns the untouched original assembly on an internal evaluator error", () => {
    const sections = [{ name: "plugin:noisy", text: "blocked" }];
    const original = assembly(sections);
    const store = new AuditStore(10, false);
    const metrics = new FirewallMetrics();

    const result = applyFirewall(original, {
      config: resolveConfig({ blockedSections: ["plugin:noisy"] }),
      auditStore: store,
      evaluate: () => {
        throw new Error("evaluator crashed");
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      metrics,
    });

    expect(result).toBe(original);
    expect(result.sections).toBe(sections);
    expect(store.last()).toBeNull();
    expect(metrics.snapshot().requestsTotal).toBe(0);
  });

  it("fails open on a malformed assembly before any rule is evaluated", () => {
    const original = {
      sections: [{ name: "", text: "no name" }],
    } as unknown as PromptAssembly;
    const store = new AuditStore(10, false);
    const error = vi.fn();

    const result = applyFirewall(original, {
      config: resolveConfig({ blockedSections: ["plugin:noisy"] }),
      auditStore: store,
      logger: { info: vi.fn(), warn: vi.fn(), error },
    });

    expect(result).toBe(original);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("non-empty string"),
    );
    expect(store.last()).toBeNull();
  });
});
