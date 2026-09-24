/**
 * The QA Surface's audit integration: the badge, the dialog and the controller
 * that decides whether either exists.
 *
 * The provider is optional, so half of these tests are about absence — a page
 * without the audit plugin must render exactly as it did before.
 */
import { vi } from "vitest";
import type {
  QaAuditRemote,
  QaAuditSummary,
  QaSessionAudit,
} from "../../../src/client/audit/types.js";

export const summary = (
  overrides: Partial<QaAuditSummary> = {},
): QaAuditSummary => ({
  available: true,
  auditId: "session-41b4e63f",
  sessionId: "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
  verdict: "mixed",
  outcomeStatus: "completed_with_gaps",
  evidenceLevel: "rich",
  model: "demo-model-v1",
  agentPreset: "demo-research",
  toolCalls: -1,
  toolErrors: -1,
  critical: 0,
  major: 1,
  minor: 2,
  observation: 0,
  other: 0,
  schemaVersion: 1,
  modifiedAt: "2026-09-17T18:31:54.000Z",
  ...overrides,
});

export const ANALYSIS = JSON.stringify({
  schemaVersion: 1,
  trajectory: { sessionId: "session-41b4e63f-9e35-4406-927b-25a60b7be2c2" },
  verdict: "mixed",
  findings: [
    {
      id: "F1",
      severity: "major",
      category: "grounding",
      title: "Asserted without a lookup",
      status: "observed",
      rootCause: "AGENT",
      description: "A ticket state was stated with no tool call.",
      evidence: ["seq:24"],
      recommendationTarget: "agent_instruction",
    },
  ],
  recommendations: [],
  betterTrajectory: [],
  limitations: [],
});

export const document_ = (
  overrides: Partial<QaSessionAudit> = {},
): QaSessionAudit => ({
  available: true,
  summary: summary(),
  analysisJson: ANALYSIS,
  report: "# Trajectory Review\n\n## Verdict\n\nMixed.\n",
  ...overrides,
});

export function remoteOf(
  audit: QaSessionAudit | null = document_(),
  summaryValue: QaAuditSummary = summary(),
): QaAuditRemote {
  return {
    summary: vi.fn(async () => ({ ok: true as const, value: summaryValue })),
    audit: vi.fn(async () =>
      audit === null
        ? { ok: true as const, value: { ...document_(), available: false } }
        : { ok: true as const, value: audit },
    ),
  };
}
