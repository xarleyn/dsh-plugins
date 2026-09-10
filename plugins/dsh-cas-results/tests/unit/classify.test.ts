/** Unit tests for classification, HTML text extraction, and MIME sniffing (SPEC §12, §18). */

import { describe, expect, it } from "vitest";

import { classifyText, sniffBinaryMediaType } from "../../src/transform/classify.js";
import { htmlToText } from "../../src/preview/html.js";

describe("classifyText", () => {
  it("recognizes HTML documents", () => {
    expect(classifyText("<!DOCTYPE html><html><body>x</body></html>")).toEqual({ kind: "html", mediaType: "text/html" });
    expect(classifyText("<html lang=\"en\">\n<head>")).toEqual({ kind: "html", mediaType: "text/html" });
  });

  it("recognizes log streams by level/timestamp density", () => {
    const log = Array.from({ length: 40 }, (_, index) =>
      `2026-08-30T18:42:00.000Z ${index % 5 === 0 ? "ERROR" : "INFO"} worker ${index}: message`,
    ).join("\n");
    expect(classifyText(log)).toEqual({ kind: "log", mediaType: "text/log" });
  });

  it("keeps ordinary text generic", () => {
    expect(classifyText("just a plain sentence")).toEqual({ kind: "text", mediaType: "text/plain" });
    expect(classifyText("a\nb\nc\nd\ne\nf")).toEqual({ kind: "text", mediaType: "text/plain" });
  });
});

describe("sniffBinaryMediaType", () => {
  it("detects common magic headers", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const gzip = Uint8Array.from([0x1f, 0x8b, 0x08, 0x00]);
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    expect(sniffBinaryMediaType(png)).toBe("image/png");
    expect(sniffBinaryMediaType(jpeg)).toBe("image/jpeg");
    expect(sniffBinaryMediaType(gzip)).toBe("application/gzip");
    expect(sniffBinaryMediaType(zip)).toBe("application/zip");
    expect(sniffBinaryMediaType(new TextEncoder().encode("plain"))).toBe("application/octet-stream");
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles, comments and tags", () => {
    const html = [
      "<html><head>",
      "<!-- hidden comment -->",
      "<style>body { color: red; }</style>",
      "<script>var evil = '</script>';</script>",
      "<title>Example Domain</title>",
      "</head><body>",
      "<h1>Hello &amp; welcome</h1>",
      "<p>First paragraph</p>",
      "<script>more()</script>",
      "</body></html>",
    ].join("\n");
    const text = htmlToText(html);
    expect(text).toContain("Hello & welcome");
    expect(text).toContain("First paragraph");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("hidden comment");
    expect(text).not.toContain("<h1>");
  });

  it("handles malformed HTML without throwing", () => {
    expect(() => htmlToText("<div><span>unclosed")).not.toThrow();
    expect(htmlToText("no markup at all")).toBe("no markup at all");
  });
});
