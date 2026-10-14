// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaSourcesPanel } from "../../../src/client/components/QaSourcesPanel.js";
import { Markdown } from "../../../src/client/components/Markdown.js";
import { buildSourceRefs } from "../../../src/client/components/source-refs.js";
import { resolveConfig } from "../../../src/resolve-config.js";
import { readFrontmatter } from "../../../src/markdown-frontmatter.js";
import type { QaSource } from "../../../src/types.js";

const content =
  '---\r\ntitle: Демо-документ\r\napplies_to: ["1.0"]\r\nsource:\r\n  primary: {path: docs/demo.docx, format: docx}\r\n---\r\n# Руководство\r\n\r\nПервый абзац\r\n\r\nИскомый абзац\r\n\r\n![Схема](../assets/demo.png)';
const source: QaSource = {
  id: "demo",
  kind: "file",
  title: "guide.md",
  path: "docs/guide.md",
  locations: [{ lineStart: 9 }],
  evidence: "read",
  origins: [],
  score: 1,
};
const value = {
  path: source.path!,
  content,
  size: content.length,
  truncated: false,
  markdown: true,
  renderableMarkdown: true,
  frontmatter: readFrontmatter(content),
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Markdown source preview", () => {
  it("renders converted image captions split across paragraphs while retaining original line numbers", async () => {
    const config = resolveConfig().sources;
    render(
      <QaSourcesPanel
        sources={[source]}
        initialDetail={{ ...source, locations: [{ lineStart: 6 }] }}
        complete
        sessionId="root"
        sourceApi={
          {
            readSourceFile: async () => ({
              ok: true,
              value: {
                ...value,
                content:
                  "# Guide\n\n![Diagram description\n\nAutomatically generated caption](../assets/demo.png)\n\nAfter the illustration.",
                frontmatter: undefined,
              },
            }),
            readSourceImage: async () => ({
              ok: true,
              value: "data:image/png;base64,AA==",
            }),
          } as never
        }
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    const image = await screen.findByTestId("qa-source-image-loaded");
    expect(image.getAttribute("alt")).toContain(
      "Automatically generated caption",
    );
    expect(
      screen
        .getByText("After the illustration.")
        .closest("[data-source-line-start]")
        ?.getAttribute("data-source-line-start"),
    ).toBe("7");
  });
  it("repositions repeated and different clicks in an already-open document without reloading it", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scroll,
      configurable: true,
    });
    const refs = buildSourceRefs([source]);
    const config = resolveConfig({
      sources: { filePreview: { renderFrontmatter: true } },
    }).sources;
    const api = {
      readSourceFile: vi.fn(async () => ({ ok: true as const, value })),
      readSourceImage: vi.fn(async () => ({
        ok: false as const,
        error: "missing",
      })),
    };
    const panel = (target: QaSource) => (
      <QaSourcesPanel
        sources={[source]}
        initialDetail={target}
        complete
        sessionId="root"
        sourceApi={api as never}
        display={config.display}
        filePreview={config.filePreview}
      />
    );
    const view = render(panel(refs.resolvePath("guide.md:9")!));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    view.rerender(panel(refs.resolvePath("guide.md:11")!));
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-source-preview-block-highlight").textContent,
      ).toBe("Искомый абзац"),
    );
    const before = scroll.mock.calls.length;
    view.rerender(panel(refs.resolvePath("guide.md:11")!));
    await waitFor(() =>
      expect(scroll.mock.calls.length).toBeGreaterThan(before),
    );
    expect(api.readSourceFile).toHaveBeenCalledTimes(1);
  });
  it("keeps frontmatter opt-in and preserves the physical offset including CRLF fences", () => {
    expect(resolveConfig().sources.filePreview.renderFrontmatter).toBe(false);
    expect(readFrontmatter(content)?.offset).toBe(6);
    for (const text of [
      "---\nMissing closer",
      "---\ntitle: [\n---",
      "---\n[one, two]\n---",
      "---\na: &one [1]\nb: *one\n---",
      "# Ordinary\n---",
      "---\na: 1\na: 2\n---",
    ])
      expect(readFrontmatter(text)).toBeUndefined();
  });

  it("opens the clicked range instead of the catalog's first range, scrolls and preserves raw bytes", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scroll,
      configurable: true,
    });
    const selected = buildSourceRefs([source]).resolvePath("guide.md#L11")!;
    const config = resolveConfig({
      sources: { filePreview: { renderFrontmatter: true } },
    }).sources;
    const readSourceFile = vi.fn(async () => ({ ok: true as const, value }));
    const readSourceImage = vi.fn(async () => ({
      ok: true as const,
      value: "data:image/png;base64,AA==",
    }));
    render(
      <QaSourcesPanel
        sources={[source]}
        initialDetail={selected}
        complete
        sessionId="root"
        sourceApi={{ readSourceFile, readSourceImage } as never}
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    expect(await screen.findByTestId("qa-source-frontmatter")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Демо-документ" })).toBeTruthy();
    const highlighted = screen.getByTestId("qa-source-preview-block-highlight");
    expect(highlighted.textContent).toBe("Искомый абзац");
    expect(highlighted.dataset.sourceLineStart).toBe("11");
    await waitFor(() => expect(scroll.mock.contexts).toContain(highlighted));
    expect(
      (await screen.findByTestId("qa-source-image-loaded")).getAttribute("src"),
    ).toMatch(/^data:image\/png/u);
    expect(readSourceImage).toHaveBeenCalledWith(
      "root",
      "docs/guide.md",
      "../assets/demo.png",
    );
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(
      screen.getByTestId("qa-source-preview-line-highlight").textContent,
    ).toBe("11Искомый абзац");
    expect(screen.getByTestId("qa-source-preview-raw").textContent).toContain(
      "title: Демо-документ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Rendered" }));
    await waitFor(() =>
      expect(screen.getByTestId("qa-source-image-loaded")).toBeTruthy(),
    );
    expect(readSourceImage).toHaveBeenCalledTimes(1);
  });

  it("keeps same-document clicks at their own range and does not broaden ambiguous paths", async () => {
    const refs = buildSourceRefs([source]);
    const open = vi.fn();
    render(
      <Markdown
        text="`guide.md:11-13` and [earlier](guide.md#L9)"
        sourceRefs={refs}
        onSourceOpen={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "guide.md:11-13" }));
    expect(open.mock.calls[0]?.[0].locations).toEqual([
      { path: source.path, lineStart: 11, lineEnd: 13 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "earlier" }));
    expect(open.mock.calls[1]?.[0].locations[0].lineStart).toBe(9);
    expect(refs.resolvePath("guide.md:0")).toBeUndefined();
    expect(refs.resolvePath("guide.md:13-11")).toBeUndefined();
    expect(
      buildSourceRefs([
        source,
        { ...source, id: "other", path: "other/guide.md" },
      ]).resolvePath("guide.md:11"),
    ).toBeUndefined();
  });

  it("leaves malformed YAML visible and local image failures readable", async () => {
    const config = resolveConfig({
      sources: { filePreview: { renderFrontmatter: true } },
    }).sources;
    render(
      <QaSourcesPanel
        sources={[source]}
        initialDetail={source}
        complete
        sessionId="root"
        sourceApi={
          {
            readSourceFile: async () => ({
              ok: true,
              value: {
                ...value,
                content: "---\ntitle: [\n---\n![Схема](missing.png)",
                frontmatter: undefined,
              },
            }),
            readSourceImage: async () => ({ ok: false, error: new Error() }),
          } as never
        }
        display={config.display}
        filePreview={config.filePreview}
      />,
    );
    expect(await screen.findByText(/изображение недоступно/u)).toBeTruthy();
    expect(screen.queryByTestId("qa-source-frontmatter")).toBeNull();
    expect(
      screen.getByTestId("qa-source-preview-markdown").textContent,
    ).toContain("title: [");
  });
});
