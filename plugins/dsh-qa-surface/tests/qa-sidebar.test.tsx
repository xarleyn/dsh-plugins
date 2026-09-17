// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QA_CHANGELOG,
  QA_VERSION,
} from "../src/client/components/QaChangelog.js";
import {
  buildChatRows,
  buildOwnerSections,
  QaSidebar,
  type QaChatRow,
} from "../src/client/components/QaSidebar.js";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";

describe("QA sidebar", () => {
  const byId = {
    "s-1": {
      id: "s-1",
      displayTitle: "How do I reset the cache?",
      running: false,
      blank: false,
      updatedAt: 1_000,
    },
    "s-2": {
      id: "s-2",
      displayTitle: "s-2",
      running: true,
      blank: true,
      updatedAt: 2_000,
    },
  } as unknown as Record<string, SessionSummary>;

  it("projects indexed ids onto the host session list, newest update first", () => {
    const rows = buildChatRows(
      ["s-1", "s-2", "gone"],
      byId,
      "s-1",
      undefined,
      90_000,
    );
    expect(rows).toEqual([
      {
        id: "s-2",
        title: "Новый чат",
        running: true,
        active: false,
        meta: "1 мин",
        updatedAt: 2_000,
      },
      {
        id: "s-1",
        title: "How do I reset the cache?",
        running: false,
        active: true,
        meta: "1 мин",
        updatedAt: 1_000,
      },
    ]);
  });

  it("never shows a delegated child, even when the index still names one", () => {
    // A record from a release that could claim a subagent's session keeps such
    // an id in the browser index; a subagent's session is not a chat, and the
    // host list marks it as one (`origin`) or as somebody's child (`parentId`).
    const withChild = {
      ...byId,
      "sub-origin": {
        id: "sub-origin",
        displayTitle: "Собери глоссарий",
        origin: "subagent",
        running: false,
        blank: false,
        updatedAt: 3_000,
      },
      "sub-parent": {
        id: "sub-parent",
        displayTitle: "Собери глоссарий",
        parentId: "s-1",
        running: false,
        blank: false,
        updatedAt: 4_000,
      },
    } as unknown as Record<string, SessionSummary>;

    const rows = buildChatRows(
      ["sub-parent", "sub-origin", "s-1"],
      withChild,
      null,
      undefined,
      90_000,
    );

    expect(rows.map((row) => row.id)).toEqual(["s-1"]);
  });

  it("renders rows with the active mark and a new-chat control", () => {
    const onSwitch = vi.fn();
    const rows = buildChatRows(["s-2", "s-1"], byId, "s-2", undefined, 90_000);
    render(
      <QaSidebar
        rows={rows}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat
        busy={false}
        onSwitch={onSwitch}
        onNewChat={vi.fn()}
      />,
    );
    const items = document.querySelectorAll(".dsh-qa-sidebar__item");
    expect(items.length).toBe(2);
    const active = document.querySelector(
      ".dsh-qa-sidebar__item--active .dsh-qa-sidebar__item-main",
    );
    expect(active?.getAttribute("aria-current")).toBe("true");
    expect(active?.textContent).toContain("Новый чат");
    expect(document.querySelector(".dsh-qa-sidebar__dot")).toBeTruthy();
    fireEvent.click(
      document.querySelector(".dsh-qa-sidebar__new") as HTMLElement,
    );
    fireEvent.click(
      (items[1] as HTMLElement).querySelector(
        ".dsh-qa-sidebar__item-main",
      ) as HTMLElement,
    );
    expect(onSwitch).toHaveBeenCalledWith("s-1");
  });

  it("shows the brand head and filters rows through the search field", () => {
    const rows = buildChatRows(["s-2", "s-1"], byId, null, undefined, 90_000);
    render(
      <QaSidebar
        rows={rows}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(screen.getByText("DeepSeek QA")).toBeTruthy();
    const search = screen.getByLabelText("Поиск по чатам") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "cache" } });
    const items = document.querySelectorAll(".dsh-qa-sidebar__item");
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain("How do I reset the cache?");
    fireEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(search.value).toBe("");
    expect(document.querySelectorAll(".dsh-qa-sidebar__item").length).toBe(2);
    fireEvent.change(search, { target: { value: "нет такого" } });
    expect(screen.getByText("Ничего не найдено")).toBeTruthy();
    fireEvent.change(search, { target: { value: "  " } });
    expect(document.querySelectorAll(".dsh-qa-sidebar__item").length).toBe(2);
  });

  it("matches owner names in the admin search", () => {
    const rows = buildChatRows(
      ["s-2", "s-1"],
      byId,
      null,
      (id) => (id === "s-1" ? "Аня" : "Борис"),
      90_000,
    );
    render(
      <QaSidebar
        rows={rows}
        groupByOwner
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Поиск по чатам"), {
      target: { value: "аня" },
    });
    expect(document.querySelectorAll(".dsh-qa-sidebar__item")).toHaveLength(1);
    expect(screen.getByText("Аня (1)")).toBeTruthy();
  });

  it("orders owner sections by freshness with unclaimed chats last", () => {
    const row = (
      id: string,
      updatedAt: number,
      ownerName?: string,
    ): QaChatRow => ({
      id,
      title: id,
      running: false,
      active: false,
      meta: "",
      updatedAt,
      ...(ownerName === undefined ? {} : { ownerName }),
    });
    const sections = buildOwnerSections([
      row("a", 100, "Аня"),
      row("b", 900, "Борис"),
      row("c", 500),
      row("d", 50, "Аня"),
    ]);
    expect(sections.map((section) => section.name)).toEqual([
      "Борис",
      "Аня",
      "Без владельца",
    ]);
    expect(sections[1]?.rows.map((entry) => entry.id)).toEqual(["a", "d"]);
  });

  it("renders per-owner section headers in the admin grouping", () => {
    const rows = buildChatRows(
      ["s-2", "s-1"],
      byId,
      null,
      (id) => (id === "s-1" ? "Аня" : "Борис"),
      90_000,
    );
    render(
      <QaSidebar
        rows={rows}
        groupByOwner
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    const names = [
      ...document.querySelectorAll(".dsh-qa-sidebar__group-name"),
    ].map((node) => node.textContent);
    expect(names).toEqual(["Борис (1)", "Аня (1)"]);
    expect(document.querySelectorAll(".dsh-qa-sidebar__item").length).toBe(2);
  });

  it("collapses to a rail and expands again, remembering the state", () => {
    window.localStorage.clear();
    const rows = buildChatRows(["s-1"], byId, null, undefined, 90_000);
    const view = render(
      <QaSidebar
        rows={rows}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Свернуть историю чатов" }),
    );
    expect(document.querySelector(".dsh-qa-sidebar--collapsed")).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dsh-qa-surface.session:v1:/qa:sidebar-collapsed",
      ),
    ).toBe("1");
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть историю чатов" }),
    );
    expect(
      view.container.querySelector(".dsh-qa-sidebar--collapsed"),
    ).toBeNull();
    expect(
      window.localStorage.getItem(
        "dsh-qa-surface.session:v1:/qa:sidebar-collapsed",
      ),
    ).toBe("0");
  });

  it("renders the empty state without a new-chat control", () => {
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(screen.getByText("Здесь пока пусто")).toBeTruthy();
    expect(screen.getByText("DeepSeek QA")).toBeTruthy();
  });
});

