// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { QaPendingQuestion } from "../../src/types.js";
import { useQuestionSounds } from "../../src/client/notifications/question-sound.js";

const minute = 60_000;

function soundFixture(suspended = false) {
  vi.useFakeTimers({ now: 0 });
  const tones: number[] = [];
  vi.stubGlobal(
    "AudioContext",
    class {
      state = suspended ? "suspended" : "running";
      currentTime = 0;
      onstatechange?: () => void;
      async resume() {
        this.state = "running";
        this.onstatechange?.();
      }
      async close() {}
      createOscillator() {
        return {
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {
            tones.push(Date.now() / minute);
          },
          stop() {},
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
        };
      }
    },
  );
  const request: QaPendingQuestion = {
    id: "q1",
    sessionId: "chat",
    questions: [],
    createdAt: 0,
    expiresAt: 30 * minute,
  };
  const view = renderHook(
    (requests: QaPendingQuestion[]) => useQuestionSounds(requests),
    { initialProps: [request] },
  );
  return { ...view, request, tones };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("chimes on arrival and at five-minute boundaries, never on a re-render or at expiry", () => {
  const { rerender, request, tones } = soundFixture();
  vi.advanceTimersByTime(3 * minute);
  rerender([{ ...request }]);
  vi.advanceTimersByTime(30 * minute);
  expect(tones).toEqual([0, 5, 10, 15, 20, 25]);
});

it("stops a settled request and gives the next request its own schedule", () => {
  const { rerender, request, tones, unmount } = soundFixture();
  vi.advanceTimersByTime(4 * minute);
  rerender([]);
  vi.advanceTimersByTime(2 * minute);
  rerender([{ ...request, id: "q2", createdAt: 6 * minute }]);
  vi.advanceTimersByTime(5 * minute);
  unmount();
  vi.advanceTimersByTime(10 * minute);
  expect(tones).toEqual([0, 6, 11]);
});

it("keeps reminding for an open-ended question until it is answered or closed", () => {
  const { rerender, request, tones } = soundFixture();
  rerender([{ ...request, expiresAt: null }]);
  vi.advanceTimersByTime(35 * minute);
  expect(tones).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);
  rerender([]);
  vi.advanceTimersByTime(5 * minute);
  expect(tones.at(-1)).toBe(35);
});

it("sounds only a still-live question when the browser unlocks audio", () => {
  const { rerender, request, tones } = soundFixture(true);
  vi.advanceTimersByTime(6 * minute);
  expect(tones).toEqual([]);
  fireEvent.keyDown(window, { key: "Tab" });
  expect(tones).toEqual([6]);
  rerender([{ ...request, id: "expired", expiresAt: 5 * minute }]);
  fireEvent.pointerUp(window);
  vi.advanceTimersByTime(30 * minute);
  expect(tones).toEqual([6]);
});
