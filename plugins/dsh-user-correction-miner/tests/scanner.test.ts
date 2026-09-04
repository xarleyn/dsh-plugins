import { describe, expect, it } from "vitest";
import { scanSession } from "../src/mining/scanner.js";
import { assistantEvent, header, userEvent } from "./fixtures/sessions.js";

describe("scanSession", () => {
  it("finds direct correction messages after the incremental watermark", () => {
    const events = [
      userEvent(0, "Сделай задачу"),
      assistantEvent(1, "Запускаю npm install."),
      userEvent(2, "Используй pnpm, не npm."),
      userEvent(3, "Спасибо"),
      userEvent(4, "Не запускай сейчас тесты."),
    ];
    const result = scanSession(
      { session: header(), events },
      1,
      { maxContextEvents: 20, maxContextBytes: 32_768 },
    );
    expect(result.eventsScanned).toBe(3);
    expect(result.evidence.map((item) => item.userEventSeq)).toEqual([2, 4]);
    expect(result.evidence[1]?.likelyOneOff).toBe(true);
    expect(result.capturedThroughSeq).toBe(4);
  });

  it("represents an empty log without inventing a negative event sequence", () => {
    expect(
      scanSession(
        { session: header(), events: [] },
        -1,
        { maxContextEvents: 20, maxContextBytes: 32_768 },
      ).capturedThroughSeq,
    ).toBeNull();
  });
});
