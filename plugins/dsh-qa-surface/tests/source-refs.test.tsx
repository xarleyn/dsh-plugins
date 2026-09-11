// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/client/components/Markdown.js";
import { QaSourcesDrawer } from "../src/client/components/QaSourcesDrawer.js";
import {
  buildSourceRefs,
  sourceFileName,
} from "../src/client/components/source-refs.js";
import type { QaSource, ResolvedQaSurfaceConfig } from "../src/types.js";

function webSource(overrides: Partial<QaSource> = {}): QaSource {
  return {
    id: "w1",
    kind: "web",
    title: "GitHub",
    uri: "https://github.com/deepseek-ai/dsh-session-kb",
    snippet: "Search all your past sessions and recall them to the AI",
    locations: [],
    evidence: "fetched",
    origins: [],
    score: 1,
    ...overrides,
  };
}

function fileSource(overrides: Partial<QaSource> = {}): QaSource {
  return {
    id: "f1",
    kind: "code",
    title: "index.ts",
    path: "D:/repos/proj/src/index.ts",
    locations: [],
    evidence: "read",
    origins: [],
    score: 1,
    ...overrides,
  };
}

describe("QA source refs", () => {
  it("resolves markdown links by normalized URL", () => {
    const refs = buildSourceRefs([webSource()]);
    expect(
      refs.resolveUrl("https://github.com/deepseek-ai/dsh-session-kb")?.id,
    ).toBe("w1");
    expect(
      refs.resolveUrl("https://github.com/deepseek-ai/dsh-session-kb/")?.id,
    ).toBe("w1");
    expect(
      refs.resolveUrl("https://GitHub.com/deepseek-ai/dsh-session-kb#readme")
        ?.id,
    ).toBe("w1");
    expect(
      refs.resolveUrl(
        "https://github.com/deepseek-ai/dsh-session-kb?tab=readme",
      ),
    ).toBeUndefined();
    expect(refs.resolveUrl("mailto:ops@example.com")).toBeUndefined();
  });

  it("resolves inline-code tokens by path: exact, suffix, unique basename", () => {
    const refs = buildSourceRefs([
      fileSource(),
      fileSource({
        id: "f2",
        path: "D:/repos/other/README.md",
        title: "README.md",
      }),
    ]);
    expect(refs.resolvePath("D:\\repos\\proj\\src\\index.ts")?.id).toBe("f1");
    expect(refs.resolvePath("src/index.ts")?.id).toBe("f1");
    expect(refs.resolvePath("index.ts")?.id).toBe("f1");
    expect(refs.resolvePath("README.md")?.id).toBe("f2");
    // Ambiguous bare name and foreign paths stay unmatched.
    const ambiguous = buildSourceRefs([
      fileSource(),
      fileSource({ id: "f3", path: "D:/repos/other/src/index.ts" }),
    ]);
    expect(ambiguous.resolvePath("index.ts")).toBeUndefined();
    expect(ambiguous.resolvePath("src/index.ts")).toBeUndefined();
    expect(refs.resolvePath("lib/other.ts")).toBeUndefined();
    expect(refs.resolvePath("")).toBeUndefined();
  });

  it("labels file sources by their file name, case kept", () => {
    expect(sourceFileName(fileSource())).toBe("index.ts");
    expect(sourceFileName(fileSource({ path: "D:/REPO/Src/Index.TS" }))).toBe(
      "Index.TS",
    );
    expect(sourceFileName(webSource())).toBe("dsh-session-kb");
  });
});

describe("QA inline source chips", () => {
  it("renders a matched web link as a chip that opens right away", () => {
    const refs = buildSourceRefs([webSource()]);
    render(
      <Markdown
        text={
          "Смотри [GitHub](https://github.com/deepseek-ai/dsh-session-kb) тут."
        }
        sourceRefs={refs}
      />,
    );
    const chip = document.querySelector("a.dsh-qa-srcref");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("href")).toBe(
      "https://github.com/deepseek-ai/dsh-session-kb",
    );
    expect(chip?.getAttribute("target")).toBe("_blank");
    expect(chip?.getAttribute("rel")).toContain("noopener");
    expect(chip?.getAttribute("data-kind")).toBe("web");
    expect(chip?.textContent).toContain("GitHub");
    const card = document.querySelector(".dsh-qa-srcref__card");
    expect(card?.textContent).toContain("GitHub");
    expect(card?.textContent).toContain("past sessions");
  });

  it("keeps unmatched links plain", () => {
    render(
      <Markdown
        text="[Сторонний](https://example.com/page)"
        sourceRefs={buildSourceRefs([webSource()])}
      />,
    );
    expect(document.querySelector("a.dsh-qa-srcref")).toBeNull();
    const plain = screen.getByRole("link", { name: "Сторонний" });
    expect(plain.className).toBe("");
  });

  it("renders a matched file path as a chip that opens the drawer detail", () => {
    const source = fileSource();
    const onSourceOpen = vi.fn();
    render(
      <Markdown
        text={"Логика в `src/index.ts`."}
        sourceRefs={buildSourceRefs([source])}
        onSourceOpen={onSourceOpen}
      />,
    );
    const chip = document.querySelector("button.dsh-qa-srcref");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("index.ts");
    if (chip !== null) fireEvent.click(chip);
    expect(onSourceOpen).toHaveBeenCalledWith(source);
  });

  it("keeps unmatched inline code and ambiguous names inert", () => {
    const refs = buildSourceRefs([
      fileSource(),
      fileSource({ id: "f3", path: "D:/repos/other/src/index.ts" }),
    ]);
    render(
      <Markdown text="`npm run build` и `src/index.ts`" sourceRefs={refs} />,
    );
    expect(document.querySelector(".dsh-qa-srcref")).toBeNull();
    expect(screen.getAllByRole("code")).toHaveLength(2);
  });
});

describe("QA sources drawer direct detail", () => {
  it("opens straight onto the requested source", () => {
    const display = {
      sidebar: true,
      footer: true,
      groupByKind: true,
      showDiscovered: true,
      showOriginBadges: true,
      maxInitiallyVisiblePerGroup: 3,
    } as ResolvedQaSurfaceConfig["sources"]["display"];
    const filePreview = {
      enabled: false,
      markdownRenderedByDefault: false,
      allowRawToggle: false,
      maxBytes: 0,
      maxMarkdownRenderBytes: 0,
    } as ResolvedQaSurfaceConfig["sources"]["filePreview"];
    render(
      <QaSourcesDrawer
        sources={[webSource(), fileSource()]}
        complete
        sessionId={null}
        sourceApi={{ sources: vi.fn(), readSourceFile: vi.fn() }}
        display={display}
        filePreview={filePreview}
        initialDetail={fileSource()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Web/)).toBeNull();
    const title = document.querySelector(".dsh-qa-sourcedetail__title");
    expect(title?.textContent).toBe("index.ts");
  });
});
