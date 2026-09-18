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

import { sectionIssues } from "../src/client/store.js";

describe("sectionIssues", () => {
  it("accepts a complete list", () => {
    expect(
      sectionIssues([
        {
          name: "team:style",
          order: 2500,
          text: "Answer briefly.",
          enabled: true,
        },
        {
          name: "harness:notes",
          order: 9000,
          text: "End with a summary.",
          enabled: false,
        },
      ]),
    ).toEqual([]);
  });

  it("marks each way a section can be unfinished, by index", () => {
    const issues = sectionIssues([
      { name: "", order: 1, text: "text", enabled: true },
      { name: " padded", order: 2, text: "text", enabled: true },
      { name: "dupe", order: 3, text: "text", enabled: true },
      { name: "dupe", order: 4, text: "text", enabled: true },
      { name: "team:fractional", order: 1.5, text: "text", enabled: true },
      { name: "team:textless", order: 6, text: "   ", enabled: true },
    ]);
    expect(issues.map((issue) => issue.index)).toEqual([0, 1, 3, 4, 5]);
    expect(issues[2]?.reason).toContain("already uses this name");
  });
});
