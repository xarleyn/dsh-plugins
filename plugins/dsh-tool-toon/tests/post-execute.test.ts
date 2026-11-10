import { describe, expect, it, vi } from "vitest";
import type {
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import { silentPluginLogger } from "@yadsh/dsh-plugin-log";
import {
  createPostExecuteListener,
  resolveToolToonConfig,
} from "../src/index.js";

const value = {
  items: Array.from({ length: 50 }, (_, id) => ({
    id,
    name: `Demo field ${id}`,
    custom: true,
    searchable: true,
  })),
};
const text = JSON.stringify(value);
const exec = {
  name: "jira_get_fields",
  callId: "synthetic-call",
  arguments: {},
  signal: new AbortController().signal,
} as ToolExecution;
const result = {
  isError: false,
  value,
  content: [{ type: "text", text }],
} as ToolExecutionResult;
const config = resolveToolToonConfig();
const hook = createPostExecuteListener(config, silentPluginLogger());

describe("post-execute contract", () => {
  it("changes only text, preserving canonical values, blocks and contexts", async () => {
    const image = {
      type: "image" as const,
      mimeType: "image/png",
      data: "synthetic",
    };
    const input = {
      ...result,
      content: [
        ...result.content,
        image,
        { type: "text" as const, text: "prose" },
      ],
    } as ToolExecutionResult;
    const original = structuredClone(input);
    const contexts: [] = [];
    const next = vi.fn(async (): Promise<PostToolDecision> => ({
      kind: "accept",
      additionalContexts: contexts,
    }));
    const decision = await hook(exec, input, next);
    expect(next).toHaveBeenCalledOnce();
    expect(decision.kind).toBe("accept");
    if (decision.kind !== "accept") throw new Error("expected accept");
    expect(decision.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/^```toon/u),
    });
    expect(decision.content?.[1]).toBe(image);
    expect(decision.content?.[2]).toBe(input.content[2]);
    expect(decision.additionalContexts).toBe(contexts);
    expect(input).toEqual(original);
    expect(input.value).toBe(value);
  });

  it.each([null, false, 0, "", { replacement: true }])(
    "preserves pending replacement %j",
    async (value) => {
      const decision: PostToolDecision = { kind: "accept", value };
      expect(await hook(exec, result, async () => decision)).toBe(decision);
    },
  );

  it("preserves blocking decisions", async () => {
    const decision: PostToolDecision = {
      kind: "block",
      feedback: [{ type: "text", text: "synthetic policy" }],
    };
    expect(await hook(exec, result, async () => decision)).toBe(decision);
  });

  it("uses the downstream projection instead of resurrecting raw fields", async () => {
    const decision: PostToolDecision = {
      kind: "accept",
      content: [{ type: "text", text: "already summarized" }],
    };
    expect(await hook(exec, result, async () => decision)).toBe(decision);
    const projected = {
      items: value.items.map(({ id }) => ({
        id,
        summary: "Synthetic summary",
      })),
    };
    const output = await hook(exec, result, async () => ({
      kind: "accept",
      content: [{ type: "text", text: JSON.stringify(projected) }],
    }));
    expect(JSON.stringify(output)).not.toContain("searchable");
    expect(JSON.stringify(output)).toContain("toon");
  });

  it.each(["disabled", "error", "nested", "excluded"])(
    "bypasses %s",
    async (kind) => {
      const listener = createPostExecuteListener(
        {
          ...config,
          enabled: kind !== "disabled",
          excludeTools: kind === "excluded" ? [exec.name] : [],
        },
        silentPluginLogger(),
      );
      const decision: PostToolDecision = { kind: "accept" };
      expect(
        await listener(
          kind === "nested"
            ? { ...exec, parent: Symbol("synthetic") as ToolExecution["token"] }
            : exec,
          kind === "error"
            ? {
                isError: true,
                error: { message: "synthetic failure" },
                content: result.content,
              }
            : result,
          async () => decision,
        ),
      ).toBe(decision);
    },
  );

  it("does not swallow downstream exceptions", async () => {
    await expect(
      hook(exec, result, async () => {
        throw new Error("downstream failed");
      }),
    ).rejects.toThrow("downstream failed");
  });

  it("contains formatting failures without leaking payloads to logs", async () => {
    const warn = vi.fn();
    const logger = {
      ...silentPluginLogger(),
      warn,
      debug() {
        throw new Error(text);
      },
    };
    const decision: PostToolDecision = { kind: "accept" };
    expect(
      await createPostExecuteListener(config, logger)(
        exec,
        result,
        async () => decision,
      ),
    ).toBe(decision);
    expect(warn).toHaveBeenCalledWith("toon.format_failed", {
      tool: exec.name,
    });
  });
});
