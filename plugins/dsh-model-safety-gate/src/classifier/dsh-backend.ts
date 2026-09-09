/**
 * DSH provider classifier backend (design SPEC §7 "DSH provider").
 *
 * Issues the classifier request through the host LLM runtime
 * (`ctx.llm.stream`) with the configured provider/model pair. The request is
 * identified as plugin-internal by the AsyncLocalStorage marker set in the
 * service, so the plugin's own stream guard passes it through untouched.
 */

import type { ClassifierTransport, ClassifierUsage } from "./service.js";

/** Structural surface of the host LLM runtime — kept narrow for testing. */
export interface DshLlmRuntime {
  stream(options: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<DSHStreamChunk>;
}

export interface DSHStreamChunk {
  readonly type: string;
  readonly text?: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
  readonly reason?: { readonly kind: string };
}

/**
 * Build a `ClassifierTransport` from the host LLM runtime. Collects
 * `text-delta` chunks as the answer, `usage` for accounting, and turns
 * terminal `error`/`aborted` finishes into thrown failures (the service maps
 * them onto failure modes).
 */
export function createDshClassifierTransport(
  llm: DshLlmRuntime,
  options: { provider: string; model: string },
): ClassifierTransport {
  return async (request) => {
    const parts: string[] = [];
    let usage: ClassifierUsage | null = null;
    const stream = llm.stream({
      provider: options.provider,
      model: options.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      signal: request.signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === "text-delta" && typeof chunk.text === "string") {
        parts.push(chunk.text);
        if (parts.join("").length > 20_000) {
          throw new Error("classifier answer exceeded 20000 characters");
        }
      } else if (chunk.type === "usage" && chunk.usage !== undefined) {
        usage = {
          inputTokens: chunk.usage.inputTokens ?? 0,
          outputTokens: chunk.usage.outputTokens ?? 0,
        };
      } else if (chunk.type === "finish" && chunk.reason !== undefined) {
        if (chunk.reason.kind === "error") throw new Error("classifier request failed at the provider");
        if (chunk.reason.kind === "aborted") {
          const abortError = new Error("classifier request aborted");
          abortError.name = "AbortError";
          throw abortError;
        }
      }
    }
    return { text: parts.join(""), ...(usage !== null ? { usage } : {}) };
  };
}
