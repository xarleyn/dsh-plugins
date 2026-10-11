// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QaAdminPreviewBanner,
  QaRoleSelector,
} from "../../../src/client/role/RoleSelector.js";

const roles = [
  {
    id: "analyst",
    name: "Analyst",
    enabled: true,
    capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
  },
  {
    id: "developer",
    name: "Developer",
    enabled: true,
    capabilities: { tools: { always: [], skillGrantable: [] }, skills: [] },
  },
] as const;

describe("QA role selector", () => {
  it("is absent when the account has only one role", () => {
    render(
      <QaRoleSelector
        roles={[roles[0]]}
        selected="analyst"
        conversationStarted={false}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByLabelText("Роль ассистента")).toBeNull();
  });

  it("requires confirmation after a conversation has started", () => {
    const onSelect = vi.fn();
    render(
      <QaRoleSelector
        roles={roles}
        selected="analyst"
        conversationStarted
        onSelect={onSelect}
      />,
    );
    fireEvent.change(screen.getByLabelText("Роль ассистента"), {
      target: { value: "developer" },
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("qa-role-change-notice").textContent).toContain(
      "Смена роли начинает новый разговор",
    );
    expect(screen.getByRole("dialog").className).toBe("dsh-qa-modal");
    const confirm = screen.getByTestId("qa-role-change-confirm");
    expect(
      screen.getByRole("button", { name: "Начать новый чат как Developer" }),
    ).toBe(confirm);
    expect(confirm.className).toContain("dsh-qa-modal__primary");
    fireEvent.click(confirm);
    expect(onSelect).toHaveBeenCalledWith("developer");
  });
});

describe("administrator preview banner", () => {
  it("names the previewed profile without an exit while only reporting", () => {
    render(<QaAdminPreviewBanner role="Аналитик" />);
    expect(screen.getByRole("status").textContent).toContain("Аналитик");
    expect(
      screen.queryByRole("button", { name: "Выйти из просмотра" }),
    ).toBeNull();
  });

  it("offers the way out of the preview", () => {
    const onExit = vi.fn();
    render(<QaAdminPreviewBanner role="Аналитик" onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Выйти из просмотра" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("holds the way out while a chat is still being created", () => {
    // Leaving the preview starts a chat, so clicking it mid-creation would take
    // the screen from the question on its way in — the one departure between
    // chats that the surface cannot undo once it has happened.
    const onExit = vi.fn();
    render(<QaAdminPreviewBanner role="Аналитик" onExit={onExit} disabled />);
    const exit = screen.getByRole("button", { name: "Выйти из просмотра" });
    expect((exit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(exit);
    expect(onExit).not.toHaveBeenCalled();
  });
});
