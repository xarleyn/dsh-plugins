import { describe, expect, it, vi } from "vitest";
import {
  guardReviewDelegation,
  REVIEW_DELEGATION_DENIED,
  type ReviewToolRegistry,
} from "../src/review-delegation.js";

describe("independent reviewer delegation guard", () => {
  it("rejects an arbitrarily named activation tool before its body and allows structured completion", () => {
    const scope = {};
    const definitions = new Map<string, unknown>([
      [
        "verify_source",
        { type: "object", properties: { kind: { const: "activation" } } },
      ],
    ]);
    let guard!: (execution: { name: string }) => string | undefined;
    const unregister = vi.fn();
    const tools: ReviewToolRegistry = {
      get: vi.fn((name, actualScope) => {
        expect(actualScope).toBe(scope);
        return { output: { schema: definitions.get(name) } };
      }),
      guard: (value) => {
        guard = value;
        return unregister;
      },
    };
    const dispose = guardReviewDelegation(tools, scope);
    const startChild = vi.fn();
    if (guard({ name: "verify_source" }) === undefined) startChild();
    expect(startChild).not.toHaveBeenCalled();
    expect(guard({ name: "verify_source" })).toBe(REVIEW_DELEGATION_DENIED);
    for (const name of [
      "read",
      "docs_search",
      "jira_search_issues",
      "structured_output",
    ])
      expect(guard({ name })).toBeUndefined();
    // The live definition wins even when a skill registers/replaces a tool later.
    definitions.set("later_alias", {
      oneOf: [
        { properties: { kind: { enum: ["continuable", "background"] } } },
      ],
    });
    expect(guard({ name: "later_alias" })).toBe(REVIEW_DELEGATION_DENIED);
    definitions.delete("verify_source");
    expect(guard({ name: "verify_source" })).toBeUndefined();
    dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });

  it.each(["domain_expert", "domain_delegate", "subagent", "qa_subagent"])(
    "also refuses the %s delegation entry without an activation schema",
    (name) => {
      let guard!: (execution: { name: string }) => string | undefined;
      guardReviewDelegation(
        {
          get: () => undefined,
          guard: (value) => {
            guard = value;
            return () => {};
          },
        },
        {},
      );
      expect(guard({ name })).toBe(REVIEW_DELEGATION_DENIED);
    },
  );
});
