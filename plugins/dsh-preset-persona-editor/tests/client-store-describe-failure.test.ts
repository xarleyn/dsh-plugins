/**
 * The page controller: what the roster and the editor do on every transition,
 * including the ones the user only ever sees as a sentence.
 *
 * The Remote face is a stub, so a failure is delivered exactly as the gateway
 * would deliver it: an `{ ok: false, error }` result, never a rejection.
 */

import { describe, expect, it } from "vitest";

// Pulls the editor's own Remote failure codes into this test program.
import "../src/host/errors.js";

import { strings } from "../src/client/locale.js";
import { describeFailure } from "../src/client/store.js";

describe("describeFailure", () => {
  it("uses the page's own words for the editor's codes", () => {
    expect(
      describeFailure({ code: "preset-persona/conflict", message: "x" }),
    ).toBe(strings.conflict);
    expect(
      describeFailure({ code: "preset-persona/not-found", message: "x" }),
    ).toBe(strings.gone);
    expect(
      describeFailure({ code: "preset-persona/read-only", message: "x" }),
    ).toBe(strings.readOnlyShipped);
    expect(
      describeFailure({
        code: "preset-persona/invalid",
        message: "x",
        details: { reason: "the composition is not valid YAML" },
      }),
    ).toBe("the composition is not valid YAML");
  });

  it("shows an unknown failure's own message", () => {
    expect(describeFailure({ code: "gateway/internal", message: "boom" })).toBe(
      "boom",
    );
  });
});
