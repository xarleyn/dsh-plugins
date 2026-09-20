// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  QaHeader,
  type QaHeaderProps,
} from "../src/client/components/QaHeader.js";

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
    const { container } = render(
      <QaHeader
        {...BASE}
        administration={{ onOpen: () => undefined }}
        panelLauncher={<button type="button">Browser</button>}
        settings={{ label: "Иван Иванов", onOpen: () => undefined }}
      />,
    );

    const clusters = container.querySelectorAll(".dsh-qa-header__actions");
    expect(clusters).toHaveLength(1);
    const cluster = clusters[0]!;
    const files = container.querySelector(".dsh-qa-header__files");
    if (files === null) throw new Error("the files control is missing");

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
    const { container } = render(
      <QaHeader
        {...BASE}
        showReset
        administration={{ onOpen: () => undefined }}
        settings={{ label: "Иван Иванов", onOpen: () => undefined }}
      />,
    );

    const clusters = container.querySelectorAll(".dsh-qa-header__actions");
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
    expect(container.querySelector(".dsh-qa-header__viewing")).toBeNull();
  });
});
