/**
 * The shared check pipeline (design SPEC §6, §19, §23, §28).
 *
 * Every guard (input, stream window, tool, tool-result) funnels through this
 * pipeline: L0 deterministic scan → optional L1 classifier snapshot →
 * monotonic merge (L0 red lines can never be weakened) → sanitized audit
 * event and counters. Surface-specific decision mapping stays in the guards.
 */

import type { ResolvedSafetyGateConfig } from "./config.js";
import type { SafetyClassifierService } from "./classifier/service.js";
import type { SafetyScanner } from "./rules/scanner.js";
import { mergeL0L1 } from "./rules/policy.js";
import { SafetyMetrics } from "./audit/metrics.js";
import { SAFETY_EVENT_TYPES, buildAuditEvent, type SafetyAuditEvent, type SafetyEventType } from "./audit/events.js";
import type { CheckDirection, ContentChannel, SafetyDecision, SafetyErrorCode, SafetyVerdict, ScanResult } from "./types.js";

/** When the L1 classifier should run for a check. */
export type ClassifierTrigger = "always" | "suspicious" | "never";

export interface PipelineCheckInput {
  readonly content: string;
  readonly channel: ContentChannel;
  readonly direction: CheckDirection;
  readonly classifierTrigger: ClassifierTrigger;
  readonly toolName?: string | null;
  readonly sessionId?: string | null;
  readonly turn?: number | null;
  readonly step?: number | null;
  /** Disable the quoted-span downgrade (tool arguments: JSON quotes are structural). */
  readonly allowQuotedDowngrade?: boolean;
}

export interface PipelineCheckResult {
  readonly verdict: SafetyVerdict;
  /** Decision after the monotonic merge, including classifier failure modes. */
  readonly decision: SafetyDecision;
  readonly l0: ScanResult;
  readonly classifierRan: boolean;
  readonly classifierFailure: { code: string; message: string } | null;
  readonly latencyMs: number;
  /** Deterministic L0 decision before any L1 influence. */
  readonly l0Decision: SafetyDecision;
}

export interface CheckPipelineOptions {
  readonly scanner: SafetyScanner;
  readonly classifier: SafetyClassifierService | null;
  readonly config: ResolvedSafetyGateConfig;
  readonly metrics: SafetyMetrics;
  /** Session-event sink; implementations must not throw into the pipeline. */
  readonly emit: (type: SafetyEventType, event: SafetyAuditEvent) => void;
}

/** Stable policy version reported in audit records (design SPEC §23). */
export const POLICY_VERSION = "1";

export class CheckPipeline {
  private readonly scanner: SafetyScanner;
  private readonly classifier: SafetyClassifierService | null;
  private readonly config: ResolvedSafetyGateConfig;
  readonly metrics: SafetyMetrics;
  private readonly emit: (type: SafetyEventType, event: SafetyAuditEvent) => void;

  constructor(options: CheckPipelineOptions) {
    this.scanner = options.scanner;
    this.classifier = options.classifier;
    this.config = options.config;
    this.metrics = options.metrics;
    this.emit = options.emit;
  }

