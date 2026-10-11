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

  it("numbers the chats that share a title, so each control names its own", () => {
    const onDelete = vi.fn();
    const rows = [
      chatRow("s-1", "Новый чат"),
      chatRow("s-2", "Где настройки модели"),
      chatRow("s-3", "Новый чат"),
    ];
    const { rerender } = render(tree(rows, onDelete));

    // «Новый чат» is what an unnamed chat reads until its first answer lands,
    // so two of them standing in the list is the normal case, not a corner.
    const secondOfTwo = screen.getByRole("button", {
      name: "Удалить чат «Новый чат» (2 из 2)",
    });
    expect(
      screen.getByRole("button", { name: "Удалить чат «Новый чат» (1 из 2)" }),
    ).toBeTruthy();
    // A title nothing else carries keeps the plain name.
    expect(
      screen.getByRole("button", {
        name: "Удалить чат «Где настройки модели»",
      }),
    ).toBeTruthy();

    fireEvent.click(secondOfTwo);
    const dialog = screen.getByRole("dialog", {
      name: "Подтвердите удаление чата",
    });
    expect(dialog.textContent).toContain("«Новый чат» (2 из 2)");
    fireEvent.click(screen.getByRole("button", { name: "Удалить из истории" }));
    expect(onDelete).toHaveBeenCalledWith("s-3");

    // One of them gone, the survivor stops being a duplicate: the control
    // drops the number instead of keeping a count that no longer holds.
    rerender(
      tree(
        [chatRow("s-1", "Новый чат"), chatRow("s-2", "Где настройки модели")],
        onDelete,
      ),
    );
    expect(
      screen.getByRole("button", { name: "Удалить чат «Новый чат»" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /из \d/u })).toBeNull();
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

  it("returns the keyboard to the row when Escape closes the dialog", () => {
    render(tree([chatRow("s-1", "Демо-чат")], vi.fn()));
    const trigger = deleteControl("Демо-чат");

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
  });

  it("returns the keyboard to the row from the dialog's own close control", () => {
    render(tree([chatRow("s-1", "Демо-чат")], vi.fn()));
    const trigger = deleteControl("Демо-чат");

    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Закрыть подтверждение удаления чата",
      }),
    );

    expect(document.activeElement).toBe(trigger);
  });

  it("returns the keyboard to the row when the backdrop closes the dialog", () => {
    render(tree([chatRow("s-1", "Демо-чат")], vi.fn()));
    const trigger = deleteControl("Демо-чат");

    fireEvent.click(trigger);
    // The backdrop, not the panel standing inside it.
    fireEvent.click(screen.getByTestId("qa-surface-modal"));

    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the keyboard inside the list after a confirmed deletion", () => {
    render(tree([chatRow("s-1", "Демо-чат")], vi.fn()));
    const list = screen.getByTestId("qa-surface-sidebar-list");

    fireEvent.click(deleteControl("Демо-чат"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить из истории" }));

    // The row is gone with its control; focus has to stay in the sidebar, or
    // the next Tab would restart from the top of the document.
    expect(document.activeElement).toBe(list);
  });

  it("hides the delete control when the deployment omits it", () => {
    render(tree([chatRow("s-1", "Демо-чат")]));
    expect(screen.queryByTestId("qa-surface-sidebar-item-delete")).toBeNull();
  });
});
