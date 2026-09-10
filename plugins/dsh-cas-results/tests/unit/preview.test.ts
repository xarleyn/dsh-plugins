/** Unit tests for deterministic preview generation and markers (SPEC §18-§19). */

import { describe, expect, it } from "vitest";

import { buildPreviewBody } from "../../src/preview/index.js";
import { previewHtml } from "../../src/preview/html.js";
import { previewLog } from "../../src/preview/log.js";
import { previewText } from "../../src/preview/text.js";
import { buildBinaryMarker, formatBytes, formatMarkerHeader, formatRetrieveHint, isCasMarkerText } from "../../src/transform/marker.js";
import { makeLog } from "../fixtures/store-fixtures.js";

const OPTIONS = { maxChars: 2_048, keepHeadLines: 10, keepTailLines: 12, keepPatterns: ["error", "exception"] };

describe("previewText", () => {
  it("keeps head and tail lines with an omission marker", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index} ${"x".repeat(30)}`);
    const body = previewText(lines.join("\n"), OPTIONS).body;
    expect(body).toContain("line 0 ");
    expect(body).toContain("line 9 ");
    expect(body).toContain("line 399");
    expect(body).toContain("lines omitted");
    expect(body).not.toContain("line 200 ");
  });

  it("bounds huge single lines to the character budget", () => {
    const body = previewText("z".repeat(100_000), OPTIONS).body;
    expect(body.length).toBeLessThanOrEqual(OPTIONS.maxChars + 2);
    expect(body.endsWith("…")).toBe(true);
  });

  it("preserves Unicode and CRLF boundaries deterministically", () => {
    const value = "emoji 🚀 line";
    const first = previewText(`${value}\n${"filler\n".repeat(80)}tail 🏁`, OPTIONS).body;
    const second = previewText(`${value}\n${"filler\n".repeat(80)}tail 🏁`, OPTIONS).body;
    expect(first).toBe(second);
  });
});

describe("previewLog", () => {
  it("retains error lines from the middle of a large log (SPEC §31)", () => {
    const lines: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      lines.push(index === 200 ? "ERROR: unrecoverable state in worker-7" : `2026-08-30T18:00:00.000Z INFO ok ${index}`);
    }
    const body = previewLog(lines.join("\n"), OPTIONS).body;
    expect(body).toContain("ERROR: unrecoverable state in worker-7");
    expect(body).toContain("lines omitted");
  });

  it("stays within the configured budget", () => {
    const body = previewLog(makeLog(300_000), OPTIONS).body;
    expect(body.length).toBeLessThanOrEqual(OPTIONS.maxChars + 200);
  });
});

describe("previewHtml", () => {
  it("extracts the title and text-only body, never scripts or styles", () => {
    const html = [
      "<html><head><title>Example</title>",
      "<style>.x { background: url(data:text/plain;base64,AAAA) }</style></head>",
      "<body><p>intro paragraph</p>",
      "<script>huge();".concat("x".repeat(5_000), "</script>"),
      "<p>closing paragraph</p></body></html>",
    ].join("");
    const outcome = previewHtml(html, OPTIONS);
    expect(outcome.body).toContain("HTML document");
    expect(outcome.body).toContain("title: Example");
    expect(outcome.body).toContain("intro paragraph");
    expect(outcome.body).not.toContain("huge()");
    expect(outcome.body).not.toContain("background");
  });
});

describe("buildPreviewBody", () => {
  it("dispatches per kind deterministically", () => {
    const log = makeLog(50_000);
    expect(buildPreviewBody("log", log, OPTIONS)).toBe(previewLog(log, OPTIONS).body);
    expect(buildPreviewBody("text", "plain", OPTIONS)).toBe("plain");
  });
});

describe("markers", () => {
  const REF = "sha256:ac78199a1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b";

  it("embeds the complete hash and the retrieval hint (SPEC §19)", () => {
    const header = formatMarkerHeader({ sizeBytes: 2_871_934, previewBytes: 4_096, kind: "html", mediaType: "text/html", ref: REF });
    expect(header).toContain(`sha256=${REF.replace("sha256:", "")}`);
    expect(header).toContain("use dsh_cas_retrieve");
    const hint = formatRetrieveHint(REF);
    expect(hint).toBe(`Full content:\ndsh_cas_retrieve(ref="${REF}")`);
  });

  it("builds binary markers without payload content", () => {
    const marker = buildBinaryMarker({ sizeBytes: 2_400_000, kind: "binary", mediaType: "image/png", ref: REF });
    expect(marker).toContain("binary payload offloaded");
    expect(marker).toContain("image/png");
    expect(marker).toContain("dsh_cas_retrieve");
    expect(marker).not.toMatch(/iVBOR/);
  });

  it("recognizes its own markers to prevent reprocessing (SPEC §27)", () => {
    expect(isCasMarkerText(formatMarkerHeader({ sizeBytes: 1, previewBytes: 1, kind: "text", mediaType: "text/plain", ref: REF }))).toBe(true);
    expect(isCasMarkerText("ordinary tool output")).toBe(false);
  });

  it("formats bytes deterministically", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(4_096)).toBe("4 KiB");
    expect(formatBytes(2_831_104)).toBe("2.7 MiB");
  });
});
