// @vitest-environment jsdom
/**
 * The QA Surface's audit integration: the badge, the dialog and the controller
 * that decides whether either exists.
 *
 * The provider is optional, so half of these tests are about absence — a page
 * without the audit plugin must render exactly as it did before.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaAuditController } from "../src/client/audit/controller.js";
import { QaAuditRowBadge } from "../src/client/audit/QaAuditRowBadge.js";
import { QaAuditDialog } from "../src/client/audit/QaAuditDialog.js";
import {
  auditMark,
  createQaAuditApi,
  type QaAuditRemote,
  type QaAuditSummary,
  type QaSessionAudit,
} from "../src/client/audit/types.js";
import { QaSidebar } from "../src/client/components/QaSidebar.js";

const summary = (overrides: Partial<QaAuditSummary> = {}): QaAuditSummary => ({
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

const ANALYSIS = JSON.stringify({
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

const document_ = (
  overrides: Partial<QaSessionAudit> = {},
): QaSessionAudit => ({
  available: true,
  summary: summary(),
  analysisJson: ANALYSIS,
  report: "# Trajectory Review\n\n## Verdict\n\nMixed.\n",
  ...overrides,
});

function remoteOf(
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

describe("createQaAuditApi", () => {
  it("returns the value of a successful result", async () => {
    const api = createQaAuditApi(remoteOf());

    await expect(api.summary("session-1")).resolves.toMatchObject({
      verdict: "mixed",
    });
  });

  it("turns a failed result into an exception", async () => {
    const failing: QaAuditRemote = {
      summary: async () => ({ ok: false, error: { code: "not-found" } }),
      audit: async () => ({ ok: false, error: { code: "not-found" } }),
    };
    const api = createQaAuditApi(failing);

    await expect(api.summary("session-1")).rejects.toThrow(/not-found/u);
  });
});

describe("auditMark", () => {
  it("reduces a summary to what a row shows", () => {
    expect(auditMark(summary())).toEqual({
      verdict: "mixed",
      critical: 0,
      major: 1,
      minor: 2,
      observation: 0,
      other: 0,
    });
  });

  it("is null when there is no summary or no audit", () => {
    expect(auditMark(undefined)).toBeNull();
    expect(auditMark(summary({ available: false }))).toBeNull();
  });
});

describe("QaAuditController", () => {
  it("starts detached and notifies on attach and detach", () => {
    const controller = new QaAuditController();
    const seen = vi.fn();
    controller.subscribe(seen);

    expect(controller.getSnapshot().api).toBeNull();

    controller.attach(createQaAuditApi(remoteOf()));
    expect(controller.getSnapshot().api).not.toBeNull();

    controller.detach();
    expect(controller.getSnapshot().api).toBeNull();

    controller.dispose();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("does not notify when already detached", () => {
    const controller = new QaAuditController();
    const seen = vi.fn();
    controller.subscribe(seen);

    controller.detach();

    expect(seen).not.toHaveBeenCalled();
  });
});

describe("QaAuditRowBadge", () => {
  it("separates 'an audit exists' from 'what it found'", () => {
    const { container } = render(
      <QaAuditRowBadge
        mark={{
          verdict: "poor",
          critical: 0,
          major: 2,
          minor: 0,
          observation: 0,
          other: 0,
        }}
        withDelete={false}
        onOpen={() => {}}
      />,
    );

    // The check mark is existence; the verdict carries the quality, and for a
    // poor audit it must not read as approval.
    expect(container.querySelector("svg path")).not.toBeNull();
    const verdict = container.querySelector(
      ".dsh-qa-sidebar__item-audit-verdict",
    );
    expect(verdict?.textContent).toBe("Poor");
    expect(verdict?.className).toContain("--bad");
  });

  it("describes itself for assistive technology and on hover", () => {
    render(
      <QaAuditRowBadge
        mark={{
          verdict: "good",
          critical: 0,
          major: 1,
          minor: 2,
          observation: 0,
          other: 0,
        }}
        withDelete={false}
        onOpen={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: /Открыть аудит/u });
    expect(button.getAttribute("title")).toContain("Good");
    expect(button.getAttribute("title")).toContain("1 major");
  });

  it("opens on click", () => {
    const onOpen = vi.fn();
    render(
      <QaAuditRowBadge
        mark={{
          verdict: "good",
          critical: 0,
          major: 0,
          minor: 0,
          observation: 0,
          other: 0,
        }}
        withDelete={false}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Открыть аудит/u }));

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("leaves room for a delete control when the row has one", () => {
    const { container } = render(
      <QaAuditRowBadge
        mark={{
          verdict: "good",
          critical: 0,
          major: 0,
          minor: 0,
          observation: 0,
          other: 0,
        }}
        withDelete
        onOpen={() => {}}
      />,
    );

    expect(
      container.querySelector(".dsh-qa-sidebar__item-audit--with-delete"),
    ).not.toBeNull();
  });
});

describe("QaSidebar with audits", () => {
  const rows = [
    {
      id: "session-a",
      title: "Первый чат",
      running: false,
      active: false,
      meta: "1 мин",
      updatedAt: 2,
    },
    {
      id: "session-b",
      title: "Второй чат",
      running: false,
      active: false,
      meta: "2 мин",
      updatedAt: 1,
    },
  ];
  const base = {
    rows,
    title: "Демо",
    logoUrl: null,
    stateKey: "qa-audit-test",
    showNewChat: true,
    busy: false,
    onSwitch: () => {},
    onNewChat: () => {},
  } as const;

  it("badges only the audited chat", () => {
    render(
      <QaSidebar
        {...base}
        audits={new Map([["session-a", summary()]])}
        onAudit={() => {}}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /Открыть аудит/u }),
    ).toHaveLength(1);
  });

  it("badges nothing when the audit plugin is absent", () => {
    render(
      <QaSidebar {...base} audits={new Map([["session-a", summary()]])} />,
    );

    expect(screen.queryByRole("button", { name: /Открыть аудит/u })).toBeNull();
  });

  it("badges nothing when no chat has an audit", () => {
    render(<QaSidebar {...base} audits={new Map()} onAudit={() => {}} />);

    expect(screen.queryByRole("button", { name: /Открыть аудит/u })).toBeNull();
  });
});

describe("QaAuditDialog", () => {
  const api = () => createQaAuditApi(remoteOf());

  it("loads the report on open and switches tabs", async () => {
    render(
      <QaAuditDialog
        open
        sessionId="session-a"
        title="Аудит чата"
        api={api()}
        summary={summary()}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Trajectory Review")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Замечания" }));
    await waitFor(() => {
      expect(screen.getByText("Asserted without a lookup")).toBeDefined();
    });
    expect(screen.getByText("AGENT")).toBeDefined();
  });

  it("shows the raw document in the JSON tab", async () => {
    render(
      <QaAuditDialog
        open
        sessionId="session-a"
        title="Аудит чата"
        api={api()}
        summary={summary()}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Trajectory Review")).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));

    expect(screen.getByText("schemaVersion")).toBeDefined();
  });

  it("renders a malicious report as text", async () => {
    const hostile = document_({
      report: '<script>alert("x")</script> [x](javascript:alert(1))',
    });
    const { container } = render(
      <QaAuditDialog
        open
        sessionId="session-a"
        title="Аудит чата"
        api={createQaAuditApi(remoteOf(hostile))}
        summary={summary()}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("<script>");
    });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("explains itself when the audit plugin is not installed", () => {
    render(
      <QaAuditDialog
        open
        sessionId="session-a"
        title="Аудит чата"
        api={null}
        summary={undefined}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Модуль аудита не установлен")).toBeDefined();
  });

  it("keeps an unknown schema readable through the report and the raw JSON", async () => {
    const newer = document_({
      analysisJson: JSON.stringify({ schemaVersion: 9, verdict: "good" }),
    });
    render(
      <QaAuditDialog
        open
        sessionId="session-a"
        title="Аудит чата"
        api={createQaAuditApi(remoteOf(newer))}
        summary={summary({ schemaVersion: 9 })}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Trajectory Review")).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Замечания" }));
    expect(
      screen.getByText("Структурированные замечания недоступны"),
    ).toBeDefined();
  });
});
