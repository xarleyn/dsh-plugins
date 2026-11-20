// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QaAuditDialog } from "../../../src/client/audit/QaAuditDialog.js";
import { createQaAuditApi } from "../../../src/client/audit/types.js";
import {
  document_,
  remoteOf,
  summary,
} from "./qa-audit-integration.helpers.js";

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

  it("separates the producer, auditor and audited session in the loaded document", async () => {
    const ready = summary({ schemaVersion: 2, model: "demo/session" });
    const audit = document_({
      summary: ready,
      analysisJson: JSON.stringify({
        schemaVersion: 2,
        trajectory: { sessionId: ready.sessionId, model: "demo/session" },
        audit: { producer: { name: "Demo report builder", version: "2.0.0" } },
        auditor: { type: "llm", model: "demo/auditor" },
      }),
    });
    render(
      <QaAuditDialog
        open
        sessionId={ready.sessionId}
        title="Аудит чата"
        api={createQaAuditApi(remoteOf(audit))}
        summary={ready}
        onClose={() => {}}
      />,
    );
    const provenance = within(await screen.findByTestId("audit-provenance"));
    expect(
      provenance.getByText("Генератор отчёта").nextElementSibling?.textContent,
    ).toBe("Demo report builder");
    expect(
      provenance.getByText("Версия генератора").nextElementSibling?.textContent,
    ).toBe("2.0.0");
    expect(
      provenance.getByText("Тип аудитора").nextElementSibling?.textContent,
    ).toBe("llm");
    expect(
      provenance.getByText("Модель аудитора").nextElementSibling?.textContent,
    ).toBe("demo/auditor");
    expect(
      provenance.getByText("Модель сессии").nextElementSibling?.textContent,
    ).toBe("demo/session");
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
