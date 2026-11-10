// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QaSidebar,
  type QaSidebarProps,
} from "../../../src/client/components/QaSidebar.js";
import {
  EMPTY_HISTORY,
  historyFolderOf,
  moveHistoryChat,
  parseHistoryOrganization,
  removeHistoryFolder,
} from "../../../src/client/history-organization.js";

const storageKey = "demo:history:account-one";
const folder = { id: "folder-a", name: "Документы", collapsed: false };
const secondFolder = { id: "folder-b", name: "Исследования", collapsed: false };
const props: QaSidebarProps = {
  stateKey: "demo",
  organizationKey: storageKey,
  title: "Demo QA",
  logoUrl: null,
  showNewChat: true,
  busy: false,
  onNewChat: vi.fn(),
  onSwitch: vi.fn(),
  rows: ["one", "two", "three"].map((id, index) => ({
    id,
    title: `Чат ${id}`,
    active: index === 0,
    running: index === 1,
    updatedAt: 10 - index,
    meta: "сейчас",
  })),
};
function state() {
  return parseHistoryOrganization(localStorage.getItem(storageKey));
}
function section(name: string) {
  return screen.getByRole("region", { name });
}
function chats(name: string) {
  return within(section(name))
    .queryAllByTestId("qa-history-draggable-chat")
    .map((row) => row.getAttribute("data-chat-id"));
}
function menu(id: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `Действия чата «Чат ${id}»` }),
  );
}
function transfer() {
  return { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
}
function dragChat(id: string, target: HTMLElement) {
  const source = screen
    .getAllByTestId("qa-history-draggable-chat")
    .find((row) => row.getAttribute("data-chat-id") === id)!;
  const dataTransfer = transfer();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("virtual session organization", () => {
  it("imports API routing once, preserves manual moves, and does not resurrect a deleted folder", () => {
    const integrationFolders = { one: { id: folder.id, name: folder.name } };
    const view = render(
      <QaSidebar {...props} integrationFolders={integrationFolders} />,
    );
    expect(chats(folder.name)).toEqual(["one"]);
    dragChat("one", section("Без каталога"));
    view.rerender(
      <QaSidebar {...props} integrationFolders={{ ...integrationFolders }} />,
    );
    expect(chats(folder.name)).toEqual([]);
    expect(chats("Без каталога")).toContain("one");
    fireEvent.click(
      screen.getByRole("button", { name: "Настроить каталог «Документы»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить каталог" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить каталог" }));
    view.rerender(
      <QaSidebar {...props} integrationFolders={{ ...integrationFolders }} />,
    );
    expect(screen.queryByRole("region", { name: folder.name })).toBeNull();
    view.unmount();
    render(<QaSidebar {...props} integrationFolders={integrationFolders} />);
    expect(screen.queryByRole("region", { name: folder.name })).toBeNull();
  });
  it("orders chats and folders through keyboard actions and restores chat focus", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...EMPTY_HISTORY,
        folders: [folder, secondFolder],
        pinned: ["one", "two"],
      }),
    );
    render(<QaSidebar {...props} />);
    menu("one");
    expect((document.activeElement as HTMLElement).textContent).toBe(
      "Открепить чат",
    );
    fireEvent.click(screen.getByRole("button", { name: "Ниже в списке" }));
    expect(chats("Закреплённые")).toEqual(["two", "one"]);
    expect(
      document.activeElement
        ?.closest("[data-chat-id]")
        ?.getAttribute("data-chat-id"),
    ).toBe("one");
    menu("one");
    fireEvent.click(screen.getByRole("button", { name: "Выше в списке" }));
    expect(chats("Закреплённые")).toEqual(["one", "two"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Настроить каталог «Документы»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Каталог ниже" }));
    expect(state().folders.map((entry) => entry.id)).toEqual([
      secondFolder.id,
      folder.id,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Каталог выше" }));
    expect(state().folders.map((entry) => entry.id)).toEqual([
      folder.id,
      secondFolder.id,
    ]);
  });

  it("uses the lower half of a row as an after insertion target", () => {
    render(<QaSidebar {...props} />);
    const row = screen.getAllByTestId("qa-history-draggable-chat")[2]!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 40,
    } as DOMRect);
    const source = screen.getAllByTestId("qa-history-draggable-chat")[0]!;
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { dataTransfer });
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      clientY: { value: 135 },
      dataTransfer: { value: dataTransfer },
    });
    fireEvent(row, event);
    expect(row.getAttribute("data-drop")).toBe("after");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      clientY: { value: 135 },
      dataTransfer: { value: dataTransfer },
    });
    fireEvent(row, drop);
    expect(chats("Без каталога")).toEqual(["two", "three", "one"]);
  });

  it("creates, renames and removes a folder while retaining its chats and pins", () => {
    render(<QaSidebar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Новый каталог" }));
    fireEvent.change(screen.getByLabelText("Название каталога"), {
      target: { value: "Документы" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(state().folders[0]?.name).toBe("Документы");
    menu("one");
    fireEvent.click(
      screen.getByRole("button", { name: "Переместить в каталог" }),
    );
    fireEvent.change(screen.getByLabelText("Каталог"), {
      target: { value: state().folders[0]!.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Переместить" }));
    expect(chats("Документы")).toEqual(["one"]);
    menu("one");
    fireEvent.click(screen.getByRole("button", { name: "Закрепить чат" }));
    expect(chats("Закреплённые")).toEqual(["one"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Настроить каталог «Документы»" }),
    );
    fireEvent.change(screen.getByLabelText("Название каталога"), {
      target: { value: "Заметки" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(section("Заметки")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Настроить каталог «Заметки»" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить каталог" }));
    expect(screen.getByRole("dialog").textContent).toContain("Чаты останутся");
    fireEvent.click(screen.getByRole("button", { name: "Удалить каталог" }));
    expect(state().folders).toEqual([]);
    expect(chats("Закреплённые")).toEqual(["one"]);
    menu("one");
    fireEvent.click(screen.getByRole("button", { name: "Открепить чат" }));
    expect(chats("Без каталога")).toContain("one");
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("moves by drag and drop into empty/collapsed folders, root and the pinned block", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...EMPTY_HISTORY,
        folders: [{ ...folder, collapsed: true }],
      }),
    );
    render(<QaSidebar {...props} />);
    dragChat("two", section("Документы"));
    expect(historyFolderOf(state(), "two")).toBe(folder.id);
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть каталог «Документы»" }),
    );
    expect(chats("Документы")).toEqual(["two"]);
    dragChat("two", section("Закреплённые"));
    expect(chats("Закреплённые")).toEqual(["two"]);
    expect(historyFolderOf(state(), "two")).toBe(folder.id);
    dragChat("two", section("Без каталога"));
    expect(chats("Закреплённые")).toEqual([]);
    expect(historyFolderOf(state(), "two")).toBeNull();
    expect(chats("Без каталога")).toEqual(["one", "three", "two"]);
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("reorders pinned rows and folders, and keeps recency updates from undoing manual order", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...EMPTY_HISTORY,
        folders: [folder, secondFolder],
        pinned: ["one", "two"],
      }),
    );
    const view = render(<QaSidebar {...props} />);
    dragChat(
      "two",
      within(section("Закреплённые")).getAllByTestId(
        "qa-history-draggable-chat",
      )[0]!,
    );
    expect(chats("Закреплённые")).toEqual(["two", "one"]);
    const dataTransfer = transfer();
    fireEvent.dragStart(
      screen.getByRole("button", { name: "Свернуть каталог «Исследования»" })
        .parentElement!,
      { dataTransfer },
    );
    fireEvent.dragOver(section("Документы"), { dataTransfer });
    fireEvent.drop(section("Документы"), { dataTransfer });
    expect(state().folders.map((entry) => entry.id)).toEqual([
      secondFolder.id,
      folder.id,
    ]);
    view.rerender(
      <QaSidebar
        {...props}
        rows={[...props.rows]
          .reverse()
          .map((row) => ({ ...row, updatedAt: 100 }))}
      />,
    );
    expect(chats("Закреплённые")).toEqual(["two", "one"]);
  });

  it("searches full titles and folder names without modifying saved collapse state", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...EMPTY_HISTORY,
        folders: [{ ...folder, collapsed: true }],
        assignments: { one: folder.id },
      }),
    );
    render(<QaSidebar {...props} />);
    expect(chats("Документы")).toEqual([]);
    const search = screen.getByLabelText("Поиск по чатам");
    fireEvent.change(search, { target: { value: "one" } });
    expect(chats("Документы")).toEqual(["one"]);
    fireEvent.change(search, { target: { value: "документы" } });
    expect(chats("Документы")).toEqual(["one"]);
    fireEvent.change(search, { target: { value: "" } });
    expect(chats("Документы")).toEqual([]);
    expect(state().folders[0]?.collapsed).toBe(true);
  });

  it("rejects empty/duplicate folder names and leaves state unchanged on cancellation", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...EMPTY_HISTORY, folders: [folder] }),
    );
    render(<QaSidebar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Новый каталог" }));
    expect(
      (screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Название каталога"), {
      target: { value: " документы " },
    });
    expect(screen.getByRole("alert").textContent).toContain("уже существует");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(state().folders).toHaveLength(1);
  });

  it("restores on reload and switches metadata immediately on account changes", () => {
    const view = render(<QaSidebar {...props} />);
    menu("one");
    fireEvent.click(screen.getByRole("button", { name: "Закрепить чат" }));
    view.unmount();
    const next = render(<QaSidebar {...props} />);
    expect(chats("Закреплённые")).toEqual(["one"]);
    next.rerender(
      <QaSidebar {...props} organizationKey="demo:history:account-two" />,
    );
    expect(chats("Закреплённые")).toEqual([]);
    menu("two");
    fireEvent.click(screen.getByRole("button", { name: "Закрепить чат" }));
    next.rerender(<QaSidebar {...props} />);
    expect(chats("Закреплённые")).toEqual(["one"]);
    expect(state().pinned).toEqual(["one"]);
  });

  it("accepts storage events and reports failed persistence without blocking organization", () => {
    render(<QaSidebar {...props} />);
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...EMPTY_HISTORY, pinned: ["two"] }),
    );
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: storageKey,
        storageArea: localStorage,
      }),
    );
    expect(chats("Закреплённые")).toEqual(["two"]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    menu("one");
    fireEvent.click(screen.getByRole("button", { name: "Закрепить чат" }));
    expect(chats("Закреплённые")).toEqual(["two", "one"]);
    expect(screen.getByRole("alert").textContent).toContain("не сохранил");
  });

  it("ignores external drops and a canceled drag", () => {
    render(<QaSidebar {...props} />);
    fireEvent.drop(section("Закреплённые"), { dataTransfer: transfer() });
    expect(chats("Закреплённые")).toEqual([]);
    const source = screen.getAllByTestId("qa-history-draggable-chat")[0]!;
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(section("Закреплённые"), { dataTransfer });
    fireEvent.dragEnd(source, { dataTransfer });
    expect(chats("Закреплённые")).toEqual([]);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("finds a pinned chat through the name of its retained folder", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...EMPTY_HISTORY,
        folders: [folder],
        assignments: { one: folder.id },
        pinned: ["one"],
      }),
    );
    render(<QaSidebar {...props} />);
    fireEvent.change(screen.getByLabelText("Поиск по чатам"), {
      target: { value: "документы" },
    });
    expect(chats("Закреплённые")).toEqual(["one"]);
  });
});

