import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime, {
  BlockAssembler,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import * as Provider from "../src/index.js";
import { PrivacyReply, remaskReply } from "../src/privacy-reply.js";
import { maskPayload } from "../src/privacy-payload.js";
import { compilePrivacyRules, PrivacyFilter } from "../src/privacy-rules.js";
import type { Options } from "../src/upstream/config.js";
import { closeMockServers, mockServer } from "./upstream/mock-server.js";

afterEach(closeMockServers);
const delta = (text: string, index = 0): StreamChunk => ({
  type: "text-delta",
  text,
  index,
});
const end = (text: string, index = 0): StreamChunk => ({
  type: "block-end",
  index,
  block: { type: "text", text },
});
function beginReply(filter: PrivacyFilter) {
  const reply = new PrivacyReply(filter);
  reply.acceptPayload({
    messages: [
      { role: "user", content: [...filter.replyAliases.keys()].join(" ") },
    ],
  });
  return reply;
}
function textDeltas(chunks: StreamChunk[]): string {
  return chunks
    .flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.text] : []))
    .join("");
}
function fixture(namespace = "a1b2c3d4e5f6") {
  const filter = new PrivacyFilter(compilePrivacyRules({}), namespace);
  const name = filter.alias("CLIENT", "Демо-продукт");
  const amount = filter.alias("AMOUNT", "12\u202f500,00 ₽");
  return { filter, name, amount, reply: beginReply(filter) };
}

it("streams ordinary text immediately and restores a tag at every possible split", () => {
  const { filter, name, amount } = fixture();
  for (let split = 1; split < name.length; split++) {
    const reply = beginReply(filter);
    expect([...reply.push(delta("💬 " + name.slice(0, split)))]).toEqual([
      delta("💬 "),
    ]);
    expect([...reply.push(delta(name.slice(split) + amount + name))]).toEqual([
      delta("Демо-продукт12\u202f500,00 ₽Демо-продукт"),
    ]);
    expect([...reply.push(end("💬 " + name + amount + name))]).toEqual([
      end("💬 Демо-продукт12\u202f500,00 ₽Демо-продукт"),
    ]);
  }
});
it("keeps interleaved blocks independent and forwards tool and reasoning events verbatim", () => {
  const { name, amount, reply } = fixture();
  expect([...reply.push(delta(name.slice(0, 5)))]).toEqual([]);
  expect([...reply.push(delta(amount.slice(0, 4), 2))]).toEqual([]);
  const reasoning = { type: "reasoning-delta", index: 1, text: name } as const;
  expect([...reply.push(reasoning)]).toEqual([reasoning]);
  const toolEnd = {
    type: "block-end",
    index: 1,
    block: {
      type: "tool-call",
      id: "sample",
      name: "lookup",
      arguments: JSON.stringify({ value: name }),
    },
  } as StreamChunk;
  expect([...reply.push(toolEnd)]).toEqual([toolEnd]);
  expect([...reply.push(delta(name.slice(5)))]).toEqual([
    delta("Демо-продукт"),
  ]);
  // Final block contains the rest, without a matching last delta.
  expect([...reply.push(end(amount, 2))]).toEqual([
    delta("12\u202f500,00 ₽", 2),
    end("12\u202f500,00 ₽", 2),
  ]);
});
it("preserves unknown tags, ordinary brackets and unfinished literals at each termination boundary", () => {
  const { name, amount, filter } = fixture();
  const foreign = fixture("123456789abc");
  for (const terminal of [
    end("done [CLIENT_"),
    { type: "finish", reason: { kind: "aborted" } },
  ] as StreamChunk[]) {
    const reply = beginReply(filter);
    expect([...reply.push(delta("done [CLIENT_"))]).toEqual([delta("done ")]);
    expect([...reply.push(terminal)]).toEqual([delta("[CLIENT_"), terminal]);
  }
  const reply = beginReply(filter);
  const raw = `[example] [[] ${foreign.name} [CLIENT_99_a1b2c3d4e5f6] ${amount} ${name}`;
  const chunks = [...raw].flatMap((ch) => [...reply.push(delta(ch))]);
  expect(textDeltas(chunks)).toBe(
    raw.replace(amount, "12\u202f500,00 ₽").replace(name, "Демо-продукт"),
  );
  expect(textDeltas([...foreign.reply.push(delta(name))])).toBe(name);
});
it("declines inconsistent saved offsets and limits repeated expansion", () => {
  const { filter } = fixture();
  expect(() =>
    remaskReply(
      "edited",
      { privacySpans: { digest: "old", spans: [] } },
      filter,
    ),
  ).toThrow(/masking metadata/);
  const long = filter.alias("CUSTOM", "x".repeat(500000));
  const reply = beginReply(filter);
  expect(() => [...reply.push(delta(long.repeat(20)))]).toThrow(/limit/);
});

