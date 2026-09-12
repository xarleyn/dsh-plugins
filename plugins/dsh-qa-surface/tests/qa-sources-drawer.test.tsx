// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaSource } from "../src/types.js";
import { QaSourcesDrawer } from "../src/client/components/QaSourcesDrawer.js";
import { resolveConfig } from "../src/resolve-config.js";

describe("sources drawer", () => {
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
      <QaSourcesDrawer
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
        onClose={vi.fn()}
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
      <QaSourcesDrawer
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{ sources: vi.fn(), readSourceFile }}
        display={config.display}
        filePreview={config.filePreview}
        onClose={vi.fn()}
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
});
