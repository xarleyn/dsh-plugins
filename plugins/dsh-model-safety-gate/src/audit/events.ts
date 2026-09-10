/**
 * Sanitized audit records and session-event payloads (design SPEC §23).
 *
 * The plugin publishes four custom session event types. They are log-only
 * (never part of the model surface) and sanitized: content hash plus
 * decision metadata, no raw content unless raw logging is enabled.
 */

import type { CheckDirection, ContentChannel, SafetyDecision, SafetyErrorCode, SafetyVerdict } from "../types.js";
import { contentSha256, rawPreview } from "./sanitizer.js";

/** Custom session event types published by the plugin. */
export const SAFETY_EVENT_TYPES = {
  check: "safety-gate/check",
  block: "safety-gate/block",
  warn: "safety-gate/warn",
  classifierError: "safety-gate/classifier-error",
} as const;

export type SafetyEventType = (typeof SAFETY_EVENT_TYPES)[keyof typeof SAFETY_EVENT_TYPES];

export interface SafetyAuditEvent {
  readonly turn: number | null;
  readonly step: number | null;
  readonly direction: CheckDirection;
  readonly channel: ContentChannel;
  readonly toolName: string | null;
  readonly decision: SafetyDecision;
  readonly categories: readonly string[];
  readonly confidence: number;
  readonly summary: string;
  readonly policyRuleIds: readonly string[];
  readonly classifierProvider: string;
  readonly classifierModel: string;
  readonly classifierRan: boolean;
  readonly latencyMs: number;
  readonly contentSha256: string;
  readonly contentChars: number;
  readonly policyVersion: string;
  readonly errorCode?: SafetyErrorCode;
  /** Present only with `audit.includeRawContent` (opt-in). */
  readonly rawContent?: string;
}

export interface BuildAuditEventInput {
  readonly turn: number | null;
  readonly step: number | null;
  readonly direction: CheckDirection;
  readonly channel: ContentChannel;
  readonly toolName?: string | null;
  readonly decision: SafetyDecision;
  readonly verdict: SafetyVerdict;
  readonly content: string;
  readonly policyVersion: string;
  readonly classifier: {
    readonly provider: string;
    readonly model: string;
    readonly ran: boolean;
  };
  readonly latencyMs: number;
  readonly includeRawContent: boolean;
  readonly rawContentMaxChars?: number;
  readonly errorCode?: SafetyErrorCode;
}

/** Compose one sanitized audit record from a finished check. */
export function buildAuditEvent(input: BuildAuditEventInput): SafetyAuditEvent {
  const event: SafetyAuditEvent = {
    turn: input.turn,
    step: input.step,
    direction: input.direction,
    channel: input.channel,
    toolName: input.toolName ?? null,
    decision: input.decision,
    categories: [...input.verdict.categories],
    confidence: input.verdict.confidence,
    summary: input.verdict.summary,
    policyRuleIds: [...(input.verdict.policyRuleIds ?? [])],
    classifierProvider: input.classifier.provider,
    classifierModel: input.classifier.model,
    classifierRan: input.classifier.ran,
    latencyMs: input.latencyMs,
    contentSha256: contentSha256(input.content),
    contentChars: input.content.length,
    policyVersion: input.policyVersion,
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
    ...(input.includeRawContent
      ? { rawContent: rawPreview(input.content, input.rawContentMaxChars ?? 400) }
      : {}),
  };
  return event;
}
