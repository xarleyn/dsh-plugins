/**
 * The safety classifier service (design SPEC §7, §21).
 *
 * `SafetyClassifierService` exposes the `classifyInput / classifyOutput /
 * classifyTool` surface. Every call:
 *   1. runs inside the process-local bypass marker (recursion guard);
 *   2. enforces the configured timeout via an AbortController;
 *   3. parses and strictly validates the structured verdict;
 *   4. maps failures (timeout / malformed / unavailable) onto the configured
 *      failure mode instead of throwing into the guarded pipeline.
 *
 * Transports are pluggable: the DSH backend issues the request through
 * `ctx.llm.stream()`, the OpenAI-compatible backend uses `fetch`. Both are
 * adapted behind `ClassifierTransport`, which unit tests replace with fakes.
 */

import { type SafetyDecision, type SafetyErrorCode, type SafetyVerdict, type ContentChannel } from "../types.js";
import type { FailureMode } from "../config.js";
import { buildClassifierPrompt, CLASSIFIER_SYSTEM_PROMPT } from "./prompt.js";
import { extractJsonPayload, validateVerdict } from "./schema.js";
import { isSafetyInternal, runIsolated } from "./isolation.js";

/** Upper bound on content handed to the classifier per request. */
export const CLASSIFIER_MAX_PAYLOAD_CHARS = 6_000;

/** Token accounting for one classifier request (design SPEC §29). */
export interface ClassifierUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ClassifierRequestResult {
  readonly verdict: SafetyVerdict | null;
  readonly failure: { readonly code: SafetyErrorCode; readonly message: string } | null;
  readonly latencyMs: number;
  readonly usage: ClassifierUsage | null;
}

export interface ClassifierTransportRequest {
  readonly system: string;
  readonly prompt: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly signal: AbortSignal;
}

export type ClassifierTransport = (request: ClassifierTransportRequest) => Promise<{ text: string; usage?: ClassifierUsage }>;

/** Decision the caller should take when the classifier did not answer. */
export function failureDecision(failureMode: FailureMode): SafetyDecision | null {
  switch (failureMode) {
    case "closed":
      return "block";
    case "open":
      return "allow";
    case "ask":
      // Escalate to human review; guards translate `review` per surface.
      return "review";
    case "rules-only":
      return null;
  }
}

export interface ClassifyOptions {
  readonly channel: ContentChannel;
  readonly content: string;
  readonly toolName?: string | null;
}

export class SafetyClassifierService {
  private readonly transport: ClassifierTransport | null;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly failureMode: FailureMode;

  constructor(options: {
    transport: ClassifierTransport | null;
    timeoutMs: number;
    maxTokens: number;
    temperature: number;
    failureMode: FailureMode;
  }) {
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs;
    this.maxTokens = options.maxTokens;
    this.temperature = options.temperature;
    this.failureMode = options.failureMode;
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  get failure(): FailureMode {
    return this.failureMode;
  }

  classifyInput(content: string): Promise<ClassifierRequestResult> {
    return this.classify({ channel: "input", content });
  }

  classifyOutput(content: string, channel: Extract<ContentChannel, "text" | "reasoning">): Promise<ClassifierRequestResult> {
    return this.classify({ channel, content });
  }

  classifyTool(content: string, toolName: string): Promise<ClassifierRequestResult> {
    return this.classify({ channel: "tool", content, toolName });
  }

  /**
   * Run one classification. Never throws at the call site: failures become
   * `failure` records for the policy layer. Re-entrant calls made from inside
   * an already-isolated context are refused (`rules-only` semantics) — the
   * stream guard checks `isSafetyInternal()` itself, this is the last line.
   */
  async classify(options: ClassifyOptions): Promise<ClassifierRequestResult> {
    if (isSafetyInternal()) {
      return this.unavailable("classifier call attempted inside the safety-bypass context");
    }
    const transport = this.transport;
    if (transport === null) {
      return this.unavailable("classifier backend is disabled");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("classifier timeout")), this.timeoutMs);
    const startedAt = Date.now();
    try {
      const prompt = buildClassifierPrompt({
        channel: options.channel,
        content: options.content,
        maxPayloadChars: CLASSIFIER_MAX_PAYLOAD_CHARS,
        toolName: options.toolName ?? null,
      });
      const answer = await runIsolated(() =>
        transport({
          system: CLASSIFIER_SYSTEM_PROMPT,
          prompt,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
          signal: controller.signal,
        }),
      );
      const latencyMs = Date.now() - startedAt;
      const verdict = validateVerdict(extractJsonPayload(answer.text));
      return { verdict, failure: null, latencyMs, usage: answer.usage ?? null };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (controller.signal.aborted) {
        return {
          verdict: null,
          failure: { code: "SAFETY_CLASSIFIER_TIMEOUT", message: `classifier did not answer within ${this.timeoutMs}ms` },
          latencyMs,
          usage: null,
        };
      }
      if (error instanceof Error && error.name === "AbortError") {
        return {
          verdict: null,
          failure: { code: "SAFETY_CLASSIFIER_TIMEOUT", message: "classifier request aborted" },
          latencyMs,
          usage: null,
        };
      }
      return {
        verdict: null,
        failure: {
          code: error instanceof Error && "code" in error && (error as { code?: SafetyErrorCode }).code === "SAFETY_CLASSIFIER_INVALID_RESPONSE"
            ? "SAFETY_CLASSIFIER_INVALID_RESPONSE"
            : "SAFETY_CLASSIFIER_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        },
        latencyMs,
        usage: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolve what a failed classification means for the caller. */
  resolveFailure(code: SafetyErrorCode, message: string): { decision: SafetyDecision | null; code: SafetyErrorCode; message: string } {
    return { decision: failureDecision(this.failureMode), code, message };
  }

  private unavailable(message: string): ClassifierRequestResult {
    return {
      verdict: null,
      failure: { code: "SAFETY_CLASSIFIER_UNAVAILABLE", message },
      latencyMs: 0,
      usage: null,
    };
  }
}
