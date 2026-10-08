// Body sections of the Prompt Firewall settings card. Each section owns its
// local UI state only; the card parent keeps the settings store, polling, and
// the remote face.
import { useState, type FormEvent } from "react";
import type {
  FirewallAction,
  PromptFirewallConfig,
  PromptFirewallInspectorSnapshot,
  SectionPolicy,
} from "../types.js";

export type RuleField =
  | "allowedSections"
  | "blockedSections"
  | "protectedSections"
  | "allowedPrefixes"
  | "blockedPrefixes"
  | "allowedPatterns"
  | "blockedPatterns";

const EMPTY_LIST: readonly string[] = Object.freeze([]);

function list(
  config: PromptFirewallConfig | undefined,
  field: RuleField,
): readonly string[] {
  return config?.[field] ?? EMPTY_LIST;
}

export function Toggle(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  /** The stable hook a test reaches this switch by, whatever its label says. */
  testId?: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="pf-toggle-row">
      <span className="pf-toggle-copy">
        <strong>{props.label}</strong>
        <span>{props.hint}</span>
      </span>
      <input
        className="pf-toggle"
        type="checkbox"
        data-testid={props.testId}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.currentTarget.checked);
        }}
      />
    </label>
  );
}

type ConfigSetter = (path: string[], value: unknown) => void;

export function PolicySection(props: {
  config: PromptFirewallConfig | undefined;
  writable: boolean;
  setPath: ConfigSetter;
  unsetPreset(): void;
}) {
  const { config, writable, setPath } = props;
  const configuredMode =
    config?.mode ??
    (config?.preset === "strict"
      ? "allowlist"
      : config?.preset === "audit-only"
        ? "audit"
        : "blocklist");
  return (
    <section className="pf-section" data-testid="pf-policy">
      <div className="pf-section-title">
        <h3>Policy</h3>
        <span className="pf-muted">Changes apply live</span>
      </div>
      <div className="pf-grid">
        <Toggle
          checked={config?.enabled ?? true}
          disabled={!writable}
          label="Firewall enabled"
          hint="Keep auditing available when policy is off."
          testId="pf-policy-enabled"
          onChange={(value) => {
            setPath(["enabled"], value);
          }}
        />
        <Toggle
          checked={config?.protectCoreSections ?? true}
          disabled={!writable}
          label="Protect core sections"
          hint="Prevents ordinary rules from removing Harness internals."
          testId="pf-policy-protect-core"
          onChange={(value) => {
            setPath(["protectCoreSections"], value);
          }}
        />
        <label className="pf-field">
          <span>Mode</span>
          <select
            className="pf-control"
            data-testid="pf-policy-mode"
            value={configuredMode}
            disabled={!writable}
            onChange={(event) => {
              setPath(["mode"], event.currentTarget.value);
            }}
          >
            <option value="off">Off</option>
            <option value="audit">Audit only</option>
            <option value="blocklist">Blocklist</option>
            <option value="allowlist">Allowlist</option>
          </select>
        </label>
        <label className="pf-field">
          <span>Preset</span>
          <select
            className="pf-control"
            data-testid="pf-policy-preset"
            value={config?.preset ?? ""}
            disabled={!writable}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "") props.unsetPreset();
              else setPath(["preset"], value);
            }}
          >
            <option value="">None</option>
            <option value="clean">Clean</option>
            <option value="strict">Strict</option>
            <option value="audit-only">Audit only</option>
          </select>
        </label>
        <label className="pf-field">
          <span>Unknown plugin sections</span>
          <select
            className="pf-control"
            data-testid="pf-policy-unknown"
            value={config?.unknownPluginPolicy ?? "allow"}
            disabled={!writable}
            onChange={(event) => {
              setPath(["unknownPluginPolicy"], event.currentTarget.value);
            }}
          >
            <option value="allow">Allow</option>
            <option value="block">Block</option>
          </select>
        </label>
      </div>
    </section>
  );
}

