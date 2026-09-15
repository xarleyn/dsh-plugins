// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  attachmentAccept,
  acceptsTextFile,
  attachmentLimits,
  draftFromFile,
  draftFromPaste,
  formatFileSize,
  type QaAttachmentLimits,
} from "../src/client/attachments.js";
import {
  countTextLines,
  hasTextExtension,
  normalizeTextExtensions,
} from "../src/attachment-rules.js";
import { resolveConfig } from "../src/resolve-config.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "./helpers/attachments.js";

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
    expect(hasTextExtension("NOTES.MD", LIMITS.extensions)).toBe(true);
    expect(hasTextExtension(".gitignore", LIMITS.extensions)).toBe(false);
    expect(hasTextExtension("archive.tar.gz", LIMITS.extensions)).toBe(false);
    expect(hasTextExtension("noextension", LIMITS.extensions)).toBe(false);
  });

  it("normalizes an operator extension list", () => {
    expect(
      normalizeTextExtensions([".MD", "TXT", "md", "", "a b", "x!"]),
    ).toEqual(["md", "txt"]);
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

  it("accepts a listed extension or a browser-reported text type", () => {
    expect(acceptsTextFile("notes.md", "", LIMITS)).toBe(true);
    expect(acceptsTextFile("weird.bin", "text/plain", LIMITS)).toBe(true);
    expect(acceptsTextFile("weird.bin", "application/zip", LIMITS)).toBe(false);
    expect(acceptsTextFile("notes.md", "", limits({ textFiles: false }))).toBe(
      false,
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
