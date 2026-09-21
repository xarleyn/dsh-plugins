/**
 * The shared refusal every provider's argument validation ends in, and the
 * choice validator two providers used to carry a copy of each.
 */
import { describe, expect, it } from "vitest";

import { invalid, optionalChoice } from "../src/coerce.js";

const STATES = ["running", "finished", "queued"] as const;

describe("invalid", () => {
  it("refuses an argument with the field name in the message", () => {
    expect(() => invalid("pageId")).toThrowError(
      expect.objectContaining({
        name: "IntegrationError",
        code: "InvalidRequest",
        message: "pageId is invalid",
      }),
    );
  });

  it("appends the explanation so a model can repair the call", () => {
    try {
      invalid("cursor", "pass the cursor from the previous answer");
      // The refusal must throw; reaching here means the contract broke.
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "InvalidRequest",
        message: "cursor is invalid: pass the cursor from the previous answer",
      });
    }
  });
});

describe("optionalChoice", () => {
  it("passes a value from the set through", () => {
    expect(optionalChoice("finished", STATES, "state", 1, 16)).toBe("finished");
  });

  it("reads an absent argument as no choice", () => {
    expect(optionalChoice(undefined, STATES, "state", 1, 16)).toBeUndefined();
  });

  it("refuses a value outside the set", () => {
    expect(() =>
      optionalChoice("cancelled", STATES, "state", 1, 16),
    ).toThrowError("state is invalid");
  });

  it("refuses a value shorter than the provider's own floor", () => {
    // TeamCity locator values are at least three characters: a two-letter value
    // is not a state it could ever have meant.
    expect(() => optionalChoice("ab", STATES, "state", 3, 16)).toThrowError(
      "state is invalid",
    );
  });

  it("refuses a value longer than the field's ceiling", () => {
    expect(() =>
      optionalChoice("finished!", STATES, "state", 1, 8),
    ).toThrowError("state is invalid");
  });
});
