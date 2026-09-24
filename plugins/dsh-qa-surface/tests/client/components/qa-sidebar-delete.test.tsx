// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSidebar } from "../../../src/client/components/QaSidebar.js";

function sidebar(onDelete?: (sessionId: string) => void) {
  return render(
    <QaSidebar
      rows={[
        {
          id: "s-1",
          title: "Демо-чат",
          running: false,
          active: false,
          meta: "1m",
          updatedAt: 1,
        },
      ]}
      title="DeepSeek QA"
      logoUrl={null}
      stateKey="dsh-qa-surface.session:v1:/qa"
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
      {...(onDelete === undefined ? {} : { onDelete })}
    />,
  );
}

describe("sidebar chat deletion", () => {
  it("opens an accessible confirmation and deletes only after confirmation", () => {
    const onDelete = vi.fn();
    sidebar(onDelete);

    fireEvent.click(screen.getByRole("button", { name: "Удалить чат" }));

    const dialog = screen.getByRole("dialog", { name: "Удалить чат" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Демо-чат");
    expect(dialog.textContent).toContain("Сам разговор останется на стенде");
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить из истории" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("s-1");
    expect(screen.queryByRole("dialog", { name: "Удалить чат" })).toBeNull();
  });

  it("keeps the chat when confirmation is cancelled", () => {
    const onDelete = vi.fn();
    sidebar(onDelete);

    fireEvent.click(screen.getByRole("button", { name: "Удалить чат" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Удалить чат" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Удалить чат" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Удалить чат" })).toBeNull();
  });

  it("hides the delete control when the deployment omits it", () => {
    const { container } = sidebar();
    expect(container.querySelector(".dsh-qa-sidebar__item-delete")).toBeNull();
  });
});
