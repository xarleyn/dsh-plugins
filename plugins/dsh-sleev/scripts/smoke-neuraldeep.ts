import { Context } from "@deepseek-ai/cordis";
import {
  BlockAssembler,
  CallId,
  createUserMessage,
  LlmRuntime,
  type FinishReason,
  type GenerateOptions,
  type Message,
  type TokenUsage,
  type ToolCallBlock,
  type ToolSchema,
} from "@deepseek-ai/dsh-llm";
import * as LlmPiAi from "@deepseek-ai/dsh-llm-pi-ai";
import SleevIntegrationService from "../src/index.js";
import {
  buildSleevHeaders,
  DEFAULT_SLEEV_GATEWAY_URL,
  EXPERIMENTAL_DSH_HARNESS_ID,
} from "../src/host/optimizer/sleev/headers.js";

const PROVIDER = "sleev-neuraldeep";
const DIRECT_PROVIDER = "direct-neuraldeep";
const MODEL = "gpt-oss-20b";
const UPSTREAM = "https://api.neuraldeep.ru/v1";
const TOOL_MARKER = "SLEEV_TOOL_OK";

interface AssembledResult {
  readonly message: Message;
  readonly usage?: TokenUsage;
  readonly finish: FinishReason;
}

function user(text: string): Message {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: "dsh-sleev-smoke" },
  });
}

async function assemble(
  ctx: Context,
  options: Omit<GenerateOptions, "provider">,
  provider = PROVIDER,
): Promise<AssembledResult> {
  const assembler = new BlockAssembler();
  for await (const chunk of ctx.llm.stream({
    provider,
    ...options,
  })) {
    assembler.push(chunk);
  }
  return {
    message: assembler.message({
      kind: "model",
      provider,
      model: options.model,
      ...(assembler.replayState === undefined
        ? {}
        : { replayState: assembler.replayState }),
    }),
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    finish: assembler.finish,
  };
}

function effectiveInput(usage: TokenUsage | undefined): number | undefined {
  if (usage === undefined) return undefined;
  return (
    usage.inputTokens +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  );
}

function requireFinish(
  label: string,
  result: AssembledResult,
  expected: readonly FinishReason["kind"][],
): AssembledResult {
  if (expected.includes(result.finish.kind)) return result;
  if (result.finish.kind === "error" || result.finish.kind === "aborted") {
    throw new Error(
      `${label} finished as ${result.finish.kind}: ${result.finish.failure.code} ${result.finish.failure.message}`,
    );
  }
  throw new Error(`${label} finished as ${result.finish.kind}`);
}

async function retry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await task();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 3) {
        process.stderr.write(
          `${label} attempt ${attempt} failed; retrying NeuralDeep\n`,
        );
      }
    }
  }
  throw lastError;
}

const markerTool: ToolSchema = {
  name: "return_marker",
  description: "Return a marker string supplied by the caller.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { value: { type: "string" } },
    required: ["value"],
  },
};

