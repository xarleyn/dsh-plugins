import { describe, expect, it } from "vitest";
import type { QaMessage } from "../../src/types.js";
import { turnErrorCopy } from "../../src/client/failure-copy.js";
import { projectTranscript } from "../../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";

describe("the terminal turn failure row", () => {
  it("names the code a stand operator reads back from the log", () => {
    // The row is the only thing the tester can quote, so the code has to be in it.
    expect(turnErrorCopy("NO_ADAPTER")).toContain("NO_ADAPTER");
    expect(turnErrorCopy("DEMO_CODE")).toContain("(DEMO_CODE)");
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
