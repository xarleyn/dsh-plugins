/**
 * System One HTTP client (SPEC §18): the one wire implementation shared by
 * every provider preset. A `typesafe` config points it at the hosted Jev
 * endpoint, a `jeff` config at a self-hosted Jeff server, and a `custom`
 * config at any System One-compatible deployment; only the resolved
 * endpoint, key variable and model differ. One HTTP POST per batch,
 * `Authorization: Bearer <key>` from the configured environment variable
 * (an empty `apiKeyEnv` disables the header for keyless local backends),
 * combined timeout + caller cancellation, zero or one network/5xx retry
 * under a tight overall deadline. The API key value never enters logs or
 * reports.
 */

import type { ResolvedJevCompactionConfig } from "../config.js";
import { JevInvalidResponseError, validateJevResponse } from "./validate.js";
import type {
  JevAnswers,
  JevQuestion,
  JevState,
  SystemOneBackend,
} from "./types.js";

/** Error for expected Jev transport failures (timeout, HTTP, auth). */
export class JevTransportError extends Error {
  constructor(message: string) {
    super(`jev-compaction: Jev transport failed: ${message}`);
    this.name = "JevTransportError";
  }
}

/** Error thrown when the configured API key environment variable is unset. */
export class JevApiKeyMissingError extends Error {
  constructor(envName: string) {
    super(`jev-compaction: ${envName} is not configured`);
    this.name = "JevApiKeyMissingError";
  }
}

/** Combine the caller's signal with a timeout into one abort controller. */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("jev request timed out")),
    timeoutMs,
  );
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal !== undefined) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort(signal.reason);
      return controller;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
    },
    { once: true },
  );
  return controller;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal !== undefined) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new JevTransportError("cancelled"));
        },
        { once: true },
      );
    }
  });
}

/** Minimal injectable fetch surface (tests pass a stub). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The live System One decision backend over HTTP. */
export class SystemOneClient implements SystemOneBackend {
  private readonly config: ResolvedJevCompactionConfig;
  private readonly fetcher: FetchLike;

  constructor(
    config: ResolvedJevCompactionConfig,
    fetcher: FetchLike = fetch as never,
  ) {
    this.config = config;
    this.fetcher = fetcher;
  }

  /** Resolve the key from the configured env var; empty env name = keyless. */
  private apiKey(): string | undefined {
    const envName = this.config.jev.apiKeyEnv;
    if (envName.length === 0) return undefined;
    const value = process.env[envName];
    if (typeof value !== "string" || value.length === 0) {
      throw new JevApiKeyMissingError(envName);
    }
    return value;
  }

  private async attempt(
    state: JevState,
    questions: readonly JevQuestion[],
    signal: AbortSignal | undefined,
  ): Promise<JevAnswers> {
    const apiKey = this.apiKey();
    const controller = withTimeout(signal, this.config.jev.timeoutMs);
    try {
      const response = await this.fetcher(this.config.jev.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey === undefined
            ? {}
            : { authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({
          model: this.config.jev.model,
          state,
          questions: Object.fromEntries(
            questions.map((question) => [
              question.name,
              { type: "noul", instructions: question.instructions },
            ]),
          ),
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new JevTransportError(
          `HTTP ${response.status}: ${text.slice(0, 200)}`,
        );
      }
      return validateJevResponse(text, questions);
    } catch (error: unknown) {
      if (error instanceof JevTransportError) throw error;
      if (error instanceof JevInvalidResponseError) throw error;
      if (
        error instanceof Error &&
        /timed out|aborted|cancelled/i.test(error.message)
      ) {
        throw new JevTransportError(error.message);
      }
      throw new JevTransportError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async score(
    state: JevState,
    questions: readonly JevQuestion[],
    signal: AbortSignal | undefined,
  ): Promise<JevAnswers> {
    try {
      return await this.attempt(state, questions, signal);
    } catch (error: unknown) {
      const retryable =
        error instanceof JevTransportError &&
        /\b5\d\d\b|network|fetch failed|ECONN|timed out/i.test(error.message);
      if (!retryable || this.config.jev.retries < 1) throw error;
      await delay(200, signal);
      return this.attempt(state, questions, signal);
    }
  }
}
