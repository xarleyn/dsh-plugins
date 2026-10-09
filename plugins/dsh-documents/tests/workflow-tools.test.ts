import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { Context } from "@deepseek-ai/cordis";
import { validateArgs } from "@deepseek-ai/dsh-tools";
import { WORKFLOW_UPDATE_PROPERTIES } from "../src/workflow/update-schema.js";
import { createScope } from "@deepseek-ai/dsh-scope";
import {
  createWorkflowTools,
  DOCUMENT_WORKFLOW_TOOL_NAMES,
} from "../src/workflow/tools.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import { CONTENT, UPDATE, ready, workflowFixture } from "./workflow.helpers.js";

let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => {
  fixture = await workflowFixture();
});
afterEach(async () => fixture.cleanup());
function exec() {
  return {
    agent: {
      session: {
        header: {
          cwd: fixture.scope.workspaceRoot,
          id: fixture.scope.sessionId,
        },
        surface: { nodes: [1, 2] },
        eventAt: (seq: number) => ({
          type: "user/message",
          data: {
            source: { kind: seq === 1 ? "user" : "plugin" },
            content: [
              {
                type: "text",
                text:
                  seq === 1
                    ? "Real human scope decision"
                    : "Model-context note",
              },
            ],
          },
        }),
      },
    },
  } as unknown as ToolRunContext;
}
describe("workflow tools and conversion boundary", () => {
  it("publishes an executable update schema that rejects keyed facts and fake commercial decisions", () => {
    const tool = createWorkflowTools({ runtime: fixture.runtime }, fixture.service)
      .find(t => t.name === "document_workflow_update")!;
    const args = { workflowId: "wf_demo", revision: 0, data: UPDATE };
    const spec = { workflowId: { type: "string", required: true }, revision: { type: "number", required: true },
      data: { type: "object", required: true, additionalProperties: false, properties: WORKFLOW_UPDATE_PROPERTIES } } as const;
    expect(tool.parameters).toMatchObject({ properties: { data: { properties: { facts: { type: "array" }, requirements: { type: "array" } } } } });
    expect(validateArgs(spec, args)).toEqual([]);
    expect(validateArgs(spec, { ...args, data: { ...UPDATE, facts: { customer: UPDATE.facts[1] } } }).join("\n"))
      .toMatch(/facts/u);
    expect(validateArgs(spec, { ...args, data: { ...UPDATE, commercial: { value: "unpriced" } } }).join("\n"))
      .toMatch(/commercial/u);
  });

  it("keeps a revise verdict visible before a positive summary and the long draft", async () => {
    const draft = await ready(fixture);
    fixture.review.mockResolvedValueOnce({
      pass: false,
      summary: "All main claims are supported",
      issues: ["Disclose the conflict between the two cited formulas"],
    });
    const tool = createWorkflowTools({ runtime: fixture.runtime }, fixture.service)
      .find((t) => t.name === "document_workflow_review")!;
    const args = { workflowId: draft.id, revision: draft.revision };
    const result = await tool.execute(args, exec());
    const text = tool.output.render(args, result as never).filter(b => b.type === "text")
      .map(b => b.text).join("\n");
    expect(text).toContain("review-verdict: revise");
    expect(text).toContain("Human approval and final export are unavailable");
    expect(text.indexOf("blocking-review-issue:")).toBeLessThan(text.indexOf("All main claims are supported"));
    await expect(fixture.service.approve(fixture.scope, draft.id, draft.revision, draft.draft!.sha256, "human-owner"))
      .rejects.toMatchObject({ code: "WORKFLOW_NOT_REVIEWED" });
  });

  it("reviews original human decisions behind nested active compaction checkpoints", async () => {
    const draft = await ready(fixture);
    const context = exec();
    const events = new Map([
      [1, { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "Original exclusion after compaction" }] } }],
      [2, { type: "user/message", data: { source: { kind: "qa-notes" }, content: [{ type: "text", text: "Injected decision" }] } }],
      [3, { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "Withdrawn decision" }] } }],
      [4, { type: "user/message", data: { source: { kind: "compact-checkpoint", compactionId: "c1" }, content: [{ type: "text", text: "Untrusted checkpoint claim" }] } }],
      [6, { type: "user/message", data: { source: { kind: "compact-checkpoint", compactionId: "c2" }, content: [{ type: "text", text: "Nested checkpoint claim" }] } }],
    ]);
    Object.assign(context.agent!.session, {
      surface: { nodes: [6] },
      eventAt: (seq: number) => events.get(seq),
      snapshotEvents: () => [
        { type: "compaction/summary", data: { compactionId: "c1", shadowedSeqs: [1, 2] } },
        { type: "compaction/summary", data: { compactionId: "c2", shadowedSeqs: [4] } },
      ],
    });
    const tool = createWorkflowTools({ runtime: fixture.runtime }, fixture.service).find(t => t.name === "document_workflow_review")!;
    await tool.execute({ workflowId: draft.id, revision: draft.revision }, context);
    const task = fixture.review.mock.calls[0]?.[0] ?? "";
    expect(task).toContain("Original exclusion after compaction");
    expect(task).not.toMatch(/Injected decision|Withdrawn decision|Untrusted checkpoint claim|Nested checkpoint claim/u);
  });

  it("gives document review the tool schemas of the native scoped agent context", async () => {
    const draft = await ready(fixture);
    const root = new Context();
    const key = {};
    root.provide("tools", {
      schemas: (scope: unknown) =>
        scope === key ? [{ name: "read" }] : [{ name: "global_tool" }],
    } as never);
    const scope = createScope(root, key);
    const context = exec();
    Object.assign(context.agent!, { ctx: scope.ctx });
    try {
      const tool = createWorkflowTools(
        { runtime: fixture.runtime },
        fixture.service,
      ).find((t) => t.name === "document_workflow_review")!;
      await tool.execute(
        { workflowId: draft.id, revision: draft.revision },
        context,
      );
      expect(fixture.review.mock.calls[0]?.[0]).toMatch(
        /"primaryVisibleTools":\s*\[\s*"read"\s*\]/u,
      );
    } finally {
      await scope.dispose();
    }
  });

  it("registers the workflow operations without any model-facing approval tool", () => {
    const tools = createWorkflowTools(
      { runtime: fixture.runtime },
      fixture.service,
    );
    expect(tools.map((t) => t.name)).toEqual(DOCUMENT_WORKFLOW_TOOL_NAMES);
    expect(tools.some((t) => /approve/u.test(t.name))).toBe(false);
    expect(tools.find(t => t.name === "document_workflow_review")?.timeoutMs)
      .toBe(600_000);
  });
  it("passes source human history to the independent review without treating injected notes as human decisions", async () => {
    const draft = await ready(fixture);
    const tool = createWorkflowTools(
      { runtime: fixture.runtime },
      fixture.service,
    ).find((t) => t.name === "document_workflow_review")!;
    await tool.execute(
      { workflowId: draft.id, revision: draft.revision },
      exec(),
    );
    const task = fixture.review.mock.calls[0]?.[0] ?? "";
    expect(task).toContain("Real human scope decision");
    expect(task).not.toContain("Model-context note");
  });
  it("reviews native clarification answers only when bound to successful question calls", async () => {
    const draft = await ready(fixture);
    const context = exec();
    Object.assign(context.agent!.session, {
      snapshotEvents: () => [
        {
          type: "tool/call",
          data: {
            name: "ask_user_question",
            callId: "q1",
            arguments: "Scope?",
          },
        },
        {
          type: "tool/result",
          data: {
            message: {
              toolCallId: "q1",
              content: [{ type: "text", text: "Pilot one machine then two" }],
            },
          },
        },
        {
          type: "tool/result",
          data: {
            message: {
              toolCallId: "orphan",
              content: [{ type: "text", text: "Unbound answer" }],
            },
          },
        },
        {
          type: "tool/call",
          data: {
            name: "ask_user_question",
            callId: "q2",
            arguments: "Price?",
          },
        },
        {
          type: "tool/result",
          data: {
            message: {
              toolCallId: "q2",
              isError: true,
              content: [{ type: "text", text: "Expired question" }],
            },
          },
        },
      ],
    });
    const tool = createWorkflowTools(
      { runtime: fixture.runtime },
      fixture.service,
    ).find((t) => t.name === "document_workflow_review")!;
    await tool.execute(
      { workflowId: draft.id, revision: draft.revision },
      context,
    );
    const task = fixture.review.mock.calls[0]?.[0] ?? "";
    expect(task).toContain("Scope?");
    expect(task).toContain("Pilot one machine then two");
    expect(task).not.toContain("Unbound answer");
    expect(task).not.toContain("Expired question");
  });

  it("keeps native question answers visible after a reader shortens oversized lines", async () => {
    const draft = await ready(fixture);
    const context = exec();
    const questions = { questions: Array.from({ length: 24 }, (_, i) => ({
      id: `question-${i}`, text: "Clarification text ".repeat(30),
    })) };
    const answers = { answers: [{ id: "question-7", custom: "Confirmed local server; pilot one of four, then three after written acceptance." }] };
    Object.assign(context.agent!.session, {
      snapshotEvents: () => [
        { type: "tool/call", data: { name: "ask_user_question", callId: "long-form", arguments: JSON.stringify(questions) } },
        { type: "tool/result", data: { message: { toolCallId: "long-form", isError: false, content: [{ type: "text", text: JSON.stringify(answers) }] } } },
      ],
    });
    fixture.review.mockImplementationOnce(async (task) => {
      const relative = task.match(/review-packet: ([^\n]+)/u)?.[1];
      expect(relative).toBeDefined();
      const packet = await readFile(path.join(fixture.scope.workspaceRoot, relative!), "utf8");
      const preview = packet.split("\n").map(line => line.slice(0, 2000)).join("\n");
      expect(preview).toContain(answers.answers[0]!.custom);
      expect(preview).toContain('"id": "question-7"');
      return { pass: true, summary: "All human answers readable", issues: [] };
    });
    const tool = createWorkflowTools({ runtime: fixture.runtime }, fixture.service).find(t => t.name === "document_workflow_review")!;
    await tool.execute({ workflowId: draft.id, revision: draft.revision }, context);
  });

  it("refuses both general creation and conversion before an active draft is approved", async () => {
    await ready(fixture);
    const tools = createDocumentTools({
      runtime: fixture.runtime,
      authorizeRender: (scope) => fixture.service.authorizeGeneralRender(scope),
    });
    const create = tools.find((t) => t.name === "document_create")!;
    const convert = tools.find((t) => t.name === "document_convert")!;
    await expect(
      create.execute({ content: CONTENT, formats: ["docx"] }, exec()),
    ).rejects.toMatchObject({ code: "MANAGED_DOCUMENT_REQUIRED" });
    await expect(
      convert.execute({ file: "anything.md", targetFormat: "docx" }, exec()),
    ).rejects.toMatchObject({ code: "MANAGED_DOCUMENT_REQUIRED" });
    expect(fixture.stub.calls.docx).toHaveLength(0);
  });
});