  /** Run the two-layer check for one piece of content. Never throws. */
  async run(input: PipelineCheckInput): Promise<PipelineCheckResult> {
    const startedAt = Date.now();
    this.metrics.recordCheck(input.channel);

    let l0: ScanResult;
    try {
      l0 = this.scanner.scan(input.content, { allowQuotedDowngrade: input.allowQuotedDowngrade ?? true });
    } catch {
      // A broken scanner must never take the harness down: treat as allow.
      l0 = { findings: [], decision: "allow", categories: [], scannedChars: 0, truncated: false };
    }

    const wantsClassifier =
      this.classifier !== null &&
      this.classifier.enabled &&
      (input.classifierTrigger === "always" || (input.classifierTrigger === "suspicious" && l0.decision !== "allow"));

    let l1: SafetyVerdict | null = null;
    let l1Failure: SafetyDecision | null = null;
    let classifierRan = false;
    let failure: { code: string; message: string } | null = null;

    if (wantsClassifier && this.classifier !== null) {
      classifierRan = true;
      const request =
        input.channel === "tool"
          ? await this.classifier.classifyTool(input.content, input.toolName ?? "unknown")
          : input.channel === "text" || input.channel === "reasoning"
            ? await this.classifier.classifyOutput(input.content, input.channel)
            : await this.classifier.classifyInput(input.content);
      if (request.usage !== null || request.failure === null) {
        this.metrics.recordClassifierCall(request.usage, request.latencyMs);
      }
      if (request.failure !== null) {
        this.metrics.recordClassifierError();
        failure = { code: request.failure.code, message: request.failure.message };
        l1Failure = this.classifier.resolveFailure(request.failure.code, request.failure.message).decision;
        this.emitClassifierError(input, request.failure.code, request.failure.message, request.latencyMs);
      } else if (request.verdict !== null) {
        l1 = request.verdict;
      }
    }

    const merged = mergeL0L1(l0, l1, l1Failure ?? undefined);
    const decision = merged.decision;

    if (decision === "warn") this.metrics.recordWarn();
    if (decision === "block") this.metrics.recordBlock(blockBucket(input.channel));

    this.emitAudit(input, merged, {
      classifierRan,
      failure,
      latencyMs: Date.now() - startedAt,
    });

    return {
      verdict: {
        version: merged.version,
        decision,
        confidence: merged.confidence,
        categories: merged.categories,
        summary: merged.summary,
        ...(merged.policyRuleIds !== undefined ? { policyRuleIds: merged.policyRuleIds } : {}),
      },
      decision,
      l0,
      classifierRan,
      classifierFailure: failure,
      latencyMs: Date.now() - startedAt,
      l0Decision: merged.l0Decision,
    };
  }

  private emitClassifierError(
    input: PipelineCheckInput,
    code: string,
    message: string,
    latencyMs: number,
  ): void {
    if (!this.config.audit.enabled) return;
    const verdict = {
      version: 1 as const,
      decision: "allow" as SafetyDecision,
      confidence: 0,
      categories: [],
      summary: message.slice(0, 200),
      policyRuleIds: undefined,
    };
    const event = buildAuditEvent({
      turn: input.turn ?? null,
      step: input.step ?? null,
      direction: input.direction,
      channel: input.channel,
      toolName: input.toolName ?? null,
      decision: "allow",
      verdict,
      content: input.content,
      policyVersion: POLICY_VERSION,
      classifier: {
        provider: this.config.classifier.provider || this.config.classifier.baseURL,
        model: this.config.classifier.model,
        ran: true,
      },
      latencyMs,
      includeRawContent: false,
      errorCode: code as never,
    });
    this.emit(SAFETY_EVENT_TYPES.classifierError, event);
  }

  private emitAudit(
    input: PipelineCheckInput,
    merged: SafetyVerdict & { l0Decision: SafetyDecision },
    meta: { classifierRan: boolean; failure: { code: string; message: string } | null; latencyMs: number },
  ): void {
    if (!this.config.audit.enabled) return;
    const eventType: SafetyEventType =
      merged.decision === "block"
        ? SAFETY_EVENT_TYPES.block
        : merged.decision === "warn"
          ? SAFETY_EVENT_TYPES.warn
          : SAFETY_EVENT_TYPES.check;
    const event = buildAuditEvent({
      turn: input.turn ?? null,
      step: input.step ?? null,
      direction: input.direction,
      channel: input.channel,
      toolName: input.toolName ?? null,
      decision: merged.decision,
      verdict: merged,
      content: input.content,
      policyVersion: POLICY_VERSION,
      classifier: {
        provider: meta.classifierRan
          ? this.config.classifier.provider || this.config.classifier.baseURL
          : "",
        model: meta.classifierRan ? this.config.classifier.model : "",
        ran: meta.classifierRan,
      },
      latencyMs: meta.latencyMs,
      includeRawContent: this.config.audit.includeRawContent,
      errorCode: meta.failure?.code as SafetyErrorCode | undefined,
    });
    this.emit(eventType, event);
  }
}

function blockBucket(channel: ContentChannel): "input" | "output" | "reasoning" | "tools" | "tool-results" {
  switch (channel) {
    case "input":
      return "input";
    case "text":
      return "output";
    case "reasoning":
      return "reasoning";
    case "tool":
      return "tools";
    case "tool-result":
      return "tool-results";
  }
}
