import { afterEach, describe, expect, it } from "vitest";
import {
  createRewriteTool,
  createStatusTool,
  type RewriteResult,
  type StatusResult,
} from "../src/tools.js";
import { dependencies, execution, json, normal, server } from "./helpers.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function rig(handler = normal) {
  const result = await server(handler);
  cleanup.push(result.close);
  return result;
}

describe("HTTP tool integration", () => {
  it("sends exact prompts and sampling, groups sequentially, and keeps text out of logs", async () => {
    const remote = await rig((request, response, body) => {
      if (request.url === "/completion")
        json(response, {
          content: "Demo Product shipped 12 units.",
          stop_type: "eos",
        });
      else normal(request, response, body);
    });
    const deps = dependencies(remote.endpoint, {
      maxChunkBytes: 256,
      apiKey: "demo-bearer-key",
    });
    const text =
      "Demo Product shipped 12 units. " + "Original sentence. ".repeat(10);
    const tool = createRewriteTool(deps);
    const result = (await tool.execute(
      { text: text + "\n\n" + text, protectedPhrases: ["Demo Product"] },
      execution(),
    )) as RewriteResult;
    expect(result).toMatchObject({
      chunkCount: 2,
      totalChunks: 2,
      truncated: false,
      rewrittenText:
        "Demo Product shipped 12 units.\n\nDemo Product shipped 12 units.",
    });
    expect(result.warnings).toEqual([
      expect.stringContaining("REVIEW_REQUIRED"),
    ]);
    expect(remote.requests.map((entry) => entry.path)).toEqual([
      "/props",
      "/tokenize",
      "/tokenize",
      "/completion",
      "/completion",
    ]);
    for (const entry of remote.requests.filter(
      (item) => item.path === "/completion",
    )) {
      expect(entry.body).toMatchObject({
        temperature: 1,
        top_p: 0.95,
        top_k: 0,
        min_p: 0,
        repeat_penalty: 1,
        n_predict: 2048,
        stream: false,
      });
      expect(entry.body).not.toHaveProperty("stop");
      expect(entry.body).not.toHaveProperty("messages");
      expect(entry.authorization).toBe("Bearer demo-bearer-key");
    }
    expect(JSON.stringify(deps.logger.info.mock.calls)).not.toContain(
      "Demo Product",
    );
    expect(JSON.stringify(deps.logger.info.mock.calls)).not.toContain(
      "demo-bearer-key",
    );
    expect(tool.output.render({}, { ...result })).toEqual([
      expect.objectContaining({ type: "text" }),
    ]);
  });

  it("preflights all groups against actual server capacity before inference", async () => {
    const remote = await rig((request, response, body) => {
      if (request.url === "/props")
        json(response, { default_generation_settings: { n_ctx: 2048 } });
      else normal(request, response, body);
    });
    await expect(
      createRewriteTool(dependencies(remote.endpoint)).execute(
        { text: "Draft." },
        execution(),
      ),
    ).rejects.toThrow("CONTEXT_TOO_LARGE");
    expect(remote.requests.some((entry) => entry.path === "/completion")).toBe(
      false,
    );
  });

  it("caps a larger server context at the model's 8192 tokens", async () => {
    const remote = await rig((request, response, body) => {
      if (request.url === "/props")
        json(response, { default_generation_settings: { n_ctx: 32768 } });
      else if (request.url === "/tokenize")
        json(response, { tokens: Array.from({ length: 7000 }, () => 1) });
      else normal(request, response, body);
    });
    await expect(
      createRewriteTool(dependencies(remote.endpoint)).execute(
        { text: "Draft." },
        execution(),
      ),
    ).rejects.toThrow("CONTEXT_TOO_LARGE");
  });

  it.each([
    { stop_type: "limit" },
    { stopped_limit: true },
    { truncated: true, stop_type: "eos" },
    {},
  ])(
    "surfaces incomplete responses and stops remaining groups: %j",
    async (flags) => {
      const remote = await rig((request, response, body) => {
        if (request.url === "/completion")
          json(response, { content: "Partial.", ...flags });
        else normal(request, response, body);
      });
      const tool = createRewriteTool(
        dependencies(remote.endpoint, { maxChunkBytes: 256 }),
      );
      const result = (await tool.execute(
        { text: "First. ".repeat(30) + "\n\n" + "Second. ".repeat(30) },
        execution(),
      )) as RewriteResult;
      expect(result).toMatchObject({
        truncated: true,
        chunkCount: 1,
        totalChunks: 2,
      });
      expect(result.warnings).toContainEqual(
        expect.stringContaining("TRUNCATED"),
      );
      expect(
        remote.requests.filter((entry) => entry.path === "/completion"),
      ).toHaveLength(1);
    },
  );

  it("bounds the final result without breaking UTF-8", async () => {
    const remote = await rig((request, response, body) => {
      if (request.url === "/completion")
        json(response, { content: "界".repeat(500), stopped_eos: true });
      else normal(request, response, body);
    });
    const result = (await createRewriteTool(
      dependencies(remote.endpoint, { maxOutputBytes: 1024 }),
    ).execute({ text: "Draft." }, execution())) as RewriteResult;
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.rewrittenText)).toBeLessThanOrEqual(1024);
    expect(result.rewrittenText).not.toContain("�");
  });

  it("reports changed numbers/phrases and experimental Russian", async () => {
    const remote = await rig((request, response, body) => {
      if (request.url === "/completion")
        json(response, {
          content: "English answer with 13 units.",
          stop_type: "eos",
        });
      else normal(request, response, body);
    });
    const result = (await createRewriteTool(
      dependencies(remote.endpoint),
    ).execute(
      { text: "Демо-продукт: 12 единиц.", protectedPhrases: ["Демо-продукт"] },
      execution(),
    )) as RewriteResult;
    for (const code of [
      "NUMBER_MISMATCH",
      "PROTECTED_PHRASE_MISMATCH",
      "LANGUAGE_MISMATCH",
      "EXPERIMENTAL_LANGUAGE",
    ]) {
      expect(result.warnings).toContainEqual(expect.stringContaining(code));
    }
  });

  it.each([
    { text: "" },
    { text: "x".repeat(70000) },
    { text: "Draft.", protectedPhrases: ["Absent"] },
    { text: " Draft. ", protectedPhrases: [" Draft."] },
    { text: "```js\nx()\n```" },
  ])("rejects invalid input before HTTP: %j", async (args) => {
    const remote = await rig();
    await expect(
      createRewriteTool(dependencies(remote.endpoint)).execute(
        args,
        execution(),
      ),
    ).rejects.toThrow();
    expect(remote.requests).toHaveLength(0);
  });

  it("reports ready status without inference or filesystem details", async () => {
    const remote = await rig();
    const result = (await createStatusTool(
      dependencies(remote.endpoint),
    ).execute({}, execution())) as StatusResult;
    expect(result).toEqual({
      status: "ready",
      contextTokens: 8192,
      errorCode: "",
    });
    expect(remote.requests.map((entry) => entry.path)).toEqual([
      "/health",
      "/props",
    ]);
    expect(JSON.stringify(result)).not.toContain("/private");
  });

  it("reports loading without props or inference", async () => {
    const remote = await rig((_request, response) =>
      json(response, { error: { message: "Loading model" } }, 503),
    );
    expect(
      await createStatusTool(dependencies(remote.endpoint)).execute(
        {},
        execution(),
      ),
    ).toEqual({ status: "loading", contextTokens: 0, errorCode: "" });
    expect(remote.requests).toHaveLength(1);
  });

  it("returns unavailable with a sanitized HTTP code", async () => {
    const remote = await rig((_request, response) =>
      json(response, { secret: "private server response" }, 401),
    );
    expect(
      await createStatusTool(dependencies(remote.endpoint)).execute(
        {},
        execution(),
      ),
    ).toEqual({
      status: "unavailable",
      contextTokens: 0,
      errorCode: "HTTP_401",
    });
  });
});