it("masks a bare price quoted after an interrupted answer with no terminal replay metadata", () => {
  const { filter } = fixture();
  const wire = maskPayload(
    {
      model: "demo",
      max_tokens: 999,
      messages: [
        { role: "tool", content: '{"price":999}' },
        { role: "assistant", content: "Total: 999" },
        { role: "user", content: "Is 999 correct? Order 1999." },
      ],
    },
    filter,
  );
  expect(wire).toMatchObject({
    max_tokens: 999,
    messages: [
      { content: expect.stringContaining("[AMOUNT_") },
      { content: expect.stringMatching(/^Total: \[AMOUNT_/u) },
      {
        content: expect.stringMatching(
          /^Is \[AMOUNT_.* correct\? Order 1999\.$/u,
        ),
      },
    ],
  });
});

it.each([
  (name: string, amount: string) => ({
    messages: [
      { role: "system", content: name },
      { role: "tool", content: amount },
    ],
  }),
  (name: string, amount: string) => ({
    input: [
      { role: "developer", content: name },
      { type: "function_call_output", output: amount },
    ],
  }),
  (name: string, amount: string) => ({
    system: name,
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", content: [{ type: "text", text: amount }] },
        ],
      },
    ],
  }),
])(
  "restores tool results while keeping a system-only original private",
  (payload) => {
    const { name, amount, reply } = fixture();
    reply.acceptPayload(payload(name, amount));
    expect([...reply.push(delta(name + amount))]).toEqual([
      delta(name + "12\u202f500,00 ₽"),
    ]);
  },
);

function echoEvents(body: unknown) {
  const wire = JSON.stringify(body);
  const tags = [
    ...new Set(wire.match(/\[(?:CLIENT|AMOUNT)_\d+_[a-f0-9]{12}\]/gu)),
  ];
  const answer = "Итого " + tags.join(" — ") + ".";
  return [
    ...[...answer].map((content) =>
      JSON.stringify({
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      }),
    ),
    '{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    "[DONE]",
  ];
}
it("round-trips streamed DeepSeek text through the Host and re-masks saved history on a fresh call", async () => {
  const server = await mockServer([
    { events: echoEvents },
    { events: echoEvents },
  ]);
  const ctx = new Context();
  vi.stubEnv("DEMO_REPLY_KEY", "synthetic-key");
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(Provider, {
      providers: {
        deepseek: {
          apiKeyEnv: "DEMO_REPLY_KEY",
          baseURL: server.url,
          privacy: { enabled: true },
        },
      },
    } as Options);
    const route = { provider: "deepseek", model: "deepseek-v4-flash" };
    const run = async (messages: GenerateOptions["messages"]) => {
      const assembler = new BlockAssembler();
      const chunks: StreamChunk[] = [];
      for await (const chunk of ctx.llm.stream({ ...route, messages })) {
        chunks.push(chunk);
        assembler.push(chunk);
      }
      expect(assembler.finish.kind).toBe("stop");
      const stored = assembler.message({
        ...route,
        replayState: assembler.replayState,
      });
      expect(stored.content).toEqual([
        { type: "text", text: textDeltas(chunks) },
      ]);
      return stored;
    };
    const first = await run([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: '{"clientName":"Демо-продукт","price":4729.16}',
          },
        ],
      },
    ]);
    expect(first.content[0]).toEqual({
      type: "text",
      text: "Итого Демо-продукт — 4729.16.",
    });
    // The original JSON and the labels it supplied are absent on this turn.
    const second = await run([
      structuredClone(first),
      { role: "user", content: [{ type: "text", text: "Повтори" }] },
    ]);
    expect(second.content).toEqual(first.content);
    expect(server.requests).toHaveLength(2);
    for (const body of server.requests) {
      const wire = JSON.stringify(body);
      expect(wire).not.toMatch(/Демо-продукт|4729\.16|privacySpans/u);
      expect(wire).toContain("[CLIENT_1_");
      expect(wire).toContain("[AMOUNT_1_");
    }
    const firstTag = JSON.stringify(server.requests[0]).match(
      /\[CLIENT_[^\]]+\]/u,
    )![0];
    expect(JSON.stringify(server.requests[1])).not.toContain(firstTag);
  } finally {
    vi.unstubAllEnvs();
    await ctx.fiber.dispose();
  }
});
