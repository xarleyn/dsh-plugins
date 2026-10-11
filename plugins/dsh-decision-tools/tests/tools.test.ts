import { describe, expect, it, vi } from "vitest";
import {
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
  validateJsonSchemaValue,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import { DecisionClient } from "../src/client.js";
import { resolveConfig } from "../src/config.js";
import { createTools, TOOL_NAMES } from "../src/tools.js";
import type { Json, Result } from "../src/types.js";
function fixture() {
  const client = new DecisionClient(
    resolveConfig({
      backends: [
        { id: "local", baseUrl: "http://scorer.example", apiKeyEnv: "" },
      ],
    }),
  );
  const ask = vi
    .spyOn(client, "ask")
    .mockImplementation(async (_state, raw) => {
      const qs = raw as { id: string; type: string; criteria: Json }[];
      return {
        backend: "local",
        model: "demo",
        latencyMs: 1,
        usage: null,
        confidenceMeaning: "demo",
        answers: Object.fromEntries(
          qs.map((q) => [
            q.id,
            q.type === "score"
              ? {
                  type: "score",
                  score: q.id === "preferred" ? 1.8 : 0.4,
                  confidence: 0.8,
                  uncertain: false,
                }
              : q.type === "choice"
                ? {
                    type: "choice",
                    choice: "bug",
                    probabilities: { bug: 0.8, request: 0.2 },
                    confidence: 0.6,
                    uncertain: false,
                  }
                : {
                    type: "noul",
                    noul: 0.8,
                    decision: "yes",
                    uncertain: false,
                  },
          ]),
        ),
      } as Result;
    });
  const tools = createTools(client);
  const exec = { signal: new AbortController().signal } as ToolRunContext;
  const run = async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name)!;
    const violations = validateJsonSchemaValue(tool.parameters, args);
    if (violations.length) throw new Error(violations.join("; "));
    const result = await tool.execute(args, exec);
    expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([]);
    return result;
  };
  return { client, ask, tools, run };
}
describe("native tool contracts", () => {
  it("registers six documented supported input and output schemas", () => {
    const { tools } = fixture();
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      assertObjectJsonSchema(tool.parameters);
      assertSupportedJsonSchema(tool.output.schema);
    }
  });
  it("serves capabilities without contacting the backend", async () => {
    const { run, ask } = fixture();
    expect(await run("dsh_decision_capabilities", {})).toMatchObject({
      defaultBackend: "local",
    });
    expect(ask).not.toHaveBeenCalled();
  });
  it("compiles exclusive and multilabel classification into different native kinds", async () => {
    const { run, ask } = fixture();
    const args = {
      state: "Export crashes",
      instructions: "Classify",
      labels: [
        { id: "bug", description: "Defect" },
        { id: "request", description: "Feature" },
      ],
    };
    await run("dsh_decision_classify", args);
    expect(ask.mock.calls[0]?.[1]).toMatchObject([
      { type: "choice", criteria: { bug: "Defect", request: "Feature" } },
    ]);
    await run("dsh_decision_classify", { ...args, multilabel: true });
    expect(ask.mock.calls[1]?.[1]).toMatchObject([
      { id: "bug", type: "noul" },
      { id: "request", type: "noul" },
    ]);
  });
  it("compiles checks and ordered ratings", async () => {
    const { run, ask } = fixture();
    await run("dsh_decision_check", {
      state: "x",
      criteria: [{ id: "safe", instructions: "Are original files preserved?" }],
    });
    await run("dsh_decision_score", {
      state: "x",
      instructions: "Rate relevance",
      levels: ["low", "medium", "high"],
    });
    expect(ask.mock.calls[0]?.[1]).toMatchObject([
      { id: "safe", type: "noul" },
    ]);
    expect(ask.mock.calls[1]?.[1]).toMatchObject([
      { id: "rating", type: "score", criteria: ["low", "medium", "high"] },
    ]);
  });
  it("ranks all candidates against one rubric and preserves stable input order on ties", async () => {
    const { run } = fixture();
    const result = (await run("dsh_decision_rank", {
      goal: "Preserve originals",
      levels: ["poor", "acceptable", "good"],
      candidates: [
        { id: "other", text: "Change originals" },
        { id: "preferred", text: "Copy and inspect" },
        { id: "same", text: "Change originals" },
      ],
    })) as Result;
    expect(result.ranking?.map((r) => r.id)).toEqual([
      "preferred",
      "other",
      "same",
    ]);
    await expect(
      run("dsh_decision_rank", {
        goal: "g",
        levels: ["low", "high"],
        candidates: [
          { id: "same", text: "one" },
          { id: "same", text: "two" },
        ],
      }),
    ).rejects.toThrow(/unique/);
  });
  it("rejects URL and key arguments through native schemas", async () => {
    const { run } = fixture();
    await expect(
      run("dsh_decision_ask", {
        state: "x",
        questions: [],
        url: "http://scorer.example",
      }),
    ).rejects.toThrow();
  });
});
