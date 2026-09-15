// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaRoleSelector } from "../src/client/role/RoleSelector.js";

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
    expect(
      screen.getByText(/Смена роли начинает новый разговор/u),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Начать новый чат как Developer"));
    expect(onSelect).toHaveBeenCalledWith("developer");
  });
});
