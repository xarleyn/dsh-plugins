import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  QaSourcePreviewError,
  listWorkspaceDirectory,
  readWorkspaceFile,
} from "../src/provenance/file-preview.js";

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function scratch(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

/** The refusal reason of one failed call, or null when it succeeded. */
async function refusalReason(
  run: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (!(error instanceof QaSourcePreviewError)) throw error;
    return error.reason;
  }
}

describe("workspace browsing", () => {
  it("lists a directory with directories first and file sizes only", async () => {
    const cwd = await scratch("qa-ws-list-");
    await mkdir(join(cwd, "notes"));
    await writeFile(join(cwd, "b.md"), "second", "utf8");
    await writeFile(join(cwd, "a.txt"), "first!", "utf8");
    const listing = await listWorkspaceDirectory({
      dirPath: "",
      cwd,
      maxEntries: 100,
    });
    expect(listing.path).toBe("");
    expect(listing.truncated).toBe(false);
    expect(listing.entries).toEqual([
      { name: "notes", type: "directory", size: null },
      { name: "a.txt", type: "file", size: 6 },
      { name: "b.md", type: "file", size: 6 },
    ]);
  });

  it("descends by name and reports the relative path it served", async () => {
    const cwd = await scratch("qa-ws-descend-");
    await mkdir(join(cwd, ".qa", "artifacts"), { recursive: true });
    await writeFile(
      join(cwd, ".qa", "artifacts", "manifest.json"),
      "{}",
      "utf8",
    );
    const listing = await listWorkspaceDirectory({
      dirPath: ".qa/artifacts",
      cwd,
      maxEntries: 100,
    });
    expect(listing.path).toBe(".qa/artifacts");
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      "manifest.json",
    ]);
  });

  it("refuses to walk out of the chat root", async () => {
    const cwd = await scratch("qa-ws-confine-");
    const outside = await scratch("qa-ws-outside-");
    await writeFile(join(outside, "secret.txt"), "hidden", "utf8");
    expect(
      await refusalReason(() =>
        listWorkspaceDirectory({ dirPath: "..", cwd, maxEntries: 100 }),
      ),
    ).toBe("outside-roots");
    expect(
      await refusalReason(() =>
        listWorkspaceDirectory({ dirPath: outside, cwd, maxEntries: 100 }),
      ),
    ).toBe("outside-roots");
  });

  it("refuses a path that is not a directory", async () => {
    const cwd = await scratch("qa-ws-notdir-");
    await writeFile(join(cwd, "note.txt"), "text", "utf8");
    expect(
      await refusalReason(() =>
        listWorkspaceDirectory({ dirPath: "note.txt", cwd, maxEntries: 100 }),
      ),
    ).toBe("unavailable");
  });

  it("cuts a long directory at the entry cap and says so", async () => {
    const cwd = await scratch("qa-ws-cap-");
    for (const name of ["a", "b", "c"]) {
      await writeFile(join(cwd, `${name}.txt`), name, "utf8");
    }
    const listing = await listWorkspaceDirectory({
      dirPath: "",
      cwd,
      maxEntries: 2,
    });
    expect(listing.entries).toHaveLength(2);
    expect(listing.truncated).toBe(true);
  });

  it("omits symlinked children instead of following them", async () => {
    const cwd = await scratch("qa-ws-symlink-");
    const outside = await scratch("qa-ws-target-");
    await writeFile(join(outside, "target.txt"), "outside", "utf8");
    await writeFile(join(cwd, "real.txt"), "inside", "utf8");
    await symlink(outside, join(cwd, "link-dir")).catch(() => undefined);
    await symlink(join(outside, "target.txt"), join(cwd, "link.txt")).catch(
      () => undefined,
    );
    const listing = await listWorkspaceDirectory({
      dirPath: "",
      cwd,
      maxEntries: 100,
    });
    expect(listing.entries.map((entry) => entry.name)).toEqual(["real.txt"]);
  });

  it("reads a text file with its advertised type and no byte payload", async () => {
    const cwd = await scratch("qa-ws-readtext-");
    await writeFile(join(cwd, "guide.md"), "# Guide", "utf8");
    const file = await readWorkspaceFile({
      filePath: "guide.md",
      cwd,
      maxBytes: 10_000,
      maxMarkdownRenderBytes: 10_000,
    });
    expect(file).toMatchObject({
      path: "guide.md",
      text: "# Guide",
      markdown: true,
      renderableMarkdown: true,
      mime: "text/markdown",
      truncated: false,
    });
    expect(file.base64).toBeUndefined();
  });

  it("returns base64 for a file that does not decode as text", async () => {
    const cwd = await scratch("qa-ws-readbytes-");
    await writeFile(
      join(cwd, "report.docx"),
      Buffer.from([0x50, 0x4b, 0x00, 0x01]),
    );
    const file = await readWorkspaceFile({
      filePath: "report.docx",
      cwd,
      maxBytes: 10_000,
      maxMarkdownRenderBytes: 10_000,
    });
    expect(file.text).toBeUndefined();
    // The panel needs the real type: it is what decides that this document is
    // rendered through the pipeline instead of being shown as a download.
    expect(file.mime).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(Buffer.from(file.base64 ?? "", "base64")).toEqual(
      Buffer.from([0x50, 0x4b, 0x00, 0x01]),
    );
  });

  it("keeps the head of a file larger than the read window", async () => {
    const cwd = await scratch("qa-ws-readcut-");
    await writeFile(join(cwd, "long.txt"), "0123456789", "utf8");
    const file = await readWorkspaceFile({
      filePath: "long.txt",
      cwd,
      maxBytes: 4,
      maxMarkdownRenderBytes: 10_000,
    });
    expect(file).toMatchObject({ text: "0123", size: 10, truncated: true });
  });

  it("reads the shared read-only roots the model itself may read", async () => {
    const cwd = await scratch("qa-ws-shared-cwd-");
    const shared = await scratch("qa-ws-shared-root-");
    await writeFile(join(shared, "corpus.md"), "# Corpus", "utf8");
    const file = await readWorkspaceFile({
      filePath: join(shared, "corpus.md"),
      cwd,
      sharedReadOnlyRoots: [shared],
      maxBytes: 10_000,
      maxMarkdownRenderBytes: 10_000,
    });
    expect(file.text).toBe("# Corpus");
  });

  it("refuses a file outside every readable root", async () => {
    const cwd = await scratch("qa-ws-readdeny-cwd-");
    const outside = await scratch("qa-ws-readdeny-out-");
    await writeFile(join(outside, "secret.txt"), "hidden", "utf8");
    expect(
      await refusalReason(() =>
        readWorkspaceFile({
          filePath: join(outside, "secret.txt"),
          cwd,
          maxBytes: 10_000,
          maxMarkdownRenderBytes: 10_000,
        }),
      ),
    ).toBe("outside-roots");
  });
});
