import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import * as Provider from "../src/index.js";
import { brandString } from "@deepseek-ai/dsh-brand";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import {
  createMessage,
  createToolResultMessage,
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { ExtendedAdapter } from "../src/adapter.js";
import {
  compilePrivacyRules,
  PrivacyFilter,
  type PrivacySettings,
} from "../src/privacy-rules.js";
import { maskPayload } from "../src/privacy-payload.js";
import {
  Config,
  resolveProfiles,
  type Options,
} from "../src/upstream/config.js";
import { memoryAuth } from "./upstream/auth-double.js";
import {
  closeMockServers,
  mockServer,
  textEvents,
} from "./upstream/mock-server.js";

afterEach(closeMockServers);
async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
function preview(body: unknown, settings: PrivacySettings = {}) {
  return maskPayload(
    body,
    new PrivacyFilter(compilePrivacyRules(settings), "test"),
  );
}
function profiles(baseURL: string, api: string, privacy?: PrivacySettings) {
  const config = Config({
    providers: {
      demo: {
        baseURL,
        api,
        models: [{ id: "m" }],
        ...(privacy && { privacy }),
      },
    },
  });
  return resolveProfiles(config.providers.get() as Options["providers"]);
}
const options: GenerateOptions = {
  provider: "demo",
  model: "m",
  messages: [
    { role: "user", content: [{ type: "text", text: "Демо-продукт" }] },
  ],
};
it("applies the launch-environment dictionary to the stock DeepSeek catalog through the Host LLM seam", async () => {
  const server = await mockServer([{ events: textEvents }]);
  const ctx = new Context();
  vi.stubEnv("DSH_PII_DEMO_CLIENTS", "Синтетический пример\nДемо-продукт");
  vi.stubEnv("DEMO_PROVIDER_KEY", "synthetic-key");
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(Provider, {
      providers: {
        deepseek: {
          baseURL: server.url,
          apiKeyEnv: "DEMO_PROVIDER_KEY",
          privacy: { enabled: true, dictionaryEnv: "DSH_PII_DEMO_CLIENTS" },
        },
      },
    } as Options);
    const chunks = await collect(
      ctx.llm.stream({
        ...options,
        provider: "deepseek",
        model: "deepseek-v4-flash",
      }),
    );
    expect(chunks.at(-1)).toMatchObject({
      type: "finish",
      reason: { kind: "stop" },
    });
    expect(server.requests).toHaveLength(1);
    expect(JSON.stringify(server.requests[0])).toContain("[CLIENT_1_");
    expect(JSON.stringify(server.requests[0])).not.toContain("Демо-продукт");
  } finally {
    vi.unstubAllEnvs();
    await ctx.fiber.dispose();
  }
});
it("uses complete monetary spans, literal dictionaries, fixed-width masks and merged overlaps", () => {
  const content =
    "A+B / a+b / 12 345,67 ₽ / USD 1,234.56 / 3 млн руб. / INV-1234 / метка-Я9 / abcde / 42";
  expect(
    preview(
      { content },
      { dictionary: "A+B\nabc\ncde", masks: "INV-####\nметка-@#" },
    ),
  ).toEqual({
    content:
      "[CLIENT_1_test] / [CLIENT_1_test] / [AMOUNT_1_test] / [AMOUNT_2_test] / [AMOUNT_3_test] / [CUSTOM_1_test] / [CUSTOM_2_test] / [CLIENT_2_test] / 42",
  });
});
it("learns client names from later labels, full names and structured tool output", () => {
  const text = "Тестовый Пример / Демо Лицо";
  const body = {
    messages: [
      { content: text },
      { content: "Клиент:Тестовый Пример" },
      { content: '{"clientName":"Демо Лицо","price":123.45,"units":2}' },
      { content: "Тестовый Пример Демоович" },
    ],
  };
  const masked = preview(body) as typeof body;
  expect(masked.messages[0]?.content).toBe("[CLIENT_1_test] / [CLIENT_2_test]");
  expect(masked.messages[1]?.content).toBe("Клиент:[CLIENT_1_test]");
  expect(JSON.parse(masked.messages[2]!.content)).toEqual({
    clientName: "[CLIENT_2_test]",
    price: "[AMOUNT_1_test]",
    units: 2,
  });
  expect(masked.messages[3]!.content).toBe("[CLIENT_3_test]");
  expect(body.messages[0]?.content).toBe(text);
});
it("rejects malformed and oversized rules without echoing a private entry", () => {
  expect(preview({ content: "Пример Тестов, почта@пример.рф" })).toEqual({
    content: "[CLIENT_1_test], [EMAIL_1_test]",
  });
  expect(preview({ content: "Бюджет: 50 000, цена 12; 5 позиций" })).toEqual({
    content: "Бюджет: [AMOUNT_1_test], цена [AMOUNT_2_test]; 5 позиций",
  });
  for (const masks of ["private-literal", "private-#\\", "#".repeat(129)]) {
    expect(() => compilePrivacyRules({ masks })).toThrow(/Privacy/);
    expect(() => compilePrivacyRules({ masks })).not.toThrow(/private-/);
  }
  expect(() => compilePrivacyRules({ dictionaryEnv: "OTHER_KEY" })).toThrow(
    /DSH_PII_/,
  );
  expect(() =>
    preview({ model: "private-model" }, { dictionary: "private-model" }),
  ).toThrow(/identifier/);
  expect(() => preview({ content: '{"demo@example.test":1}' })).toThrow(
    /JSON key/,
  );
  expect(preview({ content: '{"price":100.01,"price":null}' })).toEqual({
    content: '{"price":null}',
  });
  expect(() => preview({ content: '{"order":9999999999999999999}' })).toThrow(
    /JSON number/,
  );
  expect(() =>
    profiles("https://gateway.example.com", "systemone", { enabled: true }),
  ).toThrow(/masking/);
  expect(() =>
    resolveProfiles({ google: { privacy: { enabled: true } } }),
  ).toThrow(/masking/);
});

