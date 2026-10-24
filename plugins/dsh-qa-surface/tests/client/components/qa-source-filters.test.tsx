// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaSourcesPanel } from "../../../src/client/components/QaSourcesPanel.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import type { QaSource } from "../../../src/types.js";

const sources: QaSource[] = Array.from({ length: 12 }, (_, index) => ({
  id: `web:${index}`,
  kind: "web",
  title: `Page ${index}`,
  uri: `https://example.com/pages/${index}`,
  locations: [],
  evidence: "fetched",
  origins: [{ sessionId: "root", turn: 1, role: "parent" }],
  score: 100,
  content:
    index === 11
      ? "First paragraph\nСодержимое за пределами фрагмента"
      : "Page body",
}));
sources.push({
  ...sources[0]!,
  id: "jira:PROJ-123",
  kind: "jira",
  title: "Demo issue",
  uri: "https://jira.example.corp/browse/PROJ-123",
  content: "Описание задачи",
  contentTruncated: true,
});

function panel(groupByKind = true) {
  const config = resolveConfig().sources;
  const readSourceFile = vi.fn();
  render(
    <QaSourcesPanel
      sources={sources}
      complete
      sessionId="root"
      sourceApi={{ readSourceFile } as never}
      display={{
        ...config.display,
        maxInitiallyVisiblePerGroup: 2,
        groupByKind,
      }}
      filePreview={config.filePreview}
    />,
  );
  return { readSourceFile };
}

describe("source filtering and retrieved content", () => {
  it("searches beyond pagination, combines kind and text and keeps filters on return", () => {
    const { readSourceFile } = panel();
    expect(screen.getAllByTestId("qa-sources-item")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "СОДЕРЖИМОЕ" },
    });
    expect(screen.getAllByTestId("qa-sources-item")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("qa-sources-item"));
    expect(
      screen.getByTestId("qa-source-detail-content").textContent,
    ).toContain("Содержимое");
    expect(readSourceFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ко всем источникам" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
      "СОДЕРЖИМОЕ",
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "jira" },
    });
    expect(screen.getByTestId("qa-sources-no-matches")).toBeTruthy();
    expect(screen.queryByTestId("qa-sources-empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(screen.getAllByTestId("qa-sources-item")).toHaveLength(3);
  });

  it("finds links with grouping disabled and renders partial content as inert text", () => {
    panel(false);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "JIRA.EXAMPLE.CORP" },
    });
    expect(screen.getByRole("status").textContent).toBe("Найдено 1 из 13");
    fireEvent.click(screen.getByTestId("qa-sources-item"));
    expect(screen.getByTestId("qa-source-detail-content").textContent).toBe(
      "Описание задачи",
    );
    expect(screen.getByTestId("qa-source-content-truncated")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Открыть" }).getAttribute("href"),
    ).toBe("https://jira.example.corp/browse/PROJ-123");
  });
});
