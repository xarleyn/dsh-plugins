import { describe, expect, it } from "vitest";
import { qaToolDenial, qaToolPolicyPlan } from "../../src/lockdown-policy.js";

describe("QA tool policy", () => {
  it("denies every tool under the default empty allow-list", () => {
    expect(qaToolDenial(new Set(), "run_code")).toMatch(/not available/u);
    expect(qaToolDenial(new Set(), "shell")).toMatch(/not available/u);
  });

  it("permits only exact reviewed names", () => {
    const allowed = new Set(["knowledge.read"]);
    expect(qaToolDenial(allowed, "knowledge.read")).toBeUndefined();
    expect(qaToolDenial(allowed, "knowledge.write")).toMatch(/not available/u);
  });

  it("does not implicitly expose a newly installed global tool", () => {
    const allowed = new Set(["knowledge.read"]);
    const toolsAfterInstall = ["knowledge.read", "github.createIssue"];
    expect(
      toolsAfterInstall.filter(
        (name) => qaToolDenial(allowed, name) === undefined,
      ),
    ).toEqual(["knowledge.read"]);
  });

  it("admits exactly the dynamic names the catalog attached", () => {
    const allowed = new Set(["read"]);
    // The operator's allow-list cannot name a tool that appears only after a
    // skill load, so the guard reads the activation set per call.
    expect(
      qaToolDenial(allowed, "qa_tools_selfcheck", ["qa_tools_selfcheck"]),
    ).toBeUndefined();
    expect(qaToolDenial(allowed, "qa_tools_selfcheck")).toMatch(
      /not available/u,
    );
    expect(
      qaToolDenial(allowed, "read", ["qa_tools_selfcheck"]),
    ).toBeUndefined();
    expect(qaToolDenial(allowed, "bash", ["qa_tools_selfcheck"])).toMatch(
      /not available/u,
    );
  });

  it("retains preset-scoped tools in the applied restriction", () => {
    const configured = ["glob", "read", "web_fetch"];
    const presetView = new Set(configured);
    const globalView = new Set<string>();

    const plan = qaToolPolicyPlan(configured, (name) => presetView.has(name));

    expect(plan.unknown).toEqual([]);
    expect(plan.allow).toEqual(configured);
    expect(plan.allow.filter((name) => globalView.has(name))).toEqual([]);
  });

  it("reports only names missing from the complete agent view", () => {
    const plan = qaToolPolicyPlan(
      ["read", "web_fetch"],
      (name) => name === "read",
    );

    expect(plan).toEqual({
      allow: ["read", "web_fetch"],
      unknown: ["web_fetch"],
    });
  });
});
