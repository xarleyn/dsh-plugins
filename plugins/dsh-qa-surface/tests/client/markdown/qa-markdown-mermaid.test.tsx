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

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.innerHTML).not.toContain("script");
    expect(container.innerHTML).not.toContain("onload");
    expect(container.innerHTML).not.toContain("https://evil.example");
    expect(screen.getByText("По размеру")).toBeTruthy();
    fireEvent.click(screen.getByText("Код"));
    expect(container.querySelector("code")?.textContent).toContain("graph TD");
    fireEvent.click(screen.getByText("Во весь экран"));
    expect(container.querySelector(".dsh-qa-mermaid--expanded")).not.toBeNull();
  });

  it("falls back to the raw code when syntax is invalid", async () => {
    mocks.render.mockRejectedValue(new Error("syntax error"));
    render(<Markdown text={"```mermaid\nnot a diagram\n```"} />);

    expect(
      await screen.findByText(/Не удалось отобразить Mermaid-диаграмму/u),
    ).toBeTruthy();
    expect(screen.getByText("not a diagram")).toBeTruthy();
  });
});
