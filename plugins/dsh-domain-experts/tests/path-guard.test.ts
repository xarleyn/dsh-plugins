import { describe, expect, it } from "vitest";
import {
  compileGlob,
  decidePath,
  globMatches,
  isWriteAllowed,
  pathRulesOf,
  refusalFor,
} from "../src/host/scopes/path-guard.js";
import { normalizePath } from "../src/host/schema.js";

const RULES = {
  primary: ["services/payments/**", "docs/payments/**"],
  sharedReadOnly: ["packages/common/**"],
  denied: ["services/inventory/**"],
};

describe("path-guard: glob compilation", () => {
  it("matches a directory and everything below a trailing /**", () => {
    expect(globMatches("services/payments/**", "services/payments")).toBe(true);
    expect(
      globMatches("services/payments/**", "services/payments/api/handler.ts"),
    ).toBe(true);
    expect(
      globMatches("services/payments/**", "services/payments-other/x.ts"),
    ).toBe(false);
  });

  it("treats * as a single-segment wildcard", () => {
    expect(
      globMatches("services/*/index.ts", "services/payments/index.ts"),
    ).toBe(true);
    expect(
      globMatches("services/*/index.ts", "services/payments/api/index.ts"),
    ).toBe(false);
  });

  it("treats ? as one character inside a segment", () => {
    expect(globMatches("v?/file.ts", "v1/file.ts")).toBe(true);
    expect(globMatches("v?/file.ts", "v12/file.ts")).toBe(false);
  });

  it("spans segments with /**/ and may match zero of them", () => {
    expect(globMatches("services/**/handler.ts", "services/handler.ts")).toBe(
      true,
    );
    expect(
      globMatches("services/**/handler.ts", "services/payments/api/handler.ts"),
    ).toBe(true);
  });

  it("matches an exact pattern only at that path", () => {
    expect(globMatches("services/payments", "services/payments")).toBe(true);
    expect(globMatches("services/payments", "services/payments/api.ts")).toBe(
      false,
    );
  });

  it("does not treat regex metacharacters as patterns", () => {
    expect(globMatches("a+b/c.ts", "a+b/c.ts")).toBe(true);
    expect(globMatches("a+b/c.ts", "aab/c.ts")).toBe(false);
  });

  it("reuses a compiled pattern", () => {
    expect(compileGlob("services/**")).toBe(compileGlob("services/**"));
  });
});

describe("path-guard: normalization and refusal", () => {
  it("collapses separators and a leading ./", () => {
    expect(normalizePath(".\\services\\\\payments/")).toBe("services/payments");
  });

  it("refuses traversal, absolute paths and NUL bytes", () => {
    expect(refusalFor("../foreign-domain/secret.ts")).toBe("escape");
    expect(refusalFor("services/../../etc/passwd")).toBe("escape");
    expect(refusalFor("/etc/passwd")).toBe("absolute");
    expect(refusalFor("C:\\Windows\\system32")).toBe("absolute");
    expect(refusalFor("services/\0x")).toBe("nul-byte");
    expect(refusalFor("   ")).toBe("empty");
  });

  it("accepts an ordinary workspace-relative path", () => {
    expect(refusalFor("services/payments/api/handler.ts")).toBeNull();
  });
});

describe("path-guard: decision", () => {
  it("allows a primary path", () => {
    const decision = decidePath(RULES, "services/payments/api/handler.ts");
    expect(decision).toEqual({
      allowed: true,
      class: "primary",
      matchedBy: "services/payments/**",
    });
  });

  it("allows a shared path as read-only class", () => {
    const decision = decidePath(RULES, "packages/common/util.ts");
    expect(decision).toEqual({
      allowed: true,
      class: "shared",
      matchedBy: "packages/common/**",
    });
  });

  it("lets a denial win over an allow", () => {
    const rules = {
      primary: ["services/**"],
      sharedReadOnly: [],
      denied: ["services/inventory/**"],
    };
    const decision = decidePath(rules, "services/inventory/stock.ts");
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({
      reason: "denied",
      matchedBy: "services/inventory/**",
    });
  });

  it("refuses a path no rule classifies", () => {
    const decision = decidePath(RULES, "services/platform/main.ts");
    expect(decision).toMatchObject({ allowed: false, reason: "outside-scope" });
  });

  it("refuses an escape before any pattern is consulted", () => {
    const decision = decidePath(RULES, "../services/payments/x.ts");
    expect(decision).toMatchObject({ allowed: false, reason: "escape" });
  });

  it("refuses an absolute path", () => {
    expect(
      decidePath(RULES, "/workspace/services/payments/x.ts"),
    ).toMatchObject({
      allowed: false,
      reason: "absolute",
    });
  });

  it("keeps shared paths out of writes", () => {
    const filesystem = {
      primary: ["services/payments/**"],
      sharedReadOnly: ["packages/common/**"],
      denied: [],
    };
    expect(isWriteAllowed(filesystem, "services/payments/x.ts")).toBe(true);
    expect(isWriteAllowed(filesystem, "packages/common/x.ts")).toBe(false);
    expect(isWriteAllowed(filesystem, "elsewhere/x.ts")).toBe(false);
  });

  it("derives rules from a filesystem config", () => {
    const rules = pathRulesOf({
      primary: ["a/**"],
      sharedReadOnly: ["b/**"],
      denied: [],
    });
    expect(rules.primary).toEqual(["a/**"]);
    expect(rules.sharedReadOnly).toEqual(["b/**"]);
  });
});
