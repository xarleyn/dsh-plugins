/**
 * OpenAI-compatible classifier backend (design SPEC §7 "OpenAI-compatible
 * endpoint").
 *
 * POSTs a chat-completion request to `<baseURL>/chat/completions` asking for
 * a JSON answer. Loopback endpoints are allowed over plain HTTP; remote
 * endpoints must use HTTPS unless the operator explicitly allows it
 * (`classifier.requireLocal` blocks this backend entirely at config time).
 */

import type { ClassifierTransport } from "./service.js";

/** Minimal fetch surface so tests can inject a stub. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiCompatibleTransport(options: {
  baseURL: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
}): ClassifierTransport {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const base = options.baseURL.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  return async (request) => {
    const response = await fetchImpl(url, {
      method: "POST",
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`classifier endpoint responded ${String(response.status)}`);
    }
    const payload = (await response.json()) as ChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error("classifier endpoint returned no message content");
    }
    const usage =
      payload.usage !== undefined
        ? { inputTokens: payload.usage.prompt_tokens ?? 0, outputTokens: payload.usage.completion_tokens ?? 0 }
        : null;
    return { text, ...(usage !== null ? { usage } : {}) };
  };
}

/** True when the endpoint is loopback (plain HTTP tolerated only there). */
export function isLoopbackBaseURL(baseURL: string): boolean {
  try {
    const parsed = new URL(baseURL);
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
