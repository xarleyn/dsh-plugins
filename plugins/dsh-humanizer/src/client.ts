import type { ResolvedHumanizerConfig } from "./config.js";

/** Sanitized transport error: no server bodies, text, URLs or bearer keys. */
export class HumanizerError extends Error {
  constructor(readonly code: string) {
    super(`dsh-humanizer: ${code}`);
    this.name = "HumanizerError";
  }
}

export interface Completion {
  readonly text: string;
  readonly truncated: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HumanizerError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

/** All operations use one caller-owned signal; redirect and response bounds apply to every endpoint. */
export class HumanizerClient {
  constructor(readonly config: ResolvedHumanizerConfig) {}

  private async request(
    path: string,
    signal: AbortSignal,
    body?: object,
  ): Promise<{ status: number; data: unknown }> {
    try {
      signal.throwIfAborted();
      const response = await fetch(this.config.endpoint + path, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // Bound even error bodies, which may contain arbitrary server output.
      const reader = response.body?.getReader();
      const buffers: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > this.config.maxOutputBytes + 262144) {
              throw new HumanizerError("RESPONSE_TOO_LARGE");
            }
            buffers.push(next.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      if (!response.ok && !(path === "/health" && response.status === 503)) {
        throw new HumanizerError(`HTTP_${response.status}`);
      }
      let data: unknown;
      try {
        data = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      } catch {
        throw new HumanizerError("INVALID_RESPONSE");
      }
      return { status: response.status, data };
    } catch (error) {
      if (signal.aborted)
        throw new HumanizerError(
          signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED",
        );
      if (error instanceof HumanizerError) throw error;
      throw new HumanizerError("UNAVAILABLE");
    }
  }

  async health(signal: AbortSignal): Promise<"ready" | "loading"> {
    const response = await this.request("/health", signal);
    if (response.status === 503) return "loading";
    if (object(response.data)["status"] !== "ok")
      throw new HumanizerError("INVALID_RESPONSE");
    return "ready";
  }

  async contextTokens(signal: AbortSignal): Promise<number> {
    const response = await this.request("/props", signal);
    const nCtx = object(object(response.data)["default_generation_settings"])[
      "n_ctx"
    ];
    if (typeof nCtx !== "number" || !Number.isSafeInteger(nCtx) || nCtx <= 0)
      throw new HumanizerError("INVALID_RESPONSE");
    return Math.min(8192, nCtx);
  }

  async tokenize(prompt: string, signal: AbortSignal): Promise<number> {
    const response = await this.request("/tokenize", signal, {
      content: prompt,
      add_special: true,
      parse_special: true,
    });
    const tokens = object(response.data)["tokens"];
    if (
      !Array.isArray(tokens) ||
      tokens.length === 0 ||
      !tokens.every((token) => Number.isSafeInteger(token))
    ) {
      throw new HumanizerError("INVALID_RESPONSE");
    }
    return tokens.length;
  }

  async complete(prompt: string, signal: AbortSignal): Promise<Completion> {
    const response = await this.request("/completion", signal, {
      prompt,
      stream: false,
      temperature: 1,
      top_p: 0.95,
      top_k: 0,
      min_p: 0,
      repeat_penalty: 1,
      n_predict: this.config.maxOutputTokens,
      // Constrain sampling to the author's settings even if the server has other defaults.
      samplers: ["top_k", "top_p", "min_p", "temperature"],
      presence_penalty: 0,
      frequency_penalty: 0,
      dry_multiplier: 0,
      mirostat: 0,
      typical_p: 1,
      tfs_z: 1,
      xtc_probability: 0,
      ignore_eos: false,
    });
    const data = object(response.data);
    if (typeof data["content"] !== "string" || !data["content"].trim())
      throw new HumanizerError("EMPTY_RESPONSE");
    // Missing stop metadata cannot be called a complete rewrite.
    const truncated =
      data["truncated"] === true ||
      data["stopped_limit"] === true ||
      data["stop_type"] === "limit" ||
      !(data["stop_type"] === "eos" || data["stopped_eos"] === true);
    return { text: data["content"].trim(), truncated };
  }
}
