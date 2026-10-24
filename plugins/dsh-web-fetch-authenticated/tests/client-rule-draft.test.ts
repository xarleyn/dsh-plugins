import { describe, expect, it } from "vitest";
import { draftToRule, ruleToDraft } from "../src/client/sections/rule-draft.js";
import type { AuthenticatedFetchRule } from "../src/types.js";

const rule: AuthenticatedFetchRule = {
  id: "demo-rule",
  name: "Demo rule",
  enabled: true,
  match: { hosts: ["example.com"] },
  auth: { type: "none" },
  redirects: { mode: "same-origin", maxRedirects: 0 },
};

describe("redirect count in the rule editor", () => {
  it("saves an existing zero-redirect rule without losing its limit", () => {
    const result = draftToRule(ruleToDraft(rule));
    expect(result.errors).toEqual([]);
    expect(result.rule.redirects?.maxRedirects).toBe(0);
  });

  it("clears a redirect override back to the inherited default", () => {
    const result = draftToRule({ ...ruleToDraft(rule), maxRedirects: " " });
    expect(result.errors).toEqual([]);
    expect(result.rule.redirects).not.toHaveProperty("maxRedirects");
  });

  it.each(["-1", "1.5", "NaN", "Infinity", "9007199254740993", "1e2"])(
    "keeps invalid redirect count %s out of the saved rule",
    (value) => {
      const result = draftToRule({ ...ruleToDraft(rule), maxRedirects: value });
      expect(result.errors).toContain(
        "Max redirects must be a non-negative integer.",
      );
    },
  );

  it("continues to reject zero for a positive timeout budget", () => {
    const result = draftToRule({ ...ruleToDraft(rule), timeoutMs: "0" });
    expect(result.errors).toContain("Timeout must be a positive integer.");
  });
});
