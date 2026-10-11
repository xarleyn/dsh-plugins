/**
 * Per-rule connection tester (SPEC §6.3): the report it renders carries only
 * the sanitized facts the Host measured — status, size, redirects, resolved
 * addresses, and a body preview.
 * @module client/sections/rule-tester
 */

import { useState } from "react";
import type { RuleTestReport } from "../../types.js";
import { formatBytes } from "../format.js";
import { Meta, MetaLine, Pill, type CardFace } from "./common.js";

/** Per-rule connection tester (SPEC §6.3). */
export function RuleTester({
  ruleId,
  defaultUrl,
  testRule,
}: {
  ruleId: string;
  defaultUrl: string;
  testRule: CardFace["testRule"];
}): JSX.Element {
  const [url, setUrl] = useState(defaultUrl);
  const [report, setReport] = useState<RuleTestReport | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="wfa-editor" data-testid="wfa-rule-tester">
      <div className="wfa-actions">
        <input
          className="wfa-control"
          data-testid="wfa-rule-tester-url"
          style={{ flex: 1 }}
          value={url}
          placeholder="https://jira.example.corp/browse/PROJ-123"
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
        <button
          className="wfa-btn primary"
          data-testid="wfa-rule-tester-run"
          type="button"
          disabled={busy || url.trim().length === 0}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            void testRule(ruleId, url.trim())
              .then((result) => {
                if (result.ok) setReport(result.value);
                else setError(result.error.message);
              })
              .catch((cause) => {
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Run test
        </button>
      </div>
      {error !== undefined && (
        <div className="wfa-error" data-testid="wfa-rule-tester-error">
          {error}
        </div>
      )}
      {report !== undefined && <TestReport report={report} />}
    </div>
  );
}

function TestReport({ report }: { report: RuleTestReport }): JSX.Element {
  return (
    <div className="wfa-report" data-testid="wfa-rule-tester-report">
      <MetaLine>
        <Pill tone={report.ok ? "ok" : "err"} testId="wfa-rule-tester-outcome">
          {report.outcome}
        </Pill>
        {report.statusCode !== undefined && (
          <Meta label="HTTP">{report.statusCode}</Meta>
        )}
        {report.contentType !== undefined && <Meta>{report.contentType}</Meta>}
        {report.responseBytes !== undefined && (
          <Meta>{formatBytes(report.responseBytes)}</Meta>
        )}
        <Meta>{report.redirectCount} redirect(s)</Meta>
        <Meta>{report.durationMs} ms</Meta>
      </MetaLine>
      <MetaLine>
        <Meta label="Auth applied">{report.authApplied ? "yes" : "no"}</Meta>
        {report.adapter !== undefined && (
          <Meta label="Adapter">{report.adapter}</Meta>
        )}
        {report.credentialState !== undefined && (
          <Meta label="Credential">
            {report.credentialState.ref} (
            {report.credentialState.configured ? "configured" : "missing"})
          </Meta>
        )}
      </MetaLine>
      {report.addresses.length > 0 && (
        <div>
          <b>Resolved:</b>{" "}
          {report.addresses
            .map(
              (address) =>
                `${address.address} (${address.networkClass}${address.allowed ? "" : ", DENIED"})`,
            )
            .join(", ")}
        </div>
      )}
      {report.finalOrigin !== undefined && (
        <div>
          <b>Final origin:</b> {report.finalOrigin}
        </div>
      )}
      {report.detail !== undefined && <pre>{report.detail}</pre>}
      {report.preview !== undefined && <pre>{report.preview}</pre>}
    </div>
  );
}
