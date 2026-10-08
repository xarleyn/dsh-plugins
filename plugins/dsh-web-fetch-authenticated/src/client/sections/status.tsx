/**
 * Provider overview: what ctx.web selected, how many rules are in effect, the
 * content kinds the three tools serve, and the state of every credential
 * reference (SPEC §6.1).
 * @module client/sections/status
 */

import type { ProviderStatusReport } from "../../types.js";
import { Meta, MetaLine, Pill } from "./common.js";

/** Provider overview: status, selection, counts, config errors (SPEC §6.1). */
export function StatusSection({
  status: report,
  warnings,
}: {
  status: ProviderStatusReport | undefined;
  warnings: readonly string[];
}): JSX.Element {
  if (report === undefined) {
    return (
      <div className="wfa-empty" data-testid="wfa-status-loading">
        Loading provider status…
      </div>
    );
  }
  const selection =
    report.fetchProviderId === undefined
      ? "not pinned (auto-select)"
      : report.fetchProviderId === "authenticated"
        ? 'pinned to "authenticated"'
        : `pinned to "${report.fetchProviderId}" — rules are inert until ctx.web selects this provider`;
  return (
    <section className="wfa-section" data-testid="wfa-status-section">
      <div className="wfa-section-title">
        <h3>Provider</h3>
        <Pill
          tone={report.enabled ? "ok" : "warn"}
          testId="wfa-status-enabled-state"
        >
          {report.enabled ? "Enabled" : "Disabled"}
        </Pill>
      </div>
      <MetaLine muted>
        <Meta>
          {report.ruleCount} rule(s), {report.enabledRuleCount} enabled
        </Meta>
        <Meta>ctx.web fetchProvider: {selection}</Meta>
        <Meta>
          unmatched URLs:{" "}
          {report.unmatchedPolicy === "block"
            ? "blocked (strict)"
            : String(report.unmatchedPolicy)}
        </Meta>
      </MetaLine>
      <div className="wfa-note">
        <b>Available content:</b> <code>web_fetch</code> reads HTML, plain text,
        JSON, XML and extracts DOCX/ODT text; <code>web_fetch_file</code> stores
        successful PDF, Office, spreadsheet, presentation, archive, log,
        HTML/JSON/XML and other binary responses as immutable files;{" "}
        <code>web_fetch_image</code> returns PNG, JPEG, WebP and GIF as images.
        Every tool uses the same rule, credential, network, redirect and byte
        limits.
      </div>
      {report.configErrors.length > 0 && (
        <div className="wfa-error" data-testid="wfa-status-config-errors">
          {report.configErrors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="wfa-warnings" data-testid="wfa-status-config-warnings">
          {warnings.map((warning, index) => (
            <div key={index}>{warning}</div>
          ))}
        </div>
      )}
      {report.credentialStates.map((state) => (
        <p
          className="wfa-muted"
          data-testid="wfa-status-credential-state"
          key={state.ref}
        >
          Credential <code>{state.ref}</code>:{" "}
          {state.configured ? "configured" : "not configured"}
          {state.writable
            ? ""
            : " (read-only source — set via the environment)"}
        </p>
      ))}
    </section>
  );
}
