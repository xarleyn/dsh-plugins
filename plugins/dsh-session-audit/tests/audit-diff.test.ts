import { describe, expect, it } from "vitest";
import { readFinding } from "@yadsh/dsh-audit-core";
import { diffFindings, diffReport } from "../src/client/audit-diff.js";

function finding(id: string, title = id) {
  return readFinding({ id, title })!;
}

describe("audit comparison", () => {
  it("matches stable IDs through reordering and reports added, removed and changed findings", () => {
    const keep = finding("keep");
    const before = finding("update", "Before");
    const after = finding("update", "After");
    expect(
      diffFindings(
        [finding("drop"), keep, before],
        [after, finding("add"), keep],
      ),
    ).toEqual({
      changes: [
        {
          kind: "changed",
          finding: after,
          previous: before,
          fields: ["title"],
        },
        { kind: "added", finding: finding("add") },
        { kind: "removed", finding: finding("drop") },
      ],
      skipped: 0,
    });
  });

  it("does not pair missing or repeated IDs by position", () => {
    expect(
      diffFindings(
        [finding(""), finding("dup"), finding("dup")],
        [finding("dup"), finding("fixed")],
      ),
    ).toEqual({
      changes: [{ kind: "added", finding: finding("fixed") }],
      skipped: 4,
    });
  });

  it("shows changed report lines with their original line numbers", () => {
    expect(
      diffReport("Intro\r\nKeep\r\nBefore\r\nEnd", "Intro\nKeep\nAfter\nEnd"),
    ).toEqual([
      { kind: "removed", line: 3, text: "Before" },
      { kind: "added", line: 3, text: "After" },
    ]);
    expect(diffReport("", "Added")).toEqual([
      { kind: "added", line: 1, text: "Added" },
    ]);
    expect(diffReport("Same\n".repeat(301), "Other")).toBeNull();
    expect(diffReport("a".repeat(49_153), "b")).toBeNull();
  });
});
