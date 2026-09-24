import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DocumentsFace } from "@yadsh/dsh-documents";
import {
  attachmentPromptParts,
  isIntegrationDocumentMediaType,
  isIntegrationTextMediaType,
  safeAttachmentName,
  type QaAttachmentDependencies,
} from "../../src/integration/attachments.js";
import {
  QaIntegrationAttachmentError,
  type QaFileAttachment,
} from "../../src/integration/contract.js";

/**
 * Reading a caller's attachments into prompt text.
 *
 * The store and the parser are covered elsewhere; what is under test here is
 * the translation itself — a text file decoded, a document extracted through
 * the deployment's pipeline, a file that cannot be read refusing the request
 * instead of half-answering it — and the two properties that make the design
 * safe: nothing survives the extraction on disk, and a caller-supplied name
 * never escapes the temporary directory.
 */

/**
 * A switch the staging test flips, so one test can watch a Host whose
 * temporary directory cannot be written while every other test keeps the real
 * one. Hoisted because `vi.mock` runs before this module's own body.
 */
const staging = vi.hoisted(() => ({ fail: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: async (prefix: string) => {
      if (staging.fail) throw new Error("EACCES: permission denied");
      return await actual.mkdtemp(prefix);
    },
  };
});

function file(
  name: string,
  mediaType: string,
  content: string | Buffer,
): QaFileAttachment {
  return {
    kind: "file",
    mediaType,
    name,
    bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"),
  };
}

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {}, close() {} } as never;
}

/** A pipeline that records what it was asked to read and answers with text. */
function pipeline(
  markdown = "# Извлечённый текст\n\nПункт 1.",
  options: { readonly fail?: Error } = {},
): {
  readonly face: DocumentsFace;
  readonly calls: string[];
  readonly seen: (() => boolean)[];
  readonly directories: string[];
} {
  const calls: string[] = [];
  const seen: (() => boolean)[] = [];
  const directories: string[] = [];
  const face = {
    toMarkdown: async (input: { readonly file: string }) => {
      calls.push(input.file);
      directories.push(dirname(input.file));
      // The pipeline reads the file itself, so it has to be on disk right now.
      seen.push(() => existsSync(input.file));
      if (options.fail !== undefined) throw options.fail;
      return {
        artifactId: "artifact-1",
        markdown,
        markdownPath: `${input.file}.md`,
        backend: "mock",
        warnings: [],
        manifestPath: `${input.file}.json`,
      };
    },
    convert: vi.fn(),
    inspect: vi.fn(),
  } as unknown as DocumentsFace;
  return { face, calls, seen, directories };
}

function deps(
  documents: DocumentsFace | undefined,
  extra: Partial<QaAttachmentDependencies> = {},
): QaAttachmentDependencies {
  return {
    documents,
    sessionId: "session-1",
    signal: new AbortController().signal,
    logger: logger(),
    ...extra,
  };
}

function refusalReason(
  error: unknown,
): { readonly reason: string; readonly attachment: string } | undefined {
  return error instanceof QaIntegrationAttachmentError
    ? { reason: error.reason, attachment: error.attachment }
    : undefined;
}

describe("attachment media types", () => {
  it("treats plain text as text and PDF and OOXML as documents", () => {
    for (const media of ["text/plain", "text/csv", "text/markdown"]) {
      expect(isIntegrationTextMediaType(media)).toBe(true);
      expect(isIntegrationDocumentMediaType(media)).toBe(false);
    }
    for (const media of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]) {
      expect(isIntegrationDocumentMediaType(media)).toBe(true);
      expect(isIntegrationTextMediaType(media)).toBe(false);
    }
    expect(isIntegrationTextMediaType("image/png")).toBe(false);
    expect(isIntegrationDocumentMediaType("application/zip")).toBe(false);
  });

  it("reduces a caller-supplied name to a label", () => {
    expect(safeAttachmentName("../../etc/passwd", "text/plain")).toBe("passwd");
    expect(safeAttachmentName("C:\\temp\\отчёт.csv", "text/csv")).toBe(
      "отчёт.csv",
    );
    expect(safeAttachmentName("..\\..\\x.docx", "application/pdf")).toBe(
      "x.docx",
    );
    expect(safeAttachmentName("", "text/csv")).toBe("attachment.csv");
    expect(safeAttachmentName(".", "text/plain")).toBe("attachment.plain");
    expect(safeAttachmentName("a".repeat(400), "text/plain")).toHaveLength(120);
    expect(safeAttachmentName("bad\u0000name.txt", "text/plain")).toBe(
      "badname.txt",
    );
  });
});

