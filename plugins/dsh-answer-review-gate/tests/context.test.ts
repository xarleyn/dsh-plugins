import { describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import {
  primaryReviewTools,
  reviewConversationContext,
} from "../src/context.js";
import {
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../src/prompt.js";

describe("independent review context", () => {
  it("recovers original human input through active nested checkpoints without reviving withdrawn input", () => {
    const events = [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "Original monitoring request" }] } },
      { type: "user/message", data: { source: { kind: "qa-notes" }, content: [{ type: "text", text: "Injected scope claim" }] } },
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "Withdrawn scope" }] } },
      { type: "compaction/summary", data: { compactionId: "c1", shadowedSeqs: [0, 1] } },
      { type: "user/message", data: { source: { kind: "compact-checkpoint", compactionId: "c1" }, content: [{ type: "text", text: "Model summary is not human" }] } },
      { type: "compaction/summary", data: { compactionId: "c2", shadowedSeqs: [4] } },
      { type: "user/message", data: { source: { kind: "compact-checkpoint", compactionId: "c2" }, content: [{ type: "text", text: "Nested model summary" }] } },
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "Latest correction" }] } },
    ];
    const context = reviewConversationContext({ surface: { nodes: [6, 7] }, eventAt: seq => events[seq], snapshotEvents: () => events });
    expect(context).toContain("Original monitoring request");
    expect(context).toContain("Latest correction");
    expect(context).not.toMatch(/Withdrawn scope|Injected scope claim|Model summary|Nested model summary/u);
  });

  it("reports the opaque native agent scope rather than global-only tools", async () => {
    const root = new Context();
    const key = {};
    root.provide("tools", {
      schemas: (scope: unknown) =>
        scope === key ? [{ name: "read" }] : [{ name: "global_tool" }],
    } as never);
    const scope = createScope(root, key);
    try {
      expect(primaryReviewTools({ ctx: scope.ctx })).toEqual(["read"]);
    } finally {
      await scope.dispose();
    }
  });

  it("preserves accumulated human decisions and excludes injected notes", () => {
    const events = [
      {
        type: "user/message",
        data: {
          source: { kind: "user" },
          content: [{ type: "text", text: "Do not offer the events module" }],
        },
      },
      {
        type: "user/message",
        data: {
          source: { kind: "qa-notes" },
          content: [{ type: "text", text: "Model-visible context" }],
        },
      },
      {
        type: "user/message",
        data: {
          source: { kind: "user" },
          content: [{ type: "text", text: "Revise the conclusion" }],
        },
      },
    ];
    const context = reviewConversationContext({
      surface: { nodes: [0, 1, 2] },
      eventAt: (seq) => events[seq],
      snapshotEvents: () => events,
    });
    expect(context).toContain("Do not offer the events module");
    expect(context).toContain("Revise the conclusion");
    expect(context).not.toContain("Model-visible context");
  });
  it("uses effective primary schemas and clearly handles an unavailable manifest", () => {
    const schemas = vi.fn(() => [
      { name: "document_create" },
      { name: "docs_read" },
      { name: "document_create" },
    ]);
    const agent = { ctx: { tools: { schemas } } };
    expect(primaryReviewTools(agent)).toEqual(["docs_read", "document_create"]);
    expect(schemas).toHaveBeenCalledWith(agent);
    expect(primaryReviewTools({})).toBeUndefined();
  });
  it("retains native answers only when tied to a successful question call", () => {
    const events = [
      {
        type: "tool/call",
        data: {
          name: "ask_user_question",
          callId: "q1",
          arguments: "Which modules?",
        },
      },
      {
        type: "tool/result",
        data: {
          message: {
            toolCallId: "orphan",
            content: [{ type: "text", text: "Invented answer" }],
          },
        },
      },
      {
        type: "tool/result",
        data: {
          message: {
            toolCallId: "q1",
            content: [
              { type: "text", text: "Only monitoring, exclude events" },
            ],
          },
        },
      },
      {
        type: "tool/call",
        data: { name: "ask_user_question", callId: "q2", arguments: "Price?" },
      },
      {
        type: "tool/result",
        data: {
          message: {
            toolCallId: "q2",
            isError: true,
            content: [{ type: "text", text: "Question expired" }],
          },
        },
      },
    ];
    const context = reviewConversationContext({
      surface: { nodes: [] },
      eventAt: () => undefined,
      snapshotEvents: () => events,
    });
    expect(context).toContain("Which modules?");
    expect(context).toContain("Only monitoring, exclude events");
    expect(context).not.toContain("Invented answer");
    expect(context).not.toContain("Question expired");
  });
  it.each([renderExpertReviewTask, renderSubagentReviewerTask])(
    "preserves the primary manifest and a late human decision through line-shortening readers",
    (render) => {
      const tools = ["document_workflow_draft", "document_workflow_review", "document_workflow_export"];
      const task = render({
        requestText: "Revise",
        candidateText: "Full draft",
        conversationContext: `${"Earlier discussion. ".repeat(800)}Accepted decision: survey compatibility during the pilot.`,
        primaryTools: tools,
      });
      // Native filesystem readers cap individual lines, independently of the
      // page's line limit. A one-line context JSON hid the manifest at its tail.
      const readable = task.split("\n").map((line) => line.slice(0, 2000)).join("\n");
      for (const tool of tools) expect(readable).toContain(tool);
      expect(readable).toContain("Accepted decision: survey compatibility during the pilot.");
    },
  );
  it.each([renderExpertReviewTask, renderSubagentReviewerTask])(
    "passes full scope decisions and primary capabilities to both reviewer protocols",
    (render) => {
      const task = render({
        requestText: "Revise",
        candidateText: "Full draft",
        conversationContext: "Earlier: exclude events",
        primaryTools: ["document_create"],
      });
      expect(task).toContain("Earlier: exclude events");
      expect(task).toContain('"primaryVisibleTools": [\n    "document_create"\n  ]');
      expect(task).toContain("not proof of the file's contents");
      expect(task).toContain("capability-absence claims are unverifiable");
    },
  );
});
