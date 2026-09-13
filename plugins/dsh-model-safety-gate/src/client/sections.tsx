/**
 * Body sections of the Safety Gate settings card.
 *
 * Each section owns its controls and derives every value from the settings
 * snapshot (effective configuration) or, for the status and verdict views,
 * from the running gate through the `safetyGate` Remote.
 */

import type { GateMode, ModelSafetyGateConfig, StreamMode } from "../config.js";
import type { SafetyGateClassifierState, SafetyGateInspect } from "../types.js";
import { Chip, ListField, NumberField, Section, SecretField, SelectField, Stats, TextField, Toggle, type SectionProps } from "./components.js";
import {
  badgeText,
  describeEndpoint,
  describeMode,
  formatAverage,
  formatCount,
  formatMs,
  formatUptime,
  joinList,
  shortHash,
} from "./format.js";

const GATE_MODES: ReadonlyArray<{ value: GateMode; label: string }> = [
  { value: "off", label: "Off — scan nothing" },
  { value: "audit", label: "Audit — record only" },
  { value: "warn", label: "Warn — record and surface" },
  { value: "enforce", label: "Enforce — block" },
];

const STREAM_MODES: ReadonlyArray<{ value: StreamMode; label: string }> = [
  { value: "observe", label: "Observe — pass chunks through as they arrive" },
  { value: "interrupt", label: "Interrupt — cut the turn on a hit" },
  { value: "buffered", label: "Buffered — hold chunks until their window passes" },
];

const ACTIONS: ReadonlyArray<{ value: "allow" | "warn" | "block"; label: string }> = [
  { value: "allow", label: "Allow" },
  { value: "warn", label: "Warn" },
  { value: "block", label: "Block" },
];

const BACKENDS = [
  { value: "none", label: "None — deterministic rules only" },
  { value: "dsh", label: "DSH provider — a small Harness model" },
  { value: "openai-compatible", label: "OpenAI-compatible endpoint (remote)" },
];

const FAILURE_MODES = [
  { value: "rules-only", label: "Rules only — keep the L0 verdict" },
  { value: "open", label: "Open — allow when the classifier fails" },
  { value: "closed", label: "Closed — block when the classifier fails" },
  { value: "ask", label: "Ask — defer to the approval flow" },
];

