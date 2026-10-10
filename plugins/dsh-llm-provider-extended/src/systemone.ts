import {
  attributionHeaders,
  LlmError,
  resolveRetryPolicy,
  type GenerateOptions,
  type StreamChunk,
  type LlmResolvedModelInfo,
} from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import type {
  PiAiProviderProfile,
  ResolvedPiAiProviderProfile,
} from "./upstream/config.js";
import { cleanGeneration } from "./generation.js";
import {
  validateDecisionRequest,
  validateDecisionResponse,
} from "./systemone-contract.js";

function hasSettings(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "object") return Object.values(value).some(hasSettings);
  return true;
}

async function abortableKey(
  resolve: () => Promise<string | undefined>,
  signal: AbortSignal,
): Promise<string | undefined> {
  let onAbort: () => void = () => {};
  try {
    return await new Promise<string | undefined>((accept, reject) => {
      onAbort = () => reject(new Error("Credential resolution aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      resolve().then(accept, reject);
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Resolve native decision settings without passing them through a chat catalog. */
export function resolveSystemProfile(
  provider: string,
  source: PiAiProviderProfile,
): ResolvedPiAiProviderProfile {
  const allowed = new Set([
    "api",
    "baseURL",
    "displayName",
    "apiKeyEnv",
    "headers",
    "models",
    "timeoutMs",
    "retryPolicy",
  ]);
  if (
    Object.keys(source).some(
      (key) =>
        !allowed.has(key) &&
        hasSettings(source[key as keyof PiAiProviderProfile]),
    )
  )
    throw new LlmError(
      "System One profile contains unsupported chat or sampling settings",
      "UNSUPPORTED_OPTION",
    );
  if (!provider || source.displayName === "")
    throw new LlmError(
      "System One provider and display names must be nonempty",
      "INVALID_CONFIG",
    );
  if (!source.baseURL)
    throw new LlmError("System One requires a baseURL", "INVALID_CONFIG");
  let url: URL;
  try {
    url = new URL(source.baseURL);
  } catch {
    throw new LlmError(
      "System One baseURL must be a valid HTTP URL",
      "INVALID_CONFIG",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new LlmError(
      "System One baseURL must be an HTTP URL without credentials, query or fragment",
      "INVALID_CONFIG",
    );
  for (const model of source.models ?? []) {
    const allowedModel = new Set(["id", "name", "contextWindow", "input"]);
    if (
      Object.keys(model).some(
        (key) =>
          !allowedModel.has(key) &&
          hasSettings(model[key as keyof typeof model]),
      )
    )
      throw new LlmError(
        "System One model contains unsupported chat or generation settings",
        "UNSUPPORTED_OPTION",
      );
    if (
      model.contextWindow != null &&
      (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1)
    )
      throw new LlmError(
        "System One contextWindow must be a positive safe integer",
        "INVALID_CONFIG",
      );
  }
  try {
    new Headers(source.headers);
  } catch {
    throw new LlmError("System One headers are invalid", "INVALID_CONFIG");
  }
  if (
    !source.models?.length ||
    new Set(source.models.map((m) => m.id)).size !== source.models.length ||
    source.models.some((m) => !m.id)
  )
    throw new LlmError(
      "System One requires unique configured models",
      "INVALID_CONFIG",
    );
  for (const generation of [
    source.generation,
    ...source.models.map((m) => m.generation),
  ])
    if (Object.keys(cleanGeneration(generation)).length)
      throw new LlmError(
        "System One does not accept sampling parameters",
        "UNSUPPORTED_OPTION",
      );
  if (
    source.models.some(
      (m) =>
        m.maxTokens != null ||
        m.input?.some((i) => i !== "text") ||
        (m.reasoningEfforts != null && m.reasoningEfforts !== false) ||
        hasSettings(m.compat),
    )
  )
    throw new LlmError(
      "System One has no output cap, image input, reasoning or chat compatibility options",
      "UNSUPPORTED_OPTION",
    );
  if (
    source.reasoning != null ||
    source.transport != null ||
    source.cacheRetention != null ||
    (source.thinkingBudgets &&
      Object.values(source.thinkingBudgets).some((v) => v != null)) ||
    (source.modelOverrides && Object.keys(source.modelOverrides).length)
  )
    throw new LlmError(
      "System One does not accept chat-specific options",
      "UNSUPPORTED_OPTION",
    );
  const timeoutMs = source.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new LlmError(
      "System One timeout must be 1 through 300000ms",
      "INVALID_CONFIG",
    );
  const { apiKeyEnv, retryPolicy, ...rest } = structuredClone(source);
  return {
    ...rest,
    provider,
    displayName: source.displayName ?? provider,
    ...(apiKeyEnv == null ? {} : { apiKeyEnv: credentialRef(apiKeyEnv) }),
    timeoutMs,
    streamIdleTimeoutMs: timeoutMs,
    maxRequestImageBytes: 1,
    requestImagePixelBudget: 1,
    requestImageMaxBytes: 1,
    retryPolicy: resolveRetryPolicy(retryPolicy, "System One retryPolicy"),
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    modelGeneration: new Map(),
  };
}

export function systemModelInfo(
  profile: ResolvedPiAiProviderProfile,
  model: string,
): LlmResolvedModelInfo {
  // models are preserved only on native decision profiles.
  const descriptor = (profile as PiAiProviderProfile).models?.find(
    (m) => m.id === model,
  );
  if (!descriptor)
    throw new LlmError("Unknown System One model", "UNKNOWN_MODEL");
  return {
    provider: profile.provider,
    id: model,
    name: descriptor.name ?? model,
    inputModalities: ["text"],
    context: { contextWindow: descriptor.contextWindow ?? 32768 },
  };
}

/** One request produces one JSON block; this transport never fabricates streaming or tools. */
export async function* streamSystemOne(
  options: GenerateOptions,
  profile: ResolvedPiAiProviderProfile,
  resolveApiKey: () => Promise<string | undefined>,
): AsyncIterable<StreamChunk> {
  systemModelInfo(profile, options.model);
  if (
    options.tools?.length ||
    options.toolHistory ||
    options.reasoningEffort != null ||
    options.temperature != null ||
    options.stop != null ||
    options.maxTokens != null ||
    options.system != null ||
    options.purpose != null
  )
    throw new LlmError(
      "System One accepts typed decisions only; chat tools and generation options are unsupported",
      "UNSUPPORTED_OPTION",
    );
  if (
    options.messages.length !== 1 ||
    options.messages[0]?.role !== "user" ||
    options.messages[0].content.some((b) => b.type !== "text")
  )
    throw new LlmError(
      "System One requires one user text message containing a JSON state/questions envelope",
      "UNSUPPORTED_CONTENT",
    );
  const text = options.messages[0].content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LlmError(
      "System One input must be JSON containing state and questions",
      "INVALID_REQUEST",
    );
  }
  const request = validateDecisionRequest(raw);
  const timeout = AbortSignal.timeout(profile.timeoutMs ?? 60_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  if (signal.aborted)
    throw new LlmError("System One request aborted", "ABORTED");
  try {
    const key = await abortableKey(resolveApiKey, signal);
    const url = new URL(profile.baseURL!);
    url.pathname = url.pathname.replace(/\/$/u, "");
    if (!url.pathname.endsWith("/systemone")) url.pathname += "/systemone";
    const headers = new Headers(profile.headers);
    for (const [name, value] of Object.entries(attributionHeaders()))
      headers.set(name, value);
    headers.set("Content-Type", "application/json");
    if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: options.model, ...request }),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const code =
        response.status === 401 || response.status === 403
          ? "AUTH"
          : response.status === 429
            ? "RATE_LIMIT"
            : response.status >= 500
              ? "SERVER"
              : "INVALID_REQUEST";
      const retryAfter = response.headers.get("retry-after");
      const retryDelay =
        retryAfter === null
          ? NaN
          : /^\d+(?:\.\d+)?$/u.test(retryAfter)
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - Date.now();
      throw new LlmError(
        `System One request failed with HTTP ${response.status}`,
        code,
        {
          status: response.status,
          ...(Number.isFinite(retryDelay) && retryDelay > 0
            ? { providerRetryAfterMs: retryDelay }
            : {}),
        },
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new LlmError("System One returned an empty body", "PROTOCOL");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 1024 * 1024)
          throw new LlmError("System One response exceeds 1MiB", "PROTOCOL");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new LlmError("System One returned invalid JSON", "PROTOCOL");
    }
    const checked = validateDecisionResponse(value, request);
    const result = JSON.stringify(checked);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: result };
    yield {
      type: "block-end",
      index: 0,
      block: { type: "text", text: result },
    };
    yield {
      type: "usage",
      usage: {
        inputTokens: checked.usage.input_tokens,
        outputTokens: checked.usage.output_tokens,
      },
    };
    yield { type: "finish", reason: { kind: "stop" } };
  } catch (error) {
    if (options.signal?.aborted)
      throw new LlmError("System One request aborted", "ABORTED");
    if (timeout.aborted)
      throw new LlmError("System One request timed out", "TIMEOUT");
    if (error instanceof LlmError) throw error;
    throw new LlmError("System One transport failed", "TRANSPORT");
  }
}
