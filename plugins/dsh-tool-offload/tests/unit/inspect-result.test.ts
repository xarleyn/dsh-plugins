/**
 * Unit tests for the ResultInspector (SPEC §9.1, §11, §32.1 payload tests).
 */

import { describe, expect, it } from "vitest";

import { inspectResult, serializeArgs } from "../../src/routing/inspect-result.js";
import { errorResult, fakeExec, makeText, successResult } from "../fixtures/offload-fixtures.js";

describe("inspectResult", () => {
  it("measures textual content in bytes and estimated tokens (SPEC §11)", () => {
    const text = makeText(8_192);
    const candidate = inspectResult(fakeExec("read", { arguments: { path: "src/a.ts" } }), successResult(text));
    expect(candidate.toolName).toBe("read");
    expect(candidate.resultKind).toBe("success");
    expect(candidate.isTextual).toBe(true);
    expect(candidate.byteLength).toBe(Buffer.byteLength(text, "utf8"));
    expect(candidate.estimatedTokens).toBe(Math.floor(text.length / 4));
    expect(candidate.argsText).toBe(JSON.stringify({ path: "src/a.ts" }));
  });

  it("marks results with non-text blocks as non-textual", () => {
    const result = {
      isError: false,
      value: null,
      content: [{ type: "text", text: "screenshot saved" }, { type: "image", data: "base64…" }],
    } as unknown as Parameters<typeof inspectResult>[1];
    const candidate = inspectResult(fakeExec("screenshot"), result);
    expect(candidate.isTextual).toBe(false);
    expect(candidate.contentText).toBe("screenshot saved");
  });

  it("reports error results without content and keeps them inspectable", () => {
    const candidate = inspectResult(fakeExec("bash"), errorResult("boom"));
    expect(candidate.resultKind).toBe("error");
    expect(candidate.isTextual).toBe(true);
  });

  it("counts unicode content by UTF-8 bytes, not characters", () => {
    const text = "中文".repeat(1_000);
    const candidate = inspectResult(fakeExec("read"), successResult(text));
    expect(candidate.byteLength).toBe(6_000);
    expect(candidate.estimatedTokens).toBe(Math.floor(2_000 / 4));
  });
});

describe("serializeArgs", () => {
  it("bounds oversized argument payloads", () => {
    const serialized = serializeArgs({ blob: "x".repeat(100_000) }, 1_024);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(1_024);
    expect(serialized).toContain("(truncated)");
  });

  it("falls back to String for non-serializable arguments", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeArgs(circular)).toContain("[object Object]");
  });
});
