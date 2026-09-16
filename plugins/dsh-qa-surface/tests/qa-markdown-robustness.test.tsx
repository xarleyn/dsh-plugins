// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/client/components/Markdown.js";

/** Render and hand back the container's text, failing on an exception. */
function text(markdown: string): string {
  const { container } = render(<Markdown text={markdown} />);
  return container.textContent ?? "";
}

describe("Markdown robustness", () => {
  it("keeps an unclosed fence, an unclosed quote, and a lone table row inert", () => {
    expect(text("```csharp\nvar x = 1;")).toContain("var x = 1;");
    expect(text("> цитата без конца\nи хвост")).toContain("хвост");
    expect(text("| один | два |")).toContain("| один | два |");
  });

  it("handles CRLF input, deep nesting, and a large document", () => {
    expect(text("# Заголовок\r\n\r\nтекст")).toContain("Заголовок");
    const deep = Array.from(
      { length: 20 },
      (_, index) => `${"  ".repeat(index)}- уровень ${index}`,
    ).join("\n");
    expect(text(deep)).toContain("уровень 19");
    const big = Array.from(
      { length: 400 },
      (_, index) => `абзац ${index} с \`кодом\` и **акцентом**`,
    ).join("\n\n");
    expect(text(big)).toContain("абзац 399");
  });

  it("renders a container mix the way GFM nests it", () => {
    const { container } = render(
      <Markdown
        text={"> ## Цитата\n>\n> - пункт\n>\n> ```sh\n> echo hi\n> ```"}
      />,
    );
    const quote = container.querySelector("blockquote");
    expect(quote?.querySelector("h2")?.textContent).toBe("Цитата");
    expect(quote?.querySelector("li")?.textContent).toBe("пункт");
    expect(quote?.querySelector(".dsh-qa-md-code code")?.textContent).toBe(
      "echo hi",
    );
  });

  it("keeps a table listed inside a list item inside that item", () => {
    const { container } = render(
      <Markdown
        text={"- строка\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |"}
      />,
    );
    const item = container.querySelector("li");
    expect(item?.querySelector(".dsh-qa-md-table")).toBeTruthy();
    expect(item?.querySelectorAll("td").length).toBe(2);
  });

  // A closer search that rescans from every opener is quadratic per streaming
  // frame: one delimiter-heavy line must parse fast and stay literal.
  it("keeps a flood of delimiters linear and literal", () => {
    // A bare asterisk line renders as a thematic break, so the runs sit
    // inside a paragraph; a rescan-based search re-counts the tail of the
    // 40k run at every position inside it.
    const solid = render(<Markdown text={`x${"*".repeat(40_000)}`} />);
    expect(solid.container.querySelector("em,strong,del")).toBeNull();
    expect(solid.container.textContent).toBe(`x${"*".repeat(40_000)}`);

    // Would-be openers that never close, one after another: each used to
    // rescan the whole remaining line before degrading to literal text.
    const flood = "*a ".repeat(13_334).trimEnd();
    const openers = render(<Markdown text={flood} />);
    expect(openers.container.querySelector("em,strong,del")).toBeNull();
    expect(openers.container.textContent).toBe(flood);

    // The audited size: a ~5000-asterisk run stays literal text.
    const line = render(<Markdown text={`x${"*".repeat(5_000)}`} />);
    expect(line.container.querySelector("em,strong,del")).toBeNull();
    expect(line.container.textContent).toBe(`x${"*".repeat(5_000)}`);
  });
});
