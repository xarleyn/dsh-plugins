// @vitest-environment jsdom
/**
 * The browser half: what the view is handed, and what it registers.
 *
 * The registration is the load-bearing part — a tab that never appears, or one
 * that appears before the conversation strip declares its seat, is a silent
 * no-op in a real DSH session.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { AuditPage } from "../src/client/AuditPage.js";
import { createAuditApi, type SessionAuditRemote } from "../src/client/api.js";
import { parseAnalysis } from "../src/client/analysis.js";
import type { AuditSummaryValue, SessionAuditValue } from "../src/types.js";

const SESSION = "session-41b4e63f-9e35-4406-927b-25a60b7be2c2";

const summaryValue = (
  overrides: Partial<AuditSummaryValue> = {},
): AuditSummaryValue => ({
  available: true,
  auditId: "session-41b4e63f",
  sessionId: SESSION,
  verdict: "mixed",
  outcomeStatus: "completed_with_gaps",
  evidenceLevel: "rich",
  model: "demo-model-v1",
  agentPreset: "demo-research",
  toolCalls: -1,
  toolErrors: -1,
  critical: 0,
  major: 1,
  minor: 1,
  observation: 0,
  other: 0,
  schemaVersion: 1,
  modifiedAt: "2026-09-17T18:31:54.000Z",
  ...overrides,
});

const ANALYSIS = JSON.stringify({
  schemaVersion: 1,
  trajectory: { sessionId: SESSION },
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

const auditValue = (
  overrides: Partial<SessionAuditValue> = {},
): SessionAuditValue => ({
  available: true,
  summary: summaryValue(),
  analysisJson: ANALYSIS,
  report:
    "# Trajectory Review\n\n## Verdict\n\nMixed.\n\n## Scorecard\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
  ...overrides,
});

function remoteOf(
  summary: AuditSummaryValue = summaryValue(),
  audit: SessionAuditValue = auditValue(),
): SessionAuditRemote {
  return {
    summary: vi.fn(
      async () =>
        ({ ok: true, value: summary }) as RemoteResult<AuditSummaryValue>,
    ),
    audits: vi.fn(
      async () =>
        ({ ok: true, value: [summary] }) as RemoteResult<AuditSummaryValue[]>,
    ),
    audit: vi.fn(
      async () =>
        ({ ok: true, value: audit }) as RemoteResult<SessionAuditValue>,
    ),
    report: vi.fn(
      async () => ({ ok: true, value: audit.report }) as RemoteResult<string>,
    ),
    analysis: vi.fn(
      async () =>
        ({ ok: true, value: audit.analysisJson }) as RemoteResult<string>,
    ),
  };
}

/**
 * A failed Remote result.
 *
 * The real `RemoteError` carries a name, a message and a details bag; the
 * client facade reads only `code`, so a stub that carries the code is what the
 * code under test can actually observe.
 */
function failed<T>(code: string): Promise<RemoteResult<T>> {
  return Promise.resolve({
    ok: false,
    error: { code },
  } as unknown as RemoteResult<T>);
}

describe("createAuditApi", () => {
  it("unwraps a successful result", async () => {
    const api = createAuditApi(remoteOf());

    await expect(api.summary(SESSION)).resolves.toMatchObject({
      verdict: "mixed",
    });
  });

  it("names the failing call when the Remote reports a failure", async () => {
    const failing = remoteOf();
    failing.summary = () => failed("boom");
    const api = createAuditApi(failing);

    await expect(api.summary(SESSION)).rejects.toThrow(
      /sessionAudit\/summary failed: boom/u,
    );
  });
});

describe("parseAnalysis", () => {
  it("reads a v1 analysis and keeps the raw document", () => {
    const parsed = parseAnalysis(ANALYSIS);

    expect(parsed.known).toBe(true);
    expect(parsed.analysis.kind).toBe("v1");
    expect((parsed.raw as { verdict?: string }).verdict).toBe("mixed");
  });

  it("keeps an unknown schema viewable", () => {
    const parsed = parseAnalysis(JSON.stringify({ schemaVersion: 3 }));

    expect(parsed.known).toBe(false);
    expect(parsed.analysis).toEqual({ kind: "unknown", schemaVersion: 3 });
    expect(parsed.raw).toEqual({ schemaVersion: 3 });
  });

  it("degrades on unreadable text instead of throwing", () => {
    for (const input of ["", "   ", "{ not json"]) {
      const parsed = parseAnalysis(input);
      expect(parsed.known).toBe(false);
      expect(parsed.analysis.kind).toBe("unknown");
    }
  });
});

describe("AuditPage", () => {
  it("renders the empty state for a session with no audit", async () => {
    const api = createAuditApi(remoteOf(summaryValue({ available: false })));
    const { findByText } = render(<AuditPage sessionId={SESSION} api={api} />);

    expect(
      await findByText("No audit available for this session"),
    ).toBeDefined();
  });

  it("renders the status bar and the report once loaded", async () => {
    const api = createAuditApi(remoteOf());
    const { findByText, findByRole, getByText } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );

    expect(await findByText("Mixed")).toBeDefined();
    expect(getByText("1 major · 1 minor")).toBeDefined();
    // The report's own heading, and a table, which the format depends on.
    expect(
      await findByRole("heading", { name: "Trajectory Review" }),
    ).toBeDefined();
    expect(document.querySelector(".dsh-audit-md__table")).not.toBeNull();
  });

  it("offers the three views of the SPEC §38 layout", async () => {
    const api = createAuditApi(remoteOf());
    const { findByRole, getAllByRole } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );
    await findByRole("heading", { name: "Trajectory Review" });

    const tabs = getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Report", "Findings", "JSON"]);
  });

  it("reports a failed load rather than showing an empty audit", async () => {
    const failing = remoteOf();
    failing.audit = () => failed("read-failed");
    const api = createAuditApi(failing);
    const { findByText } = render(<AuditPage sessionId={SESSION} api={api} />);

    // The summary still resolved, so the view says the documents failed
    // rather than claiming there is no audit.
    expect(await findByText(/read-failed/u)).toBeDefined();
  });
});
