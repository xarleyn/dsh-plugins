// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../../src/client/components/Markdown.js";

describe("assistant math", () => {
  it("renders a fenced $$ block as display math", () => {
    const { container } = render(
      <Markdown text={"before\n\n$$\nE = mc^2\n$$\n\nafter"} />,
    );
    expect(
      container.querySelector(".dsh-qa-md-math .katex-display"),
    ).toBeTruthy();
    expect(container.querySelector(".katex")?.textContent).toContain("=");
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("renders a one-line $$…$$ block as display math", () => {
    const { container } = render(<Markdown text={"$$a^2 + b^2 = c^2$$"} />);
    expect(
      container.querySelector(".dsh-qa-md-math .katex-display"),
    ).toBeTruthy();
  });

  it("keeps an unclosed $$ block a paragraph instead of swallowing text", () => {
    const { container } = render(<Markdown text={"$$\nE = mc^2\n"} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("E = mc^2");
  });

  it("renders a ```math fence as display math and other fences as code", () => {
    const { container } = render(
      <Markdown
        text={
          "```math\n\\frac{a}{b}\n```\n\n```math\n```\n\n```text\n\\frac{a}{b}\n```"
        }
      />,
    );
    expect(container.querySelector(".dsh-qa-md-math .katex")).toBeTruthy();
    // An empty math fence stays a code card, and other languages never render math.
    expect(container.querySelectorAll(".dsh-qa-md-code").length).toBe(2);
  });

  it("renders inline $…$ and $$…$$ math inside a paragraph", () => {
    const { container } = render(
      <Markdown text={"Формула $x^2$ и $$y^2$$ в строке."} />,
    );
    expect(container.querySelectorAll(".katex").length).toBe(2);
    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toContain("Формула");
    expect(paragraph?.textContent).toContain("в строке.");
  });

  it("keeps unpaired dollars literal, like prices", () => {
    const { container } = render(<Markdown text={"Цена $100 за штуку."} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe(
      "Цена $100 за штуку.",
    );
  });

  it("keeps a maximal dollar run from opening math", () => {
    const { container } = render(<Markdown text={"a $$$$ b"} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("a $$$$ b");
  });

  it("strips one padding character per side only when both ends carry it", () => {
    const { container } = render(
      <Markdown text={"a $ x $ b, потом $ y$ и $z $"} />,
    );
    expect(container.querySelectorAll(".katex").length).toBe(3);
  });

  it("keeps math out of escaped dollars", () => {
    const { container } = render(<Markdown text={"a \\$x$ b"} />);
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("leaves backslash TeX delimiters literal, as the Host transcript does", () => {
    const { container } = render(
      <Markdown text={"Формула \\(x^2\\) и \\[y^2\\] в строке."} />,
    );
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("(x^2)");
    expect(container.textContent).toContain("[y^2]");
  });

  it("keeps math spans whole while surrounding emphasis still pairs", () => {
    const { container } = render(<Markdown text={"*a $b*c$ d*"} />);
    const emphasis = container.querySelector("em");
    expect(emphasis).toBeTruthy();
    expect(emphasis?.querySelector(".katex")?.textContent).toContain("b*c");
  });

  it("renders an invalid TeX body as the KaTeX error span", () => {
    const { container } = render(<Markdown text={"$\\frac{$"} />);
    expect(container.querySelector(".katex-error")).toBeTruthy();
  });
});

describe("assistant footnotes", () => {
  it("renders a reference as a numbered sup and appends the section", () => {
    const { container } = render(
      <Markdown text={"Текст[^1] с сноской.\n\n[^1]: А это её определение."} />,
    );
    expect(container.querySelector(".dsh-qa-md-fn-ref")?.textContent).toBe("1");
    const section = container.querySelector(".dsh-qa-md-footnotes");
    expect(section).toBeTruthy();
    expect(section?.querySelector("li")?.textContent).toContain(
      "А это её определение.",
    );
    expect(section?.textContent).toContain("↩");
  });

  it("numbers footnotes in first-reference order and repeats the number", () => {
    const { container } = render(
      <Markdown
        text={
          "Второй[^b], потом первый[^a], снова второй[^b].\n\n[^a]: первая\n\n[^b]: вторая"
        }
      />,
    );
    const refs = [...container.querySelectorAll(".dsh-qa-md-fn-ref")];
    expect(refs.map((ref) => ref.textContent)).toEqual(["1", "2", "1"]);
    const items = container.querySelectorAll(".dsh-qa-md-footnotes li");
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toContain("вторая");
    expect(items[1]?.textContent).toContain("первая");
    // The repeated reference leaves two back-reference markers in its body.
    expect(items[0]?.textContent?.match(/↩/gu)?.length).toBe(2);
  });

  it("keeps an undefined label literal text", () => {
    const { container } = render(<Markdown text={"Текст[^foo] конец."} />);
    expect(container.querySelector(".dsh-qa-md-fn-ref")).toBeNull();
    expect(container.querySelector(".dsh-qa-md-footnotes")).toBeNull();
    expect(container.querySelector("p")?.textContent).toContain("[^foo]");
  });

  it("matches labels case-insensitively and skips labels with spaces", () => {
    const { container } = render(
      <Markdown text={"Один[^Abc], два[^foo bar].\n\n[^abc]: определение"} />,
    );
    expect(container.querySelectorAll(".dsh-qa-md-fn-ref").length).toBe(1);
    expect(container.textContent).toContain("[^foo bar]");
  });

  it("keeps lazy continuation lines in the definition body", () => {
    const { container } = render(
      <Markdown text={"a[^1]\n\n[^1]: первый\nпродолжение без отступа"} />,
    );
    const section = container.querySelector(".dsh-qa-md-footnotes");
    expect(section?.textContent).toContain("первый\nпродолжение без отступа");
  });

  it("renders indented multi-paragraph bodies with blocks", () => {
    const { container } = render(
      <Markdown
        text={"a[^1]\n\n[^1]: первый абзац\n\n    второй продолжает\n\nконец"}
      />,
    );
    const section = container.querySelector(".dsh-qa-md-footnotes");
    expect(section?.textContent).toContain("первый абзац");
    expect(section?.textContent).toContain("второй продолжает");
    // The definition ends before the non-indented line, which stays a top
    // level paragraph; the footnote section itself renders after all blocks.
    const text = container.textContent ?? "";
    expect(text).toContain("конец");
    expect(text.indexOf("второй продолжает")).toBeGreaterThan(
      text.indexOf("конец"),
    );
  });

  it("renders math inside a footnote body", () => {
    const { container } = render(
      <Markdown text={"a[^1]\n\n[^1]: формула $x^2$ тут"} />,
    );
    expect(container.querySelector(".dsh-qa-md-footnotes .katex")).toBeTruthy();
  });
});
