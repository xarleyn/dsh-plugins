import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { extractCorrectionEvidence } from "../src/mining/context-extractor.js";
import { prefilterCorrection } from "../src/mining/prefilter.js";
import {
  assistantEvent,
  header,
  toolCallEvent,
  toolResultEvent,
  userEvent,
} from "./fixtures/sessions.js";

function extractPreviousAssistant(text: string, maxContextBytes: number): string | undefined {
  const events = [assistantEvent(0, text), userEvent(1, "Не делай так.")];
  return extractCorrectionEvidence(
    header(),
    events,
    1,
    prefilterCorrection("Не делай так."),
    { maxContextEvents: 20, maxContextBytes },
  ).contextEvents[0]?.text;
}

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("extractCorrectionEvidence", () => {
  it("keeps the preceding instruction, assistant action, and tool provenance", () => {
    const events = [
      userEvent(0, "Измени packages/server/package.json"),
      assistantEvent(1, "Обновлю packages/web/package.json."),
      toolCallEvent(2, "write", '{"path":"packages/web/package.json"}'),
      toolResultEvent(3, "written"),
      userEvent(4, "Не тот файл."),
    ];
    const evidence = extractCorrectionEvidence(
      header(),
      events,
      4,
      prefilterCorrection("Не тот файл."),
      { maxContextEvents: 20, maxContextBytes: 32_768 },
    );

    expect(evidence.previousUserEvent).toBe(0);
    expect(evidence.previousAssistantEvents).toEqual([1]);
    expect(evidence.previousToolEvents).toEqual([2, 3]);
    expect(evidence.contextEvents.map((event) => event.kind)).toEqual([
      "user",
      "assistant",
      "tool-call",
      "tool-result",
    ]);
    expect(evidence.contextDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("does not treat injected plugin context as a human instruction", () => {
    const events = [
      userEvent(0, "Исходная просьба"),
      userEvent(1, "Injected instructions", "plugin"),
      assistantEvent(2, "Сделаю."),
      userEvent(3, "Не делай так."),
    ];
    const evidence = extractCorrectionEvidence(
      header(),
      events,
      3,
      prefilterCorrection("Не делай так."),
      { maxContextEvents: 20, maxContextBytes: 32_768 },
    );
    expect(evidence.previousUserEvent).toBe(0);
    expect(evidence.contextEvents.some((event) => event.text.includes("Injected"))).toBe(false);
  });

  it.each([
    ["keeps ASCII within the byte budget", "abc", 3, "abc"],
    ["truncates ASCII and reserves three bytes for the ellipsis", "abcdef", 5, "ab…"],
    ["handles BMP Cyrillic", "абвг", 7, "аб…"],
    ["does not split an emoji outside the BMP", "😀abcd", 7, "😀…"],
    ["keeps several emoji at the exact boundary", "😀😃", 8, "😀😃"],
    ["truncates several emoji at a boundary", "😀😃x", 7, "😀…"],
    ["does not detach a combining mark from a retained base", "e\u0301x", 6, "e\u0301x"],
    ["returns no event for empty text", "", 3, undefined],
    ["returns no event when the byte budget is below the ellipsis", "abc", 2, undefined],
    ["uses an ellipsis when no source code point fits", "😀", 3, "…"],
    ["does not skip an oversized first code point", "😀a", 4, "…"],
  ])("%s", (_name, text, maxBytes, expected) => {
    const result = extractPreviousAssistant(text, maxBytes);
    expect(result).toBe(expected);
    if (result !== undefined) {
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(maxBytes);
      expect(hasLoneSurrogate(result)).toBe(false);
    }
  });

  it.each([
    ["abcdef", 3],
    ["абвг", 6],
    ["😀😃😄", 10],
    ["e\u0301xyz", 7],
  ])("never stores %s beyond a %i-byte budget", (text, maxBytes) => {
    const result = extractPreviousAssistant(text, maxBytes);
    expect(result).toBeDefined();
    expect(Buffer.byteLength(result ?? "", "utf8")).toBeLessThanOrEqual(maxBytes);
    expect(hasLoneSurrogate(result ?? "")).toBe(false);
  });
});
