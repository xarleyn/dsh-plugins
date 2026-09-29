import { describe, expect, it } from "vitest";
import type { QaMessage } from "../../src/types.js";
import { turnErrorCopy } from "../../src/client/failure-copy.js";
import { projectTranscript } from "../../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";

/** Every code the Host records on a turn it ended in failure. */
const FAILURE_CODES = [
  "TRANSPORT",
  "STREAM_CLOSED",
  "TIMEOUT",
  "RATE_LIMIT",
  "QUOTA",
  "AUTH",
  "SERVER",
  "EMPTY_RESPONSE",
  "NO_ADAPTER",
  "DEMO_CODE",
];

describe("the terminal turn failure row", () => {
  it("names the code for every failure the Host routes by one", () => {
    // The row is the only thing the tester can quote and the code is the handle
    // an operator greps the plugin log with, so a failure that has its own
    // sentence still has to carry it — once, not twice.
    const named = FAILURE_CODES.map((code) => ({
      code,
      times: turnErrorCopy(code).split(code).length - 1,
    }));
    expect(named).toEqual(FAILURE_CODES.map((code) => ({ code, times: 1 })));
  });

  it("stays plain when there is no code worth naming", () => {
    expect(turnErrorCopy(undefined)).toBe(
      "Помощнику не удалось завершить ответ.",
    );
    // Any failure that is not a provider one is flattened to this code, so
    // naming it would promise a diagnostic that does not exist.
    expect(turnErrorCopy("UNKNOWN")).toBe(
      "Помощнику не удалось завершить ответ.",
    );
  });

  it("points the operator at what the log line actually holds", () => {
    const row = turnErrorCopy("NO_ADAPTER");
    expect(row).toContain("session.turn-failed");
    expect(row).toContain("dsh-qa-surface");
    // The provider reaches the log only when the Host resolved a route, so the
    // row must not promise the name unconditionally.
    expect(row).toContain("если хост успел его определить");
  });

  it("projects a missing adapter without the provider's own sentence", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "turn-error",
              seq: 7,
              time: 70,
              turn: 1,
              step: 1,
              message:
                "no adapter registered for provider demo-provider /home/operator",
              code: "NO_ADAPTER",
            },
          ],
        }),
      ),
    );
    const row = messages.find(
      (message): message is Extract<QaMessage, { role: "system" }> =>
        message.role === "system" && message.status === "error",
    );
    expect(row?.text).toContain("NO_ADAPTER");
    expect(JSON.stringify(messages)).not.toContain("/home/operator");
    expect(JSON.stringify(messages)).not.toContain("no adapter registered");
  });
});