/** Small clearing control shown beside a section the user layer overrides. */
function ResetButton(props: { disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="msg-btn link"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export interface StatusProps {
  readonly inspect: SafetyGateInspect | null;
  readonly refreshing: boolean;
  readonly now: number;
  readonly onRefresh: () => void;
}

/** Live state of the running gate: effective mode, classifier wiring, counters. */
export function StatusSection(props: StatusProps) {
  const inspect = props.inspect;
  const metrics = inspect?.metrics;
  const checks = metrics === undefined ? 0 : Object.values(metrics.checks).reduce((sum, value) => sum + value, 0);
  const blocks = metrics === undefined ? 0 : Object.values(metrics.blocks).reduce((sum, value) => sum + value, 0);
  const mode = describeMode(inspect?.mode);
  const classifier = inspect?.classifier;

  return (
    <Section
      title="Status"
      modified={false}
      aside={
        <button type="button" className="msg-btn" disabled={props.refreshing} onClick={props.onRefresh}>
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="msg-status">        <Chip
          label="Mode"
          value={inspect === null ? "unknown" : badgeText(inspect.enabled, inspect.mode)}
          tone={inspect === null || !inspect.enabled ? "off" : mode.tone}
        />
        <Chip
          label="Classifier"
          value={
            classifier === undefined
              ? "unknown"
              : classifier.backend === "none"
                ? "off"
                : classifier.active
                  ? `${classifier.backend}${classifier.remote ? " (remote)" : ""}`
                  : "inactive"
          }
        />
        <Chip label="Uptime" value={formatUptime(inspect?.startedAt, props.now)} />
        <Chip label="Refresh" value="every 3s" />
      </div>
      {classifier !== undefined && classifier.reason !== null ? (
        <div className="msg-notice warn">{classifier.reason}</div>
      ) : null}
      <Stats
        items={[
          { value: formatCount(checks), label: "checks" },
          { value: formatCount(blocks), label: "blocks" },
          { value: formatCount(metrics?.warns), label: "warnings" },
          { value: formatCount(metrics?.classifierRequests), label: "classifier calls" },
        ]}
      />
      {metrics === undefined ? (
        <p className="msg-muted">Counters appear once the card reaches the running gate.</p>
      ) : (
        <details className="msg-advanced">
          <summary>All counters</summary>
          <div className="msg-advanced-content">
            <Stats
              items={[
                { value: formatCount(metrics.checks.input), label: "input checks" },
                { value: formatCount(metrics.checks.text + metrics.checks.reasoning), label: "output checks" },
                { value: formatCount(metrics.checks.tool), label: "tool checks" },
                { value: formatCount(metrics.checks["tool-result"]), label: "tool-result checks" },
                { value: formatCount(metrics.blocks.input), label: "blocked prompts" },
                { value: formatCount(metrics.blocks.output + metrics.blocks.reasoning), label: "blocked outputs" },
                { value: formatCount(metrics.blocks.tools), label: "denied tools" },
                { value: formatCount(metrics.classifierErrors), label: "classifier errors" },
              ]}
            />
            <p className="msg-muted">
              Average classifier latency {formatAverage(metrics.classifierLatencyTotalMs, metrics.classifierRequests)}, peak{" "}
              {formatMs(metrics.classifierLatencyMaxMs)}. Classifier tokens in {formatCount(metrics.classifierInputTokens)}, out{" "}
              {formatCount(metrics.classifierOutputTokens)}. Quarantine overflow in {formatCount(metrics.bufferOverflows)} turn(s),{" "}
              {formatCount(metrics.mainOutputCharsQuarantined)} characters held back, about{" "}
              {formatCount(metrics.estimatedMainTokensPrevented)} main-model tokens never generated.
            </p>
          </div>
        </details>
      )}
    </Section>
  );
}

export interface VerdictsProps {
  readonly inspect: SafetyGateInspect | null;
}

/** Recent sanitized verdicts: what the gate decided, and why. */
export function VerdictsSection(props: VerdictsProps) {
  const rows = props.inspect?.audit ?? [];
  return (
    <Section
      title="Recent verdicts"
      modified={false}
      hint={props.inspect === null ? undefined : "Newest first, last 50 checks"}
    >
      {rows.length === 0 ? (
        <div className="msg-empty">No check has run since the gate started.</div>
      ) : (
        <div className="msg-table-wrap">
          <table className="msg-table">
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
                <tr key={`${row.contentSha256}:${row.channel}:${String(index)}`}>
                  <td className="msg-mono">
                    {row.turn === null ? "—" : `t${row.turn}`}
                    {row.step === null ? "" : `.${row.step}`}
                  </td>
                  <td>
                    {row.direction === "tools" && row.toolName !== null ? row.toolName : row.channel}
                  </td>
                  <td>
                    <span className={`msg-pill ${row.decision}`}>{row.decision}</span>
                    {row.errorCode !== null ? <div className="msg-muted">{row.errorCode}</div> : null}
                  </td>
                  <td>{joinList(row.categories)}</td>
                  <td>{row.confidence.toFixed(2)}</td>
                  <td>{formatMs(row.latencyMs)}</td>
                  <td>
                    <span className="msg-mono" title={row.summary}>
                      {shortHash(row.contentSha256)}
                    </span>
                    <div className="msg-muted">{formatCount(row.contentChars)} chars</div>
                    {row.rawContent !== null ? <div className="msg-raw">{row.rawContent}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="msg-footer-note">
        Records carry a content hash, not the content, unless raw logging is switched on in Audit. They identify a check; they are not
        an inspection log.
      </p>
    </Section>
  );
}

export interface ConfigProps extends SectionProps {
  readonly config: ModelSafetyGateConfig | undefined;
  /** Wiring state of the running classifier, when the Remote has answered. */
  readonly classifierState: SafetyGateClassifierState | null;
}

/** Master switch, mode profile, and the scanning budget. */
export function GateSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Gate"
      modified={props.overridden(["enabled"]) || props.overridden(["mode"])}
      aside={
        props.overridden(["enabled"]) || props.overridden(["mode"]) ? (
          <ResetButton disabled={disabled} label="Reset" onClick={() => { props.unset(["enabled"]); props.unset(["mode"]); }} />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.enabled ?? true}
          disabled={disabled}
          label="Gate enabled"
          hint="Off switches every guard off, whatever the sections below say."
          onChange={(value) => {
            props.write(["enabled"], value);
          }}
        />
        <SelectField
          label="Mode"
          value={config?.mode ?? "warn"}
          disabled={disabled}
          options={GATE_MODES}
          onChange={(value) => {
            props.write(["mode"], value);
          }}
        />
        <Toggle
          checked={config?.allowSessionOverride ?? true}
          disabled={disabled}
          label="Allow per-session override"
          hint="A session may lower the mode for itself. Reserved for a future session control."
          onChange={(value) => {
            props.write(["allowSessionOverride"], value);
          }}
        />
        <NumberField
          label="Scan budget (characters)"
          value={config?.maxScanChars ?? 65_536}
          disabled={disabled}
          onChange={(value) => {
            props.write(["maxScanChars"], value);
          }}
        />
      </div>
    </Section>
  );
}

/** Prompt gate: which verdicts an unsafe or low-quality prompt receives. */
export function InputSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Input guard"
      modified={props.overridden(["input"])}
      aside={
        props.overridden(["input"]) ? (
          <ResetButton disabled={disabled} label="Reset" onClick={() => { props.unset(["input"]); }} />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.input?.enabled ?? true}
          disabled={disabled}
          label="Scan prompts"
          hint="Runs on agent/pre-step, before the main-model request."
          onChange={(value) => {
            props.write(["input", "enabled"], value);
          }}
        />
        <SelectField
          label="Safety findings"
          value={config?.input?.safetyAction ?? "block"}
          disabled={disabled}
          options={ACTIONS}
          onChange={(value) => {
            props.write(["input", "safetyAction"], value);
          }}
        />
        <SelectField
          label="Quality findings"
          value={config?.input?.qualityAction ?? "warn"}
          disabled={disabled}
          options={ACTIONS}
          onChange={(value) => {
            props.write(["input", "qualityAction"], value);
          }}
        />
      </div>
      <p className="msg-muted">
        Blocking on usefulness is opt-in on purpose: quality verdicts warn by default, and only an explicit block here turns them into a
        rejected prompt.
      </p>
    </Section>
  );
}

/** Streamed text and reasoning channels, with the rolling-window budget. */
export function OutputSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  const output = config?.output;
  return (
    <Section
      title="Output stream"
      modified={props.overridden(["output"])}
      aside={
        props.overridden(["output"]) ? (
          <ResetButton disabled={disabled} label="Reset" onClick={() => { props.unset(["output"]); }} />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={output?.enabled ?? true}
          disabled={disabled}
          label="Scan model output"
          hint="Runs on llm/stream for agent turns."
          onChange={(value) => {
            props.write(["output", "enabled"], value);
          }}
        />
        <SelectField
          label="Streaming mode"
          value={output?.mode ?? "buffered"}
          disabled={disabled}
          options={STREAM_MODES}
          onChange={(value) => {
            props.write(["output", "mode"], value);
          }}
        />
        <Toggle
          checked={output?.text ?? true}
          disabled={disabled}
          label="Text channel"
          hint="Visible answer text."
          onChange={(value) => {
            props.write(["output", "text"], value);
          }}
        />
        <Toggle
          checked={output?.reasoning ?? true}
          disabled={disabled}
          label="Reasoning channel"
          hint="Reasoning deltas, when the model emits them."
          onChange={(value) => {
            props.write(["output", "reasoning"], value);
          }}
        />
      </div>
      <details className="msg-advanced">
        <summary>Rolling window</summary>
        <div className="msg-advanced-content msg-grid">
          <NumberField
            label="Check every (characters)"
            value={output?.checkEveryChars ?? 512}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "checkEveryChars"], value);
            }}
          />
          <NumberField
            label="Window (characters)"
            value={output?.windowChars ?? 1_536}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "windowChars"], value);
            }}
          />
          <NumberField
            label="Look-behind (characters)"
            value={output?.lookbehindChars ?? 768}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "lookbehindChars"], value);
            }}
          />
          <NumberField
            label="Minimum interval (ms)"
            value={output?.minCheckIntervalMs ?? 250}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "minCheckIntervalMs"], value);
            }}
          />
          <NumberField
            label="Maximum buffered (characters)"
            value={output?.maxBufferedChars ?? 8_192}
            disabled={disabled}
            onChange={(value) => {
              props.write(["output", "maxBufferedChars"], value);
            }}
          />
        </div>
      </details>
      <p className="msg-muted">
        Buffered is the only mode that can guarantee a blocked sentence never reaches the page: chunks are held until their window has been
        checked, and an overflow fails closed. Observe never delays, and interrupt cuts the turn once a hit is confirmed.
      </p>
    </Section>
  );
}

