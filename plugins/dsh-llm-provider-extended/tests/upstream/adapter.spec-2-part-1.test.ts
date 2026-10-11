import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Context } from "@deepseek-ai/cordis";

import LlmRuntime, { ReasoningEffortId } from "@deepseek-ai/dsh-llm";

import * as LlmPiAi from "../../src/upstream/index.js";

import { assemble } from "./assemble.js";

import { closeMockServers, mockServer, textEvents } from "./mock-server.js";

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeMockServers();
});

async function harness(
  baseURL: string,
  overrides: Record<string, unknown> = {},
): Promise<Context> {
  vi.stubEnv("PI_TEST_KEY", "test-key");
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(LlmPiAi, {
    providers: {
      deepseek: { apiKeyEnv: "PI_TEST_KEY", baseURL, ...overrides },
    },
  });
  return ctx;
}

/** Direct adapter over the real profile resolver, with a fixed key per call. */

beforeEach(() => {
  // Configuration carries only the reference; these mounts resolve it from
  // the environment, which is the whole credential plane without a seam.
  vi.stubEnv("PI_TEST_KEY", "test-key");
});
describe("provider profile lifecycle", () => {
  it("keeps adapter helpers off the package root", () => {
    for (const helper of [
      "resolveProfiles",
      "toPiContext",
      "toPiReplayState",
      "toPiAssistant",
      "mapStopReason",
      "mapUsage",
      "toStreamChunks",
    ])
      expect(LlmPiAi).not.toHaveProperty(helper);
  });

  it("registers every profile atomically and unregisters on dispose", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    const fiber = await ctx.plugin(LlmPiAi, {
      providers: {
        openai: {
          retryPolicy: {
            mode: "always",
            backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 },
          },
        },
        anthropic: {},
      },
    });
    expect(ctx.llm.listProviders()).toEqual([
      { id: "openai", name: "openai" },
      { id: "anthropic", name: "anthropic" },
    ]);
    expect(ctx.llm.providerRetryPolicy("openai")).toEqual({
      mode: "always",
      initialDelayMs: 25,
      maxDelayMs: 100,
      jitterRatio: 0.2,
    });
    expect(ctx.llm.providerRetryPolicy("anthropic")).toMatchObject({
      mode: "normal",
      maxRetries: 5,
    });
    await fiber.dispose();
    expect(ctx.llm.listProviders()).toEqual([]);
  });

  it("exposes the installed pi-ai model catalog through provider-neutral metadata", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, { providers: { openai: {} } });
    const models = await ctx.llm.listModels("openai");
    expect(models.find((model) => model.id === "gpt-4.1")).toEqual({
      provider: "openai",
      id: "gpt-4.1",
      name: "GPT-4.1",
      inputModalities: ["text", "image"],
    });
    expect(models.every((model) => model.provider === "openai")).toBe(true);
    const info = await ctx.llm.resolveModelInfo("openai", "gpt-4.1");
    expect(typeof info.context?.contextWindow).toBe("number");
  });

  it("exposes pi-ai model thinking levels verbatim without inventing a provider default", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: { deepseek: {}, openai: {} },
    });

    await expect(
      ctx.llm.resolveModelInfo("deepseek", "deepseek-v4-flash"),
    ).resolves.toMatchObject({
      reasoning: {
        efforts: [
          { id: ReasoningEffortId("off"), name: "Off" },
          { id: ReasoningEffortId("low"), name: "Low" },
          { id: ReasoningEffortId("high"), name: "High" },
          { id: ReasoningEffortId("max"), name: "Max" },
        ],
      },
    });
    const extended = await ctx.llm.resolveModelInfo("openai", "gpt-5.6-sol");
    expect(extended.reasoning?.efforts.map((effort) => effort.id)).toEqual([
      ReasoningEffortId("off"),
      ReasoningEffortId("low"),
      ReasoningEffortId("medium"),
      ReasoningEffortId("high"),
      ReasoningEffortId("xhigh"),
      ReasoningEffortId("max"),
    ]);
    // A catalog model without reasoning is the same case as a hand-declared
    // one: pi-ai reports the single level `off`, which translates to omitting
    // the reasoning option — exactly what naming no effort already does. The
    // capability is reported unavailable rather than offering that control.
    expect(
      (await ctx.llm.resolveModelInfo("openai", "gpt-4.1")).reasoning,
    ).toBeUndefined();
  });

  it("uses a supported profile reasoning value as the model default and rejects an unsupported one", async () => {
    const supported = new Context();
    await supported.plugin(LlmRuntime);
    await supported.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: "max" } },
    });
    await expect(
      supported.llm.resolveModelInfo("deepseek", "deepseek-v4-flash"),
    ).resolves.toMatchObject({
      reasoning: { defaultEffort: ReasoningEffortId("max") },
    });

    // A profile level this model cannot take DESCRIBES as no default rather
    // than failing: resolveModelInfo builds the model catalog, and a catalog
    // that throws takes its whole provider out of every picker — one mis-set
    // field would hide every model on the route, including the ones that do
    // support the level. The request path below is where it is refused.
    const unsupported = new Context();
    await unsupported.plugin(LlmRuntime);
    await unsupported.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: "medium" } },
    });
    const described = await unsupported.llm.resolveModelInfo(
      "deepseek",
      "deepseek-v4-flash",
    );
    expect(described.reasoning?.defaultEffort).toBeUndefined();
    expect(described.reasoning?.efforts.length).toBeGreaterThan(0);
    await expect(
      assemble(unsupported, {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        messages: [],
      }),
    ).resolves.toMatchObject({
      finish: {
        kind: "error",
        failure: { code: "UNSUPPORTED_REASONING_EFFORT" },
      },
    });

    const disabled = new Context();
    await disabled.plugin(LlmRuntime);
    await disabled.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: "off" } },
    });
    await expect(
      disabled.llm.resolveModelInfo("deepseek", "deepseek-v4-flash"),
    ).resolves.toMatchObject({
      reasoning: { defaultEffort: ReasoningEffortId("off") },
    });
  });

  it("serves declared reasoning efforts to selectors and honours the profile default", async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "PI_TEST_KEY",
          api: "openai-completions",
          baseURL: "https://acme.test/v1",
          reasoning: "high",
          models: [
            {
              id: "acme-think",
              contextWindow: 65_536,
              maxTokens: 4096,
              reasoningEfforts: { off: null, low: "low", high: "high" },
            },
          ],
        },
      },
    });

    // Declared levels reach the same seam catalog metadata does, so the
    // effort picker works for a model pi-ai has never heard of.
    await expect(
      ctx.llm.resolveModelInfo("acme-gateway", "acme-think"),
    ).resolves.toMatchObject({
      reasoning: {
        efforts: [
          { id: ReasoningEffortId("off"), name: "Off" },
          { id: ReasoningEffortId("low"), name: "Low" },
          { id: ReasoningEffortId("high"), name: "High" },
        ],
        defaultEffort: ReasoningEffortId("high"),
      },
    });
  });

  it("sends the declared wire spelling and refuses undeclared levels before network I/O", async () => {
    vi.stubEnv("PI_TEST_KEY", "test-key");
    const server = await mockServer([{ events: textEvents }]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "PI_TEST_KEY",
          api: "openai-completions",
          baseURL: `${server.url}/v1`,
          models: [
            {
              id: "acme-think",
              contextWindow: 65_536,
              maxTokens: 4096,
              reasoningEfforts: { off: null, high: "ultra" },
            },
          ],
        },
      },
    });

    await assemble(ctx, {
      provider: "acme-gateway",
      model: "acme-think",
      reasoningEffort: ReasoningEffortId("high"),
      messages: [],
    });
    // The declared value, not the canonical level name, goes on the wire.
    expect(server.requests[0]).toMatchObject({ reasoning_effort: "ultra" });

    const undeclared = await assemble(ctx, {
      provider: "acme-gateway",
      model: "acme-think",
      reasoningEffort: ReasoningEffortId("max"),
      messages: [],
    });
    expect(undeclared.finish).toMatchObject({
      kind: "error",
      failure: { code: "UNSUPPORTED_REASONING_EFFORT" },
    });
    expect(server.requests).toHaveLength(1);
  });

  it("dispatches the compat-switched dialect on a declared route", async () => {
    vi.stubEnv("PI_TEST_KEY", "test-key");
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "PI_TEST_KEY",
          api: "openai-completions",
          baseURL: `${server.url}/v1`,
          // Without the switch pi-ai guesses the dialect from the endpoint
          // URL, and a private gateway's URL says nothing.
          compat: { thinkingFormat: "deepseek" },
          models: [
            {
              id: "acme-think",
              contextWindow: 65_536,
              maxTokens: 4096,
              reasoningEfforts: { off: null, high: "high" },
            },
          ],
        },
      },
    });
    const prompt = (effort: string): Promise<unknown> =>
      assemble(ctx, {
        provider: "acme-gateway",
        model: "acme-think",
        reasoningEffort: ReasoningEffortId(effort),
        messages: [],
      });

    await prompt("high");
    expect(server.requests[0]).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });

    await prompt("off");
    expect(server.requests[1]).toMatchObject({
      thinking: { type: "disabled" },
    });
    expect(server.requests[1]).not.toHaveProperty("reasoning_effort");
  });

  it("keeps the system role on a declared route whose gateway rejects the developer one", async () => {
    vi.stubEnv("PI_TEST_KEY", "test-key");
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "PI_TEST_KEY",
          api: "openai-completions",
          baseURL: `${server.url}/v1`,
          models: [
            // pi-ai sends the system prompt as `developer` to a reasoning
            // model whenever its URL detection says the endpoint is OpenAI —
            // which is what an unrecognized private URL resolves to. Most
            // OpenAI-compatible gateways reject that role.
            {
              id: "acme-think",
              reasoningEfforts: { off: null, high: "high" },
              compat: { supportsDeveloperRole: false },
            },
            { id: "acme-guess", reasoningEfforts: { off: null, high: "high" } },
          ],
        },
      },
    });
    const roles = async (model: string): Promise<string[]> => {
      await assemble(ctx, {
        provider: "acme-gateway",
        model,
        reasoningEffort: ReasoningEffortId("high"),
        system: "you are a harness",
        messages: [],
      });
      const request = server.requests.at(-1) as {
        messages: { role: string }[];
      };
      return request.messages.map((message) => message.role);
    };

    expect(await roles("acme-think")).toEqual(["system"]);
    // The switch is the only thing that changes it: the same route, same
    // endpoint, same reasoning declaration still gets pi-ai's guess.
    expect(await roles("acme-guess")).toEqual(["developer"]);
  });

  it("sends a declared off value as the effort parameter instead of omitting it", async () => {
    vi.stubEnv("PI_TEST_KEY", "test-key");
    const server = await mockServer([{ events: textEvents }]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "PI_TEST_KEY",
          api: "openai-completions",
          baseURL: `${server.url}/v1`,
          models: [
            {
              id: "acme-think",
              contextWindow: 65_536,
              maxTokens: 4096,
              reasoningEfforts: { off: "none", high: "high" },
            },
          ],
        },
      },
    });

    // The adapter strips a selected Off to "no reasoning option", and pi-ai's
    // dispatch reads thinkingLevelMap.off exactly then — so the declared value
    // still reaches the wire, which is the README's promise for `off: none`.
    await assemble(ctx, {
      provider: "acme-gateway",
      model: "acme-think",
      reasoningEffort: ReasoningEffortId("off"),
      messages: [],
    });
    expect(server.requests[0]).toMatchObject({ reasoning_effort: "none" });
  });

  it("holds back reasoning_effort when the endpoint cannot take it", async () => {
    vi.stubEnv("PI_TEST_KEY", "test-key");
    const server = await mockServer([{ events: textEvents }]);
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LlmPiAi, {
      providers: {
        "acme-gateway": {
          apiKeyEnv: "PI_TEST_KEY",
          api: "openai-completions",
          baseURL: `${server.url}/v1`,
          compat: { supportsReasoningEffort: false },
          models: [
            {
              id: "acme-think",
              contextWindow: 65_536,
              maxTokens: 4096,
              reasoningEfforts: { off: null, high: "high" },
            },
          ],
        },
      },
    });

    await assemble(ctx, {
      provider: "acme-gateway",
      model: "acme-think",
      reasoningEffort: ReasoningEffortId("high"),
      messages: [],
    });
    expect(server.requests[0]).not.toHaveProperty("reasoning_effort");
  });

  it("accepts absent credentials for pi-ai ambient authentication", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ambient-key");
    const server = await mockServer([{ events: textEvents }]);
    // A profile that names no reference at all is the one case that defers to
    // pi-ai's own provider-native discovery.
    const ctx = await harness(server.url, { apiKeyEnv: undefined });
    await assemble(ctx, { model: "deepseek-v4-flash", messages: [] });
    expect(server.headers[0]?.authorization).toBe("Bearer ambient-key");
  });
});
