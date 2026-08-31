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
});
