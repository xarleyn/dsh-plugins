import { memo, useMemo, type ReactNode } from "react";
import type { AuditAnalysisV1 } from "@yadsh/dsh-audit-core";
import { AuditDownload } from "./AuditDocuments.js";
import { diffFindings, diffReport, type FindingChange } from "./audit-diff.js";

const MAX_VISIBLE_FINDING_CHANGES = 50;

function preview(value: string | readonly string[]): string {
  const text = typeof value === "string" ? value : value.join(" · ");
  return text.length > 300 ? `${text.slice(0, 300)}…` : text || "—";
}

function FindingChangeRow({
  change,
}: {
  readonly change: FindingChange;
}): ReactNode {
  const { finding, kind } = change;
  return (
    <li>
      <strong>
        {kind === "added"
          ? "Added"
          : kind === "removed"
            ? "Removed"
            : "Changed"}
      </strong>
      {" · "}
      {preview(finding.id)}
      {" · "}
      {preview(finding.title)}
      {kind === "changed" ? (
        <dl className="dsh-audit-comparison__fields">
          {change.fields.map((field) => (
            <div key={field}>
              <dt>{field.replace(/([A-Z])/gu, " $1").toLowerCase()}</dt>
              <dd>
                <del>{preview(change.previous[field])}</del>
                <ins>{preview(finding[field])}</ins>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export const AuditComparison = memo(function AuditComparison(props: {
  readonly baseline: AuditAnalysisV1 | null;
  readonly selected: AuditAnalysisV1 | null;
  readonly baselineReport: string;
  readonly selectedReport: string;
}): ReactNode {
  const { baseline, selected, baselineReport, selectedReport } = props;
  const findings = useMemo(
    () =>
      baseline === null || selected === null
        ? null
        : diffFindings(baseline.findings, selected.findings),
    [baseline, selected],
  );
  const report = useMemo(
    () => diffReport(baselineReport, selectedReport),
    [baselineReport, selectedReport],
  );
  return (
    <div className="dsh-audit-comparison">
      <section aria-label="Finding changes">
        <h2>Findings</h2>
        {findings === null ? (
          <p>
            {baseline === null || selected === null
              ? "Structured findings are unavailable for one or both audits."
              : "There are too many findings for inline comparison."}
          </p>
        ) : (
          <>
            {findings.skipped > 0 ? (
              <p>
                {findings.skipped} findings across both audits have missing or
                duplicate IDs and could not be matched.
              </p>
            ) : null}
            {findings.changes.length === 0 ? (
              <p>No changes among findings with unique IDs.</p>
            ) : (
              <>
                <p>
                  {
                    findings.changes.filter((change) => change.kind === "added")
                      .length
                  }{" "}
                  added ·{" "}
                  {
                    findings.changes.filter(
                      (change) => change.kind === "removed",
                    ).length
                  }{" "}
                  removed ·{" "}
                  {
                    findings.changes.filter(
                      (change) => change.kind === "changed",
                    ).length
                  }{" "}
                  changed
                </p>
                <ul>
                  {findings.changes
                    .slice(0, MAX_VISIBLE_FINDING_CHANGES)
                    .map((change) => (
                      <FindingChangeRow
                        key={change.finding.id}
                        change={change}
                      />
                    ))}
                </ul>
                {findings.changes.length > MAX_VISIBLE_FINDING_CHANGES ? (
                  <p>
                    Showing the first {MAX_VISIBLE_FINDING_CHANGES} changes. The
                    Findings and JSON tabs show the selected audit.
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
      <section aria-label="Report changes">
        <h2>Report</h2>
        {report === null ? (
          <>
            <p>The report changed and is too large for inline comparison.</p>
            <AuditDownload
              text={baselineReport}
              filename="baseline-report.md"
              label="Download baseline report"
            />
            <AuditDownload
              text={selectedReport}
              filename="selected-report.md"
              label="Download selected report"
            />
          </>
        ) : report.length === 0 ? (
          <p>No changed lines.</p>
        ) : (
          <ol className="dsh-audit-comparison__lines">
            {report.map(({ kind, line, text }) => (
              <li key={`${kind}:${line}`} data-change={kind}>
                <span>
                  {kind === "added" ? "+" : "−"} {line}
                </span>
                <code>{text}</code>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
});