export function LastRequestSection(props: {
  config: PromptFirewallConfig | undefined;
  inspector: PromptFirewallInspectorSnapshot | null;
  refreshing: boolean;
  onRefresh(): void;
}) {
  const last = props.inspector?.last ?? null;
  const effectiveMode =
    props.inspector?.config.mode ?? props.config?.mode ?? "blocklist";
  return (
    <section className="pf-section" data-testid="pf-last-request">
      <div className="pf-section-title">
        <h3>Last request</h3>
        <button
          className="pf-btn"
          data-testid="pf-last-request-refresh"
          disabled={props.refreshing}
          onClick={() => {
            props.onRefresh();
          }}
        >
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="pf-stats">
        <div className="pf-stat" data-testid="pf-last-request-sections">
          <b>{last?.totalSections ?? "—"}</b>
          <span>sections</span>
        </div>
        <div className="pf-stat" data-testid="pf-last-request-blocked">
          <b>{last?.blockedSections ?? "—"}</b>
          <span>blocked</span>
        </div>
        <div className="pf-stat" data-testid="pf-last-request-tokens">
          <b>
            {last === null ? "—" : "~" + String(last.estimatedTokensRemoved)}
          </b>
          <span>tokens removed (estimate)</span>
        </div>
        <div className="pf-stat" data-testid="pf-last-request-mode">
          <b>{effectiveMode}</b>
          <span>effective mode</span>
        </div>
      </div>
    </section>
  );
}

type RuleKind = "exact" | "prefix" | "glob";

