// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaSource } from "../src/types.js";
import { QaSourcesPanel } from "../src/client/components/QaSourcesPanel.js";
import { resolveConfig } from "../src/resolve-config.js";

describe("sources panel", () => {
  const fileSource: QaSource = {
    id: "file:docs/guide.md",
    kind: "file",
    title: "guide.md",
    path: "docs/guide.md",
    locations: [{ path: "docs/guide.md", lineStart: 2, lineEnd: 3 }],
    evidence: "inherited",
    origins: [
      {
        sessionId: "child",
        turn: 1,
        role: "subagent",
        subagentRunId: "run-1",
      },
    ],
    score: 100,
  };

  it("groups unique sources and exposes incomplete provenance", () => {
    const config = resolveConfig().sources;
    render(
      <QaSourcesPanel
        sources={[
          fileSource,
          {
            id: "web:https://example.com",
            kind: "web",
            title: "Example",
            uri: "https://example.com",
            locations: [],
            evidence: "fetched",
            origins: [{ sessionId: "root", turn: 1, role: "parent" }],
            score: 100,
          },
        ]}
        complete={false}
        incompleteOrigins={[{ subagentRunId: "opaque-1", reason: "opaque" }]}
        sessionId="root"
        sourceApi={
          {
            sources: vi.fn(),
            readSourceFile: vi.fn(),
          } as never
        }
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    expect(screen.getByText("Документы")).toBeTruthy();
    expect(screen.getByText("Web")).toBeTruthy();
    expect(screen.getByText(/делегированных запусков/u)).toBeTruthy();
  });

  it("opens Markdown rendered, toggles to raw and highlights referenced lines", async () => {
    const config = resolveConfig({
      sources: { display: { showOriginBadges: true } },
    }).sources;
    const readSourceFile = vi.fn(async () => ({
      ok: true as const,
      value: {
        path: "docs/guide.md",
        content:
          "# Guide\nReferenced text\nMore text\n<script>alert(1)</script>",
        size: 70,
        truncated: false,
        markdown: true,
        renderableMarkdown: true,
      },
    }));
    render(
      <QaSourcesPanel
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{
          sources: vi.fn(),
          readSourceFile,
          listWorkspaceFiles: vi.fn(),
          readWorkspaceFile: vi.fn(),
          previewWorkspaceDocument: vi.fn(),
        }}
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /guide\.md/u }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Rendered" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(screen.getByRole("heading", { name: "Guide" })).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(
      document.querySelectorAll(".dsh-qa-preview__line--highlight"),
    ).toHaveLength(2);
    expect(readSourceFile).toHaveBeenCalledWith("root", "docs/guide.md");
  });

  it("names the readable directories when the Host refuses the path", async () => {
    const config = resolveConfig().sources;
    const readSourceFile = vi.fn(async () => ({
      ok: false as const,
      error: new Error(
        "QA source preview refused the request (reason: outside-roots)",
      ),
    }));
    render(
      <QaSourcesPanel
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{ sources: vi.fn(), readSourceFile } as never}
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /guide\.md/u }));
    await waitFor(() =>
      expect(screen.getByText(/вне каталогов, доступных/u)).toBeTruthy(),
    );
    expect(screen.queryByText(/был перемещён/u)).toBeNull();
  });

  it("still reports a moved file as moved", async () => {
    const config = resolveConfig().sources;
    const readSourceFile = vi.fn(async () => ({
      ok: false as const,
      error: new Error(
        "QA source preview refused the request (reason: unavailable)",
      ),
    }));
    render(
      <QaSourcesPanel
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{ sources: vi.fn(), readSourceFile } as never}
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /guide\.md/u }));
    await waitFor(() =>
      expect(screen.getByText(/был перемещён/u)).toBeTruthy(),
    );
  });

  it("offers the way back to the whole-chat list only while pinned", () => {
    const config = resolveConfig().sources;
    const onShowAll = vi.fn();
    const { rerender } = render(
      <QaSourcesPanel
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{ sources: vi.fn(), readSourceFile: vi.fn() } as never}
        display={config.display}
        filePreview={config.filePreview}
        pinned
        onShowAll={onShowAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Все источники" }));
    expect(onShowAll).toHaveBeenCalledOnce();
    rerender(
      <QaSourcesPanel
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{ sources: vi.fn(), readSourceFile: vi.fn() } as never}
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    expect(screen.queryByRole("button", { name: "Все источники" })).toBeNull();
  });
});
