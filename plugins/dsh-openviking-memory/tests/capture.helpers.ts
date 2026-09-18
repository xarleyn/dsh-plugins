import type { CapturePayload, CaptureSessionEvent } from "../src/capture.js";
import type { CaptureConfig } from "../src/openviking/capture-utils.js";

export const CONFIG: CaptureConfig = {
  captureAssistantTurns: true,
  captureToolResults: true,
  captureToolMaxChars: 1_000_000,
  captureMaxLength: 24_000,
  captureFilters: [],
  peerId: "workspace-a",
};

/** The DSH event time used by the timing assertions. */
export const EVENT_TIME = 1_786_681_234_567;

/** `created_at` for {@link EVENT_TIME}. */
export const EVENT_TIME_ISO = "2026-08-14T04:20:34.567Z";

export function userEvent(text: string, time?: number): CaptureSessionEvent {
  return {
    type: "user/message",
    ...(time === undefined ? {} : { time }),
    data: {
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
  };
}

/** A captured payload with the derived `created_at` neutralized, for field-by-field comparison. */
export function withoutTimestamp(payload: CapturePayload): CapturePayload {
  return { ...payload, created_at: undefined };
}

/** The first text part of a captured payload, or "" when there is none. */
export function firstText(payload: CapturePayload | null): string {
  for (const part of payload?.parts ?? []) {
    if (part.type === "text") return part.text;
  }
  return "";
}