it.each(["openai-completions", "openai-responses", "anthropic-messages"])(
  "masks the final %s request including tools and preserves its routing fields",
  async (api) => {
    const server = await mockServer([
      {
        status: 400,
        body: '{"error":{"message":"capture complete","type":"bad_request"}}',
      },
    ]);
    const current = profiles(server.url, api, {
      enabled: true,
      dictionary: "Демо-продукт",
      masks: "INV-####",
      dictionaryEnv: "DSH_PII_CLIENTS",
    });
    const adapter = new ExtendedAdapter({
      profiles: () => current,
      auth: memoryAuth(),
      readPrivacyDictionary: () => "Закрытый пример",
      resolveApiKey: async () => "synthetic-key",
    });
    const callId = ToolCallId("call_demo");
    const request: GenerateOptions = {
      ...options,
      sessionId:
        brandString<NonNullable<GenerateOptions["sessionId"]>>(
          "demo@example.test",
        ),
      system: "Доход 45 678,90 ₽. Демо-продукт.",
      messages: [
        ...options.messages,
        createMessage({
          role: "assistant",
          source: {
            kind: "model",
            provider: "demo",
            model: "m",
            replayState: "opaque-history-marker",
          },
          content: [
            { type: "text", text: "demo@example.test" },
            {
              type: "tool-call",
              name: "lookup",
              id: callId,
              arguments: '{"ref":"INV-1234","amount":127.89}',
            },
          ],
        }),
        createToolResultMessage({
          callId,
          isError: false,
          content: [
            { type: "text", text: '{"note":"Закрытый пример","price":56.78}' },
          ],
        }),
        {
          role: "user",
          content: [{ type: "text", text: "Телефон +7 (000) 000-00-00" }],
        },
      ],
      tools: [
        {
          name: "lookup",
          description: "Lookup demo@example.test",
          parameters: {
            type: "object",
            properties: { ref: { type: "string", description: "INV-1234" } },
          },
        },
      ],
    };
    const original = JSON.stringify(request);
    await collect(adapter.stream(request));
    expect(server.requests).toHaveLength(1);
    const wire = JSON.stringify(server.requests[0]);
    for (const value of [
      "Демо-продукт",
      "Закрытый пример",
      "demo@example.test",
      "INV-1234",
      "45 678",
      "127.89",
      "56.78",
      "+7 (000)",
      "opaque-history-marker",
      "DSH_PII_CLIENTS",
    ])
      expect(wire).not.toContain(value);
    for (const kind of ["AMOUNT", "EMAIL", "CLIENT", "CUSTOM", "PHONE"])
      expect(wire).toContain(`[${kind}_`);
    expect(wire).toContain("lookup");
    expect(server.requests[0]).toHaveProperty("model", "m");
    expect(JSON.stringify(server.headers[0])).not.toContain(
      "demo@example.test",
    );
    expect(JSON.stringify(request)).toBe(original);
  },
);
it("keeps prepared policies frozen, aliases request-local, and unprotected traffic intact", async () => {
  const server = await mockServer(
    Array.from({ length: 3 }, () => ({ events: textEvents })),
  );
  let current = profiles(server.url, "openai-completions", {
    enabled: true,
    dictionary: "Демо-продукт",
  });
  const adapter = new ExtendedAdapter({
    profiles: () => current,
    auth: memoryAuth(),
    resolveApiKey: async () => "synthetic-key",
  });
  const prepared = await adapter.prepareCall("demo", "m");
  current = profiles(server.url, "openai-completions");
  const replies = await Promise.all([
    collect(prepared.stream(options)),
    collect(prepared.stream(options)),
  ]);
  expect(replies.every((chunks) => chunks.at(-1)?.type === "finish")).toBe(
    true,
  );
  expect(JSON.stringify(server.requests)).not.toContain("Демо-продукт");
  expect(server.requests[0]).not.toEqual(server.requests[1]);
  await collect(adapter.stream(options));
  expect(JSON.stringify(server.requests[2])).toContain("Демо-продукт");
});
it("sends zero HTTP requests when a private dictionary, image or structural field cannot be protected", async () => {
  const server = await mockServer([]);
  let current = profiles(server.url, "openai-completions", {
    enabled: true,
    dictionaryEnv: "DSH_PII_CLIENTS",
  });
  const key = vi.fn(async () => "synthetic-key");
  const adapter = new ExtendedAdapter({
    profiles: () => current,
    auth: memoryAuth(),
    resolveApiKey: key,
  });
  await expect(collect(adapter.stream(options))).rejects.toThrow(
    /dictionary is unavailable/,
  );
  current = profiles(server.url, "openai-completions", {
    enabled: true,
    dictionary: "secret_tool",
  });
  await expect(
    collect(
      adapter.stream({
        ...options,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                attachment: {
                  attachmentId: AttachmentId("image"),
                  mediaType: "image/png",
                  width: 1,
                  height: 1,
                  bytes: 1,
                },
              },
            ],
          },
        ],
      }),
    ),
  ).rejects.toThrow(/text-only/);
  expect(key).not.toHaveBeenCalled();
  await expect(
    collect(
      adapter.stream({
        ...options,
        tools: [
          {
            name: "secret_tool",
            description: "lookup",
            parameters: { type: "object" },
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
  expect(server.requests).toEqual([]);
});
