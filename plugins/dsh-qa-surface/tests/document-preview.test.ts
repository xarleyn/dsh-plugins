import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import { QaSourcePreviewError } from "../src/provenance/file-preview.js";
import { previewConvertibleDocument } from "../src/provenance/document-preview.js";

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

/** The refusal reason of one failed preview, or null when it succeeded. */
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

/** A document pipeline face that renders the PDF the test prepared. */
function faceWriting(pdfPath: string): DocumentsFace {
  return {
    convert: vi.fn(async () => ({
      artifactId: "doc_test",
      files: [
        {
          format: "pdf" as const,
          path: pdfPath,
          mediaType: "application/pdf",
          size: 8,
          sha256: "0".repeat(64),
          status: "created" as const,
        },
      ],
      source: { path: pdfPath, format: "docx" as const },
      warnings: [],
      manifestPath: join(pdfPath, "..", "manifest.json"),
    })),
    toMarkdown: vi.fn(),
    inspect: vi.fn(),
  } as unknown as DocumentsFace;
}

describe("workspace document preview", () => {
  it("renders a Word document through the pipeline and returns the PDF bytes", async () => {
    const cwd = await scratch("qa-docpreview-");
    await writeFile(
      join(cwd, "report.docx"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    const pdfPath = join(cwd, "report.pdf");
    await writeFile(pdfPath, "%PDF-1.4", "utf8");
    const face = faceWriting(pdfPath);
    const preview = await previewConvertibleDocument({
      filePath: "report.docx",
      cwd,
      documents: () => face,
      sessionId: "session-1",
      maxBytes: 10_000,
    });
    // The panel keeps naming the document the visitor opened, not the PDF the
    // pipeline rendered beside it.
    expect(preview).toMatchObject({
      kind: "pdf",
      mime: "application/pdf",
      name: "report.docx",
      bytes: 8,
    });
    expect(Buffer.from(preview.base64, "base64").toString("utf8")).toBe(
      "%PDF-1.4",
    );
    expect(face.convert).toHaveBeenCalledWith(
      expect.objectContaining({ targetFormat: "pdf" }),
      { workspaceRoot: cwd, sessionId: "session-1" },
    );
  });

  it("refuses when the deployment has no document pipeline", async () => {
    const cwd = await scratch("qa-docpreview-none-");
    await writeFile(
      join(cwd, "report.docx"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(
      await refusalReason(() =>
        previewConvertibleDocument({
          filePath: "report.docx",
          cwd,
          documents: () => undefined,
          sessionId: "session-1",
          maxBytes: 10_000,
        }),
      ),
    ).toBe("unsupported");
  });

  it("refuses a file outside the readable roots before asking the pipeline", async () => {
    const cwd = await scratch("qa-docpreview-cwd-");
    const outside = await scratch("qa-docpreview-out-");
    await writeFile(join(outside, "report.docx"), Buffer.from([0x50, 0x4b]));
    const face = faceWriting(join(outside, "report.pdf"));
    expect(
      await refusalReason(() =>
        previewConvertibleDocument({
          filePath: join(outside, "report.docx"),
          cwd,
          documents: () => face,
          sessionId: "session-1",
          maxBytes: 10_000,
        }),
      ),
    ).toBe("outside-roots");
    expect(face.convert).not.toHaveBeenCalled();
  });

  it("refuses a format the pipeline cannot render rather than guessing", async () => {
    const cwd = await scratch("qa-docpreview-format-");
    await mkdir(join(cwd, "nested"));
    await writeFile(join(cwd, "nested", "notes.txt"), "text", "utf8");
    const face = faceWriting(join(cwd, "notes.pdf"));
    expect(
      await refusalReason(() =>
        previewConvertibleDocument({
          filePath: "nested/notes.txt",
          cwd,
          documents: () => face,
          sessionId: "session-1",
          maxBytes: 10_000,
        }),
      ),
    ).toBe("unsupported");
    expect(face.convert).not.toHaveBeenCalled();
  });

  it("refuses honestly when the pipeline itself fails", async () => {
    const cwd = await scratch("qa-docpreview-fail-");
    await writeFile(join(cwd, "report.docx"), Buffer.from([0x50, 0x4b]));
    const face = {
      convert: vi.fn(async () => {
        throw new Error("BACKEND_UNAVAILABLE: no office backend");
      }),
      toMarkdown: vi.fn(),
      inspect: vi.fn(),
    } as unknown as DocumentsFace;
    expect(
      await refusalReason(() =>
        previewConvertibleDocument({
          filePath: "report.docx",
          cwd,
          documents: () => face,
          sessionId: "session-1",
          maxBytes: 10_000,
        }),
      ),
    ).toBe("unsupported");
  });

  it("refuses a PDF larger than the preview budget", async () => {
    const cwd = await scratch("qa-docpreview-big-");
    await writeFile(join(cwd, "report.docx"), Buffer.from([0x50, 0x4b]));
    const pdfPath = join(cwd, "report.pdf");
    await writeFile(pdfPath, "x".repeat(64), "utf8");
    expect(
      await refusalReason(() =>
        previewConvertibleDocument({
          filePath: "report.docx",
          cwd,
          documents: () => faceWriting(pdfPath),
          sessionId: "session-1",
          maxBytes: 16,
        }),
      ),
    ).toBe("unsupported");
  });
});