describe("attachment prompt parts", () => {
  it("decodes a text file into one headed block", async () => {
    const parts = await attachmentPromptParts(
      [file("table.csv", "text/csv", "a;b\n1;2\n")],
      deps(undefined),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("text");
    const text = parts[0]?.type === "text" ? parts[0].text : "";
    expect(text).toContain("--- table.csv (text/csv, 8 Б) ---");
    expect(text).toContain("a;b\n1;2");
  });

  it("refuses bytes a caller labelled as text", async () => {
    let thrown: unknown;
    try {
      await attachmentPromptParts(
        [file("fake.txt", "text/plain", Buffer.from([0x50, 0x00, 0x4b, 0x03]))],
        deps(undefined),
      );
    } catch (error) {
      thrown = error;
    }
    expect(refusalReason(thrown)).toEqual({
      reason: "unsupported",
      attachment: "fake.txt",
    });
  });

  it("extracts a document through the deployment's pipeline", async () => {
    const mock = pipeline("## Ответ\n\nСрок — 30 дней.");
    const parts = await attachmentPromptParts(
      [file("Договор.pdf", "application/pdf", "%PDF-1.4 fake")],
      deps(mock.face),
    );
    expect(mock.calls).toHaveLength(1);
    // The pipeline got a real file, in a directory of its own.
    expect(mock.calls[0]).toContain("Договор.pdf");
    expect(parts).toHaveLength(1);
    const text = parts[0]?.type === "text" ? parts[0].text : "";
    expect(text).toContain("--- Договор.pdf (application/pdf, 13 Б) ---");
    expect(text).toContain("Срок — 30 дней.");
  });

  it("leaves nothing behind, whether the extraction worked or not", async () => {
    const working = pipeline();
    await attachmentPromptParts(
      [file("doc.docx", "application/pdf", "bytes")],
      deps(working.face),
    );
    const failing = pipeline("", { fail: new Error("backend down") });
    await expect(
      attachmentPromptParts(
        [file("doc.docx", "application/pdf", "bytes")],
        deps(failing.face),
      ),
    ).rejects.toBeInstanceOf(QaIntegrationAttachmentError);
    for (const directory of [...working.directories, ...failing.directories]) {
      expect(existsSync(directory)).toBe(false);
      expect(existsSync(`${directory}/doc.docx`)).toBe(false);
    }
  });

  it("refuses a document the deployment cannot read, with the reason in the log", async () => {
    const warn = vi.fn();
    const mock = pipeline("", { fail: new Error("unsupported format") });
    let thrown: unknown;
    try {
      await attachmentPromptParts(
        [
          file(
            "book.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "x",
          ),
        ],
        deps(mock.face, { logger: { warn } as never }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(refusalReason(thrown)?.reason).toBe("unsupported");
    expect(warn).toHaveBeenCalledWith(
      "integration.attachment-unreadable",
      expect.objectContaining({ name: "book.xlsx" }),
    );
  });

  it("refuses a document when the deployment has no pipeline at all", async () => {
    let thrown: unknown;
    try {
      await attachmentPromptParts(
        [file("scan.pdf", "application/pdf", "%PDF")],
        deps(undefined),
      );
    } catch (error) {
      thrown = error;
    }
    expect(refusalReason(thrown)).toEqual({
      reason: "unavailable",
      attachment: "scan.pdf",
    });
  });

  it("refuses the request when the staging directory cannot be created", async () => {
    // A Host whose temporary directory is unwritable cannot read the
    // attachment either — the caller's own answer is to repeat the question
    // without it, not a 5xx it would retry against the same broken directory.
    const warn = vi.fn();
    staging.fail = true;
    let thrown: unknown;
    try {
      await attachmentPromptParts(
        [file("scan.pdf", "application/pdf", "%PDF")],
        deps(pipeline().face, { logger: { warn } as never }),
      );
    } catch (error) {
      thrown = error;
    } finally {
      staging.fail = false;
    }
    expect(refusalReason(thrown)).toEqual({
      reason: "unavailable",
      attachment: "scan.pdf",
    });
    expect(warn).toHaveBeenCalledWith(
      "integration.attachment-unreadable",
      expect.objectContaining({ name: "scan.pdf" }),
    );
  });

  it("keeps every attachment inside the total text budget", async () => {
    const parts = await attachmentPromptParts(
      [
        file("first.txt", "text/plain", "а".repeat(200)),
        file("second.txt", "text/plain", "б".repeat(200)),
      ],
      deps(undefined, { maxChars: 100 }),
    );
    // One attachment spends the budget; the rest is a note, not silence.
    expect(parts).toHaveLength(2);
    const first = parts[0]?.type === "text" ? parts[0].text : "";
    expect(first).toContain("…");
    expect(first).toContain("[…текст сокращён, показано начало файла]");
    const second = parts[1]?.type === "text" ? parts[1].text : "";
    expect(second).toContain("1 вложений не показано");
  });

  it("answers with no parts when the request carries no files", async () => {
    await expect(attachmentPromptParts([], deps(undefined))).resolves.toEqual(
      [],
    );
  });
});
