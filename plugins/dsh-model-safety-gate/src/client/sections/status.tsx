/**
 * Live view of the running gate: effective mode, classifier wiring, counters.
 *
 * Nothing here is editable — every value is the Remote's projection of the gate,
 * so this section is the place where the configuration and the behaviour of the
 * running plugin can be compared.
 */

import type { SafetyGateInspect } from "../../types.js";
import { Chip, Section, Stats } from "../components.js";
import {
  badgeText,
  describeMode,
  formatAverage,
  formatCount,
  formatMs,
  formatUptime,
} from "../format.js";

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
  const checks =
    metrics === undefined
      ? 0
      : Object.values(metrics.checks).reduce((sum, value) => sum + value, 0);
  const blocks =
    metrics === undefined
      ? 0
      : Object.values(metrics.blocks).reduce((sum, value) => sum + value, 0);
  const mode = describeMode(inspect?.mode);
  const classifier = inspect?.classifier;

  return (
    <Section
      title="Status"
      modified={false}
      aside={
        <button
          type="button"
          className="msg-btn"
          disabled={props.refreshing}
          onClick={props.onRefresh}
        >
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="msg-status">
        {" "}
        <Chip
          label="Mode"
          value={
            inspect === null
              ? "unknown"
              : badgeText(inspect.enabled, inspect.mode)
          }
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
        <Chip
          label="Uptime"
          value={formatUptime(inspect?.startedAt, props.now)}
        />
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
          {
            value: formatCount(metrics?.classifierRequests),
            label: "classifier calls",
          },
        ]}
      />
      {metrics === undefined ? (
        <p className="msg-muted">
          Counters appear once the card reaches the running gate.
        </p>
      ) : (
        <details className="msg-advanced">
          <summary>All counters</summary>
          <div className="msg-advanced-content">
            <Stats
              items={[
                {
                  value: formatCount(metrics.checks.input),
                  label: "input checks",
                },
                {
                  value: formatCount(
                    metrics.checks.text + metrics.checks.reasoning,
                  ),
                  label: "output checks",
                },
                {
                  value: formatCount(metrics.checks.tool),
                  label: "tool checks",
                },
                {
                  value: formatCount(metrics.checks["tool-result"]),
                  label: "tool-result checks",
                },
                {
                  value: formatCount(metrics.blocks.input),
                  label: "blocked prompts",
                },
                {
                  value: formatCount(
                    metrics.blocks.output + metrics.blocks.reasoning,
                  ),
                  label: "blocked outputs",
                },
                {
                  value: formatCount(metrics.blocks.tools),
                  label: "denied tools",
                },
                {
                  value: formatCount(metrics.classifierErrors),
                  label: "classifier errors",
                },
              ]}
            />
            <p className="msg-muted">
              Average classifier latency{" "}
              {formatAverage(
                metrics.classifierLatencyTotalMs,
                metrics.classifierRequests,
              )}
              , peak {formatMs(metrics.classifierLatencyMaxMs)}. Classifier
              tokens in {formatCount(metrics.classifierInputTokens)}, out{" "}
              {formatCount(metrics.classifierOutputTokens)}. Quarantine overflow
              in {formatCount(metrics.bufferOverflows)} turn(s),{" "}
              {formatCount(metrics.mainOutputCharsQuarantined)} characters held
              back, about {formatCount(metrics.estimatedMainTokensPrevented)}{" "}
              main-model tokens never generated.
            </p>
          </div>
        </details>
      )}
    </Section>
  );
}
