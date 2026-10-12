// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaChatActions } from "../../../src/client/components/QaChatActions.js";

afterEach(cleanup);
describe("chat actions in history", () => {
  it("opens sharing from its quiet row action and restores focus on Escape", () => {
    const share = vi.fn();
    render(<QaChatActions name="Demo chat" onShare={share} />);
    const trigger = screen.getByRole("button", {
      name: "Действия чата Demo chat",
    });
    expect(
      screen.queryByRole("button", { name: "Поделиться чатом" }),
    ).toBeNull();
    fireEvent.click(trigger);
    const action = screen.getByRole("button", { name: "Поделиться чатом" });
    action.focus();
    fireEvent.keyDown(action, { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Поделиться чатом" }));
    expect(share).toHaveBeenCalledOnce();
    expect(screen.queryByRole("group")).toBeNull();
  });
  it("closes on outside clicks and gives deletion the persistent trigger", () => {
    const remove = vi.fn();
    render(
      <QaChatActions name="Demo chat" onShare={vi.fn()} onDelete={remove} />,
    );
    const trigger = screen.getByRole("button", {
      name: "Действия чата Demo chat",
    });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Удалить чат" }));
    expect(remove).toHaveBeenCalledWith(trigger);
  });
});
