import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  CardShell,
  bindSettingsExternalStore,
} from "@yadsh/dsh-plugin-kit/client";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import {
  REPAIR_MODES,
  resolvePluginConfig,
  type UIRepairPluginConfig,
} from "../shared/config.js";
import type { UIRepairRuntime } from "./runtime.js";
import type { RepairIssue } from "./types.js";

export interface CardFace {
  /**
   * The card's own settings form, resolved from `ctx.configForms`. The Plugins
   * page passes a `form` of its own as owner props, and owner props are spread
   * over the injected face, so the face keeps a name that page never passes.
   */
  readonly settings: ConfigForm<UIRepairPluginConfig>;
  readonly runtime: UIRepairRuntime;
}

type CardProps = PropsRuntime<"plugins.row.config"> & InjectFace<CardFace>;

interface ToggleProps {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly testId: string;
  readonly onChange: (checked: boolean) => void;
}

function Toggle(props: ToggleProps) {
  return (
    <label className="uir-toggle-row">
      <span className="uir-toggle-copy">
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </span>
      <input
        className="uir-toggle"
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function validSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export function UIRepairCard({ view, settings: form, runtime }: CardProps) {
  const store = useMemo(() => bindSettingsExternalStore(form), [form]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const config = resolvePluginConfig(snapshot.value ?? {});
  const writable = snapshot.status === "ready" && snapshot.writable;
  useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.getRevision(),
    () => runtime.getRevision(),
  );
  const report = runtime.getLatestReport();
  const [selector, setSelector] = useState("");
  const [selectorError, setSelectorError] = useState<string | undefined>();
  const [scanning, setScanning] = useState(false);
  const [pendingRepair, setPendingRepair] = useState<string | undefined>();
  const [repairError, setRepairError] = useState<string | undefined>();

  if (snapshot.status === "unavailable") return null;

  /*
   * The row page asks for this view only when the bundle declares no row
   * description, and it drops whatever it gets into a one-line paragraph, so the
   * form must not render here.
   */
  if (view === "summary") {
    return (
      <span data-dsh-ui-repair-ui data-testid="repair-summary">
        {config.enabled ? `Repair mode: ${config.mode}` : "Disabled"}
      </span>
    );
  }

  const setConfidence = (
    field: "autoConfidence" | "dangerousConfidence",
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const percent = Number(event.currentTarget.value);
    if (Number.isFinite(percent)) void form.set(field, percent / 100);
  };
  const scan = async () => {
    setScanning(true);
    try {
      await runtime.scan();
    } finally {
      setScanning(false);
    }
  };
  const addSelector = () => {
    const value = selector.trim();
    if (value.length === 0 || !validSelector(value)) {
      setSelectorError("Enter a valid CSS selector.");
      return;
    }
    setSelectorError(undefined);
    void form.set("ignore", [...config.ignore, { selector: value }]);
    setSelector("");
  };
  const removeIgnore = (index: number) => {
    void form.set(
      "ignore",
      config.ignore.filter((_rule, ruleIndex) => ruleIndex !== index),
    );
  };
  const applyIssue = async (issue: RepairIssue) => {
    setPendingRepair(issue.id);
    setRepairError(undefined);
    try {
      if (!(await runtime.apply(issue.id))) {
        setRepairError(
          `${issue.ruleId} could not be verified or is no longer applicable.`,
        );
      }
    } catch {
      setRepairError(`${issue.ruleId} manual repair failed.`);
    } finally {
      setPendingRepair(undefined);
    }
  };
  const ignoreIssue = (issue: RepairIssue) => {
    const target = validSelector(issue.target) ? issue.target : undefined;
    void form.set("ignore", [
      ...config.ignore,
      {
        ...(issue.plugin === undefined ? {} : { plugin: issue.plugin }),
        rule: issue.ruleId,
        ...(target === undefined ? {} : { selector: target }),
      },
    ]);
  };

  return (
    <CardShell
      title="UI Repair"
      description="Observe layout defects and apply reversible, scoped repairs."
      badge={
        <span className="dsh-plugin-card__badge" data-dsh-ui-repair-ui>
          {config.enabled ? config.mode : "disabled"}
        </span>
      }
      label={(open) => `${open ? "Hide" : "Show"} settings: UI Repair`}
      bodyClassName="uir-body"
    >
      <div data-dsh-ui-repair-ui data-testid="repair-ui">
        <section className="uir-section">
          <h3 className="uir-section-title">Policy</h3>
          <Toggle
            title="Enabled"
            description="Disabling restores all temporary repairs and stops observation."
            checked={config.enabled}
            disabled={!writable}
            testId="repair-toggle-enabled"
            onChange={(checked) => void form.set("enabled", checked)}
          />
          <div className="uir-grid">
            <label className="uir-field">
              <span>Mode</span>
              <select
                className="uir-control"
                value={config.mode}
                disabled={!writable}
                data-testid="repair-mode"
                onChange={(event) =>
                  void form.set(
                    "mode",
                    event.currentTarget.value as UIRepairPluginConfig["mode"],
                  )
                }
              >
                {REPAIR_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <label className="uir-field">
              <span>Auto confidence (%)</span>
              <input
                className="uir-control"
                type="number"
                min="0"
                max="100"
                step="1"
                value={Math.round(config.autoConfidence * 100)}
                disabled={!writable}
                data-testid="repair-auto-confidence"
                onChange={(event) => setConfidence("autoConfidence", event)}
              />
            </label>
            <label className="uir-field">
              <span>Risky repair threshold (%)</span>
              <input
                className="uir-control"
                type="number"
                min="98"
                max="100"
                step="1"
                value={Math.round(config.dangerousConfidence * 100)}
                disabled={!writable}
                data-testid="repair-dangerous-confidence"
                onChange={(event) =>
                  setConfidence("dangerousConfidence", event)
                }
              />
            </label>
          </div>
          <Toggle
            title="Scan on startup"
            description="Run one bounded scan after the browser plugin mounts."
            checked={config.scanOnStartup}
            disabled={!writable}
            testId="repair-toggle-scan-startup"
            onChange={(checked) => void form.set("scanOnStartup", checked)}
          />
          <Toggle
            title="Scan after DOM changes"
            description="Batch affected roots through MutationObserver and animation frames."
            checked={config.scanAfterMutation}
            disabled={!writable}
            testId="repair-toggle-scan-mutation"
            onChange={(checked) => void form.set("scanAfterMutation", checked)}
          />
          <Toggle
            title="Scan after layout resize"
            description="Observe bounded repair roots for geometry changes."
            checked={config.scanAfterResize}
            disabled={!writable}
            testId="repair-toggle-scan-resize"
            onChange={(checked) => void form.set("scanAfterResize", checked)}
          />
        </section>

        <section className="uir-section">
          <h3 className="uir-section-title">UI health</h3>
          <div className="uir-actions">
            <button
              className="uir-button"
              type="button"
              disabled={scanning || !config.enabled}
              data-testid="repair-scan"
              onClick={() => void scan()}
            >
              {scanning ? "Scanning..." : "Scan now"}
            </button>
            <button
              className="uir-button"
              type="button"
              data-testid="repair-rollback"
              onClick={() => {
                runtime.rollbackAll();
              }}
            >
              Roll back temporary repairs
            </button>
          </div>
          {report === undefined ? (
            <p className="uir-muted" data-testid="repair-report-empty">
              No completed scan in this browser session.
            </p>
          ) : (
            <>
              <div className="uir-report">
                <span className="uir-metric">
                  <strong>{report.issues.length}</strong>
                  <span>issues</span>
                </span>
                <span className="uir-metric">
                  <strong>{report.applied.length}</strong>
                  <span>applied</span>
                </span>
                <span className="uir-metric">
                  <strong>{report.ignored.length}</strong>
                  <span>ignored</span>
                </span>
                <span className="uir-metric">
                  <strong>{report.rolledBack.length}</strong>
                  <span>rolled back</span>
                </span>
              </div>
              <ul className="uir-issues">
                {report.issues.slice(0, 5).map((issue) => (
                  <li
                    className="uir-issue"
                    key={issue.id}
                    data-testid="repair-issue"
                  >
                    <div className="uir-issue-summary">
                      <span className="uir-rule">{issue.ruleId}</span>
                      <span className="uir-target">{issue.target}</span>
                      <span className="uir-confidence">
                        {Math.round(issue.confidence * 100)}%
                      </span>
                    </div>
                    {issue.suggestedCss === undefined ? null : (
                      <code className="uir-suggestion">
                        {Object.entries(issue.suggestedCss)
                          .map(([property, value]) => `${property}: ${value}`)
                          .join("; ")}
                      </code>
                    )}
                    {config.mode !== "suggest" ? null : (
                      <div className="uir-issue-actions">
                        {issue.suggestedCss === undefined ? null : (
                          <button
                            className="uir-button"
                            type="button"
                            disabled={
                              pendingRepair !== undefined ||
                              report.ignored.includes(issue.id) ||
                              report.applied.includes(issue.id)
                            }
                            data-testid="repair-issue-apply"
                            onClick={() => void applyIssue(issue)}
                          >
                            {pendingRepair === issue.id
                              ? "Applying..."
                              : "Apply"}
                          </button>
                        )}
                        <button
                          className="uir-button"
                          type="button"
                          disabled={
                            !writable || report.ignored.includes(issue.id)
                          }
                          data-testid="repair-issue-ignore"
                          onClick={() => ignoreIssue(issue)}
                        >
                          {report.ignored.includes(issue.id)
                            ? "Ignored"
                            : "Ignore"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {repairError === undefined ? null : (
                <p
                  className="uir-error"
                  role="status"
                  data-testid="repair-apply-error"
                >
                  {repairError}
                </p>
              )}
            </>
          )}
        </section>

        <section className="uir-section">
          <h3 className="uir-section-title">Ignored selectors</h3>
          <p className="uir-muted">
            Matching diagnoses remain visible but are never applied
            automatically.
          </p>
          <ul className="uir-ignore-list">
            {config.ignore.map((rule, index) => (
              <li
                className="uir-ignore-item"
                key={`${rule.plugin ?? ""}:${rule.rule ?? ""}:${rule.selector ?? ""}:${index}`}
                data-testid="repair-ignore-row"
              >
                <code>
                  {rule.selector ??
                    [rule.plugin, rule.rule].filter(Boolean).join(" / ")}
                </code>
                <button
                  className="uir-button"
                  type="button"
                  disabled={!writable}
                  data-testid="repair-ignore-remove"
                  onClick={() => removeIgnore(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="uir-ignore-add">
            <input
              className="uir-control"
              value={selector}
              disabled={!writable}
              placeholder=".intentional-overflow"
              aria-label="CSS selector to ignore"
              data-testid="repair-ignore-input"
              onChange={(event) => setSelector(event.currentTarget.value)}
            />
            <button
              className="uir-button"
              type="button"
              disabled={!writable}
              data-testid="repair-ignore-add"
              onClick={addSelector}
            >
              Add selector
            </button>
          </div>
          {selectorError === undefined ? null : (
            <p
              className="uir-error"
              role="alert"
              data-testid="repair-ignore-error"
            >
              {selectorError}
            </p>
          )}
        </section>
      </div>
    </CardShell>
  );
}
