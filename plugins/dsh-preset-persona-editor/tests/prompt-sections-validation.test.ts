/**
 * The section rules a composition must satisfy: the ones the harness itself
 * enforces at mount, plus the ones that keep a hand-edited composition
 * readable.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS, validateSections } from "../src/host/validation.js";
import type { PromptSectionDraft } from "../src/types.js";

describe("section validation", () => {
  const cases: readonly { name: string; sections: PromptSectionDraft[] }[] = [
    {
      name: "duplicate names",
      sections: [
        { name: "team:style", order: 1, text: "a", enabled: true },
        { name: "team:style", order: 2, text: "b", enabled: true },
      ],
    },
    {
      name: "a fractional order",
      sections: [{ name: "team:style", order: 1.5, text: "a", enabled: true }],
    },
    {
      name: "an empty text",
      sections: [{ name: "team:style", order: 1, text: "   ", enabled: true }],
    },
    {
      name: "a name with a newline",
      sections: [{ name: "team:\nstyle", order: 1, text: "a", enabled: true }],
    },
    {
      name: "an empty name",
      sections: [{ name: "", order: 1, text: "a", enabled: true }],
    },
    {
      name: "more sections than the deployment allows",
      sections: [
        { name: "team:one", order: 1, text: "a", enabled: true },
        { name: "team:two", order: 2, text: "b", enabled: true },
      ],
    },
  ];

  for (const entry of cases.slice(0, 5)) {
    it(`refuses ${entry.name}`, () => {
      expect(() =>
        validateSections("demo", entry.sections, DEFAULT_LIMITS),
      ).toThrow();
    });
  }

  it("refuses a list over the deployment's own ceiling", () => {
    expect(() =>
      validateSections("demo", cases[5]?.sections ?? [], {
        ...DEFAULT_LIMITS,
        maxSections: 1,
      }),
    ).toThrow(/allows 1/u);
  });

  it("accepts a list the harness could mount", () => {
    expect(() =>
      validateSections(
        "demo",
        [
          {
            name: "team:style",
            order: 2500,
            text: "Answer briefly.",
            enabled: true,
          },
          {
            name: "team:notes",
            order: 9000,
            text: "End with a summary.",
            enabled: false,
          },
        ],
        DEFAULT_LIMITS,
      ),
    ).not.toThrow();
  });
});
