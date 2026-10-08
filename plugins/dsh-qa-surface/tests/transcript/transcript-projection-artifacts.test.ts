import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaMessage } from "../../src/types.js";
import { projectTranscript } from "../../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";

const ROOT = "/workspace/work/.qa-users/6f2a1b3c-0000-4000-8000-aabbccddeeff";
const BUNDLE = ".qa/artifacts/documents/doc_01ABC";

/** The settled result of the `document_create` call the turn made. */
const CREATED = [
  "artifact: doc_01ABC",
  `docx: ${BUNDLE}/report.docx (12.3 KiB, sha256 9f2c1d0a4b5e6f70…)`,
  `manifest: ${BUNDLE}/manifest.json`,
].join("\n");

function created(
  answer: string,
  toolResult: string,
): readonly ConversationNode[] {
  return [
    {
      kind: "user",
      seq: 1,
      time: 10,
      source: {},
      content: [{ type: "text", text: "Сделай docx на одну страницу" }],
    },
    {
      kind: "assistant",
      seq: 2,
      time: 20,
      turn: 1,
      step: 1,
      blocks: [
        {
          kind: "tool-call",
          callId: "call-1",
          name: "document_create",
          argsRaw: '{"formats":["docx"]}',
        },
      ],
    },
    {
      kind: "tool-result",
      seq: 3,
      time: 30,
      callId: "call-1",
      call: null,
      callTime: null,
      content: [{ type: "text", text: toolResult }],
      isError: false,
      subCalls: [],
    },
    {
      kind: "assistant",
      seq: 4,
      time: 40,
      turn: 1,
      step: 2,
      blocks: [{ kind: "text", text: answer }],
    },
  ] as ConversationNode[];
}

/** The answer row of a one-turn projection, narrowed to its own fields. */
function answerOf(messages: readonly QaMessage[]) {
  const answer = messages.find((message) => message.role === "assistant");
  if (answer === undefined || answer.role !== "assistant") {
    throw new Error("the projection carried no answer row");
  }
  return answer;
}

describe("transcript artifacts", () => {
  it("cards the document the turn produced under the answer", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: created("Отчёт готов.", CREATED),
          turnEnds: new Map([[1, 50]]),
        }),
      ),
    );
    expect(answerOf(messages).artifacts).toEqual([
      {
        path: `${BUNDLE}/report.docx`,
        name: "report.docx",
        format: "docx",
        bytes: 12_595,
      },
    ]);
  });

  it("cards the produced file with the work view switched off", () => {
    // `showToolActivity` decides what tool noise a reader is spared; a document
    // the answer handed over is not noise, and hiding the rows must not hide
    // the file the reader asked for.
    const messages = projectTranscript(
      snapshot(legacy({ nodes: created("Готово.", CREATED) })),
    );
    expect(messages.some((message) => message.role === "work")).toBe(false);
    expect(answerOf(messages).artifacts).toHaveLength(1);
  });

  it("masks the workspace directory out of the answer text", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: created(
            `Расположение:\n${ROOT}/${BUNDLE}/report.docx`,
            CREATED,
          ),
          turnEnds: new Map([[1, 50]]),
        }),
      ),
      { workspaceRoot: ROOT },
    );
    const rendered = JSON.stringify(messages);
    expect(rendered).not.toContain("/workspace/");
    expect(rendered).not.toContain(".qa-users");
    expect(rendered).not.toContain("6f2a1b3c");
    expect(answerOf(messages).text).toBe(
      `Расположение:\n${BUNDLE}/report.docx`,
    );
  });

  it("keeps one card per file when a turn rewrote the same bundle", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            ...created("Сначала текстом.", CREATED),
            {
              kind: "assistant",
              seq: 5,
              time: 50,
              turn: 1,
              step: 3,
              blocks: [
                {
                  kind: "tool-call",
                  callId: "call-2",
                  name: "document_convert",
                  argsRaw: "{}",
                },
              ],
            },
            {
              kind: "tool-result",
              seq: 6,
              time: 60,
              callId: "call-2",
              call: null,
              callTime: null,
              content: [{ type: "text", text: CREATED }],
              isError: false,
              subCalls: [],
            },
          ],
          turnEnds: new Map([[1, 70]]),
        }),
      ),
    );
    expect(answerOf(messages).artifacts).toHaveLength(1);
  });
});
