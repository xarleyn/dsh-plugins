// @vitest-environment jsdom
/**
 * The browser half: what the view is handed, and what it registers.
 *
 * The registration is the load-bearing part — a tab that never appears, or one
 * that appears before the conversation strip declares its seat, is a silent
 * no-op in a real DSH session.
 */
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { AuditPage } from "../src/client/AuditPage.js";
import { createAuditApi, type SessionAuditRemote } from "../src/client/api.js";
import { parseAnalysis } from "../src/client/analysis.js";
import type {
  AuditSummaryValue,
  SessionAuditValue,
  UnattachedAuditValue,
} from "../src/types.js";

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

/** One unattached audit, as the host projects it onto the wire. */
const unattachedValue = (
  overrides: Partial<UnattachedAuditValue> = {},
): UnattachedAuditValue => ({
  auditId: "session-unknown",
  status: "unresolved",
  code: "SESSION_NOT_FOUND",
  modifiedAt: "2026-09-19T08:26:00.000Z",
  ...overrides,
});

function remoteOf(
  summary: AuditSummaryValue = summaryValue(),
  audit: SessionAuditValue = auditValue(),
  unattached: readonly UnattachedAuditValue[] = [],
): SessionAuditRemote {
  return {
    summary: vi.fn(
      async () =>
        ({ ok: true, value: summary }) as RemoteResult<AuditSummaryValue>,
    ),
    audits: vi.fn(
      async () =>
        ({
          ok: true,
          value: summary.available ? [summary] : [],
        }) as RemoteResult<AuditSummaryValue[]>,
    ),
    unattached: vi.fn(
      async () =>
        ({ ok: true, value: [...unattached] }) as RemoteResult<
          UnattachedAuditValue[]
        >,
    ),
    audit: vi.fn(
      async () =>
        ({ ok: true, value: audit }) as RemoteResult<SessionAuditValue>,
    ),
    auditById: vi.fn(
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

  it("tells a session with no audit that the root holds audits it cannot show", async () => {
    const api = createAuditApi(
      remoteOf(summaryValue({ available: false }), auditValue(), [
        unattachedValue(),
        unattachedValue({
          auditId: "audit-broken",
          status: "invalid",
          code: "INVALID_JSON",
        }),
      ]),
    );
    const { findByTestId } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );

    const notice = await findByTestId("audit-unattached");
    expect(
      within(notice).getByTestId("audit-unattached-title").textContent,
    ).toBe("2 audits are not shown in any session");
    expect(
      within(notice)
        .getAllByTestId("audit-unattached-reason")
        .map((reason) => reason.textContent),
    ).toEqual([
      "no session matches its directory name, and its analysis names none",
      "analysis.json is not valid JSON",
    ]);
    // The notice stays a list: a reader reaches the stranded audits through the
    // list semantics, not through the wording of the sentence above them.
    expect(within(notice).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says nothing about unattached audits when none exist", async () => {
    const api = createAuditApi(remoteOf(summaryValue({ available: false })));
    const { findByTestId, queryByTestId } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );

    await findByTestId("audit-page-empty");
    expect(queryByTestId("audit-unattached")).toBeNull();
  });

  it("counts one unattached audit in the singular", async () => {
    const api = createAuditApi(
      remoteOf(summaryValue({ available: false }), auditValue(), [
        unattachedValue(),
      ]),
    );
    const { findByTestId } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );

    const notice = await findByTestId("audit-unattached");
    expect(
      within(notice).getByTestId("audit-unattached-title").textContent,
    ).toBe("1 audit is not shown in any session");
    expect(within(notice).getAllByRole("listitem")).toHaveLength(1);
  });

  it("notes unattached audits beside a session's own audit", async () => {
    const api = createAuditApi(
      remoteOf(summaryValue(), auditValue(), [unattachedValue()]),
    );
    const { findByTestId, findByText } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );

    // The reader who has an audit still learns that others are stranded.
    const notice = await findByTestId("audit-unattached");
    expect(
      within(notice).getByTestId("audit-unattached-title").textContent,
    ).toBe("1 audit is not shown in any session");
    expect(await findByText("Mixed")).toBeDefined();
  });

  it("keeps a working audit on screen when the notice cannot be fetched", async () => {
    const failing = remoteOf();
    failing.unattached = () => failed("boom");
    const api = createAuditApi(failing);
    const { findByText, queryByTestId } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );

    expect(await findByText("Mixed")).toBeDefined();
    expect(queryByTestId("audit-unattached")).toBeNull();
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

  it("shows provenance belonging to the selected v2 audit", async () => {
    const value = summaryValue({ schemaVersion: 2, model: "demo/session" });
    const api = createAuditApi(
      remoteOf(
        value,
        auditValue({
          summary: value,
          analysisJson: JSON.stringify({
            schemaVersion: 2,
            trajectory: { sessionId: SESSION, model: "demo/session" },
            audit: {
              producer: { name: "Demo report builder", version: "2.0.0" },
            },
            auditor: { type: "llm", model: "demo/auditor" },
          }),
        }),
      ),
    );
    const view = render(<AuditPage sessionId={SESSION} api={api} />);
    const provenance = within(await view.findByTestId("audit-provenance"));
    await provenance.findByText("demo/auditor");
    expect(
      provenance.getByText("Session model").nextElementSibling?.textContent,
    ).toBe("demo/session");
    expect(
      provenance.getByText("Report producer").nextElementSibling?.textContent,
    ).toBe("Demo report builder");
  });

  it("offers comparison and explains when there is no baseline", async () => {
    const api = createAuditApi(remoteOf());
    const { findByRole, getAllByRole } = render(
      <AuditPage sessionId={SESSION} api={api} />,
    );
    await findByRole("heading", { name: "Trajectory Review" });

    const tabs = getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Report", "Findings", "JSON", "Compare"]);
    fireEvent.click(await findByRole("tab", { name: "Compare" }));
    expect((await findByRole("tabpanel")).textContent).toContain(
      "A second audit is needed for comparison.",
    );
  });

  it("reports a failed load rather than showing an empty audit", async () => {
    const failing = remoteOf();
    failing.auditById = () => failed("read-failed");
    const api = createAuditApi(failing);
    const { findByText } = render(<AuditPage sessionId={SESSION} api={api} />);

    // The summary still resolved, so the view says the documents failed
    // rather than claiming there is no audit.
    expect(await findByText(/read-failed/u)).toBeDefined();
  });

  it("keeps an explicit selection on add and update, and returns to current on deletion", async () => {
    const current = summaryValue({ auditId: "current", revision: "a" });
    let older = summaryValue({ auditId: "older", revision: "b" });
    const newest = summaryValue({ auditId: "newest", revision: "d" });
    let entries = [current, older];
    let report = "# Previous";
    const remote = remoteOf();
    remote.audits = async () => ({ ok: true, value: entries });
    const details = vi.fn(async (_sessionId: string, auditId: string) => {
      const summary = entries.find((entry) => entry.auditId === auditId)!;
      return {
        ok: true as const,
        value: auditValue({
          summary,
          report: auditId === "older" ? report : `# ${auditId}`,
        }),
      };
    });
    remote.auditById = details;
    const view = render(
      <AuditPage sessionId={SESSION} api={createAuditApi(remote)} />,
    );
    await view.findByRole("heading", { name: "current" });
    expect(details).toHaveBeenCalledTimes(1);
    const select = view.getByRole("combobox", {
      name: "Audit version",
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "older" } });
    await view.findByRole("heading", { name: "Previous" });
    older = { ...older, revision: "c" };
    report = "# Previous updated";
    entries = [newest, current, older];
    fireEvent.click(view.getByRole("button", { name: "Refresh audits" }));
    await view.findByRole("heading", { name: "Previous updated" });
    expect(select.value).toBe("older");
    fireEvent.click(view.getByRole("tab", { name: "Compare" }));
    fireEvent.change(view.getByRole("combobox", { name: "Baseline audit" }), {
      target: { value: "current" },
    });
    expect(
      (await view.findByRole("region", { name: "Report changes" })).textContent,
    ).toContain("Previous updated");
    entries = [newest, older];
    fireEvent.click(view.getByRole("button", { name: "Refresh audits" }));
    await waitFor(() =>
      expect(
        (
          view.getByRole("combobox", {
            name: "Baseline audit",
          }) as HTMLSelectElement
        ).value,
      ).toBe(""),
    );
    entries = [newest, current];
    fireEvent.click(view.getByRole("button", { name: "Refresh audits" }));
    await waitFor(() => expect(select.value).toBe(""));
    fireEvent.click(view.getByRole("tab", { name: "Report" }));
    await view.findByRole("heading", { name: "newest" });
  });

  it("ignores a detail response that arrives after the reader changed versions", async () => {
    const current = summaryValue({ auditId: "current" });
    const older = summaryValue({ auditId: "older" });
    let resolveCurrent!: (result: RemoteResult<SessionAuditValue>) => void;
    const remote = remoteOf();
    remote.audits = async () => ({ ok: true, value: [current, older] });
    remote.auditById = async (_id, auditId) =>
      auditId === "current"
        ? new Promise((resolve) => {
            resolveCurrent = resolve;
          })
        : {
            ok: true,
            value: auditValue({ summary: older, report: "# Previous" }),
          };
    const view = render(
      <AuditPage sessionId={SESSION} api={createAuditApi(remote)} />,
    );
    fireEvent.change(
      await view.findByRole("combobox", { name: "Audit version" }),
      { target: { value: "older" } },
    );
    await view.findByRole("heading", { name: "Previous" });
    await act(async () =>
      resolveCurrent({
        ok: true,
        value: auditValue({ summary: current, report: "# Current late" }),
      }),
    );
    expect(view.queryByRole("heading", { name: "Current late" })).toBeNull();
  });

  it("renders a bounded text preview of large reports", async () => {
    const audit = auditValue({
      report: "<script>alert(1)</script>\n" + "long report\n".repeat(50_000),
    });
    const view = render(
      <AuditPage
        sessionId={SESSION}
        api={createAuditApi(remoteOf(audit.summary, audit))}
      />,
    );
    await view.findByRole("button", { name: "Download full report" });
    const panel = view.getByRole("tabpanel");
    expect(panel.querySelector("script")).toBeNull();
    expect(panel.querySelector("pre")?.textContent).toHaveLength(4_000);
  });

  it("keeps the report comparison when a baseline has a future analysis schema", async () => {
    const current = summaryValue({ auditId: "current" });
    const future = summaryValue({ auditId: "future", schemaVersion: 7 });
    const remote = remoteOf();
    remote.audits = async () => ({ ok: true, value: [current, future] });
    remote.auditById = async (_sessionId, auditId) => ({
      ok: true,
      value:
        auditId === "current"
          ? auditValue({ summary: current, report: "Current line" })
          : auditValue({
              summary: future,
              analysisJson: JSON.stringify({ schemaVersion: 7 }),
              report: "Future line",
            }),
    });
    const view = render(
      <AuditPage sessionId={SESSION} api={createAuditApi(remote)} />,
    );
    fireEvent.click(await view.findByRole("tab", { name: "Compare" }));
    fireEvent.change(
      await view.findByRole("combobox", { name: "Baseline audit" }),
      { target: { value: "future" } },
    );
    await view.findByText(
      "Structured findings are unavailable for one or both audits.",
    );
    expect(
      (await view.findByRole("region", { name: "Report changes" })).textContent,
    ).toContain("Future line");
  });
});
