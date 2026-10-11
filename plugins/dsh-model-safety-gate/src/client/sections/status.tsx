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
      testId="safety-section-status"
      title="Status"
      modified={false}
      aside={
        <button
          type="button"
          className="msg-btn"
          data-testid="safety-status-refresh"
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
          testId="safety-status-mode"
          label="Mode"
          value={
            inspect === null
              ? "unknown"
              : badgeText(inspect.enabled, inspect.mode)
          }
          tone={inspect === null || !inspect.enabled ? "off" : mode.tone}
        />
        <Chip
          testId="safety-status-classifier"
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
          testId="safety-status-uptime"
          label="Uptime"
          value={formatUptime(inspect?.startedAt, props.now)}
        />
        <Chip
          testId="safety-status-poll-interval"
          label="Refresh"
          value="every 3s"
        />
      </div>
      {classifier !== undefined && classifier.reason !== null ? (
        <div
          className="msg-notice warn"
          data-testid="safety-status-classifier-reason"
        >
          {classifier.reason}
        </div>
      ) : null}
      <Stats
        testId="safety-status-counters"
        items={[
          {
            testId: "safety-status-checks",
            value: formatCount(checks),
            label: "checks",
          },
          {
            testId: "safety-status-blocks",
            value: formatCount(blocks),
            label: "blocks",
          },
          {
            testId: "safety-status-warnings",
            value: formatCount(metrics?.warns),
            label: "warnings",
          },
          {
            testId: "safety-status-classifier-requests",
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
        <details className="msg-advanced" data-testid="safety-status-details">
          <summary>All counters</summary>
          <div className="msg-advanced-content">
            <Stats
              testId="safety-status-detail-counters"
              items={[
                {
                  testId: "safety-status-input-checks",
                  value: formatCount(metrics.checks.input),
                  label: "input checks",
                },
                {
                  testId: "safety-status-output-checks",
                  value: formatCount(
                    metrics.checks.text + metrics.checks.reasoning,
                  ),
                  label: "output checks",
                },
                {
                  testId: "safety-status-tool-checks",
                  value: formatCount(metrics.checks.tool),
                  label: "tool checks",
                },
                {
                  testId: "safety-status-tool-result-checks",
                  value: formatCount(metrics.checks["tool-result"]),
                  label: "tool-result checks",
                },
                {
                  testId: "safety-status-blocked-prompts",
                  value: formatCount(metrics.blocks.input),
                  label: "blocked prompts",
                },
                {
                  testId: "safety-status-blocked-outputs",
                  value: formatCount(
                    metrics.blocks.output + metrics.blocks.reasoning,
                  ),
                  label: "blocked outputs",
                },
                {
                  testId: "safety-status-denied-tools",
                  value: formatCount(metrics.blocks.tools),
                  label: "denied tools",
                },
                {
                  testId: "safety-status-classifier-errors",
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
