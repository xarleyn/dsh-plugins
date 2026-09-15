/**
 * Security tests for the document pipeline: path containment, filename
 * hygiene, file-type identification and asset policy (§26, §32, §48.4).
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DocumentError,
  sanitizeBackendOutput,
} from "../src/documents/errors.js";
import {
  assertInsideRoot,
  assertRelativeAssetReference,
  canonicalizeForContainment,
  isInsideRoot,
  resolveInsideRoot,
  sanitizeFilename,
} from "../src/documents/security/paths.js";
import {
  detectFormatByExtension,
  describeUnsupported,
  isAllowedAssetMimeType,
  mimeTypeOfBytes,
  sniffDocument,
  supportedFormatOf,
  DEFAULT_ASSET_MIME_TYPES,
} from "../src/documents/security/file-types.js";
import {
  createSemaphore,
  assertBytesWithinBudget,
} from "../src/documents/security/limits.js";
import { applyDirectives } from "../src/documents/markdown/directives.js";
import { docxBytes, pdfBytes, pngBytes } from "./helpers/document-fixtures.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "qa-documents-sec-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("path containment", () => {
  test("accepts descendants and the root itself", () => {
    expect(isInsideRoot("/srv/a", "/srv/a/b")).toBe(true);
    expect(isInsideRoot("/srv/a", "/srv/a")).toBe(true);
    expect(isInsideRoot("/srv/a", "/srv/b")).toBe(false);
    expect(isInsideRoot("/srv/a", "/srv/ab/c")).toBe(false);
  });

  test("refuses traversal, absolute escapes and file URLs", async () => {
    await expect(
      resolveInsideRoot(root, "../../etc/passwd", "file"),
    ).rejects.toThrow(/outside the allowed document scope|leaves/u);
    await expect(
      resolveInsideRoot(root, "/etc/passwd", "file"),
    ).rejects.toThrow(DocumentError);
    await expect(
      resolveInsideRoot(root, "file:///etc/passwd", "file"),
    ).rejects.toThrow(/not a file URL/u);
  });

  test("refuses a symlink that points outside the root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "qa-documents-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    try {
      await symlink(outside, path.join(root, "escape"), "dir").catch(
        () => undefined,
      );
      const target = path.join(root, "escape", "secret.txt");
      if (
        !(await canonicalizeForContainment(target)).startsWith(
          await canonicalizeForContainment(root),
        )
      ) {
        await expect(
          resolveInsideRoot(root, "escape/secret.txt", "file"),
        ).rejects.toThrow(/outside the allowed document scope/u);
      }
      const canonicalRoot = await canonicalizeForContainment(root);
      expect(() =>
        assertInsideRoot(
          canonicalRoot,
          path.resolve(root, "../outside"),
          "file",
        ),
      ).toThrow(DocumentError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("canonicalizes a path that does not exist yet", async () => {
    const canonical = await canonicalizeForContainment(
      path.join(root, "new", "file.txt"),
    );
    expect(canonical.endsWith(path.join("new", "file.txt"))).toBe(true);
  });

  test("asset references must stay relative to the assets directory", () => {
    expect(assertRelativeAssetReference("assets/shot.png")).toBe(
      "assets/shot.png",
    );
    expect(assertRelativeAssetReference("shot.png")).toBe("shot.png");
    for (const bad of [
      "/etc/passwd",
      "../../x.png",
      "https://x/y.png",
      "data:image/png;base64,AA",
      "\\\\server\\share\\x.png",
    ]) {
      expect(() => assertRelativeAssetReference(bad)).toThrow(DocumentError);
    }
  });
});

describe("filename hygiene", () => {
  test("sanitizes the documented example", () => {
    expect(
      sanitizeFilename("../../foo report?.docx", "fallback", ".docx"),
    ).toBe("foo-report.docx");
  });

  test("keeps a Cyrillic stem and drops separators", () => {
    expect(sanitizeFilename("  Отчёт по прогону  ", "fallback", ".pdf")).toBe(
      "Отчёт-по-прогону.pdf",
    );
    expect(sanitizeFilename("a\\b/c.docx", "fallback", ".docx")).toBe("c.docx");
  });

  test("falls back when nothing usable is left", () => {
    expect(sanitizeFilename(undefined, "document-01abc", ".docx")).toBe(
      "document-01abc.docx",
    );
    expect(sanitizeFilename("...", "document-01abc", ".pdf")).toBe(
      "document-01abc.pdf",
    );
    expect(sanitizeFilename("x", "stem", "")).toBe("x");
  });

  test("caps an absurdly long name", () => {
    const long = "a".repeat(500);
    expect(sanitizeFilename(long, "stem", ".docx").length).toBeLessThanOrEqual(
      85,
    );
  });
});

describe("file-type identification", () => {
  test("recognizes a DOCX by its container, not its name", () => {
    const sniffed = sniffDocument(
      docxBytes({ headings: ["H"] }),
      "report.docx",
    );
    expect(sniffed.format).toBe("docx");
    expect(sniffed.wordprocessing).toBe(true);
    expect(supportedFormatOf(sniffed)).toBe("docx");
  });

  test("flags a macro-enabled document", () => {
    const sniffed = sniffDocument(
      docxBytes({ macroEnabled: true }),
      "report.docm",
    );
    expect(sniffed.format).toBe("docm");
    expect(sniffed.macroEnabled).toBe(true);
    expect(supportedFormatOf(sniffed)).toBeUndefined();
    expect(describeUnsupported(sniffed, "report.docm")).toMatch(
      /macro-enabled/u,
    );
  });

  test("does not trust a fake extension", () => {
    const sniffed = sniffDocument(
      Buffer.from("plain text", "utf8"),
      "report.pdf",
    );
    expect(sniffed.format).toBe("unknown");
    expect(supportedFormatOf(sniffed)).toBeUndefined();
  });

  test("recognizes a PDF despite leading junk", () => {
    const junk = Buffer.concat([Buffer.from("PROLOGUE\n", "utf8"), pdfBytes()]);
    expect(sniffDocument(junk, "x.pdf").format).toBe("pdf");
  });

  test("recognizes Markdown text and legacy OLE documents", () => {
    expect(
      sniffDocument(Buffer.from("# Title\n", "utf8"), "notes.md").format,
    ).toBe("markdown");
    const ole = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
    ]);
    const sniffed = sniffDocument(ole, "legacy.doc");
    expect(supportedFormatOf(sniffed)).toBeUndefined();
    expect(describeUnsupported(sniffed, "legacy.doc")).toMatch(/legacy OLE/u);
  });

  test("an OOXML package of another flavour is refused, not guessed", () => {
    const sniffed = sniffDocument(
      docxBytes({ headings: ["x"] }).subarray(0, 400),
      "x.docx",
    );
    expect(supportedFormatOf(sniffed)).toBeUndefined();
  });

  test("extension detection covers the documented formats", () => {
    expect(detectFormatByExtension("a.PDF")).toBe("pdf");
    expect(detectFormatByExtension("a.docx")).toBe("docx");
    expect(detectFormatByExtension("a.markdown")).toBe("md");
    expect(detectFormatByExtension("a.xlsx")).toBeUndefined();
  });

  test("asset MIME policy is an allow-list", () => {
    expect(mimeTypeOfBytes(pngBytes())).toBe("image/png");
    expect(isAllowedAssetMimeType("IMAGE/PNG", DEFAULT_ASSET_MIME_TYPES)).toBe(
      true,
    );
    expect(
      isAllowedAssetMimeType("image/svg+xml", DEFAULT_ASSET_MIME_TYPES),
    ).toBe(false);
    expect(
      isAllowedAssetMimeType("application/zip", DEFAULT_ASSET_MIME_TYPES),
    ).toBe(false);
  });
});

describe("limits", () => {
  test("refuses oversized input with a stable code", () => {
    try {
      assertBytesWithinBudget(200, 100, "file");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError);
      expect((error as DocumentError).code).toBe("INPUT_TOO_LARGE");
    }
  });

  test("semaphore caps concurrency and releases on failure", async () => {
    const semaphore = createSemaphore(1);
    const release = await semaphore.acquire();
    expect(semaphore.inUse).toBe(1);
    let second = false;
    const pending = semaphore.acquire().then((releaseSecond) => {
      second = true;
      releaseSecond();
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(second).toBe(false);
    release();
    await pending;
    expect(second).toBe(true);
    expect(semaphore.inUse).toBe(0);
  });

  test("an aborted waiter leaves the queue without consuming a slot", async () => {
    const semaphore = createSemaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const pending = semaphore.acquire(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(DocumentError);
    release();
    expect(semaphore.inUse).toBe(0);
    const releaseAgain = await semaphore.acquire();
    releaseAgain();
  });
});

describe("error sanitization", () => {
  test("strips escapes, control characters and absolute paths", () => {
    const raw =
      "\u001B[31merror\u001B[0m in /tmp/qa-documents/job-1/output.docx\r\nsecond line\u0000";
    const clean = sanitizeBackendOutput(raw);
    expect(clean).not.toContain("\u001B");
    expect(clean).not.toContain("\u0000");
    expect(clean).not.toContain("/tmp/qa-documents");
    expect(clean).toContain("<path>");
    expect(clean).toContain("second line");
  });

  test("keeps ordinary prose intact and caps the length", () => {
    expect(
      sanitizeBackendOutput("cannot open the file and/or the stream"),
    ).toBe("cannot open the file and/or the stream");
    expect(sanitizeBackendOutput("x".repeat(10), 4)).toHaveLength(5);
  });
});

describe("directives", () => {
  test("rewrites a page break for the DOCX backend", () => {
    const result = applyDirectives("before\n\n:::pagebreak\n:::\n\nafter\n", {
      backend: "docx",
      allowRawMarkup: false,
    });
    expect(result.markdown).toContain("{=openxml}");
    expect(result.markdown).not.toContain(":::pagebreak");
  });

  test("rewrites a page break for the Typst backend", () => {
    const result = applyDirectives(":::pagebreak\n:::\n", {
      backend: "typst",
      allowRawMarkup: false,
    });
    expect(result.markdown).toContain("#pagebreak()");
  });

  test("turns a note into a labelled block", () => {
    const result = applyDirectives(":::note\nCareful.\n:::\n", {
      backend: "docx",
      allowRawMarkup: false,
    });
    expect(result.markdown).toContain("> **Note.** Careful.");
  });

  test("refuses unknown, unclosed and nested directives", () => {
    const base = { backend: "docx" as const, allowRawMarkup: false };
    expect(() => applyDirectives(":::video\nx\n:::\n", base)).toThrow(
      /unsupported document directive/u,
    );
    expect(() => applyDirectives(":::note\nnever closed\n", base)).toThrow(
      /never closed/u,
    );
    expect(() =>
      applyDirectives(":::note\n:::info\nx\n:::\n:::\n", base),
    ).toThrow(/nested/u);
    expect(() =>
      applyDirectives(":::pagebreak\nwith a body\n:::\n", base),
    ).toThrow(/takes no body/u);
  });

  test("leaves directive-looking text inside a code fence alone", () => {
    const source = "```\n:::pagebreak\n```\n";
    expect(
      applyDirectives(source, { backend: "docx", allowRawMarkup: false })
        .markdown,
    ).toBe(source);
  });

  test("refuses raw markup unless the deployment opts in", () => {
    const html = "# Title\n\n<script>alert(1)</script>\n";
    expect(() =>
      applyDirectives(html, { backend: "docx", allowRawMarkup: false }),
    ).toThrow(/raw markup/u);
    expect(
      applyDirectives(html, { backend: "docx", allowRawMarkup: true }).markdown,
    ).toContain("<script>");
    expect(() =>
      applyDirectives("\\input{/etc/passwd}\n", {
        backend: "docx",
        allowRawMarkup: false,
      }),
    ).toThrow(/LaTeX/u);
    expect(() =>
      applyDirectives('#import "other.typ"\n', {
        backend: "typst",
        allowRawMarkup: false,
      }),
    ).toThrow(/Typst/u);
  });
});

describe("artifact-free path helpers", () => {
  test("mkdir-free canonicalization never throws for a deep missing tree", async () => {
    const deep = path.join(root, "a", "b", "c", "d", "file.txt");
    await mkdir(path.join(root, "a"), { recursive: true });
    const canonical = await canonicalizeForContainment(deep);
    expect(canonical.replace(/\\/gu, "/")).toContain("a/b/c/d/file.txt");
  });
});
