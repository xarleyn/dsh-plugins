import { LlmError } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";

/** Optional defaults; omission leaves the provider's own value in control. */
export interface GenerationDefaults {
  /** Sampling temperature from 0 through 2. */
  temperature?: number;
  /** Nucleus probability from 0 through 1. */
  topP?: number;
  /** Positive integer token shortlist; compatible local chat gateways and Anthropic. */
  topK?: number;
  /** Minimum relative probability, supported by compatible local chat gateways. */
  minP?: number;
  /** OpenAI-compatible frequency penalty from -2 through 2. */
  frequencyPenalty?: number;
  /** OpenAI-compatible presence penalty from -2 through 2. */
  presencePenalty?: number;
  /** Safe integer random seed for compatible chat gateways. */
  seed?: number;
  /** One through four nonempty stop sequences. */
  stop?: string[];
}

export const GenerationSchema: z<GenerationDefaults> = z.object({
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  topK: z.number().min(1).step(1),
  minP: z.number().min(0).max(1),
  frequencyPenalty: z.number().min(-2).max(2),
  presencePenalty: z.number().min(-2).max(2),
  seed: z.number().step(1),
  // A union keeps omission distinct from schemastery's implicit empty array.
  stop: z.union([z.array(z.string()), z.const(null)]),
}) as z<GenerationDefaults>;

const fields: Record<string, readonly string[]> = {
  "openai-completions": [
    "temperature",
    "topP",
    "topK",
    "minP",
    "frequencyPenalty",
    "presencePenalty",
    "seed",
    "stop",
  ],
  "openai-responses": ["temperature", "topP"],
  "anthropic-messages": ["temperature", "topP", "topK", "stop"],
};

/** Remove only absent schema values; never remove zero. */
export function cleanGeneration(
  value: GenerationDefaults | undefined,
): GenerationDefaults {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry != null),
  );
}

/** Reject invalid or unrepresentable options rather than silently dropping them. */
export function validateGeneration(
  value: GenerationDefaults | undefined,
  api: string,
): GenerationDefaults {
  const result = cleanGeneration(value);
  const supported = fields[api] ?? ["temperature"];
  for (const [key, entry] of Object.entries(result)) {
    if (!supported.includes(key))
      throw new LlmError(
        `Generation parameter ${key} is unsupported for ${api}`,
        "UNSUPPORTED_OPTION",
      );
    if (key === "stop") {
      if (
        !Array.isArray(entry) ||
        entry.length < 1 ||
        entry.length > 4 ||
        entry.some(
          (v) => typeof v !== "string" || v.length === 0 || v.length > 1024,
        )
      ) {
        throw new LlmError(
          "stop requires one through four nonempty strings of at most 1024 characters",
          "INVALID_CONFIG",
        );
      }
      continue;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry))
      throw new LlmError(
        `Generation parameter ${key} must be finite`,
        "INVALID_CONFIG",
      );
    const low = key.endsWith("Penalty")
      ? -2
      : key === "seed"
        ? Number.MIN_SAFE_INTEGER
        : key === "topK"
          ? 1
          : 0;
    const high =
      key.endsWith("Penalty") || key === "temperature"
        ? 2
        : key === "topK" || key === "seed"
          ? Number.MAX_SAFE_INTEGER
          : 1;
    if (
      entry < low ||
      entry > high ||
      ((key === "seed" || key === "topK") && !Number.isSafeInteger(entry))
    )
      throw new LlmError(
        `Generation parameter ${key} is outside its allowed range`,
        "INVALID_CONFIG",
      );
  }
  if (
    api === "anthropic-messages" &&
    result.temperature !== undefined &&
    result.temperature > 1
  )
    throw new LlmError(
      "Anthropic temperature must be at most 1",
      "INVALID_CONFIG",
    );
  if (
    api === "anthropic-messages" &&
    result.temperature !== undefined &&
    result.topP !== undefined
  )
    throw new LlmError(
      "Configure either temperature or topP for Anthropic",
      "UNSUPPORTED_OPTION",
    );
  return result;
}

/** Add only known sampling fields to an SDK payload, preserving structural fields. */
export function generationPayload(
  payload: unknown,
  generation: GenerationDefaults,
  api: string,
): unknown {
  const checked = validateGeneration(generation, api);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new LlmError(
      "Provider SDK returned an invalid request payload",
      "PROTOCOL",
    );
  const result = { ...payload };
  if (
    checked.temperature !== undefined &&
    (!("temperature" in result) || result.temperature !== checked.temperature)
  )
    throw new LlmError(
      "This model or reasoning mode does not support the configured temperature",
      "UNSUPPORTED_OPTION",
    );
  const spellings: Record<string, string> = {
    topP: "top_p",
    topK: "top_k",
    minP: "min_p",
    frequencyPenalty: "frequency_penalty",
    presencePenalty: "presence_penalty",
    seed: "seed",
    stop: api === "anthropic-messages" ? "stop_sequences" : "stop",
  };
  for (const [key, entry] of Object.entries(checked)) {
    if (key !== "temperature")
      Object.assign(result, { [spellings[key] ?? key]: entry });
  }
  return result;
}
