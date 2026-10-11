import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWorkspaceFileChunk,
  QA_DOWNLOAD_CHUNK_BYTES,
} from "../../src/provenance/file-download.js";

const roots: string[] = [];
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "qa-download-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("complete workspace download", () => {
  it("reassembles a binary larger than the preview cap without dropping bytes", async () => {
    const cwd = await workspace();
    const original = Buffer.alloc(2_400_003);
    for (let i = 0; i < original.length; i += 1) original[i] = i % 251;
    await writeFile(join(cwd, "report.docx"), original);
    const parts: Buffer[] = [];
    let offset = 0;
    let version: string | null = null;
    while (true) {
      const chunk = await readWorkspaceFileChunk({
        cwd,
        filePath: "report.docx",
        offset,
        version,
      });
      const bytes = Buffer.from(chunk.base64, "base64");
      expect(bytes.length).toBeLessThanOrEqual(QA_DOWNLOAD_CHUNK_BYTES);
      expect(chunk.offset).toBe(offset);
      expect(chunk.size).toBe(original.length);
      parts.push(bytes);
      offset += bytes.length;
      version = chunk.version;
      if (chunk.done) break;
    }
    const downloaded = Buffer.concat(parts);
    expect(downloaded.length).toBe(original.length);
    expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
      createHash("sha256").update(original).digest("hex"),
    );
  });

  it("refuses a changed file and invalid offsets rather than mixing versions", async () => {
    const cwd = await workspace();
    const filePath = "report.docx";
    await writeFile(join(cwd, filePath), Buffer.alloc(600_000));
    const first = await readWorkspaceFileChunk({
      cwd,
      filePath,
      offset: 0,
      version: null,
    });
    await writeFile(join(cwd, filePath), Buffer.alloc(600_001, 1));
    await expect(
      readWorkspaceFileChunk({
        cwd,
        filePath,
        offset: QA_DOWNLOAD_CHUNK_BYTES,
        version: first.version,
      }),
    ).rejects.toThrow();
    for (const offset of [-1, 0.5, 700_000, Number.NaN]) {
      await expect(
        readWorkspaceFileChunk({ cwd, filePath, offset, version: null }),
      ).rejects.toThrow();
    }
  });

  it("does not grant access to another user's directory or a symlink outside the root", async () => {
    const cwd = await workspace();
    const other = await workspace();
    await writeFile(join(other, "private.docx"), Buffer.from("private"));
    await expect(
      readWorkspaceFileChunk({
        cwd,
        filePath: join(other, "private.docx"),
        offset: 0,
        version: null,
      }),
    ).rejects.toThrow();
    try {
      await symlink(join(other, "private.docx"), join(cwd, "link.docx"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(
      readWorkspaceFileChunk({
        cwd,
        filePath: "link.docx",
        offset: 0,
        version: null,
      }),
    ).rejects.toThrow();
  });

  it("downloads an empty file as one completed chunk", async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, "empty.md"), "");
    expect(
      await readWorkspaceFileChunk({
        cwd,
        filePath: "empty.md",
        offset: 0,
        version: null,
      }),
    ).toMatchObject({ size: 0, base64: "", done: true });
  });
});
