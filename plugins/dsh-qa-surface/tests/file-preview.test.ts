import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSourceFilePreview } from "../src/provenance/file-preview.js";

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("source file preview", () => {
  it("recognizes Markdown and enforces byte/render limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "qa-source-preview-"));
    temporary.push(root);
    await writeFile(join(root, "guide.md"), "# Guide\n0123456789", "utf8");
    const preview = await readSourceFilePreview({
      root,
      sourcePath: "guide.md",
      maxBytes: 10,
      maxMarkdownRenderBytes: 5,
    });
    expect(preview).toMatchObject({
      path: "guide.md",
      markdown: true,
      renderableMarkdown: false,
      truncated: true,
      content: "# Guide\n01",
    });
  });

  it("rejects traversal outside the configured root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "qa-source-boundary-"));
    temporary.push(parent);
    const root = join(parent, "root");
    await mkdir(root);
    await writeFile(join(parent, "secret.txt"), "secret", "utf8");
    await expect(
      readSourceFilePreview({
        root,
        sourcePath: "../secret.txt",
        maxBytes: 100,
        maxMarkdownRenderBytes: 100,
      }),
    ).rejects.toThrow(/escapes/u);
  });
});
