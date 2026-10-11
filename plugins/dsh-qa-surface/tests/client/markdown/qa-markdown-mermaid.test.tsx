// @vitest-environment jsdom

import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "../../../src/client/components/Markdown.js";

/**
 * A `mermaid` fence is source text here: the client bundle carries no diagram
 * engine, because the one file DSH loads is the file the page downloads before
 * it paints. These cases hold the fallback shape, so a renderer that returns
 * has to be added on purpose and with its payload measured.
 */
describe("Mermaid fence rendering", () => {
  it("shows the diagram source as a code block", () => {
    const { container } = render(
      <Markdown text={"```mermaid\ngraph TD\n  A --> B\n```"} />,
    );

    expect(
      within(container).getByTestId("qa-md-code-content").textContent,
    ).toContain("graph TD");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the fence language on the code block", () => {
    const { container } = render(
      <Markdown text={"```mermaid\nsequenceDiagram\n  A->>B: ok\n```"} />,
    );

    expect(within(container).getByTestId("qa-md-code-lang").textContent).toBe(
      "mermaid",
    );
    expect(
      within(container).getByTestId("qa-md-code-content").textContent,
    ).toContain("sequenceDiagram");
  });
});
