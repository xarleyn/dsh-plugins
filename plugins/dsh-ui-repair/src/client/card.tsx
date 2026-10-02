import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { bindSettingsExternalStore } from "@yadsh/dsh-plugin-kit/client";
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

/** The one-liner this row answers the seat's `summary` view with. */
const ROW_SUMMARY =
  "Observe layout defects and apply reversible, scoped repairs.";

export interface CardFace {
  /**
   * The card's own settings form, resolved through `ctx.configForms` and named
   * `settings`, not `form`.
   *
   * The seat hands its registrant a `form` of its own: a `ConfigPageForm` of
   * `{ state, mutate }` only (`lib/types/client/slot-contract.d.ts`, built at
   * `lib/client.js:2688` of the installed `0.1.7-rc.2` bundle). That view can
   * neither be subscribed to nor written field by field, and every control here
   * writes one named field, so the card reads and writes through the full
   * `ConfigForm` the face carries instead — under a name the page never passes,
   * because the renderer spreads its owner props after the face. `form` is
   * `undefined` for a Config that declares no `.volatile()` field, so nothing the
   * card draws or refuses to draw may depend on it either.
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

export function UIRepairCard({ settings, runtime }: CardProps) {
  const store = useMemo(() => bindSettingsExternalStore(settings), [settings]);
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

  const setConfidence = (
    field: "autoConfidence" | "dangerousConfidence",
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const percent = Number(event.currentTarget.value);
    if (Number.isFinite(percent)) void settings.set(field, percent / 100);
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
    void settings.set("ignore", [...config.ignore, { selector: value }]);
    setSelector("");
  };
  const removeIgnore = (index: number) => {
    void settings.set(
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
    void settings.set("ignore", [
      ...config.ignore,
      {
        ...(issue.plugin === undefined ? {} : { plugin: issue.plugin }),
        rule: issue.ruleId,
        ...(target === undefined ? {} : { selector: target }),
      },
    ]);
  };

  return (
    <div className="uir-body" data-dsh-ui-repair-ui data-testid="repair-ui">
      <section className="uir-section">
        <h3 className="uir-section-title">Policy</h3>
        <Toggle
          title="Enabled"
          description="Disabling restores all temporary repairs and stops observation."
          checked={config.enabled}
          disabled={!writable}
          testId="repair-toggle-enabled"
          onChange={(checked) => void settings.set("enabled", checked)}
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
                void settings.set(
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
              onChange={(event) => setConfidence("dangerousConfidence", event)}
            />
          </label>
        </div>
        <Toggle
          title="Scan on startup"
          description="Run one bounded scan after the browser plugin mounts."
          checked={config.scanOnStartup}
          disabled={!writable}
          testId="repair-toggle-scan-startup"
          onChange={(checked) => void settings.set("scanOnStartup", checked)}
        />
        <Toggle
          title="Scan after DOM changes"
          description="Batch affected roots through MutationObserver and animation frames."
          checked={config.scanAfterMutation}
          disabled={!writable}
          testId="repair-toggle-scan-mutation"
          onChange={(checked) =>
            void settings.set("scanAfterMutation", checked)
          }
        />
        <Toggle
          title="Scan after layout resize"
          description="Observe bounded repair roots for geometry changes."
          checked={config.scanAfterResize}
          disabled={!writable}
          testId="repair-toggle-scan-resize"
          onChange={(checked) => void settings.set("scanAfterResize", checked)}
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
                          {pendingRepair === issue.id ? "Applying..." : "Apply"}
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
          Matching diagnoses remain visible but are never applied automatically.
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
  );
}

/**
 * The entry the Plugins page seats on this bundle's row, measured against the
 * installed `@deepseek-ai/dsh-client-ui-plugin-manager` `0.1.7-rc.2`:
 *
 * - the row's page is the card. It draws the surface, the row title, the row id,
 *   the module name and the description line, then mounts this entry's `page`
 *   view into its own configuration section (`div[data-plugin-config]`,
 *   `lib/client.js:1851-1852`). So the entry renders the settings body and
 *   nothing else: a frame, a heading or an expand control of ours would draw a
 *   second card inside the Host's one, which is what decision D1 of
 *   `docs/DSH-0.1.7-MIGRATION.md` §10 forbids on this seat;
 * - the same entry is asked for `view: "summary"`, and that answer lands inside
 *   the page's own description paragraph, so it stays one plain sentence.
 *
 * **[measured]** The page asks for the one-liner only where `row.meta` carries no
 * description: the line is `description ?? renderSlot(… { view: "summary" } …)`
 * (`:1841`), with `description` read off `row.meta` alone (`rowText`,
 * `:211-215`). The Host builds `row.meta` from the bundle's exported locale files
 * and falls back to that same address's `package.json` name and description
 * (`readPluginMeta`, `@deepseek-ai/dsh-app-boot` `lib/index.js:1968-1978`), so a
 * published bundle arrives with a description and this arm is the seat contract's
 * fallback (`lib/types/client/slot-contract.d.ts`) rather than a line an operator
 * sees. It still has to answer it, and it reads no store to do so.
 *
 * The page hands its registrant a `form` of its own; the card never reads it — see
 * {@link CardFace.settings}.
 */
export function UIRepairCardEntry(props: CardProps) {
  if (props.view === "summary") return ROW_SUMMARY;
  return <UIRepairCard {...props} />;
}
