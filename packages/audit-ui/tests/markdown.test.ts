import { describe, expect, it } from "vitest";
import { parseBlocks } from "../src/markdown/blocks.js";
import { parseInline } from "../src/markdown/inline.js";
import {
  headingAnchor,
  parseReport,
  safeHref,
} from "../src/markdown/render.js";

describe("parseBlocks", () => {
  it("parses headings by depth", () => {
    const blocks = parseBlocks("# One\n\n### Three\n\n###### Six\n");

    expect(blocks).toEqual([
      { kind: "heading", depth: 1, text: "One" },
      { kind: "heading", depth: 3, text: "Three" },
      { kind: "heading", depth: 6, text: "Six" },
    ]);
  });

  it("parses a GFM table with alignments", () => {
    const blocks = parseBlocks(
      [
        "| Dimension | Score | Note |",
        "| :--- | ---: | :---: |",
        "| task_success | 3 | ok |",
        "| grounding | 1 | weak |",
      ].join("\n"),
    );

    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.align).toEqual(["left", "right", "center"]);
    expect(table.head).toEqual(["Dimension", "Score", "Note"]);
    expect(table.rows).toEqual([
      ["task_success", "3", "ok"],
      ["grounding", "1", "weak"],
    ]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    const blocks = parseBlocks("| a | b |\n| --- | --- |\n| x \\| y | z |");

    const table = blocks[0];
    if (table?.kind !== "table") throw new Error("expected a table");
    expect(table.rows[0]).toEqual(["x | y", "z"]);
  });

  it("does not turn a pipe row without a delimiter into a table", () => {
    const blocks = parseBlocks("| not | a table |");

    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("parses unordered, ordered and task lists", () => {
    const blocks = parseBlocks("- one\n- [x] two\n\n1. first\n2. second\n");

    expect(blocks.map((block) => block.kind)).toEqual(["list", "list"]);
    const [bullets, numbers] = blocks;
    if (bullets?.kind !== "list" || numbers?.kind !== "list") return;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items[1]?.task).toBe(true);
    expect(bullets.items[1]?.checked).toBe(true);
    expect(numbers.ordered).toBe(true);
    expect(numbers.start).toBe(1);
  });

  it("honours a non-1 ordered start", () => {
    const blocks = parseBlocks("3. third\n4. fourth\n");

    const list = blocks[0];
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.start).toBe(3);
  });

  it("parses fenced code with a language", () => {
    const blocks = parseBlocks('```json\n{"a": 1}\n```\n');

    expect(blocks).toEqual([{ kind: "code", text: '{"a": 1}', lang: "json" }]);
  });

  it("parses blockquotes and horizontal rules", () => {
    const blocks = parseBlocks("> quoted line\n> more\n\n---\n");

    expect(blocks[0]?.kind).toBe("quote");
    expect(blocks[1]?.kind).toBe("rule");
  });

  it("keeps an HTML block as literal paragraph text", () => {
    const blocks = parseBlocks('<script>alert("x")</script>\n');

    expect(blocks).toEqual([
      { kind: "paragraph", text: '<script>alert("x")</script>' },
    ]);
  });

  it("parses an unclosed fence to the end of the document", () => {
    const blocks = parseBlocks("```\nall of this\nis code\n");

    expect(blocks[0]).toEqual({
      kind: "code",
      text: "all of this\nis code",
      lang: "",
    });
  });
});

describe("parseInline", () => {
  it("parses emphasis, strong, strike and code spans", () => {
    expect(
      parseInline("**bold** and *italic* and ~~gone~~ and `code`"),
    ).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "bold" }] },
      { kind: "text", text: " and " },
      { kind: "em", children: [{ kind: "text", text: "italic" }] },
      { kind: "text", text: " and " },
      { kind: "strike", children: [{ kind: "text", text: "gone" }] },
      { kind: "text", text: " and " },
      { kind: "code", text: "code" },
    ]);
  });

  it("parses links, images and autolinks", () => {
    const nodes = parseInline(
      "[docs](https://example.com/a) ![alt](https://example.com/i.png) <https://example.com>",
    );

    expect(nodes[0]).toEqual({
      kind: "link",
      href: "https://example.com/a",
      children: [{ kind: "text", text: "docs" }],
    });
    expect(nodes[2]).toEqual({
      kind: "image",
      src: "https://example.com/i.png",
      alt: "alt",
    });
    expect(nodes[4]?.kind).toBe("link");
  });

  it("honours backslash escapes", () => {
    expect(parseInline("\\*not emphasis\\*")).toEqual([
      { kind: "text", text: "*not emphasis*" },
    ]);
  });

  it("leaves a bare HTML tag as text", () => {
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([
      { kind: "text", text: '<img src=x onerror="alert(1)">' },
    ]);
  });

  it("does not let a javascript: destination become a link", () => {
    // Parenthesis-free spelling: the URL grammar refuses parentheses outright,
    // so this shape reaches the allowlist check rather than the parser.
    const nodes = parseInline("[click](javascript:alert%281%29)");

    expect(nodes[0]?.kind).toBe("link");
    if (nodes[0]?.kind !== "link") return;
    expect(safeHref(nodes[0].href)).toBeUndefined();
  });

  it("leaves a destination containing parentheses as literal text", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[click](javascript:alert(1))" },
    ]);
  });

  it("terminates on deeply nested emphasis", () => {
    const deep = `${"*".repeat(40)}x${"*".repeat(40)}`;

    expect(() => parseInline(deep)).not.toThrow();
  });
});

describe("safeHref", () => {
  it("allows http, https and mailto", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("refuses script, data and relative destinations", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeUndefined();
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
    expect(safeHref("/relative/path")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

describe("parseReport", () => {
  it("collects the headings a table of contents needs, with matching anchors", () => {
    const parsed = parseReport(
      "# Trajectory Review\n\n## Verdict\n\nText.\n\n## Scorecard\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
    );

    expect(parsed.headings.map((heading) => heading.text)).toEqual([
      "Trajectory Review",
      "Verdict",
      "Scorecard",
    ]);
    // The same counter walks both passes, so ids line up with the body.
    expect(parsed.headings[1]?.id).toBe(headingAnchor("Verdict", 1));
  });

  it("skips heading levels beyond three in the table of contents", () => {
    const parsed = parseReport("# A\n\n#### Deep\n");

    expect(parsed.headings.map((heading) => heading.text)).toEqual(["A"]);
  });

  it("gives headings a deterministic anchor even for punctuation-only text", () => {
    const parsed = parseReport("# ***\n");

    expect(parsed.headings[0]?.id).toBe("audit-h-0");
  });
});