export function RulesSection(props: {
  config: PromptFirewallConfig | undefined;
  writable: boolean;
  setPath: ConfigSetter;
}) {
  const { config, writable, setPath } = props;
  const [rule, setRule] = useState("");
  const [ruleKind, setRuleKind] = useState<RuleKind>("exact");
  const [ruleAction, setRuleAction] = useState<FirewallAction>("block");

  const addRule = (event: FormEvent) => {
    event.preventDefault();
    const value = rule.trim();
    if (value.length === 0) return;
    const field: RuleField =
      ruleAction === "protect"
        ? "protectedSections"
        : ruleKind === "exact"
          ? `${ruleAction === "allow" ? "allowed" : "blocked"}Sections`
          : ruleKind === "prefix"
            ? `${ruleAction === "allow" ? "allowed" : "blocked"}Prefixes`
            : `${ruleAction === "allow" ? "allowed" : "blocked"}Patterns`;
    const values = [...new Set([...list(config, field), value])];
    setPath([field], values);
    setRule("");
  };

  const explicitRules: Array<{
    field: RuleField;
    value: string;
    kind: string;
    action: FirewallAction;
  }> = [
    ...list(config, "allowedSections").map((value) => ({
      field: "allowedSections" as const,
      value,
      kind: "exact",
      action: "allow" as const,
    })),
    ...list(config, "blockedSections").map((value) => ({
      field: "blockedSections" as const,
      value,
      kind: "exact",
      action: "block" as const,
    })),
    ...list(config, "protectedSections").map((value) => ({
      field: "protectedSections" as const,
      value,
      kind: "exact",
      action: "protect" as const,
    })),
    ...list(config, "allowedPrefixes").map((value) => ({
      field: "allowedPrefixes" as const,
      value,
      kind: "prefix",
      action: "allow" as const,
    })),
    ...list(config, "blockedPrefixes").map((value) => ({
      field: "blockedPrefixes" as const,
      value,
      kind: "prefix",
      action: "block" as const,
    })),
    ...list(config, "allowedPatterns").map((value) => ({
      field: "allowedPatterns" as const,
      value,
      kind: "glob",
      action: "allow" as const,
    })),
    ...list(config, "blockedPatterns").map((value) => ({
      field: "blockedPatterns" as const,
      value,
      kind: "glob",
      action: "block" as const,
    })),
  ];

  return (
    <section className="pf-section" data-testid="pf-rules">
      <div className="pf-section-title">
        <h3>Rules</h3>
        <span className="pf-muted">
          Explicit rules; preset rules are applied in addition
        </span>
      </div>
      <form className="pf-editor" onSubmit={addRule}>
        <input
          className="pf-control"
          data-testid="pf-rules-input"
          value={rule}
          disabled={!writable}
          placeholder="plugin:example or announcement:*"
          onChange={(event) => {
            setRule(event.currentTarget.value);
          }}
        />
        <select
          className="pf-control"
          data-testid="pf-rules-kind"
          value={ruleKind}
          disabled={!writable || ruleAction === "protect"}
          onChange={(event) => {
            setRuleKind(event.currentTarget.value as RuleKind);
          }}
        >
          <option value="exact">Exact</option>
          <option value="prefix">Prefix</option>
          <option value="glob">Glob</option>
        </select>
        <select
          className="pf-control"
          data-testid="pf-rules-action"
          value={ruleAction}
          disabled={!writable}
          onChange={(event) => {
            const action = event.currentTarget.value as FirewallAction;
            setRuleAction(action);
            if (action === "protect") setRuleKind("exact");
          }}
        >
          <option value="block">Block</option>
          <option value="allow">Allow</option>
          <option value="protect">Protect</option>
        </select>
        <button
          className="pf-btn primary"
          type="submit"
          data-testid="pf-rules-add"
          disabled={!writable || rule.trim().length === 0}
        >
          Add rule
        </button>
      </form>
      <div className="pf-rules">
        {explicitRules.length === 0 && (
          <div className="pf-empty" data-testid="pf-rules-empty">
            No explicit rules yet.
          </div>
        )}
        {explicitRules.map((item, index) => (
          <div
            className="pf-rule"
            key={`${item.field}:${item.value}`}
            data-testid={`pf-rules-row-${String(index)}`}
          >
            <code title={item.value}>{item.value}</code>
            <span className="pf-pill pf-kind">{item.kind}</span>
            <span className={`pf-pill ${item.action}`}>{item.action}</span>
            <button
              className="pf-btn link danger"
              data-testid={`pf-rules-row-${String(index)}-remove`}
              disabled={!writable}
              onClick={() => {
                setPath(
                  [item.field],
                  list(config, item.field).filter(
                    (value) => value !== item.value,
                  ),
                );
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AuditSection(props: {
  config: PromptFirewallConfig | undefined;
  writable: boolean;
  setPath: ConfigSetter;
}) {
  const { config, writable, setPath } = props;
  return (
    <details className="pf-advanced" data-testid="pf-audit">
      <summary>Audit & metrics</summary>
      <div className="pf-advanced-content pf-grid">
        <Toggle
          checked={config?.audit?.enabled ?? true}
          disabled={!writable}
          label="Audit history"
          hint="Keep recent assemblies in Host memory."
          testId="pf-audit-history"
          onChange={(value) => {
            setPath(["audit", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.audit?.includePreview ?? false}
          disabled={!writable}
          label="Section preview"
          hint="Expose only the configured prefix in Inspector."
          testId="pf-audit-preview"
          onChange={(value) => {
            setPath(["audit", "includePreview"], value);
          }}
        />
        <Toggle
          checked={config?.audit?.logBlocked ?? true}
          disabled={!writable}
          label="Log blocked sections"
          hint="Names and sizes only unless preview is enabled."
          testId="pf-audit-log-blocked"
          onChange={(value) => {
            setPath(["audit", "logBlocked"], value);
          }}
        />
        <Toggle
          checked={config?.audit?.logAllowed ?? false}
          disabled={!writable}
          label="Log allowed sections"
          hint="Useful for initial policy discovery."
          testId="pf-audit-log-allowed"
          onChange={(value) => {
            setPath(["audit", "logAllowed"], value);
          }}
        />
        <Toggle
          checked={config?.audit?.highlightNewSections ?? true}
          disabled={!writable}
          label="Highlight new plugin sections"
          hint="Informational only; never blocks automatically."
          testId="pf-audit-highlight-new"
          onChange={(value) => {
            setPath(["audit", "highlightNewSections"], value);
          }}
        />
        <Toggle
          checked={config?.metrics?.enabled ?? true}
          disabled={!writable}
          label="Aggregate metrics"
          hint="No arbitrary section-name labels."
          testId="pf-metrics-enabled"
          onChange={(value) => {
            setPath(["metrics", "enabled"], value);
          }}
        />
        <label className="pf-field">
          <span>Preview characters</span>
          <input
            className="pf-control"
            type="number"
            data-testid="pf-audit-preview-chars"
            min="0"
            step="1"
            value={config?.audit?.previewChars ?? 160}
            disabled={!writable}
            onChange={(event) => {
              setPath(
                ["audit", "previewChars"],
                Number(event.currentTarget.value),
              );
            }}
          />
        </label>
        <label className="pf-field">
          <span>History size</span>
          <input
            className="pf-control"
            type="number"
            data-testid="pf-audit-history-size"
            min="0"
            step="1"
            value={config?.audit?.historySize ?? 100}
            disabled={!writable}
            onChange={(event) => {
              setPath(
                ["audit", "historySize"],
                Number(event.currentTarget.value),
              );
            }}
          />
        </label>
      </div>
    </details>
  );
}

export function InspectorSection(props: {
  inspector: PromptFirewallInspectorSnapshot | null;
  writable: boolean;
  setPolicy(name: string, policy: SectionPolicy): Promise<void>;
}) {
  const last = props.inspector?.last ?? null;
  return (
    <section className="pf-section" data-testid="pf-inspector">
      <div className="pf-section-title">
        <h3>Prompt Inspector</h3>
        <span className="pf-muted">Updates every 3 seconds</span>
      </div>
      <div className="pf-table-wrap">
        {last === null ? (
          <div className="pf-empty" data-testid="pf-inspector-empty">
            No audited prompt assembly yet.
          </div>
        ) : (
          <table className="pf-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Size</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>Policy</th>
              </tr>
            </thead>
            <tbody>
              {last.sections.map((section, index) => (
                <tr
                  key={`${section.name}:${index}`}
                  data-testid={`pf-inspector-row-${String(index)}`}
                >
                  <td>
                    <div className="pf-section-name">
                      <span
                        data-testid={`pf-inspector-row-${String(index)}-name`}
                      >
                        {section.name}
                      </span>
                      {section.isNew && (
                        <span
                          className="pf-new"
                          data-testid={`pf-inspector-row-${String(index)}-new`}
                        >
                          NEW
                        </span>
                      )}
                      {section.suspicious && (
                        <span
                          className="pf-warn"
                          data-testid={`pf-inspector-row-${String(index)}-warn`}
                        >
                          POSSIBLE ANNOUNCEMENT
                        </span>
                      )}
                    </div>
                    {section.preview !== undefined && (
                      <div className="pf-preview">{section.preview}</div>
                    )}
                  </td>
                  <td>
                    ~{section.estimatedTokens} t<br />
                    <span className="pf-muted">{section.chars} chars</span>
                  </td>
                  <td>
                    <span
                      className={`pf-pill ${section.decision === "blocked" ? "block" : section.decision === "protected" ? "protect" : "allow"}`}
                      data-testid={`pf-inspector-row-${String(index)}-decision`}
                    >
                      {section.decision}
                    </span>
                  </td>
                  <td>{section.reason}</td>
                  <td>
                    <div className="pf-actions">
                      <button
                        className="pf-btn link"
                        data-testid={`pf-inspector-row-${String(index)}-allow`}
                        disabled={!props.writable}
                        onClick={() => {
                          void props.setPolicy(section.name, "allow");
                        }}
                      >
                        Allow
                      </button>
                      <button
                        className="pf-btn link danger"
                        data-testid={`pf-inspector-row-${String(index)}-block`}
                        disabled={!props.writable}
                        onClick={() => {
                          void props.setPolicy(section.name, "block");
                        }}
                      >
                        Block
                      </button>
                      <button
                        className="pf-btn link"
                        data-testid={`pf-inspector-row-${String(index)}-protect`}
                        disabled={!props.writable}
                        onClick={() => {
                          void props.setPolicy(section.name, "protect");
                        }}
                      >
                        Protect
                      </button>
                      <button
                        className="pf-btn link"
                        data-testid={`pf-inspector-row-${String(index)}-clear`}
                        disabled={!props.writable}
                        onClick={() => {
                          void props.setPolicy(section.name, "clear");
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="pf-footer-note" data-testid="pf-inspector-footer">
        Token counts are estimates. Prompt Firewall is a hygiene and
        observability layer, not a security boundary.
      </p>
    </section>
  );
}
