// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  fileCount: 0,
  filesOpen: false,
  onOpenFiles: () => undefined,
  showReset: false,
  resetDisabled: false,
  onReset: () => undefined,
};

describe("header settings entry", () => {
  it("stays away while the sidebar carries the entry", () => {
    render(<QaHeader {...BASE} />);
    expect(screen.queryByRole("button", { name: "Настройки" })).toBeNull();
  });

  it("opens the user settings when the header carries the entry", () => {
    const onOpen = vi.fn();
    render(<QaHeader {...BASE} settings={{ label: "Иван Иванов", onOpen }} />);
    const button = screen.getByRole("button", { name: "Настройки" });
    expect(button.getAttribute("title")).toBe("Иван Иванов");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
