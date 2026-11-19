import { useState, type FormEvent } from "react";
import {
  EXPERT_MODES,
  type ExecutionAuditQuery,
  type ExecutionAuditResult,
} from "../types.js";
import { Section, Select, StatusLine } from "./components.js";
import type { ApiOutcome } from "./remote.js";

export type QueryExecutionAudits = (
  query: ExecutionAuditQuery,
) => Promise<ApiOutcome<ExecutionAuditResult>>;

const STATUS_OPTIONS = [
  "completed",
  "error",
  "aborted",
  "max-tokens",
  "refusal",
  "delegated",
] as const;
const EXECUTION_OPTIONS = ["foreground", "background"] as const;

function options(allLabel: string, values: readonly string[]) {
  return [
    { value: "", label: allLabel },
    ...values.map((value) => ({ value, label: value })),
  ];
}

export function ExecutionAuditPanel({
  domainId,
  query,
}: {
  readonly domainId: string;
  readonly query: QueryExecutionAudits;
}) {
  const [mode, setMode] = useState<ExecutionAuditQuery["mode"]>("");
  const [status, setStatus] = useState<ExecutionAuditQuery["status"]>("");
  const [execution, setExecution] =
    useState<ExecutionAuditQuery["execution"]>("");
  const [result, setResult] = useState<ApiOutcome<ExecutionAuditResult>>();
  const [pending, setPending] = useState(false);
  const page = result?.ok ? result.data : undefined;

  async function load(beforeId: number) {
    setPending(true);
    try {
      setResult(
        await query({
          domainId,
          mode,
          status,
          execution,
          beforeId,
          since: 0,
          runId: 0,
          limit: 25,
        }),
      );
    } catch {
      setResult({
        ok: false,
        code: "AUDIT_UNAVAILABLE",
        message: "Execution audit is unavailable.",
      });
    } finally {
      setPending(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(0);
  }

  return (
    <Section
      title="Execution archive"
      note="If enabled in Host settings, up to 7 days and 10,000 runs are retained across restarts."
      testId="domain-experts-archive"
    >
      <form onSubmit={search}>
        <fieldset
          className="dx-archive-filters"
          aria-label="Archive filters"
          disabled={pending}
        >
          <Select
            label="Mode"
            value={mode}
            options={options("All modes", EXPERT_MODES)}
            onChange={(value) => {
              setMode(value as typeof mode);
              setResult(undefined);
            }}
          />
          <Select
            label="Status"
            value={status}
            options={options("All statuses", STATUS_OPTIONS)}
            onChange={(value) => {
              setStatus(value as typeof status);
              setResult(undefined);
            }}
          />
          <Select
            label="Execution"
            value={execution}
            options={options("All runs", EXECUTION_OPTIONS)}
            onChange={(value) => {
              setExecution(value as typeof execution);
              setResult(undefined);
            }}
          />
        </fieldset>
        <div className="dx-actions">
          <button className="dx-button" type="submit" disabled={pending}>
            Search archive
          </button>
          {page && page.nextBeforeId > 0 ? (
            <button
              className="dx-button"
              type="button"
              disabled={pending}
              onClick={() => {
                void load(page.nextBeforeId);
              }}
            >
              Older runs
            </button>
          ) : null}
        </div>
      </form>
      {pending ? <StatusLine>Loading execution archive…</StatusLine> : null}
      {result && !result.ok ? (
        <StatusLine tone={result.code === "AUDIT_DISABLED" ? "info" : "error"}>
          {result.message}
        </StatusLine>
      ) : null}
      {page?.entries.length === 0 ? (
        <StatusLine>No matching runs in the archive.</StatusLine>
      ) : null}
      {page && page.entries.length > 0 ? (
        <div
          className="dx-archive-results"
          role="region"
          aria-label="Archive results"
          tabIndex={0}
        >
          <table className="dx-table" aria-label="Archived runs">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Mode</th>
                <th>Execution</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.id}</td>
                  <td>{entry.status}</td>
                  <td>{entry.durationMs} ms</td>
                  <td>{entry.mode}</td>
                  <td>{entry.background ? "background" : "foreground"}</td>
                  <td>{new Date(entry.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Section>
  );
}
