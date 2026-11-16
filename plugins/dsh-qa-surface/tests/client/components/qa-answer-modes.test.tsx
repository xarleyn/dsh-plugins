// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QaAnswerModes } from "../../../src/client/components/QaAnswerModes.js";
import type { QaAnswerMode } from "../../../src/shared/answer-modes.js";

function Controlled() {
  const [modes, setModes] = useState<readonly QaAnswerMode[]>(["deep"]);
  return <QaAnswerModes modes={modes} disabled={false} onChange={setModes} />;
}

describe("answer mode dropdown", () => {
  it("keeps Tab and Shift+Tab inside the open portal and restores focus on Escape", () => {
    render(<Controlled />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    const fast = screen.getByRole("checkbox", { name: "Fast" });
    const rag = screen.getByRole("checkbox", { name: "RAG Priority" });
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(document.activeElement).toBe(fast);
    fireEvent.keyDown(fast, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(rag);
    fireEvent.keyDown(rag, { key: "Tab" });
    expect(document.activeElement).toBe(fast);
    fireEvent.keyDown(fast, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
  it("keeps the dropdown open for multiple choices and names every selected mode", () => {
    render(<Controlled />);
    const trigger = screen.getByRole("button", {
      name: "Режимы ответа: Deep Thinking",
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("checkbox", { name: "Fast" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "RAG Priority" }));
    expect(trigger.textContent).toBe("Fast + Deep Thinking + RAG Priority");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const rag = screen.getByRole("checkbox", { name: "RAG Priority" });
    expect(
      document.getElementById(rag.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("спросить согласие");
    expect(
      screen.queryByText(
        "Если RAG не даст ответа, спросим, нужен ли глубокий поиск.",
      ),
    ).toBeNull();
    fireEvent.keyDown(rag, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("retains at least one mode and closes on an outside pointer", () => {
    render(<Controlled />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("checkbox", { name: "Deep Thinking" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Выберите хотя бы один режим.",
    );
    expect(trigger.textContent).toBe("Deep Thinking");
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
