import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSourceImage } from "../../src/provenance/source-image.js";
import { markdownImageTargets } from "../../src/markdown-images.js";
import { readSourceFilePreview } from "../../src/provenance/file-preview.js";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ9sAAAAASUVORK5CYII=",
  "base64",
);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "qa-image-"));
  temporary.push(root);
  const cwd = join(root, "chat");
  await mkdir(join(cwd, "docs"), { recursive: true });
  await mkdir(join(cwd, "assets"));
  await writeFile(join(cwd, "assets", "demo.png"), png);
  await writeFile(
    join(cwd, "docs", "guide.md"),
    "# Demo\n![Diagram](../assets/demo.png)\n![Escape](../../outside.png)\n![Fake](../assets/fake.png)\n![URL](https://example.com/demo.png)\n![Link](../assets/link.png)",
  );
  await writeFile(join(root, "outside.png"), png);
  await writeFile(join(cwd, "assets", "fake.png"), '<svg onload="alert(1)"/>');
  return {
    root,
    cwd,
    sourcePath: "docs/guide.md",
    isEvidence: (path: string) => path === "docs/guide.md",
    maxBytes: 1024,
    maxMarkdownRenderBytes: 1024,
  };
}
describe("attested source images", () => {
  it("attests and parses YAML on the Host only when the preview flag is enabled", async () => {
    const request = await fixture();
    await writeFile(
      join(request.cwd, "docs", "guide.md"),
      "---\ntitle: Демо-документ\nsource: {primary: {format: docx}}\n---\n# Guide",
    );
    expect((await readSourceFilePreview(request)).frontmatter).toBeUndefined();
    const enabled = await readSourceFilePreview({
      ...request,
      renderFrontmatter: true,
    });
    expect(enabled.frontmatter?.fields.title).toBe("Демо-документ");
    expect(enabled.frontmatter?.offset).toBe(4);
    expect(enabled.content).toContain("title:");
  });
  it("reads a relative raster image while checking the parent source", async () => {
    const request = await fixture();
    expect(await readSourceImage(request, "../assets/demo.png")).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    await expect(
      readSourceImage(
        { ...request, isEvidence: () => false },
        "../assets/demo.png",
      ),
    ).rejects.toMatchObject({ reason: "not-evidence" });
    await expect(
      readSourceImage(request, "../assets/absent.png"),
    ).rejects.toMatchObject({ reason: "not-evidence" });
  });
  it("refuses escapes, remote server fetches, disguised SVG and oversized raster files", async () => {
    const request = await fixture();
    await expect(
      readSourceImage(request, "../../outside.png"),
    ).rejects.toMatchObject({ reason: "outside-roots" });
    await expect(
      readSourceImage(request, "https://example.com/demo.png"),
    ).rejects.toMatchObject({ reason: "unsupported" });
    await expect(
      readSourceImage(request, "../assets/fake.png"),
    ).rejects.toMatchObject({ reason: "unsupported" });
    await writeFile(
      join(request.cwd, "assets", "demo.png"),
      Buffer.concat([png, Buffer.alloc(1024)]),
    );
    await expect(
      readSourceImage(request, "../assets/demo.png"),
    ).rejects.toMatchObject({ reason: "unsupported" });
  });
  it("checks canonical symlink containment", async () => {
    const request = await fixture();
    await symlink(
      join(request.root, "outside.png"),
      join(request.cwd, "assets", "link.png"),
    );
    await expect(
      readSourceImage(request, "../assets/link.png"),
    ).rejects.toMatchObject({ reason: "outside-roots" });
  });
  it("collects real nested/reference/multiline image syntax and excludes fences and fake HTML", () => {
    expect([
      ...markdownImageTargets(
        '> ![One](a.png)\n\n- ![Two][asset]\n\n![Multiline\ncaption](c.png)\n\n[asset]: b.png\n\n```md\n![fake](secret.png)\n```\n<img src="secret.png">',
      ),
    ]).toEqual(["a.png", "b.png", "c.png"]);
  });
  it("recognizes a converter caption containing a blank line without consuming the next block", () => {
    const text =
      "# Guide\n\n![Diagram description\n\nAutomatically generated caption](../assets/demo.png)\n\nAfter the illustration.\n\n```\n![not an image](fake.png)\n```";
    expect([...markdownImageTargets(text)]).toEqual(["../assets/demo.png"]);
  });
});
