import { describe, expect, it } from "vitest";
import { deriveDraftTitle, displayDraftTitle } from "../src/shared/types.js";

describe("draft title projection", () => {
  it("uses the trimmed first line and applies a hard length limit", () => {
    expect(deriveDraftTitle("  Add OTEL export\nwith Grafana  ")).toBe(
      "Add OTEL export",
    );
    expect(deriveDraftTitle("abcdef", 4)).toBe("abcd");
  });

  it("prefers an explicit title", () => {
    expect(displayDraftTitle({ title: "Pinned name", text: "derived" })).toBe(
      "Pinned name",
    );
    expect(displayDraftTitle({ text: "derived" })).toBe("derived");
  });

  it("rejects an invalid limit", () => {
    expect(() => deriveDraftTitle("text", 0)).toThrow(RangeError);
  });
});
