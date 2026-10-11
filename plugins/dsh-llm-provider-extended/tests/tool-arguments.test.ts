import { afterEach, expect, it } from "vitest";
import { ExtendedAdapter } from "../src/adapter.js";
import { resolveProfiles } from "../src/upstream/config.js";
import { memoryAuth } from "./upstream/auth-double.js";
import { mockServer, closeMockServers } from "./upstream/mock-server.js";
afterEach(closeMockServers);
it("preserves raw JSON tool argument fragments and the completed tool call", async () => {
  const args = JSON.stringify({ path: "example.txt", limit: 3 });
  const fragments = [args.slice(0, 5), args.slice(5, 12), args.slice(12)];
  const events = fragments.map((argumentsDelta, i) =>
    JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                ...(i === 0 ? { id: "demo-call", type: "function" } : {}),
                function: {
                  ...(i === 0 ? { name: "read_demo" } : {}),
                  arguments: argumentsDelta,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
  );
  events.push(
    JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
    "[DONE]",
  );
  const server = await mockServer([{ events }]);
  const profiles = resolveProfiles({
    demo: {
      api: "openai-completions",
      baseURL: server.url,
      models: [{ id: "m" }],
    },
  });
  const adapter = new ExtendedAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => "synthetic-key",
    auth: memoryAuth(),
  });
  let raw = "";
  let final = "";
  const indexes = new Set<number>();
  for await (const c of adapter.stream({
    provider: "demo",
    model: "m",
    messages: [],
  })) {
    if (c.type === "tool-call-delta") {
      raw += c.argumentsDelta;
      indexes.add(c.index);
    }
    if (c.type === "block-end" && c.block.type === "tool-call")
      final = c.block.arguments;
  }
  expect(raw).toBe(args);
  expect(final).toBe(args);
  expect(indexes.size).toBe(1);
});
