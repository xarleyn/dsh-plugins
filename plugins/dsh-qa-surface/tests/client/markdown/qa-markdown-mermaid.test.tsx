// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mocks }));

import { Markdown } from "../../../src/client/components/Markdown.js";

describe("Mermaid markdown preview", () => {
  beforeEach(() => {
    mocks.render.mockReset();
  });

  it("renders sanitized SVG with fit, source and expanded controls", async () => {
    mocks.render.mockResolvedValue({
      svg: '<svg onload="alert(1)"><script>alert(1)</script><a href="https://evil.example"><text>Flow</text></a></svg>',
    });
    const { container } = render(
      <Markdown text={"```mermaid\ngraph TD\n A --> B\n```"} />,
    );

    const canvas = await waitFor(() =>
      screen.getByTestId("qa-md-mermaid-canvas"),
    );
    expect(canvas.querySelector("svg")).not.toBeNull();
    expect(container.innerHTML).not.toContain("script");
    expect(container.innerHTML).not.toContain("onload");
    expect(container.innerHTML).not.toContain("https://evil.example");
    expect(screen.getByTestId("qa-md-mermaid-fit")).toBeTruthy();
    fireEvent.click(screen.getByTestId("qa-md-mermaid-code-toggle"));
    expect(screen.getByTestId("qa-md-code-content").textContent).toContain(
      "graph TD",
    );
    const expand = screen.getByTestId("qa-md-mermaid-expand-toggle");
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to the raw code when syntax is invalid", async () => {
    mocks.render.mockRejectedValue(new Error("syntax error"));
    render(<Markdown text={"```mermaid\nnot a diagram\n```"} />);

    const warning = await screen.findByTestId("qa-md-mermaid-warning");
    expect(warning.textContent).toMatch(
      /Не удалось отобразить Mermaid-диаграмму/u,
    );
    expect(screen.getByTestId("qa-md-mermaid-error")).toBeTruthy();
    expect(screen.getByTestId("qa-md-code-content").textContent).toContain(
      "not a diagram",
    );
  });
});
