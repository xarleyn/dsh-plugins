/** Unit tests for `dsh_lightrag_query` (SPEC §4.3). */

import { describe, expect, it } from "vitest";

import type { LightRagAnswer } from "../src/client.js";
import { LightRagError } from "../src/errors.js";
import {
  createLightRagQueryTool,
  type LightRagQueryResult,
} from "../src/tools/query.js";
import type { LightRagToolDeps } from "../src/tools/shared.js";
import {
  jsonResponse,
  makeExec,
  testClient,
  testConfig,
  type RecordedCall,
  type TestClient,
} from "./helpers/lightrag.js";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";

const ANSWER = {
  response: "The stand runs three services.",
  references: [
    { reference_id: "1", file_path: "docs/architecture.md", content: null },
    { reference_id: "2", file_path: "docs/deploy.md", content: null },
  ],
  response_time: 0.4,
  llm_generated: true,
};

function makeTool(
  handler: (call: RecordedCall) => Response | Promise<Response> = () =>
    jsonResponse(ANSWER),
  config = testConfig(),
): { tool: ReturnType<typeof createLightRagQueryTool>; stub: TestClient } {
  const stub = testClient(handler, config);
  const deps: LightRagToolDeps = {
    config: stub.config,
    client: stub.client,
    logger: silentPluginLogger(),
  };
  return { tool: createLightRagQueryTool(deps), stub };
}

describe("dsh_lightrag_query", () => {
  it("answers with the references the server cited", async () => {
    const { tool, stub } = makeTool();
    const result = (await tool.execute(
      { question: "what runs on the stand?" },
      makeExec(),
    )) as LightRagQueryResult;

    expect(result.answer).toBe("The stand runs three services.");
    expect(result.referenceCount).toBe(2);
    expect(result.references).toEqual([
      { referenceId: "1", filePath: "docs/architecture.md", content: [] },
      { referenceId: "2", filePath: "docs/deploy.md", content: [] },
    ]);
    expect(result.truncated).toBe(false);
    expect(result.llmGenerated).toBe(true);
    expect(stub.calls[0]?.body).toMatchObject({
      query: "what runs on the stand?",
      mode: "mix",
      top_k: 20,
      include_references: true,
      include_chunk_content: false,
    });
  });

  it("carries the chunk text when content was asked for", async () => {
    const { tool, stub } = makeTool(() =>
      jsonResponse({
        response: "answer",
        references: [
          {
            reference_id: "1",
            file_path: "docs/a.md",
            content: ["first chunk", "second chunk"],
          },
        ],
      }),
    );
    const result = (await tool.execute(
      { question: "q", withContent: true },
      makeExec(),
    )) as LightRagQueryResult;
    expect(stub.calls[0]?.body).toMatchObject({ include_chunk_content: true });
    expect(result.references[0]?.content).toEqual([
      "first chunk",
      "second chunk",
    ]);
  });

  it("lets the call override the configured mode and topK", async () => {
    const { tool, stub } = makeTool(
      () => jsonResponse(ANSWER),
      testConfig({ query: { mode: "mix", topK: 20 } }),
    );
    await tool.execute({ question: "q", mode: "naive", topK: 5 }, makeExec());
    expect(stub.calls[0]?.body).toMatchObject({ mode: "naive", top_k: 5 });
  });

  it("falls back to the configured mode when the call names none", async () => {
    const { tool, stub } = makeTool(
      () => jsonResponse(ANSWER),
      testConfig({ query: { mode: "global" } }),
    );
    await tool.execute({ question: "q" }, makeExec());
    expect(stub.calls[0]?.body).toMatchObject({ mode: "global" });
  });

  it("rejects a mode outside the server's set before any request", async () => {
    // The parameter schema carries the server's enum, so the model cannot name
    // a mode the server would reject; the configured fallback still protects a
    // configuration typo (see resolveQueryMode).
    const { tool, stub } = makeTool();
    await expect(
      tool.execute({ question: "q", mode: "semantic" as never }, makeExec()),
    ).rejects.toThrow(/must be one of/u);
    expect(stub.calls).toHaveLength(0);
  });

  it("clamps topK into the corridor the plugin accepts", async () => {
    const over = makeTool();
    await over.tool.execute({ question: "q", topK: 10_000 }, makeExec());
    expect(over.stub.calls[0]?.body).toMatchObject({ top_k: 200 });

    const under = makeTool();
    await under.tool.execute({ question: "q", topK: 0 }, makeExec());
    expect(under.stub.calls[0]?.body).toMatchObject({ top_k: 1 });
  });

  it("bounds the answer and says that it did", async () => {
    const { tool } = makeTool(
      () => jsonResponse({ response: "x".repeat(5_000) }),
      testConfig({ query: { maxAnswerBytes: 1_024 } }),
    );
    const result = (await tool.execute(
      { question: "q" },
      makeExec(),
    )) as LightRagQueryResult;
    expect(result.truncated).toBe(true);
    expect(result.answer).toContain("truncated at 1024 bytes");
    expect(Buffer.byteLength(result.answer, "utf8")).toBeLessThan(1_200);
  });

  it("marks a canned answer as not generated from the index", async () => {
    const { tool } = makeTool(() =>
      jsonResponse({
        response: "No relevant context found.",
        llm_generated: false,
      }),
    );
    const result = (await tool.execute(
      { question: "q" },
      makeExec(),
    )) as LightRagQueryResult;
    expect(result.llmGenerated).toBe(false);
    expect(result.referenceCount).toBe(0);
  });

  it("assumes a generated answer when the server omits the flag", async () => {
    const { tool } = makeTool(() => jsonResponse({ response: "answer" }));
    const result = (await tool.execute(
      { question: "q" },
      makeExec(),
    )) as LightRagQueryResult;
    expect(result.llmGenerated).toBe(true);
  });

  it("refuses a blank question before any request", async () => {
    const { tool, stub } = makeTool();
    await expect(
      tool.execute({ question: "   " }, makeExec()),
    ).rejects.toBeInstanceOf(LightRagError);
    await expect(
      tool.execute({ question: "   " }, makeExec()),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(stub.calls).toHaveLength(0);
  });

  it("forwards the caller's cancellation to the request", async () => {
    const controller = new AbortController();
    const { tool, stub } = makeTool();
    await tool.execute({ question: "q" }, makeExec(controller.signal));
    expect(stub.calls[0]?.signal?.aborted).toBe(false);
    controller.abort();
    expect(stub.calls[0]?.signal?.aborted).toBe(true);
  });

  it("surfaces a server failure as the plugin's typed error", async () => {
    const { tool } = makeTool(() => jsonResponse({}, 500));
    await expect(
      tool.execute({ question: "q" }, makeExec()),
    ).rejects.toMatchObject({ code: "server-error" });
  });

  it("renders the answer with its sources", async () => {
    const { tool } = makeTool();
    const result = (await tool.execute(
      { question: "q" },
      makeExec(),
    )) as LightRagAnswer;
    const blocks = tool.output.render({ question: "q" }, result as never);
    const text = blocks[0]?.type === "text" ? blocks[0].text : "";
    expect(text).toContain("The stand runs three services.");
    expect(text).toContain("[1] docs/architecture.md");
    expect(text).toContain("2 reference(s)");
  });
});
