// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaRailTabModel } from "../../../src/client/components/QaRightRail.js";
import { QaRightRail } from "../../../src/client/components/QaRightRail.js";
import { QaModal } from "../../../src/client/components/QaModal.js";

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
    // The panel is the whole page on a phone, so the name of the only way out
    // has to say which panel it leaves.
    fireEvent.click(
      screen.getByRole("button", { name: /Закрыть панель «Источники»/ }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape from anywhere on the page", () => {
    // At the phone width the panel covers the conversation, and the focus may
    // still sit in the composer behind it, so the key is answered at the window
    // rather than inside the panel.
    const onClose = vi.fn();
    render(
      <QaRightRail
        tabs={tabs}
        activeTab="sources"
        onTabSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves Escape to a dialog standing over the panel", () => {
    const onClose = vi.fn();
    const closeDialog = vi.fn();
    render(
      <>
        <QaRightRail
          tabs={tabs}
          activeTab="sources"
          onTabSelect={vi.fn()}
          onClose={onClose}
        />
        <QaModal
          open
          title="Просмотр файла"
          closeLabel="Закрыть просмотр"
          onClose={closeDialog}
        >
          <p>содержимое</p>
        </QaModal>
      </>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(closeDialog).toHaveBeenCalledOnce();
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
    render(
      <QaRightRail
        tabs={tabs}
        activeTab="sources"
        onTabSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const panel = screen.getByTestId("qa-surface-rail");
    expect(panel.className).toBe("dsh-qa-panel");
  });
});
