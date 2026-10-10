import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { describe, expect, it } from "vitest";
import { projectBoundSessionState } from "../../src/client/project-session-state.js";
import { QA_SESSION_IDLE_STATE } from "../../src/client/types.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";
import { sessionFace } from "../helpers/session-fakes.js";

function projected(inheritedThroughSeq?: number) {
  const output = ["workflow: wf_00000000-0000-4000-8000-000000000001", "revision: 2", "status: reviewed",
    `draft-sha256: ${"a".repeat(64)}`, "markdown: .qa/artifacts/workflows/demo/draft-2.md"].join("\n");
  const nodes = [
    { kind: "assistant", seq: 1, time: 10, turn: 1, step: 1, blocks: [
      { kind: "tool-call", callId: "call", name: "document_workflow_review", argsRaw: "{}" }] },
    { kind: "tool-result", seq: 2, time: 20, callId: "call", call: null, callTime: null,
      content: [{ type: "text", text: output }], isError: false, subCalls: [] },
    { kind: "assistant", seq: 3, time: 30, turn: 1, step: 2, blocks: [{ kind: "text", text: "Draft ready" }] },
  ] as ConversationNode[];
  return projectBoundSessionState({ connected: true, sessionId: "branch", chatKey: 1,
    sessionSnapshot: sessionFace("branch").face.getSnapshot(),
    conversationSnapshot: snapshot(legacy({ nodes, turnEnds: new Map([[1, 40]]) })),
    inheritedThroughSeq, sourceBundles: [], queuedMessages: [], admittedSubmissions: new Set(),
    approvals: [], questions: [], operationError: null, requestQueue: null, policyReady: true,
    admissionPending: false, chatsRevision: 0, viewingSubagent: null,
    slash: QA_SESSION_IDLE_STATE.slash, config: resolveConfig() }).messages;
}

describe("inherited document cards", () => {
  it("retains the file and final-answer fork action but removes inherited approval", () => {
    const messages = projected(4);
    const answer = messages.find((message) => message.role === "assistant");
    expect(answer).toMatchObject({ role: "assistant", seq: 3, forkable: true,
      artifacts: [{ path: ".qa/artifacts/workflows/demo/draft-2.md" }] });
    if (answer?.role !== "assistant") throw new Error("No answer");
    expect(answer.artifacts?.[0]?.workflow).toBeUndefined();
  });
  it("keeps the current branch's newly reviewed document approvable", () => {
    const answer = projected(0).find((message) => message.role === "assistant");
    if (answer?.role !== "assistant") throw new Error("No answer");
    expect(answer.artifacts?.[0]?.workflow).toMatchObject({ status: "reviewed", revision: 2 });
  });
});
