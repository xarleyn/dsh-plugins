import { describe, expect, it } from "vitest";
import { parseBlocks } from "../src/markdown/blocks.js";
import { parseInline } from "../src/markdown/inline.js";

describe("literal Markdown boundaries", () => {
  it.each(["synthetic-path\\", "\\", "two\\\\"])(
    "preserves a trailing escape in %j",
    (source) => {
      const expected = source === "two\\\\" ? "two\\" : source;
      expect(parseInline(source)).toEqual([{ kind: "text", text: expected }]);
    },
  );

  it.each(["```", "````suffix", "~~~", "    ````"])(
    "does not close a four-backtick fence on %j",
    (interior) => {
      expect(
        parseBlocks(
          ["````text", "before", interior, "after", "````"].join("\n"),
        ),
      ).toEqual([
        { kind: "code", lang: "text", text: `before\n${interior}\nafter` },
      ]);
    },
  );

  it.each(["````", "`````", "   ````  "])(
    "accepts a matching closing fence %j",
    (closing) => {
      expect(
        parseBlocks(["````", "body", closing, "after"].join("\n")),
      ).toEqual([
        { kind: "code", lang: "", text: "body" },
        { kind: "paragraph", text: "after" },
      ]);
    },
  );

  it("preserves shorter tilde fences in a tilde block", () => {
    expect(parseBlocks("~~~~\nbefore\n~~~\nafter\n~~~~")).toEqual([
      { kind: "code", lang: "", text: "before\n~~~\nafter" },
    ]);
  });
});
