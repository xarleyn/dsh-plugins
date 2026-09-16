// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THINKING_PHRASES,
  thinkingPhrase,
  useThinkingPhrase,
} from "../src/client/components/thinking-phrases.js";

describe("thinking phrases", () => {
  it("keeps every phrase distinct and non-empty", () => {
    expect(DEFAULT_THINKING_PHRASES.length).toBeGreaterThan(1);
    for (const phrase of DEFAULT_THINKING_PHRASES) {
      expect(phrase.trim()).not.toBe("");
    }
    expect(new Set(DEFAULT_THINKING_PHRASES).size).toBe(
      DEFAULT_THINKING_PHRASES.length,
    );
  });

  it("advances every four seconds and wraps around", () => {
    expect(thinkingPhrase(0)).toBe(DEFAULT_THINKING_PHRASES[0]);
    expect(thinkingPhrase(3_999)).toBe(DEFAULT_THINKING_PHRASES[0]);
    expect(thinkingPhrase(4_000)).toBe(DEFAULT_THINKING_PHRASES[1]);
    expect(thinkingPhrase(8_000)).toBe(DEFAULT_THINKING_PHRASES[2]);

    const cycle = DEFAULT_THINKING_PHRASES.length * 4_000;
    expect(thinkingPhrase(cycle)).toBe(DEFAULT_THINKING_PHRASES[0]);
    expect(thinkingPhrase(cycle + 4_000)).toBe(DEFAULT_THINKING_PHRASES[1]);
  });

  it("clamps negative elapsed time to the first phrase", () => {
    expect(thinkingPhrase(-1_000)).toBe(DEFAULT_THINKING_PHRASES[0]);
  });

  it("cycles an operator-supplied list", () => {
    expect(thinkingPhrase(0, ["Точу", "Полирую"])).toBe("Точу");
    expect(thinkingPhrase(4_000, ["Точу", "Полирую"])).toBe("Полирую");
    expect(thinkingPhrase(8_000, ["Точу", "Полирую"])).toBe("Точу");
  });

  it("falls back to the built-in phrases for an empty list", () => {
    expect(thinkingPhrase(4_000, [])).toBe(DEFAULT_THINKING_PHRASES[1]);
  });
});

describe("useThinkingPhrase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays silent while no turn is running", () => {
    const { result } = renderHook(() => useThinkingPhrase(false, undefined));
    expect(result.current).toBeNull();
  });

  it("counts from the running turn's start time", () => {
    const startedAt = Date.now() - 4_500;
    const { result } = renderHook(() => useThinkingPhrase(true, startedAt));
    expect(result.current).toBe(DEFAULT_THINKING_PHRASES[1]);

    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    expect(result.current).toBe(DEFAULT_THINKING_PHRASES[2]);
  });

  it("reads the operator's list", () => {
    const { result } = renderHook(() =>
      useThinkingPhrase(true, Date.now(), ["Точу"]),
    );
    expect(result.current).toBe("Точу");

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(result.current).toBe("Точу");
  });
});