/** Tool-call gate and the indirect-injection guard on tool results. */
export function ToolsSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Tools and results"
      modified={props.overridden(["tools"]) || props.overridden(["toolResults"])}
      aside={
        props.overridden(["tools"]) || props.overridden(["toolResults"]) ? (
          <ResetButton
            disabled={disabled}
            label="Reset"
            onClick={() => {
              props.unset(["tools"]);
              props.unset(["toolResults"]);
            }}
          />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.tools?.enabled ?? true}
          disabled={disabled}
          label="Gate tool calls"
          hint="Allow, ask for approval, or deny before execution."
          onChange={(value) => {
            props.write(["tools", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.tools?.semanticClassifier ?? true}
          disabled={disabled}
          label="Classify tool calls"
          hint="Runs the safety classifier on assembled arguments, not just the L0 rules."
          onChange={(value) => {
            props.write(["tools", "semanticClassifier"], value);
          }}
        />
        <Toggle
          checked={config?.toolResults?.enabled ?? true}
          disabled={disabled}
          label="Scan tool results"
          hint="Catches instructions smuggled in through fetched or read content."
          onChange={(value) => {
            props.write(["toolResults", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.toolResults?.classifyUntrustedSources ?? true}
          disabled={disabled}
          label="Classify untrusted results"
          hint="Raises the turn risk, which tightens later sensitive calls."
          onChange={(value) => {
            props.write(["toolResults", "classifyUntrustedSources"], value);
          }}
        />
      </div>
      <ListField
        label="Only these tools (names, comma separated)"
        hint="Empty gates every tool. A list narrows the gate to the named tools and leaves the rest untouched."
        value={config?.tools?.sensitiveTools ?? []}
        disabled={disabled}
        placeholder="bash, write, edit"
        onCommit={(values) => {
          props.write(["tools", "sensitiveTools"], values);
        }}
      />
    </Section>
  );
}

/** Classifier wiring, its failure policy, and the remote-content disclosure. */
export function ClassifierSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  const classifier = config?.classifier;
  const backend = classifier?.backend ?? "none";
  const remote = backend === "openai-compatible";
  const endpoint = describeEndpoint(backend, classifier?.baseURL);
  return (
    <Section
      title="Classifier"
      modified={props.overridden(["classifier"])}
      aside={
        props.overridden(["classifier"]) ? (
          <ResetButton disabled={disabled} label="Reset" onClick={() => { props.unset(["classifier"]); }} />
        ) : undefined
      }
    >
      {remote ? (
        <div className="msg-notice warn">
          <strong>Safety classifier is remote.</strong> Prompts, model output, and reasoning are sent to {endpoint} for classification.
          Turn on “Require a local classifier” to forbid remote endpoints, or keep the classifier off to stay on the deterministic rules.
        </div>
      ) : null}
      <div className="msg-grid">
        <SelectField
          label="Backend"
          value={backend}
          disabled={disabled}
          options={BACKENDS}
          onChange={(value) => {
            props.write(["classifier", "backend"], value);
          }}
        />
        <SelectField
          label="On classifier failure"
          value={classifier?.failureMode ?? "rules-only"}
          disabled={disabled}
          options={FAILURE_MODES}
          onChange={(value) => {
            props.write(["classifier", "failureMode"], value);
          }}
        />
        {backend === "dsh" ? (
          <>
            <TextField
              label="Provider id"
              value={classifier?.provider ?? ""}
              disabled={disabled}
              placeholder="local"
              onChange={(value) => {
                props.write(["classifier", "provider"], value);
              }}
            />
            <TextField
              label="Model id"
              value={classifier?.model ?? ""}
              disabled={disabled}
              placeholder="safety-small"
              onChange={(value) => {
                props.write(["classifier", "model"], value);
              }}
            />
          </>
        ) : null}
        {remote ? (
          <>
            <TextField
              label="Endpoint base URL"
              value={classifier?.baseURL ?? ""}
              disabled={disabled}
              placeholder="https://host/v1"
              onChange={(value) => {
                props.write(["classifier", "baseURL"], value);
              }}
            />
            <TextField
              label="Model id"
              value={classifier?.model ?? ""}
              disabled={disabled}
              placeholder="safety-small"
              onChange={(value) => {
                props.write(["classifier", "model"], value);
              }}
            />
          </>
        ) : null}
        <NumberField
          label="Timeout (ms)"
          value={classifier?.timeoutMs ?? 3_000}
          disabled={disabled}
          onChange={(value) => {
            props.write(["classifier", "timeoutMs"], value);
          }}
        />
        <NumberField
          label="Maximum reply tokens"
          value={classifier?.maxTokens ?? 128}
          disabled={disabled}
          onChange={(value) => {
            props.write(["classifier", "maxTokens"], value);
          }}
        />
        <NumberField
          label="Temperature"
          value={classifier?.temperature ?? 0}
          disabled={disabled}
          onChange={(value) => {
            props.write(["classifier", "temperature"], value);
          }}
        />
        <Toggle
          checked={classifier?.requireLocal ?? false}
          disabled={disabled}
          label="Require a local classifier"
          hint="Refuses every remote endpoint, including an OpenAI-compatible one."
          onChange={(value) => {
            props.write(["classifier", "requireLocal"], value);
          }}
        />
      </div>
      <SecretField
        label="Endpoint bearer key"
        configured={props.classifierState?.apiKeyConfigured ?? null}
        disabled={disabled}
        placeholder="sk-…"
        onSave={(value) => {
          props.write(["classifier", "apiKey"], value);
        }}
      />
      {props.classifierState?.active === false && backend !== "none" ? (
        <div className="msg-notice warn">
          This backend is configured but not running: {props.classifierState.reason ?? "no transport is attached."} Until it is, every check
          stops at the deterministic layer.
        </div>
      ) : null}
      <p className="msg-muted">
        The classifier never has tools and never sees its own output: its calls run under a bypass marker, so moderating a generation cannot
        recursively moderate the moderator.
      </p>
    </Section>
  );
}

/** Audit switches, including the opt-in raw-content record. */
export function AuditSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Audit"
      modified={props.overridden(["audit"])}
      aside={
        props.overridden(["audit"]) ? (
          <ResetButton disabled={disabled} label="Reset" onClick={() => { props.unset(["audit"]); }} />
        ) : undefined
      }
    >
      <div className="msg-grid">
        <Toggle
          checked={config?.audit?.enabled ?? true}
          disabled={disabled}
          label="Record verdicts"
          hint="Session events and counters for every check."
          onChange={(value) => {
            props.write(["audit", "enabled"], value);
          }}
        />
        <Toggle
          checked={config?.audit?.includeRawContent ?? false}
          disabled={disabled}
          label="Include raw content"
          hint="Off by default: records carry a hash. On stores a bounded preview of the checked content."
          onChange={(value) => {
            props.write(["audit", "includeRawContent"], value);
          }}
        />
      </div>
      {config?.audit?.includeRawContent === true ? (
        <div className="msg-notice warn">
          Raw content is on. The checked prompt, output, or tool argument is stored in the session log and the recent-verdict list, so
          anything the gate inspects — including secrets it matched — is written down verbatim.
        </div>
      ) : null}
    </Section>
  );
}

/** Operator-added regular expressions that escalate straight to a block. */
export function AdvancedSection(props: ConfigProps) {
  const { config } = props;
  const disabled = !props.writable;
  return (
    <Section
      title="Advanced"
      modified={props.overridden(["customBlockPatterns"])}
      aside={
        props.overridden(["customBlockPatterns"]) ? (
          <ResetButton disabled={disabled} label="Reset" onClick={() => { props.unset(["customBlockPatterns"]); }} />
        ) : undefined
      }
    >
      <ListField
        label="Extra block patterns (one per line, comma separated)"
        hint="Case-insensitive JavaScript regular expressions, scanned in the deterministic layer. A pattern that does not compile is refused here rather than silently dropped at load."
        value={config?.customBlockPatterns ?? []}
        disabled={disabled}
        placeholder="internal-ticket-[0-9]+"
        onCommit={(values) => {
          props.write(["customBlockPatterns"], values);
        }}
      />
    </Section>
  );
}
