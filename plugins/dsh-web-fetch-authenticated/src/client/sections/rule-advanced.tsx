/**
 * The collapsed half of the rule editor: network policy, redirect policy and
 * the per-rule limits (SPEC §6.2, §14, §23). Everything here is optional — the
 * stored rule omits a field the draft left empty, so the defaults of the
 * global section keep applying.
 * @module client/sections/rule-advanced
 */

import type { RedirectMode } from "../../types.js";
import { Field } from "./common.js";
import type { RuleDraft } from "./rule-draft.js";

/** Network, redirect and limit fields of one rule draft. */
export function RuleAdvancedFields({
  draft,
  patch,
}: {
  draft: RuleDraft;
  patch: (changes: Partial<RuleDraft>) => void;
}): JSX.Element {
  return (
    <details className="wfa-advanced" data-testid="wfa-rule-editor-advanced">
      <summary data-testid="wfa-rule-editor-advanced-summary">
        Network policy, redirects, and limits
      </summary>
      <div className="wfa-advanced-content">
        <div className="wfa-checks" data-testid="wfa-rule-editor-network">
          {(
            [
              ["allowPublic", "Public IPs", "wfa-rule-editor-network-public"],
              [
                "allowPrivate",
                "Private networks (RFC1918)",
                "wfa-rule-editor-network-private",
              ],
              ["allowLoopback", "Loopback", "wfa-rule-editor-network-loopback"],
              [
                "allowLinkLocal",
                "Link-local",
                "wfa-rule-editor-network-link-local",
              ],
              [
                "allowCGNAT",
                "Carrier-grade NAT",
                "wfa-rule-editor-network-cgnat",
              ],
              [
                "allowIPv6ULA",
                "IPv6 unique-local",
                "wfa-rule-editor-network-ipv6-ula",
              ],
            ] as const
          ).map(([key, label, testId]) => (
            <label className="wfa-check" key={key}>
              <input
                type="checkbox"
                data-testid={testId}
                checked={draft.network[key]}
                onChange={(event) => {
                  patch({
                    network: {
                      ...draft.network,
                      [key]: event.target.checked,
                    },
                  });
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="wfa-grid">
          <Field label="Allowed CIDRs (one per line)">
            <textarea
              className="wfa-control"
              data-testid="wfa-rule-editor-allowed-cidrs"
              rows={2}
              value={draft.network.allowedCidrs}
              placeholder="10.20.0.0/16"
              onChange={(event) => {
                patch({
                  network: {
                    ...draft.network,
                    allowedCidrs: event.target.value,
                  },
                });
              }}
            />
          </Field>
          <Field label="Denied CIDRs (one per line)">
            <textarea
              className="wfa-control"
              data-testid="wfa-rule-editor-denied-cidrs"
              rows={2}
              value={draft.network.deniedCidrs}
              onChange={(event) => {
                patch({
                  network: {
                    ...draft.network,
                    deniedCidrs: event.target.value,
                  },
                });
              }}
            />
          </Field>
        </div>
        <div className="wfa-grid">
          <Field label="Redirects">
            <select
              className="wfa-control"
              data-testid="wfa-rule-editor-redirect-mode"
              value={draft.redirectMode}
              onChange={(event) => {
                patch({ redirectMode: event.target.value as RedirectMode });
              }}
            >
              <option value="same-origin">
                Same-origin only (recommended)
              </option>
              <option value="none">No redirects</option>
              <option value="allowlist">Explicit origin allowlist</option>
            </select>
          </Field>
          <Field label="Max redirects">
            <input
              className="wfa-control"
              data-testid="wfa-rule-editor-max-redirects"
              value={draft.maxRedirects}
              placeholder="3"
              onChange={(event) => {
                patch({ maxRedirects: event.target.value });
              }}
            />
          </Field>
        </div>
        {draft.redirectMode === "allowlist" && (
          <Field label="Allowed redirect origins (one per line)">
            <textarea
              className="wfa-control"
              data-testid="wfa-rule-editor-allowed-origins"
              rows={2}
              value={draft.allowedOrigins}
              placeholder="https://sso.example.corp"
              onChange={(event) => {
                patch({ allowedOrigins: event.target.value });
              }}
            />
          </Field>
        )}
        <div className="wfa-grid">
          <Field label="Timeout (ms)">
            <input
              className="wfa-control"
              data-testid="wfa-rule-editor-timeout"
              value={draft.timeoutMs}
              placeholder="30000"
              onChange={(event) => {
                patch({ timeoutMs: event.target.value });
              }}
            />
          </Field>
          <Field label="Max response bytes">
            <input
              className="wfa-control"
              data-testid="wfa-rule-editor-max-response-bytes"
              value={draft.maxResponseBytes}
              placeholder="5242880"
              onChange={(event) => {
                patch({ maxResponseBytes: event.target.value });
              }}
            />
          </Field>
          <Field label="Max decoded chars">
            <input
              className="wfa-control"
              data-testid="wfa-rule-editor-max-body-chars"
              value={draft.maxBodyChars}
              placeholder="100000"
              onChange={(event) => {
                patch({ maxBodyChars: event.target.value });
              }}
            />
          </Field>
          <Field label="Test URL (optional, used by Test)">
            <input
              className="wfa-control"
              data-testid="wfa-rule-editor-test-url"
              value={draft.testUrl}
              placeholder="https://jira.example.corp/status"
              onChange={(event) => {
                patch({ testUrl: event.target.value });
              }}
            />
          </Field>
        </div>
      </div>
    </details>
  );
}
