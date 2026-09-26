/**
 * Diagnostics without an HTTP request (SPEC §6.4): which rule a URL would
 * match, and whether its addresses and redirect policy would let it through.
 * @module client/sections/diagnostics
 */

import { useState } from "react";
import type { DiagnoseReport } from "../../types.js";
import type { CardFace } from "./common.js";

/** Diagnostics without an HTTP request (SPEC §6.4). */
export function DiagnosticsSection({
  diagnose,
}: {
  diagnose: CardFace["diagnose"];
}): JSX.Element {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<DiagnoseReport | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Diagnostics</h3>
        <span className="wfa-note">
          Match and network policy only — no request is sent.
        </span>
      </div>
      <div className="wfa-actions">
        <input
          className="wfa-control"
          style={{ flex: 1 }}
          value={url}
          placeholder="https://jira.example.corp/browse/PROJ-123"
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
        <button
          className="wfa-btn"
          type="button"
          disabled={busy || url.trim().length === 0}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            void diagnose(url.trim())
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
          Diagnose
        </button>
      </div>
      {error !== undefined && <div className="wfa-error">{error}</div>}
      {report !== undefined && (
        <div className="wfa-report">
          <div>
            <b>URL:</b>{" "}
            {report.validUrl ? report.url : `${report.url} (invalid)`}
          </div>
          <div>
            <b>Matched rule:</b>{" "}
            {report.match.ruleId === undefined
              ? report.match.reason
              : `${report.match.ruleName ?? report.match.ruleId} (${report.match.ruleId})`}
          </div>
          <div>
            <b>Network:</b> {report.networkAllowed ? "allowed" : "denied"}
          </div>
          <div>
            <b>Redirects:</b>{" "}
            {report.redirectPolicy.length > 0 ? report.redirectPolicy : "—"}
          </div>
          {report.credentialState !== undefined && (
            <div>
              <b>Credential:</b> {report.credentialState.ref} (
              {report.credentialState.configured ? "configured" : "missing"})
            </div>
          )}
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
          {report.detail !== undefined && <pre>{report.detail}</pre>}
        </div>
      )}
    </section>
  );
}
