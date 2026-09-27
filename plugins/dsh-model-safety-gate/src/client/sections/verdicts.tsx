/**
 * Recent sanitized verdicts: what the gate decided, and why.
 *
 * Rows come from the Remote audit ring, newest first, and carry a content hash
 * rather than the content unless raw logging is switched on in Audit.
 */

import type { SafetyGateInspect } from "../../types.js";
import { Section } from "../components.js";
import { formatCount, formatMs, joinList, shortHash } from "../format.js";

export interface VerdictsProps {
  readonly inspect: SafetyGateInspect | null;
}

/** Recent sanitized verdicts: what the gate decided, and why. */
export function VerdictsSection(props: VerdictsProps) {
  const rows = props.inspect?.audit ?? [];
  return (
    <Section
      testId="safety-section-verdicts"
      title="Recent verdicts"
      modified={false}
      hint={props.inspect === null ? undefined : "Newest first, last 50 checks"}
    >
      {rows.length === 0 ? (
        <div className="msg-empty" data-testid="safety-verdicts-empty">
          No check has run since the gate started.
        </div>
      ) : (
        <div className="msg-table-wrap">
          <table className="msg-table" data-testid="safety-verdicts-table">
            <thead>
              <tr>
                <th>Turn</th>
                <th>Channel</th>
                <th>Decision</th>
                <th>Categories</th>
                <th>Confidence</th>
                <th>Latency</th>
                <th>Content</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`${row.contentSha256}:${row.channel}:${String(index)}`}
                  data-testid="safety-verdicts-row"
                >
                  <td className="msg-mono" data-testid="safety-verdicts-turn">
                    {row.turn === null ? "—" : `t${row.turn}`}
                    {row.step === null ? "" : `.${row.step}`}
                  </td>
                  <td data-testid="safety-verdicts-channel">
                    {row.direction === "tools" && row.toolName !== null
                      ? row.toolName
                      : row.channel}
                  </td>
                  <td data-testid="safety-verdicts-decision">
                    <span className={`msg-pill ${row.decision}`}>
                      {row.decision}
                    </span>
                    {row.errorCode !== null ? (
                      <div
                        className="msg-muted"
                        data-testid="safety-verdicts-error-code"
                      >
                        {row.errorCode}
                      </div>
                    ) : null}
                  </td>
                  <td data-testid="safety-verdicts-categories">
                    {joinList(row.categories)}
                  </td>
                  <td data-testid="safety-verdicts-confidence">
                    {row.confidence.toFixed(2)}
                  </td>
                  <td data-testid="safety-verdicts-latency">
                    {formatMs(row.latencyMs)}
                  </td>
                  <td data-testid="safety-verdicts-content">
                    <span className="msg-mono" title={row.summary}>
                      {shortHash(row.contentSha256)}
                    </span>
                    <div className="msg-muted">
                      {formatCount(row.contentChars)} chars
                    </div>
                    {row.rawContent !== null ? (
                      <div
                        className="msg-raw"
                        data-testid="safety-verdicts-raw-content"
                      >
                        {row.rawContent}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="msg-footer-note">
        Records carry a content hash, not the content, unless raw logging is
        switched on in Audit. They identify a check; they are not an inspection
        log.
      </p>
    </Section>
  );
}
