// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaRailTabModel } from "../../../src/client/components/QaRightRail.js";
import { QaRightRail } from "../../../src/client/components/QaRightRail.js";

const tabs: readonly QaRailTabModel[] = [
  {
    id: "sources",
    title: "Источники",
    count: 2,
    body: <p>список источников</p>,
  },
  {
    id: "files",
    title: "Файлы",
    count: 3,
    body: <p>список файлов</p>,
  },
];

describe("right rail", () => {
  it("renders the strip, marks the active tab and swaps bodies", () => {
    const onTabSelect = vi.fn();
    const { rerender } = render(
      <QaRightRail
        tabs={tabs}
        activeTab="sources"
        onTabSelect={onTabSelect}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    const sourcesTab = screen.getByRole("tab", { name: /Источники/ });
    expect(sourcesTab.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("tab", { name: /Файлы/ }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByRole("tabpanel", { name: "Источники" })).toBeTruthy();
    expect(screen.getByText("список источников")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Файлы/ }));
    expect(onTabSelect).toHaveBeenCalledWith("files");
    rerender(
      <QaRightRail
        tabs={tabs}
        activeTab="files"
        onTabSelect={onTabSelect}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("tabpanel", { name: "Файлы" })).toBeTruthy();
    expect(screen.getByText("список файлов")).toBeTruthy();
  });

  it("closes through the strip control and hides zero counts", () => {
    const onClose = vi.fn();
    render(
      <QaRightRail
        tabs={tabs.map((tab) => ({ ...tab, count: 0 }))}
        activeTab="sources"
        onTabSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.queryByRole("tab", { name: /2/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть панель" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("falls back to the first tab when the active id is unavailable", () => {
    render(
      <QaRightRail
        tabs={[tabs[1]!]}
        activeTab="sources"
        onTabSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("tabpanel", { name: "Файлы" })).toBeTruthy();
  });

  it("stays out of the turn rail's dsh-qa-rail class namespace", () => {
    // `.dsh-qa-rail*` belongs to the transcript's turn ladder; one shared
    // class made the panel height:0 + pointer-events:none and dragged the
    // ladder around. The rename guard keeps the two apart.
    const { container } = render(
      <QaRightRail
        tabs={tabs}
        activeTab="sources"
        onTabSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const panel = container.querySelector("aside");
    expect(panel?.className).toBe("dsh-qa-panel");
  });
});
