import { describe, expect, it, vi } from "vitest";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { AnswerReviewGate, type GateAgent } from "../src/gate.js";
import { ReviewAudit } from "../src/audit.js";
import { resolveAnswerReviewGateConfig } from "../src/config.js";
import {
  privateWorkbookReviewer,
  workbookReviewEvidence,
} from "../src/private-workbook-review.js";

const route = {
  provider: "local-fixture",
  model: "test-model",
  skill: "private-sheet",
  workflowTool: "fixture_verify",
};
const file = "fixture-ledger.xlsx",
  path = "/fixture/" + file;
const candidate = "The verified workbook includes the requested rows.";
const human = (content: unknown[]) => ({
  type: "user/message",
  data: { source: { kind: "user" }, content },
});
const txt = (text: string) => ({ type: "text", text });
const events = [
  human([
    txt("HISTORY_MARK"),
    {
      type: "file",
      attachment: {
        attachmentId: "sha256:f00",
        name: file,
        mediaType: "application/octet-stream",
        bytes: 100,
      },
    },
  ]),
  {
    type: "tool/call",
    data: {
      name: route.workflowTool,
      callId: "local-1",
      arguments: { file: path },
    },
  },
  {
    type: "tool/result",
    data: { message: { toolCallId: "local-1", content: [txt("CELL_MARK")] } },
  },
  human([txt("Please verify the previous result.")]),
  {
    type: "assistant/message",
    data: { message: { content: [txt(candidate)] } },
  },
];
function session(items = events): GateAgent["session"] {
  return {
    header: { origin: "user" },
    surface: { nodes: items.map((_, i) => i) },
    snapshotEvents: () => items,
    eventAt: (i: number) => items[i],
  } as unknown as GateAgent["session"];
}
const verdict = {
  verdict: "pass",
  summary: "Verified using the local receipt.",
  issues: [],
  confidence: "high",
};
function chunks(name: string, args: object): StreamChunk[] {
  const block = {
    type: "tool-call",
    id: "fixture-call",
    name,
    arguments: JSON.stringify(args),
  } as const;
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "block-end", index: 0, block },
    { type: "finish", reason: { kind: "tool-calls" } },
  ] as StreamChunk[];
}
describe("protected workbook review", () => {
  it.each([true, false])(
    "keeps both the packet and follow-up on the local route (available=%s)",
    async (available) => {
      const remote = vi.fn(() => {
        throw Error("unexpected generic reviewer");
      });
      const requests: GenerateOptions[] = [];
      const llm = {
        async *stream(options: GenerateOptions) {
          requests.push(options);
          yield* chunks("structured_output", verdict);
        },
      };
      const gate = new AnswerReviewGate({
        config: () =>
          resolveAnswerReviewGateConfig({
            workbookReview: route,
            minCandidateChars: 1,
          }),
        domainExperts: remote,
        subagents: remote,
        localLlm: () => (available ? llm : undefined),
        audit: new ReviewAudit(10),
        logger: { info() {}, warn() {}, error() {} },
        now: Date.now,
        steerMessage() {},
      });
      const result = await gate.handleTurnStopping(
        { id: "fixture", session: session(), steer() {} } as GateAgent,
        1,
        new AbortController().signal,
      );
      expect(remote).not.toHaveBeenCalled();
      if (available) {
        expect(result).toBe("pass");
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          provider: route.provider,
          model: route.model,
        });
        expect(requests[0]?.tools?.map((t) => t.name)).toEqual([
          "structured_output",
        ]);
        expect(JSON.stringify(requests[0]?.messages)).toContain("CELL_MARK");
      } else expect(result).not.toBe("pass");
    },
  );
  it("keeps a protected chat local after its workbook has left the active surface", () => {
    const original = session();
    expect(
      workbookReviewEvidence(
        { ...original, surface: { nodes: [3, 4] } },
        route,
      ),
    ).toBeDefined();
    expect(
      workbookReviewEvidence(session(events.slice(3)), route),
    ).toBeUndefined();
    expect(workbookReviewEvidence(session([events[1]!]), route)).toBeDefined();
  });
  it("records actual document reads from the local reviewer before accepting a comparison", async () => {
    let step = 0;
    const readDocument = vi.fn(() => "1. Synthetic source passage.");
    const llm = {
      async *stream(options: GenerateOptions) {
        expect(options.provider).toBe(route.provider);
        yield* ++step === 1
          ? chunks("read", { file_path: "/fixture/document", offset: 0 })
          : chunks("structured_output", verdict);
      },
    };
    const result = await privateWorkbookReviewer(llm, route, "").review({
      sessionId: "fixture",
      turn: 1,
      requestText: "Read the document",
      candidateText: candidate,
      requestAttachments: [],
      documentReview: "Read the prepared document",
      readDocument,
      signal: new AbortController().signal,
    });
    expect(result.verdict).toBe("pass");
    expect(readDocument).toHaveBeenCalledWith(
      result.reviewerSessionId,
      "/fixture/document",
      0,
    );
  });
});
