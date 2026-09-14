import { describe, expect, it } from "vitest";
import { delegationVerdictOf, parallelBudgetOf } from "../src/host/policy.js";
import { domainOf } from "./helpers/fakes.js";

describe("delegation policy", () => {
  it("allows expert-only access to another enabled domain", () => {
    const verdict = delegationVerdictOf(
      domainOf("payments"),
      "payments",
      domainOf("inventory"),
      "inventory",
    );
    expect(verdict).toMatchObject({
      allowed: true,
      mode: "expert-only",
      message: "",
    });
  });

  it("refuses a caller that no longer exists", () => {
    const verdict = delegationVerdictOf(
      undefined,
      "ghost",
      domainOf("inventory"),
      "inventory",
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("no longer exists");
  });

  it("refuses every target when cross-domain access is off", () => {
    const caller = domainOf("payments", {
      delegation: {
        ...domainOf("payments").delegation,
        allowCrossDomain: false,
      },
    });
    const verdict = delegationVerdictOf(
      caller,
      "payments",
      domainOf("inventory"),
      "inventory",
    );
    expect(verdict).toMatchObject({ allowed: false, mode: "disabled" });
    expect(verdict.message).toContain("cross-domain access disabled");
  });

  it("refuses every target in disabled mode", () => {
    const caller = domainOf("payments", {
      delegation: {
        ...domainOf("payments").delegation,
        crossDomainMode: "disabled",
      },
    });
    expect(
      delegationVerdictOf(
        caller,
        "payments",
        domainOf("inventory"),
        "inventory",
      ).allowed,
    ).toBe(false);
  });

  it("refuses self-delegation even when everything else allows it", () => {
    const verdict = delegationVerdictOf(
      domainOf("payments"),
      "payments",
      domainOf("payments"),
      "payments",
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("your own domain");
  });

  it("enforces an explicit target list", () => {
    const caller = domainOf("payments", {
      delegation: {
        ...domainOf("payments").delegation,
        targets: ["inventory"],
      },
    });
    expect(
      delegationVerdictOf(
        caller,
        "payments",
        domainOf("inventory"),
        "inventory",
      ).allowed,
    ).toBe(true);
    const refused = delegationVerdictOf(
      caller,
      "payments",
      domainOf("platform"),
      "platform",
    );
    expect(refused.allowed).toBe(false);
    expect(refused.message).toContain("may only reach inventory");
  });

  it("refuses a missing or disabled target", () => {
    const caller = domainOf("payments");
    expect(
      delegationVerdictOf(caller, "payments", undefined, "ghost").allowed,
    ).toBe(false);
    expect(
      delegationVerdictOf(
        caller,
        "payments",
        domainOf("platform", { enabled: false }),
        "platform",
      ).allowed,
    ).toBe(false);
  });

  it("allows direct-read mode as well", () => {
    const caller = domainOf("payments", {
      delegation: {
        ...domainOf("payments").delegation,
        crossDomainMode: "direct-read",
      },
    });
    expect(
      delegationVerdictOf(
        caller,
        "payments",
        domainOf("inventory"),
        "inventory",
      ),
    ).toMatchObject({ allowed: true, mode: "direct-read" });
  });
});

describe("parallel budget", () => {
  it("admits runs below the limit", () => {
    expect(parallelBudgetOf(0, 3)).toEqual({
      exceeded: false,
      limit: 3,
      active: 0,
    });
    expect(parallelBudgetOf(2, 3).exceeded).toBe(false);
  });

  it("refuses at or above the limit", () => {
    expect(parallelBudgetOf(3, 3).exceeded).toBe(true);
    expect(parallelBudgetOf(4, 3).exceeded).toBe(true);
  });

  it("treats a non-positive limit as unlimited", () => {
    expect(parallelBudgetOf(99, 0).exceeded).toBe(false);
  });
});
