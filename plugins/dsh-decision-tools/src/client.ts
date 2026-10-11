import type { Config } from "./config.js";
import { answers, questions, state } from "./validate.js";
import {
  DecisionError,
  estimateTokens,
  type Question,
  type Result,
} from "./types.js";

interface Waiter {
  signal: AbortSignal;
  abort: () => void;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
}
/** One cancelable FIFO queue shared by the plugin's tools. */
export class Gate {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {}
  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted)
      return Promise.reject(
        new DecisionError("CANCELLED", "request cancelled"),
      );
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.release());
    }
    if (this.waiting.length >= this.maxQueue)
      return Promise.reject(
        new DecisionError("BUSY", "decision queue is full; retry later"),
      );
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new DecisionError("CANCELLED", "queued request cancelled"));
        },
      };
      this.waiting.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
      if (signal.aborted) waiter.abort();
    });
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) {
        next.signal.removeEventListener("abort", next.abort);
        next.resolve(this.release());
      } else this.active--;
    };
  }
}
export function endpoint(base: string): string {
  const url = new URL(base);
  if (url.pathname === "/") url.pathname = "/v1/systemone";
  return url.href;
}
async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body)
    throw new DecisionError(
      "INVALID_RESPONSE",
      "backend returned an empty response",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new DecisionError(
          "RESPONSE_LIMIT",
          "backend response exceeds configured byte limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}
/** JSON parsing with duplicate-object-key rejection, including escaped keys. */
export function parseResponse(source: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new DecisionError(
      "INVALID_RESPONSE",
      "backend returned malformed JSON",
    );
  }
  const stack: { object: boolean; key: boolean; seen: Set<string> }[] = [];
  for (const match of source.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/gu)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === "{" || token === "[")
      stack.push({
        object: token === "{",
        key: token === "{",
        seen: new Set(),
      });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && current?.object) current.key = true;
    else if (token.startsWith('"') && current?.object && current.key) {
      const key = JSON.parse(token) as string;
      if (current.seen.has(key))
        throw new DecisionError(
          "INVALID_RESPONSE",
          "backend returned duplicate JSON keys",
        );
      current.seen.add(key);
      current.key = false;
    }
  }
  return parsed;
}
export class DecisionClient {
  private readonly gate: Gate;
  private readonly lifetime = new AbortController();
  constructor(
    readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.gate = new Gate(config.maxConcurrency, config.maxQueue);
  }
  close(): void {
    this.lifetime.abort();
  }
  capabilities(): unknown {
    return {
      defaultBackend: this.config.defaultBackend,
      backends: this.config.backends.map((b) => ({
        id: b.id,
        model: b.model,
        kinds: b.kinds,
        capabilitiesSource: "operator configuration",
        credentialConfigured:
          b.apiKeyEnv === "" || !!this.env[b.apiKeyEnv]?.trim(),
      })),
      limits: {
        stateChars: this.config.maxStateChars,
        stateTokens: this.config.maxStateTokens,
        requestTokens: this.config.maxRequestTokens,
        questions: this.config.maxQuestions,
        labels: this.config.maxLabels,
        concurrency: this.config.maxConcurrency,
        queue: this.config.maxQueue,
        timeoutMs: this.config.timeoutMs,
      },
      confidenceMeaning:
        "Backend-specific model scores, not calibrated probabilities of correctness. Choice is exclusive; use separate nouls for multiple labels. Shared Jeff questions may affect each other.",
    };
  }
  async ask(
    rawState: unknown,
    rawQuestions: unknown,
    selected: unknown,
    caller: AbortSignal,
  ): Promise<Result> {
    if (!this.config.enabled)
      throw new DecisionError("DISABLED", "decision tools are disabled");
    const name = selected ?? this.config.defaultBackend;
    const backend = this.config.backends.find((b) => b.id === name);
    if (!backend)
      throw new DecisionError(
        "UNKNOWN_BACKEND",
        "select a configured backend id from dsh_decision_capabilities",
      );
    const qs = questions(rawQuestions, this.config);
    const input = state(rawState);
    if (qs.some((q) => !backend.kinds.includes(q.type)))
      throw new DecisionError(
        "UNSUPPORTED_KIND",
        "backend does not declare this question kind",
      );
    const stateText = typeof input === "string" ? input : JSON.stringify(input);
    if (
      stateText.length > this.config.maxStateChars ||
      estimateTokens(stateText) > this.config.maxStateTokens
    )
      throw new DecisionError(
        "STATE_LIMIT",
        "state exceeds configured character/token limit; select a smaller explicit excerpt",
      );
    const wireQuestions = Object.fromEntries(qs.map(({ id, ...q }) => [id, q]));
    const body = JSON.stringify({
      model: backend.model,
      state: input,
      questions: wireQuestions,
    });
    if (estimateTokens(body) > this.config.maxRequestTokens)
      throw new DecisionError(
        "REQUEST_LIMIT",
        "state plus questions exceeds request budget; split the call",
      );
    const key =
      backend.apiKeyEnv === ""
        ? undefined
        : this.env[backend.apiKeyEnv]?.trim();
    if (backend.apiKeyEnv !== "" && !key)
      throw new DecisionError(
        "NOT_CONFIGURED",
        "backend credential is unavailable; ask the operator to configure it",
      );
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.config.timeoutMs);
    const signal = AbortSignal.any([
      caller,
      deadline.signal,
      this.lifetime.signal,
    ]);
    const started = Date.now();
    let release: (() => void) | undefined;
    try {
      release = await this.gate.acquire(signal);
      if (signal.aborted)
        throw new DecisionError(
          "CANCELLED",
          "request cancelled before dispatch",
        );
      const response = await this.fetcher(endpoint(backend.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body,
        signal,
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DecisionError(
          `HTTP_${response.status}`,
          "decision backend refused the request; retry later or check backend configuration",
        );
      }
      const parsed = await boundedText(response, this.config.maxResponseBytes);
      const result = this.result(parsed, qs, backend.id);
      return { ...result, latencyMs: Date.now() - started };
    } catch (error) {
      if (deadline.signal.aborted)
        throw new DecisionError(
          "TIMEOUT",
          "decision request deadline exceeded (including queue wait)",
        );
      if (caller.aborted || this.lifetime.signal.aborted)
        throw new DecisionError("CANCELLED", "decision request cancelled");
      if (error instanceof DecisionError) throw error;
      throw new DecisionError(
        "TRANSPORT_ERROR",
        "decision backend connection failed; no automatic provider fallback occurred",
      );
    } finally {
      clearTimeout(timer);
      release?.();
    }
  }
  private result(
    body: string,
    qs: readonly Question[],
    backend: string,
  ): Omit<Result, "latencyMs"> {
    const parsed = parseResponse(body);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new DecisionError(
        "INVALID_RESPONSE",
        "backend response must be an object",
      );
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.model !== "string" ||
      !value.model ||
      value.model.length > 128
    )
      throw new DecisionError(
        "INVALID_RESPONSE",
        "backend must name the returned model",
      );
    let usage: Result["usage"] = null;
    if (value.usage !== undefined) {
      const u = value.usage as Record<string, unknown> | null;
      if (
        !u ||
        !Number.isSafeInteger(u.input_tokens) ||
        Number(u.input_tokens) < 0 ||
        !Number.isSafeInteger(u.output_tokens) ||
        Number(u.output_tokens) < 0
      )
        throw new DecisionError(
          "INVALID_RESPONSE",
          "backend token usage must be nonnegative integers",
        );
      usage = {
        input_tokens: Number(u.input_tokens),
        output_tokens: Number(u.output_tokens),
      };
    }
    return {
      backend,
      model: value.model,
      answers: answers(value.answers, qs, this.config),
      usage,
      confidenceMeaning:
        "Backend-specific confidence and probabilities are not guarantees of correctness. Ordinal score is preserved directly and may differ from the expectation of displayed probabilities.",
    };
  }
}