it("deletes a chat after a second confirming click", () => {
  const onDelete = vi.fn();
  const rows = [
    {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    },
  ];
  const { container } = render(
    <QaSidebar
      rows={rows}
      title="DeepSeek QA"
      logoUrl={null}
      stateKey="dsh-qa-surface.session:v1:/qa"
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
      onDelete={onDelete}
    />,
  );
  const del = container.querySelector(
    ".dsh-qa-sidebar__item-delete",
  ) as HTMLElement;
  expect(del.getAttribute("aria-label")).toBe("Удалить чат");
  fireEvent.click(del);
  expect(onDelete).not.toHaveBeenCalled();
  expect(del.getAttribute("aria-label")).toBe("Подтвердить удаление чата");
  fireEvent.click(del);
  expect(onDelete).toHaveBeenCalledWith("s-1");
});

it("hides the delete control when the deployment omits it", () => {
  const rows = [
    {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    },
  ];
  const { container } = render(
    <QaSidebar
      rows={rows}
      title="DeepSeek QA"
      logoUrl={null}
      stateKey="dsh-qa-surface.session:v1:/qa"
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );
  expect(container.querySelector(".dsh-qa-sidebar__item-delete")).toBeNull();
});

describe("sidebar version and changelog", () => {
  it("opens the changelog dialog from the footer version button", () => {
    const { container } = render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(container.querySelector(".dsh-qa-modal")).toBeNull();
    const version = screen.getByRole("button", { name: /Версия / });
    expect(version.textContent).toBe(`Версия ${QA_VERSION}`);
    fireEvent.click(version);
    const dialog = document.querySelector(".dsh-qa-modal") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("История версий")).toBeTruthy();
    expect(document.querySelectorAll(".dsh-qa-changelog__entry").length).toBe(
      QA_CHANGELOG.length,
    );
    expect(document.querySelectorAll(".dsh-qa-changelog__current").length).toBe(
      1,
    );
    // The changelog asks for the same wider panel the profile dialog uses;
    // its entries are full sentences and strand words at the default width.
    expect(document.querySelector(".dsh-qa-modal__panel--wide")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Закрыть историю версий"));
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
  });

  it("closes the changelog dialog on Escape and backdrop clicks", () => {
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(document.querySelector(".dsh-qa-modal") as HTMLElement);
    expect(document.querySelector(".dsh-qa-modal")).toBeNull();
    // A click inside the panel does not close the dialog.
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(
      document.querySelector(".dsh-qa-modal__panel") as HTMLElement,
    );
    expect(document.querySelector(".dsh-qa-modal")).toBeTruthy();
  });

  it("keeps the bundled version in sync with the package and changelog", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    // jsdom gives import.meta.url an http scheme; resolve from the package root.
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    expect(QA_VERSION).toBe(packageJson.version);
    const changelog = await readFile(
      resolve(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );
    const released = [
      // git-cliff releases use "## X.Y.Z (date)", the legacy header " - ".
      ...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?: \(| - )/gmu),
    ].map((match) => match[1] as string);
    const currentIndex = QA_CHANGELOG.findIndex(
      (entry) => entry.version === QA_VERSION,
    );
    expect(currentIndex).toBeGreaterThanOrEqual(0);
    expect(
      QA_CHANGELOG.slice(currentIndex).map((entry) => entry.version),
    ).toEqual(released);
  });

  it("keeps the next Nx-planned version at the top of the bundled changelog", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const plansDirectory = resolve(process.cwd(), "../../.nx/version-plans");
    const plans = await readdir(plansDirectory);
    const bumps = (
      await Promise.all(
        plans
          .filter((name) => name.endsWith(".md"))
          .map((name) => readFile(resolve(plansDirectory, name), "utf8")),
      )
    ).flatMap((plan) => {
      const match = /^"@yadsh\/dsh-qa-surface": (patch|minor|major)$/mu.exec(
        plan,
      );
      return match?.[1] === undefined ? [] : [match[1]];
    });
    if (bumps.length === 0) return;

    const priority = { patch: 1, minor: 2, major: 3 } as const;
    const bump = bumps.reduce((highest, candidate) =>
      priority[candidate as keyof typeof priority] >
      priority[highest as keyof typeof priority]
        ? candidate
        : highest,
    );
    const [major = 0, minor = 0, patch = 0] = packageJson.version
      .split(".")
      .map((part) => Number(part));
    const expected =
      bump === "major"
        ? `${major + 1}.0.0`
        : bump === "minor"
          ? `${major}.${minor + 1}.0`
          : `${major}.${minor}.${patch + 1}`;
    expect(QA_CHANGELOG[0]?.version).toBe(expected);
  });
});
