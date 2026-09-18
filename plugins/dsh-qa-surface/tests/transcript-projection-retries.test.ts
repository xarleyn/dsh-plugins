import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { projectTranscript } from "../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";

describe("transcript projection", () => {
  it("renders host-scheduled model retries as work rows without provider internals", () => {
    const retryNode = (
      overrides: Partial<Extract<ConversationNode, { kind: "model-retry" }>> & {
        seq: number;
        time: number;
        retryState: "scheduled" | "started" | "cancelled";
      },
    ) =>
      ({
        kind: "model-retry",
        retryId: "retry-1",
        turn: 1,
        step: 1,
        provider: "neuraldeep",
        mode: "normal",
        policyKey: "policy",
        retry: 2,
        maxRetries: 6,
        delayMs: 4_000,
        failure: { message: "stack /home/secret", code: "TRANSPORT" },
        ...overrides,
      }) as ConversationNode;
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            retryNode({ seq: 1, time: 1_000, retryState: "scheduled" }),
            retryNode({ seq: 2, time: 5_000, retryState: "started" }),
          ],
          turnTimings: new Map([[1, { startTime: 500, endTime: 9_000 }]]),
          turnEnds: new Map([[1, 3]]),
        }),
      ),
    );
    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.status).toBe("complete");
    expect(
      work.items.map((item) =>
        item.kind === "progress" ? item.text : item.kind,
      ),
    ).toEqual([
      "Сбой запроса к провайдеру (обрыв связи) — повторная попытка 2 из 6 через 4 с",
      "Сбой запроса к провайдеру (обрыв связи) — повторная попытка 2 из 6 выполняется",
    ]);
    expect(JSON.stringify(messages)).not.toContain("/home/secret");
  });

  it("keeps a scheduled always-mode retry live and unbounded", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "model-retry",
              seq: 1,
              time: 1_000,
              retryId: "retry-1",
              turn: 1,
              step: 1,
              provider: "neuraldeep",
              mode: "always",
              policyKey: "policy",
              retry: 3,
              delayMs: 8_000,
              retryState: "scheduled",
              failure: { message: "hidden", code: "RATE_LIMIT" },
            },
          ] as ConversationNode[],
          turnTimings: new Map([[1, { startTime: 500 }]]),
        }),
      ),
      { running: true },
    );
    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.status).toBe("running");
    expect(work.items[0]).toMatchObject({
      kind: "progress",
      status: "running",
      text: "Сбой запроса к провайдеру (лимит запросов) — повторная попытка 3 (без лимита) через 8 с",
    });
  });

  it("marks a failed turn's work group as errored with code-driven copy", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 1,
              time: 1_000,
              turn: 1,
              step: 1,
              blocks: [
                { kind: "reasoning", text: "Reading the tree." },
                { kind: "text", text: "Partial answer" },
              ],
            },
            {
              kind: "turn-error",
              seq: 2,
              time: 2_000,
              turn: 1,
              step: 1,
              message: "TypeError: fetch failed /home/secret",
              code: "TRANSPORT",
            },
          ] as ConversationNode[],
          turnTimings: new Map([[1, { startTime: 500, endTime: 2_000 }]]),
          turnEnds: new Map([[1, 2]]),
        }),
      ),
      { showReasoning: true },
    );
    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.status).toBe("error");
    const errorRow = messages.find(
      (message) => message.role === "system" && message.status === "error",
    );
    expect(errorRow).toMatchObject({
      text: "Обрыв связи с провайдером. Ответ не сохранился — отправь запрос ещё раз.",
    });
    expect(JSON.stringify(messages)).not.toContain("/home/secret");
  });
});
