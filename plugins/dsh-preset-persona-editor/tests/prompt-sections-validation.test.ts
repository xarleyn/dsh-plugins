/**
 * The section rules a composition must satisfy: the ones the harness itself
 * enforces at mount, plus the ones that keep a hand-edited composition
 * readable.
 *
 * A refusal is the editor's own typed failure and a reason naming what broke,
 * so both are asserted. That is what makes these cases more than a crash test:
 * a `TypeError` thrown inside a rule would satisfy `toThrow()` and leave the
 * rule it crashed on untested.
 */

import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMITS,
  validateSections,
  type PersonaLimits,
} from "../src/host/validation.js";
import type { PromptSectionDraft } from "../src/types.js";

/** What the page is handed when a list is refused. */
interface Refusal {
  readonly code: string;
  readonly reason: string;
}

/**
 * The refusal `validateSections` answers a list with, or `null` when it takes it.
 * @param sections - the list the rules are run over.
 * @param limits - the deployment's ceilings, defaulted to the plugin's own.
 */
function refusalOf(
  sections: readonly PromptSectionDraft[],
  limits: PersonaLimits = DEFAULT_LIMITS,
): Refusal | null {
  try {
    validateSections("demo", sections, limits);
  } catch (error) {
    // Anything other than a typed refusal is a crash inside these rules, and it
    // has to leave this helper the way it arrived: a refusal the page renders
    // and a bug are two different facts.
    if (!(error instanceof RemoteError)) throw error;
    const details = error.details as { readonly reason?: unknown };
    return { code: error.code, reason: String(details.reason ?? "") };
  }
  return null;
}

describe("section validation", () => {
  const cases: readonly {
    name: string;
    refuses: RegExp;
    sections: PromptSectionDraft[];
  }[] = [
    {
      name: "duplicate names",
      refuses: /share the name/u,
      sections: [
        { name: "team:style", order: 1, text: "a", enabled: true },
        { name: "team:style", order: 2, text: "b", enabled: true },
      ],
    },
    {
      name: "a fractional order",
      refuses: /must be a whole number/u,
      sections: [{ name: "team:style", order: 1.5, text: "a", enabled: true }],
    },
    {
      name: "an empty text",
      refuses: /has no text/u,
      sections: [{ name: "team:style", order: 1, text: "   ", enabled: true }],
    },
    {
      name: "a name with a newline",
      refuses: /single line/u,
      sections: [{ name: "team:\nstyle", order: 1, text: "a", enabled: true }],
    },
    {
      name: "an empty name",
      refuses: /single line/u,
      sections: [{ name: "", order: 1, text: "a", enabled: true }],
    },
  ];

  for (const entry of cases) {
    it(`refuses ${entry.name}`, () => {
      const refusal = refusalOf(entry.sections);
      expect(refusal?.code).toBe("preset-persona/invalid");
      expect(refusal?.reason).toMatch(entry.refuses);
    });
  }

  /**
   * A list these rules take, for the ceilings an operator lowers underneath it.
   * It is legal by itself so a refusal of it can only be the ceiling's doing.
   */
  const TWO_SECTIONS: readonly PromptSectionDraft[] = [
    { name: "team:one", order: 1, text: "a", enabled: true },
    { name: "team:two", order: 2, text: "b", enabled: true },
  ];

  it("refuses a list over the deployment's own ceiling", () => {
    expect(refusalOf(TWO_SECTIONS)).toBeNull();
    const refusal = refusalOf(TWO_SECTIONS, {
      ...DEFAULT_LIMITS,
      maxSections: 1,
    });
    expect(refusal?.code).toBe("preset-persona/invalid");
    expect(refusal?.reason).toMatch(/this deployment allows 1/u);
  });

  it("accepts a list the harness could mount", () => {
    expect(
      refusalOf([
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
      ]),
    ).toBeNull();
  });
});