async function main(): Promise<void> {
  if (process.env.NEURALDEEP_API_KEY?.trim() === "") {
    throw new Error("NEURALDEEP_API_KEY is blank");
  }
  if (process.env.NEURALDEEP_API_KEY === undefined) {
    throw new Error("NEURALDEEP_API_KEY is required for this live smoke test");
  }

  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SleevIntegrationService, {
      routes: [PROVIDER],
      routePrefixes: [],
      logLevel: "off",
    });
    await ctx.plugin(LlmPiAi, {
      providers: {
        [DIRECT_PROVIDER]: {
          displayName: "Direct / neuraldeep",
          apiKeyEnv: "NEURALDEEP_API_KEY",
          api: "openai-completions",
          baseURL: UPSTREAM,
          models: [{ id: MODEL, name: "GPT OSS 20B direct" }],
          retryPolicy: { mode: "normal", maxRetries: 2 },
        },
        [PROVIDER]: {
          displayName: "Sleev / neuraldeep",
          apiKeyEnv: "NEURALDEEP_API_KEY",
          api: "openai-completions",
          baseURL: DEFAULT_SLEEV_GATEWAY_URL,
          headers: {
            ...buildSleevHeaders({
              kind: "custom",
              baseUrl: UPSTREAM,
              harnessId: EXPERIMENTAL_DSH_HARNESS_ID,
            }),
          },
          models: [{ id: MODEL, name: "GPT OSS 20B via Sleev" }],
          retryPolicy: { mode: "normal", maxRetries: 2 },
        },
      },
    });

    const plainPrompt = "Reply with exactly SLEEV_OK and nothing else.";
    const directPlain = await retry("direct-plain", async () =>
      requireFinish(
        "direct plain call",
        await assemble(
          ctx,
          {
            model: MODEL,
            messages: [user(plainPrompt)],
            maxTokens: 64,
          },
          DIRECT_PROVIDER,
        ),
        ["stop"],
      ),
    );
    if (directPlain.usage === undefined) {
      throw new Error("direct route returned no provider usage");
    }

    const plain = await retry("plain", async () =>
      requireFinish(
        "plain call",
        await assemble(ctx, {
          model: MODEL,
          messages: [user(plainPrompt)],
          maxTokens: 64,
        }),
        ["stop"],
      ),
    );
    if (plain.usage === undefined) {
      throw new Error("Sleev route returned no provider usage");
    }

    const toolPrompt = `Call return_marker once with value ${TOOL_MARKER}. Do not answer in text.`;
    const first = await retry("tool-call", async () =>
      requireFinish(
        "tool call",
        await assemble(ctx, {
          model: MODEL,
          messages: [user(toolPrompt)],
          tools: [markerTool],
          maxTokens: 256,
        }),
        ["tool-calls"],
      ),
    );
    if (first.usage === undefined) {
      throw new Error("Sleev tool call returned no provider usage");
    }
    const call = first.message.content.find(
      (block): block is ToolCallBlock =>
        block.type === "tool-call" && block.name === markerTool.name,
    );
    if (call === undefined) {
      throw new Error(`model did not call ${markerTool.name}`);
    }
    const args = JSON.parse(call.arguments) as { value?: unknown };
    if (args.value !== TOOL_MARKER) {
      throw new Error("tool-call arguments did not preserve the marker");
    }

    const second = await retry("tool-result", async () =>
      requireFinish(
        "tool-result call",
        await assemble(ctx, {
          model: MODEL,
          messages: [
            user(toolPrompt),
            first.message,
            createUserMessage({
              content: [
                {
                  type: "tool-result",
                  toolCallId: CallId(call.id),
                  content: [{ type: "text", text: `${TOOL_MARKER}: accepted` }],
                },
              ],
              source: { kind: "plugin", plugin: "dsh-sleev-smoke" },
            }),
          ],
          tools: [markerTool],
          maxTokens: 128,
        }),
        ["stop"],
      ),
    );
    if (second.usage === undefined) {
      throw new Error("Sleev tool-result call returned no provider usage");
    }

    const telemetry = ctx.sleev.listRecentCalls();
    if (telemetry.length < 3) {
      throw new Error(
        `expected at least 3 telemetry calls, received ${telemetry.length}`,
      );
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          provider: PROVIDER,
          model: MODEL,
          harnessId: EXPERIMENTAL_DSH_HARNESS_ID,
          directPlain: {
            finish: directPlain.finish.kind,
            effectiveInputTokens: effectiveInput(directPlain.usage),
            outputTokens: directPlain.usage.outputTokens,
          },
          plain: {
            finish: plain.finish.kind,
            effectiveInputTokens: effectiveInput(plain.usage),
            outputTokens: plain.usage.outputTokens,
          },
          toolCall: {
            finish: first.finish.kind,
            name: call.name,
            markerPreserved: true,
            effectiveInputTokens: effectiveInput(first.usage),
          },
          toolResult: {
            finish: second.finish.kind,
            effectiveInputTokens: effectiveInput(second.usage),
          },
          telemetryCalls: telemetry.length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await ctx.fiber.dispose();
  }
}

await main();
