// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  attachmentAccept,
  acceptsFileAttachment,
  attachmentLimits,
  draftFromFile,
  draftFromPaste,
  fileAttachmentRefusal,
  formatFileSize,
  type QaAttachmentLimits,
} from "../../src/client/attachments.js";
import {
  countTextLines,
  DEFAULT_QA_ATTACHMENT_EXTENSIONS,
  fileExtensionOf,
  hasAcceptedExtension,
  normalizeAcceptedExtensions,
} from "../../src/attachment-rules.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../helpers/attachments.js";

const LIMITS = DEFAULT_ATTACHMENT_LIMITS;

function limits(overrides: Partial<QaAttachmentLimits>): QaAttachmentLimits {
  return { ...LIMITS, ...overrides };
}

describe("attachment rules", () => {
  it("counts lines the way a reader does", () => {
    expect(countTextLines("")).toBe(0);
    expect(countTextLines("one")).toBe(1);
    expect(countTextLines("one\n")).toBe(1);
    expect(countTextLines("one\ntwo")).toBe(2);
    expect(countTextLines("one\r\ntwo\r\n")).toBe(2);
    expect(countTextLines("one\n\n")).toBe(2);
  });

  it("matches extensions case-insensitively and tolerates dotfiles", () => {
    expect(hasAcceptedExtension("NOTES.MD", LIMITS.extensions)).toBe(true);
    expect(hasAcceptedExtension(".gitignore", LIMITS.extensions)).toBe(false);
    expect(hasAcceptedExtension("archive.tar.gz", LIMITS.extensions)).toBe(
      false,
    );
    expect(hasAcceptedExtension("noextension", LIMITS.extensions)).toBe(false);
  });

  it("reads the extension off a file name", () => {
    expect(fileExtensionOf("spec.DOCX")).toBe("docx");
    expect(fileExtensionOf("archive.tar.gz")).toBe("gz");
    expect(fileExtensionOf("noextension")).toBe("noextension");
    expect(fileExtensionOf(".gitignore")).toBe(".gitignore");
  });

  it("normalizes an operator extension list", () => {
    expect(
      normalizeAcceptedExtensions([".MD", "TXT", "md", "", "a b", "x!"]),
    ).toEqual(["md", "txt"]);
  });

  it("accepts the documents the stand can read, not only text files", () => {
    expect(DEFAULT_QA_ATTACHMENT_EXTENSIONS).toContain("docx");
    expect(DEFAULT_QA_ATTACHMENT_EXTENSIONS).toContain("pdf");
    expect(DEFAULT_QA_ATTACHMENT_EXTENSIONS).toContain("md");
  });
});

describe("composer attachment intake", () => {
  it("reads its policy off the resolved configuration", () => {
    const resolved = resolveConfig({
      attachments: { pastedTextLines: 50, maxPending: 3 },
    });
    expect(attachmentLimits(resolved)).toEqual({
      textFiles: true,
      pastedTextLines: 50,
      maxFileBytes: 10_485_760,
      maxPending: 3,
      extensions: resolved.attachments.extensions,
    });
  });

  it("offers the raster formats plus the configured extensions", () => {
    const accept = attachmentAccept(limits({ extensions: ["md", "txt"] }));
    expect(accept).toContain("image/png");
    expect(accept).toContain("text/*");
    expect(accept).toContain(".md");
    expect(attachmentAccept(limits({ textFiles: false }))).not.toContain(
      "text/*",
    );
  });

  it("offers a configured document in the picker", () => {
    const accept = attachmentAccept(limits({ extensions: ["md", "docx"] }));
    expect(accept).toContain(".docx");
  });

  it("accepts a listed extension or a browser-reported text type", () => {
    expect(acceptsFileAttachment("notes.md", "", LIMITS)).toBe(true);
    expect(acceptsFileAttachment("weird.bin", "text/plain", LIMITS)).toBe(true);
    expect(acceptsFileAttachment("weird.bin", "application/zip", LIMITS)).toBe(
      false,
    );
    expect(
      acceptsFileAttachment("notes.md", "", limits({ textFiles: false })),
    ).toBe(false);
  });

  const DOCX_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  it("takes a Word document whose extension the stand allows", async () => {
    const spec = new File(["docx-bytes"], "spec.docx", { type: DOCX_MIME });
    const draft = await draftFromFile(
      spec,
      limits({ extensions: ["md", "docx"] }),
    );
    expect(draft).toMatchObject({ kind: "file", name: "spec.docx" });
    expect(
      fileAttachmentRefusal(
        "spec.docx",
        DOCX_MIME,
        limits({ extensions: ["docx"] }),
      ),
    ).toBeNull();
  });

  it("names the refused extension instead of a fixed list", async () => {
    const spec = new File(["docx-bytes"], "spec.docx", { type: DOCX_MIME });
    const message = await draftFromFile(
      spec,
      limits({ extensions: ["md", "txt"] }),
    );
    expect(message).toContain(".docx");
    expect(message).toContain("оператор");
    expect(message).not.toContain("md, txt, log");
  });

  it("says so when file attachments are off", () => {
    expect(
      fileAttachmentRefusal(
        "spec.docx",
        DOCX_MIME,
        limits({ textFiles: false }),
      ),
    ).toContain("выключены");
  });

  it("refuses a file without an extension on its own terms", () => {
    expect(fileAttachmentRefusal("noextension", "", LIMITS)).toContain(
      "нет расширения",
    );
  });

  it("builds an image draft for a raster file", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });
    const draft = await draftFromFile(png, LIMITS);
    expect(draft).toMatchObject({ kind: "image", name: "shot.png" });
  });

  it("refuses an oversized image before it reaches the Host", async () => {
    const huge = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "huge.png", {
      type: "image/png",
    });
    expect(await draftFromFile(huge, LIMITS)).toContain("15 МБ");
  });

  it("builds a file draft and refuses one over the byte ceiling", async () => {
    const note = new File(["hello"], "note.log", { type: "" });
    expect(await draftFromFile(note, LIMITS)).toMatchObject({
      kind: "file",
      name: "note.log",
      bytes: 5,
    });
    const big = new File(["x".repeat(2048)], "big.log", { type: "" });
    expect(await draftFromFile(big, limits({ maxFileBytes: 1024 }))).toContain(
      "1 КБ",
    );
  });

  it("converts a paste only above a strictly positive threshold", () => {
    const long = Array.from({ length: 201 }, () => "x").join("\n");
    const draft = draftFromPaste(long, LIMITS);
    expect(draft).toMatchObject({
      kind: "file",
      name: "Вставленный текст (201 строка).txt",
    });
    expect(
      draftFromPaste(Array.from({ length: 200 }, () => "x").join("\n"), LIMITS),
    ).toBeNull();
    expect(draftFromPaste(long, limits({ pastedTextLines: 0 }))).toBeNull();
    expect(draftFromPaste(long, limits({ textFiles: false }))).toBeNull();
  });

  it("formats sizes for the card and the chip", () => {
    expect(formatFileSize(512)).toBe("512 Б");
    expect(formatFileSize(2048)).toBe("2 КБ");
    expect(formatFileSize(19_456)).toBe("19 КБ");
    expect(formatFileSize(10_485_760)).toBe("10 МБ");
  });
});
