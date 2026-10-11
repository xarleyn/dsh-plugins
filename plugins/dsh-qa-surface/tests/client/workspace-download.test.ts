// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadWorkspaceFile,
  downloadWorkspacePath,
} from "../../src/client/workspace-download.js";
import type { QaWorkspaceFile } from "../../src/types.js";

afterEach(() => vi.restoreAllMocks());
const preview: QaWorkspaceFile = {
  path: "report.docx",
  size: 5,
  truncated: true,
  markdown: false,
  renderableMarkdown: false,
  mime: "application/octet-stream",
  base64: "AQI=",
};

describe("download bytes", () => {
  it("never saves a truncated preview", () => {
    expect(() => downloadWorkspaceFile(preview)).toThrow(/частично/u);
  });
  it("saves all chunks only after receiving a complete stable file", async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const read = vi.fn(async (offset: number) => ({
      ok: true as const,
      value: {
        path: "report.docx",
        size: 5,
        offset,
        version: "v1",
        base64: offset === 0 ? "AQI=" : "AwQF",
        done: offset !== 0,
      },
    }));
    await downloadWorkspacePath("report.docx", read);
    expect(read).toHaveBeenNthCalledWith(2, 2, "v1");
    expect(blob?.size).toBe(5);
  });
  it("does not save bytes when a later chunk refuses, changes version or ends early", async () => {
    URL.createObjectURL = vi.fn();
    for (const failure of [
      { ok: false as const, error: "refused" },
      {
        ok: true as const,
        value: {
          path: "report.docx",
          size: 5,
          offset: 2,
          version: "v2",
          base64: "AwQF",
          done: true,
        },
      },
      {
        ok: true as const,
        value: {
          path: "report.docx",
          size: 5,
          offset: 2,
          version: "v1",
          base64: "AwQ=",
          done: true,
        },
      },
    ]) {
      const read = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            path: "report.docx",
            size: 5,
            offset: 0,
            version: "v1",
            base64: "AQI=",
            done: false,
          },
        })
        .mockResolvedValueOnce(failure);
      await expect(
        downloadWorkspacePath("report.docx", read),
      ).rejects.toThrow();
    }
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
