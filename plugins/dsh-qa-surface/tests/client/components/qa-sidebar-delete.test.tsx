// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QaSidebar,
  type QaChatRow,
  type QaSidebarProps,
} from "../../../src/client/components/QaSidebar.js";

function chatRow(id: string, title: string): QaChatRow {
  return {
    id,
    title,
    running: false,
    active: false,
    meta: "1 ч",
    updatedAt: 1,
  };
}

function tree(
  rows: readonly QaChatRow[],
  onDelete?: (sessionId: string) => void,
) {
  const props: QaSidebarProps = {
    rows,
    title: "DeepSeek QA",
    logoUrl: null,
    stateKey: "dsh-qa-surface.session:v1:/qa",
    showNewChat: false,
    busy: false,
    onSwitch: vi.fn(),
    onNewChat: vi.fn(),
    ...(onDelete === undefined ? {} : { onDelete }),
  };
  return <QaSidebar {...props} />;
}

/** The row control of one chat, addressed by the chat it names. */
function deleteControl(title: string): HTMLButtonElement {
  return screen.getByRole("button", { name: `Удалить чат «${title}»` });
}

describe("sidebar chat deletion", () => {
  it("opens an accessible confirmation and deletes only after confirmation", () => {
    const onDelete = vi.fn();
    render(tree([chatRow("s-1", "Демо-чат")], onDelete));

    fireEvent.click(deleteControl("Демо-чат"));

    const dialog = screen.getByRole("dialog", {
      name: "Подтвердите удаление чата",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Демо-чат");
    expect(dialog.textContent).toContain("Сам разговор останется на стенде");
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить из истории" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith("s-1");
    expect(
      screen.queryByRole("dialog", { name: "Подтвердите удаление чата" }),
    ).toBeNull();
  });

  it("asks before a chat with a history goes", () => {
    const onDelete = vi.fn();
    render(
      tree([chatRow("s-1", "Как перевыставить счёт за монтаж")], onDelete),
    );

    fireEvent.click(deleteControl("Как перевыставить счёт за монтаж"));

    expect(
      screen.getByRole("dialog", { name: "Подтвердите удаление чата" }),
    ).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("keeps the chat when confirmation is cancelled", () => {
    const onDelete = vi.fn();
    render(tree([chatRow("s-1", "Демо-чат")], onDelete));

    fireEvent.click(deleteControl("Демо-чат"));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Подтвердите удаление чата" }),
    ).toBeNull();

    fireEvent.click(deleteControl("Демо-чат"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Подтвердите удаление чата" }),
    ).toBeNull();
  });

  it("names the chat in its own control, so the rows stay tellable apart", () => {
    const onDelete = vi.fn();
    render(
      tree(
        [
          chatRow("s-1", "Как перевыставить счёт"),
          chatRow("s-2", "Где настройки модели"),
          chatRow("s-3", "Почему поиск молчит"),
        ],
        onDelete,
      ),
    );

    expect(
      screen.getAllByRole("button", { name: /^Удалить чат «.+»$/u }),
    ).toHaveLength(3);

    // The second row is the one that gets removed, and the dialog says so.
    fireEvent.click(deleteControl("Где настройки модели"));
    const dialog = screen.getByRole("dialog", {
      name: "Подтвердите удаление чата",
    });
    expect(dialog.textContent).toContain("Где настройки модели");
    expect(dialog.textContent).not.toContain("Как перевыставить счёт");
    fireEvent.click(screen.getByRole("button", { name: "Удалить из истории" }));
    expect(onDelete).toHaveBeenCalledWith("s-2");
  });

  it("carries a run of deletions through the rows that move up", () => {
    const rows = [
      chatRow("s-1", "Как перевыставить счёт"),
      chatRow("s-2", "Где настройки модели"),
      chatRow("s-3", "Почему поиск молчит"),
    ];
    const deleted: string[] = [];
    const { rerender } = render(
      tree(rows, (sessionId) => void deleted.push(sessionId)),
    );
    let visible = rows;
    for (const row of rows) {
      // Every remaining row keeps its own control, whichever position it holds
      // after the previous chats left the list.
      fireEvent.click(
        screen.getByRole("button", { name: `Удалить чат «${row.title}»` }),
      );
      expect(
        screen.getAllByRole("button", { name: /^Удалить чат «.+»$/u }),
      ).toHaveLength(visible.length);
      expect(
        screen.getByRole("dialog", { name: "Подтвердите удаление чата" })
          .textContent,
      ).toContain(row.title);
      fireEvent.click(
        screen.getByRole("button", { name: "Удалить из истории" }),
      );
      visible = visible.filter((item) => item.id !== row.id);
      rerender(tree(visible, (sessionId) => void deleted.push(sessionId)));
      expect(
        screen.queryByRole("dialog", { name: "Подтвердите удаление чата" }),
      ).toBeNull();
    }
    expect(deleted).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("returns the keyboard to the row after a cancelled deletion", () => {
    render(tree([chatRow("s-1", "Демо-чат")], vi.fn()));
    const trigger = deleteControl("Демо-чат");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the keyboard inside the list after a confirmed deletion", () => {
    const { container } = render(tree([chatRow("s-1", "Демо-чат")], vi.fn()));
    const list = container.querySelector(".dsh-qa-sidebar__list");

    fireEvent.click(deleteControl("Демо-чат"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить из истории" }));

    // The row is gone with its control; focus has to stay in the sidebar, or
    // the next Tab would restart from the top of the document.
    expect(document.activeElement).toBe(list);
  });

  it("hides the delete control when the deployment omits it", () => {
    const { container } = render(tree([chatRow("s-1", "Демо-чат")]));
    expect(container.querySelector(".dsh-qa-sidebar__item-delete")).toBeNull();
  });
});
