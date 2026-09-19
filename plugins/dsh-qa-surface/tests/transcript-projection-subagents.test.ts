import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { projectTranscript } from "../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";
import { settlementNode } from "./transcript-projection.helpers.js";

describe("transcript projection", () => {
  it("presents subagent launches with labels and the durable child id", () => {
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
                {
                  kind: "tool-call",
                  callId: "sa-1",
                  name: "subagent",
                  argsRaw:
                    '{"description":"Print a greeting","prompt":"Hello","run_in_background":true}',
                },
              ],
            },
            {
              kind: "tool-result",
              seq: 2,
              time: 2_000,
              callId: "sa-1",
              call: {
                name: "subagent",
                argsRaw:
                  '{"description":"Print a greeting","prompt":"Hello","run_in_background":true}',
              },
              callTime: 1_000,
              content: [
                {
                  type: "text",
                  text: "started subagent b5b84a41-5597-4ddb-8cb6-9a2fa90517ad",
                },
              ],
              isError: false,
              subCalls: [],
            },
          ] as ConversationNode[],
        }),
      ),
      { showToolActivity: true },
    );
    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.items[0]).toMatchObject({
      kind: "tool",
      name: "subagent",
      label: "Субагент",
      summary: "Print a greeting",
      subagentId: "b5b84a41-5597-4ddb-8cb6-9a2fa90517ad",
      status: "ok",
    });
  });

  it("folds subagent settlements into titled collapsible notices", () => {
    const contextNode = (seq: number, label: string, text: string) => ({
      kind: "context" as const,
      seq,
      time: seq * 10,
      content: [{ type: "text" as const, text }],
      source: {},
      provenance: { role: "context", label },
      form: null,
    });
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            contextNode(
              1,
              "subagent-settled",
              "Background subagent b5b84a41-5597-4ddb-8cb6-9a2fa90517ad finished and will do no further work unless you send it more.Its closing message:**Found 130 TODO lines** | file | excerpt",
            ),
            contextNode(2, "skill-catalog", "operator skill list"),
          ] as ConversationNode[],
        }),
      ),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "system",
      status: "info",
      text: "Субагент b5b84a41 завершён",
      notice: {
        title: "Субагент b5b84a41 завершён",
        body: "**Found 130 TODO lines** | file | excerpt",
      },
    });
    expect(JSON.stringify(messages)).not.toContain("skill list");
    expect(JSON.stringify(messages)).not.toContain("will do no further work");
  });

  it("signs a settlement with the subagent's readable name", () => {
    const id = "b5b84a41-5597-4ddb-8cb6-9a2fa90517ad";
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            settlementNode(
              1,
              `Background subagent ${id} finished and will do no further work unless you send it more.Its closing message:**Done**`,
            ),
          ] as ConversationNode[],
        }),
      ),
      { subagentNames: { [id]: "Сверка  отчётов" } },
    );
    expect(messages[0]).toMatchObject({
      role: "system",
      text: "Субагент «Сверка отчётов» завершён",
      notice: {
        title: "Субагент «Сверка отчётов» завершён",
        body: "**Done**",
        meta: "Идентификатор: b5b84a41",
      },
    });
  });

  it("signs a settlement with a codename and keeps the task in the meta", () => {
    const id = "eaa454a4-0000-4ddb-8cb6-9a2fa90517ad";
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [settlementNode(1, `Background subagent ${id} failed.`)],
        }),
      ),
      {
        subagentCodenames: true,
        subagentNames: { [id]: "Собрать статистику" },
      },
    );
    const notice =
      messages[0]?.role === "system" ? messages[0].notice : undefined;
    expect(notice?.title).toMatch(/^Субагент «.+» завершился ошибкой$/u);
    expect(notice?.title).not.toContain("Собрать статистику");
    expect(notice?.meta).toContain("Задача: Собрать статистику");
    expect(notice?.meta).toContain("Идентификатор: eaa454a4");
    // The facts stay separate items; no decorative separator glues them.
    expect(notice?.meta).not.toContain("·");
  });

  it("keeps the short-id title when nothing readable is known", () => {
    const id = "1f7e77cd-0000-4ddb-8cb6-9a2fa90517ad";
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            settlementNode(
              1,
              `Background subagent ${id} finished. Its closing message:ok`,
            ),
          ] as ConversationNode[],
        }),
      ),
      { subagentNames: { [id]: id } },
    );
    expect(messages[0]).toMatchObject({
      role: "system",
      text: "Субагент 1f7e77cd завершён",
      notice: { title: "Субагент 1f7e77cd завершён" },
    });
    const notice =
      messages[0]?.role === "system" ? messages[0].notice : undefined;
    expect(notice?.meta).toBeUndefined();
  });
});
