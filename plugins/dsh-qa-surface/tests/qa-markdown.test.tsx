// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/client/components/Markdown.js";

describe("safe Markdown", () => {
  it("renders formatting without interpreting HTML or unsafe links", () => {
    const { container } = render(
      <Markdown
        text={"**bold** <script>alert(1)</script> [bad](javascript:alert(1))"}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders GFM tables with alignment and inline formatting", () => {
    const { container } = render(
      <Markdown
        text={
          "before\n\n| Name | Uses |\n| :--- | ---: |\n| **glob** | find `*.ts` |\n| grep | regex |\n\nafter"
        }
      />,
    );
    const table = container.querySelector(".dsh-qa-md-table table");
    expect(table).toBeTruthy();
    expect(container.querySelectorAll("thead th").length).toBe(2);
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    expect(container.querySelector("thead th")?.getAttribute("style")).toBe(
      "text-align: left;",
    );
    expect(
      container.querySelectorAll("thead th")[1]?.getAttribute("style"),
    ).toBe("text-align: right;");
    expect(container.querySelector("tbody strong")?.textContent).toBe("glob");
    expect(container.querySelector("tbody code")?.textContent).toBe("*.ts");
    const before = container.textContent ?? "";
    expect(before.indexOf("before")).toBeLessThan(before.indexOf("Name"));
    expect(before.indexOf("regex")).toBeLessThan(before.indexOf("after"));
  });

  it("renders ordered lists and horizontal rules", () => {
    const { container } = render(
      <Markdown text={"1. first step\n2. second step\n\n---\n\ndone"} />,
    );
    expect(container.querySelectorAll("ol li").length).toBe(2);
    expect(container.querySelector("ol li")?.textContent).toBe("first step");
    expect(container.querySelector("hr")).toBeTruthy();
    expect(container.textContent).toContain("done");
  });

  it("does not turn a single pipe sentence into a table", () => {
    const { container } = render(<Markdown text={"a | b sentence"} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("a | b sentence");
  });
});