describe("history metadata validation", () => {
  it("recovers from invalid JSON and removes invalid and repeated entries", () => {
    expect(parseHistoryOrganization("oops")).toEqual(EMPTY_HISTORY);
    expect(
      parseHistoryOrganization(
        JSON.stringify({
          folders: [null, folder, folder],
          assignments: { one: folder.id, two: "missing" },
          pinned: ["one", "one", 2],
          order: null,
        }),
      ),
    ).toEqual({
      folders: [folder],
      assignments: { one: folder.id },
      pinned: ["one"],
      order: [],
    });
  });
  it("keeps unavailable chats and their order through folder deletion and filtered moves", () => {
    const original = {
      folders: [folder],
      assignments: { one: folder.id, unavailable: folder.id },
      pinned: ["unavailable"],
      order: ["unavailable", "one", "two"],
    };
    const moved = moveHistoryChat(
      original,
      "two",
      { kind: "folder", id: folder.id },
      ["two", "one"],
      "one",
    );
    expect(moved.order).toEqual(["unavailable", "two", "one"]);
    expect(moved.assignments.unavailable).toBe(folder.id);
    expect(removeHistoryFolder(moved, folder.id)).toEqual({
      ...moved,
      folderHandled: ["two", "one", "unavailable"],
      folders: [],
      assignments: {},
    });
    expect(
      moveHistoryChat(original, "one", { kind: "folder", id: "missing" }, []),
    ).toBe(original);
  });
});
