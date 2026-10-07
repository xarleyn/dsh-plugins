// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QaHeader,
  type QaHeaderProps,
} from "../../../src/client/components/QaHeader.js";

afterEach(cleanup);

const BASE: QaHeaderProps = {
  logoUrl: null,
  title: "Чат",
  viewingSubagent: false,
  onCloseSubagent: () => undefined,
  agentCount: 0,
  agentsOpen: false,
  onToggleAgents: () => undefined,
  sourcesVisible: true,
  sourcesCount: 0,
  sourcesComplete: true,
  sourcesOpen: false,
  onOpenSources: () => undefined,
  fileCount: 2,
  filesEnabled: true,
  filesOpen: false,
  onOpenFiles: () => undefined,
  showReset: false,
  resetDisabled: false,
  onReset: () => undefined,
};

function labels(cluster: Element): readonly (string | null)[] {
  return [...cluster.children].map((child) => child.textContent);
}

/**
 * The row pins exactly one thing to the right edge. Every button that carried
 * its own `margin-left:auto` split the free space between two gaps, and
 * «Файлы» — the sibling of the sources control — ended up floating in the
 * middle of the row, away from the tabs it belongs to.
 */
describe("header action cluster", () => {
  it("keeps the files control with the tabs it belongs to", () => {
    render(
      <QaHeader
        {...BASE}
        administration={{ onOpen: () => undefined }}
        panelLauncher={<button type="button">Browser</button>}
        settings={{ label: "Иван Иванов", onOpen: () => undefined }}
      />,
    );

    const clusters = screen.getAllByTestId("qa-surface-header-actions");
    expect(clusters).toHaveLength(1);
    const cluster = clusters[0]!;
    const files = screen.getByTestId("qa-surface-header-files");

    expect(files.className).toBe("dsh-qa-header__files");
    expect(cluster.contains(files)).toBe(false);
    expect(labels(cluster)).toEqual([
      "Администрирование",
      "Browser",
      "Настройки",
    ]);
    // Tabs first, actions last: the files control precedes the pinned cluster.
    const order = files.compareDocumentPosition(cluster);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries the new-chat action in the same cluster when shown", () => {
    render(
      <QaHeader
        {...BASE}
        showReset
        administration={{ onOpen: () => undefined }}
        settings={{ label: "Иван Иванов", onOpen: () => undefined }}
      />,
    );

    const clusters = screen.getAllByTestId("qa-surface-header-actions");
    expect(clusters).toHaveLength(1);
    expect(labels(clusters[0]!)).toEqual([
      "Новый чат",
      "Администрирование",
      "Настройки",
    ]);
  });

  // The agent-preset caption was a service label a reader could do nothing
  // about; the title row carries only the conversation and its controls.
  it("keeps the service mode badge out of the title row", () => {
    const { container } = render(<QaHeader {...BASE} />);
    expect(container.querySelector(".dsh-qa-header__mode")).toBeNull();
    expect(screen.queryByTestId("qa-surface-header-viewing")).toBeNull();
  });
});

/**
 * The empty states of the row's own controls, and the tab marker that becomes
 * the way back once a panel stands over the conversation.
 */
describe("header empty states and the chat tab", () => {
  it("keeps an empty control reachable and explains why it answers nothing", () => {
    render(<QaHeader {...BASE} />);
    const agents = screen.getByTestId("qa-surface-header-agents");
    // `disabled` would drop the control out of the tab order, and a keyboard
    // reader never learns that it exists.
    expect(agents.hasAttribute("disabled")).toBe(false);
    expect(agents.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /субагентов в этом чате пока нет/ })
        .getAttribute("title"),
    ).toBe("Субагентов в этом чате пока нет");
    expect(
      screen.getByRole("button", {
        name: /этот ответ обошёлся без источников/,
      }),
    ).toBeTruthy();
  });

  it("presses nothing while the control says it is empty", () => {
    const onToggleAgents = vi.fn();
    render(
      <QaHeader {...BASE} agentCount={0} onToggleAgents={onToggleAgents} />,
    );
    fireEvent.click(screen.getByTestId("qa-surface-header-agents"));
    expect(onToggleAgents).not.toHaveBeenCalled();
  });

  it("hands the control back once it has something to show", () => {
    const onToggleAgents = vi.fn();
    render(
      <QaHeader {...BASE} agentCount={2} onToggleAgents={onToggleAgents} />,
    );
    const agents = screen.getByTestId("qa-surface-header-agents");
    expect(agents.getAttribute("aria-disabled")).toBeNull();
    expect(agents.textContent).toContain("Агенты (2)");
    fireEvent.click(agents);
    expect(onToggleAgents).toHaveBeenCalledOnce();
  });

  it("leaves the chat marker a label while the chat is all there is", () => {
    render(<QaHeader {...BASE} />);
    expect(screen.queryByTestId("qa-surface-header-chat-tab")).toBeNull();
    const marker = screen.getByTestId(
      "qa-surface-header-tabs",
    ).firstElementChild;
    expect(marker?.tagName).toBe("SPAN");
    expect(marker?.getAttribute("aria-current")).toBe("page");
  });

  it("makes the chat marker the way back while a panel is open", () => {
    const onBackToChat = vi.fn();
    render(<QaHeader {...BASE} onBackToChat={onBackToChat} />);
    const tab = screen.getByTestId("qa-surface-header-chat-tab");
    expect(tab.tagName).toBe("BUTTON");
    expect(tab.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Вернуться к чату" }));
    expect(onBackToChat).toHaveBeenCalledOnce();
  });
});
