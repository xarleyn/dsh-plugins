import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAuditSummary,
  countFindings,
  parseAuditAnalysis,
  totalFindings,
  type AuditAnalysis,
  type AuditFinding,
} from "../src/index.js";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );

function analysisOf(name: string): AuditAnalysis {
  const result = parseAuditAnalysis(fixture(name));
  if (!result.ok) throw new Error(`fixture ${name} must parse`);
  return result.analysis;
}

const finding = (severity: string): AuditFinding => ({
  id: "F",
  severity,
  category: "",
  title: "",
  status: "",
  rootCause: "",
  description: "",
  evidence: [],
  recommendationTarget: "",
});

describe("countFindings", () => {
  it("counts the named buckets and catches the rest in `other`", () => {
    const counts = countFindings([
      finding("critical"),
      finding("major"),
      finding("major"),
      finding("minor"),
      finding("observation"),
      finding("catastrophic"),
      finding(""),
    ]);

    expect(counts).toEqual({
      critical: 1,
      major: 2,
      minor: 1,
      observation: 1,
      other: 2,
    });
    expect(totalFindings(counts)).toBe(7);
  });

  it("counts an empty audit as zero rather than as undefined", () => {
    expect(countFindings([])).toEqual({
      critical: 0,
      major: 0,
      minor: 0,
      observation: 0,
      other: 0,
    });
  });
});

describe("buildAuditSummary", () => {
  it("materialises the fields the badge and status bar read", () => {
    const summary = buildAuditSummary({
      analysis: analysisOf("analysis-v1.json"),
      auditId: "session-41b4e63f",
      sessionId: "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
      modifiedAt: "2026-09-17T18:31:54.000Z",
    });

    expect(summary).toMatchObject({
      auditId: "session-41b4e63f",
      sessionId: "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
      verdict: "mixed",
      outcomeStatus: "completed_with_gaps",
      evidenceLevel: "rich",
      model: "demo-model-v1",
      agentPreset: "demo-research",
      modifiedAt: "2026-09-17T18:31:54.000Z",
      schemaVersion: 1,
    });
    expect(summary.findings).toEqual({
      critical: 1,
      major: 1,
      minor: 1,
      observation: 1,
      other: 1,
    });
    // v1 artefacts carry no execution totals, so the summary must not invent them.
    expect(summary.toolCalls).toBeUndefined();
    expect(summary.toolErrors).toBeUndefined();
  });

  it("omits what the artefact omits, rather than emitting empty strings", () => {
    const summary = buildAuditSummary({
      analysis: analysisOf("analysis-v1-minimal.json"),
      auditId: "session-0ad608a8",
      sessionId: "session-0ad608a8-1111-2222-3333-444455556666",
      modifiedAt: "2026-09-18T00:00:00.000Z",
    });

    expect(summary.verdict).toBeUndefined();
    expect(summary.outcomeStatus).toBeUndefined();
    expect(summary.evidenceLevel).toBeUndefined();
    expect(summary.model).toBeUndefined();
    expect(Object.keys(summary).sort()).toEqual([
      "auditId",
      "findings",
      "modifiedAt",
      "schemaVersion",
      "sessionId",
    ]);
  });

  it("keeps an unknown schema visible with a null version", () => {
    const unknown: AuditAnalysis = { kind: "unknown", schemaVersion: 3 };
    const summary = buildAuditSummary({
      analysis: unknown,
      auditId: "session-41b4e63f",
      sessionId: "session-41b4e63f-9e35-4406-927b-25a60b7be2c2",
      modifiedAt: "2026-09-18T00:00:00.000Z",
    });

    expect(summary.schemaVersion).toBe(3);
    expect(summary.verdict).toBeUndefined();
    expect(totalFindings(summary.findings)).toBe(0);
  });
});
